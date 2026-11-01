use route_cc600::atlas::{
    self, Atlas,
    build::{Feature, encode, subset},
};

fn sample() -> Vec<u8> {
    encode(
        "France",
        &[
            Feature {
                class: atlas::BOUNDARY,
                level: 0,
                label: String::new(),
                points: vec![(1000, 45000), (3000, 47000)],
            },
            Feature {
                class: atlas::RIVER,
                level: 0,
                label: String::new(),
                points: vec![(1000, 46000), (3000, 46000)],
            },
            Feature {
                class: atlas::CITY,
                level: 0,
                label: "Ville".into(),
                points: vec![(2000, 46000)],
            },
        ],
    )
    .unwrap()
}

#[test]
fn geography_is_independent_of_any_route_and_read_without_allocating() {
    let bytes = sample();
    let a = Atlas::parse(&bytes).unwrap();
    assert_eq!(a.name, "France");
    let features: Vec<_> = a.features(0, [-180000, -90000, 180000, 90000]).collect();
    assert_eq!(features.len(), 3);
    assert_eq!(features[2].label, "Ville");
    assert_eq!(
        features[0].points().collect::<Vec<_>>(),
        [(1000, 45000), (3000, 47000)]
    );
    assert_eq!(
        a.features(2, [1900, 45900, 2100, 46100]).count(),
        1,
        "cities are stored once for every zoom"
    );
    assert_eq!(a.features(0, [-2000, 42000, -1000, 43000]).count(), 0);
}

#[test]
fn region_selection_clips_lines_and_can_leave_out_rivers_and_cities() {
    let bytes = subset(
        &sample(),
        "Region",
        [1500, 45500, 2500, 46500],
        false,
        false,
    )
    .unwrap();
    let a = Atlas::parse(&bytes).unwrap();
    assert_eq!(a.name, "Region");
    let f: Vec<_> = a.features(0, [-180000, -90000, 180000, 90000]).collect();
    assert_eq!(f.len(), 1);
    assert_eq!(
        f[0].points().collect::<Vec<_>>(),
        [(1500, 45500), (2500, 46500)]
    );
}

#[test]
fn every_truncation_and_a_corrupted_index_are_rejected() {
    let bytes = sample();
    for end in 0..bytes.len() {
        assert!(Atlas::parse(&bytes[..end]).is_err(), "{end}");
    }
    let mut bad = bytes.clone();
    // Header (6 + name length + count); first entry's offset follows its bbox.
    let at = 6 + "France".len() + 4 + 16;
    bad[at..at + 4].copy_from_slice(&u32::MAX.to_le_bytes());
    let end = bad.len() - 2;
    let crc = route_cc600::crc16(&bad[..end]);
    bad[end..].copy_from_slice(&crc.to_le_bytes());
    assert!(Atlas::parse(&bad).is_err());
    bad = bytes;
    bad[10] ^= 1;
    assert!(Atlas::parse(&bad).is_err());
}

#[test]
fn labels_and_sizes_must_be_safe_for_the_device() {
    let mut city = Feature {
        class: atlas::CITY,
        level: 0,
        label: "Ville\n".into(),
        points: vec![(2000, 46000)],
    };
    assert!(encode("Atlas", &[city]).is_err());
    city = Feature {
        class: atlas::CITY,
        level: 0,
        label: "x".repeat(25),
        points: vec![(2000, 46000)],
    };
    assert!(encode("Atlas", &[city]).is_err());
    assert!(Atlas::parse(&vec![0; atlas::MAX_BYTES + 1]).is_err());
}

#[test]
fn regional_roads_departments_and_lakes_survive_clipping_and_water_can_be_omitted() {
    let features: Vec<_> = [atlas::ROAD, atlas::DEPARTMENT, atlas::LAKE]
        .into_iter()
        .map(|class| Feature {
            class,
            level: 0,
            label: String::new(),
            points: vec![(1000, 46000), (3000, 46000)],
        })
        .collect();
    let source = encode("Region", &features).unwrap();
    for (water, expected) in [
        (true, vec![atlas::ROAD, atlas::DEPARTMENT, atlas::LAKE]),
        (false, vec![atlas::ROAD, atlas::DEPARTMENT]),
    ] {
        let selected = subset(&source, "Region", [1500, 45500, 2500, 46500], water, false).unwrap();
        let atlas = Atlas::parse(&selected).unwrap();
        let found: Vec<_> = atlas
            .features(0, [-180000, -90000, 180000, 90000])
            .collect();
        assert_eq!(found.iter().map(|f| f.class).collect::<Vec<_>>(), expected);
        for f in found {
            assert_eq!(
                f.points().collect::<Vec<_>>(),
                [(1500, 46000), (2500, 46000)]
            );
        }
    }
}

