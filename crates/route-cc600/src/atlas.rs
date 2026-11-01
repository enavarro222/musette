//! Permanent geographic atlas (OCAT), independent of a route and its projection.
//! Coordinates are degrees ×1000 in v1, ×100000 in precise v2. An indexed bounding box
//! per feature lets the renderer skip offscreen geometry without decoding it.
//! Header: magic, version, name length, UTF-8 name, feature count (u32).
//! Version 2 adds the minimum usable metres/pixel (u16) before the index.
//! Index entries: west/south/east/north (i32), body offset and length (u32).
//! Body: class, level, label length (u8), point count (u16), label, then
//! longitude/latitude zigzag-varint deltas from (0,0). CRC16 ends the file.

use crate::{Error, Reader, crc16};

pub const MAGIC: &[u8; 4] = b"OCAT";
pub const MAX_BYTES: usize = 512 * 1024;
pub const LATEST_VERSION: u8 = 2;
pub const MAX_POINTS: usize = 255;
pub const BOUNDARY: u8 = 0;
pub const RIVER: u8 = 1;
pub const CITY: u8 = 2;
pub const ROAD: u8 = 3;
pub const DEPARTMENT: u8 = 4;
pub const LAKE: u8 = 5;
pub const MINOR: u8 = 6;
pub const PATH: u8 = 7;
pub const STREAM: u8 = 8;
pub const TRACK: u8 = 9;
pub const PRECISE_SCALE: i32 = 100_000;
/// v2 geometry identical at all three zoom levels is stored once.
pub const SHARED_LEVEL: u8 = 3;
const ENTRY: usize = 24;

#[derive(Clone, Copy)]
pub struct Atlas<'a> {
    data: &'a [u8],
    pub name: &'a str,
    /// Geographic integer units per degree: v1 1,000, v2 100,000.
    pub scale: i32,
    /// Suggested scale for the source precision/generalisation; not a visibility switch.
    pub min_m_per_px: u16,
    count: usize,
    index: usize,
}

impl<'a> Atlas<'a> {
    pub fn parse(data: &'a [u8]) -> Result<Self, Error> {
        let atlas = Self::read(data)?;
        if crc16(&data[..data.len() - 2]).to_le_bytes() != data[data.len() - 2..] {
            return Err(Error::Corrupt);
        }
        let mut next = atlas.index + atlas.count * ENTRY;
        for i in 0..atlas.count {
            let (bbox, offset, len) = atlas.entry(i);
            if bbox[0] > bbox[2]
                || bbox[1] > bbox[3]
                || bbox[0] < -180 * atlas.scale
                || bbox[2] > 180 * atlas.scale
                || bbox[1] < -90 * atlas.scale
                || bbox[3] > 90 * atlas.scale
                || offset != next
                || len < 5
                || offset.checked_add(len).is_none_or(|n| n > atlas.data.len())
            {
                return Err(Error::Corrupt);
            }
            let f = atlas.feature(offset, len)?;
            let expected = if f.class == CITY { 1 } else { 2 };
            if f.class > (if atlas.scale == 1000 { LAKE } else { TRACK })
                || f.level > (if atlas.scale == 1000 { 2 } else { SHARED_LEVEL })
                || f.count < expected
                || usize::from(f.count) > MAX_POINTS
                || (f.class == CITY && (f.count != 1 || f.level != 0))
            {
                return Err(Error::Corrupt);
            }
            let mut r = Reader {
                data: f.data,
                at: 0,
            };
            let (mut x, mut y) = (0i32, 0i32);
            for _ in 0..f.count {
                x = x.checked_add(r.zigzag()?).ok_or(Error::Corrupt)?;
                y = y.checked_add(r.zigzag()?).ok_or(Error::Corrupt)?;
                if x < bbox[0] || x > bbox[2] || y < bbox[1] || y > bbox[3] {
                    return Err(Error::Corrupt);
                }
            }
            if r.at != f.data.len() {
                return Err(Error::Corrupt);
            }
            next += len;
        }
        if next != atlas.data.len() {
            return Err(Error::Corrupt);
        }
        Ok(atlas)
    }

    /// Header-only read after validation on receipt/boot; no per-frame CRC scan.
    pub fn read(data: &'a [u8]) -> Result<Self, Error> {
        if data.len() < 12
            || data.len() > MAX_BYTES
            || &data[..4] != MAGIC
            || !matches!(data[4], 1 | 2)
        {
            return Err(Error::Format);
        }
        let body = &data[..data.len() - 2];
        let name_len = usize::from(body[5]);
        if name_len > 63 {
            return Err(Error::Corrupt);
        }
        let name = core::str::from_utf8(body.get(6..6 + name_len).ok_or(Error::Corrupt)?)
            .map_err(|_| Error::Corrupt)?;
        let mut r = Reader {
            data: body,
            at: 6 + name_len,
        };
        let count = r.u32()? as usize;
        let min_m_per_px = if data[4] == 1 { 20 } else { r.u16()? };
        if min_m_per_px == 0 {
            return Err(Error::Corrupt);
        }
        let index = r.at;
        if count > (body.len() - index) / ENTRY {
            return Err(Error::Corrupt);
        }
        Ok(Self {
            data: body,
            name,
            scale: if data[4] == 1 { 1000 } else { PRECISE_SCALE },
            min_m_per_px,
            count,
            index,
        })
    }

