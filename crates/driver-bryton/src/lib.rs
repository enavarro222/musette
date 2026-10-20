//! Bryton driver for devices running their **stock** firmware.
//!
//! Step 1 (this crate today): the Rider 750 mounts as a USB drive named
//! "Bryton". The app lists the files (File System Access API in the
//! browser, Storage Access Framework on Android) and asks this driver which
//! ones are activities.
//!
//! Step 2: route upload by dropping a file on the drive — to be confirmed
//! by inspecting what Bryton Active writes (see docs/drivers/bryton.md).
//!
//! Step 3: Bluetooth, once the protocol is understood.
//!
//! Folder names are not documented by Bryton: the heuristics below are
//! deliberately loose and must be tightened with a real directory listing.

use device::ActivityRef;

/// Top-level folders known not to contain activities.
const IGNORED_DIRS: &[&str] = &["map", "maps", "update", "system", "firmware"];

/// A file found on the mounted drive.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct DriveFile {
    /// Path relative to the drive root, `/`-separated.
    pub path: String,
    pub size: u64,
}

/// Pick the activity files from a drive listing, newest name first.
pub fn find_activities(files: &[DriveFile]) -> Vec<ActivityRef> {
    let mut out: Vec<ActivityRef> = files
        .iter()
        .filter(|f| is_activity_path(&f.path))
        .map(|f| ActivityRef {
            id: f.path.clone(),
            start_time: None,
            size: Some(f.size),
        })
        .collect();
    // Bryton names files after their start date; lexical order ~ time order.
    out.sort_by(|a, b| b.id.cmp(&a.id));
    out
}

fn is_activity_path(path: &str) -> bool {
    let lower = path.to_ascii_lowercase();
    if !lower.ends_with(".fit") {
        return false;
    }
    let mut parts = lower.split('/').filter(|p| !p.is_empty());
    // Skip a leading "bryton" folder if the listing starts above it.
    let first = parts.next().unwrap_or("");
    let top = if first == "bryton" {
        parts.next().unwrap_or("")
    } else {
        first
    };
    !IGNORED_DIRS.contains(&top)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn f(path: &str) -> DriveFile {
        DriveFile {
            path: path.into(),
            size: 1,
        }
    }

    #[test]
    fn keeps_fit_outside_system_folders() {
        let files = [
            f("Bryton/Track/20261017081500.fit"),
            f("Bryton/Track/20261014180200.FIT"),
            f("Bryton/MAP/Update/europe.map"),
            f("Bryton/Map/tiles.fit"),
            f("Bryton/Track/readme.txt"),
        ];
        let acts = find_activities(&files);
        let ids: Vec<_> = acts.iter().map(|a| a.id.as_str()).collect();
        assert_eq!(
            ids,
            [
                "Bryton/Track/20261017081500.fit",
                "Bryton/Track/20261014180200.FIT"
            ]
        );
    }
}
