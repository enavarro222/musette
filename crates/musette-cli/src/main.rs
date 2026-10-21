//! `musette`: Musette's device drivers on the command line.
//!
//! For protocol work on a PC: scan, dump the GATT table, listen, then list
//! and download rides with the same drivers as the app. Every BLE frame can
//! be traced in hex (`-v`, `--log`).

mod ble;
mod bryton_ble;
mod bryton_usb;
mod device;
mod trace;

use std::path::PathBuf;
use std::sync::Arc;
use std::time::Duration;

use anyhow::{bail, Context, Result};
use clap::{Parser, Subcommand, ValueEnum};
use driver_bryton::ble::{Config, ListType};

use crate::device::Device;
use crate::trace::Trace;

#[derive(Parser)]
#[command(name = "musette", about = "Talk to bike computers from a PC")]
struct Cli {
    /// Print every BLE frame on stderr.
    #[arg(short, long, global = true)]
    verbose: bool,
    /// Write every BLE frame to this file (hex, timestamps).
    #[arg(long, global = true)]
    log: Option<String>,
    /// Seconds of scanning to find a BLE device.
    #[arg(long, global = true, default_value_t = 5)]
    scan_secs: u64,
    #[command(subcommand)]
    cmd: Cmd,
}

#[derive(Clone, Copy, ValueEnum)]
enum ListKind {
    /// Rides not synced yet.
    Unsynced,
    /// File management, not synced.
    ManageUnsynced,
    /// File management, all.
    All,
    /// No type byte (the app's automatic sync).
    Default,
}

#[derive(clap::Args)]
struct DeviceArgs {
    /// `bryton-ble:<name part or address>` or `bryton-usb:<mount folder>`.
    #[arg(short, long)]
    device: String,
    /// Seconds of silence before a request fails.
    #[arg(long, default_value_t = 10)]
    timeout: u64,
    /// Seconds to wait for the Bryton handshake.
    #[arg(long, default_value_t = 10)]
    handshake_wait: u64,
    /// Bryton: turn on the setting channel even if CP does not say so.
    #[arg(long)]
    force_setting: bool,
    /// Bryton: ride list type.
    #[arg(long, value_enum, default_value_t = ListKind::Unsynced)]
    list: ListKind,
    /// Bryton: action code to send after the list response (3 = success,
    /// what a Rider 750 needs; 5 = batch size).
    #[arg(long, default_value_t = 3)]
    list_answer: u8,
    /// Bryton: range size of ride downloads.
    #[arg(long, default_value_t = driver_bryton::ble::DEFAULT_CHUNK)]
    chunk: u32,
}

#[derive(Subcommand)]
enum Cmd {
    /// List BLE devices around.
    Scan,
    /// Connect and print the GATT table and the MTU. Sends nothing.
    Gatt { device: String },
    /// Connect, subscribe to every notify characteristic and print what
    /// comes. Sends nothing.
    Sniff {
        device: String,
        #[arg(long, default_value_t = 30)]
        secs: u64,
    },
    /// Device info (and, for Bryton BLE, the handshake).
    Info(DeviceArgs),
    /// List rides.
    List(DeviceArgs),
    /// Download one ride and check its FIT CRC.
    Download {
        #[command(flatten)]
        dev: DeviceArgs,
        /// Ride id, as `list` prints it.
        id: String,
        #[arg(short, long)]
        out: PathBuf,
    },
    /// Tell the device a ride is stored (Bryton: it leaves the unsynced list).
    Ack {
        #[command(flatten)]
        dev: DeviceArgs,
        id: String,
    },
    /// Download the rides missing from a folder, check them, store them as
    /// `<name>.fit`.
    Sync {
        #[command(flatten)]
        dev: DeviceArgs,
        dir: PathBuf,
        /// Acknowledge each ride once verified and stored (Bryton: it leaves
        /// the unsynced list, and Bryton Active will not sync it any more).
        #[arg(long)]
        ack: bool,
    },
}

#[tokio::main]
async fn main() -> Result<()> {
    let cli = Cli::parse();
    let trace = Arc::new(Trace::new(cli.verbose, cli.log.as_deref())?);
    match cli.cmd {
        Cmd::Scan => scan(cli.scan_secs).await,
        Cmd::Gatt { device } => gatt(&device, cli.scan_secs, trace).await,
        Cmd::Sniff { device, secs } => {
            sniff(&device, cli.scan_secs, secs, cli.verbose, trace).await
        }
        Cmd::Info(d) => with_device(&d, cli.scan_secs, trace, Action::Info).await,
        Cmd::List(d) => with_device(&d, cli.scan_secs, trace, Action::List).await,
        Cmd::Download { dev, id, out } => {
            with_device(&dev, cli.scan_secs, trace, Action::Download(id, out)).await
        }
        Cmd::Ack { dev, id } => with_device(&dev, cli.scan_secs, trace, Action::Ack(id)).await,
        Cmd::Sync { dev, dir, ack } => {
            with_device(&dev, cli.scan_secs, trace, Action::Sync(dir, ack)).await
        }
    }
}

async fn scan(secs: u64) -> Result<()> {
    let adapter = ble::adapter().await?;
    let mut seen = ble::scan(&adapter, secs).await?;
    seen.sort_by_key(|s| std::cmp::Reverse(s.rssi.unwrap_or(i16::MIN)));
    for s in seen {
        println!(
            "{}  {:>4}  {:<24} {}",
            s.address,
            s.rssi.map_or(String::new(), |r| r.to_string()),
            s.name.as_deref().unwrap_or("-"),
            s.services
                .iter()
                .map(|u| u.to_string())
                .collect::<Vec<_>>()
                .join(" ")
        );
    }
    Ok(())
}

