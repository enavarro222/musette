use super::*;

#[test]
fn gpx_points_and_name() {
    let gpx = r#"<gpx><trk><name> Col </name><trkseg>
        <trkpt lat="45.0" lon="5.0"><ele>200</ele></trkpt>
        <trkpt lat="45.01" lon="5.0"></trkpt>
    </trkseg></trk></gpx>"#;
    let r = parse_gpx(gpx).unwrap();
    assert_eq!(r.name, "Col");
    assert_eq!(r.lats, [45.0, 45.01]);
    assert_eq!(r.eles[0], 200.0);
    assert!(r.eles[1].is_nan());
    assert_eq!(parse_gpx("<gpx></gpx>"), Err(Error("noPoints".into())));
}

#[test]
fn simplified_points_carry_their_distance() {
    // Three points on a meridian, ~1.1 km apart: the middle one is dropped.
    let a = analyze_route(&[45.0, 45.01, 45.02], &[5.0; 3], &[f64::NAN; 3]).unwrap();
    assert_eq!(a.simplified, [0, 2]);
    assert_eq!(a.simplified_m.len(), 2);
    assert_eq!(a.simplified_m[0], 0.0);
    assert_eq!(a.simplified_m[1], a.distance_m);
    assert!((a.distance_m - 2224.0).abs() < 5.0);
}

#[test]
fn unnamed_gpx_is_a_trace() {
    let gpx = r#"<trkpt lat="45" lon="5"/><trkpt lat="46" lon="5"/>"#;
    assert_eq!(parse_gpx(gpx).unwrap().name, "Trace");
}

#[test]
fn capabilities_depend_on_the_link() {
    let usb = capabilities(model("bryton-rider-750").unwrap(), Link::UsbFiles);
    assert!(usb.download_activities && !usb.settings);
    assert!(capabilities(Model::BrytonRider750, Link::Ble).settings);
    assert!(model("garmin").is_err());
}

// ---- sessions ------------------------------------------------------------

/// A valid FIT file (header + `body` + CRC), as `fit::verify` wants it.
fn fit_file(body: &[u8]) -> Vec<u8> {
    let mut out = vec![14, 0x20];
    out.extend(2132u16.to_le_bytes());
    out.extend((body.len() as u32).to_le_bytes());
    out.extend(b".FIT");
    let crc = fit::crc16(&out);
    out.extend(crc.to_le_bytes());
    out.extend(body);
    let crc = fit::crc16(&out);
    out.extend(crc.to_le_bytes());
    out
}

const FAST: Timing = Timing {
    request_ms: 300,
    short_ms: 50,
};

/// Runs one request between a CC600 session and a simulated CC600 until it
/// ends; silences become timeouts. Returns the subscriptions, the progress
/// reported and the outcome.
fn cc600(s: &mut Session, dev: &mut Cc600Simulator, first: Step) -> (Vec<u8>, Vec<f64>, Outcome) {
    let mut subscribed = vec![];
    let mut progress = vec![];
    let mut steps = vec![first];
    loop {
        let mut writes = vec![];
        for step in steps.drain(..) {
            subscribed.extend(step.subscribe);
            progress.extend(step.progress);
            if let Some(o) = step.outcome {
                return (subscribed, progress, o);
            }
            writes.extend(step.writes);
        }
        if writes.is_empty() {
            steps.push(s.on_timeout());
        }
        for w in writes {
            assert_eq!(w.channel, 0, "CC600 requests go to rx");
            for frame in dev.write(&w.bytes) {
                for part in frame.chunks(20) {
                    steps.push(s.on_notify(1, part));
                }
            }
        }
    }
}

#[test]
fn cc600_connects_lists_downloads_and_acknowledges() {
    let fit = fit_file(&[7; 3000]);
    let mut dev = Cc600Simulator::new(0, 0, String::new(), vec![], vec![]);
    dev.add_activity(7, 1_790_000_000, fit.clone());
    let mut s = Session::new(Model::OpenCc600, FAST);
    assert_eq!(
        s.channels()[1].characteristic,
        protocol_cc600::ble::TX_CHAR_UUID
    );

    let step = s.connect().unwrap();
    let (subscribed, _, info) = cc600(&mut s, &mut dev, step);
    assert_eq!(subscribed, [1]);
    assert!(matches!(info, Outcome::Info { .. }));

    let step = s.list_activities().unwrap();
    let Outcome::Activities { activities } = cc600(&mut s, &mut dev, step).2 else {
        panic!("no list");
    };
    assert_eq!(
        activities,
        [Activity {
            id: "7".into(),
            start_time: Some(1_790_000_000),
            local_time: false,
            size: Some(fit.len() as u64),
            synced: Some(false),
        }]
    );

    let step = s.download("7", Some(fit.len() as u64)).unwrap();
    let (_, progress, file) = cc600(&mut s, &mut dev, step);
    assert_eq!(file, Outcome::File { bytes: fit });
    assert_eq!(progress.last(), Some(&1.0));

    let step = s.acknowledge("7").unwrap();
    assert_eq!(cc600(&mut s, &mut dev, step).2, Outcome::Done);
    assert_eq!(dev.acked(), [7]);
    assert!(s.download("x", Some(10)).is_err());
}

