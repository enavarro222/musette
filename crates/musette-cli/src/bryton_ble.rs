//! Bryton over BLE: runs `driver_bryton::ble::Session` on a real link.

use std::time::{Duration, Instant};

use anyhow::{anyhow, bail, Result};
use driver_bryton::ble::{
    cp, file_id_from_name, uuid, Channel, Config, DeviceInfo, Event, Failure, Handshake, ListType,
    Session, Write,
};

use crate::ble::Link;
use crate::device::{Activity, Device};

pub const CHANNEL_NAMES: &[(&str, &str)] = &[
    (uuid::COMMAND_CHANNEL, "command"),
    (uuid::DATA_CHANNEL, "data"),
    (uuid::NOTIFY_CHANNEL, "notify"),
    (uuid::SETTING_CHANNEL, "setting"),
];

#[derive(Clone, Copy)]
pub struct Options {
    /// Silence after which a request fails.
    pub timeout: Duration,
    /// How long to wait for the handshake (the app waits 30 s).
    pub handshake_wait: Duration,
    /// Turn on the setting channel even if `CP` does not say so.
    pub force_setting: bool,
    pub list_type: ListType,
    pub session: Config,
}

pub struct BrytonBle {
    link: Link,
    session: Session,
    opts: Options,
    pub device_info: Option<DeviceInfo>,
    pub handshake: Option<Handshake>,
    last_activity: Instant,
}

fn describe(f: &Failure) -> String {
    match f {
        Failure::Status { cmd, status } => {
            let what = match *status {
                0 => "unknown error",
                1 => "busy",
                3 => "factory status",
                4 => "address error",
                5 => "time sync needed",
                6 => "nothing to sync",
                _ => "?",
            };
            format!("cmd {cmd}: status {status} ({what})")
        }
        Failure::Action { cmd, code } => format!("cmd {cmd}: the device sent action {code}"),
        Failure::BadSum { cmd } => format!("cmd {cmd}: bad checksum"),
        Failure::Missing { cmd } => format!("cmd {cmd}: frames missing"),
        Failure::Empty { cmd } => format!("cmd {cmd}: no data"),
        Failure::Size { expected, got } => format!("expected {expected} bytes, got {got}"),
    }
}

impl BrytonBle {
    /// Subscribes, reads the device info, then waits for the handshake.
    pub async fn connect(link: Link, opts: Options) -> Result<Self> {
        let mut me = Self {
            link,
            session: Session::new(opts.session),
            opts,
            device_info: None,
            handshake: None,
            last_activity: Instant::now(),
        };
        for u in [uuid::COMMAND_CHANNEL, uuid::DATA_CHANNEL] {
            me.link.subscribe(u).await?;
        }
        if me.link.has(uuid::NOTIFY_CHANNEL) {
            me.link.subscribe(uuid::NOTIFY_CHANNEL).await?;
        }
        let w = me.session.read_device_info();
        me.send(&[w]).await?;
        let info = me
            .run(|e| match e {
                Event::DeviceInfo(i) => Some(i),
                _ => None,
            })
            .await?;
        let setting = info.has(cp::SETTING) || opts.force_setting;
        if info.recording() {
            eprintln!("warning: the device is recording a ride");
        }
        me.device_info = Some(info);
        if setting && me.link.has(uuid::SETTING_CHANNEL) {
            me.link.subscribe(uuid::SETTING_CHANNEL).await?;
            let w = me.session.new_app();
            me.send(&[w]).await?;
            me.wait_handshake().await?;
        }
        Ok(me)
    }

    async fn wait_handshake(&mut self) -> Result<()> {
        let deadline = Instant::now() + self.opts.handshake_wait;
        while self.handshake.is_none() {
            let left = deadline.saturating_duration_since(Instant::now());
            if left.is_zero() {
                self.link
                    .trace
                    .note("no handshake: default batch and frame size");
                eprintln!("warning: no handshake from the device, using defaults");
                break;
            }
            self.poll(left).await?;
        }
        Ok(())
    }

