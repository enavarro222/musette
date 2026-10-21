//! BLE transport (BlueZ on Linux through btleplug). It moves bytes and
//! traces them; drivers decide what they mean.

use std::collections::HashMap;
use std::pin::Pin;
use std::sync::Arc;
use std::time::Duration;

use anyhow::{anyhow, bail, Context, Result};
use btleplug::api::{
    Central, CharPropFlags, Characteristic, Manager as _, Peripheral as _, ScanFilter,
    ValueNotification, WriteType,
};
use btleplug::platform::{Adapter, Manager, Peripheral};
use futures::{Stream, StreamExt};
use uuid::Uuid;

use crate::trace::Trace;

/// A device seen during a scan.
pub struct Seen {
    pub peripheral: Peripheral,
    pub name: Option<String>,
    pub address: String,
    pub rssi: Option<i16>,
    pub services: Vec<Uuid>,
}

pub async fn adapter() -> Result<Adapter> {
    let manager = Manager::new().await.context("BlueZ is not reachable")?;
    manager
        .adapters()
        .await?
        .into_iter()
        .next()
        .ok_or_else(|| anyhow!("no Bluetooth adapter"))
}

/// Scans for `secs` seconds and returns what BlueZ knows (devices already
/// known to BlueZ show up too).
pub async fn scan(adapter: &Adapter, secs: u64) -> Result<Vec<Seen>> {
    adapter.start_scan(ScanFilter::default()).await?;
    tokio::time::sleep(Duration::from_secs(secs)).await;
    adapter.stop_scan().await?;
    let mut out = vec![];
    for p in adapter.peripherals().await? {
        let props = p.properties().await?.unwrap_or_default();
        out.push(Seen {
            address: p.address().to_string(),
            name: props.local_name.or(props.advertisement_name),
            rssi: props.rssi,
            services: props.services,
            peripheral: p,
        });
    }
    Ok(out)
}

/// Finds a device by address (`AA:BB:...`) or by a part of its name.
pub async fn find(adapter: &Adapter, selector: &str, secs: u64) -> Result<Seen> {
    let wanted = selector.to_ascii_lowercase();
    let seen = scan(adapter, secs).await?;
    let mut hits: Vec<Seen> = seen
        .into_iter()
        .filter(|s| {
            s.address.to_ascii_lowercase() == wanted
                || s.name
                    .as_deref()
                    .is_some_and(|n| n.to_ascii_lowercase().contains(&wanted))
        })
        .collect();
    match hits.len() {
        0 => bail!("no BLE device matches '{selector}' (try `musette scan`)"),
        1 => Ok(hits.remove(0)),
        _ => bail!(
            "several devices match '{selector}': {}",
            hits.iter()
                .map(|h| h.address.as_str())
                .collect::<Vec<_>>()
                .join(", ")
        ),
    }
}

/// A connected device with named characteristics.
pub struct Link {
    pub peripheral: Peripheral,
    chars: HashMap<Uuid, Characteristic>,
    names: HashMap<Uuid, &'static str>,
    notifications: Pin<Box<dyn Stream<Item = ValueNotification> + Send>>,
    pub trace: Arc<Trace>,
}

impl Link {
    /// Connects, discovers services and opens the notification stream.
    /// `names` gives a short name to the characteristics we trace.
    pub async fn open(
        seen: &Seen,
        names: &[(&str, &'static str)],
        trace: Arc<Trace>,
    ) -> Result<Self> {
        let p = seen.peripheral.clone();
        trace.note(&format!("connect {} {:?}", seen.address, seen.name));
        if !p.is_connected().await? {
            p.connect()
                .await
                .context("connection failed (is the phone app connected to the device?)")?;
        }
        p.discover_services().await?;
        let chars = p
            .characteristics()
            .into_iter()
            .map(|c| (c.uuid, c))
            .collect();
        let names = names
            .iter()
            .map(|(u, n)| Ok((Uuid::parse_str(u)?, *n)))
            .collect::<Result<_>>()?;
        let notifications = p.notifications().await?;
        trace.note(&format!("connected, mtu {}", p.mtu()));
        Ok(Self {
            peripheral: p,
            chars,
            names,
            notifications,
            trace,
        })
    }

    pub fn has(&self, uuid: &str) -> bool {
        Uuid::parse_str(uuid).is_ok_and(|u| self.chars.contains_key(&u))
    }

    fn char(&self, uuid: &str) -> Result<&Characteristic> {
        let u = Uuid::parse_str(uuid)?;
        self.chars
            .get(&u)
            .ok_or_else(|| anyhow!("characteristic {uuid} not found"))
    }

    fn name(&self, u: &Uuid) -> String {
        self.names
            .get(u)
            .map_or_else(|| u.to_string(), |n| n.to_string())
    }

    pub async fn subscribe(&self, uuid: &str) -> Result<()> {
        let c = self.char(uuid)?;
        self.peripheral.subscribe(c).await?;
        self.trace
            .note(&format!("subscribed {}", self.name(&c.uuid)));
        Ok(())
    }

    /// Writes without response when the characteristic allows it and
    /// `prefer_no_response` is set, else with response.
    pub async fn write(&self, uuid: &str, bytes: &[u8], prefer_no_response: bool) -> Result<()> {
        let c = self.char(uuid)?;
        let wt =
            if prefer_no_response && c.properties.contains(CharPropFlags::WRITE_WITHOUT_RESPONSE) {
                WriteType::WithoutResponse
            } else {
                WriteType::WithResponse
            };
        self.trace.frame('>', &self.name(&c.uuid), bytes);
        self.peripheral.write(c, bytes, wt).await?;
        Ok(())
    }

    /// Next notification, or `None` after `timeout`.
    pub async fn next(&mut self, timeout: Duration) -> Result<Option<(Uuid, Vec<u8>)>> {
        match tokio::time::timeout(timeout, self.notifications.next()).await {
            Err(_) => Ok(None),
            Ok(None) => bail!("the device disconnected"),
            Ok(Some(n)) => {
                self.trace.frame('<', &self.name(&n.uuid), &n.value);
                Ok(Some((n.uuid, n.value)))
            }
        }
    }

    pub async fn close(&self) -> Result<()> {
        self.trace.note("disconnect");
        self.peripheral.disconnect().await?;
        Ok(())
    }
}

/// Prints the GATT table of a connected device.
pub fn print_gatt(p: &Peripheral) {
    for s in p.services() {
        println!(
            "service {}{}",
            s.uuid,
            if s.primary { "" } else { " (secondary)" }
        );
        for c in &s.characteristics {
            println!("  char {}  {:?}", c.uuid, c.properties);
            for d in &c.descriptors {
                println!("    desc {}", d.uuid);
            }
        }
    }
}