#[test]
fn every_bundled_region_contains_local_roads_departments_and_towns_within_the_budget() {
    let root = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../../app/assets/atlas");
    let mut lakes = 0;
    for region in [
        "occitanie",
        "alpes",
        "bretagne",
        "aquitaine",
        "paca",
        "corse",
        "normandie",
        "loire",
        "centre",
        "idf",
        "nord",
        "est",
        "bourgogne",
    ] {
        let bytes = std::fs::read(root.join(format!("{region}.ocat"))).unwrap();
        assert!(bytes.len() <= atlas::MAX_BYTES, "{region}");
        let atlas = Atlas::parse(&bytes).unwrap();
        let features: Vec<_> = atlas
            .features(0, [-180000, -90000, 180000, 90000])
            .collect();
        for class in [atlas::ROAD, atlas::DEPARTMENT, atlas::CITY] {
            assert!(
                features.iter().any(|f| f.class == class),
                "{region}, class {class}"
            );
        }
        lakes += features.iter().filter(|f| f.class == atlas::LAKE).count();
        if region == "occitanie" {
            assert!(
                features.iter().any(|f| f.label == "Lavelanet"),
                "small towns are included"
            );
        }
    }
    assert!(lakes > 0, "regional packs include lake outlines");
}

#[test]
fn precise_atlas_keeps_nearby_roads_separate_and_clips_to_the_selection() {
    use atlas::build::compile;
    let bounds = [190_000, 4_590_000, 210_000, 4_610_000];
    let features = [
        Feature {
            class: atlas::MINOR,
            level: 0,
            label: String::new(),
            points: vec![(180_000, 4_600_000), (220_000, 4_600_000)],
        },
        Feature {
            class: atlas::PATH,
            level: 0,
            label: String::new(),
            points: vec![(180_000, 4_600_005), (220_000, 4_600_005)],
        },
        Feature {
            class: atlas::STREAM,
            level: 0,
            label: String::new(),
            points: vec![(200_000, 4_590_000), (200_000, 4_610_000)],
        },
    ];
    let bytes = compile(&sample(), "Local", bounds, &features, 1.0).unwrap();
    let a = Atlas::parse(&bytes).unwrap();
    assert_eq!(a.scale, atlas::PRECISE_SCALE);
    assert_eq!(a.min_m_per_px, 1);
    let found: Vec<_> = a
        .features(0, bounds)
        .filter(|f| matches!(f.class, atlas::MINOR | atlas::PATH))
        .collect();
    assert_eq!(found.len(), 2);
    assert!(found.iter().all(|f| f.level == atlas::SHARED_LEVEL));
    for level in 0..3 {
        assert_eq!(
            a.features(level, bounds)
                .filter(|f| matches!(f.class, atlas::MINOR | atlas::PATH))
                .count(),
            2
        );
    }
    assert_eq!(
        found[0].points().collect::<Vec<_>>(),
        [(190_000, 4_600_000), (210_000, 4_600_000)]
    );
    assert_eq!(
        found[1].points().collect::<Vec<_>>(),
        [(190_000, 4_600_005), (210_000, 4_600_005)]
    );
    for level in 0..3 {
        for f in a.features(level, bounds) {
            assert!(f.points().all(|(x, y)| x >= bounds[0]
                && x <= bounds[2]
                && y >= bounds[1]
                && y <= bounds[3]));
        }
    }
    for end in 0..bytes.len() {
        assert!(Atlas::parse(&bytes[..end]).is_err());
    }
    let dry = subset(&bytes, "Dry", bounds, false, true).unwrap();
    assert!(
        Atlas::parse(&dry)
            .unwrap()
            .features(0, bounds)
            .all(|f| f.class != atlas::STREAM)
    );
}

#[test]
fn simplifying_precise_geometry_keeps_ends_and_reduces_bytes() {
    use atlas::build::compile;
    let bounds = [190_000, 4_590_000, 210_000, 4_610_000];
    let features = [Feature {
        class: atlas::ROAD,
        level: 0,
        label: String::new(),
        points: (0..200)
            .map(|i| (190_100 + i * 90, 4_600_000 + if i % 2 == 0 { 0 } else { 3 }))
            .collect(),
    }];
    let fine = compile(&sample(), "Fine", bounds, &features, 1.0).unwrap();
    let coarse = compile(&sample(), "Fine", bounds, &features, 20.0).unwrap();
    assert!(coarse.len() < fine.len());
    let a = Atlas::parse(&coarse).unwrap();
    assert_eq!(a.min_m_per_px, 10);
    let road = a
        .features(0, bounds)
        .find(|f| f.class == atlas::ROAD)
        .unwrap();
    assert_eq!(road.points().next(), features[0].points.first().copied());
    assert_eq!(road.points().last(), features[0].points.last().copied());
}
