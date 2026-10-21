//! Route building, off the device: GPX reading, simplification (Douglas-Peucker on the projected points and their
//! elevations), climb detection, encoding.

use alloc::string::String;
use alloc::vec::Vec;

use crate::{Info, MAGIC, NAME_MAX, VERSION, crc16, isqrt, project};

/// The elevation of a point left out stays this close to the line between the points kept, metres: the profile
/// the device draws and the climbs keep their shape on a straight road.
const ELE_TOLERANCE_M: f64 = 2.0;
/// Step of the profile the climbs are found on, metres.
const CLIMB_STEP_M: f64 = 20.0;
/// The foot and the top of a climb are moved to the lowest and the highest elevation around them (the climbs are
/// found on a profile smoothed over 100 m, which spreads them onto the flat on either side): within this, metres,
/// and the first point that high (the last that low) within [`CLIMB_FLAT_M`].
const CLIMB_ENDS_M: f64 = 100.0;
const CLIMB_FLAT_M: f64 = 1.0;

/// Points of a GPX: latitude, longitude (degrees), elevation (metres) when given; their times (Unix seconds) when
/// given (a recorded ride, or a planned one with times like Komoot's).
#[derive(Clone, Debug, Default, PartialEq)]
pub struct Gpx {
    pub name: String,
    pub points: Vec<(f64, f64, Option<f64>)>,
    pub times: Vec<Option<f64>>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum GpxError {
    /// Fewer than 2 points (`trkpt`, else `rtept`).
    NoPoints,
    /// A point without a readable `lat` or `lon`.
    BadPoint,
}

/// Reads the track points of a GPX (the route points if it has no track), every segment one after the other, and
/// the name of the track (else of the route, else of the file).
pub fn parse_gpx(text: &str) -> Result<Gpx, GpxError> {
    let tag = if text.contains("<trkpt") {
        "<trkpt"
    } else {
        "<rtept"
    };
    let mut points = Vec::new();
    let mut times = Vec::new();
    let mut rest = text;
    while let Some(i) = rest.find(tag) {
        rest = &rest[i + tag.len()..];
        let end = rest.find('>').ok_or(GpxError::BadPoint)?;
        let attrs = &rest[..end];
        let lat = attr(attrs, "lat").ok_or(GpxError::BadPoint)?;
        let lon = attr(attrs, "lon").ok_or(GpxError::BadPoint)?;
        let (mut ele, mut time) = (None, None);
        if !attrs.ends_with('/') {
            let close = alloc::format!("</{}>", &tag[1..]);
            let body = &rest[end..rest.find(close.as_str()).unwrap_or(rest.len())];
            ele = element(body, "ele").and_then(|e| e.trim().parse().ok());
            time = element(body, "time").and_then(|t| iso_time(t.trim()));
        }
        if !(-90.0..=90.0).contains(&lat) || !(-180.0..=180.0).contains(&lon) {
            return Err(GpxError::BadPoint);
        }
        points.push((lat, lon, ele));
        times.push(time);
    }
    if points.len() < 2 {
        return Err(GpxError::NoPoints);
    }
    let owner = if tag == "<trkpt" { "<trk" } else { "<rte" };
    let name = text
        .find(owner)
        .and_then(|i| element(&text[i..], "name"))
        .or_else(|| element(text, "name"))
        .map(|n| unescape(n.trim()))
        .unwrap_or_else(|| String::from("Trace"));
    Ok(Gpx {
        name,
        points,
        times,
    })
}

/// `YYYY-MM-DDTHH:MM:SS[.fff]Z` (UTC, as GPX files write it) in Unix seconds.
fn iso_time(t: &str) -> Option<f64> {
    let t = t.strip_suffix('Z')?;
    let (date, time) = t.split_once('T')?;
    let mut d = date.split('-').map(|v| v.parse::<i64>().ok());
    let (y, m, day) = (d.next()??, d.next()??, d.next()??);
    let mut h = time.split(':');
    let (hh, mm) = (
        h.next()?.parse::<i64>().ok()?,
        h.next()?.parse::<i64>().ok()?,
    );
    let ss: f64 = h.next()?.parse().ok()?;
    let (y2, m2) = if m <= 2 { (y - 1, m + 9) } else { (y, m - 3) };
    let era = y2.div_euclid(400);
    let yoe = y2 - era * 400;
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + (153 * m2 + 2) / 5 + day - 1;
    let days = era * 146_097 + doe - 719_468;
    Some((days * 86_400 + hh * 3600 + mm * 60) as f64 + ss)
}

/// The value of attribute `name` (quoted with " or ').
fn attr(attrs: &str, name: &str) -> Option<f64> {
    let mut rest = attrs;
    loop {
        let i = rest.find(name)?;
        let before_ok = i == 0 || rest.as_bytes()[i - 1].is_ascii_whitespace();
        rest = &rest[i + name.len()..];
        let after = rest.trim_start();
        if before_ok && let Some(v) = after.strip_prefix('=') {
            let v = v.trim_start();
            let q = v.chars().next()?;
            let v = &v[1..];
            return v[..v.find(q)?].trim().parse().ok();
        }
    }
}

/// The text of the first `<name>` element.
fn element<'a>(text: &'a str, name: &str) -> Option<&'a str> {
    let open = alloc::format!("<{name}>");
    let close = alloc::format!("</{name}>");
    let i = text.find(open.as_str())? + open.len();
    let j = text[i..].find(close.as_str())? + i;
    Some(&text[i..j])
}

