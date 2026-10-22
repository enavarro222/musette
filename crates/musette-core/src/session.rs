//! One connection to a device, the same for every model.
//!
//! The app asks with one method per request ([`Session::connect`],
//! [`Session::list_activities`]...), one request at a time, then does what
//! each [`Step`] says: subscribe, write, report progress, arm a timer. It
//! gives the session every notification ([`Session::on_notify`]) and calls
//! [`Session::on_timeout`] when the timer fires. A step with an [`Outcome`]
//! ends the request. Sans-IO: no radio and no clock here, so every model
//! behaves the same in the browser, on phones and in tests.
//!
//! A model brings its channels ([`Session::channels`]), its protocol (a
//! driver crate's session) and its settings ([`setting_fields`]); the app
//! only adds words: labels and Musette groups of the settings, messages of
//! the [`Failure`] codes.

#[cfg(feature = "serde")]
use serde::Serialize;

use crate::{error, Error, ParsedRoute, Result};
use device::Model;
use driver_bryton::ble as bryton;

/// How long the device may stay silent. `request_ms`: waiting for an answer.
/// `short_ms`: where silence has a meaning (a CC600 transfer asks where the
/// device is, a Bryton handshake is given up).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Timing {
    pub request_ms: u32,
    pub short_ms: u32,
}

impl Timing {
    pub fn of(model: Model) -> Self {
        match model {
            Model::OpenCc600 => Self {
                request_ms: 10_000,
                short_ms: 5_000,
            },
            Model::BrytonRider750 => Self {
                request_ms: 15_000,
                short_ms: 10_000,
            },
        }
    }
}

/// A GATT characteristic the session writes to or hears from; its index in
/// [`Session::channels`] is the channel of a [`Write`], of
/// [`Step::subscribe`] and of [`Session::on_notify`]. UUIDs in lower case.
#[derive(Clone, Debug, PartialEq, Eq)]
#[cfg_attr(feature = "serde", derive(Serialize), serde(rename_all = "camelCase"))]
pub struct Channel {
    pub service: &'static str,
    pub characteristic: &'static str,
    /// Written with response (else without).
    pub with_response: bool,
    /// A write may be cut into packets of the link's size (the device
    /// reassembles frames); else each write goes whole.
    pub split: bool,
}

#[derive(Clone, Debug, PartialEq, Eq)]
#[cfg_attr(feature = "serde", derive(Serialize), serde(rename_all = "camelCase"))]
pub struct Write {
    pub channel: u8,
    pub bytes: Vec<u8>,
}

/// A ride on the device.
#[derive(Clone, Debug, PartialEq, Eq)]
#[cfg_attr(feature = "serde", derive(Serialize), serde(rename_all = "camelCase"))]
pub struct Activity {
    /// The model's id for it (a CC600 record number, a Bryton `yyMMddHHmmss`).
    pub id: String,
    /// Start, Unix seconds.
    pub start_time: Option<i64>,
    /// `start_time` is the device's wall clock read as UTC: the app shifts it
    /// by its time zone.
    pub local_time: bool,
    pub size: Option<u64>,
    /// Already copied by an app, when the device tracks it.
    pub synced: Option<bool>,
}

/// A setting's value: `number` for a bool (0 or 1) and a number, `text` for
/// a choice (one of [`SettingField::options`]) and a text, and a readable
/// form of every value.
#[derive(Clone, Debug, PartialEq)]
#[cfg_attr(feature = "serde", derive(Serialize))]
pub struct Setting {
    pub key: String,
    pub number: Option<f64>,
    pub text: String,
}

/// What a setting takes, as the device says.
#[derive(Clone, Debug, PartialEq)]
#[cfg_attr(feature = "serde", derive(Serialize))]
pub struct SettingField {
    pub key: String,
    /// `bool`, `number`, `choice` or `text`.
    pub kind: &'static str,
    pub min: Option<f64>,
    pub max: Option<f64>,
    /// `choice`: the values, and their names in English (the app has its own).
    pub options: Vec<String>,
    pub labels: Vec<String>,
    /// [`Session::write_settings`] accepts it.
    pub writable: bool,
}

