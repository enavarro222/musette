//! Routes built from synthetic GPX files and read back as the device does.

use route_cc600::{Error, Route, build, parse_gpx};

/// A GPX of `points` (lat, lon, ele), as Komoot writes them.
fn gpx(name: &str, points: &[(f64, f64, f64)]) -> String {
    let mut s = format!("<?xml version='1.0'?><gpx><trk><name>{name}</name><trkseg>\n");
    for (lat, lon, ele) in points {
        s += &format!(
            "<trkpt lat=\"{lat:.6}\" lon=\"{lon:.6}\">\n<ele>{ele:.1}</ele>\n<time>2026-10-18T09:40:26.5Z</time>\n</trkpt>\n"
        );
    }
    s + "</trkseg></trk></gpx>"
}

const LAT: f64 = 45.0;
const LON: f64 = 3.0;
/// Degrees for 1 km north, and east at LAT.
const KM_LAT: f64 = 1.0 / 111.319_49;

fn km_lon() -> f64 {
    KM_LAT / LAT.to_radians().cos()
}

/// A 1 km square, clockwise from the south west corner (north first), a point every 10 m, climbing 50 m on the
/// north side.
fn square() -> Vec<(f64, f64, f64)> {
    let mut p = vec![];
    let corners = [(0.0, 0.0), (1.0, 0.0), (1.0, 1.0), (0.0, 1.0), (0.0, 0.0)];
    for w in corners.windows(2) {
        let ((n0, e0), (n1, e1)) = (w[0], w[1]);
        for i in 0..100 {
            let f = i as f64 / 100.0;
            let (n, e) = (n0 + (n1 - n0) * f, e0 + (e1 - e0) * f);
            let ele = if n0 == 1.0 && n1 == 1.0 {
                100.0 + 50.0 * f
            } else if n0 == 1.0 {
                150.0
            } else {
                100.0
            };
            p.push((LAT + n * KM_LAT, LON + e * km_lon(), ele));
        }
    }
    p.push((LAT, LON, 100.0));
    p
}

#[test]
fn a_square_is_simplified_and_read_back() {
    let g = parse_gpx(&gpx("Carré &amp; côte", &square())).unwrap();
    assert_eq!(g.name, "Carré & côte");
    assert_eq!(g.points.len(), 401);
    // 2026-10-18 09:40:26.5 UTC
    assert_eq!(g.times[0], Some(1_792_316_426.5));
    let file = build(&g, 3.0);
    let r = Route::parse(&file).unwrap();
    assert_eq!(r.name(), "Carré & côte");
    // straight sides and steady slopes: the corners only
    assert!(r.info.count <= 8, "{} points", r.info.count);
    assert!(
        (r.info.length_dm as i64 - 40_000).abs() < 40,
        "{} dm",
        r.info.length_dm
    );
    assert_eq!(r.info.ascent_m, 50);
    assert!(file.len() < 200, "{} bytes", file.len());
    let pts: Vec<_> = r.points().collect();
    assert_eq!(pts.len() as u32, r.info.count);
    assert_eq!(pts.last().unwrap().along_dm, r.info.length_dm);
}

#[test]
fn locating_the_rider() {
    let r_file = build(&parse_gpx(&gpx("c", &square())).unwrap(), 3.0);
    let r = Route::parse(&r_file).unwrap();
    // 20 m outside the east side (the third: west side north, north side east, then south), half way: 2.5 km
    let (x, y) = r.project(
        ((LAT + 0.5 * KM_LAT) * 1e7).round() as i32,
        ((LON + 1.02 * km_lon()) * 1e7).round() as i32,
    );
    let p = r.locate(x, y, None);
    assert!((p.along_dm as i64 - 25_000).abs() < 30, "{p:?}");
    assert!((p.off_dm as i64 - 200).abs() < 5, "{p:?}");
}

#[test]
fn an_out_and_back_keeps_its_direction() {
    // 2 km north and back on the same road
    let mut pts = vec![];
    for i in 0..=200 {
        pts.push((LAT + i as f64 * 0.01 * KM_LAT, LON, 100.0));
    }
    for i in (0..200).rev() {
        pts.push((LAT + i as f64 * 0.01 * KM_LAT, LON + 0.00001, 100.0));
    }
    let file = build(&parse_gpx(&gpx("aller-retour", &pts)).unwrap(), 3.0);
    let r = Route::parse(&file).unwrap();
    let at_500m = r.project(((LAT + 0.5 * KM_LAT) * 1e7) as i32, (LON * 1e7) as i32);
    // going out: about 500 m along
    let out = r.locate(at_500m.0, at_500m.1, None);
    assert!(out.along_dm < 6_000, "{out:?}");
    // coming back past the same place, 3.4 km along before: the back pass (3.5 km)
    let mut last = r.locate(at_500m.0, at_500m.1, None);
    last.along_dm = 34_000;
    let back = r.locate(at_500m.0, at_500m.1, Some(last));
    assert!((back.along_dm as i64 - 35_000).abs() < 100, "{back:?}");
}

