//! Hex trace of every BLE write and notification, on stderr (`-v`) and in a
//! file (`--log`). The file is the raw material for test fixtures: it holds
//! GPS positions, so clean it before committing it.

use std::fs::File;
use std::io::Write;
use std::sync::Mutex;
use std::time::Instant;

pub struct Trace {
    start: Instant,
    verbose: bool,
    file: Option<Mutex<File>>,
}

impl Trace {
    pub fn new(verbose: bool, path: Option<&str>) -> anyhow::Result<Self> {
        let file = match path {
            Some(p) => Some(Mutex::new(File::create(p)?)),
            None => None,
        };
        Ok(Self {
            start: Instant::now(),
            verbose,
            file,
        })
    }

    /// `dir` is `>` (we write) or `<` (the device notifies).
    pub fn frame(&self, dir: char, channel: &str, bytes: &[u8]) {
        let hex: Vec<String> = bytes.iter().map(|b| format!("{b:02x}")).collect();
        self.line(&format!("{dir} {channel:<8} {}", hex.join(" ")));
    }

    pub fn note(&self, msg: &str) {
        self.line(&format!("# {msg}"));
    }

    fn line(&self, msg: &str) {
        let line = format!("{:9.3} {msg}", self.start.elapsed().as_secs_f64());
        if self.verbose {
            eprintln!("{line}");
        }
        if let Some(f) = &self.file {
            let _ = writeln!(f.lock().unwrap(), "{line}");
        }
    }
}
