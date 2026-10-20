/// Initial value of [`crc16_update`].
pub const CRC16_INIT: u16 = 0xFFFF;

/// CRC-16/CCITT-FALSE (poly 0x1021, init 0xFFFF, no reflection, no xorout).
pub fn crc16_ccitt(data: &[u8]) -> u16 {
    crc16_update(CRC16_INIT, data)
}

/// Continue a CRC-16/CCITT-FALSE over more data. The running value is the CRC
/// itself, so it can be stored and resumed later.
pub fn crc16_update(mut crc: u16, data: &[u8]) -> u16 {
    for &byte in data {
        crc ^= (byte as u16) << 8;
        for _ in 0..8 {
            crc = if crc & 0x8000 != 0 {
                (crc << 1) ^ 0x1021
            } else {
                crc << 1
            };
        }
    }
    crc
}

#[cfg(test)]
mod tests {
    #[test]
    fn check_value() {
        // Standard check value for CRC-16/CCITT-FALSE.
        assert_eq!(super::crc16_ccitt(b"123456789"), 0x29B1);
    }

    #[test]
    fn update_resumes() {
        let (a, b) = b"123456789".split_at(4);
        let crc = super::crc16_update(super::crc16_update(super::CRC16_INIT, a), b);
        assert_eq!(crc, 0x29B1);
    }
}
