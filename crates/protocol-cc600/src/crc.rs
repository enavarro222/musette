/// CRC-16/CCITT-FALSE (poly 0x1021, init 0xFFFF, no reflection, no xorout).
pub fn crc16_ccitt(data: &[u8]) -> u16 {
    let mut crc: u16 = 0xFFFF;
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
}
