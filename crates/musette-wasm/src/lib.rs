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

/// Encode a CC600 protocol frame.
#[wasm_bindgen(js_name = cc600Encode)]
pub fn cc600_encode(op: u8, seq: u8, payload: &[u8]) -> Result<Vec<u8>, JsError> {
    musette_core::cc600_encode(op, seq, payload).map_err(js)
}

/// Decode one CC600 frame from the start of `bytes`.
/// Returns `undefined` if more bytes are needed.
#[wasm_bindgen(js_name = cc600Decode)]
pub fn cc600_decode(bytes: &[u8]) -> Result<JsValue, JsError> {
    match musette_core::cc600_decode(bytes).map_err(js)? {
        Some(f) => {
            let out = js_sys::Object::new();
            js_sys::Reflect::set(&out, &"op".into(), &f.op.into()).ok();
            js_sys::Reflect::set(&out, &"seq".into(), &f.seq.into()).ok();
            let payload = js_sys::Uint8Array::from(f.payload.as_slice());
            js_sys::Reflect::set(&out, &"payload".into(), &payload).ok();
            js_sys::Reflect::set(&out, &"consumed".into(), &f.consumed.into()).ok();
            Ok(out.into())
        }
        None => Ok(JsValue::UNDEFINED),
    }
}

/// The CC600 route file (`OCRT`) of a route. `eles` uses NaN for missing elevation.
#[wasm_bindgen(js_name = cc600BuildRoute)]
pub fn cc600_build_route(
    name: String,
    lats: Vec<f64>,
    lons: Vec<f64>,
    eles: Vec<f64>,
) -> Result<Vec<u8>, JsError> {
    musette_core::cc600_build_route(name, &lats, &lons, &eles).map_err(js)
}

/// `TransferBegin` payload for sending `bytes` as a file of `kind`
/// (1 route, 2 map): kind, size and CRC of the whole file.
#[wasm_bindgen(js_name = cc600TransferBegin)]
pub fn cc600_transfer_begin(kind: u8, bytes: &[u8]) -> Result<Vec<u8>, JsError> {
    musette_core::cc600_transfer_begin(kind, bytes).map_err(js)
}

/// `TransferChunk` payload: offset then the bytes.
#[wasm_bindgen(js_name = cc600TransferChunk)]
pub fn cc600_transfer_chunk(offset: u32, data: &[u8]) -> Vec<u8> {
    musette_core::cc600_transfer_chunk(offset, data)
}

/// App side of a file transfer: what to send next, given the device's answers.
#[wasm_bindgen(js_name = Cc600Sender)]
pub struct Cc600Sender(musette_core::Cc600Sender);

#[wasm_bindgen(js_class = Cc600Sender)]
impl Cc600Sender {
    #[wasm_bindgen(constructor)]
    pub fn new(size: u32) -> Self {
        Self(musette_core::Cc600Sender::new(size))
    }

    /// Applies a `TransferReady` payload; returns the offset to start from.
    pub fn ready(&mut self, payload: &[u8]) -> Result<u32, JsError> {
        self.0.ready(payload).map_err(js)
    }

    /// Applies a `TransferAck` payload.
    pub fn ack(&mut self, payload: &[u8]) -> Result<(), JsError> {
        self.0.ack(payload).map_err(js)
    }

    /// Applies a `TransferResend` payload.
    pub fn resend(&mut self, payload: &[u8]) -> Result<(), JsError> {
        self.0.resend(payload).map_err(js)
    }

    /// `[offset, length]` of the next chunk (at most `max` bytes), or
    /// `undefined` when the window is full or everything was sent.
    #[wasm_bindgen(js_name = nextChunk)]
    pub fn next_chunk(&mut self, max: u32) -> Option<Vec<u32>> {
        self.0.next_chunk(max).map(|(o, l)| vec![o, l])
    }

    /// Everything was sent and acknowledged.
    pub fn done(&self) -> bool {
        self.0.done()
    }

    /// Share of the file the device holds, 0..=1000.
    pub fn permille(&self) -> u32 {
        self.0.permille()
    }
}

/// Device side of a file transfer (simulated CC600, tests).
#[wasm_bindgen(js_name = Cc600Receiver)]
pub struct Cc600Receiver(musette_core::Cc600Receiver);

#[wasm_bindgen(js_class = Cc600Receiver)]
impl Cc600Receiver {
    #[wasm_bindgen(constructor)]
    pub fn new(window: u16, free: u32) -> Self {
        Self(musette_core::Cc600Receiver::new(window, free))
    }

    /// Handles a transfer request; returns the answer as `[op, ...payload]`,
    /// or `undefined` when there is none.
    pub fn handle(&mut self, op: u8, payload: &[u8]) -> Result<Option<Vec<u8>>, JsError> {
        self.0.handle(op, payload).map_err(js)
    }

    /// The link dropped: the partial file stays, as on the device.
    pub fn disconnect(&mut self) {
        self.0.disconnect();
    }

    /// Bytes of the partial file held so far.
    pub fn received(&self) -> u32 {
        self.0.received()
    }

