//! Sending a file (route, map) to the device, built for a slow, lossy link.
//!
//! ```text
//! app                                   device
//!  | TransferBegin(kind, size, crc) ----> |  checks space, finds a matching partial file
//!  | <---- TransferReady(next, window)    |  next > 0: resume
//!  | TransferChunk(offset, bytes) ... --> |  up to `window` bytes in flight
//!  | <---- TransferAck(next)              |  every window/2 bytes, and at the end
//!  | <---- TransferResend(next)           |  a chunk was missing: resend from `next`
//!  | TransferEnd -----------------------> |  verifies size + CRC, commits atomically
//!  | <---- Ok / Error(code)               |
//! ```
//!
//! The device keeps the partial file and its running CRC across disconnections,
//! so a new `TransferBegin` with the same kind, size and CRC resumes where it
//! stopped. A chunk that is not the expected one is not written: the device
//! answers once with `TransferResend(next)` and the app resends from there.
//! If the app hears nothing for a while (lost ack, lost last chunk), it sends
//! `TransferBegin` again and the device says where it is.
//!
//! This module is sans-IO: [`Receiver`] (device) and [`Sender`] (app) only
//! decide; the host does the writes, the radio and the persistence of
//! [`Receiver::progress`].

pub use crate::ErrorCode;
use crate::{crc16_update, CRC16_INIT};

/// What a transferred file is. The device decides what to do when it commits.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
#[repr(u8)]
pub enum Kind {
    /// Route file (`OCRT`): replaces the active route.
    Route = 1,
    /// Corridor map (`OCMP`) of the active route.
    Map = 2,
}

impl Kind {
    pub fn from_u8(v: u8) -> Option<Self> {
        match v {
            1 => Some(Self::Route),
            2 => Some(Self::Map),
            _ => None,
        }
    }
}

/// `TransferBegin` payload.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Begin {
    pub kind: Kind,
    pub size: u32,
    /// CRC-16/CCITT-FALSE of the whole file.
    pub crc: u16,
}

impl Begin {
    pub const LEN: usize = 7;

    pub fn to_bytes(&self) -> [u8; Self::LEN] {
        let mut b = [0u8; Self::LEN];
        b[0] = self.kind as u8;
        b[1..5].copy_from_slice(&self.size.to_le_bytes());
        b[5..7].copy_from_slice(&self.crc.to_le_bytes());
        b
    }

    pub fn from_bytes(b: &[u8]) -> Option<Self> {
        if b.len() != Self::LEN {
            return None;
        }
        Some(Self {
            kind: Kind::from_u8(b[0])?,
            size: u32::from_le_bytes(b[1..5].try_into().ok()?),
            crc: u16::from_le_bytes(b[5..7].try_into().ok()?),
        })
    }
}

/// `TransferReady` payload.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Ready {
    /// First byte the device wants (0 for a new file, more to resume).
    pub next: u32,
    /// Bytes the app may have sent and not yet seen acknowledged.
    pub window: u16,
}

impl Ready {
    pub const LEN: usize = 6;

    pub fn to_bytes(&self) -> [u8; Self::LEN] {
        let mut b = [0u8; Self::LEN];
        b[0..4].copy_from_slice(&self.next.to_le_bytes());
        b[4..6].copy_from_slice(&self.window.to_le_bytes());
        b
    }

    pub fn from_bytes(b: &[u8]) -> Option<Self> {
        if b.len() != Self::LEN {
            return None;
        }
        Some(Self {
            next: u32::from_le_bytes(b[0..4].try_into().ok()?),
            window: u16::from_le_bytes(b[4..6].try_into().ok()?),
        })
    }
}

/// `TransferAck` and `TransferResend` payload: the device holds the file up
/// to `next` (excluded).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Ack {
    pub next: u32,
}

impl Ack {
    pub const LEN: usize = 4;

    pub fn to_bytes(&self) -> [u8; Self::LEN] {
        self.next.to_le_bytes()
    }

    pub fn from_bytes(b: &[u8]) -> Option<Self> {
        Some(Self {
            next: u32::from_le_bytes(b.try_into().ok()?),
        })
    }
}

/// Splits a `TransferChunk` payload into its offset and bytes.
pub fn parse_chunk(payload: &[u8]) -> Option<(u32, &[u8])> {
    let (offset, data) = payload.split_first_chunk::<4>()?;
    Some((u32::from_le_bytes(*offset), data))
}

/// Writes the offset of a `TransferChunk` payload; the bytes follow it.
pub fn chunk_header(offset: u32) -> [u8; 4] {
    offset.to_le_bytes()
}