    fn entry(&self, i: usize) -> ([i32; 4], usize, usize) {
        let mut r = Reader {
            data: self.data,
            at: self.index + i * ENTRY,
        };
        (
            [
                r.i32().unwrap(),
                r.i32().unwrap(),
                r.i32().unwrap(),
                r.i32().unwrap(),
            ],
            r.u32().unwrap() as usize,
            r.u32().unwrap() as usize,
        )
    }

    fn feature(&self, offset: usize, len: usize) -> Result<Feature<'a>, Error> {
        let bytes = self.data.get(offset..offset + len).ok_or(Error::Corrupt)?;
        let mut r = Reader { data: bytes, at: 0 };
        let (class, level, label_len, count) = (r.u8()?, r.u8()?, usize::from(r.u8()?), r.u16()?);
        if label_len > 24 {
            return Err(Error::Corrupt);
        }
        let label = core::str::from_utf8(bytes.get(r.at..r.at + label_len).ok_or(Error::Corrupt)?)
            .map_err(|_| Error::Corrupt)?;
        // Labels are printable ASCII: every supported device font can draw them.
        if !label.bytes().all(|b| (32..=126).contains(&b)) {
            return Err(Error::Corrupt);
        }
        Ok(Feature {
            class,
            level,
            label,
            count,
            data: &bytes[r.at + label_len..],
        })
    }

    /// Visible features at one simplification level; cities are stored once, at level zero.
    pub fn features(&self, level: u8, bbox: [i32; 4]) -> impl Iterator<Item = Feature<'a>> + '_ {
        (0..self.count).filter_map(move |i| {
            let (b, at, len) = self.entry(i);
            if b[2] < bbox[0] || b[0] > bbox[2] || b[3] < bbox[1] || b[1] > bbox[3] {
                return None;
            }
            let f = self.feature(at, len).ok()?;
            (f.level == level || f.level == SHARED_LEVEL || f.class == CITY).then_some(f)
        })
    }
}

#[derive(Clone, Copy)]
pub struct Feature<'a> {
    pub class: u8,
    pub level: u8,
    pub label: &'a str,
    pub count: u16,
    data: &'a [u8],
}

impl Feature<'_> {
    pub fn points(&self) -> impl Iterator<Item = (i32, i32)> + '_ {
        let mut r = Reader {
            data: self.data,
            at: 0,
        };
        let (mut x, mut y) = (0, 0);
        (0..self.count).map_while(move |_| {
            x += r.zigzag().ok()?;
            y += r.zigzag().ok()?;
            Some((x, y))
        })
    }
}

#[cfg(feature = "build")]
pub mod build {
    use super::*;
    use crate::build::zigzag;
    use alloc::{string::String, vec::Vec};

    pub struct Feature {
        pub class: u8,
        pub level: u8,
        pub label: String,
        pub points: Vec<(i32, i32)>,
    }

    pub fn encode(name: &str, features: &[Feature]) -> Result<Vec<u8>, Error> {
        encode_version(name, features, 1, 20)
    }

    pub fn encode_precise(name: &str, features: &[Feature]) -> Result<Vec<u8>, Error> {
        encode_version(name, features, LATEST_VERSION, 1)
    }

