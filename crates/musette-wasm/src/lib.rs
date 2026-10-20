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

/// Simplification of the CC600 route line, metres (as the firmware's route tool).
const CC600_ROUTE_TOLERANCE_M: f64 = 3.0;

/// The CC600 route file (`OCRT`) of a route. `eles` uses NaN for missing elevation.
#[wasm_bindgen(js_name = cc600BuildRoute)]
pub fn cc600_build_route(
    name: String,
    lats: Vec<f64>,
    lons: Vec<f64>,
    eles: Vec<f64>,
) -> Result<Vec<u8>, JsError> {
    if lats.len() != lons.len() || lats.len() != eles.len() {
        return Err(JsError::new(
            "lats, lons and eles must have the same length",
        ));
    }
    if lats.len() < 2 {
        return Err(JsError::new("a route needs at least 2 points"));
    }
    let gpx = route_cc600::Gpx {
        name,
        points: lats
            .iter()
            .zip(&lons)
            .zip(&eles)
            .map(|((&lat, &lon), &e)| (lat, lon, (!e.is_nan()).then_some(e)))
            .collect(),
        times: vec![None; lats.len()],
    };
    Ok(route_cc600::build(&gpx, CC600_ROUTE_TOLERANCE_M))
}

/// `TransferBegin` payload for sending `bytes` as a file of `kind`
/// (1 route, 2 map): kind, size and CRC of the whole file.
#[wasm_bindgen(js_name = cc600TransferBegin)]
pub fn cc600_transfer_begin(kind: u8, bytes: &[u8]) -> Result<Vec<u8>, JsError> {
    use protocol_cc600::transfer::{Begin, Kind};
    let kind = Kind::from_u8(kind).ok_or_else(|| JsError::new("unknown file kind"))?;
    let size = u32::try_from(bytes.len()).map_err(|_| JsError::new("file too large"))?;
    let crc = protocol_cc600::crc16_ccitt(bytes);
    Ok(Begin { kind, size, crc }.to_bytes().to_vec())
}

/// `TransferChunk` payload: offset then the bytes.
#[wasm_bindgen(js_name = cc600TransferChunk)]
pub fn cc600_transfer_chunk(offset: u32, data: &[u8]) -> Vec<u8> {
    let mut out = protocol_cc600::transfer::chunk_header(offset).to_vec();
    out.extend_from_slice(data);
    out
}

/// App side of a file transfer: what to send next, given the device's answers.
#[wasm_bindgen(js_name = Cc600Sender)]
pub struct Cc600Sender(protocol_cc600::transfer::Sender);

#[wasm_bindgen(js_class = Cc600Sender)]
impl Cc600Sender {
    #[wasm_bindgen(constructor)]
    pub fn new(size: u32) -> Self {
        Self(protocol_cc600::transfer::Sender::new(size))
    }

    /// Applies a `TransferReady` payload; returns the offset to start from.
    pub fn ready(&mut self, payload: &[u8]) -> Result<u32, JsError> {
        let ready = protocol_cc600::transfer::Ready::from_bytes(payload)
            .ok_or_else(|| JsError::new("bad TransferReady"))?;
        self.0.ready(ready);
        Ok(ready.next)
    }

    /// Applies a `TransferAck` payload.
    pub fn ack(&mut self, payload: &[u8]) -> Result<(), JsError> {
        let ack = protocol_cc600::transfer::Ack::from_bytes(payload)
            .ok_or_else(|| JsError::new("bad TransferAck"))?;
        self.0.ack(ack);
        Ok(())
    }

    /// Applies a `TransferResend` payload.
    pub fn resend(&mut self, payload: &[u8]) -> Result<(), JsError> {
        let ack = protocol_cc600::transfer::Ack::from_bytes(payload)
            .ok_or_else(|| JsError::new("bad TransferResend"))?;
        self.0.resend(ack);
        Ok(())
    }

    /// `[offset, length]` of the next chunk (at most `max` bytes), or
    /// `undefined` when the window is full or everything was sent.
    #[wasm_bindgen(js_name = nextChunk)]
    pub fn next_chunk(&mut self, max: u32) -> Option<Vec<u32>> {
        self.0.next_chunk(max).map(|(o, l)| vec![o, l])
    }

    /// Everything was sent and acknowledged.
    pub fn done(&self) -> bool {
        self.0.all_sent() && self.0.permille() == 1000
    }

    /// Share of the file the device holds, 0..=1000.
    pub fn permille(&self) -> u32 {
        self.0.permille()
    }
}

/// Device side of a file transfer, with the file kept in memory: the real
/// [`protocol_cc600::transfer::Receiver`] behind a simulated CC600 (tests,
/// demo without a device).
#[wasm_bindgen(js_name = Cc600Receiver)]
pub struct Cc600Receiver {
    rx: protocol_cc600::transfer::Receiver,
    free: u32,
    partial: Option<protocol_cc600::transfer::Partial>,
    data: Vec<u8>,
    committed: Option<Vec<u8>>,
}

#[wasm_bindgen(js_class = Cc600Receiver)]
impl Cc600Receiver {
    #[wasm_bindgen(constructor)]
    pub fn new(window: u16, free: u32) -> Self {
        Self {
            rx: protocol_cc600::transfer::Receiver::new(window),
            free,
            partial: None,
            data: Vec::new(),
            committed: None,
        }
    }