fn unescape(s: &str) -> String {
    let mut out = String::new();
    let mut rest = s;
    while let Some(i) = rest.find('&') {
        out.push_str(&rest[..i]);
        rest = &rest[i..];
        let Some(end) = rest.find(';') else { break };
        let entity = &rest[1..end];
        let c = match entity {
            "amp" => Some('&'),
            "lt" => Some('<'),
            "gt" => Some('>'),
            "quot" => Some('"'),
            "apos" => Some('\''),
            e if e.starts_with("#x") => u32::from_str_radix(&e[2..], 16)
                .ok()
                .and_then(char::from_u32),
            e if e.starts_with('#') => e[1..].parse().ok().and_then(char::from_u32),
            _ => None,
        };
        match c {
            Some(c) => {
                out.push(c);
                rest = &rest[end + 1..];
            }
            None => {
                out.push('&');
                rest = &rest[1..];
            }
        }
    }
    out.push_str(rest);
    out
}

/// Ascent and descent counted with this hysteresis, like the recorder's (crates/recorder).
const CLIMB_HYSTERESIS_M: f64 = 2.0;

/// The route file of `gpx`, its line simplified to `tolerance_m` (a few metres: the screen shows 2 km on 240
/// pixels at most) and its elevations to [`ELE_TOLERANCE_M`], with its climbs.
pub fn build(gpx: &Gpx, tolerance_m: f64) -> Vec<u8> {
    let (mut lat_lo, mut lat_hi, mut lon_lo, mut lon_hi) = (90.0f64, -90.0f64, 180.0f64, -180.0f64);
    for &(lat, lon, _) in &gpx.points {
        lat_lo = lat_lo.min(lat);
        lat_hi = lat_hi.max(lat);
        lon_lo = lon_lo.min(lon);
        lon_hi = lon_hi.max(lon);
    }
    let (lat0, lon0) = ((lat_lo + lat_hi) / 2.0, (lon_lo + lon_hi) / 2.0);
    // decimetres per 1e-7 degree: 1 degree of latitude is 111 319.49 m (equirectangular, sphere of the WGS84
    // equatorial radius)
    let dm_per_e7 = 111_319.490_793 * 10.0 * 1e-7;
    let mut info = Info {
        lat0_e7: e7(lat0),
        lon0_e7: e7(lon0),
        kx_q24: libm::round(dm_per_e7 * libm::cos(lat0.to_radians()) * 16_777_216.0) as i32,
        ky_q24: libm::round(dm_per_e7 * 16_777_216.0) as i32,
        count: 0,
        length_dm: 0,
        ascent_m: 0,
        descent_m: 0,
        min_ele_dm: 0,
        max_ele_dm: 0,
        bbox: [i32::MAX, i32::MAX, i32::MIN, i32::MIN],
    };
    // elevation: the last known one where a point has none (0 without any)
    let mut last_ele = gpx.points.iter().find_map(|p| p.2).unwrap_or(0.0);
    let all: Vec<(i32, i32, i32)> = gpx
        .points
        .iter()
        .map(|&(lat, lon, ele)| {
            last_ele = ele.unwrap_or(last_ele);
            let (x, y) = project(&info, e7(lat), e7(lon));
            (x, y, libm::round(last_ele * 10.0) as i32)
        })
        .collect();
    let (ascent, descent) = climb(all.iter().map(|p| p.2 as f64 / 10.0));
    info.ascent_m = ascent.min(u16::MAX as f64) as u16;
    info.descent_m = descent.min(u16::MAX as f64) as u16;
    let keep = simplify(&all, tolerance_m * 10.0, ELE_TOLERANCE_M * 10.0);
    let kept: Vec<(i32, i32, i32)> = all
        .iter()
        .zip(&keep)
        .filter(|(_, k)| **k)
        .map(|(p, _)| *p)
        .collect();

    let mut points = Vec::new();
    let mut last = (0, 0, 0);
    for (i, &(x, y, z)) in kept.iter().enumerate() {
        let len = if i == 0 {
            0
        } else {
            let (dx, dy) = ((x - last.0) as i64, (y - last.1) as i64);
            isqrt((dx * dx + dy * dy) as u64) as u32
        };
        zigzag(&mut points, x.wrapping_sub(last.0));
        zigzag(&mut points, y.wrapping_sub(last.1));
        zigzag(&mut points, z.wrapping_sub(last.2));
        varint(&mut points, len);
        info.length_dm += len;
        info.bbox = [
            info.bbox[0].min(x),
            info.bbox[1].min(y),
            info.bbox[2].max(x),
            info.bbox[3].max(y),
        ];
        last = (x, y, z);
    }
    info.count = kept.len() as u32;
    let climbs = find_climbs(&kept, info.length_dm);
    info.min_ele_dm = kept.iter().map(|p| p.2).min().unwrap_or(0);
    info.max_ele_dm = kept.iter().map(|p| p.2).max().unwrap_or(0);

    let mut out = Vec::new();
    out.extend_from_slice(MAGIC);
    out.push(VERSION);
    let mut name = gpx.name.as_str();
    while name.len() > NAME_MAX {
        name = &name[..name.floor_char_boundary(name.len() - 1)];
    }
    out.push(name.len() as u8);
    out.extend_from_slice(name.as_bytes());
    for v in [info.lat0_e7, info.lon0_e7, info.kx_q24, info.ky_q24] {
        out.extend_from_slice(&v.to_le_bytes());
    }
    out.extend_from_slice(&info.count.to_le_bytes());
    out.extend_from_slice(&info.length_dm.to_le_bytes());
    out.extend_from_slice(&info.ascent_m.to_le_bytes());
    out.extend_from_slice(&info.descent_m.to_le_bytes());
    for v in [info.min_ele_dm, info.max_ele_dm] {
        out.extend_from_slice(&v.to_le_bytes());
    }
    for v in info.bbox {
        out.extend_from_slice(&v.to_le_bytes());
    }
    out.extend_from_slice(&points);
    out.push(climbs.len() as u8);
    for c in &climbs {
        out.extend_from_slice(&c.start_dm.to_le_bytes());
        out.extend_from_slice(&c.end_dm.to_le_bytes());
        out.extend_from_slice(&c.gain_m.to_le_bytes());
        out.extend_from_slice(&c.max_grade_pm.to_le_bytes());
    }
    let crc = crc16(&out);
    out.extend_from_slice(&crc.to_le_bytes());
    out
}

