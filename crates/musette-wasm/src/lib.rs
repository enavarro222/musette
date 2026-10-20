//! WebAssembly bindings used by `web/`.
//!
//! Build: `wasm-pack build crates/musette-wasm --target web --out-dir ../../web/src/lib/wasm/pkg`

use serde::Serialize;
use wasm_bindgen::prelude::*;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ClimbJs {
    pub start_m: f64,
    pub end_m: f64,
    pub gain_m: f64,
    pub avg_grade: f64,
    pub max_grade: f64,
    pub category: &'static str,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RouteAnalysis {
    pub distance_m: f64,
    pub ascent_m: f64,
    pub profile_step_m: f64,
    pub profile: Vec<f64>,
    pub climbs: Vec<ClimbJs>,
    /// Indices of points kept after simplification (5 m tolerance).
    pub simplified: Vec<u32>,
}

/// Analyse a route. `eles` uses NaN for missing elevation.
#[wasm_bindgen(js_name = analyzeRoute)]
pub fn analyze_route(lats: Vec<f64>, lons: Vec<f64>, eles: Vec<f64>) -> Result<JsValue, JsError> {
    if lats.len() != lons.len() || lats.len() != eles.len() {
        return Err(JsError::new(
            "lats, lons and eles must have the same length",
        ));
    }
    let points: Vec<track::Point> = lats
        .iter()
        .zip(&lons)
        .zip(&eles)
        .map(|((&lat, &lon), &e)| track::Point::new(lat, lon, (!e.is_nan()).then_some(e)))
        .collect();

    let distance_m = track::cumulative_distance(&points)
        .last()
        .copied()
        .unwrap_or(0.0);
    let simplified = track::simplify(&points, 5.0)
        .into_iter()
        .map(|i| i as u32)
        .collect();

    let (profile_step_m, profile, ascent_m, climbs) = match track::profile(&points, 20.0) {
        Some(p) => {
            let climbs = climbs::detect(&p, &climbs::Params::default())
                .into_iter()
                .map(|c| ClimbJs {
                    start_m: c.start,
                    end_m: c.end,
                    gain_m: c.gain,
                    avg_grade: c.avg_grade,
                    max_grade: c.max_grade,
                    category: category_name(c.category),
                })
                .collect();
            let ascent = track::total_ascent(&p.ele, 5.0);
            (p.step, p.ele, ascent, climbs)
        }
        None => (0.0, Vec::new(), 0.0, Vec::new()),
    };

    let out = RouteAnalysis {
        distance_m,
        ascent_m,
        profile_step_m,
        profile,
        climbs,
        simplified,
    };
    Ok(serde_wasm_bindgen::to_value(&out)?)
}

fn category_name(c: climbs::Category) -> &'static str {
    use climbs::Category::*;
    match c {
        Uncategorized => "uncategorized",
        Cat4 => "4",
        Cat3 => "3",
        Cat2 => "2",
        Cat1 => "1",
        Hc => "HC",
    }
}

/// Throws if the FIT file is truncated or corrupted.
#[wasm_bindgen(js_name = verifyFit)]
pub fn verify_fit(bytes: &[u8]) -> Result<u32, JsError> {
    fit::verify(bytes)
        .map(|h| h.data_size)
        .map_err(|e| JsError::new(&format!("{e:?}")))
}

#[derive(Serialize)]
pub struct ActivityRefJs {
    pub id: String,
    pub size: Option<u64>,
}

/// Pick activity files from a Bryton drive listing.
#[wasm_bindgen(js_name = brytonFindActivities)]
pub fn bryton_find_activities(paths: Vec<String>, sizes: Vec<f64>) -> Result<JsValue, JsError> {
    let files: Vec<driver_bryton::DriveFile> = paths
        .into_iter()
        .zip(sizes)
        .map(|(path, size)| driver_bryton::DriveFile {
            path,
            size: size as u64,
        })
        .collect();
    let acts: Vec<ActivityRefJs> = driver_bryton::find_activities(&files)
        .into_iter()
        .map(|a| ActivityRefJs {
            id: a.id,
            size: a.size,
        })
        .collect();
    Ok(serde_wasm_bindgen::to_value(&acts)?)
}

/// Encode a CC600 protocol frame.
#[wasm_bindgen(js_name = cc600Encode)]
pub fn cc600_encode(op: u8, seq: u8, payload: &[u8]) -> Result<Vec<u8>, JsError> {
    let op = protocol_cc600::Op::from_u8(op).ok_or_else(|| JsError::new("unknown op"))?;
    let frame = protocol_cc600::Frame::new(op, seq, payload);
    let mut buf = vec![0u8; frame.encoded_len()];
    frame
        .encode(&mut buf)
        .map_err(|e| JsError::new(&format!("{e:?}")))?;
    Ok(buf)
}

#[derive(Serialize)]
pub struct DecodedFrame {
    pub op: u8,
    pub seq: u8,
    pub payload: Vec<u8>,
    pub consumed: usize,
}

/// Decode one CC600 frame from the start of `bytes`.
/// Returns `undefined` if more bytes are needed.
#[wasm_bindgen(js_name = cc600Decode)]
pub fn cc600_decode(bytes: &[u8]) -> Result<JsValue, JsError> {
    match protocol_cc600::Frame::decode(bytes) {
        Ok((f, consumed)) => Ok(serde_wasm_bindgen::to_value(&DecodedFrame {
            op: f.op as u8,
            seq: f.seq,
            payload: f.payload.to_vec(),
            consumed,
        })?),
        Err(protocol_cc600::Error::Incomplete { .. }) => Ok(JsValue::UNDEFINED),
        Err(e) => Err(JsError::new(&format!("{e:?}"))),
    }
}