#[test]
fn cc600_refuses_a_corrupted_ride() {
    let mut fit = fit_file(&[7; 3000]);
    fit[100] ^= 0xff;
    let mut dev = Cc600Simulator::new(0, 0, String::new(), vec![], vec![]);
    dev.add_activity(1, 1_790_000_000, fit.clone());
    let mut s = Session::new(Model::OpenCc600, FAST);
    let step = s.download("1", Some(fit.len() as u64)).unwrap();
    assert!(matches!(
        cc600(&mut s, &mut dev, step).2,
        Outcome::Failed(Failure {
            code: "corrupted",
            ..
        })
    ));
}

#[test]
fn cc600_sends_a_route_as_an_ocrt_file() {
    let mut dev = Cc600Simulator::new(0, 0, String::new(), vec![], vec![]);
    let mut s = Session::new(Model::OpenCc600, FAST);
    let n = 201;
    let route = ParsedRoute {
        name: "Col du test".into(),
        lats: (0..n).map(|i| 45.0 + i as f64 * 0.01 / 111.32).collect(),
        lons: vec![3.0; n],
        eles: (0..n).map(|i| 200.0 + i as f64 / 2.0).collect(),
    };
    let step = s.send_route(&route).unwrap();
    let (_, progress, outcome) = cc600(&mut s, &mut dev, step);
    assert_eq!(outcome, Outcome::Done);
    assert_eq!(progress.last(), Some(&1.0));
    assert_eq!(&dev.committed().unwrap()[..4], b"OCRT");
}

#[test]
fn cc600_settings_read_and_written_by_key() {
    let mut dev = Cc600Simulator::new(
        0,
        0,
        "sound=off\nhr=ant:120:4242:1\n".into(),
        vec![],
        vec![],
    );
    let mut s = Session::new(Model::OpenCc600, FAST);
    let step = s.read_settings().unwrap();
    let Outcome::Settings { fields, values } = cc600(&mut s, &mut dev, step).2 else {
        panic!("no settings");
    };
    let value = |k: &str| values.iter().find(|v| v.key == k).unwrap().clone();
    assert_eq!(value("sound").number, Some(0.0));
    assert_eq!(value("scroll_s").number, Some(4.0)); // default
    assert_eq!(value("hr").text, "ant:120:4242:1");
    let hr = fields.iter().find(|f| f.key == "hr").unwrap();
    assert!(!hr.writable);
    assert!(s.write_settings(&[value("hr")]).is_err(), "read-only");

    let change = |key: &str, number: Option<f64>, text: &str| Setting {
        key: key.into(),
        number,
        text: text.into(),
    };
    let step = s
        .write_settings(&[
            change("sound", Some(1.0), ""),
            change("theme", None, "night"),
            change("backlight", Some(30.0), ""),
        ])
        .unwrap();
    assert_eq!(cc600(&mut s, &mut dev, step).2, Outcome::Done);
    assert_eq!(
        dev.settings_writes(),
        ["sound=on\ntheme=night\nbacklight=30\n"]
    );

    let step = s
        .write_settings(&[change("scroll_s", Some(99.0), "")])
        .unwrap();
    assert_eq!(
        cc600(&mut s, &mut dev, step).2,
        Outcome::Failed(Failure {
            code: "badSetting",
            detail: "scroll_s".into()
        })
    );
}

#[test]
fn cc600_without_answer_times_out() {
    let mut s = Session::new(Model::OpenCc600, FAST);
    let step = s.list_activities().unwrap();
    assert_eq!(step.wait_ms, Some(300));
    let step = s.on_timeout();
    assert_eq!(step.outcome, Some(Outcome::Failed(Failure::new("timeout"))));
    assert_eq!(step.wait_ms, Some(0));
}

