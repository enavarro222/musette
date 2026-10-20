//! Climb detection on a regularly sampled elevation profile.
//!
//! The algorithm walks the smoothed profile, tracking the lowest point
//! before a rise and the highest point reached. A climb ends when the road
//! drops more than `max_drop` below that summit. Candidates are then kept
//! if they are long, high and steep enough.

use track::Profile;

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Params {
    /// Moving-average window, metres.
    pub smoothing: f64,
    /// A dip larger than this (m) ends a climb.
    pub max_drop: f64,
    pub min_length: f64,
    pub min_gain: f64,
    /// Minimum average grade (0.03 = 3 %).
    pub min_grade: f64,
}

impl Default for Params {
    fn default() -> Self {
        Self {
            smoothing: 100.0,
            max_drop: 10.0,
            min_length: 500.0,
            min_gain: 25.0,
            min_grade: 0.03,
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord)]
pub enum Category {
    Uncategorized,
    Cat4,
    Cat3,
    Cat2,
    Cat1,
    Hc,
}

impl Category {
    /// Score = length (m) × average grade (%), as popularised by Strava.
    pub fn from_score(score: f64) -> Self {
        match score {
            s if s >= 80_000.0 => Self::Hc,
            s if s >= 64_000.0 => Self::Cat1,
            s if s >= 32_000.0 => Self::Cat2,
            s if s >= 16_000.0 => Self::Cat3,
            s if s >= 8_000.0 => Self::Cat4,
            _ => Self::Uncategorized,
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Climb {
    /// Start distance from the beginning of the route, metres.
    pub start: f64,
    pub end: f64,
    pub gain: f64,
    /// Average grade (0.06 = 6 %).
    pub avg_grade: f64,
    /// Steepest grade over ~100 m.
    pub max_grade: f64,
    pub category: Category,
}

impl Climb {
    pub fn length(&self) -> f64 {
        self.end - self.start
    }
}

/// Detect climbs on a profile.
pub fn detect(profile: &Profile, params: &Params) -> Vec<Climb> {
    let ele = smooth(&profile.ele, window(params.smoothing, profile.step));
    let n = ele.len();
    if n < 2 {
        return Vec::new();
    }
    let mut climbs = Vec::new();
    let mut start = 0;
    let mut peak = 0;
    for j in 1..n {
        if peak == start && ele[j] <= ele[start] {
            // Still going down/flat before a rise: move the start.
            start = j;
            peak = j;
            continue;
        }
        if ele[j] > ele[peak] {
            peak = j;
        }
        if ele[peak] - ele[j] >= params.max_drop || ele[j] < ele[start] {
            push_if_climb(&mut climbs, profile, &ele, start, peak, params);
            start = j;
            peak = j;
        }
    }
    push_if_climb(&mut climbs, profile, &ele, start, peak, params);
    climbs
}

fn push_if_climb(
    out: &mut Vec<Climb>,
    profile: &Profile,
    ele: &[f64],
    start: usize,
    peak: usize,
    params: &Params,
) {
    if peak <= start {
        return;
    }
    let length = (peak - start) as f64 * profile.step;
    let gain = ele[peak] - ele[start];
    if length < params.min_length || gain < params.min_gain {
        return;
    }
    let avg_grade = gain / length;
    if avg_grade < params.min_grade {
        return;
    }
    let w = window(100.0, profile.step).max(1);
    let max_grade = (start..peak.saturating_sub(w).max(start + 1))
        .map(|i| {
            let k = (i + w).min(peak);
            (ele[k] - ele[i]) / ((k - i) as f64 * profile.step)
        })
        .fold(avg_grade, f64::max);
    out.push(Climb {
        start: profile.distance_at(start),
        end: profile.distance_at(peak),
        gain,
        avg_grade,
        max_grade,
        category: Category::from_score(length * avg_grade * 100.0),
    });
}

fn window(metres: f64, step: f64) -> usize {
    (metres / step).round() as usize
}

/// Centered moving average with a window of `w` samples.
fn smooth(ele: &[f64], w: usize) -> Vec<f64> {
    if w <= 1 {
        return ele.to_vec();
    }
    let half = w / 2;
    (0..ele.len())
        .map(|i| {
            let a = i.saturating_sub(half);
            let b = (i + half + 1).min(ele.len());
            ele[a..b].iter().sum::<f64>() / (b - a) as f64
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Build a profile from (length m, grade) segments at 20 m steps.
    fn build(segments: &[(f64, f64)]) -> Profile {
        let step = 20.0;
        let mut ele = vec![150.0];
        for &(len, grade) in segments {
            for _ in 0..(len / step) as usize {
                let last = *ele.last().unwrap();
                ele.push(last + grade * step);
            }
        }
        Profile { step, ele }
    }

    #[test]
    fn finds_two_climbs_and_ignores_a_bump() {
        let p = build(&[
            (1000.0, 0.0),
            (3000.0, 0.06), // 180 m: Cat3 territory (score 18 000)
            (2000.0, -0.05),
            (200.0, 0.04), // 8 m bump: too small
            (400.0, -0.02),
            (1000.0, 0.045), // 45 m
            (500.0, 0.0),
        ]);
        let climbs = detect(&p, &Params::default());
        assert_eq!(climbs.len(), 2, "{climbs:#?}");

        let c1 = climbs[0];
        assert!((c1.start - 1000.0).abs() <= 100.0, "{c1:?}");
        assert!((c1.gain - 180.0).abs() <= 10.0, "{c1:?}");
        assert_eq!(c1.category, Category::Cat3);

        let c2 = climbs[1];
        assert!((c2.avg_grade - 0.045).abs() < 0.01, "{c2:?}");
    }

    #[test]
    fn flat_route_has_no_climb() {
        let p = build(&[(5000.0, 0.0)]);
        assert!(detect(&p, &Params::default()).is_empty());
    }
}
