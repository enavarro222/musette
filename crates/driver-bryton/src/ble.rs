//! Bluetooth protocol of the stock firmware, as the Bryton Active app uses it.
//! Read from the Android app: see docs/drivers/bryton-ble.md, which says what
//! is confirmed and what is still a guess.
//!
//! Two protocols on three characteristics:
//!
//! - command + data channels ("BBCP", big-endian): commands and their
//!   responses on the command channel, transfers (start frame, data frames,
//!   end frame with a byte sum) on the data channel;
//! - setting channel (little-endian, one-byte checksum per frame): settings
//!   and the handshake that gives the transfer parameters.
//!
//! This module is sans-IO: [`Session`] gets the notifications and says what to
//! write ([`Write`]) and what happened ([`Event`]). The host owns the radio.

use std::collections::BTreeMap;

/// GATT UUIDs, lower case.
pub mod uuid {
    pub const COMMAND_SERVICE: &str = "454d7788-a122-058d-9b42-9d0f3772af82";
    pub const COMMAND_CHANNEL: &str = "454d2288-a122-058d-9b42-9d0f3772af82";
    pub const DATA_CHANNEL: &str = "454d1188-a122-058d-9b42-9d0f3772af82";
    /// Phone notifications (calls, SMS) to the device. Not used by Musette.
    pub const NOTIFY_SERVICE: &str = "454d7766-a122-058d-9b42-9d0f3772af82";
    pub const NOTIFY_CHANNEL: &str = "454d3388-a122-058d-9b42-9d0f3772af82";
    pub const SETTING_SERVICE: &str = "50b85566-c2de-a994-094d-340090726877";
    pub const SETTING_CHANNEL: &str = "50b81188-c2de-a994-094d-340090726877";
}

/// Command ids on the command channel.
pub mod cmd {
    pub const DEVICE_INFO: u8 = 6;
    pub const DEVICE_STATUS: u8 = 7;
    pub const FILE_LIST: u8 = 11;
    pub const GET_FILE: u8 = 12;
    pub const REQUEST_DATA: u8 = 15;
    pub const SEND_FILE: u8 = 16;
    pub const FILE_RANGE: u8 = 17;
}

/// Status byte of a response.
pub mod status {
    pub const UNKNOWN_ERROR: u8 = 0;
    pub const BUSY: u8 = 1;
    pub const OK: u8 = 2;
    pub const FACTORY: u8 = 3;
    pub const ADDRESS_ERROR: u8 = 4;
    pub const NEED_TIME_SYNC: u8 = 5;
    pub const NOTHING_TO_SYNC: u8 = 6;
}

/// Action codes (both ways on the command channel).
pub mod action {
    pub const UNKNOWN_ERROR: u8 = 0;
    pub const CHECKSUM_ERROR: u8 = 1;
    pub const PACKET_LOST: u8 = 2;
    pub const SUCCESS: u8 = 3;
    pub const ABORT: u8 = 4;
    /// Followed by the number of frames per batch (u16 BE).
    pub const BATCH: u8 = 5;
    pub const CONTINUE: u8 = 6;
}

/// Setting-channel command ids used here.
pub mod setting {
    /// "set new app": the app says hello; the device then sends the handshake.
    pub const NEW_APP: u8 = 47;
    /// "set btnotifydev": the app has stored this ride (fileId, u32 LE).
    /// The app sends it after each ride it syncs.
    pub const RIDE_STORED: u8 = 51;
    pub const HANDSHAKE: u8 = 52;
    pub const ABORT: u8 = 54;
    pub const ACK_OK: u8 = 10;
    pub const ACK_FAIL: u8 = 0;
}

/// Bits of the `CP` field of the device info. They count only with [`cp::VALID`].
pub mod cp {
    /// File ranges (cmd 17); without it, whole files (cmd 12).
    pub const FILE_RANGE: u32 = 0x001;
    pub const WORKOUT: u32 = 0x002;
    pub const PLAN_TRIP: u32 = 0x004;
    pub const SETTING: u32 = 0x008;
    pub const FW_UPDATE: u32 = 0x010;
    pub const ALTITUDE: u32 = 0x020;
    pub const WIFI: u32 = 0x040;
    pub const FAST_BT: u32 = 0x080;
    pub const GRID: u32 = 0x100;
    pub const CMD_VERSIONS: u32 = 0x200;
    pub const VALID: u32 = 0x800;
}

/// File type used by the app for rides.
pub const FILE_TYPE_ACTIVITY: u8 = 1;
/// Range size the app asks for when it downloads a ride.
pub const DEFAULT_CHUNK: u32 = 39_600;
/// Frames per batch before the handshake.
pub const DEFAULT_BATCH: u16 = 10;
/// Frame size (2-byte index included) before the handshake.
pub const DEFAULT_FRAME_SIZE: usize = 20;
/// Size of one ride-list entry.
pub const LIST_ENTRY_LEN: usize = 36;

const TYPE_COMMAND: u8 = 0;
const TYPE_RESPONSE: u8 = 1;
const TYPE_ACTION: u8 = 2;

/// Control byte: type in bits 7-5, seq in bits 4-2.
pub fn control(kind: u8, seq: u8) -> u8 {
    (kind << 5) | ((seq & 7) << 2)
}

/// What the device sends on the command channel.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Reply {
    Response { cmd: u8, seq: u8, status: u8 },
    Action { cmd: u8, seq: u8, code: u8 },
}