    /// The last file committed by `TransferEnd`.
    pub fn committed(&self) -> Option<Vec<u8>> {
        self.0.committed()
    }
}

/// The CC600 settings and the values each takes (what the device accepts).
#[wasm_bindgen(js_name = cc600SettingsFields)]
pub fn cc600_settings_fields() -> Result<JsValue, JsError> {
    to_js(&musette_core::cc600_settings_fields())
}

/// Reads a CC600 settings file as the device does: `{ key: value }`, every
/// key, values as text.
#[wasm_bindgen(js_name = cc600SettingsParse)]
pub fn cc600_settings_parse(text: &str) -> Result<JsValue, JsError> {
    let map: std::collections::BTreeMap<&str, String> = musette_core::cc600_settings_parse(text)
        .into_iter()
        .collect();
    // A plain object, not a JS Map.
    Ok(map.serialize(&serde_wasm_bindgen::Serializer::json_compatible())?)
}

/// Applies `key=value` changes to a settings file, all or nothing, as the
/// device does. Returns the new file; throws an error whose message is the
/// refused key.
#[wasm_bindgen(js_name = cc600SettingsApply)]
pub fn cc600_settings_apply(current: &str, changes: &str) -> Result<String, JsError> {
    musette_core::cc600_settings_apply(current, changes).map_err(js)
}

/// One Bryton BLE connection: write what it returns (`{channel, bytes}`),
/// give it every notification (`onNotify`).
#[wasm_bindgen(js_name = BrytonSession)]
pub struct BrytonSession(musette_core::BrytonSession);

impl Default for BrytonSession {
    fn default() -> Self {
        Self::new()
    }
}

#[wasm_bindgen(js_class = BrytonSession)]
impl BrytonSession {
    #[wasm_bindgen(constructor)]
    pub fn new() -> Self {
        Self(musette_core::BrytonSession::new())
    }

    #[wasm_bindgen(js_name = readDeviceInfo)]
    pub fn read_device_info(&mut self) -> Result<JsValue, JsError> {
        to_js(&self.0.read_device_info())
    }

    #[wasm_bindgen(js_name = newApp)]
    pub fn new_app(&mut self) -> Result<JsValue, JsError> {
        to_js(&self.0.new_app())
    }

    #[wasm_bindgen(js_name = listRides)]
    pub fn list_rides(&mut self) -> Result<JsValue, JsError> {
        to_js(&self.0.list_rides())
    }

    pub fn download(&mut self, id: &str) -> Result<JsValue, JsError> {
        to_js(&self.0.download(id).map_err(js)?)
    }

    pub fn acknowledge(&mut self, id: &str) -> Result<JsValue, JsError> {
        to_js(&self.0.acknowledge(id).map_err(js)?)
    }

    #[wasm_bindgen(js_name = sendRoute)]
    pub fn send_route(&mut self, fit: &[u8], device_id: &str) -> Result<JsValue, JsError> {
        to_js(&self.0.send_route(fit, device_id))
    }

    #[wasm_bindgen(js_name = sendRouteName)]
    pub fn send_route_name(&mut self, name: &str) -> Result<JsValue, JsError> {
        to_js(&self.0.send_route_name(name))
    }

    #[wasm_bindgen(js_name = settingGet)]
    pub fn setting_get(&mut self, key: &str) -> Result<JsValue, JsError> {
        to_js(&self.0.setting_get(key).map_err(js)?)
    }

    #[wasm_bindgen(js_name = settingSet)]
    pub fn setting_set(&mut self, key: &str, value: f64) -> Result<JsValue, JsError> {
        to_js(&self.0.setting_set(key, value as i64).map_err(js)?)
    }

    /// `{writes, events}` for a notification from `channel` (0 command,
    /// 1 data, 2 setting).
    #[wasm_bindgen(js_name = onNotify)]
    pub fn on_notify(&mut self, channel: u8, bytes: &[u8]) -> Result<JsValue, JsError> {
        to_js(&self.0.on_notify(channel, bytes))
    }
}

/// A Bryton route file from track points. `eles` uses NaN for missing elevation.
#[wasm_bindgen(js_name = brytonBuildRoute)]
pub fn bryton_build_route(
    lats: Vec<f64>,
    lons: Vec<f64>,
    eles: Vec<f64>,
) -> Result<Vec<u8>, JsError> {
    musette_core::bryton_build_route(&lats, &lons, &eles).map_err(js)
}

/// The Bryton settings Musette reads.
#[wasm_bindgen(js_name = brytonSettingFields)]
pub fn bryton_setting_fields() -> Result<JsValue, JsError> {
    to_js(&musette_core::bryton_setting_fields())
}

/// Decodes the answer to the get of `key`; `undefined` if it is not one.
#[wasm_bindgen(js_name = brytonSettingValue)]
pub fn bryton_setting_value(key: &str, frame: &[u8]) -> Result<JsValue, JsError> {
    match musette_core::bryton_setting_value(key, frame) {
        Some(v) => to_js(&v),
        None => Ok(JsValue::UNDEFINED),
    }
}
