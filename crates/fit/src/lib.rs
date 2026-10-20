//! FIT file helpers.
//!
//! Golden rule of Musette: a ride recorded on a device must never be lost.
//! Before an activity is acknowledged (and possibly freed on the device),
//! the received copy is checked with [`verify`].
//!
//! Full decoding (session summary, laps, records) is planned on top of the
//! `fitparser` crate.

#![cfg_attr(not(test), no_std)]

/// Seconds between the Unix epoch and the FIT epoch (1989-12-31T00:00:00Z).
pub const FIT_EPOCH_OFFSET: i64 = 631_065_600;

/// Convert a FIT timestamp to a Unix timestamp.
pub fn fit_to_unix(ts: u32) -> i64 {
    ts as i64 + FIT_EPOCH_OFFSET
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Header {
    pub header_size: u8,
    pub protocol_version: u8,
    pub profile_version: u16,
    pub data_size: u32,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Error {
    TooShort,
    BadHeaderSize(u8),
    MissingSignature,
    BadHeaderCrc,
    /// File shorter than header + data + CRC: truncated transfer.
    Truncated {
        expected: usize,
        actual: usize,
    },
    BadFileCrc {
        expected: u16,
        actual: u16,
    },
}

/// Parse the FIT file header.
pub fn parse_header(bytes: &[u8]) -> Result<Header, Error> {
    if bytes.len() < 12 {
        return Err(Error::TooShort);
    }
    let header_size = bytes[0];
    if header_size != 12 && header_size != 14 {
        return Err(Error::BadHeaderSize(header_size));
    }
    if bytes.len() < header_size as usize {
        return Err(Error::TooShort);
    }
    if &bytes[8..12] != b".FIT" {
        return Err(Error::MissingSignature);
    }
    if header_size == 14 {
        let stored = u16::from_le_bytes([bytes[12], bytes[13]]);
        // A header CRC of 0 means "not computed".
        if stored != 0 && stored != crc16(&bytes[..12]) {
            return Err(Error::BadHeaderCrc);
        }
    }
    Ok(Header {
        header_size,
        protocol_version: bytes[1],
        profile_version: u16::from_le_bytes([bytes[2], bytes[3]]),
        data_size: u32::from_le_bytes([bytes[4], bytes[5], bytes[6], bytes[7]]),
    })
}

/// Check that a FIT file is complete and uncorrupted.
pub fn verify(bytes: &[u8]) -> Result<Header, Error> {
    let header = parse_header(bytes)?;
    let body_end = header.header_size as usize + header.data_size as usize;
    let expected_len = body_end + 2;
    if bytes.len() < expected_len {
        return Err(Error::Truncated {
            expected: expected_len,
            actual: bytes.len(),
        });
    }
    let expected = u16::from_le_bytes([bytes[body_end], bytes[body_end + 1]]);
    let actual = crc16(&bytes[..body_end]);
    if expected != actual {
        return Err(Error::BadFileCrc { expected, actual });
    }
    Ok(header)
}

const CRC_TABLE: [u16; 16] = [
    0x0000, 0xCC01, 0xD801, 0x1400, 0xF001, 0x3C00, 0x2800, 0xE401, 0xA001, 0x6C00, 0x7800, 0xB401,
    0x5000, 0x9C01, 0x8801, 0x4400,
];

/// The CRC used by FIT files (CRC-16/ARC).
pub fn crc16(data: &[u8]) -> u16 {
    let mut crc: u16 = 0;
    for &byte in data {
        let mut tmp = CRC_TABLE[(crc & 0xF) as usize];
        crc = (crc >> 4) & 0x0FFF;
        crc = crc ^ tmp ^ CRC_TABLE[(byte & 0xF) as usize];
        tmp = CRC_TABLE[(crc & 0xF) as usize];
        crc = (crc >> 4) & 0x0FFF;
        crc = crc ^ tmp ^ CRC_TABLE[((byte >> 4) & 0xF) as usize];
    }
    crc
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Build a minimal synthetic FIT file with `data` as its body.
    fn make_fit(data: &[u8]) -> Vec<u8> {
        let mut f = vec![14u8, 0x20, 0x08, 0x08];
        f.extend_from_slice(&(data.len() as u32).to_le_bytes());
        f.extend_from_slice(b".FIT");
        let hcrc = crc16(&f);
        f.extend_from_slice(&hcrc.to_le_bytes());
        f.extend_from_slice(data);
        let fcrc = crc16(&f);
        f.extend_from_slice(&fcrc.to_le_bytes());
        f
    }

    #[test]
    fn crc_check_value() {
        assert_eq!(crc16(b"123456789"), 0xBB3D);
    }

    #[test]
    fn verifies_valid_file() {
        let f = make_fit(&[1, 2, 3, 4, 5]);
        let h = verify(&f).unwrap();
        assert_eq!(h.data_size, 5);
    }

    #[test]
    fn detects_truncation() {
        let f = make_fit(&[0; 100]);
        assert!(matches!(verify(&f[..50]), Err(Error::Truncated { .. })));
    }

    #[test]
    fn detects_corruption() {
        let mut f = make_fit(&[9; 20]);
        f[20] ^= 0x01;
        assert!(matches!(verify(&f), Err(Error::BadFileCrc { .. })));
    }

    #[test]
    fn epoch() {
        assert_eq!(fit_to_unix(0), 631_065_600);
    }
}
