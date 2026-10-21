//! WebAssembly bindings of `musette-core`, for the web build of the app.
//! Types only: the logic is in `musette-core`, shared with `musette-ffi`.
//!
//! Build: `wasm-pack build crates/musette-wasm --target web --out-dir ../../app/src/lib/core/wasm`

use serde::Serialize;
use wasm_bindgen::prelude::*;

fn js(e: musette_core::Error) -> JsError {
    JsError::new(&e.0)
}

fn to_js<T: Serialize>(value: &T) -> Result<JsValue, JsError> {
    Ok(serde_wasm_bindgen::to_value(value)?)
}

/// Analyse a route. `eles` uses NaN for missing elevation.
#[wasm_bindgen(js_name = analyzeRoute)]
pub fn analyze_route(lats: Vec<f64>, lons: Vec<f64>, eles: Vec<f64>) -> Result<JsValue, JsError> {
    to_js(&musette_core::analyze_route(&lats, &lons, &eles).map_err(js)?)
}

/// Read a GPX file; throws `noPoints` or `badPoint`.
#[wasm_bindgen(js_name = parseGpx)]
pub fn parse_gpx(text: &str) -> Result<JsValue, JsError> {
    let route = musette_core::parse_gpx(text).map_err(js)?;
    // NaN is not JSON: elevations go as a Float64Array.
    let out = js_sys::Object::new();
    js_sys::Reflect::set(&out, &"name".into(), &route.name.into()).ok();
    for (key, values) in [
        ("lats", route.lats),
        ("lons", route.lons),
        ("eles", route.eles),
    ] {
        let array = js_sys::Float64Array::from(values.as_slice());
        js_sys::Reflect::set(&out, &key.into(), &array).ok();
    }
    Ok(out.into())
}

/// Throws if the FIT file is truncated or corrupted.
#[wasm_bindgen(js_name = verifyFit)]
pub fn verify_fit(bytes: &[u8]) -> Result<u32, JsError> {
    musette_core::verify_fit(bytes).map_err(js)
}

/// Pick activity files from a Bryton drive listing.
#[wasm_bindgen(js_name = brytonFindActivities)]
pub fn bryton_find_activities(paths: Vec<String>, sizes: Vec<f64>) -> Result<JsValue, JsError> {
    to_js(&musette_core::bryton_find_activities(paths, &sizes))
}

fn link(name: &str) -> Result<musette_core::Link, JsError> {
    match name {
        "ble" => Ok(musette_core::Link::Ble),
        "usbFiles" => Ok(musette_core::Link::UsbFiles),
        _ => Err(JsError::new(&format!("unknown link {name}"))),
    }
}

/// What a model can do over a link (`ble` or `usbFiles`).
#[wasm_bindgen]
pub fn capabilities(model: &str, link_name: &str) -> Result<JsValue, JsError> {
    let model = musette_core::model(model).map_err(js)?;
    to_js(&musette_core::capabilities(model, link(link_name)?))
}

/// The settings of a model and what each takes.
#[wasm_bindgen(js_name = settingFields)]
pub fn setting_fields(model: &str) -> Result<JsValue, JsError> {
    let model = musette_core::model(model).map_err(js)?;
    to_js(&musette_core::setting_fields(model))
}

/// One connection to a device (`musette_core::Session`): every request and
/// notification gives a step `{subscribe, writes, progress, waitMs, outcome}`.
#[wasm_bindgen(js_name = Session)]
pub struct Session(musette_core::Session);

#[wasm_bindgen(js_class = Session)]
impl Session {
    /// The model's own timing, unless given (tests).
    #[wasm_bindgen(constructor)]
    pub fn new(
        model: &str,
        request_ms: Option<u32>,
        short_ms: Option<u32>,
    ) -> Result<Session, JsError> {
        let model = musette_core::model(model).map_err(js)?;
        let t = musette_core::Timing::of(model);
        let timing = musette_core::Timing {
            request_ms: request_ms.unwrap_or(t.request_ms),
            short_ms: short_ms.unwrap_or(t.short_ms),
        };
        Ok(Self(musette_core::Session::new(model, timing)))
    }

    pub fn channels(&self) -> Result<JsValue, JsError> {
        to_js(&self.0.channels())
    }

    pub fn connect(&mut self) -> Result<JsValue, JsError> {
        to_js(&self.0.connect().map_err(js)?)
    }

    #[wasm_bindgen(js_name = listActivities)]
    pub fn list_activities(&mut self) -> Result<JsValue, JsError> {
        to_js(&self.0.list_activities().map_err(js)?)
    }