#[test]
fn damaged_files_are_refused() {
    let file = build(&parse_gpx(&gpx("c", &square())).unwrap(), 3.0);
    let mut bad = file.clone();
    bad[40] ^= 1;
    assert_eq!(Route::parse(&bad).err(), Some(Error::Corrupt));
    assert_eq!(
        Route::parse(&file[..file.len() - 5]).err(),
        Some(Error::Corrupt)
    );
    assert_eq!(Route::parse(b"GPX!").err(), Some(Error::Format));
}

#[test]
fn gpx_variants() {
    // route points, single quotes, attributes the other way round, self-closing points without elevation
    let text = "<gpx><rte><name>R</name><rtept lon='3.01' lat='45.01'/>\n<rtept  lat='45.02' lon='3.02'/></rte></gpx>";
    let g = parse_gpx(text).unwrap();
    assert_eq!(g.name, "R");
    assert_eq!(g.points, vec![(45.01, 3.01, None), (45.02, 3.02, None)]);
    assert_eq!(g.times, vec![None, None]);
    assert!(Route::parse(&build(&g, 3.0)).is_ok());
    assert_eq!(
        parse_gpx("<gpx></gpx>").err(),
        Some(route_cc600::GpxError::NoPoints)
    );
    assert_eq!(
        parse_gpx("<gpx><trkpt lat='a' lon='1'></trkpt><trkpt lat='1' lon='1'/></gpx>").err(),
        Some(route_cc600::GpxError::BadPoint)
    );
}

/// 10 km straight north, a point every 10 m: flat for 2 km, 3 km at 6 % (180 m), 1 km down at 5 %, flat to the
/// end.
fn straight_hill() -> Vec<(f64, f64, f64)> {
    (0..=1000)
        .map(|i| {
            let km = i as f64 / 100.0;
            let ele = 100.0
                + match km {
                    k if k < 2.0 => 0.0,
                    k if k < 5.0 => (k - 2.0) * 60.0,
                    k if k < 6.0 => 180.0 - (k - 5.0) * 50.0,
                    _ => 130.0,
                };
            (LAT + km * KM_LAT, LON, ele)
        })
        .collect()
}

#[test]
fn a_hill_on_a_straight_road_keeps_its_shape_and_is_a_climb() {
    let file = build(&parse_gpx(&gpx("côte", &straight_hill())).unwrap(), 3.0);
    let r = Route::parse(&file).unwrap();
    // the ends, the foot, the top, the bottom of the descent: nothing in between
    assert!(r.info.count <= 6, "{} points", r.info.count);
    let mut ele = [0; 11];
    r.elevations(0, 100_000, &mut ele);
    let want = [
        1000, 1000, 1000, 1600, 2200, 2800, 2300, 2300, 2300, 2300, 2300,
    ];
    // the projected length is a few decimetres off the 10 km
    assert!(
        ele.iter().zip(want).all(|(e, w)| (e - w).abs() <= 2),
        "{ele:?}"
    );
    let climbs: Vec<_> = r.climbs().collect();
    assert_eq!(climbs.len(), 1, "{climbs:?}");
    let c = climbs[0];
    assert!((c.start_dm as i64 - 20_000).abs() <= 1_000, "{c:?}");
    assert!((c.end_dm as i64 - 50_000).abs() <= 1_000, "{c:?}");
    assert!((c.gain_m as i64 - 180).abs() <= 10, "{c:?}");
    assert!((c.grade_pm() as i64 - 60).abs() <= 3, "{c:?}");
    assert!((60..=70).contains(&c.max_grade_pm), "{c:?}");
}

#[test]
fn elevations_outside_the_route_are_its_ends() {
    let file = build(&parse_gpx(&gpx("côte", &straight_hill())).unwrap(), 3.0);
    let r = Route::parse(&file).unwrap();
    let mut ele = [0; 3];
    r.elevations(95_000, 105_000, &mut ele);
    assert_eq!(ele, [2300, 2300, 2300]);
    let mut one = [0; 1];
    r.elevations(35_000, 35_000, &mut one);
    assert!((one[0] - 1900).abs() <= 2, "{one:?}");
}

