//! What the Musette app asks of the Rust crates, as plain Rust.
//!
//! The same for every host: `musette-wasm` (web) and `musette-ffi` (iOS,
//! Android) only convert types. Keep the logic here, so that both apps behave
//! the same.

#[cfg(feature = "serde")]
use serde::Serialize;

/// An error for the app: the message is shown as is (or mapped by the app).
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Error(pub String);

impl core::fmt::Display for Error {
    fn fmt(&self, f: &mut core::fmt::Formatter<'_>) -> core::fmt::Result {
        f.write_str(&self.0)
    }
}

impl std::error::Error for Error {}

fn error(msg: impl Into<String>) -> Error {
    Error(msg.into())
}

pub type Result<T> = core::result::Result<T, Error>;

// ---- routes ------------------------------------------------------------

#[derive(Clone, Debug, PartialEq)]
#[cfg_attr(feature = "serde", derive(Serialize), serde(rename_all = "camelCase"))]
pub struct Climb {
    pub start_m: f64,
    pub end_m: f64,
    pub gain_m: f64,
    pub avg_grade: f64,
    pub max_grade: f64,
    /// `uncategorized`, `4`, `3`, `2`, `1` or `HC`.
    pub category: &'static str,
}

#[derive(Clone, Debug, PartialEq)]
#[cfg_attr(feature = "serde", derive(Serialize), serde(rename_all = "camelCase"))]
pub struct RouteAnalysis {
    pub distance_m: f64,
    pub ascent_m: f64,
    pub profile_step_m: f64,
    pub profile: Vec<f64>,
    pub climbs: Vec<Climb>,
    /// Indices of points kept after simplification (5 m tolerance).
    pub simplified: Vec<u32>,
    /// Distance from the start at each `simplified` point, metres (to place climbs on a map).
    pub simplified_m: Vec<f64>,
}

fn check_lengths(lats: &[f64], lons: &[f64], eles: &[f64]) -> Result<()> {
    if lats.len() != lons.len() || lats.len() != eles.len() {
        return Err(error("lats, lons and eles must have the same length"));
    }
    Ok(())
}

/// Track points from the app's arrays; `eles` uses NaN when unknown.
fn to_points(lats: &[f64], lons: &[f64], eles: &[f64]) -> Result<Vec<track::Point>> {
    check_lengths(lats, lons, eles)?;
    Ok(lats
        .iter()
        .zip(lons)
        .zip(eles)
        .map(|((&lat, &lon), &e)| track::Point::new(lat, lon, (!e.is_nan()).then_some(e)))
        .collect())
}

/// Analyse a route. `eles` uses NaN for missing elevation.
pub fn analyze_route(lats: &[f64], lons: &[f64], eles: &[f64]) -> Result<RouteAnalysis> {
    let points = to_points(lats, lons, eles)?;

    let cumulative = track::cumulative_distance(&points);
    let distance_m = cumulative.last().copied().unwrap_or(0.0);
    let kept = track::simplify(&points, 5.0);
    let simplified_m = kept.iter().map(|&i| cumulative[i]).collect();
    let simplified = kept.into_iter().map(|i| i as u32).collect();

    let (profile_step_m, profile, ascent_m, climbs) = match track::profile(&points, 20.0) {
        Some(p) => {
            let climbs = climbs::detect(&p, &climbs::Params::default())
                .into_iter()
                .map(|c| Climb {
                    start_m: c.start,
                    end_m: c.end,
                    gain_m: c.gain,
                    avg_grade: c.avg_grade,
                    max_grade: c.max_grade,
                    category: category_name(c.category),
                })
                .collect();
            let ascent = track::total_ascent(&p.ele, 5.0);
            (p.step, p.ele, ascent, climbs)
        }
        None => (0.0, Vec::new(), 0.0, Vec::new()),
    };

    Ok(RouteAnalysis {
        distance_m,
        ascent_m,
        profile_step_m,
        profile,
        climbs,
        simplified,
        simplified_m,
    })
}

fn category_name(c: climbs::Category) -> &'static str {
    use climbs::Category::*;
    match c {
        Uncategorized => "uncategorized",
        Cat4 => "4",
        Cat3 => "3",
        Cat2 => "2",
        Cat1 => "1",
        Hc => "HC",
    }
}

/// A route read from a GPX file, device-neutral.
#[derive(Clone, Debug, PartialEq)]
#[cfg_attr(feature = "serde", derive(Serialize))]
pub struct ParsedRoute {
    pub name: String,
    pub lats: Vec<f64>,
    pub lons: Vec<f64>,
    /// NaN where elevation is missing.
    pub eles: Vec<f64>,
}

