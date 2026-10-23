//! Any model through `musette_core::Session`, the app's own session, on a
//! real link: what the app's `BleDevice` does (subscribe, write, arm the
//! timer the session asks for), so the CLI checks the app's protocol code.

use std::collections::VecDeque;
use std::time::{Duration, Instant};

use anyhow::{bail, Result};
use musette_core::{Channel, Model, Outcome, Session, Step, Timing};

use crate::ble::Link;
use crate::device::{Activity, Device};

pub struct SessionDevice {
    link: Link,
    session: Session,
    channels: Vec<Channel>,
    model: Model,
    /// Bytes one write carries on a channel that allows cutting (MTU less 3).
    max_write: usize,
    pub name: String,
    pub recording: bool,
    /// Drop the link once a request reports this progress (tests of resuming).
    pub cut_at: Option<f64>,
}

impl SessionDevice {
    pub async fn connect(link: Link, model: Model, timing: Timing) -> Result<Self> {
        use btleplug::api::Peripheral as _;
        let session = Session::new(model, timing);
        let max_write = usize::from(link.peripheral.mtu()).saturating_sub(3).max(20);
        let mut me = Self {
            channels: session.channels(),
            link,
            session,
            model,
            max_write,
            name: String::new(),
            recording: false,
            cut_at: None,
        };
        let step = me.session.connect()?;
        if let Outcome::Info {
            name, recording, ..
        } = me.run(step, &mut |_| {}).await?
        {
            me.name = name;
            me.recording = recording;
        }
        Ok(me)
    }

    pub fn session(&mut self) -> &mut Session {
        &mut self.session
    }

    /// Runs a request to its outcome; a failure is an error `code: detail`.
    pub async fn run(&mut self, first: Step, progress: &mut dyn FnMut(f64)) -> Result<Outcome> {
        let mut steps = VecDeque::from([first]);
        let mut deadline: Option<Instant> = None;
        loop {
            while let Some(s) = steps.pop_front() {
                for c in s.subscribe {
                    self.link
                        .subscribe(self.channels[c as usize].characteristic)
                        .await?;
                }
                for w in s.writes {
                    let c = &self.channels[w.channel as usize];
                    let size = if c.split {
                        self.max_write
                    } else {
                        w.bytes.len().max(1)
                    };
                    for part in w.bytes.chunks(size) {
                        self.link
                            .write(c.characteristic, part, !c.with_response)
                            .await?;
                    }
                }
                if let Some(p) = s.progress {
                    progress(p);
                    if self.cut_at.is_some_and(|c| p >= c) {
                        self.link.close().await?;
                        bail!("link dropped on purpose at {:.0} %", p * 100.0);
                    }
                }
                match s.wait_ms {
                    Some(0) => deadline = None,
                    Some(ms) => deadline = Some(Instant::now() + Duration::from_millis(ms.into())),
                    None => {}
                }
                match s.outcome {
                    Some(Outcome::Failed(f)) => bail!("{}: {}", f.code, f.detail),
                    Some(o) => return Ok(o),
                    None => {}
                }
            }
            let left = deadline.map_or(Duration::from_secs(3600), |d| {
                d.saturating_duration_since(Instant::now())
            });
            match self.link.next(left).await? {
                Some((uuid, bytes)) => {
                    let uuid = uuid.to_string();
                    if let Some(c) = self.channels.iter().position(|c| c.characteristic == uuid) {
                        steps.push_back(self.session.on_notify(c as u8, &bytes));
                    }
                }
                None => {
                    self.link.trace.note("silence: on_timeout");
                    steps.push_back(self.session.on_timeout());
                }
            }
        }
    }
}

impl Device for SessionDevice {
    fn model(&self) -> Model {
        self.model
    }

    async fn info(&mut self) -> Result<Vec<(String, String)>> {
        Ok(vec![
            ("name".into(), self.name.clone()),
            ("recording".into(), self.recording.to_string()),
            ("write size".into(), self.max_write.to_string()),
        ])
    }

    async fn list_activities(&mut self) -> Result<Vec<Activity>> {
        let step = self.session.list_activities()?;
        let Outcome::Activities { activities } = self.run(step, &mut |_| {}).await? else {
            bail!("no ride list");
        };
        Ok(activities
            .into_iter()
            .map(|a| Activity {
                name: format!("{}-{}", self.model.id(), a.id),
                detail: format!(
                    "start {:?}{} synced {:?}",
                    a.start_time,
                    if a.local_time { " (local)" } else { "" },
                    a.synced
                ),
                id: a.id,
                size: a.size,
            })
            .collect())
    }

    async fn download_activity(
        &mut self,
        id: &str,
        progress: &mut dyn FnMut(u64, u64),
    ) -> Result<Vec<u8>> {
        // The listing gives the size the CC600 needs.
        let size = self
            .list_activities()
            .await?
            .into_iter()
            .find(|a| a.id == id)
            .and_then(|a| a.size);
        let step = self.session.download(id, size)?;
        let Outcome::File { bytes } = self
            .run(step, &mut |p| progress((p * 1000.0) as u64, 1000))
            .await?
        else {
            bail!("no file");
        };
        Ok(bytes)
    }

    async fn acknowledge_activity(&mut self, id: &str) -> Result<()> {
        let step = self.session.acknowledge(id)?;
        self.run(step, &mut |_| {}).await?;
        Ok(())
    }

    async fn close(&mut self) -> Result<()> {
        self.link.close().await
    }
}
