//! BLE GATT identifiers exposed by the OpenCC600 firmware.
//!
//! The app takes them from here (`musette_core::Session::channels`); only its
//! search profile repeats the service, checked by a test.

/// Primary service advertised by the device.
pub const SERVICE_UUID: &str = "18fbbd9a-adda-4ef4-9635-befd2efbf8a3";
/// App -> device (write without response). Carries request frames.
pub const RX_CHAR_UUID: &str = "c039ed02-4557-4b35-bc20-5c9320871456";
/// Device -> app (notify). Carries response/event frames.
pub const TX_CHAR_UUID: &str = "1cd21602-4b05-4c39-b9be-8353dece8a3f";
/// Advertised local name prefix: the full name is `OpenCC600 XXXX` or `OpenCC700 XXXX`, `XXXX` from the device's MAC
/// address (the CC700 is the same board, with the same firmware).
pub const NAME_PREFIX: &str = "OpenCC";
