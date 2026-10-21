//! Bryton route file ("plan trip"): a FIT file with Bryton's own messages,
//! not a FIT course. It goes to `PlanTrip/<name>.fit` on the drive, or over
//! BLE as file type 11. Layout checked byte for byte against routes written
//! by Bryton Active on a Rider 750; see docs/drivers/bryton-ble.md §6.
//!
//! Messages, in file order (global number, local number):
//! version (248, 7), overview (254, 1), one overview record per point
//! (251, 2), turn count (253, 3) and turn records (250, 4) when there are
//! turns, track point count (252, 5), track records (249, 6).

/// A route point. Values are stored as the file stores them.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Point {
    /// Degrees × 1e6 (not semicircles).
    pub lat_e6: i32,
    pub lon_e6: i32,
    /// `(metres + 500) × 5`; [`NO_ALTITUDE`] when unknown.
    pub alt_raw: u16,
}

pub const NO_ALTITUDE: u16 = u16::MAX;

impl Point {
    pub fn new(lat: f64, lon: f64, alt_m: Option<f64>) -> Self {
        Self {
            lat_e6: (lat * 1e6).round() as i32,
            lon_e6: (lon * 1e6).round() as i32,
            alt_raw: alt_m.map_or(NO_ALTITUDE, alt_to_raw),
        }
    }

    pub fn alt_m(&self) -> Option<f64> {
        (self.alt_raw != NO_ALTITUDE).then(|| self.alt_raw as f64 / 5.0 - 500.0)
    }
}

fn alt_to_raw(m: f64) -> u16 {
    ((m + 500.0) * 5.0)
        .round()
        .clamp(0.0, (NO_ALTITUDE - 1) as f64) as u16
}

/// A turn instruction, attached to a track point.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Turn {
    pub point: u16,
    /// Maneuver code. Seen: 1 on the first turn and along the way (go
    /// straight?), 33 at the arrival, 210-214 for roundabout exits; others to
    /// be matched with the device's icons.
    pub maneuver: u8,
    /// Distance to the next turn, metres.
    pub distance_m: u32,
    /// Time to the next turn, most likely milliseconds.
    pub duration: u32,
    /// Street name; at most 32 bytes of UTF-8 are kept.
    pub instruction: String,
}