#[test]
fn climbs_of_the_square_and_of_a_flat_road() {
    // the north side: 50 m on 1 km
    let file = build(&parse_gpx(&gpx("c", &square())).unwrap(), 3.0);
    let climbs: Vec<_> = Route::parse(&file).unwrap().climbs().collect();
    assert_eq!(climbs.len(), 1, "{climbs:?}");
    assert!(
        (climbs[0].start_dm as i64 - 10_000).abs() <= 1_000,
        "{climbs:?}"
    );
    let flat: Vec<_> = (0..=100)
        .map(|i| (LAT + i as f64 * 0.01 * KM_LAT, LON, 100.0))
        .collect();
    let file = build(&parse_gpx(&gpx("plat", &flat)).unwrap(), 3.0);
    assert_eq!(Route::parse(&file).unwrap().climbs().len(), 0);
}

#[test]
fn version_1_files_are_read_without_climbs() {
    let file = build(&parse_gpx(&gpx("côte", &straight_hill())).unwrap(), 3.0);
    // version 1: the same without the climbs
    let climbs = Route::parse(&file).unwrap().climbs().len();
    let mut v1 = file[..file.len() - 2 - 1 - climbs * 12].to_vec();
    v1[4] = 1;
    let crc = route_cc600::crc16(&v1);
    v1.extend_from_slice(&crc.to_le_bytes());
    let r = Route::parse(&v1).unwrap();
    assert_eq!(r.climbs().len(), 0);
    assert_eq!(r.points().count() as u32, r.info.count);
    // a version to come is refused
    let mut v3 = file.clone();
    v3[4] = 3;
    assert_eq!(Route::parse(&v3).err(), Some(Error::Format));
}

/// A route straight north along a profile of `tests/data` (decimetres every 20 m): real elevations, no positions.
fn along_profile(profile: &str) -> Vec<u8> {
    let points: Vec<_> = profile
        .lines()
        .filter(|l| !l.starts_with('#'))
        .enumerate()
        .map(|(i, l)| {
            (
                LAT + i as f64 * 0.02 * KM_LAT,
                LON,
                l.parse::<f64>().unwrap() / 10.0,
            )
        })
        .collect();
    build(&parse_gpx(&gpx("profil", &points)).unwrap(), 3.0)
}

/// The climbs found, as (start km, length km, gain m), and each starts and ends climbing: its first and last 250 m
/// rise 0.5 % at least (the foot and the top are not on the flat around them).
fn climbs_of(file: &[u8]) -> Vec<(f64, f64, u16)> {
    let r = Route::parse(file).unwrap();
    for c in r.climbs() {
        let mut ends = [0; 2];
        for (a, b) in [
            (c.start_dm, c.start_dm + 2_500),
            (c.end_dm - 2_500, c.end_dm),
        ] {
            r.elevations(a, b, &mut ends);
            assert!(
                ends[1] - ends[0] >= 13,
                "{c:?}: {a}..{b} dm rises {} dm",
                ends[1] - ends[0]
            );
        }
    }
    let km = |dm: u32| (dm as f64 / 1_000.0).round() / 10.0;
    r.climbs()
        .map(|c| (km(c.start_dm), km(c.length_dm()), c.gain_m))
        .collect()
}

fn assert_climbs(got: &[(f64, f64, u16)], want: &[(f64, f64, u16)]) {
    assert_eq!(got.len(), want.len(), "{got:?}");
    for (g, w) in got.iter().zip(want) {
        assert!(
            (g.0 - w.0).abs() <= 0.2 && (g.1 - w.1).abs() <= 0.2 && g.2.abs_diff(w.2) <= 5,
            "{got:?}"
        );
    }
}

/// A ride over a 26 km pass from its start, then three short climbs (one of 600 m).
#[test]
fn climbs_of_a_pass_ride() {
    let got = climbs_of(&along_profile(include_str!("data/pass-ride-52km.txt")));
    assert_climbs(
        &got,
        &[
            (0.1, 26.3, 1463),
            (27.5, 2.8, 143),
            (36.5, 1.0, 46),
            (50.9, 0.6, 47),
        ],
    );
}

/// 350 km, six climbs from 800 m to 15 km.
#[test]
fn climbs_of_a_long_ride() {
    let got = climbs_of(&along_profile(include_str!("data/long-ride-350km.txt")));
    assert_climbs(
        &got,
        &[
            (1.9, 15.2, 1042),
            (163.5, 7.9, 363),
            (172.9, 4.7, 151),
            (236.5, 10.6, 485),
            (286.6, 12.5, 438),
            (299.9, 0.8, 34),
        ],
    );
}