pub fn parse_reply(b: &[u8]) -> Option<Reply> {
    let [cmd, ctrl, code, ..] = *b else {
        return None;
    };
    let seq = (ctrl >> 2) & 7;
    match ctrl >> 5 {
        TYPE_RESPONSE => Some(Reply::Response {
            cmd,
            seq,
            status: code,
        }),
        TYPE_ACTION => Some(Reply::Action { cmd, seq, code }),
        _ => None,
    }
}

/// Which rides cmd 11 lists.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
#[repr(u8)]
pub enum ListType {
    /// Rides not synced yet (what the app syncs).
    Unsynced = 0,
    /// File management: not synced.
    ManageUnsynced = 10,
    /// File management: all files.
    ManageAll = 11,
    /// No type byte: the 2-byte request of the app's automatic sync and of
    /// old firmware (the app's `FileListNotSupport`, 99).
    Default = 99,
}

pub fn device_info_request(seq: u8) -> Vec<u8> {
    vec![cmd::DEVICE_INFO, control(TYPE_COMMAND, seq)]
}

pub fn file_list_request(seq: u8, list: ListType) -> Vec<u8> {
    let mut b = vec![cmd::FILE_LIST, control(TYPE_COMMAND, seq)];
    if list != ListType::Default {
        b.push(list as u8);
    }
    b
}

pub fn file_range_request(seq: u8, file_id: u32, file_type: u8, offset: u32, len: u32) -> Vec<u8> {
    let mut b = vec![cmd::FILE_RANGE, control(TYPE_COMMAND, seq)];
    b.extend_from_slice(&file_id.to_be_bytes());
    b.push(file_type);
    b.extend_from_slice(&offset.to_be_bytes());
    b.extend_from_slice(&len.to_be_bytes());
    b
}

pub fn action_frame(cmd: u8, seq: u8, code: u8) -> Vec<u8> {
    vec![cmd, control(TYPE_ACTION, seq), code]
}

/// Action 5: "send me `frames` frames per batch".
pub fn batch_frame(cmd: u8, seq: u8, frames: u16) -> Vec<u8> {
    let mut b = action_frame(cmd, seq, action::BATCH);
    b.extend_from_slice(&frames.to_be_bytes());
    b
}

/// Cuts `data` into a data-channel transfer: start frame, data frames of
/// `frame_size` bytes (index included), end frame with the byte sum.
/// The app uses it to send files; tests use it as the device side.
pub fn split_transfer(cmd: u8, seq: u8, data: &[u8], frame_size: usize) -> Vec<Vec<u8>> {
    let room = frame_size - 2;
    let chunks: Vec<&[u8]> = data.chunks(room).collect();
    let n = chunks.len() as u16;
    let last = chunks.last().map_or(0, |c| c.len()) as u8;
    let mut out = Vec::with_capacity(chunks.len() + 2);
    let mut start = vec![0, 0];
    start.extend_from_slice(&n.to_be_bytes());
    start.extend_from_slice(&[last, cmd, control(TYPE_COMMAND, seq)]);
    out.push(start);
    let mut sum = 0u32;
    for (i, c) in chunks.iter().enumerate() {
        let mut f = ((i + 1) as u16).to_be_bytes().to_vec();
        f.extend_from_slice(c);
        sum = c.iter().fold(sum, |s, &b| s.wrapping_add(b as u32));
        out.push(f);
    }
    let mut end = (n + 1).to_be_bytes().to_vec();
    end.push(0);
    end.extend_from_slice(&sum.to_be_bytes());
    out.push(end);
    out
}

/// A finished data-channel transfer.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Transfer {
    pub cmd: u8,
    /// Start-frame bytes after the command id (byte 6 on): seq, then
    /// command-specific values (the entry count for cmd 11).
    pub header: Vec<u8>,
    pub bytes: Vec<u8>,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum DataEvent {
    /// Nothing to do yet.
    None,
    /// A batch is complete: send action 6 "continue".
    Continue {
        cmd: u8,
    },
    Done(Transfer),
    /// The device announced no data (or sent an end frame we cannot read).
    Empty {
        cmd: u8,
    },
    BadSum {
        cmd: u8,
    },
    /// End frame received but some data frames never came.
    Missing {
        cmd: u8,
    },
    /// A data frame without a start frame.
    Unexpected,
}

struct Incoming {
    cmd: u8,
    frames: u16,
    header: Vec<u8>,
    parts: BTreeMap<u16, Vec<u8>>,
}

/// Puts data-channel frames back together.
pub struct DataReceiver {
    batch: u16,
    cur: Option<Incoming>,
}

impl DataReceiver {
    pub fn new(batch: u16) -> Self {
        Self {
            batch: batch.max(1),
            cur: None,
        }
    }

    pub fn set_batch(&mut self, batch: u16) {
        self.batch = batch.max(1);
    }

