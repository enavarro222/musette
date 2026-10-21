//! `musette`: Musette's device drivers on the command line.
//!
//! For protocol work on a PC: scan, dump the GATT table, listen, then list
//! and download rides with the same drivers as the app. Every BLE frame can
//! be traced in hex (`-v`, `--log`).

mod ble;
mod bryton_ble;
mod bryton_usb;
mod device;
mod gpx;
mod session;
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
    /// `cc600-ble:<name part or address>`, `bryton-ble:...`, `bryton-usb:<mount folder>`,
    /// or `bryton-session:...` (Bryton through the app's session, as `cc600-ble`).
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
    /// Bryton BLE setting channel (read only for now).
    Setting {
        #[command(flatten)]
        dev: DeviceArgs,
        #[command(subcommand)]
        op: SettingOp,
    },
    /// Read the settings through the app's session; `key=value` changes
    /// them first (all or nothing).
    Settings {
        #[command(flatten)]
        dev: DeviceArgs,
        changes: Vec<String>,
    },
    /// Send a GPX as the device's route, through the app's session (the
    /// device's format is built in Rust). A CC600 resumes an interrupted send.
    SendRoute {
        #[command(flatten)]
        dev: DeviceArgs,
        gpx: PathBuf,
        /// Drop the link once this share is sent (0..1), to try resuming.
        #[arg(long)]
        cut_at: Option<f64>,
    },
    /// Bryton route files (offline: build and inspect).
    Route {
        #[command(subcommand)]
        op: RouteOp,
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

#[derive(Subcommand)]
enum RouteOp {
    /// GPX → Bryton route FIT (start and arrival turns only).
    Build {
        gpx: PathBuf,
        #[arg(short, long)]
        out: PathBuf,
        /// Douglas-Peucker tolerance in metres (0: keep every point).
        #[arg(long, default_value_t = 0.0)]
        simplify: f64,
        /// Speed for the turn durations, km/h.
        #[arg(long, default_value_t = 16.0)]
        speed: f64,
    },
    /// Print a Bryton route FIT: summary and turns.
    Dump { fit: PathBuf },
    /// Send a route FIT to a Bryton over BLE (file type 11, then its name).
    Send {
        #[command(flatten)]
        dev: DeviceArgs,
        fit: PathBuf,
        /// Name on the device (17 bytes max); default: the file name.
        #[arg(long)]
        name: Option<String>,
    },
}

#[derive(Subcommand)]
enum SettingOp {
    /// Send `[cmd, 2, args..., checksum]` and print the answer.
    Get {
        cmd: u8,
        /// Extra bytes (decimal), e.g. the bike index.
        args: Vec<u8>,
    },
    /// Ask the layout version (type 4) of each command (all known if none).
    Caps { cmds: Vec<u8> },
    /// Read and decode every setting Musette knows.
    Read,
    /// Send `[cmd, 1, payload..., checksum]`: CHANGES the device's setting.
    Set {
        cmd: u8,
        /// Payload bytes (decimal), laid out as the get answer.
        payload: Vec<u8>,
    },
}

/// Setting command ids known from the app (ConstSettingChannel).
const SETTING_IDS: &[u8] = &[
    20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36, 37, 38, 39, 40, 41, 42, 43,
    44, 45, 46, 47, 48, 49, 50, 51, 52, 53, 54, 56, 57, 58, 59, 60, 63, 64, 65, 67, 71, 72, 73, 74,
    75, 76, 77, 83, 84, 85, 86, 87,
];

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
        Cmd::Route { op } => route(op, cli.scan_secs, trace).await,
        Cmd::Setting { dev, op } => setting(&dev, cli.scan_secs, trace, op).await,
        Cmd::Ack { dev, id } => with_device(&dev, cli.scan_secs, trace, Action::Ack(id)).await,
        Cmd::Settings { dev, changes } => settings(&dev, cli.scan_secs, trace, changes).await,
        Cmd::SendRoute { dev, gpx, cut_at } => {
            send_route(&dev, cli.scan_secs, trace, gpx, cut_at).await
        }
        Cmd::Sync { dev, dir, ack } => {
            with_device(&dev, cli.scan_secs, trace, Action::Sync(dir, ack)).await
        }
    }
}