async fn gatt(selector: &str, scan_secs: u64, trace: Arc<Trace>) -> Result<()> {
    let adapter = ble::adapter().await?;
    let seen = ble::find(&adapter, selector, scan_secs).await?;
    let link = ble::Link::open(&seen, bryton_ble::CHANNEL_NAMES, trace).await?;
    println!(
        "{} {:?}  mtu {}",
        seen.address,
        seen.name,
        link.peripheral_mtu()
    );
    ble::print_gatt(&link.peripheral);
    link.close().await
}

async fn sniff(
    selector: &str,
    scan_secs: u64,
    secs: u64,
    verbose: bool,
    trace: Arc<Trace>,
) -> Result<()> {
    use btleplug::api::{CharPropFlags, Peripheral as _};
    let adapter = ble::adapter().await?;
    let seen = ble::find(&adapter, selector, scan_secs).await?;
    let mut link = ble::Link::open(&seen, bryton_ble::CHANNEL_NAMES, trace).await?;
    for c in link.peripheral.characteristics() {
        if c.properties
            .intersects(CharPropFlags::NOTIFY | CharPropFlags::INDICATE)
        {
            link.subscribe(&c.uuid.to_string()).await?;
        }
    }
    eprintln!("listening {secs} s, sending nothing");
    let end = tokio::time::Instant::now() + Duration::from_secs(secs);
    loop {
        let left = end.saturating_duration_since(tokio::time::Instant::now());
        if left.is_zero() {
            break;
        }
        if let Some((u, v)) = link.next(left).await? {
            if !verbose {
                let hex: Vec<String> = v.iter().map(|b| format!("{b:02x}")).collect();
                println!("{u} {}", hex.join(" "));
            }
        }
    }
    link.close().await
}

enum Action {
    Info,
    List,
    Download(String, PathBuf),
    Ack(String),
    Sync(PathBuf, bool),
}

async fn with_device(
    d: &DeviceArgs,
    scan_secs: u64,
    trace: Arc<Trace>,
    action: Action,
) -> Result<()> {
    let (kind, arg) = d
        .device
        .split_once(':')
        .context("--device is <driver>:<argument>, e.g. bryton-ble:Rider")?;
    match kind {
        "bryton-usb" => run(bryton_usb::BrytonUsb::open(arg)?, action).await,
        "bryton-ble" => {
            let adapter = ble::adapter().await?;
            let seen = ble::find(&adapter, arg, scan_secs).await?;
            let link = ble::Link::open(&seen, bryton_ble::CHANNEL_NAMES, trace).await?;
            let opts = bryton_ble::Options {
                timeout: Duration::from_secs(d.timeout),
                handshake_wait: Duration::from_secs(d.handshake_wait),
                force_setting: d.force_setting,
                list_type: match d.list {
                    ListKind::Unsynced => ListType::Unsynced,
                    ListKind::ManageUnsynced => ListType::ManageUnsynced,
                    ListKind::All => ListType::ManageAll,
                    ListKind::Default => ListType::Default,
                },
                session: Config {
                    chunk: d.chunk,
                    list_answer: Some(d.list_answer),
                    ..Config::default()
                },
            };
            run(bryton_ble::BrytonBle::connect(link, opts).await?, action).await
        }
        _ => bail!("unknown driver '{kind}' (bryton-ble, bryton-usb)"),
    }
}

async fn run(mut dev: impl Device, action: Action) -> Result<()> {
    let result = act(&mut dev, action).await;
    dev.close().await?;
    result
}

fn progress(done: u64, total: u64) {
    eprint!("\r  {done}/{total} bytes");
    if done >= total {
        eprintln!();
    }
}

async fn act(dev: &mut impl Device, action: Action) -> Result<()> {
    match action {
        Action::Info => {
            println!("model: {}", dev.model().display_name());
            for (k, v) in dev.info().await? {
                println!("{k}: {v}");
            }
        }
        Action::List => {
            let list = dev.list_activities().await?;
            println!("{} rides", list.len());
            for a in list {
                let size = a.size.map_or(String::new(), |s| format!("{s} B"));
                println!("{:<32} {:>10}  {}", a.id, size, a.detail);
            }
        }
        Action::Download(id, out) => {
            let bytes = dev.download_activity(&id, &mut progress).await?;
            std::fs::write(&out, &bytes)?;
            match fit::verify(&bytes) {
                Ok(h) => println!(
                    "{}: {} bytes, FIT ok ({} data bytes)",
                    out.display(),
                    bytes.len(),
                    h.data_size
                ),
                Err(e) => bail!(
                    "{}: {} bytes, NOT a valid FIT: {e:?}",
                    out.display(),
                    bytes.len()
                ),
            }
        }
        Action::Ack(id) => {
            dev.acknowledge_activity(&id).await?;
            println!("{id}: acknowledged");
        }
        Action::Sync(dir, ack) => {
            std::fs::create_dir_all(&dir)?;
            let list = dev.list_activities().await?;
            let (mut new, mut bad) = (0, 0);
            for a in list {
                let path = dir.join(format!("{}.fit", a.name));
                if path.exists() {
                    continue;
                }
                eprintln!("{}", a.name);
                let bytes = dev.download_activity(&a.id, &mut progress).await?;
                if let Err(e) = fit::verify(&bytes) {
                    eprintln!("  not stored, invalid FIT: {e:?}");
                    bad += 1;
                    continue;
                }
                std::fs::write(&path, &bytes)?;
                new += 1;
                // Download → verify → store → acknowledge, never another order.
                if ack {
                    dev.acknowledge_activity(&a.id).await?;
                }
            }
            println!("{new} new rides in {}, {bad} invalid", dir.display());
        }
    }
    Ok(())
}