fn e7(deg: f64) -> i32 {
    libm::round(deg * 1e7) as i32
}

/// Ascent and descent of elevations (metres), with [`CLIMB_HYSTERESIS_M`].
fn climb(eles: impl Iterator<Item = f64>) -> (f64, f64) {
    let (mut up, mut down) = (0.0, 0.0);
    let mut reference: Option<f64> = None;
    for e in eles {
        let r = *reference.get_or_insert(e);
        if e >= r + CLIMB_HYSTERESIS_M {
            up += e - r;
            reference = Some(e);
        } else if e <= r - CLIMB_HYSTERESIS_M {
            down += r - e;
            reference = Some(e);
        }
    }
    (up, down)
}

/// The climbs of the points kept (x, y, elevation, decimetres), along the route as the device measures it (the
/// straight lines between them, `length_dm` in all), 255 at most. The parameters are those of the app's climbs.
fn find_climbs(points: &[(i32, i32, i32)], length_dm: u32) -> Vec<crate::Climb> {
    let mut along = Vec::with_capacity(points.len());
    let mut d = 0.0;
    for (i, p) in points.iter().enumerate() {
        if i > 0 {
            d += planar(points[i - 1], *p);
        }
        along.push(d / 10.0);
    }
    let total = d / 10.0;
    let mut ele = Vec::new();
    let mut k = 0;
    for i in 0..=libm::floor(total / CLIMB_STEP_M) as usize {
        let x = i as f64 * CLIMB_STEP_M;
        while k + 2 < points.len() && along[k + 1] < x {
            k += 1;
        }
        let (d0, d1) = (along[k], along[(k + 1).min(points.len() - 1)]);
        let (e0, e1) = (
            points[k].2 as f64 / 10.0,
            points[(k + 1).min(points.len() - 1)].2 as f64 / 10.0,
        );
        let f = if d1 > d0 {
            ((x - d0) / (d1 - d0)).clamp(0.0, 1.0)
        } else {
            0.0
        };
        ele.push(e0 + (e1 - e0) * f);
    }
    let profile = track::Profile {
        step: CLIMB_STEP_M,
        ele,
    };
    let ele = &profile.ele;
    let index = |m: f64| (libm::round(m / CLIMB_STEP_M) as usize).min(ele.len() - 1);
    let around = libm::round(CLIMB_ENDS_M / CLIMB_STEP_M) as usize;
    // the device's lengths are whole decimetres per segment: the ends within its length
    climbs::detect(&profile, &climbs::Params::default())
        .into_iter()
        .take(u8::MAX as usize)
        .map(|c| {
            // the top: the first point near the highest up to a little after it; the foot: the last point near
            // the lowest from a little before it to the top
            let (a, b) = (index(c.start), index(c.end));
            let top_range = a..=(b + around).min(ele.len() - 1);
            let high = top_range.clone().map(|i| ele[i]).fold(f64::MIN, f64::max);
            let top = top_range
                .clone()
                .find(|&i| ele[i] >= high - CLIMB_FLAT_M)
                .unwrap_or(b);
            let foot_range = a.saturating_sub(around)..=top;
            let low = foot_range.clone().map(|i| ele[i]).fold(f64::MAX, f64::min);
            let foot = foot_range
                .rev()
                .find(|&i| ele[i] <= low + CLIMB_FLAT_M)
                .unwrap_or(a);
            let dm = |i: usize| (libm::round(i as f64 * CLIMB_STEP_M * 10.0) as u32).min(length_dm);
            crate::Climb {
                start_dm: dm(foot),
                end_dm: dm(top),
                gain_m: libm::round(ele[top] - ele[foot]).clamp(0.0, u16::MAX as f64) as u16,
                max_grade_pm: libm::round(c.max_grade * 1000.0).clamp(0.0, u16::MAX as f64) as u16,
            }
        })
        .filter(|c| c.end_dm > c.start_dm)
        .collect()
}

