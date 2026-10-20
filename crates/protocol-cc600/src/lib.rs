//! Wire protocol between the OpenCC600 firmware and companion apps.
//!
//! This crate is shared by the firmware (GPL-3.0, `no_std`) and the apps
//! (MIT). It is MIT-licensed and must stay free of any code derived from
//! GPL sources (e.g. c606-oss) so both sides can use it.
//!
//! It is deliberately dependency-free, `no_std` and allocation-free.
//!
//! # Framing
//!
//! Every message is one frame:
//!
//! ```text
//! +--------+-------+-----+-------------+-----------+---------+
//! | ver u8 | op u8 | seq | len u16 LE  | payload   | crc u16 |
//! |        |       | u8  |             | len bytes | LE      |
//! +--------+-------+-----+-------------+-----------+---------+
//! ```
//!
//! The CRC is CRC-16/CCITT-FALSE over everything before it. Over BLE a frame
//! may be split across several GATT writes/notifications; the receiver
//! reassembles using `len`.

#![no_std]

#[cfg(test)]
extern crate std;

pub mod ble;
mod crc;
pub mod transfer;

pub use crc::{crc16_ccitt, crc16_update, CRC16_INIT};

/// Protocol version carried in every frame. Bump on breaking changes.
pub const PROTOCOL_VERSION: u8 = 1;

/// Header size: version + opcode + seq + len.
pub const HEADER_LEN: usize = 5;
/// Trailer size: CRC.
pub const TRAILER_LEN: usize = 2;
/// Largest payload a frame may carry.
pub const MAX_PAYLOAD: usize = 4096;
/// Largest encoded frame.
pub const MAX_FRAME: usize = HEADER_LEN + MAX_PAYLOAD + TRAILER_LEN;

/// Operation codes. Requests come from the app, responses/events from the
/// device. Responses reuse the request's `seq`.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
#[repr(u8)]
pub enum Op {
    // --- requests (app -> device)
    /// Handshake; payload empty. Answered by `DeviceInfo`.
    Hello = 0x01,
    /// List recorded activities. Answered by one `ActivityEntry` per
    /// activity, then `EndOfList`.
    ListActivities = 0x02,
    /// Read a chunk of an activity file. Payload: id u32, offset u32, max u16.
    ReadActivity = 0x03,
    /// Mark an activity as safely copied (device may free it later).
    /// Payload: id u32, crc u16 of the full file as received.
    AckActivity = 0x04,
    /// Start (or resume) sending a file to the device. See [`transfer`].
    TransferBegin = 0x10,
    /// File data. Payload: offset u32 + bytes. Sent without waiting for answers
    /// (up to the window announced in `TransferReady`).
    TransferChunk = 0x11,
    /// All bytes sent: verify and commit (replaces the active route / map).
    TransferEnd = 0x12,
    /// Give up; the device drops the partial file.
    TransferAbort = 0x13,
    /// Read settings blob.
    GetSettings = 0x20,
    /// Write settings blob.
    SetSettings = 0x21,

    // --- responses / events (device -> app)
    DeviceInfo = 0x81,
    ActivityEntry = 0x82,
    ActivityChunk = 0x83,
    EndOfList = 0x84,
    /// Answer to `TransferBegin`: where to (re)start and how much may be in flight.
    TransferReady = 0x90,
    /// Progress: the device holds the file up to `next`.
    TransferAck = 0x91,
    /// A chunk was missing: send again from `next`.
    TransferResend = 0x92,
    Settings = 0xA0,
    Ok = 0xF0,
    Error = 0xFF,
}