/// Why a request failed. `code` is one of: `timeout`, `stalled` (a transfer
/// got no answer, resumable), `refused` (`detail`: the device's answer),
/// `badSetting` (`detail`: the key; nothing changed), `corrupted` (a ride
/// failed its check), `interrupted`, `recording` (the device records a ride),
/// and the CC600's errors: `badRequest`, `noSpace`, `noTransfer`,
/// `incomplete`, `badCrc`, `busy`, `storage`.
#[derive(Clone, Debug, PartialEq, Eq)]
#[cfg_attr(feature = "serde", derive(Serialize))]
pub struct Failure {
    pub code: &'static str,
    pub detail: String,
}

impl Failure {
    pub(crate) fn new(code: &'static str) -> Self {
        Self {
            code,
            detail: String::new(),
        }
    }
}

/// How a request ended.
#[derive(Clone, Debug, PartialEq)]
#[cfg_attr(
    feature = "serde",
    derive(Serialize),
    serde(tag = "kind", rename_all = "camelCase")
)]
pub enum Outcome {
    Done,
    /// [`Session::connect`]: `name` is empty when the device does not say.
    Info {
        name: String,
        recording: bool,
    },
    Activities {
        activities: Vec<Activity>,
    },
    /// A ride, checked (header and CRC).
    File {
        bytes: Vec<u8>,
    },
    Settings {
        fields: Vec<SettingField>,
        values: Vec<Setting>,
    },
    Failed(Failure),
}

#[derive(Clone, Debug, Default, PartialEq)]
#[cfg_attr(feature = "serde", derive(Serialize), serde(rename_all = "camelCase"))]
pub struct Step {
    /// Channels to subscribe to, before the writes.
    pub subscribe: Vec<u8>,
    /// In order.
    pub writes: Vec<Write>,
    /// Share of the request done, 0..=1, when it moved.
    pub progress: Option<f64>,
    /// Call [`Session::on_timeout`] after this long without another step
    /// setting it: `Some(0)` no timer, `None` keep the current one.
    pub wait_ms: Option<u32>,
    /// The request is over.
    pub outcome: Option<Outcome>,
}

/// Files a device can receive besides routes built here.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum FileKind {
    Route,
    Map,
}

/// One connection to a device of any model.
pub struct Session {
    timing: Timing,
    inner: Inner,
}

enum Inner {
    Cc600(Cc600),
    Bryton(Box<Bryton>),
}

impl Session {
    pub fn new(model: Model, timing: Timing) -> Self {
        let inner = match model {
            Model::OpenCc600 => Inner::Cc600(Cc600 {
                s: driver_cc600::Session::new(),
                op: Cc600Op::Other,
            }),
            Model::BrytonRider750 => Inner::Bryton(Box::new(Bryton::new())),
        };
        Self { timing, inner }
    }

    pub fn channels(&self) -> Vec<Channel> {
        match self.inner {
            Inner::Cc600(_) => cc600_channels(),
            Inner::Bryton(_) => bryton_channels(),
        }
    }

    /// Subscribes, says hello ([`Outcome::Info`]).
    pub fn connect(&mut self) -> Result<Step> {
        let t = self.timing;
        Ok(match &mut self.inner {
            Inner::Cc600(c) => {
                let mut step = c.start(Cc600Op::Other, |s| s.hello(), t);
                step.subscribe = vec![CC600_TX];
                step
            }
            Inner::Bryton(b) => b.connect(t),
        })
    }

    /// The rides on the device ([`Outcome::Activities`]).
    pub fn list_activities(&mut self) -> Result<Step> {
        let t = self.timing;
        Ok(match &mut self.inner {
            Inner::Cc600(c) => c.start(Cc600Op::Other, |s| s.list_activities(), t),
            Inner::Bryton(b) => b.list(t),
        })
    }

    /// A ride, checked ([`Outcome::File`]). `size` from the listing, when it gave one.
    pub fn download(&mut self, id: &str, size: Option<u64>) -> Result<Step> {
        let t = self.timing;
        match &mut self.inner {
            Inner::Cc600(c) => {
                let id = cc600_id(id)?;
                let size = size
                    .and_then(|s| u32::try_from(s).ok())
                    .ok_or_else(|| error("a CC600 ride needs its size"))?;
                Ok(c.start(Cc600Op::Download, |s| s.download(id, size), t))
            }
            Inner::Bryton(b) => b.download(id, t),
        }
    }

