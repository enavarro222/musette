//! What the Musette app asks of the Rust crates, as plain Rust.
//!
//! The same for every host: `musette-wasm` (web) and `musette-ffi` (iOS,
//! Android) only convert types. Keep the logic here, so that both apps behave
//! the same.

#[cfg(feature = "serde")]
use serde::Serialize;

/// An error for the app: the message is shown as is (or mapped by the app).
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Error(pub String);

impl core::fmt::Display for Error {
    fn fmt(&self, f: &mut core::fmt::Formatter<'_>) -> core::fmt::Result {
        f.write_str(&self.0)
    }
}

impl std::error::Error for Error {}

fn error(msg: impl Into<String>) -> Error {
    Error(msg.into())
}

pub type Result<T> = core::result::Result<T, Error>;

// ---- routes ------------------------------------------------------------

#[derive(Clone, Debug, PartialEq)]
#[cfg_attr(feature = "serde", derive(Serialize), serde(rename_all = "camelCase"))]
pub struct Climb {
    pub start_m: f64,
    pub end_m: f64,
    pub gain_m: f64,
    pub avg_grade: f64,
    pub max_grade: f64,
    /// `uncategorized`, `4`, `3`, `2`, `1` or `HC`.
    pub category: &'static str,
}

#[derive(Clone, Debug, PartialEq)]
#[cfg_attr(feature = "serde", derive(Serialize), serde(rename_all = "camelCase"))]
pub struct RouteAnalysis {
    pub distance_m: f64,
    pub ascent_m: f64,
    pub profile_step_m: f64,
    pub profile: Vec<f64>,
    pub climbs: Vec<Climb>,
    /// Indices of points kept after simplification (5 m tolerance).
    pub simplified: Vec<u32>,
    /// Distance from the start at each `simplified` point, metres (to place climbs on a map).
    pub simplified_m: Vec<f64>,
}

fn check_lengths(lats: &[f64], lons: &[f64], eles: &[f64]) -> Result<()> {
    if lats.len() != lons.len() || lats.len() != eles.len() {
        return Err(error("lats, lons and eles must have the same length"));
    }
    Ok(())
}

/// Track points from the app's arrays; `eles` uses NaN when unknown.
fn to_points(lats: &[f64], lons: &[f64], eles: &[f64]) -> Result<Vec<track::Point>> {
    check_lengths(lats, lons, eles)?;
    Ok(lats
        .iter()
        .zip(lons)
        .zip(eles)
        .map(|((&lat, &lon), &e)| track::Point::new(lat, lon, (!e.is_nan()).then_some(e)))
        .collect())
}