    pub fn download(&mut self, id: &str, size: Option<f64>) -> Result<JsValue, JsError> {
        to_js(&self.0.download(id, size.map(|s| s as u64)).map_err(js)?)
    }

    pub fn acknowledge(&mut self, id: &str) -> Result<JsValue, JsError> {
        to_js(&self.0.acknowledge(id).map_err(js)?)
    }

    /// `eles` uses NaN for missing elevation.
    #[wasm_bindgen(js_name = sendRoute)]
    pub fn send_route(
        &mut self,
        name: String,
        lats: Vec<f64>,
        lons: Vec<f64>,
        eles: Vec<f64>,
    ) -> Result<JsValue, JsError> {
        let route = musette_core::ParsedRoute {
            name,
            lats,
            lons,
            eles,
        };
        to_js(&self.0.send_route(&route).map_err(js)?)
    }

    /// `kind`: `route` or `map`.
    #[wasm_bindgen(js_name = sendFile)]
    pub fn send_file(&mut self, kind: &str, bytes: Vec<u8>) -> Result<JsValue, JsError> {
        let kind = match kind {
            "route" => musette_core::FileKind::Route,
            "map" => musette_core::FileKind::Map,
            _ => return Err(JsError::new(&format!("unknown file kind {kind}"))),
        };
        to_js(&self.0.send_file(kind, bytes).map_err(js)?)
    }

    #[wasm_bindgen(js_name = readSettings)]
    pub fn read_settings(&mut self) -> Result<JsValue, JsError> {
        to_js(&self.0.read_settings().map_err(js)?)
    }

    /// The changes as three arrays of the same length; NaN: no number.
    #[wasm_bindgen(js_name = writeSettings)]
    pub fn write_settings(
        &mut self,
        keys: Vec<String>,
        numbers: Vec<f64>,
        texts: Vec<String>,
    ) -> Result<JsValue, JsError> {
        let changes: Vec<musette_core::Setting> = keys
            .into_iter()
            .zip(numbers)
            .zip(texts)
            .map(|((key, n), text)| musette_core::Setting {
                key,
                number: (!n.is_nan()).then_some(n),
                text,
            })
            .collect();
        to_js(&self.0.write_settings(&changes).map_err(js)?)
    }

    #[wasm_bindgen(js_name = onNotify)]
    pub fn on_notify(&mut self, channel: u8, bytes: &[u8]) -> Result<JsValue, JsError> {
        to_js(&self.0.on_notify(channel, bytes))
    }

    #[wasm_bindgen(js_name = onTimeout)]
    pub fn on_timeout(&mut self) -> Result<JsValue, JsError> {
        to_js(&self.0.on_timeout())
    }
}

/// A CC600 in memory (demo without a device, tests).
#[wasm_bindgen(js_name = Cc600Simulator)]
pub struct Cc600Simulator(musette_core::Cc600Simulator);

#[wasm_bindgen(js_class = Cc600Simulator)]
impl Cc600Simulator {
    #[wasm_bindgen(constructor)]
    pub fn new(
        window: u16,
        free: u32,
        settings: String,
        lose_chunks: Vec<u32>,
        lose_acks: Vec<u32>,
    ) -> Self {
        Self(musette_core::Cc600Simulator::new(
            window,
            free,
            settings,
            lose_chunks,
            lose_acks,
        ))
    }

    /// `start_time` in Unix seconds.
    #[wasm_bindgen(js_name = addActivity)]
    pub fn add_activity(&mut self, id: u32, start_time: f64, fit: Vec<u8>) {
        self.0.add_activity(id, start_time as i64, fit);
    }

    /// The frames the device answers, as `Uint8Array`s.
    pub fn write(&mut self, bytes: &[u8]) -> js_sys::Array {
        self.0
            .write(bytes)
            .iter()
            .map(|f| js_sys::Uint8Array::from(f.as_slice()))
            .collect()
    }

    pub fn disconnect(&mut self) {
        self.0.disconnect();
    }

    pub fn received(&self) -> u32 {
        self.0.received()
    }

    pub fn committed(&self) -> Option<Vec<u8>> {
        self.0.committed()
    }

    #[wasm_bindgen(js_name = chunkBytes)]
    pub fn chunk_bytes(&self) -> u32 {
        self.0.chunk_bytes()
    }

    pub fn acked(&self) -> Vec<u32> {
        self.0.acked()
    }

    pub fn settings(&self) -> String {
        self.0.settings()
    }

    #[wasm_bindgen(js_name = settingsWrites)]
    pub fn settings_writes(&self) -> Vec<String> {
        self.0.settings_writes()
    }
}
