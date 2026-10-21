//! Bryton mounted as a USB drive: rides are FIT files.

use std::path::{Path, PathBuf};

use anyhow::{Context, Result};
use driver_bryton::{find_activities, DriveFile};

use crate::device::{Activity, Device};

pub struct BrytonUsb {
    root: PathBuf,
}

impl BrytonUsb {
    pub fn open(root: &str) -> Result<Self> {
        let root = PathBuf::from(root);
        anyhow::ensure!(root.is_dir(), "{} is not a folder", root.display());
        Ok(Self { root })
    }
}

fn walk(root: &Path, dir: &Path, out: &mut Vec<DriveFile>) -> Result<()> {
    for e in std::fs::read_dir(dir)? {
        let e = e?;
        let path = e.path();
        let rel = path
            .strip_prefix(root)?
            .to_string_lossy()
            .replace('\\', "/");
        let meta = e.metadata()?;
        if meta.is_dir() {
            // The map folder holds thousands of tiles and no ride.
            if !rel.eq_ignore_ascii_case("map") {
                walk(root, &path, out)?;
            }
        } else {
            out.push(DriveFile {
                path: rel,
                size: meta.len(),
            });
        }
    }
    Ok(())
}

impl Device for BrytonUsb {
    fn model(&self) -> device::Model {
        device::Model::BrytonRider750
    }

    async fn info(&mut self) -> Result<Vec<(String, String)>> {
        let text = std::fs::read_to_string(self.root.join("System/device.txt")).unwrap_or_default();
        // `[Section]` then `Key=Value` lines: name each value after its section.
        let mut section = String::new();
        let mut out = vec![];
        for line in text.lines().map(str::trim) {
            if let Some(name) = line.strip_prefix('[').and_then(|l| l.strip_suffix(']')) {
                section = name.to_string();
            } else if let Some((k, v)) = line.split_once('=') {
                out.push((format!("{section}.{}", k.trim()), v.trim().to_string()));
            }
        }
        Ok(out)
    }

    async fn list_activities(&mut self) -> Result<Vec<Activity>> {
        let mut files = vec![];
        walk(&self.root, &self.root, &mut files)?;
        Ok(find_activities(&files)
            .into_iter()
            .map(|a| Activity {
                name: a
                    .id
                    .rsplit('/')
                    .next()
                    .unwrap_or(&a.id)
                    .trim_end_matches(".fit")
                    .to_string(),
                detail: String::new(),
                size: a.size,
                id: a.id,
            })
            .collect())
    }

    async fn download_activity(
        &mut self,
        id: &str,
        progress: &mut dyn FnMut(u64, u64),
    ) -> Result<Vec<u8>> {
        let bytes =
            std::fs::read(self.root.join(id)).with_context(|| format!("cannot read {id}"))?;
        progress(bytes.len() as u64, bytes.len() as u64);
        Ok(bytes)
    }

    async fn close(&mut self) -> Result<()> {
        Ok(())
    }
}