    async fn send(&self, writes: &[Write]) -> Result<()> {
        for w in writes {
            let (u, no_resp) = match w.channel {
                Channel::Command => (uuid::COMMAND_CHANNEL, false),
                Channel::Data => (uuid::DATA_CHANNEL, true),
                Channel::Setting => (uuid::SETTING_CHANNEL, false),
            };
            self.link.write(u, &w.bytes, no_resp).await?;
        }
        Ok(())
    }

    /// Waits for one notification (up to `timeout`) and feeds it to the
    /// session. Returns the session's events; the handshake is kept.
    async fn poll(&mut self, timeout: Duration) -> Result<Vec<Event>> {
        let Some((u, bytes)) = self.link.next(timeout).await? else {
            return Ok(vec![]);
        };
        let u = u.to_string();
        if u == uuid::COMMAND_CHANNEL || u == uuid::DATA_CHANNEL {
            self.last_activity = Instant::now();
        }
        let step = if u == uuid::COMMAND_CHANNEL {
            self.session.on_command(&bytes)
        } else if u == uuid::DATA_CHANNEL {
            self.session.on_data(&bytes)
        } else if u == uuid::SETTING_CHANNEL {
            self.session.on_setting(&bytes)
        } else {
            return Ok(vec![]);
        };
        self.send(&step.writes).await?;
        for e in &step.events {
            if let Event::Handshake(h) = e {
                self.link.trace.note(&format!("handshake {h:?}"));
                self.handshake = Some(*h);
            }
        }
        Ok(step.events)
    }

    /// Feeds notifications until `pick` returns something. Fails on a
    /// protocol failure or after `timeout` without command or data frames
    /// (the device pushes setting frames every few seconds on its own).
    async fn run<T>(&mut self, mut pick: impl FnMut(Event) -> Option<T>) -> Result<T> {
        self.last_activity = Instant::now();
        loop {
            let left = self
                .opts
                .timeout
                .saturating_sub(self.last_activity.elapsed());
            if left.is_zero() {
                bail!("no answer from the device for {:?}", self.opts.timeout);
            }
            for e in self.poll(left).await? {
                if let Event::Failed(f) = &e {
                    bail!("{}", describe(f));
                }
                if let Some(t) = pick(e) {
                    return Ok(t);
                }
            }
        }
    }
}

impl BrytonBle {
    /// Sends one setting frame and returns the device's frames for the same
    /// cmd: its 2-byte ack and/or its answer (already acked). Stops at the
    /// first answer longer than 2 bytes, or at a 2-byte ack that is not OK.
    pub fn session_mut(&mut self) -> &mut Session {
        &mut self.session
    }

    pub async fn setting_exchange(&mut self, w: Write) -> Result<Vec<Vec<u8>>> {
        let cmd = w.bytes[0];
        self.send(&[w]).await?;
        let mut got = vec![];
        let deadline = Instant::now() + self.opts.timeout;
        while Instant::now() < deadline {
            let Some((u, b)) = self.link.next(deadline - Instant::now()).await? else {
                break;
            };
            if u.to_string() != uuid::SETTING_CHANNEL {
                continue;
            }
            let step = self.session.on_setting(&b);
            self.send(&step.writes).await?;
            if b.first() != Some(&cmd) {
                continue;
            }
            let done = b.len() > 2 || b.get(1) != Some(&10);
            got.push(b);
            if done {
                break;
            }
        }
        Ok(got)
    }
}

impl Device for BrytonBle {
    fn model(&self) -> device::Model {
        device::Model::BrytonRider750
    }