    /// Handles a transfer request; returns the answer as `[op, ...payload]`,
    /// or `undefined` when there is none.
    pub fn handle(&mut self, op: u8, payload: &[u8]) -> Result<Option<Vec<u8>>, JsError> {
        use protocol_cc600::transfer::{parse_chunk, Begin, Chunk, ErrorCode};
        use protocol_cc600::Op;
        let reply = |op: Op, p: &[u8]| Some([&[op as u8], p].concat());
        let error = |code: ErrorCode| reply(Op::Error, &[code as u8]);
        let op = Op::from_u8(op).ok_or_else(|| JsError::new("unknown op"))?;
        Ok(match op {
            Op::TransferBegin => {
                let Some(begin) = Begin::from_bytes(payload) else {
                    return Ok(error(ErrorCode::BadRequest));
                };
                match self.rx.begin(begin, self.partial, self.free) {
                    Ok(ready) => {
                        self.data.truncate(ready.next as usize);
                        self.partial = self.rx.progress();
                        reply(Op::TransferReady, &ready.to_bytes())
                    }
                    Err(code) => error(code),
                }
            }
            Op::TransferChunk => {
                let Some((offset, bytes)) = parse_chunk(payload) else {
                    return Ok(error(ErrorCode::BadRequest));
                };
                match self.rx.chunk(offset, bytes) {
                    Ok(Chunk::Accept(ack)) => {
                        self.data.extend_from_slice(bytes);
                        self.partial = self.rx.progress();
                        ack.and_then(|a| reply(Op::TransferAck, &a.to_bytes()))
                    }
                    Ok(Chunk::Resend(a)) => reply(Op::TransferResend, &a.to_bytes()),
                    Ok(Chunk::Ignore) => None,
                    Err(code) => error(code),
                }
            }
            Op::TransferEnd => match self.rx.end() {
                Ok(_) => {
                    self.partial = None;
                    self.committed = Some(core::mem::take(&mut self.data));
                    reply(Op::Ok, &[])
                }
                Err(code) => {
                    if code == ErrorCode::BadCrc {
                        self.partial = None;
                        self.data.clear();
                    }
                    error(code)
                }
            },
            Op::TransferAbort => {
                self.rx.abort();
                reply(Op::Ok, &[])
            }
            _ => return Err(JsError::new("not a transfer request")),
        })
    }

    /// The link dropped: the partial file stays, as on the device.
    pub fn disconnect(&mut self) {
        self.rx.abort();
    }

    /// Bytes of the partial file held so far.
    pub fn received(&self) -> u32 {
        self.partial.map_or(0, |p| p.received)
    }

    /// The last file committed by `TransferEnd`.
    pub fn committed(&self) -> Option<Vec<u8>> {
        self.committed.clone()
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Cc600FieldJs {
    pub key: &'static str,
    /// `onOff`, `range`, `choice`, `tz` or `sensor`.
    pub kind: &'static str,
    pub min: Option<u8>,
    pub max: Option<u8>,
    pub options: Vec<&'static str>,
}

/// The CC600 settings and the values each takes (what the device accepts).
#[wasm_bindgen(js_name = cc600SettingsFields)]
pub fn cc600_settings_fields() -> Result<JsValue, JsError> {
    use settings_cc600::FieldKind;
    let fields: Vec<Cc600FieldJs> = settings_cc600::FIELDS
        .iter()
        .map(|f| {
            let (kind, min, max, options) = match f.kind {
                FieldKind::OnOff => ("onOff", None, None, vec![]),
                FieldKind::Range { min, max } => ("range", Some(min), Some(max), vec![]),
                FieldKind::Choice(words) => ("choice", None, None, words.to_vec()),
                FieldKind::Tz => ("tz", None, None, vec![]),
                FieldKind::Sensor => ("sensor", None, None, vec![]),
            };
            Cc600FieldJs {
                key: f.key,
                kind,
                min,
                max,
                options,
            }
        })
        .collect();
    Ok(serde_wasm_bindgen::to_value(&fields)?)
}

/// Reads a CC600 settings file as the device does (defaults for what is
/// missing or invalid): `{ key: value }`, every key, values as text.
#[wasm_bindgen(js_name = cc600SettingsParse)]
pub fn cc600_settings_parse(text: &str) -> Result<JsValue, JsError> {
    let settings = settings_cc600::Settings::parse(text);
    let map: std::collections::BTreeMap<&str, String> = settings_cc600::KEYS
        .iter()
        .map(|&key| {
            let mut value = String::new();
            let _ = settings.get(key, &mut value);
            (key, value)
        })
        .collect();
    // A plain object, not a JS Map.
    Ok(map.serialize(&serde_wasm_bindgen::Serializer::json_compatible())?)
}

/// Applies `key=value` changes to a settings file, all or nothing, as the
/// device does. Returns the new file; throws the refused key.
#[wasm_bindgen(js_name = cc600SettingsApply)]
pub fn cc600_settings_apply(current: &str, changes: &str) -> Result<String, JsValue> {
    let settings = settings_cc600::Settings::parse(current)
        .apply(changes)
        .map_err(|(key, _)| JsValue::from_str(key))?;
    let mut out = String::new();
    settings
        .write(&mut out)
        .map_err(|_| JsValue::from_str(""))?;
    Ok(out)
}