/// What the device keeps of an interrupted transfer, to resume it.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Partial {
    pub begin: Begin,
    /// Bytes written so far.
    pub received: u32,
    /// Running CRC of those bytes ([`Receiver::progress`]).
    pub running_crc: u16,
}

/// Device side of a transfer.
#[derive(Clone, Debug)]
pub struct Receiver {
    active: Option<Begin>,
    next: u32,
    crc: u16,
    window: u16,
    unacked: u32,
    /// A resend was requested and the expected chunk has not come yet.
    rewound: bool,
}

/// Result of [`Receiver::chunk`].
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Chunk {
    /// The chunk is the expected one: write it at its offset, persist
    /// [`Receiver::progress`], then send the ack if any.
    Accept(Option<Ack>),
    /// Out of order: do not write; send `TransferResend` so the app resends
    /// from there.
    Resend(Ack),
    /// Out of order and already answered: do nothing.
    Ignore,
}

impl Receiver {
    pub const fn new(window: u16) -> Self {
        Self {
            active: None,
            next: 0,
            crc: CRC16_INIT,
            window,
            unacked: 0,
            rewound: false,
        }
    }

    /// Handles `TransferBegin`. `partial` is what the device kept of an earlier
    /// attempt (it is used only if it is the same file) and `free` the bytes
    /// still available for it, counting the partial file's own bytes as free.
    ///
    /// On `Ok`, the host answers `TransferReady` and, if `ready.next == 0`,
    /// starts a new file (dropping any other partial one).
    pub fn begin(
        &mut self,
        begin: Begin,
        partial: Option<Partial>,
        free: u32,
    ) -> Result<Ready, ErrorCode> {
        self.active = None;
        if begin.size == 0 {
            return Err(ErrorCode::BadRequest);
        }
        if begin.size > free {
            return Err(ErrorCode::NoSpace);
        }
        let (next, crc) = match partial {
            Some(p) if p.begin == begin && p.received < begin.size => (p.received, p.running_crc),
            _ => (0, CRC16_INIT),
        };
        self.active = Some(begin);
        self.next = next;
        self.crc = crc;
        self.unacked = 0;
        self.rewound = false;
        Ok(Ready {
            next,
            window: self.window,
        })
    }

    /// Handles `TransferChunk`.
    pub fn chunk(&mut self, offset: u32, data: &[u8]) -> Result<Chunk, ErrorCode> {
        let begin = self.active.ok_or(ErrorCode::NoTransfer)?;
        if offset != self.next {
            return Ok(if core::mem::replace(&mut self.rewound, true) {
                Chunk::Ignore
            } else {
                Chunk::Resend(Ack { next: self.next })
            });
        }
        let len = u32::try_from(data.len()).map_err(|_| ErrorCode::BadRequest)?;
        if len == 0 || len > begin.size - self.next {
            return Err(ErrorCode::BadRequest);
        }
        self.crc = crc16_update(self.crc, data);
        self.next += len;
        self.unacked += len;
        self.rewound = false;
        let ack = if self.next == begin.size || self.unacked >= u32::from(self.window) / 2 {
            self.unacked = 0;
            Some(Ack { next: self.next })
        } else {
            None
        };
        Ok(Chunk::Accept(ack))
    }

    /// Handles `TransferEnd`: on `Ok` the host commits the file and answers
    /// `Ok`. On `BadCrc` it must drop the partial file.
    pub fn end(&mut self) -> Result<Begin, ErrorCode> {
        let begin = self.active.ok_or(ErrorCode::NoTransfer)?;
        if self.next != begin.size {
            return Err(ErrorCode::Incomplete);
        }
        self.active = None;
        if self.crc != begin.crc {
            return Err(ErrorCode::BadCrc);
        }
        Ok(begin)
    }

    /// Handles `TransferAbort` and a lost connection (the partial file stays
    /// on the device unless the host drops it).
    pub fn abort(&mut self) {
        self.active = None;
    }

    /// To persist after each accepted chunk, to be able to resume.
    pub fn progress(&self) -> Option<Partial> {
        self.active.map(|begin| Partial {
            begin,
            received: self.next,
            running_crc: self.crc,
        })
    }
}

/// App side of a transfer: decides what to send next.
#[derive(Clone, Debug)]
pub struct Sender {
    size: u32,
    window: u32,
    /// First byte not yet sent.
    sent: u32,
    /// First byte not yet acknowledged.
    acked: u32,
}

impl Sender {
    pub const fn new(size: u32) -> Self {
        Self {
            size,
            window: 0,
            sent: 0,
            acked: 0,
        }
    }