/// Analyse a route. `eles` uses NaN for missing elevation.
pub fn analyze_route(lats: &[f64], lons: &[f64], eles: &[f64]) -> Result<RouteAnalysis> {
    let points = to_points(lats, lons, eles)?;

    let cumulative = track::cumulative_distance(&points);
    let distance_m = cumulative.last().copied().unwrap_or(0.0);
    let kept = track::simplify(&points, 5.0);
    let simplified_m = kept.iter().map(|&i| cumulative[i]).collect();
    let simplified = kept.into_iter().map(|i| i as u32).collect();

    let (profile_step_m, profile, ascent_m, climbs) = match track::profile(&points, 20.0) {
        Some(p) => {
            let climbs = climbs::detect(&p, &climbs::Params::default())
                .into_iter()
                .map(|c| Climb {
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

    Ok(RouteAnalysis {
        distance_m,
        ascent_m,
        profile_step_m,
        profile,
        climbs,
        simplified,
        simplified_m,
    })
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

/// A route read from a GPX file, device-neutral.
#[derive(Clone, Debug, PartialEq)]
#[cfg_attr(feature = "serde", derive(Serialize))]
pub struct ParsedRoute {
    pub name: String,
    pub lats: Vec<f64>,
    pub lons: Vec<f64>,
    /// NaN where elevation is missing.
    pub eles: Vec<f64>,
}

/// Reads a GPX file (track points, else route points). The error is the
/// reason, for the app to word: `noPoints` or `badPoint`.
pub fn parse_gpx(text: &str) -> Result<ParsedRoute> {
    let gpx = route_cc600::parse_gpx(text).map_err(|e| match e {
        route_cc600::GpxError::NoPoints => error("noPoints"),
        route_cc600::GpxError::BadPoint => error("badPoint"),
    })?;
    let name = match gpx.name.trim() {
        "" => "Trace".to_owned(),
        name => name.to_owned(),
    };
    Ok(ParsedRoute {
        name,
        lats: gpx.points.iter().map(|p| p.0).collect(),
        lons: gpx.points.iter().map(|p| p.1).collect(),
        eles: gpx.points.iter().map(|p| p.2.unwrap_or(f64::NAN)).collect(),
    })
}

// ---- rides -------------------------------------------------------------

/// Checks that a FIT file is whole (header and CRC); returns its data size.
pub fn verify_fit(bytes: &[u8]) -> Result<u32> {
    fit::verify(bytes)
        .map(|h| h.data_size)
        .map_err(|e| error(format!("{e:?}")))
}

#[derive(Clone, Debug, PartialEq, Eq)]
#[cfg_attr(feature = "serde", derive(Serialize))]
pub struct ActivityRef {
    pub id: String,
    pub size: Option<u64>,
}

/// Pick activity files from a Bryton drive listing.
pub fn bryton_find_activities(paths: Vec<String>, sizes: &[f64]) -> Vec<ActivityRef> {
    let files: Vec<driver_bryton::DriveFile> = paths
        .into_iter()
        .zip(sizes)
        .map(|(path, &size)| driver_bryton::DriveFile {
            path,
            size: size as u64,
        })
        .collect();
    driver_bryton::find_activities(&files)
        .into_iter()
        .map(|a| ActivityRef {
            id: a.id,
            size: a.size,
        })
        .collect()
}

// ---- Bryton over BLE ------------------------------------------------------

use driver_bryton::ble as bryton;

/// Characteristics a [`BrytonWrite`] goes to, and a notification comes from.
pub const BRYTON_COMMAND: u8 = 0;
pub const BRYTON_DATA: u8 = 1;
pub const BRYTON_SETTING: u8 = 2;

fn channel_id(c: bryton::Channel) -> u8 {
    match c {
        bryton::Channel::Command => BRYTON_COMMAND,
        bryton::Channel::Data => BRYTON_DATA,
        bryton::Channel::Setting => BRYTON_SETTING,
    }
}

/// Bytes to write to a Bryton characteristic ([`BRYTON_COMMAND`]...). The
/// data channel is written without response, the others with.
#[derive(Clone, Debug, PartialEq, Eq)]
#[cfg_attr(feature = "serde", derive(Serialize), serde(rename_all = "camelCase"))]
pub struct BrytonWrite {
    pub channel: u8,
    pub bytes: Vec<u8>,
}

impl From<bryton::Write> for BrytonWrite {
    fn from(w: bryton::Write) -> Self {
        Self {
            channel: channel_id(w.channel),
            bytes: w.bytes,
        }
    }
}

/// A ride in the device's "not synced" list.
#[derive(Clone, Debug, PartialEq, Eq)]
#[cfg_attr(feature = "serde", derive(Serialize), serde(rename_all = "camelCase"))]
pub struct BrytonRide {
    /// `yyMMddHHmmss`: also the ride's file name over USB.
    pub id: String,
    pub time_s: u32,
    pub distance_m: u32,
    pub sport: u8,
}

#[derive(Clone, Debug, PartialEq, Eq)]
#[cfg_attr(feature = "serde", derive(Serialize), serde(rename_all = "camelCase"))]
pub struct BrytonInfo {
    /// `UD`: the first 4 digits are the product code (1902: Rider 750).
    pub id: String,
    pub firmware: String,
    pub model: String,
    /// The device is recording a ride.
    pub recording: bool,
    /// It has the setting channel (needed for settings, acknowledgement and
    /// routes).
    pub settings: bool,
}

/// What happened, from [`BrytonSession::on_notify`]. One struct for every
/// kind, so that WASM and UniFFI carry it the same way; `kind` says which
/// fields count.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
#[cfg_attr(feature = "serde", derive(Serialize), serde(rename_all = "camelCase"))]
pub struct BrytonEvent {
    /// `info`, `ready` (handshake), `rides`, `progress`, `file`, `sent`,
    /// `routeNamed`, `settingAck`, `setting`, `failed`.
    pub kind: &'static str,
    /// `failed`: what failed, in English (the app maps it).
    pub message: String,
    /// `file`: the ride. `setting`: the whole setting frame.
    pub bytes: Vec<u8>,
    /// `progress`: bytes done and total.
    pub done: u32,
    pub total: u32,
    /// `settingAck`, `setting`: the setting command; `settingAck`: its status
    /// (10 = ok).
    pub cmd: u8,
    pub status: u8,
    pub rides: Vec<BrytonRide>,
    pub info: Option<BrytonInfo>,
}

impl BrytonEvent {
    fn new(kind: &'static str) -> Self {
        Self {
            kind,
            ..Self::default()
        }
    }
}

fn failure_text(f: &bryton::Failure) -> String {
    match f {
        bryton::Failure::Status { cmd, status } => format!("cmd {cmd}: status {status}"),
        bryton::Failure::Action { cmd, code } => format!("cmd {cmd}: action {code}"),
        bryton::Failure::BadSum { cmd } => format!("cmd {cmd}: bad checksum"),
        bryton::Failure::Missing { cmd } => format!("cmd {cmd}: frames missing"),
        bryton::Failure::Empty { cmd } => format!("cmd {cmd}: no data"),
        bryton::Failure::Size { expected, got } => format!("expected {expected} bytes, got {got}"),
    }
}

fn bryton_event(e: bryton::Event) -> BrytonEvent {
    match e {
        bryton::Event::DeviceInfo(i) => BrytonEvent {
            info: Some(BrytonInfo {
                settings: i.has(bryton::cp::SETTING),
                recording: i.recording(),
                id: i.id.unwrap_or_default(),
                firmware: i.firmware.unwrap_or_default(),
                model: i.model.unwrap_or_default(),
            }),
            ..BrytonEvent::new("info")
        },
        bryton::Event::Handshake(_) => BrytonEvent::new("ready"),
        bryton::Event::Activities(list) => BrytonEvent {
            rides: list
                .iter()
                .map(|e| BrytonRide {
                    id: e.name(),
                    time_s: e.activity_time,
                    distance_m: e.activity_dist,
                    sport: e.sport_type,
                })
                .collect(),
            ..BrytonEvent::new("rides")
        },
        bryton::Event::Progress { done, total } => BrytonEvent {
            done,
            total,
            ..BrytonEvent::new("progress")
        },
        bryton::Event::File { bytes, .. } => BrytonEvent {
            bytes,
            ..BrytonEvent::new("file")
        },
        bryton::Event::Sent { .. } => BrytonEvent::new("sent"),
        bryton::Event::RouteNamed => BrytonEvent::new("routeNamed"),
        bryton::Event::SettingAck { cmd, status } => BrytonEvent {
            cmd,
            status,
            ..BrytonEvent::new("settingAck")
        },
        bryton::Event::Setting(frame) => BrytonEvent {
            cmd: frame.first().copied().unwrap_or(0),
            bytes: frame,
            ..BrytonEvent::new("setting")
        },
        bryton::Event::Failed(f) => BrytonEvent {
            message: failure_text(&f),
            ..BrytonEvent::new("failed")
        },
    }
}

#[derive(Clone, Debug, Default, PartialEq, Eq)]
#[cfg_attr(feature = "serde", derive(Serialize), serde(rename_all = "camelCase"))]
pub struct BrytonStep {
    /// Write them in order.
    pub writes: Vec<BrytonWrite>,
    pub events: Vec<BrytonEvent>,
}

fn ride_id(id: &str) -> Result<u32> {
    bryton::file_id_from_name(id).ok_or_else(|| error(format!("not a Bryton ride id: {id}")))
}

/// One Bryton BLE connection (`driver_bryton::ble::Session`): the app
/// writes what it returns and gives it every notification.
pub struct BrytonSession(bryton::Session);

impl Default for BrytonSession {
    fn default() -> Self {
        Self::new()
    }
}

impl BrytonSession {
    pub fn new() -> Self {
        Self(bryton::Session::new(bryton::Config::default()))
    }

    /// First request after subscribing to the command and data channels.
    pub fn read_device_info(&mut self) -> BrytonWrite {
        self.0.read_device_info().into()
    }

    /// Once subscribed to the setting channel: the device answers with the
    /// handshake (event `ready`).
    pub fn new_app(&mut self) -> BrytonWrite {
        self.0.new_app().into()
    }

    /// The rides not synced yet (event `rides`).
    pub fn list_rides(&mut self) -> BrytonWrite {
        self.0.list_activities(bryton::ListType::Unsynced).into()
    }

    /// Downloads a ride by id (events `progress`, then `file`).
    pub fn download(&mut self, id: &str) -> Result<BrytonWrite> {
        Ok(self.0.download(ride_id(id)?).into())
    }

    /// The ride is stored: it leaves the "not synced" list (event
    /// `settingAck` with cmd 51).
    pub fn acknowledge(&mut self, id: &str) -> Result<BrytonWrite> {
        Ok(self.0.acknowledge(ride_id(id)?).into())
    }

    /// Sends a route file from [`bryton_build_route`] (events `progress`,
    /// then `sent`); `device_id` is [`BrytonInfo::id`] (it tells whether the
    /// device wants the file compressed). Then send its name.
    pub fn send_route(&mut self, fit: &[u8], device_id: &str) -> BrytonWrite {
        let payload = if bryton::compresses_routes(device_id) {
            bryton::gzip(fit)
        } else {
            fit.to_vec()
        };
        self.0
            .send_file(bryton::FILE_TYPE_PLAN_TRIP, &payload)
            .into()
    }

    /// The route's name: the device then imports it (event `routeNamed`).
    pub fn send_route_name(&mut self, name: &str) -> BrytonWrite {
        self.0.send_route_name(name).into()
    }

    /// Reads a setting (event `setting` with its cmd; decode it with
    /// [`bryton_setting_value`]).
    pub fn setting_get(&mut self, key: &str) -> Result<BrytonWrite> {
        let f = driver_bryton::settings::fields()
            .into_iter()
            .find(|f| f.key == key)
            .ok_or_else(|| error(format!("unknown setting {key}")))?;
        Ok(self.0.setting_get(f.cmd, f.args).into())
    }

    /// Changes a setting (event `settingAck`, status 10 when done).
    pub fn setting_set(&mut self, key: &str, value: i64) -> Result<BrytonWrite> {
        let (cmd, payload) = driver_bryton::settings::encode(key, value)
            .ok_or_else(|| error(format!("{key} cannot be set to {value}")))?;
        Ok(self.0.setting_set(cmd, &payload).into())
    }

    /// A notification from a characteristic ([`BRYTON_COMMAND`]...).
    pub fn on_notify(&mut self, channel: u8, bytes: &[u8]) -> BrytonStep {
        let step = match channel {
            BRYTON_COMMAND => self.0.on_command(bytes),
            BRYTON_DATA => self.0.on_data(bytes),
            BRYTON_SETTING => self.0.on_setting(bytes),
            _ => return BrytonStep::default(),
        };
        BrytonStep {
            writes: step.writes.into_iter().map(Into::into).collect(),
            events: step.events.into_iter().map(bryton_event).collect(),
        }
    }
}

/// A route file for a Bryton (its own FIT messages) from track points, start
/// and arrival turns only; `eles` uses NaN when unknown. Points are kept
/// within 5 m of the track.
pub fn bryton_build_route(lats: &[f64], lons: &[f64], eles: &[f64]) -> Result<Vec<u8>> {
    let points = to_points(lats, lons, eles)?;
    let keep = track::simplify(&points, 5.0);
    let kept: Vec<track::Point> = keep.into_iter().map(|i| points[i]).collect();
    // 16 km/h for the turn durations, as the app's routes.
    driver_bryton::route::Route::from_track(&kept, 16.0 / 3.6)
        .encode()
        .map_err(|e| error(format!("{e:?}")))
}

/// A Bryton setting as `driver_bryton::settings` describes it.
#[derive(Clone, Debug, PartialEq, Eq)]
#[cfg_attr(feature = "serde", derive(Serialize), serde(rename_all = "camelCase"))]
pub struct BrytonField {
    /// `user.height`, `bike0.auto_pause`... (bike slots 0-2 are the
    /// device's `Bike1-3Profile.ini`).
    pub key: String,
    /// `bool`, `choice`, `number` or `text`.
    pub kind: &'static str,
    /// `choice`: the labels, indexed by value (English; the app has its own).
    pub choices: Vec<String>,
    /// [`BrytonSession::setting_set`] accepts it.
    pub writable: bool,
}

/// Every setting Musette reads from a Bryton.
pub fn bryton_setting_fields() -> Vec<BrytonField> {
    use driver_bryton::settings::{encode, fields, Kind};
    fields()
        .into_iter()
        .map(|f| BrytonField {
            key: f.key.to_owned(),
            kind: match f.kind {
                Kind::Bool => "bool",
                Kind::Choice => "choice",
                Kind::Number => "number",
                Kind::Text => "text",
            },
            choices: f.choices.iter().map(|c| (*c).to_owned()).collect(),
            writable: encode(f.key, 0).is_some(),
        })
        .collect()
}

/// A setting value: `number` for bool (0/1), choice and number; `text` for
/// the others (and a readable form of every value).
#[derive(Clone, Debug, PartialEq)]
#[cfg_attr(feature = "serde", derive(Serialize), serde(rename_all = "camelCase"))]
pub struct BrytonValue {
    pub number: Option<f64>,
    pub text: String,
}

/// Decodes the device's answer (a `setting` event's bytes) to the get of `key`.
pub fn bryton_setting_value(key: &str, frame: &[u8]) -> Option<BrytonValue> {
    use driver_bryton::settings::{answer_payload, fields, Value};
    let f = fields().into_iter().find(|f| f.key == key)?;
    let v = (f.decode)(answer_payload(f.cmd, frame)?)?;
    let number = match &v {
        Value::Bool(b) => Some(*b as u8 as f64),
        Value::Int(i) => Some(*i as f64),
        Value::Pair { metric, .. } => Some(*metric as f64),
        _ => None,
    };
    Some(BrytonValue {
        number,
        text: match &v {
            Value::Text(t) => t.clone(),
            _ => f.show(&v),
        },
    })
}

// ---- CC600 frames --------------------------------------------------------

/// Encode a CC600 protocol frame.
pub fn cc600_encode(op: u8, seq: u8, payload: &[u8]) -> Result<Vec<u8>> {
    let op = protocol_cc600::Op::from_u8(op).ok_or_else(|| error("unknown op"))?;
    let frame = protocol_cc600::Frame::new(op, seq, payload);
    let mut buf = vec![0u8; frame.encoded_len()];
    frame
        .encode(&mut buf)
        .map_err(|e| error(format!("{e:?}")))?;
    Ok(buf)
}

#[derive(Clone, Debug, PartialEq, Eq)]
#[cfg_attr(feature = "serde", derive(Serialize))]
pub struct DecodedFrame {
    pub op: u8,
    pub seq: u8,
    pub payload: Vec<u8>,
    pub consumed: u32,
}

/// Decode one CC600 frame from the start of `bytes`; `None` if more bytes are
/// needed.
pub fn cc600_decode(bytes: &[u8]) -> Result<Option<DecodedFrame>> {
    match protocol_cc600::Frame::decode(bytes) {
        Ok((f, consumed)) => Ok(Some(DecodedFrame {
            op: f.op as u8,
            seq: f.seq,
            payload: f.payload.to_vec(),
            consumed: consumed as u32,
        })),
        Err(protocol_cc600::Error::Incomplete { .. }) => Ok(None),
        Err(e) => Err(error(format!("{e:?}"))),
    }
}

/// Simplification of the CC600 route line, metres (as the firmware's route tool).
const CC600_ROUTE_TOLERANCE_M: f64 = 3.0;

/// The CC600 route file (`OCRT`) of a route. `eles` uses NaN for missing elevation.
pub fn cc600_build_route(
    name: String,
    lats: &[f64],
    lons: &[f64],
    eles: &[f64],
) -> Result<Vec<u8>> {
    check_lengths(lats, lons, eles)?;
    if lats.len() < 2 {
        return Err(error("a route needs at least 2 points"));
    }
    let gpx = route_cc600::Gpx {
        name,
        points: lats
            .iter()
            .zip(lons)
            .zip(eles)
            .map(|((&lat, &lon), &e)| (lat, lon, (!e.is_nan()).then_some(e)))
            .collect(),
        times: vec![None; lats.len()],
    };
    Ok(route_cc600::build(&gpx, CC600_ROUTE_TOLERANCE_M))
}

// ---- CC600 file transfer -----------------------------------------------

/// `TransferBegin` payload for sending `bytes` as a file of `kind`
/// (1 route, 2 map): kind, size and CRC of the whole file.
pub fn cc600_transfer_begin(kind: u8, bytes: &[u8]) -> Result<Vec<u8>> {
    use protocol_cc600::transfer::{Begin, Kind};
    let kind = Kind::from_u8(kind).ok_or_else(|| error("unknown file kind"))?;
    let size = u32::try_from(bytes.len()).map_err(|_| error("file too large"))?;
    let crc = protocol_cc600::crc16_ccitt(bytes);
    Ok(Begin { kind, size, crc }.to_bytes().to_vec())
}

/// `TransferChunk` payload: offset then the bytes.
pub fn cc600_transfer_chunk(offset: u32, data: &[u8]) -> Vec<u8> {
    let mut out = protocol_cc600::transfer::chunk_header(offset).to_vec();
    out.extend_from_slice(data);
    out
}

/// App side of a file transfer: what to send next, given the device's answers.
pub struct Cc600Sender(protocol_cc600::transfer::Sender);

impl Cc600Sender {
    pub fn new(size: u32) -> Self {
        Self(protocol_cc600::transfer::Sender::new(size))
    }

    /// Applies a `TransferReady` payload; returns the offset to start from.
    pub fn ready(&mut self, payload: &[u8]) -> Result<u32> {
        let ready = protocol_cc600::transfer::Ready::from_bytes(payload)
            .ok_or_else(|| error("bad TransferReady"))?;
        self.0.ready(ready);
        Ok(ready.next)
    }

    /// Applies a `TransferAck` payload.
    pub fn ack(&mut self, payload: &[u8]) -> Result<()> {
        let ack = protocol_cc600::transfer::Ack::from_bytes(payload)
            .ok_or_else(|| error("bad TransferAck"))?;
        self.0.ack(ack);
        Ok(())
    }

    /// Applies a `TransferResend` payload.
    pub fn resend(&mut self, payload: &[u8]) -> Result<()> {
        let ack = protocol_cc600::transfer::Ack::from_bytes(payload)
            .ok_or_else(|| error("bad TransferResend"))?;
        self.0.resend(ack);
        Ok(())
    }

    /// `(offset, length)` of the next chunk (at most `max` bytes), or `None`
    /// when the window is full or everything was sent.
    pub fn next_chunk(&mut self, max: u32) -> Option<(u32, u32)> {
        self.0.next_chunk(max)
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
pub struct Cc600Receiver {
    rx: protocol_cc600::transfer::Receiver,
    free: u32,
    partial: Option<protocol_cc600::transfer::Partial>,
    data: Vec<u8>,
    committed: Option<Vec<u8>>,
}

impl Cc600Receiver {
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
    /// or `None` when there is none.
    pub fn handle(&mut self, op: u8, payload: &[u8]) -> Result<Option<Vec<u8>>> {
        use protocol_cc600::transfer::{parse_chunk, Begin, Chunk, ErrorCode};
        use protocol_cc600::Op;
        let reply = |op: Op, p: &[u8]| Some([&[op as u8], p].concat());
        let fail = |code: ErrorCode| reply(Op::Error, &[code as u8]);
        let op = Op::from_u8(op).ok_or_else(|| error("unknown op"))?;
        Ok(match op {
            Op::TransferBegin => {
                let Some(begin) = Begin::from_bytes(payload) else {
                    return Ok(fail(ErrorCode::BadRequest));
                };
                match self.rx.begin(begin, self.partial, self.free) {
                    Ok(ready) => {
                        self.data.truncate(ready.next as usize);
                        self.partial = self.rx.progress();
                        reply(Op::TransferReady, &ready.to_bytes())
                    }
                    Err(code) => fail(code),
                }
            }
            Op::TransferChunk => {
                let Some((offset, bytes)) = parse_chunk(payload) else {
                    return Ok(fail(ErrorCode::BadRequest));
                };
                match self.rx.chunk(offset, bytes) {
                    Ok(Chunk::Accept(ack)) => {
                        self.data.extend_from_slice(bytes);
                        self.partial = self.rx.progress();
                        ack.and_then(|a| reply(Op::TransferAck, &a.to_bytes()))
                    }
                    Ok(Chunk::Resend(a)) => reply(Op::TransferResend, &a.to_bytes()),
                    Ok(Chunk::Ignore) => None,
                    Err(code) => fail(code),
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
                    fail(code)
                }
            },
            Op::TransferAbort => {
                self.rx.abort();
                reply(Op::Ok, &[])
            }
            _ => return Err(error("not a transfer request")),
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

// ---- CC600 settings ----------------------------------------------------

#[derive(Clone, Debug, PartialEq, Eq)]
#[cfg_attr(feature = "serde", derive(Serialize))]
pub struct Cc600Field {
    pub key: &'static str,
    /// `onOff`, `range`, `choice`, `tz` or `sensor`.
    pub kind: &'static str,
    pub min: Option<u8>,
    pub max: Option<u8>,
    pub options: Vec<&'static str>,
}

/// The CC600 settings and the values each takes (what the device accepts).
pub fn cc600_settings_fields() -> Vec<Cc600Field> {
    use settings_cc600::FieldKind;
    settings_cc600::FIELDS
        .iter()
        .map(|f| {
            let (kind, min, max, options) = match f.kind {
                FieldKind::OnOff => ("onOff", None, None, vec![]),
                FieldKind::Range { min, max } => ("range", Some(min), Some(max), vec![]),
                FieldKind::Choice(words) => ("choice", None, None, words.to_vec()),
                FieldKind::Tz => ("tz", None, None, vec![]),
                FieldKind::Sensor => ("sensor", None, None, vec![]),
            };
            Cc600Field {
                key: f.key,
                kind,
                min,
                max,
                options,
            }
        })
        .collect()
}

/// Reads a CC600 settings file as the device does (defaults for what is
/// missing or invalid): every key, values as text.
pub fn cc600_settings_parse(text: &str) -> Vec<(&'static str, String)> {
    let settings = settings_cc600::Settings::parse(text);
    settings_cc600::KEYS
        .iter()
        .map(|&key| {
            let mut value = String::new();
            let _ = settings.get(key, &mut value);
            (key, value)
        })
        .collect()
}

/// Applies `key=value` changes to a settings file, all or nothing, as the
/// device does. Returns the new file; the error is the refused key.
pub fn cc600_settings_apply(current: &str, changes: &str) -> Result<String> {
    let settings = settings_cc600::Settings::parse(current)
        .apply(changes)
        .map_err(|(key, _)| error(key))?;
    let mut out = String::new();
    settings.write(&mut out).map_err(|_| error(""))?;
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn frame_round_trip() {
        let frame = cc600_encode(0x01, 7, &[1, 2, 3]).unwrap();
        assert_eq!(frame, [1, 1, 7, 3, 0, 1, 2, 3, 46, 137]);
        let f = cc600_decode(&frame).unwrap().unwrap();
        assert_eq!(
            (f.op, f.seq, f.payload, f.consumed),
            (1, 7, vec![1, 2, 3], 10)
        );
        assert_eq!(cc600_decode(&frame[..4]).unwrap(), None);
    }

    #[test]
    fn gpx_points_and_name() {
        let gpx = r#"<gpx><trk><name> Col </name><trkseg>
            <trkpt lat="45.0" lon="5.0"><ele>200</ele></trkpt>
            <trkpt lat="45.01" lon="5.0"></trkpt>
        </trkseg></trk></gpx>"#;
        let r = parse_gpx(gpx).unwrap();
        assert_eq!(r.name, "Col");
        assert_eq!(r.lats, [45.0, 45.01]);
        assert_eq!(r.eles[0], 200.0);
        assert!(r.eles[1].is_nan());
        assert_eq!(parse_gpx("<gpx></gpx>"), Err(Error("noPoints".into())));
    }

    #[test]
    fn simplified_points_carry_their_distance() {
        // Three points on a meridian, ~1.1 km apart: the middle one is dropped.
        let a = analyze_route(&[45.0, 45.01, 45.02], &[5.0; 3], &[f64::NAN; 3]).unwrap();
        assert_eq!(a.simplified, [0, 2]);
        assert_eq!(a.simplified_m.len(), 2);
        assert_eq!(a.simplified_m[0], 0.0);
        assert_eq!(a.simplified_m[1], a.distance_m);
        assert!((a.distance_m - 2224.0).abs() < 5.0);
    }

    #[test]
    fn unnamed_gpx_is_a_trace() {
        let gpx = r#"<trkpt lat="45" lon="5"/><trkpt lat="46" lon="5"/>"#;
        assert_eq!(parse_gpx(gpx).unwrap().name, "Trace");
    }

    #[test]
    fn settings_apply_reports_the_refused_key() {
        assert_eq!(
            cc600_settings_apply("", "backlight=999\n"),
            Err(Error("backlight".into()))
        );
    }

    #[test]
    fn bryton_session_lists_rides() {
        use driver_bryton::ble::{control, split_transfer};
        let mut s = BrytonSession::new();
        let w = s.list_rides();
        assert_eq!(
            (w.channel, w.bytes.clone()),
            (BRYTON_COMMAND, vec![11, 0x04, 0])
        );
        let step = s.on_notify(BRYTON_COMMAND, &[11, control(1, 1), 2]);
        assert_eq!(step.writes[0].bytes, [11, 0x44, 3]);
        let id = driver_bryton::ble::file_id_from_name("260922125127").unwrap();
        let mut entry = vec![19];
        entry.extend(id.to_be_bytes());
        entry.extend(2902u32.to_be_bytes());
        entry.extend(12_868u32.to_be_bytes());
        entry.resize(36, 0);
        entry[18] = 2;
        let mut events = vec![];
        for f in split_transfer(11, 1, &entry, 20) {
            events.extend(s.on_notify(BRYTON_DATA, &f).events);
        }
        assert_eq!(events[0].kind, "rides");
        assert_eq!(
            events[0].rides,
            [BrytonRide {
                id: "260922125127".into(),
                time_s: 2902,
                distance_m: 12_868,
                sport: 2
            }]
        );
        assert!(s.download("tmp").is_err());
        assert_eq!(
            s.acknowledge("260922125127").unwrap().channel,
            BRYTON_SETTING
        );
    }

    #[test]
    fn bryton_settings_and_route() {
        let fields = bryton_setting_fields();
        let key_tone = fields.iter().find(|f| f.key == "key_tone").unwrap();
        assert_eq!((key_tone.kind, key_tone.writable), ("bool", true));
        let gps = fields.iter().find(|f| f.key == "bike0.gps").unwrap();
        assert_eq!((gps.kind, gps.choices.len()), ("choice", 7));
        assert!(
            !fields
                .iter()
                .find(|f| f.key == "zone.ftp")
                .unwrap()
                .writable
        );
        // Backlight "auto", as a Rider 750 answers it.
        let v = bryton_setting_value("backlight", &[0x14, 1, 6, 0x1b]).unwrap();
        assert_eq!((v.number, v.text.as_str()), (Some(6.0), "auto (6)"));
        let mut s = BrytonSession::new();
        assert_eq!(
            s.setting_set("bike2.auto_pause", 1).unwrap().bytes,
            [27, 1, 2, 1, 31]
        );
        assert!(s.setting_set("zone.ftp", 250).is_err());

        let lats: Vec<f64> = (0..100).map(|i| 45.0 + i as f64 * 1e-4).collect();
        let lons = vec![1.0; 100];
        let eles = vec![f64::NAN; 100];
        let fit = bryton_build_route(&lats, &lons, &eles).unwrap();
        let r = driver_bryton::route::Route::decode(&fit).unwrap();
        assert_eq!(r.points.len(), 2, "a straight line keeps its ends");
        // The Rider 750 (product 1902) gets it gzip-compressed.
        let w = s.send_route(&fit, "1902201200001954");
        assert_eq!(w.bytes, [16, 0x04, 11]);
    }
}
