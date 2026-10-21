//! Device model shared by all drivers.
//!
//! Drivers are *sans-IO*: they encode requests and decode responses, while
//! the app owns the actual transport (Web Bluetooth, USB files, native BLE).
//! This keeps drivers testable and usable from the browser, the mobile apps
//! and, for the CC600 protocol, the firmware itself.
//!
//! The UI only shows what a device can do, based on [`Capabilities`].

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Model {
    /// GEOID CC600 running the OpenCC600 firmware.
    OpenCc600,
    /// Bryton Rider 750 with its stock firmware.
    BrytonRider750,
}

impl Model {
    pub fn display_name(self) -> &'static str {
        match self {
            Model::OpenCc600 => "CC600 (OpenCC600)",
            Model::BrytonRider750 => "Bryton Rider 750",
        }
    }

    pub fn capabilities(self) -> Capabilities {
        match self {
            Model::OpenCc600 => Capabilities {
                transport: Transports {
                    ble: true,
                    usb_files: false,
                },
                download_activities: true,
                upload_route: true,
                route_corridor_map: true,
                climbs_on_device: true,
                settings: true,
                sensors: true,
                wifi_sync: true,
            },
            // Stock firmware. Bluetooth: rides, routes and settings checked
            // on a Rider 750 (docs/drivers/bryton-ble.md); USB: rides.
            Model::BrytonRider750 => Capabilities {
                transport: Transports {
                    ble: true,
                    usb_files: true,
                },
                download_activities: true,
                upload_route: true, // over Bluetooth (start and arrival turns only)
                route_corridor_map: false,
                climbs_on_device: false,
                settings: true, // over Bluetooth
                sensors: false,
                wifi_sync: false,
            },
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Default)]
pub struct Transports {
    pub ble: bool,
    /// Device mounts as USB mass storage.
    pub usb_files: bool,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Default)]
pub struct Capabilities {
    pub transport: Transports,
    pub download_activities: bool,
    pub upload_route: bool,
    /// Device renders a map corridor around the route.
    pub route_corridor_map: bool,
    /// Device shows climbs prepared by the app.
    pub climbs_on_device: bool,
    pub settings: bool,
    pub sensors: bool,
    /// Device can upload rides over home Wi-Fi.
    pub wifi_sync: bool,
}

/// An activity stored on a device.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ActivityRef {
    /// Driver-specific identifier (record id, file path...).
    pub id: String,
    /// Unix timestamp of the start, if known before download.
    pub start_time: Option<i64>,
    pub size: Option<u64>,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn bryton_has_usb_and_bluetooth() {
        let c = Model::BrytonRider750.capabilities();
        assert!(c.transport.usb_files && c.transport.ble);
        assert!(c.download_activities && !c.route_corridor_map);
    }
}