    fn encode_version(
        name: &str,
        features: &[Feature],
        version: u8,
        min_m_per_px: u16,
    ) -> Result<Vec<u8>, Error> {
        if name.len() > 63
            || features
                .iter()
                .any(|f| f.points.len() > MAX_POINTS || f.label.len() > 24)
        {
            return Err(Error::Format);
        }
        let mut out = Vec::new();
        out.extend_from_slice(MAGIC);
        out.extend_from_slice(&[version, name.len() as u8]);
        out.extend_from_slice(name.as_bytes());
        out.extend_from_slice(&(features.len() as u32).to_le_bytes());
        if version == 2 {
            out.extend_from_slice(&min_m_per_px.to_le_bytes());
        }
        let index = out.len();
        if features.len() > (MAX_BYTES - index - 2) / ENTRY {
            return Err(Error::TooLarge);
        }
        out.resize(index + features.len() * ENTRY, 0);
        for (i, f) in features.iter().enumerate() {
            if f.points.is_empty() {
                return Err(Error::Format);
            }
            let b = [
                f.points.iter().map(|p| p.0).min().unwrap(),
                f.points.iter().map(|p| p.1).min().unwrap(),
                f.points.iter().map(|p| p.0).max().unwrap(),
                f.points.iter().map(|p| p.1).max().unwrap(),
            ];
            let at = out.len();
            out.extend_from_slice(&[f.class, f.level, f.label.len() as u8]);
            out.extend_from_slice(&(f.points.len() as u16).to_le_bytes());
            out.extend_from_slice(f.label.as_bytes());
            let mut last = (0, 0);
            for &p in &f.points {
                zigzag(&mut out, p.0 - last.0);
                zigzag(&mut out, p.1 - last.1);
                last = p;
            }
            let len = out.len() - at;
            if out.len() + 2 > MAX_BYTES {
                return Err(Error::TooLarge);
            }
            let mut pos = index + i * ENTRY;
            for n in b {
                out[pos..pos + 4].copy_from_slice(&n.to_le_bytes());
                pos += 4;
            }
            out[pos..pos + 4].copy_from_slice(&(at as u32).to_le_bytes());
            out[pos + 4..pos + 8].copy_from_slice(&(len as u32).to_le_bytes());
        }
        out.extend_from_slice(&crc16(&out).to_le_bytes());
        Atlas::parse(&out)?;
        Ok(out)
    }

    /// Keep intersecting features, independently of any active route.
    pub fn subset(
        source: &[u8],
        name: &str,
        bbox: [i32; 4],
        rivers: bool,
        cities: bool,
    ) -> Result<Vec<u8>, Error> {
        let atlas = Atlas::parse(source)?;
        let mut features = Vec::new();
        for level in 0..3 {
            for f in atlas.features(level, bbox) {
                if (matches!(f.class, RIVER | LAKE | STREAM) && !rivers)
                    || (f.class == CITY && (!cities || level != 0))
                    || (f.level == SHARED_LEVEL && level != 0)
                {
                    continue;
                }
                if f.class == CITY {
                    features.push(Feature {
                        class: f.class,
                        level: f.level,
                        label: String::from(f.label),
                        points: f.points().collect(),
                    });
                    continue;
                }
                let mut run = Vec::new();
                let mut previous = None;
                for p in f.points() {
                    if let Some(a) = previous {
                        if let Some((a, b)) = clip(a, p, bbox) {
                            if run.last().is_some_and(|last| *last != a) {
                                flush(&mut features, &mut run, f.class, f.level);
                            }
                            if run.is_empty() {
                                run.push(a);
                            }
                            if run.last() != Some(&b) {
                                run.push(b);
                            }
                            if run.len() == MAX_POINTS {
                                flush(&mut features, &mut run, f.class, f.level);
                                run.push(b);
                            }
                        } else {
                            flush(&mut features, &mut run, f.class, f.level);
                        }
                    }
                    previous = Some(p);
                }
                flush(&mut features, &mut run, f.class, f.level);
            }
        }
        encode_version(
            name,
            &features,
            if atlas.scale == 1000 { 1 } else { 2 },
            atlas.min_m_per_px,
        )
    }

    /// Compile a geographic selection with metre-scale OSM geometry. The base
    /// contributes only national/departmental outlines, not duplicate roads or places.
    /// Input points and bounds use PRECISE_SCALE, independently of the base version.
    pub fn compile(
        source: &[u8],
        name: &str,
        bbox: [i32; 4],
        features: &[Feature],
        tolerance_m: f64,
    ) -> Result<Vec<u8>, Error> {
        let base = Atlas::parse(source)?;
        let factor = PRECISE_SCALE / base.scale;
        let base_bbox = core::array::from_fn(|i| bbox[i] / factor);
        let mut outlines = Vec::new();
        let has_departments = features.iter().any(|f| f.class == DEPARTMENT);
        let has_boundaries = features.iter().any(|f| f.class == BOUNDARY);
        for f in base.features(0, base_bbox) {
            if (f.class != BOUNDARY || has_boundaries) && (f.class != DEPARTMENT || has_departments)
            {
                continue;
            }
            outlines.push(Feature {
                class: f.class,
                level: 0,
                label: String::new(),
                points: f.points().map(|(x, y)| (x * factor, y * factor)).collect(),
            });
        }
        let mut result = Vec::new();
        for f in outlines.iter().chain(features) {
            if f.class == CITY {
                if let Some(&(x, y)) = f.points.first()
                    && x >= bbox[0]
                    && x <= bbox[2]
                    && y >= bbox[1]
                    && y <= bbox[3]
                {
                    result.push(Feature {
                        class: CITY,
                        level: 0,
                        label: f.label.clone(),
                        points: alloc::vec![(x, y)],
                    });
                }
                continue;
            }
            let start = result.len();
            let mut ends = [start; 3];
            for level in 0..3 {
                let tolerance = tolerance_m * [1.0, 5.0, 25.0][level as usize];
                let points = simplify(&f.points, tolerance, bbox);
                let mut run = Vec::new();
                for pair in points.windows(2) {
                    if let Some((a, b)) = clip(pair[0], pair[1], bbox) {
                        if run.last().is_some_and(|p| *p != a) {
                            flush(&mut result, &mut run, f.class, level);
                        }
                        if run.is_empty() {
                            run.push(a);
                        }
                        if run.last() != Some(&b) {
                            run.push(b);
                        }
                        if run.len() == MAX_POINTS {
                            flush(&mut result, &mut run, f.class, level);
                            run.push(b);
                        }
                    } else {
                        flush(&mut result, &mut run, f.class, level);
                    }
                }
                flush(&mut result, &mut run, f.class, level);
                ends[level as usize] = result.len();
            }
            let n = ends[0] - start;
            if ends[1] - ends[0] == n
                && ends[2] - ends[1] == n
                && (0..n).all(|i| {
                    result[start + i].points == result[ends[0] + i].points
                        && result[start + i].points == result[ends[1] + i].points
                })
            {
                for f in &mut result[start..ends[0]] {
                    f.level = SHARED_LEVEL;
                }
                result.truncate(ends[0]);
            }
        }
        let min_m_per_px = libm::ceil(tolerance_m / 2.0).clamp(1.0, u16::MAX as f64) as u16;
        encode_version(name, &result, LATEST_VERSION, min_m_per_px)
    }