/// Maneuver codes known so far.
pub mod maneuver {
    /// On every route's first turn record, and along the way: "go straight"?
    pub const START: u8 = 1;
    pub const ARRIVE: u8 = 33;
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Route {
    pub version: (u16, u16),
    pub points: Vec<Point>,
    pub turns: Vec<Turn>,
    pub distance_m: u32,
    /// Total ascent and descent, metres.
    pub gain_m: u16,
    pub loss_m: u16,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Error {
    /// More than 65 535 points.
    TooManyPoints,
    NotFit(fit::Error),
    /// A record we do not expect in a route file.
    Unexpected(usize),
    Truncated,
}

/// A definition record: global number, then (field number, size).
type Definition = (u16, Vec<(u8, u8)>);

const PROFILE_VERSION: u16 = 2088;
const INSTRUCTION_MIN: u8 = 32;
const INSTRUCTION_MAX_BYTES: usize = 32;

const UINT16: u8 = 0x84;
const SINT32: u8 = 0x85;
const UINT32: u8 = 0x86;
const ENUM: u8 = 0x00;
const STRING: u8 = 0x07;

const OVERVIEW: [(u8, u8, u8); 10] = [
    (1, 2, UINT16),
    (2, 4, SINT32),
    (3, 4, SINT32),
    (4, 4, SINT32),
    (5, 4, SINT32),
    (6, 4, UINT32),
    (7, 2, UINT16),
    (8, 2, UINT16),
    (9, 2, UINT16),
    (10, 2, UINT16),
];

fn definition(out: &mut Vec<u8>, local: u8, global: u16, fields: &[(u8, u8, u8)]) {
    out.push(0x40 | local);
    out.push(0); // reserved
    out.push(0); // little-endian
    out.extend_from_slice(&global.to_le_bytes());
    out.push(fields.len() as u8);
    for &(num, size, base) in fields {
        out.extend_from_slice(&[num, size, base]);
    }
}

/// Keeps at most [`INSTRUCTION_MAX_BYTES`] bytes, cut on a char boundary.
fn clip(s: &str) -> &str {
    let mut end = s.len().min(INSTRUCTION_MAX_BYTES);
    while !s.is_char_boundary(end) {
        end -= 1;
    }
    &s[..end]
}

impl Route {
    pub fn new(
        points: Vec<Point>,
        turns: Vec<Turn>,
        distance_m: u32,
        gain_m: u16,
        loss_m: u16,
    ) -> Self {
        Self {
            version: (0, 1),
            points,
            turns,
            distance_m,
            gain_m,
            loss_m,
        }
    }

    /// A route from a track, without turn-by-turn: a start turn on the
    /// first point and an arrival on the last one, as the app's routes have.
    /// `speed_mps` gives the durations (the app's routes are near 4.4 m/s).
    pub fn from_track(points: &[track::Point], speed_mps: f64) -> Self {
        let dist = track::cumulative_distance(points);
        let total = dist.last().copied().unwrap_or(0.0);
        let ele: Vec<f64> = points.iter().filter_map(|p| p.ele).collect();
        let down: Vec<f64> = ele.iter().map(|e| -e).collect();
        let pts: Vec<Point> = points
            .iter()
            .map(|p| Point::new(p.lat, p.lon, p.ele))
            .collect();
        let mut turns = vec![];
        if let (Some(last), true) = (pts.len().checked_sub(1), pts.len() > 1) {
            turns.push(Turn {
                point: 0,
                maneuver: maneuver::START,
                distance_m: total.round() as u32,
                duration: (total / speed_mps * 1000.0).round() as u32,
                instruction: String::new(),
            });
            turns.push(Turn {
                point: last.min(u16::MAX as usize) as u16,
                maneuver: maneuver::ARRIVE,
                distance_m: 0,
                duration: 0,
                instruction: String::new(),
            });
        }
        Route::new(
            pts,
            turns,
            total.round() as u32,
            track::total_ascent(&ele, 2.0).round() as u16,
            track::total_ascent(&down, 2.0).round() as u16,
        )
    }

    /// Writes the FIT file, as Bryton Active does.
    pub fn encode(&self) -> Result<Vec<u8>, Error> {
        let n = u16::try_from(self.points.len()).map_err(|_| Error::TooManyPoints)?;
        let mut d = Vec::new();

        definition(&mut d, 7, 248, &[(1, 2, UINT16), (2, 2, UINT16)]);
        d.push(7);
        d.extend_from_slice(&self.version.0.to_le_bytes());
        d.extend_from_slice(&self.version.1.to_le_bytes());

        let lat = self.points.iter().map(|p| p.lat_e6);
        let lon = self.points.iter().map(|p| p.lon_e6);
        let alts = self
            .points
            .iter()
            .map(|p| p.alt_raw)
            .filter(|&a| a != NO_ALTITUDE);
        definition(&mut d, 1, 254, &OVERVIEW);
        d.push(1);
        d.extend_from_slice(&n.to_le_bytes());
        for v in [
            lat.clone().max().unwrap_or(0),
            lat.min().unwrap_or(0),
            lon.clone().max().unwrap_or(0),
            lon.min().unwrap_or(0),
        ] {
            d.extend_from_slice(&v.to_le_bytes());
        }
        d.extend_from_slice(&self.distance_m.to_le_bytes());
        d.extend_from_slice(&alts.clone().max().unwrap_or(NO_ALTITUDE).to_le_bytes());
        d.extend_from_slice(&alts.min().unwrap_or(NO_ALTITUDE).to_le_bytes());
        d.extend_from_slice(&self.gain_m.to_le_bytes());
        d.extend_from_slice(&self.loss_m.to_le_bytes());

        definition(&mut d, 2, 251, &[(1, 2, UINT16)]);
        for i in 0..n {
            d.push(2);
            d.extend_from_slice(&i.to_le_bytes());
        }

        if !self.turns.is_empty() {
            definition(&mut d, 3, 253, &[(1, 2, UINT16)]);
            d.push(3);
            d.extend_from_slice(&(self.turns.len() as u16).to_le_bytes());
            // The string field grows when a longer instruction comes, and
            // keeps its size (the app reuses one message object).
            let mut size = 0u8;
            for t in &self.turns {
                let text = clip(&t.instruction).as_bytes();
                let need = INSTRUCTION_MIN.max(text.len() as u8 + 1);
                if need > size {
                    size = need;
                    let fields = [
                        (1, 2, UINT16),
                        (2, 1, ENUM),
                        (3, 4, UINT32),
                        (4, 4, UINT32),
                        (5, size, STRING),
                    ];
                    definition(&mut d, 4, 250, &fields);
                }
                d.push(4);
                d.extend_from_slice(&t.point.to_le_bytes());
                d.push(t.maneuver);
                d.extend_from_slice(&t.distance_m.to_le_bytes());
                d.extend_from_slice(&t.duration.to_le_bytes());
                d.extend_from_slice(text);
                d.resize(d.len() + size as usize - text.len(), 0);
            }
        }

        definition(&mut d, 5, 252, &[(1, 2, UINT16)]);
        d.push(5);
        d.extend_from_slice(&n.to_le_bytes());
        definition(
            &mut d,
            6,
            249,
            &[(1, 4, SINT32), (2, 4, SINT32), (3, 2, UINT16)],
        );
        for p in &self.points {
            d.push(6);
            d.extend_from_slice(&p.lat_e6.to_le_bytes());
            d.extend_from_slice(&p.lon_e6.to_le_bytes());
            d.extend_from_slice(&p.alt_raw.to_le_bytes());
        }

        let mut out = Vec::with_capacity(d.len() + 16);
        out.extend_from_slice(&[14, 0x10]);
        out.extend_from_slice(&PROFILE_VERSION.to_le_bytes());
        out.extend_from_slice(&(d.len() as u32).to_le_bytes());
        out.extend_from_slice(b".FIT");
        let header_crc = fit::crc16(&out);
        out.extend_from_slice(&header_crc.to_le_bytes());
        out.extend_from_slice(&d);
        let crc = fit::crc16(&out);
        out.extend_from_slice(&crc.to_le_bytes());
        Ok(out)
    }

    /// Reads a route file (one written by [`Route::encode`] or by the app).
    pub fn decode(bytes: &[u8]) -> Result<Self, Error> {
        let header = fit::verify(bytes).map_err(Error::NotFit)?;
        let mut pos = header.header_size as usize;
        let end = pos + header.data_size as usize;
        let mut defs: [Option<Definition>; 16] = Default::default();
        let mut r = Route::new(vec![], vec![], 0, 0, 0);
        while pos < end {
            let h = bytes[pos];
            pos += 1;
            let local = (h & 0x0f) as usize;
            if h & 0x80 != 0 {
                return Err(Error::Unexpected(pos - 1));
            }
            if h & 0x40 != 0 {
                let b = bytes.get(pos..pos + 5).ok_or(Error::Truncated)?;
                let global = u16::from_le_bytes([b[2], b[3]]);
                let n = b[4] as usize;
                let f = bytes
                    .get(pos + 5..pos + 5 + 3 * n)
                    .ok_or(Error::Truncated)?;
                defs[local] = Some((global, f.chunks(3).map(|c| (c[0], c[1])).collect()));
                pos += 5 + 3 * n;
                continue;
            }
            let (global, fields) = defs[local].as_ref().ok_or(Error::Unexpected(pos - 1))?;
            let mut vals = Vec::with_capacity(fields.len());
            for &(num, size) in fields {
                let v = bytes
                    .get(pos..pos + size as usize)
                    .ok_or(Error::Truncated)?;
                vals.push((num, v));
                pos += size as usize;
            }
            let get = |num: u8| vals.iter().find(|(n, _)| *n == num).map(|(_, v)| *v);
            let u16_of = |num| get(num).map_or(0, |v: &[u8]| u16::from_le_bytes([v[0], v[1]]));
            let u32_of =
                |num| get(num).map_or(0, |v: &[u8]| u32::from_le_bytes([v[0], v[1], v[2], v[3]]));
            match global {
                248 => r.version = (u16_of(1), u16_of(2)),
                254 => {
                    r.distance_m = u32_of(6);
                    r.gain_m = u16_of(9);
                    r.loss_m = u16_of(10);
                }
                250 => {
                    let text = get(5).unwrap_or(&[]);
                    let text = text.split(|&b| b == 0).next().unwrap_or(&[]);
                    r.turns.push(Turn {
                        point: u16_of(1),
                        maneuver: get(2).map_or(0, |v| v[0]),
                        distance_m: u32_of(3),
                        duration: u32_of(4),
                        instruction: String::from_utf8_lossy(text).into_owned(),
                    });
                }
                249 => r.points.push(Point {
                    lat_e6: u32_of(1) as i32,
                    lon_e6: u32_of(2) as i32,
                    alt_raw: u16_of(3),
                }),
                251..=253 => {}
                _ => return Err(Error::Unexpected(pos)),
            }
        }
        Ok(r)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sample() -> Route {
        let points: Vec<Point> = (0..50)
            .map(|i| {
                Point::new(
                    45.0 + i as f64 * 1e-4,
                    1.5 + i as f64 * 2e-4,
                    Some(100.0 + i as f64),
                )
            })
            .collect();
        let turns = vec![
            Turn {
                point: 0,
                maneuver: maneuver::START,
                distance_m: 120,
                duration: 27_000,
                instruction: "Rue de la Gare".into(),
            },
            Turn {
                point: 20,
                maneuver: 3,
                distance_m: 300,
                duration: 60_000,
                // 33 bytes: kept to 32, and the field grows to 33.
                instruction: "Avenue du Général de Gaulle Nord".into(),
            },
            Turn {
                point: 49,
                maneuver: maneuver::ARRIVE,
                distance_m: 0,
                duration: 0,
                instruction: String::new(),
            },
        ];
        Route::new(points, turns, 1_100, 49, 0)
    }

    #[test]
    fn round_trip() {
        let r = sample();
        let bytes = r.encode().unwrap();
        fit::verify(&bytes).unwrap();
        let back = Route::decode(&bytes).unwrap();
        assert_eq!(back.points, r.points);
        assert_eq!(back.turns[0], r.turns[0]);
        assert_eq!(back.turns[1].instruction.len(), 32);
        assert_eq!(
            (back.distance_m, back.gain_m, back.version),
            (1_100, 49, (0, 1))
        );
        assert_eq!(back.encode().unwrap(), bytes);
    }

    #[test]
    fn layout() {
        let bytes = sample().encode().unwrap();
        // Header: 14 bytes, protocol 1.0, profile 2088.
        assert_eq!(&bytes[..4], [14, 0x10, 0x28, 0x08]);
        // First record: definition of local 7 = global 248 (0xf8).
        assert_eq!(&bytes[14..20], [0x47, 0, 0, 0xf8, 0, 2]);
        assert_eq!(Point::new(0.0, 0.0, Some(125.0)).alt_raw, 3125);
        assert_eq!(Point::new(0.0, 0.0, Some(125.0)).alt_m(), Some(125.0));
    }

    #[test]
    fn from_track() {
        let pts: Vec<track::Point> = (0..=10)
            .map(|i| track::Point::new(45.0 + i as f64 * 1e-3, 1.0, Some(100.0 + 10.0 * i as f64)))
            .collect();
        let r = Route::from_track(&pts, 4.0);
        assert_eq!(r.points.len(), 11);
        assert!((1100..1125).contains(&r.distance_m), "{}", r.distance_m);
        assert_eq!((r.gain_m, r.loss_m), (100, 0));
        assert_eq!(r.turns.len(), 2);
        assert_eq!(
            (r.turns[1].point, r.turns[1].maneuver),
            (10, maneuver::ARRIVE)
        );
        Route::decode(&r.encode().unwrap()).unwrap();
    }

    #[test]
    fn no_turns() {
        let mut r = sample();
        r.turns.clear();
        let bytes = r.encode().unwrap();
        assert!(
            !bytes.windows(3).any(|w| w == [0x43, 0, 0]),
            "no turn definition"
        );
        assert_eq!(Route::decode(&bytes).unwrap().points.len(), 50);
    }

    /// Re-encodes the routes found on a device (not in the repo: they hold
    /// GPS tracks). `BRYTON_ROUTES=/path/to/PlanTrip cargo test`.
    #[test]
    fn device_routes_byte_for_byte() {
        let Ok(dir) = std::env::var("BRYTON_ROUTES") else {
            return;
        };
        let mut n = 0;
        for e in std::fs::read_dir(dir).unwrap() {
            let path = e.unwrap().path();
            if path
                .extension()
                .is_some_and(|x| x.eq_ignore_ascii_case("fit"))
            {
                let bytes = std::fs::read(&path).unwrap();
                let r = Route::decode(&bytes).unwrap();
                assert!(r.encode().unwrap() == bytes, "{} differs", path.display());
                n += 1;
            }
        }
        assert!(n > 0);
    }
}