    /// Applies `TransferReady`: (re)starts from `ready.next`.
    pub fn ready(&mut self, ready: Ready) {
        self.window = u32::from(ready.window);
        self.sent = ready.next.min(self.size);
        self.acked = self.sent;
    }

    /// Applies `TransferAck`: frees room in the window. Chunks in flight
    /// after `ack.next` are normal, nothing is resent.
    pub fn ack(&mut self, ack: Ack) {
        self.acked = self.acked.max(ack.next.min(self.sent));
    }

    /// Applies `TransferResend`: sends again from `ack.next`.
    pub fn resend(&mut self, ack: Ack) {
        let next = ack.next.min(self.size);
        self.sent = next;
        self.acked = next;
    }

    /// Next chunk to send as `(offset, length)`, at most `max` bytes, or
    /// `None` when the window is full or everything was sent.
    pub fn next_chunk(&mut self, max: u32) -> Option<(u32, u32)> {
        let room = self.window.saturating_sub(self.sent - self.acked);
        let len = max.min(room).min(self.size - self.sent);
        if len == 0 {
            return None;
        }
        let offset = self.sent;
        self.sent += len;
        Some((offset, len))
    }

    /// All bytes were sent (not necessarily acknowledged).
    pub fn all_sent(&self) -> bool {
        self.sent == self.size
    }