    fn simplify(points: &[(i32, i32)], tolerance_m: f64, bbox: [i32; 4]) -> Vec<(i32, i32)> {
        if points.len() < 3 {
            return points.to_vec();
        }
        let latitude = (bbox[1] as f64 + bbox[3] as f64) / (2.0 * PRECISE_SCALE as f64);
        let sx = 111_320.0 * libm::cos(latitude.to_radians()) / PRECISE_SCALE as f64;
        let sy = 111_320.0 / PRECISE_SCALE as f64;
        let mut keep = alloc::vec![false; points.len()];
        keep[0] = true;
        keep[points.len() - 1] = true;
        let mut stack = alloc::vec![(0, points.len() - 1)];
        while let Some((lo, hi)) = stack.pop() {
            let a = points[lo];
            let b = points[hi];
            let (dx, dy) = ((b.0 - a.0) as f64 * sx, (b.1 - a.1) as f64 * sy);
            let norm = dx * dx + dy * dy;
            let mut best = tolerance_m * tolerance_m;
            let mut far = None;
            for (i, point) in points.iter().enumerate().take(hi).skip(lo + 1) {
                let (x, y) = ((point.0 - a.0) as f64 * sx, (point.1 - a.1) as f64 * sy);
                let t = if norm == 0.0 {
                    0.0
                } else {
                    ((x * dx + y * dy) / norm).clamp(0.0, 1.0)
                };
                let d = (x - t * dx) * (x - t * dx) + (y - t * dy) * (y - t * dy);
                if d > best {
                    best = d;
                    far = Some(i);
                }
            }
            if let Some(i) = far {
                keep[i] = true;
                stack.push((lo, i));
                stack.push((i, hi));
            }
        }
        points
            .iter()
            .zip(keep)
            .filter_map(|(&p, keep)| keep.then_some(p))
            .collect()
    }

    fn flush(out: &mut Vec<Feature>, points: &mut Vec<(i32, i32)>, class: u8, level: u8) {
        if points.len() >= 2 {
            out.push(Feature {
                class,
                level,
                label: String::new(),
                points: core::mem::take(points),
            });
        }
        points.clear();
    }

    fn clip(a: (i32, i32), b: (i32, i32), r: [i32; 4]) -> Option<((i32, i32), (i32, i32))> {
        let (dx, dy) = ((b.0 - a.0) as f64, (b.1 - a.1) as f64);
        let (mut lo, mut hi) = (0.0f64, 1.0f64);
        for (p, q) in [
            (-dx, (a.0 - r[0]) as f64),
            (dx, (r[2] - a.0) as f64),
            (-dy, (a.1 - r[1]) as f64),
            (dy, (r[3] - a.1) as f64),
        ] {
            if p == 0.0 {
                if q < 0.0 {
                    return None;
                }
            } else if p < 0.0 {
                lo = lo.max(q / p);
            } else {
                hi = hi.min(q / p);
            }
            if lo > hi {
                return None;
            }
        }
        let at = |t| {
            (
                (libm::round(a.0 as f64 + t * dx) as i32).clamp(r[0], r[2]),
                (libm::round(a.1 as f64 + t * dy) as i32).clamp(r[1], r[3]),
            )
        };
        Some((at(lo), at(hi)))
    }
}