    /// The ride is stored: the device may free it ([`Outcome::Done`]).
    pub fn acknowledge(&mut self, id: &str) -> Result<Step> {
        let t = self.timing;
        match &mut self.inner {
            Inner::Cc600(c) => {
                let id = cc600_id(id)?;
                Ok(c.start(Cc600Op::Other, |s| s.acknowledge(id), t))
            }
            Inner::Bryton(b) => b.acknowledge(id, t),
        }
    }

    /// Replaces the device's route, written in its own format ([`Outcome::Done`]).
    pub fn send_route(&mut self, route: &ParsedRoute) -> Result<Step> {
        match &mut self.inner {
            Inner::Cc600(_) => {
                let file = crate::cc600_build_route(
                    route.name.clone(),
                    &route.lats,
                    &route.lons,
                    &route.eles,
                )?;
                self.send_file(FileKind::Route, file)
            }
            Inner::Bryton(b) => b.send_route(route, self.timing),
        }
    }

    /// Sends a prepared file, resuming an interrupted transfer of the same
    /// file ([`Outcome::Done`]).
    pub fn send_file(&mut self, kind: FileKind, bytes: Vec<u8>) -> Result<Step> {
        let t = self.timing;
        match &mut self.inner {
            Inner::Cc600(c) => {
                let kind = match kind {
                    FileKind::Route => protocol_cc600::transfer::Kind::Route,
                    FileKind::Map => protocol_cc600::transfer::Kind::Map,
                };
                if bytes.is_empty() {
                    return Err(error("empty file"));
                }
                Ok(c.start(Cc600Op::Transfer, |s| s.send_file(kind, bytes), t))
            }
            Inner::Bryton(_) => Err(error("this device takes routes only")),
        }
    }

    /// Every setting and its value ([`Outcome::Settings`]).
    pub fn read_settings(&mut self) -> Result<Step> {
        let t = self.timing;
        Ok(match &mut self.inner {
            Inner::Cc600(c) => c.start(Cc600Op::Settings, |s| s.get_settings(), t),
            Inner::Bryton(b) => b.read_settings(t),
        })
    }

    /// Changes settings, only the changed ones: each is checked before
    /// anything is sent (an error names the first bad one) ([`Outcome::Done`]).
    pub fn write_settings(&mut self, changes: &[Setting]) -> Result<Step> {
        let t = self.timing;
        match &mut self.inner {
            Inner::Cc600(c) => {
                let lines = cc600_lines(changes)?;
                Ok(c.start(Cc600Op::Other, |s| s.set_settings(&lines), t))
            }
            Inner::Bryton(b) => b.write_settings(changes, t),
        }
    }

    /// Bytes notified on `channel`.
    pub fn on_notify(&mut self, channel: u8, bytes: &[u8]) -> Step {
        let t = self.timing;
        match &mut self.inner {
            Inner::Cc600(c) if channel == CC600_TX => {
                let step = c.s.on_bytes(bytes);
                c.step(step, t)
            }
            Inner::Cc600(_) => Step::default(),
            Inner::Bryton(b) => b.on_notify(channel, bytes, t),
        }
    }

    /// The device stayed silent for the time [`Step::wait_ms`] set.
    pub fn on_timeout(&mut self) -> Step {
        let t = self.timing;
        match &mut self.inner {
            Inner::Cc600(c) => {
                let step = c.s.on_silence();
                c.step(step, t)
            }
            Inner::Bryton(b) => b.on_timeout(t),
        }
    }
}

/// The settings of a model and what each takes.
pub fn setting_fields(model: Model) -> Vec<SettingField> {
    match model {
        Model::OpenCc600 => cc600_fields(),
        Model::BrytonRider750 => bryton_fields(),
    }
}

fn failed(f: Failure) -> Step {
    Step {
        wait_ms: Some(0),
        outcome: Some(Outcome::Failed(f)),
        ..Step::default()
    }
}

/// A ride after its download: checked, or the failure.
fn checked(bytes: Vec<u8>) -> Outcome {
    match crate::verify_fit(&bytes) {
        Ok(_) => Outcome::File { bytes },
        Err(Error(detail)) => Outcome::Failed(Failure {
            code: "corrupted",
            detail,
        }),
    }
}