/// Reads a GPX file (track points, else route points). The error is the
/// reason, for the app to word: `noPoints` or `badPoint`.
pub fn parse_gpx(text: &str) -> Result<ParsedRoute> {
    let gpx = route_cc600::parse_gpx(text).map_err(|e| match e {
        route_cc600::GpxError::NoPoints => error("noPoints"),
        route_cc600::GpxError::BadPoint => error("badPoint"),
    })?;
    let name = match gpx.name.trim() {
        "" => "Trace".to_owned(),
        name => name.to_owned(),
    };
    Ok(ParsedRoute {
        name,
        lats: gpx.points.iter().map(|p| p.0).collect(),
        lons: gpx.points.iter().map(|p| p.1).collect(),
        eles: gpx.points.iter().map(|p| p.2.unwrap_or(f64::NAN)).collect(),
    })
}

// ---- rides -------------------------------------------------------------

/// Checks that a FIT file is whole (header and CRC); returns its data size.
pub fn verify_fit(bytes: &[u8]) -> Result<u32> {
    fit::verify(bytes)
        .map(|h| h.data_size)
        .map_err(|e| error(format!("{e:?}")))
}

#[derive(Clone, Debug, PartialEq, Eq)]
#[cfg_attr(feature = "serde", derive(Serialize))]
pub struct ActivityRef {
    pub id: String,
    pub size: Option<u64>,
}

/// Pick activity files from a Bryton drive listing.
pub fn bryton_find_activities(paths: Vec<String>, sizes: &[f64]) -> Vec<ActivityRef> {
    let files: Vec<driver_bryton::DriveFile> = paths
        .into_iter()
        .zip(sizes)
        .map(|(path, &size)| driver_bryton::DriveFile {
            path,
            size: size as u64,
        })
        .collect();
    driver_bryton::find_activities(&files)
        .into_iter()
        .map(|a| ActivityRef {
            id: a.id,
            size: a.size,
        })
        .collect()
}

// ---- devices -------------------------------------------------------------

pub mod session;

pub use device::{Link, Model};
pub use session::{
    setting_fields, Activity, Channel, Failure, FileKind, Outcome, Session, Setting, SettingField,
    Step, Timing, Write,
};

/// A model from the app's name for it (`open-cc600`...).
pub fn model(id: &str) -> Result<Model> {
    Model::from_id(id).ok_or_else(|| error(format!("unknown model {id}")))
}