    pub fn feed(&mut self, b: &[u8]) -> DataEvent {
        if b.len() < 2 {
            return DataEvent::Unexpected;
        }
        let index = u16::from_be_bytes([b[0], b[1]]);
        if index == 0 {
            if b.len() < 6 {
                return DataEvent::Unexpected;
            }
            let frames = u16::from_be_bytes([b[2], b[3]]);
            let cmd = b[5];
            if frames == 0 {
                self.cur = None;
                return DataEvent::Empty { cmd };
            }
            self.cur = Some(Incoming {
                cmd,
                frames,
                header: b[6..].to_vec(),
                parts: BTreeMap::new(),
            });
            return DataEvent::None;
        }
        let Some(cur) = self.cur.as_mut() else {
            return DataEvent::Unexpected;
        };
        let cmd = cur.cmd;
        if index <= cur.frames {
            cur.parts.insert(index, b[2..].to_vec());
            if index % self.batch == self.batch - 1 {
                return DataEvent::Continue { cmd };
            }
            return DataEvent::None;
        }
        // End frame.
        let cur = self.cur.take().expect("checked above");
        if b.len() != 7 {
            return DataEvent::Empty { cmd };
        }
        if cur.parts.len() != cur.frames as usize {
            return DataEvent::Missing { cmd };
        }
        let bytes: Vec<u8> = cur.parts.into_values().flatten().collect();
        let sum = bytes.iter().fold(0u32, |s, &x| s.wrapping_add(x as u32));
        if sum != u32::from_be_bytes([b[3], b[4], b[5], b[6]]) {
            return DataEvent::BadSum { cmd };
        }
        DataEvent::Done(Transfer {
            cmd,
            header: cur.header,
            bytes,
        })
    }
}

/// Answer to cmd 6: `\0`-separated strings, each starting with a 2-letter tag.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct DeviceInfo {
    /// `UD`
    pub id: Option<String>,
    /// `IV`
    pub firmware: Option<String>,
    /// `MN`; contains `s=` while the device records a ride.
    pub model: Option<String>,
    /// `CP`, as sent (hex, maybe followed by `,...`).
    pub capabilities: Option<String>,
}

impl DeviceInfo {
    pub fn parse(b: &[u8]) -> Self {
        let mut info = Self::default();
        for part in b.split(|&x| x == 0).filter(|p| p.len() >= 2) {
            let s = String::from_utf8_lossy(part);
            let (tag, value) = s.split_at(2);
            let value = Some(value.to_string());
            match tag {
                "UD" => info.id = value,
                "IV" => info.firmware = value,
                "MN" => info.model = value,
                "CP" => info.capabilities = value,
                _ => {}
            }
        }
        info
    }

    /// The `CP` bits, as the app reads them (hex before the first comma).
    pub fn cp(&self) -> Option<u32> {
        let s = self.capabilities.as_deref()?;
        u32::from_str_radix(s.split(',').next()?.trim(), 16).ok()
    }

    /// One of the [`cp`] bits; false when `CP` is missing or not valid.
    pub fn has(&self, bit: u32) -> bool {
        self.cp()
            .is_some_and(|c| c & cp::VALID != 0 && c & bit != 0)
    }

    pub fn recording(&self) -> bool {
        self.model
            .as_deref()
            .is_some_and(|m| m.to_ascii_lowercase().contains("s="))
    }
}

/// One entry of the ride list (36 bytes, big-endian).
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ListEntry {
    /// Meaning unknown.
    pub payload_size: u8,
    /// Start time; see [`file_name`].
    pub file_id: u32,
    /// Unit to confirm (seconds?).
    pub activity_time: u32,
    /// Unit to confirm (metres?).
    pub activity_dist: u32,
    pub is_workout: u8,
    pub workout_id: u32,
    pub sport_type: u8,
    /// Only meaningful for the file-management list types.
    pub upload_state: u8,
    pub raw: [u8; LIST_ENTRY_LEN],
}

impl ListEntry {
    pub fn parse(b: &[u8]) -> Option<Self> {
        let raw: [u8; LIST_ENTRY_LEN] = b.get(..LIST_ENTRY_LEN)?.try_into().ok()?;
        let u32_at = |i: usize| u32::from_be_bytes([raw[i], raw[i + 1], raw[i + 2], raw[i + 3]]);
        Some(Self {
            payload_size: raw[0],
            file_id: u32_at(1),
            activity_time: u32_at(5),
            activity_dist: u32_at(9),
            is_workout: raw[13],
            workout_id: u32_at(14),
            sport_type: raw[18],
            upload_state: raw[19],
            raw,
        })
    }

    /// `yyMMddHHmmss`, the name of the ride's file on the USB drive.
    pub fn name(&self) -> String {
        file_name(self.file_id)
    }
}

/// Parses a ride list transfer. The entry count is in the start frame
/// (header bytes 1-2); the data length wins if they disagree.
pub fn parse_list(t: &Transfer) -> Vec<ListEntry> {
    let by_len = t.bytes.len() / LIST_ENTRY_LEN;
    let count = match t.header.get(1..3) {
        Some(c) => (u16::from_be_bytes([c[0], c[1]]) as usize).min(by_len),
        None => by_len,
    };
    (0..count)
        .filter_map(|i| ListEntry::parse(&t.bytes[i * LIST_ENTRY_LEN..]))
        .collect()
}

/// Checksum of a setting-channel frame: sum of the bytes before it, mod 256.
pub fn setting_checksum(b: &[u8]) -> u8 {
    b.iter().fold(0u8, |s, &x| s.wrapping_add(x))
}

/// True when the last byte is the checksum of the others.
pub fn setting_valid(frame: &[u8]) -> bool {
    match frame.split_last() {
        Some((&last, rest)) if !rest.is_empty() => setting_checksum(rest) == last,
        _ => false,
    }
}

/// Builds a setting frame `[cmd, type, payload..., checksum]`.
pub fn setting_frame(cmd: u8, kind: u8, payload: &[u8]) -> Vec<u8> {
    let mut b = vec![cmd, kind];
    b.extend_from_slice(payload);
    b.push(setting_checksum(&b));
    b
}