async fn route(op: RouteOp, scan_secs: u64, trace: Arc<Trace>) -> Result<()> {
    use driver_bryton::route::Route;
    match op {
        RouteOp::Build {
            gpx,
            out,
            simplify,
            speed,
        } => {
            let mut pts = gpx::read(&std::fs::read_to_string(&gpx)?)?;
            if simplify > 0.0 {
                let keep = track::simplify(&pts, simplify);
                pts = keep.into_iter().map(|i| pts[i]).collect();
            }
            let r = Route::from_track(&pts, speed / 3.6);
            let bytes = r.encode().map_err(|e| anyhow::anyhow!("{e:?}"))?;
            std::fs::write(&out, &bytes)?;
            println!(
                "{}: {} points, {} m, +{} m / -{} m, {} bytes",
                out.display(),
                r.points.len(),
                r.distance_m,
                r.gain_m,
                r.loss_m,
                bytes.len()
            );
        }
        RouteOp::Send { dev, fit, name } => {
            let bytes = std::fs::read(&fit)?;
            Route::decode(&bytes).map_err(|e| anyhow::anyhow!("not a Bryton route FIT: {e:?}"))?;
            let name = name.unwrap_or_else(|| {
                fit.file_stem()
                    .map_or("Musette".into(), |s| s.to_string_lossy().into_owned())
            });
            let arg = dev
                .device
                .strip_prefix("bryton-ble:")
                .context("route send: bryton-ble:<device>")?;
            let mut d = connect_bryton_ble(&dev, arg, scan_secs, trace).await?;
            let r = d.send_route(&bytes, &name, &mut progress).await;
            d.close().await?;
            r?;
            println!("{name}: sent ({} bytes)", bytes.len());
        }
        RouteOp::Dump { fit } => {
            let r = Route::decode(&std::fs::read(&fit)?).map_err(|e| anyhow::anyhow!("{e:?}"))?;
            println!(
                "version {}.{}, {} points, {} m, +{} m / -{} m, {} turns",
                r.version.0,
                r.version.1,
                r.points.len(),
                r.distance_m,
                r.gain_m,
                r.loss_m,
                r.turns.len()
            );
            for t in &r.turns {
                println!(
                    "  point {:5}  maneuver {:3}  next {:6} m  {:8} ms  {}",
                    t.point, t.maneuver, t.distance_m, t.duration, t.instruction
                );
            }
        }
    }
    Ok(())
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
        "bryton-ble" => run(connect_bryton_ble(d, arg, scan_secs, trace).await?, action).await,
        "cc600-ble" | "bryton-session" => {
            run(connect_session(d, scan_secs, trace).await?, action).await
        }
        _ => bail!("unknown driver '{kind}' (cc600-ble, bryton-ble, bryton-usb, bryton-session)"),
    }
}

/// CC600 characteristics, for the trace.
const CC600_NAMES: &[(&str, &str)] = &[
    (protocol_cc600::ble::RX_CHAR_UUID, "rx"),
    (protocol_cc600::ble::TX_CHAR_UUID, "tx"),
];

/// A device through the app's session (`cc600-ble:` or `bryton-session:`).
async fn connect_session(
    d: &DeviceArgs,
    scan_secs: u64,
    trace: Arc<Trace>,
) -> Result<session::SessionDevice> {
    let (kind, arg) = d
        .device
        .split_once(':')
        .context("--device is <driver>:<argument>")?;
    let (model, names) = match kind {
        "cc600-ble" => (musette_core::Model::OpenCc600, CC600_NAMES),
        "bryton-session" => (
            musette_core::Model::BrytonRider750,
            bryton_ble::CHANNEL_NAMES,
        ),
        _ => bail!("'{kind}' does not run the app's session (cc600-ble, bryton-session)"),
    };
    let adapter = ble::adapter().await?;
    let seen = ble::find(&adapter, arg, scan_secs).await?;
    let link = ble::Link::open(&seen, names, trace).await?;
    let timing = musette_core::Timing {
        request_ms: (d.timeout * 1000) as u32,
        ..musette_core::Timing::of(model)
    };
    session::SessionDevice::connect(link, model, timing).await
}

async fn settings(
    d: &DeviceArgs,
    scan_secs: u64,
    trace: Arc<Trace>,
    changes: Vec<String>,
) -> Result<()> {
    let mut dev = connect_session(d, scan_secs, trace).await?;
    let result = async {
        if !changes.is_empty() {
            let changes = changes
                .iter()
                .map(|c| {
                    let (key, text) = c.split_once('=').context("a change is key=value")?;
                    Ok(musette_core::Setting {
                        key: key.into(),
                        number: text.parse().ok(),
                        text: text.into(),
                    })
                })
                .collect::<Result<Vec<_>>>()?;
            let step = dev.session().write_settings(&changes)?;
            dev.run(step, &mut |_| {}).await?;
            println!("written");
        }
        let step = dev.session().read_settings()?;
        let musette_core::Outcome::Settings { fields, values } = dev.run(step, &mut |_| {}).await?
        else {
            bail!("no settings");
        };
        for v in values {
            let f = fields.iter().find(|f| f.key == v.key);
            let kind = f.map_or("?", |f| f.kind);
            let rw = if f.is_some_and(|f| f.writable) {
                ""
            } else {
                " (read-only)"
            };
            println!("{:<22} {:<28} {kind}{rw}", v.key, v.text);
        }
        Ok(())
    }
    .await;
    dev.close().await?;
    result
}

