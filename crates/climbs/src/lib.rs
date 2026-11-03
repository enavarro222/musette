//! Climb detection on a regularly sampled elevation profile.
//!
//! The algorithm walks the smoothed profile, tracking the lowest point
//! before a rise and the highest point reached. A climb ends when the road
//! drops more than `max_drop` below that summit. Candidates are then kept
//! if they are long, high and steep enough. A rise that fails on its average
//! grade alone may hold real climbs after a long flat approach or a plateau:
//! the same walk on the rise, tilted by `approach_grade`, finds them. Without
//! one in it, a long gentle rise of `gentle_gain` is a climb in its own right.

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
    /// Below this grade a rise too gentle on average is an approach, not part of a climb.
    pub approach_grade: f64,
    /// A rise with no climb in it is one all the same from this gain (m), over `approach_grade` on average.
    pub gentle_gain: f64,
}

impl Default for Params {
    fn default() -> Self {
        Self {
            smoothing: 100.0,
            max_drop: 10.0,
            min_length: 500.0,
            min_gain: 25.0,
            min_grade: 0.03,
            approach_grade: 0.015,
            gentle_gain: 50.0,
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
    if ele.len() < 2 {
        return Vec::new();
    }
    let mut climbs = Vec::new();
    for (start, peak) in rises(&ele, params.max_drop) {
        if !too_gentle(profile, &ele, start, peak, params) {
            push_if_climb(&mut climbs, profile, &ele, start, peak, params);
            continue;
        }
        let tilted: Vec<f64> = ele[start..=peak]
            .iter()
            .enumerate()
            .map(|(i, e)| e - i as f64 * profile.step * params.approach_grade)
            .collect();
        let before = climbs.len();
        for (a, b) in rises(&tilted, params.max_drop) {
            push_if_climb(&mut climbs, profile, &ele, start + a, start + b, params);
        }
        if climbs.len() == before {
            let gentle = Params {
                min_gain: params.gentle_gain,
                min_grade: params.approach_grade,
                ..*params
            };
            for (a, b) in rises(&tilted, params.max_drop) {
                push_if_climb(&mut climbs, profile, &ele, start + a, start + b, &gentle);
            }
        }
    }
    climbs
}

/// The rises of a profile, foot and summit, each ended by a drop of `max_drop`.
fn rises(ele: &[f64], max_drop: f64) -> Vec<(usize, usize)> {
    let mut out = Vec::new();
    let mut start = 0;
    let mut peak = 0;
    for j in 1..ele.len() {
        if peak == start && ele[j] <= ele[start] {
            // Still going down/flat before a rise: move the start.
            start = j;
            peak = j;
            continue;
        }
        if ele[j] > ele[peak] {
            peak = j;
        }
        if ele[peak] - ele[j] >= max_drop || ele[j] < ele[start] {
            out.push((start, peak));
            start = j;
            peak = j;
        }
    }
    out.push((start, peak));
    out
}

/// Long and high enough for a climb, but not steep enough on average.
fn too_gentle(profile: &Profile, ele: &[f64], start: usize, peak: usize, params: &Params) -> bool {
    let length = (peak - start) as f64 * profile.step;
    let gain = ele[peak] - ele[start];
    length >= params.min_length && gain >= params.min_gain && gain < params.min_grade * length
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
    fn a_long_approach_does_not_hide_the_climb_after_it() {
        // +83 m over 4.7 km, 1.8 % on average, for a climb of 1.7 km at 4.3 %
        let p = build(&[(3000.0, 0.004), (1700.0, 0.043), (1500.0, -0.04)]);
        let climbs = detect(&p, &Params::default());
        assert_eq!(climbs.len(), 1, "{climbs:#?}");
        assert!((climbs[0].start - 3000.0).abs() <= 150.0, "{climbs:?}");
        assert!((climbs[0].avg_grade - 0.043).abs() < 0.005, "{climbs:?}");
    }

    #[test]
    fn a_plateau_does_not_hide_the_climb_after_it() {
        let p = build(&[
            (1000.0, 0.02),
            (800.0, 0.0),
            (1100.0, 0.05),
            (1500.0, -0.04),
        ]);
        let climbs = detect(&p, &Params::default());
        assert_eq!(climbs.len(), 1, "{climbs:#?}");
        assert!((climbs[0].start - 1800.0).abs() <= 150.0, "{climbs:?}");
    }

    #[test]
    fn a_climb_steep_enough_keeps_its_faux_plat() {
        let p = build(&[(5000.0, 0.06), (1000.0, 0.005), (5000.0, 0.06)]);
        let climbs = detect(&p, &Params::default());
        assert_eq!(climbs.len(), 1, "{climbs:#?}");
    }

    #[test]
    fn a_long_gentle_rise_with_no_climb_in_it_is_a_climb() {
        // +80 m over 4.1 km, 2 % on average, 2.6 % at its steepest
        let p = build(&[
            (2600.0, 0.016),
            (1500.0, 0.026),
            (1400.0, 0.003),
            (1500.0, -0.04),
        ]);
        let climbs = detect(&p, &Params::default());
        assert_eq!(climbs.len(), 1, "{climbs:#?}");
        assert!(climbs[0].start < 300.0, "{climbs:?}");
        assert!(climbs[0].gain > 70.0, "{climbs:?}");
    }

    #[test]
    fn a_long_steady_gentle_rise_is_no_climb() {
        let p = build(&[(5000.0, 0.012)]);
        assert!(detect(&p, &Params::default()).is_empty());
    }

    #[test]
    fn flat_route_has_no_climb() {
        let p = build(&[(5000.0, 0.0)]);
        assert!(detect(&p, &Params::default()).is_empty());
    }
}
