//! Track geometry: distances, elevation profile, ascent, simplification.
//!
//! Parsing GPX/FIT into points is done elsewhere (GPX: in the app with the
//! platform XML parser; FIT: in the `fit` crate). This crate only works on
//! points, so it stays dependency-free and testable.

const EARTH_RADIUS_M: f64 = 6_371_008.8;

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Point {
    pub lat: f64,
    pub lon: f64,
    /// Elevation in metres, if known.
    pub ele: Option<f64>,
}

impl Point {
    pub fn new(lat: f64, lon: f64, ele: Option<f64>) -> Self {
        Self { lat, lon, ele }
    }
}

/// Great-circle distance in metres.
pub fn haversine(a: &Point, b: &Point) -> f64 {
    let (lat1, lat2) = (a.lat.to_radians(), b.lat.to_radians());
    let dlat = lat2 - lat1;
    let dlon = (b.lon - a.lon).to_radians();
    let h = (dlat / 2.0).sin().powi(2) + lat1.cos() * lat2.cos() * (dlon / 2.0).sin().powi(2);
    2.0 * EARTH_RADIUS_M * h.sqrt().asin()
}

/// Cumulative distance (m) at each point; first is 0.
pub fn cumulative_distance(points: &[Point]) -> Vec<f64> {
    let mut out = Vec::with_capacity(points.len());
    let mut acc = 0.0;
    for (i, p) in points.iter().enumerate() {
        if i > 0 {
            acc += haversine(&points[i - 1], p);
        }
        out.push(acc);
    }
    out
}

/// An elevation profile sampled at a regular distance step.
#[derive(Clone, Debug, PartialEq)]
pub struct Profile {
    /// Distance step between samples, metres.
    pub step: f64,
    /// Elevation at `i * step`.
    pub ele: Vec<f64>,
}

impl Profile {
    pub fn distance_at(&self, i: usize) -> f64 {
        i as f64 * self.step
    }

    pub fn length(&self) -> f64 {
        self.ele.len().saturating_sub(1) as f64 * self.step
    }
}

/// Build a profile resampled every `step` metres (linear interpolation).
///
/// Points without elevation are ignored. Returns `None` when fewer than two
/// points carry elevation.
pub fn profile(points: &[Point], step: f64) -> Option<Profile> {
    assert!(step > 0.0, "step must be positive");
    let dist = cumulative_distance(points);
    let samples: Vec<(f64, f64)> = points
        .iter()
        .zip(&dist)
        .filter_map(|(p, d)| p.ele.map(|e| (*d, e)))
        .collect();
    if samples.len() < 2 {
        return None;
    }
    let total = samples.last().unwrap().0;
    let n = (total / step).floor() as usize + 1;
    let mut ele = Vec::with_capacity(n);
    let mut k = 0;
    for i in 0..n {
        let d = i as f64 * step;
        while k + 1 < samples.len() - 1 && samples[k + 1].0 < d {
            k += 1;
        }
        let (d0, e0) = samples[k];
        let (d1, e1) = samples[k + 1];
        let t = if d1 > d0 {
            ((d - d0) / (d1 - d0)).clamp(0.0, 1.0)
        } else {
            0.0
        };
        ele.push(e0 + t * (e1 - e0));
    }
    Some(Profile { step, ele })
}

/// Total ascent with a hysteresis threshold (metres) to ignore GPS/DEM noise.
pub fn total_ascent(ele: &[f64], threshold: f64) -> f64 {
    let Some(&first) = ele.first() else {
        return 0.0;
    };
    let mut ascent = 0.0;
    let mut low = first;
    let mut high = first;
    let mut climbing = false;
    for &e in ele {
        if climbing {
            if e > high {
                high = e;
            } else if high - e >= threshold {
                ascent += high - low;
                climbing = false;
                low = e;
            }
        } else if e < low {
            low = e;
        } else if e - low >= threshold {
            climbing = true;
            high = e;
        }
    }
    if climbing {
        ascent += high - low;
    }
    ascent
}

/// Douglas–Peucker simplification with a tolerance in metres.
///
/// Used to fit a route in the limited memory of a device. Returns indices
/// of the kept points (always includes first and last).
pub fn simplify(points: &[Point], tolerance_m: f64) -> Vec<usize> {
    if points.len() <= 2 {
        return (0..points.len()).collect();
    }
    // Local equirectangular projection around the first point (metres).
    let lat0 = points[0].lat.to_radians();
    let xy: Vec<(f64, f64)> = points
        .iter()
        .map(|p| {
            (
                p.lon.to_radians() * lat0.cos() * EARTH_RADIUS_M,
                p.lat.to_radians() * EARTH_RADIUS_M,
            )
        })
        .collect();
    let mut keep = vec![false; points.len()];
    keep[0] = true;
    keep[points.len() - 1] = true;
    let mut stack = vec![(0usize, points.len() - 1)];
    while let Some((a, b)) = stack.pop() {
        let mut max_d = 0.0;
        let mut idx = a;
        for i in a + 1..b {
            let d = point_segment_distance(xy[i], xy[a], xy[b]);
            if d > max_d {
                max_d = d;
                idx = i;
            }
        }
        if max_d > tolerance_m {
            keep[idx] = true;
            stack.push((a, idx));
            stack.push((idx, b));
        }
    }
    keep.iter()
        .enumerate()
        .filter_map(|(i, k)| k.then_some(i))
        .collect()
}

fn point_segment_distance(p: (f64, f64), a: (f64, f64), b: (f64, f64)) -> f64 {
    let (dx, dy) = (b.0 - a.0, b.1 - a.1);
    let len2 = dx * dx + dy * dy;
    let t = if len2 == 0.0 {
        0.0
    } else {
        (((p.0 - a.0) * dx + (p.1 - a.1) * dy) / len2).clamp(0.0, 1.0)
    };
    let (cx, cy) = (a.0 + t * dx, a.1 + t * dy);
    ((p.0 - cx).powi(2) + (p.1 - cy).powi(2)).sqrt()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn one_degree_latitude() {
        let d = haversine(&Point::new(43.0, 1.7, None), &Point::new(44.0, 1.7, None));
        assert!((d - 111_195.0).abs() < 50.0, "{d}");
    }

    #[test]
    fn profile_resamples() {
        // ~1.11 km straight north, climbing 100 m.
        let pts = [
            Point::new(43.80, 1.72, Some(100.0)),
            Point::new(43.81, 1.72, Some(200.0)),
        ];
        let p = profile(&pts, 100.0).unwrap();
        assert_eq!(p.ele.len(), 12);
        assert!((p.ele[0] - 100.0).abs() < 1e-9);
        assert!(p.ele[11] > 195.0);
    }

    #[test]
    fn ascent_ignores_noise() {
        let ele = [
            100.0, 101.0, 100.0, 101.0, 100.0, 150.0, 149.0, 150.0, 120.0,
        ];
        assert!((total_ascent(&ele, 5.0) - 50.0).abs() < 1e-9);
    }

    #[test]
    fn simplify_straight_line() {
        let pts: Vec<Point> = (0..100)
            .map(|i| Point::new(43.8 + i as f64 * 1e-4, 1.72, None))
            .collect();
        assert_eq!(simplify(&pts, 1.0), vec![0, 99]);
    }
}