/// The 2-byte ack the app sends for every device frame.
pub fn setting_ack(cmd: u8, status: u8) -> Vec<u8> {
    vec![cmd, status]
}

/// Setting cmd 52: the transfer parameters (little-endian).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Handshake {
    /// Frames per batch (`handShakeSize`).
    pub batch_frames: u32,
    /// Data-channel frame size, 2-byte index included (`payloadSize`).
    pub frame_size: u32,
    /// Probably "write without response allowed".
    pub write_without_response: Option<u8>,
    /// Version 2: chunk size device → app.
    pub dev_tx: Option<u16>,
    /// Version 2: package size app → device.
    pub dev_rx: Option<u16>,
}

impl Handshake {
    /// `frame` is the whole setting frame, checksum included.
    pub fn parse(frame: &[u8]) -> Option<Self> {
        if frame.len() < 13 || frame[0] != setting::HANDSHAKE {
            return None;
        }
        let u32_at =
            |i: usize| u32::from_le_bytes([frame[i], frame[i + 1], frame[i + 2], frame[i + 3]]);
        let u16_at = |i: usize| u16::from_le_bytes([frame[i], frame[i + 1]]);
        let v2 = frame.len() >= 19;
        Some(Self {
            batch_frames: u32_at(3),
            frame_size: u32_at(8),
            write_without_response: (frame.len() >= 15).then(|| frame[13]),
            dev_tx: v2.then(|| u16_at(14)),
            dev_rx: v2.then(|| u16_at(16)),
        })
    }
}

/// `yyMMddHHmmss` of a file id, formatted as UTC like the app does. Over USB
/// this is the ride's file name (the device counts local time as UTC).
pub fn file_name(file_id: u32) -> String {
    let secs = file_id as i64;
    let (y, m, d) = civil_from_days(secs.div_euclid(86_400));
    let t = secs.rem_euclid(86_400);
    format!(
        "{:02}{:02}{:02}{:02}{:02}{:02}",
        y.rem_euclid(100),
        m,
        d,
        t / 3600,
        t / 60 % 60,
        t % 60
    )
}

/// Inverse of [`file_name`]; accepts a `.fit` suffix. Years are 2000-2099.
pub fn file_id_from_name(name: &str) -> Option<u32> {
    let s = name
        .strip_suffix(".fit")
        .or_else(|| name.strip_suffix(".FIT"))
        .unwrap_or(name);
    if s.len() != 12 || !s.bytes().all(|b| b.is_ascii_digit()) {
        return None;
    }
    let n = |i: usize| s[i..i + 2].parse::<i64>().ok();
    let (y, mo, d, h, mi, se) = (2000 + n(0)?, n(2)?, n(4)?, n(6)?, n(8)?, n(10)?);
    if !(1..=12).contains(&mo) || !(1..=31).contains(&d) || h > 23 || mi > 59 || se > 59 {
        return None;
    }
    u32::try_from(days_from_civil(y, mo, d) * 86_400 + h * 3600 + mi * 60 + se).ok()
}

// Howard Hinnant's civil-date algorithms.
fn civil_from_days(z: i64) -> (i64, i64, i64) {
    let z = z + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z - era * 146_097;
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    (yoe + era * 400 + i64::from(m <= 2), m, d)
}

fn days_from_civil(y: i64, m: i64, d: i64) -> i64 {
    let y = if m <= 2 { y - 1 } else { y };
    let era = y.div_euclid(400);
    let yoe = y - era * 400;
    let mp = if m > 2 { m - 3 } else { m + 9 };
    let doy = (153 * mp + 2) / 5 + d - 1;
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    era * 146_097 + doe - 719_468
}

/// The characteristic a write goes to.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Channel {
    Command,
    Data,
    Setting,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Write {
    pub channel: Channel,
    pub bytes: Vec<u8>,
}