#[test]
fn bryton_lists_rides() {
    use driver_bryton::ble::{control, split_transfer};
    let mut s = Session::new(Model::BrytonRider750, FAST);
    let step = s.list_activities().unwrap();
    assert_eq!(
        step.writes,
        [Write {
            channel: 0,
            bytes: vec![11, 0x04, 0]
        }]
    );
    let step = s.on_notify(0, &[11, control(1, 1), 2]);
    assert_eq!(step.writes[0].bytes, [11, 0x44, 3]);
    let id = driver_bryton::ble::file_id_from_name("260922125127").unwrap();
    let mut entry = vec![19];
    entry.extend(id.to_be_bytes());
    entry.extend(2902u32.to_be_bytes());
    entry.extend(12_868u32.to_be_bytes());
    entry.resize(36, 0);
    let outcome = split_transfer(11, 1, &entry, 20)
        .into_iter()
        .find_map(|f| s.on_notify(1, &f).outcome);
    assert_eq!(
        outcome,
        Some(Outcome::Activities {
            activities: vec![Activity {
                id: "260922125127".into(),
                start_time: Some(i64::from(id)),
                local_time: true,
                size: None,
                synced: Some(false),
            }]
        })
    );
    assert!(s.download("tmp", None).is_err());
    assert_eq!(s.acknowledge("260922125127").unwrap().writes[0].channel, 2);
}

#[test]
fn bryton_connects_without_handshake() {
    let mut s = Session::new(Model::BrytonRider750, FAST);
    let step = s.connect().unwrap();
    assert_eq!(step.subscribe, [0, 1]);
    assert_eq!(step.writes[0].bytes, [6, 0x04]);
    // Device info answered and sent: the setting channel comes next.
    let mut steps = vec![s.on_notify(0, &[6, driver_bryton::ble::control(1, 1), 2])];
    let info = b"UD1902000000000000\0IV089.013.0005.03.011.001\0MNRider750\0CPAFF,0\0";
    for f in driver_bryton::ble::split_transfer(6, 1, info, 20) {
        steps.push(s.on_notify(1, &f));
    }
    let after = steps.iter().find(|s| !s.subscribe.is_empty()).unwrap();
    assert_eq!(after.subscribe, [2]);
    assert_eq!(after.wait_ms, Some(50));
    assert_eq!(
        s.on_timeout().outcome,
        Some(Outcome::Info {
            name: "Rider750".into(),
            recording: false
        })
    );
}

#[test]
fn bryton_settings_checked_before_sending() {
    let fields = setting_fields(Model::BrytonRider750);
    let key_tone = fields.iter().find(|f| f.key == "key_tone").unwrap();
    assert_eq!((key_tone.kind, key_tone.writable), ("bool", true));
    let gps = fields.iter().find(|f| f.key == "bike0.gps").unwrap();
    assert_eq!((gps.kind, gps.options.len()), ("choice", 7));
    assert!(
        !fields
            .iter()
            .find(|f| f.key == "zone.ftp")
            .unwrap()
            .writable
    );

    let mut s = Session::new(Model::BrytonRider750, FAST);
    let set = |key: &str, n: f64| Setting {
        key: key.into(),
        number: Some(n),
        text: String::new(),
    };
    assert!(s
        .write_settings(&[set("key_tone", 1.0), set("zone.ftp", 250.0)])
        .is_err());
    let step = s
        .write_settings(&[set("bike2.auto_pause", 1.0), set("key_tone", 1.0)])
        .unwrap();
    assert_eq!(step.writes[0].bytes, [27, 1, 2, 1, 31]);
    let step = s.on_notify(2, &[27, 10]);
    assert_eq!(step.writes[0].bytes[..3], [25, 1, 1]);
    assert_eq!(s.on_notify(2, &[25, 10]).outcome, Some(Outcome::Done));
}

#[test]
fn bryton_reads_a_choice_as_its_value() {
    let f = driver_bryton::settings::fields()
        .into_iter()
        .find(|f| f.key == "backlight")
        .unwrap();
    // Backlight "auto", as a Rider 750 answers it.
    let v = session::bryton_setting(&f, &[0x14, 1, 6, 0x1b]).unwrap();
    assert_eq!((v.number, v.text.as_str()), (Some(6.0), "6"));
}

#[test]
fn bryton_takes_routes_only() {
    let lats: Vec<f64> = (0..100).map(|i| 45.0 + i as f64 * 1e-4).collect();
    let fit = bryton_build_route(&lats, &[1.0; 100], &[f64::NAN; 100]).unwrap();
    let r = driver_bryton::route::Route::decode(&fit).unwrap();
    assert_eq!(r.points.len(), 2, "a straight line keeps its ends");
    let mut s = Session::new(Model::BrytonRider750, FAST);
    let route = ParsedRoute {
        name: " ".into(),
        lats,
        lons: vec![1.0; 100],
        eles: vec![f64::NAN; 100],
    };
    assert!(s.send_file(FileKind::Map, vec![1]).is_err());
    assert_eq!(
        s.send_route(&route).unwrap().writes[0].bytes,
        [16, 0x04, 11]
    );
}