impl Op {
    pub fn from_u8(v: u8) -> Option<Self> {
        use Op::*;
        Some(match v {
            0x01 => Hello,
            0x02 => ListActivities,
            0x03 => ReadActivity,
            0x04 => AckActivity,
            0x10 => TransferBegin,
            0x11 => TransferChunk,
            0x12 => TransferEnd,
            0x13 => TransferAbort,
            0x20 => GetSettings,
            0x21 => SetSettings,
            0x81 => DeviceInfo,
            0x82 => ActivityEntry,
            0x83 => ActivityChunk,
            0x84 => EndOfList,
            0x90 => TransferReady,
            0x91 => TransferAck,
            0x92 => TransferResend,
            0xA0 => Settings,
            0xF0 => Ok,
            0xFF => Error,
            _ => return None,
        })
    }

    /// True for app -> device messages.
    pub fn is_request(self) -> bool {
        (self as u8) < 0x80
    }
}

/// A decoded frame borrowing its payload from the input buffer.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Frame<'a> {
    pub op: Op,
    pub seq: u8,
    pub payload: &'a [u8],
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Error {
    /// Output buffer too small.
    BufferTooSmall,
    /// Payload larger than [`MAX_PAYLOAD`].
    PayloadTooLarge,
    /// Not enough bytes yet; `needed` is the full frame length if known.
    Incomplete {
        needed: Option<usize>,
    },
    UnsupportedVersion(u8),
    UnknownOp(u8),
    BadCrc {
        expected: u16,
        actual: u16,
    },
}

impl<'a> Frame<'a> {
    pub fn new(op: Op, seq: u8, payload: &'a [u8]) -> Self {
        Self { op, seq, payload }
    }

    /// Encoded length of this frame.
    pub fn encoded_len(&self) -> usize {
        HEADER_LEN + self.payload.len() + TRAILER_LEN
    }

    /// Encode into `out`, returning the written slice.
    pub fn encode<'o>(&self, out: &'o mut [u8]) -> Result<&'o [u8], Error> {
        if self.payload.len() > MAX_PAYLOAD {
            return Err(Error::PayloadTooLarge);
        }
        let n = self.encoded_len();
        if out.len() < n {
            return Err(Error::BufferTooSmall);
        }
        let len = self.payload.len() as u16;
        out[0] = PROTOCOL_VERSION;
        out[1] = self.op as u8;
        out[2] = self.seq;
        out[3..5].copy_from_slice(&len.to_le_bytes());
        out[HEADER_LEN..HEADER_LEN + self.payload.len()].copy_from_slice(self.payload);
        let crc = crc16_ccitt(&out[..n - TRAILER_LEN]);
        out[n - TRAILER_LEN..n].copy_from_slice(&crc.to_le_bytes());
        Ok(&out[..n])
    }

    /// Decode one frame from the start of `input`.
    ///
    /// Returns the frame and the number of bytes consumed.
    pub fn decode(input: &'a [u8]) -> Result<(Self, usize), Error> {
        if input.len() < HEADER_LEN {
            return Err(Error::Incomplete { needed: None });
        }
        if input[0] != PROTOCOL_VERSION {
            return Err(Error::UnsupportedVersion(input[0]));
        }
        let len = u16::from_le_bytes([input[3], input[4]]) as usize;
        if len > MAX_PAYLOAD {
            return Err(Error::PayloadTooLarge);
        }
        let n = HEADER_LEN + len + TRAILER_LEN;
        if input.len() < n {
            return Err(Error::Incomplete { needed: Some(n) });
        }
        let expected = u16::from_le_bytes([input[n - 2], input[n - 1]]);
        let actual = crc16_ccitt(&input[..n - TRAILER_LEN]);
        if expected != actual {
            return Err(Error::BadCrc { expected, actual });
        }
        let op = Op::from_u8(input[1]).ok_or(Error::UnknownOp(input[1]))?;
        Ok((
            Frame {
                op,
                seq: input[2],
                payload: &input[HEADER_LEN..HEADER_LEN + len],
            },
            n,
        ))
    }
}

/// Little helpers to build/read fixed payloads without allocation.
pub mod payload {
    /// `ReadActivity` request payload.
    #[derive(Clone, Copy, Debug, PartialEq, Eq)]
    pub struct ReadActivity {
        pub id: u32,
        pub offset: u32,
        pub max: u16,
    }

