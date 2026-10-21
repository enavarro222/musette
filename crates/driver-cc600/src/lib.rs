//! App side of the OpenCC600 protocol (`protocol-cc600`), sans-IO: the app
//! writes the frames a [`Session`] returns, gives it every byte the device
//! notifies, and tells it when the device stayed silent too long
//! ([`Session::on_silence`]; how long depends on [`Step::wait`]).
//!
//! [`sim::Device`] is a CC600 in memory around the firmware's own state
//! machines, for tests and to try the app without a device.

pub mod sim;

use protocol_cc600::payload::{ActivityEntry, ReadActivity};
use protocol_cc600::transfer::{self, Ack, Begin, Kind, Ready};
use protocol_cc600::{ErrorCode, Frame, Op};

/// File bytes per `TransferChunk`: the frame (+11 bytes) fits a 255-byte BLE packet.
const TRANSFER_CHUNK: u32 = 240;
/// Bytes asked by each `ReadActivity`.
const READ_CHUNK: u32 = 512;
/// Silences a transfer survives (each asks the device where it is) before it fails.
const MAX_STALLS: u8 = 3;

/// What the session waits for, to time the silence before [`Session::on_silence`].
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Wait {
    /// No request under way.
    Nothing,
    /// The answer to a request.
    Answer,
    /// Acks of chunks in flight: a short silence means one was lost.
    Transfer,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Failure {
    /// `Op::Error` from the device, with its code.
    Device(ErrorCode),
    /// `Op::Error` with a code this version does not know.
    Unknown(u8),
    /// `SetSettings` refused this key; nothing changed.
    BadSetting(String),
    /// No answer to a request.
    Timeout,
    /// No answer during a transfer, even after asking the device where it is.
    Stalled,
    /// A ride read came back empty before its end.
    Interrupted,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Event {
    /// `DeviceInfo`: the device answered `Hello`.
    Info(Vec<u8>),
    Activities(Vec<ActivityEntry>),
    Progress {
        done: u32,
        total: u32,
    },
    /// The ride's bytes (not verified here).
    File(Vec<u8>),
    /// The settings file.
    Settings(String),
    /// The request succeeded (acknowledge, settings written, file committed).
    Done,
    Failed(Failure),
}

impl Event {
    /// The request is over.
    pub fn ends(&self) -> bool {
        !matches!(self, Event::Progress { .. })
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Step {
    /// Frames to write, in order.
    pub writes: Vec<Vec<u8>>,
    pub events: Vec<Event>,
    pub wait: Wait,
}

#[derive(Debug)]
enum Phase {
    Begin,
    Stream,
    End,
}

#[derive(Debug)]
enum State {
    Idle,
    Hello,
    List(Vec<ActivityEntry>),
    Read { id: u32, data: Vec<u8>, size: u32 },
    Ack,
    GetSettings,
    SetSettings,
    Transfer(Box<Transfer>),
}

#[derive(Debug)]
struct Transfer {
    file: Vec<u8>,
    begin: Begin,
    sender: transfer::Sender,
    phase: Phase,
    stalls: u8,
}

/// One connection to a CC600, one request at a time.
#[derive(Debug)]
pub struct Session {
    seq: u8,
    /// `seq` of the request answers belong to.
    current: u8,
    rx: Vec<u8>,
    op: State,
}

impl Default for Session {
    fn default() -> Self {
        Self::new()
    }
}

impl Session {
    pub fn new() -> Self {
        Self {
            seq: 0,
            current: 0,
            rx: Vec::new(),
            op: State::Idle,
        }
    }

    pub fn busy(&self) -> bool {
        !matches!(self.op, State::Idle)
    }

    /// First request: the device answers with its info ([`Event::Info`]).
    pub fn hello(&mut self) -> Step {
        self.start(State::Hello, Op::Hello, &[])
    }

    /// The rides on the device ([`Event::Activities`]).
    pub fn list_activities(&mut self) -> Step {
        self.start(State::List(Vec::new()), Op::ListActivities, &[])
    }

    /// Reads ride `id` of `size` bytes ([`Event::Progress`], then [`Event::File`]).
    pub fn download(&mut self, id: u32, size: u32) -> Step {
        if size == 0 {
            self.op = State::Idle;
            return self.idle(Event::File(Vec::new()));
        }
        self.op = State::Read {
            id,
            data: Vec::with_capacity(size as usize),
            size,
        };
        self.read_next(id, 0, size)
    }

    /// The ride is stored by the app: the device may free it ([`Event::Done`]).
    pub fn acknowledge(&mut self, id: u32) -> Step {
        // Room for the FIT CRC, for the device to check before freeing (not sent yet).
        let mut p = id.to_le_bytes().to_vec();
        p.extend([0, 0]);
        self.start(State::Ack, Op::AckActivity, &p)
    }

    /// The settings file ([`Event::Settings`]).
    pub fn get_settings(&mut self) -> Step {
        self.start(State::GetSettings, Op::GetSettings, &[])
    }

    /// Changed settings as `key=value` lines, all or nothing ([`Event::Done`],
    /// or [`Failure::BadSetting`]).
    pub fn set_settings(&mut self, lines: &str) -> Step {
        self.start(State::SetSettings, Op::SetSettings, lines.as_bytes())
    }

    /// Sends a file, resuming an interrupted transfer of the same file
    /// ([`Event::Progress`], then [`Event::Done`] once committed).
    pub fn send_file(&mut self, kind: Kind, file: Vec<u8>) -> Step {
        let begin = Begin {
            kind,
            size: file.len() as u32,
            crc: protocol_cc600::crc16_ccitt(&file),
        };
        let size = begin.size;
        self.op = State::Transfer(Box::new(Transfer {
            file,
            begin,
            sender: transfer::Sender::new(size),
            phase: Phase::Begin,
            stalls: 0,
        }));
        self.begin_transfer()
    }

    /// Bytes notified by the device (frames may span several notifications).
    pub fn on_bytes(&mut self, bytes: &[u8]) -> Step {
        self.rx.extend_from_slice(bytes);
        let mut step = self.idle_step();
        loop {
            let (op, seq, payload, used) = match Frame::decode(&self.rx) {
                Ok((f, used)) => (f.op, f.seq, f.payload.to_vec(), used),
                Err(protocol_cc600::Error::Incomplete { .. }) => break,
                // Garbage or a damaged frame: drop what is buffered, the next frame starts afresh.
                Err(_) => {
                    self.rx.clear();
                    break;
                }
            };
            self.rx.drain(..used);
            let s = self.on_frame(op, seq, &payload);
            step.writes.extend(s.writes);
            step.events.extend(s.events);
        }
        step.wait = self.wait();
        step
    }

    /// The device said nothing for the time [`Step::wait`] called for.
    pub fn on_silence(&mut self) -> Step {
        match &mut self.op {
            State::Idle => self.idle_step(),
            State::Transfer(t) if matches!(t.phase, Phase::Stream) => {
                t.stalls += 1;
                if t.stalls > MAX_STALLS {
                    self.fail(Failure::Stalled)
                } else {
                    self.begin_transfer()
                }
            }
            _ => self.fail(Failure::Timeout),
        }
    }

    // ---- requests ------------------------------------------------------

    fn next_seq(&mut self) -> u8 {
        self.seq = self.seq.wrapping_add(1);
        self.seq
    }

    fn frame(&mut self, op: Op, payload: &[u8]) -> Vec<u8> {
        let seq = self.next_seq();
        let f = Frame::new(op, seq, payload);
        let mut buf = vec![0; f.encoded_len()];
        // Payloads built here fit `MAX_PAYLOAD`; a too long settings change is cut by the device's check.
        let n = f.encode(&mut buf).map(|b| b.len()).unwrap_or(0);
        buf.truncate(n);
        buf
    }

    fn request(&mut self, op: Op, payload: &[u8]) -> Vec<u8> {
        let frame = self.frame(op, payload);
        self.current = self.seq;
        frame
    }

    fn start(&mut self, state: State, op: Op, payload: &[u8]) -> Step {
        self.op = state;
        let frame = self.request(op, payload);
        Step {
            writes: vec![frame],
            events: vec![],
            wait: Wait::Answer,
        }
    }

    fn read_next(&mut self, id: u32, offset: u32, size: u32) -> Step {
        let max = READ_CHUNK.min(size - offset) as u16;
        let req = ReadActivity { id, offset, max }.to_bytes();
        Step {
            writes: vec![self.request(Op::ReadActivity, &req)],
            events: vec![],
            wait: Wait::Answer,
        }
    }

    /// `TransferBegin`: also how a stalled transfer resumes, the device says where it is.
    fn begin_transfer(&mut self) -> Step {
        let State::Transfer(t) = &mut self.op else {
            return self.idle_step();
        };
        t.phase = Phase::Begin;
        let begin = t.begin.to_bytes();
        Step {
            writes: vec![self.request(Op::TransferBegin, &begin)],
            events: vec![],
            wait: Wait::Answer,
        }
    }

    /// Chunks up to the window, then `TransferEnd` once all is acknowledged.
    fn pump(&mut self, events: Vec<Event>) -> Step {
        let State::Transfer(mut t) = core::mem::replace(&mut self.op, State::Idle) else {
            return self.idle_step();
        };
        let mut writes = Vec::new();
        while let Some((offset, len)) = t.sender.next_chunk(TRANSFER_CHUNK) {
            let mut p = transfer::chunk_header(offset).to_vec();
            p.extend_from_slice(&t.file[offset as usize..(offset + len) as usize]);
            writes.push(self.frame(Op::TransferChunk, &p));
        }
        let wait = if t.sender.all_sent() && t.sender.permille() == 1000 {
            t.phase = Phase::End;
            writes.push(self.request(Op::TransferEnd, &[]));
            Wait::Answer
        } else {
            t.phase = Phase::Stream;
            Wait::Transfer
        };
        self.op = State::Transfer(t);
        Step {
            writes,
            events,
            wait,
        }
    }

    // ---- answers -------------------------------------------------------

    fn on_frame(&mut self, op: Op, seq: u8, payload: &[u8]) -> Step {
        let transfer = matches!(self.op, State::Transfer(_));
        // Acks and errors of a transfer answer chunks, each with its own seq.
        let mine = seq == self.current
            || (transfer && matches!(op, Op::TransferAck | Op::TransferResend | Op::Error));
        if !mine || !self.busy() {
            return self.idle_step();
        }
        if op == Op::Error {
            return self.fail(device_error(payload));
        }
        match (&mut self.op, op) {
            (State::Hello, Op::DeviceInfo) => self.done(Event::Info(payload.to_vec())),
            (State::List(list), Op::ActivityEntry) => {
                list.extend(ActivityEntry::from_bytes(payload));
                self.idle_step()
            }
            (State::List(list), Op::EndOfList) => {
                let list = core::mem::take(list);
                self.done(Event::Activities(list))
            }
            (State::Read { id, data, size }, Op::ActivityChunk) => {
                if payload.is_empty() {
                    return self.fail(Failure::Interrupted);
                }
                let room = (*size as usize).saturating_sub(data.len());
                data.extend_from_slice(&payload[..payload.len().min(room)]);
                let (id, done, size) = (*id, data.len() as u32, *size);
                let progress = Event::Progress { done, total: size };
                if done < size {
                    let mut step = self.read_next(id, done, size);
                    step.events.push(progress);
                    return step;
                }
                let State::Read { data, .. } = core::mem::replace(&mut self.op, State::Idle) else {
                    unreachable!()
                };
                Step {
                    writes: vec![],
                    events: vec![progress, Event::File(data)],
                    wait: Wait::Nothing,
                }
            }
            (State::Ack | State::SetSettings, Op::Ok) => self.done(Event::Done),
            (State::GetSettings, Op::Settings) => self.done(Event::Settings(
                String::from_utf8_lossy(payload).into_owned(),
            )),
            (State::Transfer(t), _) => match (&t.phase, op) {
                (Phase::Begin, Op::TransferReady) => {
                    let Some(ready) = Ready::from_bytes(payload) else {
                        return self.fail(Failure::Device(ErrorCode::BadRequest));
                    };
                    t.sender.ready(ready);
                    let p = progress(&t.sender);
                    self.pump(vec![p])
                }
                (Phase::Stream, Op::TransferAck | Op::TransferResend) => {
                    let Some(ack) = Ack::from_bytes(payload) else {
                        return self.idle_step();
                    };
                    t.stalls = 0;
                    if op == Op::TransferAck {
                        t.sender.ack(ack);
                    } else {
                        t.sender.resend(ack);
                    }
                    let p = progress(&t.sender);
                    self.pump(vec![p])
                }
                (Phase::End, Op::Ok) => self.done(Event::Done),
                _ => self.idle_step(),
            },
            _ => self.idle_step(),
        }
    }

    fn wait(&self) -> Wait {
        match &self.op {
            State::Idle => Wait::Nothing,
            State::Transfer(t) if matches!(t.phase, Phase::Stream) => Wait::Transfer,
            _ => Wait::Answer,
        }
    }

    fn idle_step(&self) -> Step {
        Step {
            writes: vec![],
            events: vec![],
            wait: self.wait(),
        }
    }

    fn idle(&self, e: Event) -> Step {
        Step {
            writes: vec![],
            events: vec![e],
            wait: Wait::Nothing,
        }
    }

    fn done(&mut self, e: Event) -> Step {
        self.op = State::Idle;
        self.idle(e)
    }

    fn fail(&mut self, f: Failure) -> Step {
        self.done(Event::Failed(f))
    }
}

fn progress(s: &transfer::Sender) -> Event {
    Event::Progress {
        done: s.permille(),
        total: 1000,
    }
}

fn device_error(payload: &[u8]) -> Failure {
    match payload.split_first() {
        Some((&code, key)) if code == ErrorCode::BadSetting as u8 => {
            Failure::BadSetting(String::from_utf8_lossy(key).into_owned())
        }
        Some((&code, _)) => {
            ErrorCode::from_u8(code).map_or(Failure::Unknown(code), Failure::Device)
        }
        None => Failure::Unknown(0),
    }
}

#[cfg(test)]
mod tests;
