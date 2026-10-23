//! A CC600 at the other end of the link, in memory: frames in, frames out.
//! File transfers go through the firmware's own [`transfer::Receiver`] and
//! settings through `settings-cc600`, as on the device. For tests and to try
//! the app without a device.

use protocol_cc600::payload::{ActivityEntry, DeviceInfo, ReadActivity};
use protocol_cc600::transfer::{self, Begin, Chunk, ErrorCode};
use protocol_cc600::{Frame, Op};

/// Seconds between the Unix epoch and the FIT epoch (1989-12-31).
pub const FIT_EPOCH_OFFSET: i64 = 631_065_600;

#[derive(Clone, Debug, Default)]
pub struct Config {
    /// Transfer window the device offers (2048 if 0).
    pub window: u16,
    /// Free bytes for a file (1 MiB if 0).
    pub free: u32,
    /// The settings file (`key=value` lines; defaults if empty).
    pub settings: String,
    /// `TransferChunk`s lost on the way, by order of arrival (1-based, over the device's life).
    pub lose_chunks: Vec<u32>,
    /// `TransferAck`s lost on the way, the same way.
    pub lose_acks: Vec<u32>,
}

#[derive(Clone, Debug)]
struct Activity {
    id: u32,
    start_time: i64,
    fit: Vec<u8>,
}

/// A simulated CC600.
pub struct Device {
    cfg: Config,
    activities: Vec<Activity>,
    rx: transfer::Receiver,
    partial: Option<transfer::Partial>,
    data: Vec<u8>,
    committed: Option<Vec<u8>>,
    buffer: Vec<u8>,
    chunks: u32,
    acks: u32,
    /// File bytes received in `TransferChunk`s, lost ones included.
    pub chunk_bytes: u32,
    /// Ride ids acknowledged by the app, in order.
    pub acked: Vec<u32>,
    /// The settings file, rewritten whole on each change as the firmware does.
    pub settings: String,
    /// `SetSettings` payloads received, in order.
    pub settings_writes: Vec<String>,
}

impl Device {
    pub fn new(cfg: Config) -> Self {
        let window = if cfg.window == 0 { 2048 } else { cfg.window };
        Self {
            settings: cfg.settings.clone(),
            cfg,
            activities: Vec::new(),
            rx: transfer::Receiver::new(window),
            partial: None,
            data: Vec::new(),
            committed: None,
            buffer: Vec::new(),
            chunks: 0,
            acks: 0,
            chunk_bytes: 0,
            acked: Vec::new(),
            settings_writes: Vec::new(),
        }
    }

    /// A ride on the device; `start_time` in Unix seconds.
    pub fn add_activity(&mut self, id: u32, start_time: i64, fit: Vec<u8>) {
        self.activities.push(Activity {
            id,
            start_time,
            fit,
        });
    }

    /// Bytes written by the app (a frame may come in several writes);
    /// returns the frames the device answers, in order.
    pub fn write(&mut self, bytes: &[u8]) -> Vec<Vec<u8>> {
        self.buffer.extend_from_slice(bytes);
        let mut out = Vec::new();
        loop {
            let (op, seq, payload, used) = match Frame::decode(&self.buffer) {
                Ok((f, used)) => (f.op, f.seq, f.payload.to_vec(), used),
                Err(protocol_cc600::Error::Incomplete { .. }) => break,
                Err(_) => {
                    self.buffer.clear();
                    break;
                }
            };
            self.buffer.drain(..used);
            for (op, p) in self.handle(op, &payload) {
                let f = Frame::new(op, seq, &p);
                let mut buf = vec![0; f.encoded_len()];
                if f.encode(&mut buf).is_ok() {
                    out.push(buf);
                }
            }
        }
        out
    }

    /// The link dropped: the partial file stays, as on the device.
    pub fn disconnect(&mut self) {
        self.rx.abort();
        self.buffer.clear();
    }

    /// Bytes of the partial file held so far.
    pub fn received(&self) -> u32 {
        self.partial.map_or(0, |p| p.received)
    }

    /// Free bytes for a file, whatever its kind.
    fn free(&self) -> u32 {
        if self.cfg.free == 0 {
            1 << 20
        } else {
            self.cfg.free
        }
    }

    /// The last file committed by `TransferEnd`.
    pub fn committed(&self) -> Option<&[u8]> {
        self.committed.as_deref()
    }