// ---- CC600 ---------------------------------------------------------------

const CC600_RX: u8 = 0;
const CC600_TX: u8 = 1;

fn cc600_channels() -> Vec<Channel> {
    use protocol_cc600::ble::{RX_CHAR_UUID, SERVICE_UUID, TX_CHAR_UUID};
    vec![
        Channel {
            service: SERVICE_UUID,
            characteristic: RX_CHAR_UUID,
            with_response: false,
            split: true,
        },
        Channel {
            service: SERVICE_UUID,
            characteristic: TX_CHAR_UUID,
            with_response: false,
            split: false,
        },
    ]
}

fn cc600_id(id: &str) -> Result<u32> {
    id.parse()
        .map_err(|_| error(format!("not a CC600 ride id: {id}")))
}

/// What to make of the driver's events.
#[derive(Clone, Copy, PartialEq, Eq)]
enum Cc600Op {
    Other,
    Download,
    Transfer,
    Settings,
}

struct Cc600 {
    s: driver_cc600::Session,
    op: Cc600Op,
}

impl Cc600 {
    fn start(
        &mut self,
        op: Cc600Op,
        f: impl FnOnce(&mut driver_cc600::Session) -> driver_cc600::Step,
        t: Timing,
    ) -> Step {
        self.op = op;
        let step = f(&mut self.s);
        self.step(step, t)
    }

    fn step(&mut self, s: driver_cc600::Step, t: Timing) -> Step {
        use driver_cc600::{Event, Wait};
        let mut out = Step {
            writes: s
                .writes
                .into_iter()
                .map(|bytes| Write {
                    channel: CC600_RX,
                    bytes,
                })
                .collect(),
            wait_ms: Some(match s.wait {
                Wait::Nothing => 0,
                Wait::Answer => t.request_ms,
                Wait::Transfer => t.short_ms,
            }),
            ..Step::default()
        };
        for e in s.events {
            out.outcome = match e {
                Event::Progress { done, total } => {
                    out.progress = Some(f64::from(done) / f64::from(total.max(1)));
                    continue;
                }
                Event::Info(_) => Some(Outcome::Info {
                    name: String::new(),
                    recording: false,
                }),
                Event::Activities(list) => Some(Outcome::Activities {
                    activities: list
                        .into_iter()
                        .map(|a| Activity {
                            id: a.id.to_string(),
                            start_time: Some(fit::fit_to_unix(a.start_time)),
                            local_time: false,
                            size: Some(u64::from(a.size)),
                            synced: Some(a.synced),
                        })
                        .collect(),
                }),
                Event::File(bytes) => Some(checked(bytes)),
                Event::Settings(text) => Some(Outcome::Settings {
                    fields: cc600_fields(),
                    values: cc600_values(&text),
                }),
                Event::Done => {
                    if self.op == Cc600Op::Transfer {
                        out.progress = Some(1.0);
                    }
                    Some(Outcome::Done)
                }
                Event::Failed(f) => Some(Outcome::Failed(cc600_failure(f))),
            };
        }
        out
    }
}

fn cc600_failure(f: driver_cc600::Failure) -> Failure {
    use driver_cc600::Failure as F;
    use protocol_cc600::ErrorCode as E;
    match f {
        F::Device(code) => Failure::new(match code {
            E::BadRequest => "badRequest",
            E::NoSpace => "noSpace",
            E::NoTransfer => "noTransfer",
            E::Incomplete => "incomplete",
            E::BadCrc => "badCrc",
            E::Busy => "busy",
            E::Storage => "storage",
            E::BadSetting => "badSetting",
        }),
        F::Unknown(code) => Failure {
            code: "refused",
            detail: code.to_string(),
        },
        F::BadSetting(key) => Failure {
            code: "badSetting",
            detail: key,
        },
        F::Timeout => Failure::new("timeout"),
        F::Stalled => Failure::new("stalled"),
        F::Interrupted => Failure::new("interrupted"),
    }
}