impl Write {
    fn command(bytes: Vec<u8>) -> Self {
        Self {
            channel: Channel::Command,
            bytes,
        }
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Failure {
    /// A response with a status other than OK.
    Status {
        cmd: u8,
        status: u8,
    },
    /// An action from the device other than continue/success.
    Action {
        cmd: u8,
        code: u8,
    },
    BadSum {
        cmd: u8,
    },
    Missing {
        cmd: u8,
    },
    Empty {
        cmd: u8,
    },
    /// A range download came back with an unexpected size.
    Size {
        expected: u32,
        got: u32,
    },
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Event {
    DeviceInfo(DeviceInfo),
    Handshake(Handshake),
    Activities(Vec<ListEntry>),
    Progress {
        done: u32,
        total: u32,
    },
    File {
        file_id: u32,
        bytes: Vec<u8>,
    },
    Failed(Failure),
    /// Any other valid setting frame from the device (already acked).
    Setting(Vec<u8>),
}

#[derive(Debug, Default, PartialEq, Eq)]
pub struct Step {
    pub writes: Vec<Write>,
    pub events: Vec<Event>,
}

impl Step {
    fn event(e: Event) -> Self {
        Self {
            writes: vec![],
            events: vec![e],
        }
    }
}

#[derive(Clone, Copy, Debug)]
pub struct Config {
    /// Range size for ride downloads.
    pub chunk: u32,
    /// Action sent after an OK to cmd 11. A Rider 750 sends the list only
    /// after action 3 (success); kept configurable for other models.
    pub list_answer: Option<u8>,
    /// Ranges asked again after a bad sum before giving up.
    pub retries: u8,
}

impl Default for Config {
    fn default() -> Self {
        Self {
            chunk: DEFAULT_CHUNK,
            list_answer: Some(action::SUCCESS),
            retries: 3,
        }
    }
}

#[derive(Debug)]
enum Op {
    Idle,
    Info,
    List,
    Size {
        file_id: u32,
    },
    Range {
        file_id: u32,
        total: u32,
        offset: u32,
        len: u32,
        data: Vec<u8>,
        retries: u8,
    },
}

/// One connection's protocol state: sequence numbers, batch size and the
/// operation in progress (one at a time, as the app does).
pub struct Session {
    cfg: Config,
    seq: u8,
    batch: u16,
    rx: DataReceiver,
    op: Op,
}

impl Session {
    pub fn new(cfg: Config) -> Self {
        Self {
            cfg,
            seq: 0,
            batch: DEFAULT_BATCH,
            rx: DataReceiver::new(DEFAULT_BATCH),
            op: Op::Idle,
        }
    }

    pub fn busy(&self) -> bool {
        !matches!(self.op, Op::Idle)
    }

    pub fn batch(&self) -> u16 {
        self.batch
    }

    fn next_seq(&mut self) -> u8 {
        self.seq = (self.seq + 1) % 8;
        self.seq
    }

    pub fn read_device_info(&mut self) -> Write {
        self.op = Op::Info;
        let seq = self.next_seq();
        Write::command(device_info_request(seq))
    }

    pub fn list_activities(&mut self, list: ListType) -> Write {
        self.op = Op::List;
        let seq = self.next_seq();
        Write::command(file_list_request(seq, list))
    }

    /// Setting cmd 47 "set new app", sent once the setting channel is on.
    /// The device acks it, then sends the handshake.
    pub fn new_app(&mut self) -> Write {
        Write {
            channel: Channel::Setting,
            bytes: setting_frame(setting::NEW_APP, 1, &[0]),
        }
    }

    /// Setting cmd 51: tells the device the ride is stored by the app, so it
    /// leaves the "not synced" list. Send it only after the FIT is verified
    /// and stored.
    pub fn acknowledge(&mut self, file_id: u32) -> Write {
        Write {
            channel: Channel::Setting,
            bytes: setting_frame(setting::RIDE_STORED, 1, &file_id.to_le_bytes()),
        }
    }

    /// Starts a ride download: first the size (offset 0, length 4).
    pub fn download(&mut self, file_id: u32) -> Write {
        self.op = Op::Size { file_id };
        self.range_request(file_id, 0, 4)
    }

    fn range_request(&mut self, file_id: u32, offset: u32, len: u32) -> Write {
        let seq = self.next_seq();
        Write::command(file_range_request(
            seq,
            file_id,
            FILE_TYPE_ACTIVITY,
            offset,
            len,
        ))
    }

    fn fail(&mut self, f: Failure) -> Step {
        self.op = Op::Idle;
        Step::event(Event::Failed(f))
    }

    /// A notification from the command channel.
    pub fn on_command(&mut self, b: &[u8]) -> Step {
        match parse_reply(b) {
            Some(Reply::Response { cmd, seq, status }) => {
                if status == status::OK {
                    // The device sends the data only after this answer
                    // (seen on a Rider 750): action 3 for cmds 6 and 11,
                    // action 5 with the batch size for ranges.
                    let answer = match self.op {
                        Op::Info => Some(action_frame(cmd, seq, action::SUCCESS)),
                        Op::Size { .. } | Op::Range { .. } => {
                            Some(batch_frame(cmd, seq, self.batch))
                        }
                        Op::List => match self.cfg.list_answer {
                            Some(action::BATCH) => Some(batch_frame(cmd, seq, self.batch)),
                            Some(code) => Some(action_frame(cmd, seq, code)),
                            None => None,
                        },
                        _ => None,
                    };
                    Step {
                        writes: answer.into_iter().map(Write::command).collect(),
                        events: vec![],
                    }
                } else if status == status::NOTHING_TO_SYNC && matches!(self.op, Op::List) {
                    self.op = Op::Idle;
                    Step::event(Event::Activities(vec![]))
                } else {
                    self.fail(Failure::Status { cmd, status })
                }
            }
            Some(Reply::Action { cmd, code, .. }) => match code {
                action::SUCCESS | action::CONTINUE => Step::default(),
                _ => self.fail(Failure::Action { cmd, code }),
            },
            None => Step::default(),
        }
    }

    /// A notification from the data channel.
    pub fn on_data(&mut self, b: &[u8]) -> Step {
        match self.rx.feed(b) {
            DataEvent::None | DataEvent::Unexpected => Step::default(),
            DataEvent::Continue { cmd } => Step {
                writes: vec![Write::command(action_frame(
                    cmd,
                    self.seq,
                    action::CONTINUE,
                ))],
                events: vec![],
            },
            DataEvent::Empty { cmd } => {
                if matches!(self.op, Op::List) {
                    self.op = Op::Idle;
                    Step::event(Event::Activities(vec![]))
                } else {
                    self.fail(Failure::Empty { cmd })
                }
            }
            DataEvent::Missing { cmd } => self.retry_or_fail(Failure::Missing { cmd }),
            DataEvent::BadSum { cmd } => self.retry_or_fail(Failure::BadSum { cmd }),
            DataEvent::Done(t) => self.done(t),
        }
    }

    fn retry_or_fail(&mut self, f: Failure) -> Step {
        if let Op::Range {
            file_id,
            offset,
            len,
            retries,
            ..
        } = &mut self.op
        {
            if *retries < self.cfg.retries {
                *retries += 1;
                let (file_id, offset, len) = (*file_id, *offset, *len);
                return Step {
                    writes: vec![self.range_request(file_id, offset, len)],
                    events: vec![],
                };
            }
        }
        self.fail(f)
    }

    fn done(&mut self, t: Transfer) -> Step {
        match std::mem::replace(&mut self.op, Op::Idle) {
            Op::Info => Step::event(Event::DeviceInfo(DeviceInfo::parse(&t.bytes))),
            Op::List => Step::event(Event::Activities(parse_list(&t))),
            Op::Size { file_id } => {
                let Some(size) = t.bytes.get(..4) else {
                    return self.fail(Failure::Size {
                        expected: 4,
                        got: t.bytes.len() as u32,
                    });
                };
                let total = u32::from_be_bytes(size.try_into().expect("4 bytes"));
                if total == 0 {
                    return Step::event(Event::File {
                        file_id,
                        bytes: vec![],
                    });
                }
                self.next_range(file_id, total, Vec::new())
            }
            Op::Range {
                file_id,
                total,
                len,
                mut data,
                ..
            } => {
                if t.bytes.len() as u32 != len {
                    return self.fail(Failure::Size {
                        expected: len,
                        got: t.bytes.len() as u32,
                    });
                }
                data.extend_from_slice(&t.bytes);
                let done = data.len() as u32;
                if done >= total {
                    return Step {
                        writes: vec![],
                        events: vec![
                            Event::Progress { done, total },
                            Event::File {
                                file_id,
                                bytes: data,
                            },
                        ],
                    };
                }
                let mut s = self.next_range(file_id, total, data);
                s.events.insert(0, Event::Progress { done, total });
                s
            }
            Op::Idle => Step::default(),
        }
    }

    fn next_range(&mut self, file_id: u32, total: u32, data: Vec<u8>) -> Step {
        let offset = data.len() as u32;
        let len = self.cfg.chunk.min(total - offset);
        self.op = Op::Range {
            file_id,
            total,
            offset,
            len,
            data,
            retries: 0,
        };
        Step {
            writes: vec![self.range_request(file_id, offset, len)],
            events: vec![],
        }
    }

    /// A notification from the setting channel. Valid device frames are
    /// acked as the app does; the handshake sets the batch size.
    pub fn on_setting(&mut self, b: &[u8]) -> Step {
        if b.len() <= 2 {
            return Step::default(); // an ack from the device
        }
        let cmd = b[0];
        if cmd == setting::ABORT {
            return Step::event(Event::Setting(b.to_vec()));
        }
        if !setting_valid(b) {
            return Step {
                writes: vec![Write {
                    channel: Channel::Setting,
                    bytes: setting_ack(cmd, setting::ACK_FAIL),
                }],
                events: vec![],
            };
        }
        let mut s = Step {
            writes: vec![Write {
                channel: Channel::Setting,
                bytes: setting_ack(cmd, setting::ACK_OK),
            }],
            events: vec![],
        };
        match Handshake::parse(b) {
            Some(h) => {
                if let Ok(batch @ 1..) = u16::try_from(h.batch_frames) {
                    self.batch = batch;
                    self.rx.set_batch(batch);
                }
                s.events.push(Event::Handshake(h));
            }
            None => s.events.push(Event::Setting(b.to_vec())),
        }
        s
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn control_bytes() {
        assert_eq!(control(TYPE_COMMAND, 1), 0x04);
        assert_eq!(control(TYPE_RESPONSE, 1), 0x24);
        assert_eq!(control(TYPE_ACTION, 7), 0x5c);
        assert_eq!(
            parse_reply(&[17, 0x2c, 2]),
            Some(Reply::Response {
                cmd: 17,
                seq: 3,
                status: 2
            })
        );
        assert_eq!(
            parse_reply(&[16, 0x44, 6]),
            Some(Reply::Action {
                cmd: 16,
                seq: 1,
                code: 6
            })
        );
        assert_eq!(parse_reply(&[6, 0x04, 0]), None);
    }

    #[test]
    fn requests() {
        assert_eq!(device_info_request(1), [6, 0x04]);
        assert_eq!(file_list_request(2, ListType::Unsynced), [11, 0x08, 0]);
        assert_eq!(file_list_request(2, ListType::Default), [11, 0x08]);
        assert_eq!(
            file_range_request(3, 0x0102_0304, 1, 39_600, 4),
            [17, 0x0c, 1, 2, 3, 4, 1, 0, 0, 0x9a, 0xb0, 0, 0, 0, 4]
        );
        assert_eq!(batch_frame(17, 3, 10), [17, 0x4c, 5, 0, 10]);
    }

    #[test]
    fn receiver_batches_and_sum() {
        let data: Vec<u8> = (0..=255).cycle().take(1000).collect();
        let frames = split_transfer(12, 1, &data, 20);
        assert_eq!(frames.len(), 56 + 2); // 1000 / 18 = 55.5
        assert_eq!(frames[0], [0, 0, 0, 56, 10, 12, 0x04]);
        let mut rx = DataReceiver::new(10);
        let mut continues = vec![];
        let mut done = None;
        for f in &frames {
            match rx.feed(f) {
                DataEvent::Continue { .. } => continues.push(u16::from_be_bytes([f[0], f[1]])),
                DataEvent::Done(t) => done = Some(t),
                DataEvent::None => {}
                e => panic!("{e:?}"),
            }
        }
        assert_eq!(continues, [9, 19, 29, 39, 49]);
        let t = done.unwrap();
        assert_eq!((t.cmd, t.bytes), (12, data));
    }

    #[test]
    fn receiver_errors() {
        let mut frames = split_transfer(17, 1, b"hello world", 8);
        let mut rx = DataReceiver::new(10);
        let end = frames.pop().unwrap();
        frames[1][2] ^= 1;
        for f in &frames {
            rx.feed(f);
        }
        assert_eq!(rx.feed(&end), DataEvent::BadSum { cmd: 17 });

        let frames = split_transfer(17, 1, b"hello world", 8);
        rx.feed(&frames[0]);
        rx.feed(&frames[2]);
        assert_eq!(
            rx.feed(frames.last().unwrap()),
            DataEvent::Missing { cmd: 17 }
        );
        assert_eq!(rx.feed(&[0, 0, 0, 0, 0, 11]), DataEvent::Empty { cmd: 11 });
        assert_eq!(rx.feed(&[0, 1, 9]), DataEvent::Unexpected);
    }

    #[test]
    fn device_info() {
        let info = DeviceInfo::parse(b"UD1902201200001954\0IVR089\0MNRider750\0CP809,3\0");
        assert_eq!(info.id.as_deref(), Some("1902201200001954"));
        assert_eq!(info.firmware.as_deref(), Some("R089"));
        assert_eq!(info.cp(), Some(0x809));
        assert!(info.has(cp::FILE_RANGE) && info.has(cp::SETTING) && !info.has(cp::WIFI));
        assert!(!info.recording());
        assert!(
            !DeviceInfo::parse(b"CP009").has(cp::FILE_RANGE),
            "no VALID bit"
        );
        assert!(DeviceInfo::parse(b"MNRider750 s=1").recording());
    }

    #[test]
    fn device_info_frames_from_a_rider_750() {
        // Captured on 2026-10-21 (OS R089); the UD serial is masked, so the
        // end frame is rebuilt from the data.
        let frames: [&[u8]; 5] = [
            &[0, 0, 0, 4, 10, 6, 0],
            b"\x00\x01UD0000000000000000",
            b"\x00\x02\x00IV089.013.0005.03",
            b"\x00\x03.011.001\x00MNRider75",
            b"\x00\x040\x00CPAFF,0\x00",
        ];
        let sum = frames[1..]
            .iter()
            .flat_map(|f| &f[2..])
            .fold(0u32, |s, &b| s + b as u32);
        let mut end = vec![0, 5, 0];
        end.extend_from_slice(&sum.to_be_bytes());
        let mut s = Session::new(Config::default());
        s.read_device_info();
        let mut events = vec![];
        for f in frames.iter().copied().chain([&end[..]]) {
            events.extend(s.on_data(f).events);
        }
        let [Event::DeviceInfo(info)] = &events[..] else {
            panic!("{events:?}")
        };
        assert_eq!(info.firmware.as_deref(), Some("089.013.0005.03.011.001"));
        assert_eq!(info.model.as_deref(), Some("Rider750"));
        assert_eq!(info.cp(), Some(0xaff));
        assert!(info.has(cp::FILE_RANGE) && info.has(cp::SETTING));
    }

    #[test]
    fn handshake_from_a_rider_750() {
        // Sent right after "set new app" (47) on 2026-10-21.
        let frame = [
            0x34, 1, b'H', 0xf4, 1, 0, 0, b'P', 0x96, 0, 0, 0, b'W', 1, 0xb0,
        ];
        assert!(setting_valid(&frame));
        let h = Handshake::parse(&frame).unwrap();
        assert_eq!(
            (
                h.batch_frames,
                h.frame_size,
                h.write_without_response,
                h.dev_rx
            ),
            (500, 150, Some(1), None)
        );
        assert_eq!(
            Session::new(Config::default()).new_app().bytes,
            [0x2f, 1, 0, 0x30]
        );
    }

    fn entry(file_id: u32, time: u32, dist: u32) -> Vec<u8> {
        let mut e = vec![0u8; LIST_ENTRY_LEN];
        e[0] = 36;
        e[1..5].copy_from_slice(&file_id.to_be_bytes());
        e[5..9].copy_from_slice(&time.to_be_bytes());
        e[9..13].copy_from_slice(&dist.to_be_bytes());
        e[18] = 2;
        e
    }

    #[test]
    fn ride_list() {
        let id = file_id_from_name("260922125127").unwrap();
        let mut bytes = entry(id, 2902, 12_868);
        bytes.extend(entry(id + 60, 10, 20));
        let t = Transfer {
            cmd: 11,
            header: vec![0x04, 0, 2],
            bytes,
        };
        let list = parse_list(&t);
        assert_eq!(list.len(), 2);
        assert_eq!(list[0].name(), "260922125127");
        assert_eq!(
            (
                list[0].activity_time,
                list[0].activity_dist,
                list[0].sport_type
            ),
            (2902, 12_868, 2)
        );
        assert_eq!(list[1].file_id, id + 60);
    }

    #[test]
    fn file_names() {
        assert_eq!(file_name(0), "700101000000");
        assert_eq!(file_name(951_868_800), "000301000000");
        assert_eq!(file_id_from_name("000301000000.fit"), Some(951_868_800));
        for name in ["260922125127", "250626130648", "241231235959"] {
            assert_eq!(file_name(file_id_from_name(name).unwrap()), name);
        }
        assert_eq!(file_id_from_name("tmp.fit"), None);
        assert_eq!(file_id_from_name("261322125127"), None);
    }

    #[test]
    fn handshake() {
        let mut p = vec![b'H'];
        p.extend_from_slice(&20u32.to_le_bytes());
        p.push(b'P');
        p.extend_from_slice(&150u32.to_le_bytes());
        p.extend_from_slice(&[b'W', 1]);
        p.extend_from_slice(&39_600u16.to_le_bytes());
        p.extend_from_slice(&6930u16.to_le_bytes());
        let frame = setting_frame(52, 1, &p);
        assert_eq!(frame.len(), 19);
        let mut s = Session::new(Config::default());
        let step = s.on_setting(&frame);
        assert_eq!(step.writes[0].bytes, [52, 10]);
        let Event::Handshake(h) = &step.events[0] else {
            panic!()
        };
        assert_eq!(
            (h.batch_frames, h.frame_size, h.dev_tx, h.dev_rx),
            (20, 150, Some(39_600), Some(6930))
        );
        assert_eq!(s.batch(), 20);

        let mut bad = frame.clone();
        bad[3] ^= 1;
        assert_eq!(s.on_setting(&bad).writes[0].bytes, [52, 0]);
        let v1 = setting_frame(52, 1, &p[..10]);
        let h = Handshake::parse(&v1).unwrap();
        assert_eq!((h.write_without_response, h.dev_tx), (None, None));
    }

    /// Plays the device for a download: answers each range request.
    fn serve(s: &mut Session, file: &[u8], first: Write) -> (Vec<Write>, Vec<Event>) {
        let mut writes = vec![first];
        let mut events = vec![];
        let mut i = 0;
        while i < writes.len() {
            let w = writes[i].clone();
            i += 1;
            let b = &w.bytes;
            if w.channel != Channel::Command || b[1] >> 5 != TYPE_COMMAND || b[0] != cmd::FILE_RANGE
            {
                continue;
            }
            let seq = (b[1] >> 2) & 7;
            let offset = u32::from_be_bytes(b[7..11].try_into().unwrap()) as usize;
            let len = u32::from_be_bytes(b[11..15].try_into().unwrap()) as usize;
            let reply = if offset == 0 && len == 4 {
                (file.len() as u32).to_be_bytes().to_vec()
            } else {
                file[offset..offset + len].to_vec()
            };
            let mut step = s.on_command(&[17, control(TYPE_RESPONSE, seq), status::OK]);
            for f in split_transfer(17, seq, &reply, 150) {
                let more = s.on_data(&f);
                step.writes.extend(more.writes);
                step.events.extend(more.events);
            }
            writes.extend(step.writes);
            events.extend(step.events);
        }
        (writes, events)
    }

    #[test]
    fn download_in_ranges() {
        let file: Vec<u8> = (0..100_000u32).map(|i| (i * 7) as u8).collect();
        let mut s = Session::new(Config::default());
        let id = 0x6a0f_cc6f;
        let first = s.download(id);
        assert_eq!(first.bytes, file_range_request(1, id, 1, 0, 4));
        let (writes, events) = serve(&mut s, &file, first);
        let ranges: Vec<(u32, u32)> = writes
            .iter()
            .filter(|w| w.bytes[0] == cmd::FILE_RANGE && w.bytes[1] >> 5 == TYPE_COMMAND)
            .map(|w| {
                let b = &w.bytes;
                (
                    u32::from_be_bytes(b[7..11].try_into().unwrap()),
                    u32::from_be_bytes(b[11..15].try_into().unwrap()),
                )
            })
            .collect();
        assert_eq!(
            ranges,
            [(0, 4), (0, 39_600), (39_600, 39_600), (79_200, 20_800)]
        );
        // Each response is answered by action 5 with the batch size.
        assert!(writes.iter().any(|w| w.bytes == batch_frame(17, 2, 10)));
        assert!(writes
            .iter()
            .any(|w| w.bytes[0] == 17 && w.bytes[2] == action::CONTINUE));
        assert_eq!(
            events.last(),
            Some(&Event::File {
                file_id: id,
                bytes: file
            })
        );
        assert!(!s.busy());
    }

    #[test]
    fn list_flows() {
        let mut s = Session::new(Config::default());
        let w = s.list_activities(ListType::Unsynced);
        assert_eq!(w.bytes, [11, 0x04, 0]);
        let step = s.on_command(&[11, 0x24, status::OK]);
        assert_eq!(
            step.writes,
            [Write::command(vec![11, 0x44, action::SUCCESS])]
        );
        let mut out = vec![];
        for f in split_transfer(11, 1, &entry(7, 1, 2), 20) {
            out.extend(s.on_data(&f).events);
        }
        assert!(matches!(&out[..], [Event::Activities(l)] if l.len() == 1 && l[0].file_id == 7));

        s.list_activities(ListType::Unsynced);
        let step = s.on_command(&[11, 0x28, status::NOTHING_TO_SYNC]);
        assert_eq!(step.events, [Event::Activities(vec![])]);

        s.read_device_info();
        let step = s.on_command(&[6, 0x2c, status::OK]);
        assert_eq!(
            step.writes,
            [Write::command(vec![6, 0x4c, action::SUCCESS])]
        );
        s.read_device_info();
        let step = s.on_command(&[6, 0x30, status::BUSY]);
        assert_eq!(
            step.events,
            [Event::Failed(Failure::Status { cmd: 6, status: 1 })]
        );
    }
}