    impl ReadActivity {
        pub const LEN: usize = 10;

        pub fn to_bytes(&self) -> [u8; Self::LEN] {
            let mut b = [0u8; Self::LEN];
            b[0..4].copy_from_slice(&self.id.to_le_bytes());
            b[4..8].copy_from_slice(&self.offset.to_le_bytes());
            b[8..10].copy_from_slice(&self.max.to_le_bytes());
            b
        }

        pub fn from_bytes(b: &[u8]) -> Option<Self> {
            if b.len() != Self::LEN {
                return None;
            }
            Some(Self {
                id: u32::from_le_bytes(b[0..4].try_into().ok()?),
                offset: u32::from_le_bytes(b[4..8].try_into().ok()?),
                max: u16::from_le_bytes(b[8..10].try_into().ok()?),
            })
        }
    }

    /// `ActivityEntry` response payload.
    #[derive(Clone, Copy, Debug, PartialEq, Eq)]
    pub struct ActivityEntry {
        pub id: u32,
        /// Seconds since FIT epoch (1989-12-31T00:00:00Z).
        pub start_time: u32,
        pub size: u32,
        /// Already acknowledged by an app.
        pub synced: bool,
    }

    impl ActivityEntry {
        pub const LEN: usize = 13;

        pub fn to_bytes(&self) -> [u8; Self::LEN] {
            let mut b = [0u8; Self::LEN];
            b[0..4].copy_from_slice(&self.id.to_le_bytes());
            b[4..8].copy_from_slice(&self.start_time.to_le_bytes());
            b[8..12].copy_from_slice(&self.size.to_le_bytes());
            b[12] = self.synced as u8;
            b
        }

        pub fn from_bytes(b: &[u8]) -> Option<Self> {
            if b.len() != Self::LEN {
                return None;
            }
            Some(Self {
                id: u32::from_le_bytes(b[0..4].try_into().ok()?),
                start_time: u32::from_le_bytes(b[4..8].try_into().ok()?),
                size: u32::from_le_bytes(b[8..12].try_into().ok()?),
                synced: b[12] != 0,
            })
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn roundtrip() {
        let req = payload::ReadActivity {
            id: 7,
            offset: 1024,
            max: 512,
        }
        .to_bytes();
        let mut buf = [0u8; 64];
        let encoded = Frame::new(Op::ReadActivity, 42, &req)
            .encode(&mut buf)
            .unwrap();
        let n = encoded.len();
        let (frame, used) = Frame::decode(&buf[..n]).unwrap();
        assert_eq!(used, n);
        assert_eq!(frame.op, Op::ReadActivity);
        assert_eq!(frame.seq, 42);
        let p = payload::ReadActivity::from_bytes(frame.payload).unwrap();
        assert_eq!(p.offset, 1024);
    }

    #[test]
    fn detects_corruption() {
        let mut buf = [0u8; 32];
        let n = Frame::new(Op::Hello, 1, &[])
            .encode(&mut buf)
            .unwrap()
            .len();
        buf[2] ^= 0xFF;
        assert!(matches!(
            Frame::decode(&buf[..n]),
            Err(Error::BadCrc { .. })
        ));
    }

    #[test]
    fn incomplete_reports_needed_len() {
        let mut buf = [0u8; 32];
        let n = Frame::new(Op::Ok, 1, &[1, 2, 3])
            .encode(&mut buf)
            .unwrap()
            .len();
        assert_eq!(
            Frame::decode(&buf[..n - 1]),
            Err(Error::Incomplete { needed: Some(n) })
        );
    }

    #[test]
    fn activity_entry_roundtrip() {
        let e = payload::ActivityEntry {
            id: 3,
            start_time: 1_100_000_000,
            size: 182_044,
            synced: false,
        };
        assert_eq!(payload::ActivityEntry::from_bytes(&e.to_bytes()), Some(e));
    }
}
