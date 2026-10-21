//! What every driver offers to the commands. It follows the app's `Device`
//! interface (app/src/lib/devices/types.ts) for the parts the CLI needs.

use anyhow::Result;

/// A ride on the device.
pub struct Activity {
    /// Stable id: the same ride gets the same id on every run.
    pub id: String,
    /// File name for `sync` (without `.fit`).
    pub name: String,
    pub size: Option<u64>,
    /// Free text for `list` (distance, time...).
    pub detail: String,
}

pub trait Device {
    fn model(&self) -> device::Model;
    /// Key/value lines for `info`.
    async fn info(&mut self) -> Result<Vec<(String, String)>>;
    async fn list_activities(&mut self) -> Result<Vec<Activity>>;
    /// The FIT bytes, not yet verified (the caller runs `fit::verify`).
    async fn download_activity(
        &mut self,
        id: &str,
        progress: &mut dyn FnMut(u64, u64),
    ) -> Result<Vec<u8>>;
    /// Tells the device the ride is stored (it may then hide or free it).
    /// Only after the FIT is verified and stored.
    async fn acknowledge_activity(&mut self, id: &str) -> Result<()>;
    async fn close(&mut self) -> Result<()>;
}