    async fn info(&mut self) -> Result<Vec<(String, String)>> {
        let mut out = vec![("mtu".into(), self.link.peripheral_mtu().to_string())];
        if let Some(i) = &self.device_info {
            let opt = |s: &Option<String>| s.clone().unwrap_or_default();
            out.push(("id (UD)".into(), opt(&i.id)));
            out.push(("firmware (IV)".into(), opt(&i.firmware)));
            out.push(("model (MN)".into(), opt(&i.model)));
            out.push(("capabilities (CP)".into(), opt(&i.capabilities)));
            if let Some(c) = i.cp() {
                let bits = [
                    (cp::FILE_RANGE, "file ranges"),
                    (cp::WORKOUT, "workout"),
                    (cp::PLAN_TRIP, "plan trip"),
                    (cp::SETTING, "setting"),
                    (cp::FW_UPDATE, "fw update"),
                    (cp::ALTITUDE, "altitude"),
                    (cp::WIFI, "wifi"),
                    (cp::FAST_BT, "fast bt"),
                    (cp::GRID, "grid"),
                    (cp::CMD_VERSIONS, "cmd versions"),
                    (cp::VALID, "valid"),
                ];
                let on: Vec<&str> = bits
                    .iter()
                    .filter(|(b, _)| c & b != 0)
                    .map(|(_, n)| *n)
                    .collect();
                out.push(("CP bits".into(), format!("0x{c:03x}: {}", on.join(", "))));
            }
        }
        out.push((
            "handshake".into(),
            self.handshake.map_or("none".into(), |h| format!("{h:?}")),
        ));
        out.push(("batch".into(), self.session.batch().to_string()));
        Ok(out)
    }

    async fn list_activities(&mut self) -> Result<Vec<Activity>> {
        let w = self.session.list_activities(self.opts.list_type);
        self.send(&[w]).await?;
        let entries = self
            .run(|e| match e {
                Event::Activities(l) => Some(l),
                _ => None,
            })
            .await?;
        Ok(entries
            .into_iter()
            .map(|e| Activity {
                id: e.name(),
                name: e.name(),
                size: None,
                detail: format!(
                    "time {} dist {} sport {} workout {} state {} raw[0]={} rest {}",
                    e.activity_time,
                    e.activity_dist,
                    e.sport_type,
                    e.is_workout,
                    e.upload_state,
                    e.payload_size,
                    e.raw[20..]
                        .iter()
                        .map(|b| format!("{b:02x}"))
                        .collect::<String>()
                ),
            })
            .collect())
    }

    async fn download_activity(
        &mut self,
        id: &str,
        progress: &mut dyn FnMut(u64, u64),
    ) -> Result<Vec<u8>> {
        let file_id = file_id_from_name(id)
            .ok_or_else(|| anyhow!("'{id}' is not a ride name (yyMMddHHmmss)"))?;
        let w = self.session.download(file_id);
        self.send(&[w]).await?;
        self.run(|e| match e {
            Event::Progress { done, total } => {
                progress(done as u64, total as u64);
                None
            }
            Event::File { bytes, .. } => Some(bytes),
            _ => None,
        })
        .await
    }

    async fn acknowledge_activity(&mut self, id: &str) -> Result<()> {
        let file_id = file_id_from_name(id)
            .ok_or_else(|| anyhow!("'{id}' is not a ride name (yyMMddHHmmss)"))?;
        let w = self.session.acknowledge(file_id);
        self.send(&[w]).await?;
        // The device answers with a 2-byte ack [51, status] (10 = ok).
        let deadline = Instant::now() + self.opts.timeout;
        while Instant::now() < deadline {
            if let Some((u, b)) = self.link.next(deadline - Instant::now()).await? {
                let u = u.to_string();
                if u == uuid::SETTING_CHANNEL && b.len() == 2 && b[0] == 51 {
                    return match b[1] {
                        10 => Ok(()),
                        11 => bail!("the device does not support cmd 51"),
                        s => bail!("the device refused cmd 51 (status {s})"),
                    };
                }
                if u == uuid::SETTING_CHANNEL {
                    let step = self.session.on_setting(&b);
                    self.send(&step.writes).await?;
                }
            }
        }
        bail!("no ack for cmd 51")
    }

    async fn close(&mut self) -> Result<()> {
        self.link.close().await
    }
}

impl Link {
    pub fn peripheral_mtu(&self) -> u16 {
        use btleplug::api::Peripheral as _;
        self.peripheral.mtu()
    }
}
