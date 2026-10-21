use super::sim::{Config, Device, FIT_EPOCH_OFFSET};
use super::*;

fn file(n: usize) -> Vec<u8> {
    (0..n).map(|i| (i * 7 + (i >> 8)) as u8).collect()
}

/// Runs a request against a simulated device until it ends. Answers come in
/// 20-byte notifications. `cut_after`: frames the app writes before the link
/// drops (nothing passes after). Silence calls [`Session::on_silence`].
/// Returns every event, the last one ending the request.
fn run(s: &mut Session, dev: &mut Device, first: Step, cut_after: Option<usize>) -> Vec<Event> {
    let mut events = Vec::new();
    let mut writes: std::collections::VecDeque<Vec<u8>> = first.writes.into();
    events.extend(first.events);
    let mut written = 0;
    while !events.last().is_some_and(Event::ends) {
        let Some(w) = writes.pop_front() else {
            let step = s.on_silence();
            writes.extend(step.writes);
            events.extend(step.events);
            continue;
        };
        written += 1;
        if cut_after.is_some_and(|n| written > n) {
            continue;
        }
        for frame in dev.write(&w) {
            for part in frame.chunks(20) {
                let step = s.on_bytes(part);
                writes.extend(step.writes);
                events.extend(step.events);
            }
        }
    }
    events
}

fn last(events: &[Event]) -> &Event {
    events.last().unwrap()
}

#[test]
fn sends_a_file_with_progress_up_to_the_end() {
    let mut dev = Device::new(Config::default());
    let mut s = Session::new();
    let data = file(20_000);
    let step = s.send_file(Kind::Route, data.clone());
    let events = run(&mut s, &mut dev, step, None);
    assert_eq!(last(&events), &Event::Done);
    assert_eq!(dev.committed(), Some(&data[..]));
    assert_eq!(dev.chunk_bytes, 20_000, "nothing sent twice");
    let progress: Vec<u32> = events
        .iter()
        .filter_map(|e| match e {
            Event::Progress { done, .. } => Some(*done),
            _ => None,
        })
        .collect();
    assert!(progress.windows(2).all(|w| w[0] <= w[1]));
    assert_eq!(progress.last(), Some(&1000));
}

#[test]
fn resends_lost_chunks_and_survives_a_lost_ack() {
    let cfg = Config {
        lose_chunks: vec![2, 3, 30, 31, 32, 60],
        lose_acks: vec![3],
        ..Config::default()
    };
    let mut dev = Device::new(cfg);
    let mut s = Session::new();
    let data = file(20_000);
    let step = s.send_file(Kind::Map, data.clone());
    assert_eq!(last(&run(&mut s, &mut dev, step, None)), &Event::Done);
    assert_eq!(dev.committed(), Some(&data[..]));
}

#[test]
fn resumes_after_the_link_dropped() {
    let mut dev = Device::new(Config::default());
    let mut s = Session::new();
    let data = file(20_000);
    let step = s.send_file(Kind::Route, data.clone());
    // Begin, then 50 chunks of 240 bytes at most.
    let events = run(&mut s, &mut dev, step, Some(51));
    assert_eq!(last(&events), &Event::Failed(Failure::Timeout));
    dev.disconnect();
    let kept = dev.received();
    assert!(kept > 10_000 && kept <= 12_000, "{kept}");

    let before = dev.chunk_bytes;
    let step = s.send_file(Kind::Route, data.clone());
    assert_eq!(last(&run(&mut s, &mut dev, step, None)), &Event::Done);
    assert_eq!(dev.committed(), Some(&data[..]));
    assert_eq!(dev.chunk_bytes - before, 20_000 - kept);
}

#[test]
fn stops_after_repeated_silences() {
    let mut dev = Device::new(Config {
        // Every chunk after the first window is lost, and the device keeps asking from there.
        lose_chunks: (9..10_000).collect(),
        ..Config::default()
    });
    let mut s = Session::new();
    let step = s.send_file(Kind::Map, file(20_000));
    assert_eq!(
        last(&run(&mut s, &mut dev, step, None)),
        &Event::Failed(Failure::Stalled)
    );
}

#[test]
fn says_the_device_is_full() {
    let mut dev = Device::new(Config {
        free: 1000,
        ..Config::default()
    });
    let mut s = Session::new();
    let step = s.send_file(Kind::Map, file(5000));
    assert_eq!(
        last(&run(&mut s, &mut dev, step, None)),
        &Event::Failed(Failure::Device(ErrorCode::NoSpace))
    );
}

#[test]
fn lists_downloads_and_acknowledges_a_ride() {
    let fit = file(3000);
    let mut dev = Device::new(Config::default());
    dev.add_activity(7, 1_790_000_000, fit.clone());
    let mut s = Session::new();

    let step = s.hello();
    assert!(matches!(
        last(&run(&mut s, &mut dev, step, None)),
        Event::Info(_)
    ));

    let step = s.list_activities();
    let Event::Activities(list) = last(&run(&mut s, &mut dev, step, None)).clone() else {
        panic!("no list");
    };
    assert_eq!(list.len(), 1);
    assert_eq!(list[0].id, 7);
    assert_eq!(list[0].start_time as i64 + FIT_EPOCH_OFFSET, 1_790_000_000);
    assert_eq!(list[0].size, 3000);

    let step = s.download(7, 3000);
    let events = run(&mut s, &mut dev, step, None);
    assert_eq!(last(&events), &Event::File(fit));
    assert_eq!(events.len(), 7, "6 reads of 512 bytes, then the file");

    let step = s.acknowledge(7);
    assert_eq!(last(&run(&mut s, &mut dev, step, None)), &Event::Done);
    assert_eq!(dev.acked, [7]);
}

#[test]
fn settings_all_or_nothing() {
    let mut dev = Device::new(Config::default());
    let mut s = Session::new();
    let step = s.set_settings("sound=off\nscroll_s=99\n");
    assert_eq!(
        last(&run(&mut s, &mut dev, step, None)),
        &Event::Failed(Failure::BadSetting("scroll_s".into()))
    );
    let step = s.set_settings("sound=off\n");
    assert_eq!(last(&run(&mut s, &mut dev, step, None)), &Event::Done);
    let step = s.get_settings();
    let Event::Settings(text) = last(&run(&mut s, &mut dev, step, None)).clone() else {
        panic!("no settings");
    };
    assert!(text.contains("sound=off\n"));
}

#[test]
fn ignores_answers_to_an_abandoned_request() {
    let mut s = Session::new();
    let mut dev = Device::new(Config::default());
    let old = s.get_settings();
    assert_eq!(s.on_silence().events, [Event::Failed(Failure::Timeout)]);
    let late = dev.write(&old.writes[0]);
    let step = s.hello();
    for f in late {
        assert!(s.on_bytes(&f).events.is_empty());
    }
    assert!(matches!(
        last(&run(&mut s, &mut dev, step, None)),
        Event::Info(_)
    ));
}