async fn send_route(
    d: &DeviceArgs,
    scan_secs: u64,
    trace: Arc<Trace>,
    gpx: PathBuf,
    cut_at: Option<f64>,
) -> Result<()> {
    let route = musette_core::parse_gpx(&std::fs::read_to_string(&gpx)?)
        .map_err(|e| anyhow::anyhow!("{gpx:?}: {e}"))?;
    let mut dev = connect_session(d, scan_secs, trace).await?;
    let result = async {
        let step = dev.session().send_route(&route)?;
        dev.cut_at = cut_at;
        let start = std::time::Instant::now();
        let mut first = None;
        dev.run(step, &mut |p| {
            first.get_or_insert(p);
            eprint!("\r  {:5.1} %", p * 100.0);
        })
        .await?;
        eprintln!();
        println!(
            "{}: sent in {:.1} s (the device held {:.0} % when it started)",
            route.name,
            start.elapsed().as_secs_f64(),
            first.unwrap_or(0.0) * 100.0
        );
        Ok(())
    }
    .await;
    dev.close().await?;
    result
}

async fn connect_bryton_ble(
    d: &DeviceArgs,
    arg: &str,
    scan_secs: u64,
    trace: Arc<Trace>,
) -> Result<bryton_ble::BrytonBle> {
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
    bryton_ble::BrytonBle::connect(link, opts).await
}

fn hex(b: &[u8]) -> String {
    b.iter()
        .map(|x| format!("{x:02x}"))
        .collect::<Vec<_>>()
        .join(" ")
}

async fn setting(d: &DeviceArgs, scan_secs: u64, trace: Arc<Trace>, op: SettingOp) -> Result<()> {
    let arg = d
        .device
        .strip_prefix("bryton-ble:")
        .context("settings: only bryton-ble:<device> for now")?;
    let mut dev = connect_bryton_ble(d, arg, scan_secs, trace).await?;
    let result = async {
        match op {
            SettingOp::Get { cmd, args } => {
                let w = dev.session_mut().setting_get(cmd, &args);
                for f in dev.setting_exchange(w).await? {
                    println!("{}", hex(&f));
                }
            }
            SettingOp::Set { cmd, payload } => {
                let w = dev.session_mut().setting_set(cmd, &payload);
                let got = dev.setting_exchange(w).await?;
                match got.last().map(|f| f.as_slice()) {
                    Some([_, 10]) => println!("ok"),
                    Some(f) => bail!("refused: {}", hex(f)),
                    None => bail!("no ack"),
                }
            }
            SettingOp::Read => {
                for f in driver_bryton::settings::fields() {
                    let w = dev.session_mut().setting_get(f.cmd, f.args);
                    let got = dev.setting_exchange(w).await?;
                    let value = got
                        .iter()
                        .find_map(|fr| driver_bryton::settings::answer_payload(f.cmd, fr))
                        .map(|p| match (f.decode)(p) {
                            Some(v) => f.show(&v),
                            None => format!("cannot decode {}", hex(p)),
                        });
                    let text = match (value, got.last()) {
                        (Some(v), _) => v,
                        (None, Some(fr)) => format!("no value ({})", hex(fr)),
                        (None, None) => "no answer".into(),
                    };
                    println!("{:<22} {text}", f.key);
                }
            }
            SettingOp::Caps { cmds } => {
                let cmds = if cmds.is_empty() {
                    SETTING_IDS.to_vec()
                } else {
                    cmds
                };
                for cmd in cmds {
                    let w = dev.session_mut().setting_capability(cmd);
                    let got = dev.setting_exchange(w).await?;
                    let text = match got.last() {
                        Some(f) if f.len() >= 5 && f[1] == 5 => {
                            format!("version {}  ({})", u16::from_le_bytes([f[2], f[3]]), hex(f))
                        }
                        Some(f) => format!("({})", hex(f)),
                        None => "no answer".into(),
                    };
                    println!("{cmd:3}: {text}");
                }
            }
        }
        Ok(())
    }
    .await;
    dev.close().await?;
    result
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