/// What a device can do over a link.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
#[cfg_attr(feature = "serde", derive(Serialize), serde(rename_all = "camelCase"))]
pub struct Capabilities {
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

pub fn capabilities(model: Model, link: Link) -> Capabilities {
    let c = model.capabilities_over(link);
    Capabilities {
        download_activities: c.download_activities,
        upload_route: c.upload_route,
        route_corridor_map: c.route_corridor_map,
        climbs_on_device: c.climbs_on_device,
        settings: c.settings,
        sensors: c.sensors,
        wifi_sync: c.wifi_sync,
    }
}

/// A route file for a Bryton (its own FIT messages) from track points, start
/// and arrival turns only; `eles` uses NaN when unknown. Points are kept
/// within 5 m of the track.
fn bryton_build_route(lats: &[f64], lons: &[f64], eles: &[f64]) -> Result<Vec<u8>> {
    let points = to_points(lats, lons, eles)?;
    let keep = track::simplify(&points, 5.0);
    let kept: Vec<track::Point> = keep.into_iter().map(|i| points[i]).collect();
    // 16 km/h for the turn durations, as the app's routes.
    driver_bryton::route::Route::from_track(&kept, 16.0 / 3.6)
        .encode()
        .map_err(|e| error(format!("{e:?}")))
}

/// Simplification of the CC600 route line, metres (as the firmware's route tool).
const CC600_ROUTE_TOLERANCE_M: f64 = 3.0;

/// The CC600 route file (`OCRT`) of a route. `eles` uses NaN for missing elevation.
fn cc600_build_route(name: String, lats: &[f64], lons: &[f64], eles: &[f64]) -> Result<Vec<u8>> {
    check_lengths(lats, lons, eles)?;
    if lats.len() < 2 {
        return Err(error("a route needs at least 2 points"));
    }
    let gpx = route_cc600::Gpx {
        name,
        points: lats
            .iter()
            .zip(lons)
            .zip(eles)
            .map(|((&lat, &lon), &e)| (lat, lon, (!e.is_nan()).then_some(e)))
            .collect(),
        times: vec![None; lats.len()],
    };
    Ok(route_cc600::build(&gpx, CC600_ROUTE_TOLERANCE_M))
}

/// Names of the map classes ([`route_cc600::map::class`]), for the app.
const MAP_CLASSES: [&str; route_cc600::map::class::COUNT] = [
    "forest",
    "water",
    "residential",
    "contour",
    "contour50",
    "stream",
    "river",
    "path",
    "track",
    "service",
    "minor",
    "major",
];

/// The CC600 background map (`OCMP`) of a route, for the file
/// [`Session::send_route`] writes from the same route. The features (OSM ways)
/// come flat: feature `i` is of class `classes[i]` (a name of [`MAP_CLASSES`])
/// and has the next `lengths[i]` points of `lats`/`lons` (degrees). Those
/// within `corridor_m` of the route are kept.
pub fn cc600_build_map(
    route: &ParsedRoute,
    classes: &[String],
    lengths: &[u32],
    lats: &[f64],
    lons: &[f64],
    corridor_m: f64,
) -> Result<Vec<u8>> {
    if classes.len() != lengths.len() || lats.len() != lons.len() {
        return Err(error(
            "classes and lengths, lats and lons must have the same length",
        ));
    }
    if lengths.iter().map(|&n| n as usize).sum::<usize>() != lats.len() {
        return Err(error("lengths must add up to the points"));
    }
    let classes = classes
        .iter()
        .map(|name| {
            MAP_CLASSES
                .iter()
                .position(|c| c == name)
                .map(|c| c as u8)
                .ok_or_else(|| error(format!("unknown map class {name}")))
        })
        .collect::<Result<Vec<u8>>>()?;
    let route_file = cc600_build_route(route.name.clone(), &route.lats, &route.lons, &route.eles)?;
    let e7 = |d: f64| (d * 1e7).round() as i32;
    let mut start = 0;
    let features: Vec<route_cc600::MapFeature> = classes
        .into_iter()
        .zip(lengths)
        .map(|(class, &n)| {
            let range = start..start + n as usize;
            start = range.end;
            route_cc600::MapFeature {
                class,
                points: lats[range.clone()]
                    .iter()
                    .zip(&lons[range])
                    .map(|(&lat, &lon)| (e7(lat), e7(lon)))
                    .collect(),
            }
        })
        .filter(|f| f.points.len() > 1)
        .collect();
    Ok(route_cc600::build_map(&route_file, &features, corridor_m).0)
}

/// A CC600 in memory (`driver_cc600::sim`): the app's demo without a
/// device, and its tests. Frames in, frames out.
pub struct Cc600Simulator(driver_cc600::sim::Device);

impl Cc600Simulator {
    /// `window` and `free` 0 for the defaults; `lose_chunks` and `lose_acks`
    /// count `TransferChunk`s and `TransferAck`s from 1.
    pub fn new(
        window: u16,
        free: u32,
        settings: String,
        lose_chunks: Vec<u32>,
        lose_acks: Vec<u32>,
    ) -> Self {
        Self(driver_cc600::sim::Device::new(driver_cc600::sim::Config {
            window,
            free,
            settings,
            lose_chunks,
            lose_acks,
        }))
    }

    /// A ride on the device; `start_time` in Unix seconds.
    pub fn add_activity(&mut self, id: u32, start_time: i64, fit: Vec<u8>) {
        self.0.add_activity(id, start_time, fit);
    }

    /// Bytes the app wrote; the frames the device answers.
    pub fn write(&mut self, bytes: &[u8]) -> Vec<Vec<u8>> {
        self.0.write(bytes)
    }

    /// The link dropped: the partial file stays, as on the device.
    pub fn disconnect(&mut self) {
        self.0.disconnect();
    }

    /// Bytes of the partial file held so far.
    pub fn received(&self) -> u32 {
        self.0.received()
    }

    /// The last file committed by `TransferEnd`.
    pub fn committed(&self) -> Option<Vec<u8>> {
        self.0.committed().map(<[u8]>::to_vec)
    }

    /// File bytes received in `TransferChunk`s, lost ones included.
    pub fn chunk_bytes(&self) -> u32 {
        self.0.chunk_bytes
    }

    /// Ride ids acknowledged, in order.
    pub fn acked(&self) -> Vec<u32> {
        self.0.acked.clone()
    }

    /// The settings file.
    pub fn settings(&self) -> String {
        self.0.settings.clone()
    }

    /// `SetSettings` payloads received, in order.
    pub fn settings_writes(&self) -> Vec<String> {
        self.0.settings_writes.clone()
    }
}

#[cfg(test)]
mod tests;