    fn handle(&mut self, op: Op, p: &[u8]) -> Vec<(Op, Vec<u8>)> {
        let one = |op: Op, p: &[u8]| vec![(op, p.to_vec())];
        let fail = |code: ErrorCode| vec![(Op::Error, vec![code as u8])];
        match op {
            Op::Hello => {
                let free = self.free();
                one(
                    Op::DeviceInfo,
                    &DeviceInfo {
                        route_max: free,
                        map_max: free,
                        free,
                    }
                    .to_bytes(),
                )
            }
            Op::ListActivities => {
                let mut out: Vec<_> = self
                    .activities
                    .iter()
                    .map(|a| {
                        let e = ActivityEntry {
                            id: a.id,
                            start_time: (a.start_time - FIT_EPOCH_OFFSET) as u32,
                            size: a.fit.len() as u32,
                            synced: self.acked.contains(&a.id),
                        };
                        (Op::ActivityEntry, e.to_bytes().to_vec())
                    })
                    .collect();
                out.push((Op::EndOfList, vec![]));
                out
            }
            Op::ReadActivity => {
                let Some(r) = ReadActivity::from_bytes(p) else {
                    return fail(ErrorCode::BadRequest);
                };
                let Some(a) = self.activities.iter().find(|a| a.id == r.id) else {
                    return fail(ErrorCode::BadRequest);
                };
                let start = (r.offset as usize).min(a.fit.len());
                let end = (start + r.max as usize).min(a.fit.len());
                one(Op::ActivityChunk, &a.fit[start..end])
            }
            Op::AckActivity => {
                if let Some(id) = p.first_chunk::<4>() {
                    self.acked.push(u32::from_le_bytes(*id));
                }
                one(Op::Ok, &[])
            }
            Op::GetSettings => one(Op::Settings, self.settings.as_bytes()),
            Op::SetSettings => {
                let changes = String::from_utf8_lossy(p).into_owned();
                self.settings_writes.push(changes.clone());
                let current = settings_cc600::Settings::parse(&self.settings);
                match current.apply(&changes) {
                    Ok(s) => {
                        let mut text = String::new();
                        let _ = s.write(&mut text);
                        self.settings = text;
                        one(Op::Ok, &[])
                    }
                    Err((key, _)) => {
                        let mut e = vec![ErrorCode::BadSetting as u8];
                        e.extend_from_slice(key.as_bytes());
                        vec![(Op::Error, e)]
                    }
                }
            }
            Op::TransferBegin => {
                let Some(begin) = Begin::from_bytes(p) else {
                    return fail(ErrorCode::BadRequest);
                };
                match self.rx.begin(begin, self.partial, self.free()) {
                    Ok(ready) => {
                        self.data.truncate(ready.next as usize);
                        self.partial = self.rx.progress();
                        one(Op::TransferReady, &ready.to_bytes())
                    }
                    Err(code) => fail(code),
                }
            }
            Op::TransferChunk => {
                let Some((offset, bytes)) = transfer::parse_chunk(p) else {
                    return fail(ErrorCode::BadRequest);
                };
                self.chunk_bytes += bytes.len() as u32;
                self.chunks += 1;
                if self.cfg.lose_chunks.contains(&self.chunks) {
                    return vec![];
                }
                match self.rx.chunk(offset, bytes) {
                    Ok(Chunk::Accept(ack)) => {
                        self.data.extend_from_slice(bytes);
                        self.partial = self.rx.progress();
                        let Some(ack) = ack else { return vec![] };
                        self.acks += 1;
                        if self.cfg.lose_acks.contains(&self.acks) {
                            return vec![];
                        }
                        one(Op::TransferAck, &ack.to_bytes())
                    }
                    Ok(Chunk::Resend(a)) => one(Op::TransferResend, &a.to_bytes()),
                    Ok(Chunk::Ignore) => vec![],
                    Err(code) => fail(code),
                }
            }
            Op::TransferEnd => match self.rx.end() {
                Ok(_) => {
                    self.partial = None;
                    self.committed = Some(core::mem::take(&mut self.data));
                    one(Op::Ok, &[])
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
                one(Op::Ok, &[])
            }
            _ => fail(ErrorCode::BadRequest),
        }
    }
}