    /// Fraction of the file the device holds, in 0..=1000.
    pub fn permille(&self) -> u32 {
        (u64::from(self.acked) * 1000 / u64::from(self.size.max(1))) as u32
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{crc16_ccitt, Frame, Op};

    fn file(n: usize) -> std::vec::Vec<u8> {
        (0..n).map(|i| (i * 7 + i / 251) as u8).collect()
    }

    /// Runs a transfer between a `Sender` and a `Receiver` over a link that
    /// drops the chunks listed in `lose` (by order of emission) and stops
    /// after `cut` chunks. When nothing comes back, the sender begins again,
    /// as the app does after a silence. Returns the file bytes sent.
    fn run(
        data: &[u8],
        rx: &mut Receiver,
        stored: &mut std::vec::Vec<u8>,
        partial: &mut Option<Partial>,
        lose: &[usize],
        cut: Option<usize>,
        mtu: u32,
    ) -> Result<usize, ErrorCode> {
        let begin = Begin {
            kind: Kind::Route,
            size: data.len() as u32,
            crc: crc16_ccitt(data),
        };
        let ready = rx.begin(begin, *partial, 1 << 20)?;
        stored.truncate(ready.next as usize);
        let mut tx = Sender::new(begin.size);
        tx.ready(ready);
        let (mut emitted, mut bytes_sent) = (0, 0);
        loop {
            let mut progressed = false;
            while let Some((offset, len)) = tx.next_chunk(mtu) {
                progressed = true;
                emitted += 1;
                bytes_sent += len as usize;
                if cut == Some(emitted) {
                    rx.abort();
                    return Err(ErrorCode::Busy);
                }
                if lose.contains(&emitted) {
                    continue;
                }
                let bytes = &data[offset as usize..(offset + len) as usize];
                match rx.chunk(offset, bytes)? {
                    Chunk::Accept(ack) => {
                        stored.extend_from_slice(bytes);
                        *partial = rx.progress();
                        if let Some(a) = ack {
                            tx.ack(a);
                        }
                    }
                    Chunk::Resend(a) => tx.resend(a),
                    Chunk::Ignore => {}
                }
            }
            if tx.all_sent() && tx.permille() == 1000 {
                break;
            }
            if !progressed {
                let ready = rx.begin(begin, *partial, 1 << 20)?;
                tx.ready(ready);
            }
        }
        rx.end()?;
        *partial = None;
        Ok(bytes_sent)
    }

    #[test]
    fn whole_file() {
        let data = file(10_000);
        let (mut rx, mut stored, mut partial) = (Receiver::new(2048), std::vec![], None);
        let sent = run(&data, &mut rx, &mut stored, &mut partial, &[], None, 240).unwrap();
        assert_eq!(stored, data);
        assert_eq!(sent, data.len(), "each byte sent once on a clean link");
    }

    #[test]
    fn lost_last_chunk_is_found_by_beginning_again() {
        let data = file(1000);
        let (mut rx, mut stored, mut partial) = (Receiver::new(2048), std::vec![], None);
        run(&data, &mut rx, &mut stored, &mut partial, &[5], None, 240).unwrap();
        assert_eq!(stored, data);
    }

    #[test]
    fn lost_chunk_is_rewound_and_resent() {
        let data = file(10_000);
        let (mut rx, mut stored, mut partial) = (Receiver::new(2048), std::vec![], None);
        run(
            &data,
            &mut rx,
            &mut stored,
            &mut partial,
            &[3, 4, 20],
            None,
            240,
        )
        .unwrap();
        assert_eq!(stored, data);
    }

    #[test]
    fn resumes_after_a_cut() {
        let data = file(10_000);
        let (mut rx, mut stored, mut partial) = (Receiver::new(2048), std::vec![], None);
        assert!(run(
            &data,
            &mut rx,
            &mut stored,
            &mut partial,
            &[],
            Some(20),
            240
        )
        .is_err());
        let kept = partial.unwrap().received;
        assert!(kept > 0 && (kept as usize) < data.len());
        // A new receiver (the device may have rebooted) resumes from the stored state.
        let mut rx = Receiver::new(2048);
        let sent = run(&data, &mut rx, &mut stored, &mut partial, &[], None, 240).unwrap();
        assert_eq!(stored, data);
        assert_eq!(sent, data.len() - kept as usize, "only the missing part");
    }

    #[test]
    fn a_different_file_does_not_resume() {
        let data = file(10_000);
        let (mut rx, mut stored, mut partial) = (Receiver::new(2048), std::vec![], None);
        assert!(run(
            &data,
            &mut rx,
            &mut stored,
            &mut partial,
            &[],
            Some(20),
            240
        )
        .is_err());
        let other = file(9_000);
        let mut rx = Receiver::new(2048);
        let begin = Begin {
            kind: Kind::Route,
            size: other.len() as u32,
            crc: crc16_ccitt(&other),
        };
        assert_eq!(rx.begin(begin, partial, 1 << 20).unwrap().next, 0);
    }

    #[test]
    fn corrupted_data_is_refused_at_the_end() {
        let data = file(1000);
        let begin = Begin {
            kind: Kind::Map,
            size: 1000,
            crc: crc16_ccitt(&data),
        };
        let mut rx = Receiver::new(2048);
        rx.begin(begin, None, 1 << 20).unwrap();
        let mut bad = data.clone();
        bad[500] ^= 1;
        rx.chunk(0, &bad).unwrap();
        assert_eq!(rx.end(), Err(ErrorCode::BadCrc));
        assert_eq!(rx.end(), Err(ErrorCode::NoTransfer));
    }

    #[test]
    fn refuses_what_does_not_fit_and_misuse() {
        let mut rx = Receiver::new(2048);
        let begin = Begin {
            kind: Kind::Map,
            size: 5000,
            crc: 0,
        };
        assert_eq!(rx.begin(begin, None, 4999), Err(ErrorCode::NoSpace));
        assert_eq!(rx.chunk(0, &[1]), Err(ErrorCode::NoTransfer));
        rx.begin(begin, None, 5000).unwrap();
        assert_eq!(rx.end(), Err(ErrorCode::Incomplete));
        assert_eq!(rx.chunk(0, &[0; 5001]), Err(ErrorCode::BadRequest));
    }

    #[test]
    fn only_one_resend_per_gap() {
        let mut rx = Receiver::new(2048);
        let begin = Begin {
            kind: Kind::Route,
            size: 1000,
            crc: 0,
        };
        rx.begin(begin, None, 1 << 20).unwrap();
        assert_eq!(rx.chunk(100, &[0; 10]), Ok(Chunk::Resend(Ack { next: 0 })));
        assert_eq!(rx.chunk(110, &[0; 10]), Ok(Chunk::Ignore));
        assert!(matches!(rx.chunk(0, &[0; 10]), Ok(Chunk::Accept(_))));
    }

    #[test]
    fn payloads_roundtrip_in_frames() {
        let begin = Begin {
            kind: Kind::Map,
            size: 123_456,
            crc: 0xBEEF,
        };
        let mut buf = [0u8; 32];
        let n = Frame::new(Op::TransferBegin, 9, &begin.to_bytes())
            .encode(&mut buf)
            .unwrap()
            .len();
        let (f, _) = Frame::decode(&buf[..n]).unwrap();
        assert_eq!(Begin::from_bytes(f.payload), Some(begin));
        let ready = Ready {
            next: 4096,
            window: 2048,
        };
        assert_eq!(Ready::from_bytes(&ready.to_bytes()), Some(ready));
        assert_eq!(
            Ack::from_bytes(&Ack { next: 7 }.to_bytes()),
            Some(Ack { next: 7 })
        );
        let mut chunk = std::vec::Vec::from(chunk_header(300));
        chunk.extend_from_slice(&[1, 2, 3]);
        assert_eq!(parse_chunk(&chunk), Some((300, &[1u8, 2, 3][..])));
    }
}