fn cc600_fields() -> Vec<SettingField> {
    use settings_cc600::FieldKind;
    settings_cc600::FIELDS
        .iter()
        .map(|f| {
            let mut field = SettingField {
                key: f.key.to_owned(),
                kind: "text",
                min: None,
                max: None,
                options: vec![],
                labels: vec![],
                writable: true,
            };
            match f.kind {
                FieldKind::OnOff => field.kind = "bool",
                FieldKind::Range { min, max } => {
                    field.kind = "number";
                    field.min = Some(f64::from(min));
                    field.max = Some(f64::from(max));
                }
                FieldKind::Choice(words) => {
                    field.kind = "choice";
                    field.options = words.iter().map(|w| (*w).to_owned()).collect();
                    field.labels = field.options.clone();
                }
                // A POSIX rule, zone bounds (`55,75,90`): any the device accepts.
                FieldKind::Tz | FieldKind::Zones => {}
                // Paired from the device.
                FieldKind::Sensor => field.writable = false,
            }
            field
        })
        .collect()
}

/// The values of a settings file, read as the device does (defaults for
/// what is missing or invalid).
fn cc600_values(text: &str) -> Vec<Setting> {
    use settings_cc600::FieldKind;
    let settings = settings_cc600::Settings::parse(text);
    settings_cc600::FIELDS
        .iter()
        .map(|f| {
            let mut text = String::new();
            let _ = settings.get(f.key, &mut text);
            let number = match f.kind {
                FieldKind::OnOff => Some(if text == "on" { 1.0 } else { 0.0 }),
                FieldKind::Range { .. } => text.parse().ok(),
                _ => None,
            };
            Setting {
                key: f.key.to_owned(),
                number,
                text,
            }
        })
        .collect()
}

/// Changes as the `key=value` lines `SetSettings` carries.
fn cc600_lines(changes: &[Setting]) -> Result<String> {
    use settings_cc600::FieldKind;
    let mut lines = String::new();
    for c in changes {
        let f = settings_cc600::FIELDS
            .iter()
            .find(|f| f.key == c.key)
            .ok_or_else(|| error(format!("unknown setting {}", c.key)))?;
        let value = match f.kind {
            FieldKind::OnOff => (if c.number.unwrap_or(0.0) != 0.0 {
                "on"
            } else {
                "off"
            })
            .into(),
            FieldKind::Range { .. } => match c.number {
                Some(n) => format!("{}", n.round() as i64),
                None => c.text.clone(),
            },
            FieldKind::Choice(_) | FieldKind::Tz | FieldKind::Zones => c.text.clone(),
            FieldKind::Sensor => return Err(error(format!("{} is read-only", c.key))),
        };
        lines.push_str(&format!("{}={value}\n", c.key));
    }
    Ok(lines)
}

// ---- Bryton --------------------------------------------------------------

const BRYTON_COMMAND: u8 = 0;
const BRYTON_DATA: u8 = 1;
const BRYTON_SETTING: u8 = 2;
/// Setting commands the device sends on its own (battery, every 5 s;
/// notify, every 20 s): they do not show the device answers.
const PUSHED: [u8; 2] = [24, 39];
const RIDE_STORED: u8 = 51;
const ACK_OK: u8 = 10;

fn bryton_channels() -> Vec<Channel> {
    use bryton::uuid::*;
    let c = |service, characteristic, with_response| Channel {
        service,
        characteristic,
        with_response,
        split: false,
    };
    vec![
        c(COMMAND_SERVICE, COMMAND_CHANNEL, true),
        c(COMMAND_SERVICE, DATA_CHANNEL, false),
        c(SETTING_SERVICE, SETTING_CHANNEL, true),
    ]
}

fn bryton_fields() -> Vec<SettingField> {
    use driver_bryton::settings::{encode, fields, Kind};
    fields()
        .into_iter()
        .map(|f| {
            let kind = match f.kind {
                Kind::Bool => "bool",
                Kind::Choice => "choice",
                Kind::Number => "number",
                Kind::Text => "text",
            };
            SettingField {
                key: f.key.to_owned(),
                kind,
                min: (kind == "number").then_some(0.0),
                max: None,
                options: (0..f.choices.len()).map(|i| i.to_string()).collect(),
                labels: f.choices.iter().map(|c| (*c).to_owned()).collect(),
                writable: encode(f.key, 0).is_some(),
            }
        })
        .collect()
}

