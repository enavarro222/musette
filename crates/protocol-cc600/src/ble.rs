//! BLE GATT identifiers exposed by the OpenCC600 firmware.
//!
//! Keep in sync with `web/src/lib/devices/cc600.ts`.

/// Primary service advertised by the device.
pub const SERVICE_UUID: &str = "18fbbd9a-adda-4ef4-9635-befd2efbf8a3";
/// App -> device (write without response). Carries request frames.
pub const RX_CHAR_UUID: &str = "c039ed02-4557-4b35-bc20-5c9320871456";
/// Device -> app (notify). Carries response/event frames.
pub const TX_CHAR_UUID: &str = "1cd21602-4b05-4c39-b9be-8353dece8a3f";
/// Advertised local name prefix.
pub const NAME_PREFIX: &str = "CC600";