fn planar(a: (i32, i32, i32), b: (i32, i32, i32)) -> f64 {
    let (dx, dy) = ((b.0 - a.0) as f64, (b.1 - a.1) as f64);
    libm::sqrt(dx * dx + dy * dy)
}

/// Douglas-Peucker on x, y and the elevation: which points to keep so that the line stays within `tolerance` of
/// them all, and the elevation within `ele_tolerance` of the one between the points kept (linear along the
/// points).
fn simplify(points: &[(i32, i32, i32)], tolerance: f64, ele_tolerance: f64) -> Vec<bool> {
    let mut keep = alloc::vec![false; points.len()];
    if points.is_empty() {
        return keep;
    }
    let mut along = Vec::with_capacity(points.len());
    let mut d = 0.0;
    for (i, p) in points.iter().enumerate() {
        if i > 0 {
            d += planar(points[i - 1], *p);
        }
        along.push(d);
    }
    keep[0] = true;
    keep[points.len() - 1] = true;
    let mut stack = alloc::vec![(0, points.len() - 1)];
    while let Some((a, b)) = stack.pop() {
        if b <= a + 1 {
            continue;
        }
        let (pa, pb) = (points[a], points[b]);
        let (mut far, mut far_d) = (a, 0.0);
        for (i, p) in points.iter().enumerate().take(b).skip(a + 1) {
            let f = if along[b] > along[a] {
                (along[i] - along[a]) / (along[b] - along[a])
            } else {
                0.0
            };
            let ele = pa.2 as f64 + (pb.2 - pa.2) as f64 * f;
            // the farther of the two, in tolerances
            let d = (distance_to_segment(*p, pa, pb) / tolerance)
                .max(libm::fabs(p.2 as f64 - ele) / ele_tolerance);
            if d > far_d {
                far = i;
                far_d = d;
            }
        }
        if far_d > 1.0 {
            keep[far] = true;
            stack.push((a, far));
            stack.push((far, b));
        }
    }
    keep
}

fn distance_to_segment(p: (i32, i32, i32), a: (i32, i32, i32), b: (i32, i32, i32)) -> f64 {
    let (px, py) = ((p.0 - a.0) as f64, (p.1 - a.1) as f64);
    let (dx, dy) = ((b.0 - a.0) as f64, (b.1 - a.1) as f64);
    let len2 = dx * dx + dy * dy;
    let t = if len2 == 0.0 {
        0.0
    } else {
        ((px * dx + py * dy) / len2).clamp(0.0, 1.0)
    };
    let (ex, ey) = (px - t * dx, py - t * dy);
    libm::sqrt(ex * ex + ey * ey)
}

pub(crate) fn varint(out: &mut Vec<u8>, mut v: u32) {
    while v >= 0x80 {
        out.push(v as u8 | 0x80);
        v >>= 7;
    }
    out.push(v as u8);
}

pub(crate) fn zigzag(out: &mut Vec<u8>, v: i32) {
    varint(out, ((v << 1) ^ (v >> 31)) as u32);
}