pub(crate) fn bryton_setting(f: &driver_bryton::settings::Field, frame: &[u8]) -> Option<Setting> {
    use driver_bryton::settings::{answer_payload, Kind, Value};
    let v = (f.decode)(answer_payload(f.cmd, frame)?)?;
    let number = match &v {
        Value::Bool(b) => Some(f64::from(u8::from(*b))),
        Value::Int(i) => Some(*i as f64),
        Value::Pair { metric, .. } => Some(f64::from(*metric)),
        _ => None,
    };
    let text = match (&v, f.kind) {
        (Value::Int(i), Kind::Choice) => i.to_string(),
        (Value::Text(t), _) => t.clone(),
        _ => f.show(&v),
    };
    Some(Setting {
        key: f.key.to_owned(),
        number,
        text,
    })
}

fn ride_id(id: &str) -> Result<u32> {
    bryton::file_id_from_name(id).ok_or_else(|| error(format!("not a Bryton ride id: {id}")))
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

/// What the device said about itself.
struct BrytonInfo {
    /// `UD`: the first 4 digits are the product code (1902: Rider 750).
    id: String,
    model: String,
    recording: bool,
}

enum BrytonOp {
    Idle,
    Info,
    /// After "new app": the handshake gives frame and batch sizes; without
    /// it, defaults.
    Handshake,
    List,
    Download,
    /// Acknowledge, or a setting written: the ack of `cmd`.
    SettingAck(u8),
    Route(String),
    RouteName,
    /// `next`: index in `fields` of the setting asked; its answer has `cmd`.
    ReadSettings {
        next: usize,
        cmd: u8,
        values: Vec<Setting>,
    },
    /// The ack of `cmd` is awaited; `rest`: the setting frames still to
    /// write, last first.
    WriteSettings {
        cmd: u8,
        rest: Vec<(u8, Vec<u8>)>,
    },
}

struct Bryton {
    s: bryton::Session,
    fields: Vec<driver_bryton::settings::Field>,
    info: Option<BrytonInfo>,
    op: BrytonOp,
}

impl Bryton {
    fn new() -> Self {
        Self {
            s: bryton::Session::new(bryton::Config::default()),
            fields: driver_bryton::settings::fields(),
            info: None,
            op: BrytonOp::Idle,
        }
    }

    fn write(&self, w: bryton::Write) -> Write {
        Write {
            channel: match w.channel {
                bryton::Channel::Command => BRYTON_COMMAND,
                bryton::Channel::Data => BRYTON_DATA,
                bryton::Channel::Setting => BRYTON_SETTING,
            },
            bytes: w.bytes,
        }
    }

    fn start(&mut self, op: BrytonOp, w: bryton::Write, t: Timing) -> Step {
        self.op = op;
        Step {
            writes: vec![self.write(w)],
            wait_ms: Some(t.request_ms),
            ..Step::default()
        }
    }

    fn end(&mut self, outcome: Outcome) -> Step {
        self.op = BrytonOp::Idle;
        Step {
            wait_ms: Some(0),
            outcome: Some(outcome),
            ..Step::default()
        }
    }

    fn info_outcome(&mut self) -> Step {
        let (name, recording) = self
            .info
            .as_ref()
            .map_or((String::new(), false), |i| (i.model.clone(), i.recording));
        self.end(Outcome::Info { name, recording })
    }

    fn connect(&mut self, t: Timing) -> Step {
        let w = self.s.read_device_info();
        let mut step = self.start(BrytonOp::Info, w, t);
        step.subscribe = vec![BRYTON_COMMAND, BRYTON_DATA];
        step
    }

    fn list(&mut self, t: Timing) -> Step {
        if self.info.as_ref().is_some_and(|i| i.recording) {
            return failed(Failure::new("recording"));
        }
        let w = self.s.list_activities(bryton::ListType::Unsynced);
        self.start(BrytonOp::List, w, t)
    }

    fn download(&mut self, id: &str, t: Timing) -> Result<Step> {
        let w = self.s.download(ride_id(id)?);
        Ok(self.start(BrytonOp::Download, w, t))
    }

    fn acknowledge(&mut self, id: &str, t: Timing) -> Result<Step> {
        let w = self.s.acknowledge(ride_id(id)?);
        Ok(self.start(BrytonOp::SettingAck(RIDE_STORED), w, t))
    }

    fn send_route(&mut self, route: &ParsedRoute, t: Timing) -> Result<Step> {
        let fit = crate::bryton_build_route(&route.lats, &route.lons, &route.eles)?;
        let device_id = self.info.as_ref().map_or("", |i| i.id.as_str());
        let payload = if bryton::compresses_routes(device_id) {
            bryton::gzip(&fit)
        } else {
            fit
        };
        let w = self.s.send_file(bryton::FILE_TYPE_PLAN_TRIP, &payload);
        // The name makes the device import the route.
        let name = match route.name.trim() {
            "" => "Musette".to_owned(),
            name => name.to_owned(),
        };
        Ok(self.start(BrytonOp::Route(name), w, t))
    }

    fn read_settings(&mut self, t: Timing) -> Step {
        self.op = BrytonOp::ReadSettings {
            next: 0,
            cmd: 0,
            values: vec![],
        };
        self.ask_setting(t)
    }

    /// Asks the setting `next`, or ends with the values.
    fn ask_setting(&mut self, t: Timing) -> Step {
        let BrytonOp::ReadSettings { next, cmd, values } = &mut self.op else {
            return Step::default();
        };
        let Some(f) = self.fields.get(*next) else {
            let values = core::mem::take(values);
            return self.end(Outcome::Settings {
                fields: bryton_fields(),
                values,
            });
        };
        *cmd = f.cmd;
        let w = self.s.setting_get(f.cmd, f.args);
        Step {
            writes: vec![self.write(w)],
            wait_ms: Some(t.request_ms),
            ..Step::default()
        }
    }

    fn write_settings(&mut self, changes: &[Setting], t: Timing) -> Result<Step> {
        // Every change is checked before anything is sent.
        let mut frames = changes
            .iter()
            .map(|c| {
                let value = c
                    .number
                    .map(|n| n.round() as i64)
                    .or_else(|| c.text.parse().ok())
                    .ok_or_else(|| error(format!("{}: not a number: {}", c.key, c.text)))?;
                driver_bryton::settings::encode(&c.key, value)
                    .ok_or_else(|| error(format!("{} cannot be set to {value}", c.key)))
            })
            .collect::<Result<Vec<_>>>()?;
        frames.reverse();
        let Some((cmd, payload)) = frames.pop() else {
            return Ok(self.end(Outcome::Done));
        };
        let w = self.s.setting_set(cmd, &payload);
        Ok(self.start(BrytonOp::WriteSettings { cmd, rest: frames }, w, t))
    }

    fn on_notify(&mut self, channel: u8, bytes: &[u8], t: Timing) -> Step {
        let step = match channel {
            BRYTON_COMMAND => self.s.on_command(bytes),
            BRYTON_DATA => self.s.on_data(bytes),
            BRYTON_SETTING => self.s.on_setting(bytes),
            _ => return Step::default(),
        };
        let idle = matches!(self.op, BrytonOp::Idle);
        // Command and data frames show the device answers; setting frames
        // too, except what it sends on its own.
        let counts =
            channel != BRYTON_SETTING || !bytes.first().is_some_and(|c| PUSHED.contains(c));
        let mut out = Step {
            writes: step.writes.into_iter().map(|w| self.write(w)).collect(),
            wait_ms: if idle {
                Some(0)
            } else if counts {
                Some(t.request_ms)
            } else {
                None
            },
            ..Step::default()
        };
        for e in step.events {
            let s = self.event(e, t);
            out.subscribe.extend(s.subscribe);
            out.writes.extend(s.writes);
            out.progress = s.progress.or(out.progress);
            out.wait_ms = s.wait_ms.or(out.wait_ms);
            if s.outcome.is_some() {
                out.outcome = s.outcome;
            }
        }
        out
    }

    fn event(&mut self, e: bryton::Event, t: Timing) -> Step {
        use bryton::Event as E;
        match (&mut self.op, e) {
            (BrytonOp::Idle, _) => Step::default(),
            (_, E::Failed(f)) => self.end(Outcome::Failed(Failure {
                code: "refused",
                detail: failure_text(&f),
            })),
            (BrytonOp::Info, E::DeviceInfo(i)) => {
                let settings = i.has(bryton::cp::SETTING);
                self.info = Some(BrytonInfo {
                    recording: i.recording(),
                    id: i.id.unwrap_or_default(),
                    model: i.model.unwrap_or_default(),
                });
                if !settings {
                    return self.info_outcome();
                }
                let w = self.s.new_app();
                Step {
                    subscribe: vec![BRYTON_SETTING],
                    writes: vec![self.write(w)],
                    wait_ms: Some(t.short_ms),
                    ..self.go(BrytonOp::Handshake)
                }
            }
            (BrytonOp::Handshake, E::Handshake(_)) => self.info_outcome(),
            (BrytonOp::List, E::Activities(list)) => self.end(Outcome::Activities {
                activities: list
                    .iter()
                    .map(|e| Activity {
                        id: e.name(),
                        start_time: Some(i64::from(e.file_id)),
                        local_time: true,
                        size: None,
                        // The device lists only the rides not synced yet.
                        synced: Some(false),
                    })
                    .collect(),
            }),
            (BrytonOp::Download, E::Progress { done, total }) if total > 0 => Step {
                progress: Some(f64::from(done) / f64::from(total)),
                ..Step::default()
            },
            (BrytonOp::Download, E::File { bytes, .. }) => {
                let outcome = checked(bytes);
                Step {
                    progress: matches!(outcome, Outcome::File { .. }).then_some(1.0),
                    ..self.end(outcome)
                }
            }
            (BrytonOp::Route(_), E::Progress { done, total }) if total > 0 => Step {
                progress: Some(0.95 * f64::from(done) / f64::from(total)),
                ..Step::default()
            },
            (BrytonOp::Route(name), E::Sent { .. }) => {
                let name = core::mem::take(name);
                let w = self.s.send_route_name(&name);
                Step {
                    writes: vec![self.write(w)],
                    wait_ms: Some(t.request_ms),
                    ..self.go(BrytonOp::RouteName)
                }
            }
            (BrytonOp::RouteName, E::RouteNamed) => Step {
                progress: Some(1.0),
                ..self.end(Outcome::Done)
            },
            (BrytonOp::SettingAck(cmd), E::SettingAck { cmd: c, status }) if *cmd == c => {
                if status == ACK_OK {
                    self.end(Outcome::Done)
                } else {
                    self.refused(status)
                }
            }
            (BrytonOp::WriteSettings { cmd, rest }, E::SettingAck { cmd: c, status })
                if *cmd == c =>
            {
                if status != ACK_OK {
                    return self.refused(status);
                }
                let Some((cmd, payload)) = rest.pop() else {
                    return self.end(Outcome::Done);
                };
                let rest = core::mem::take(rest);
                let w = self.s.setting_set(cmd, &payload);
                Step {
                    writes: vec![self.write(w)],
                    wait_ms: Some(t.request_ms),
                    ..self.go(BrytonOp::WriteSettings { cmd, rest })
                }
            }
            // The answer, or the same frame pushed by the device (battery).
            (BrytonOp::ReadSettings { next, cmd, values }, E::Setting(frame))
                if frame.first() == Some(cmd) =>
            {
                if let Some(v) = self
                    .fields
                    .get(*next)
                    .and_then(|f| bryton_setting(f, &frame))
                {
                    values.push(v);
                }
                *next += 1;
                self.ask_setting(t)
            }
            _ => Step::default(),
        }
    }

    /// Moves to `op`; the rest of the step is the caller's.
    fn go(&mut self, op: BrytonOp) -> Step {
        self.op = op;
        Step::default()
    }

    fn refused(&mut self, status: u8) -> Step {
        self.end(Outcome::Failed(Failure {
            code: "refused",
            detail: format!("status {status}"),
        }))
    }

    fn on_timeout(&mut self, _t: Timing) -> Step {
        match self.op {
            BrytonOp::Idle => Step {
                wait_ms: Some(0),
                ..Step::default()
            },
            // No handshake: the defaults do.
            BrytonOp::Handshake => self.info_outcome(),
            _ => self.end(Outcome::Failed(Failure::new("timeout"))),
        }
    }
}
