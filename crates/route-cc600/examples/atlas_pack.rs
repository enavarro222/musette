//! Pack prepared geographic features. Run through tools/build_atlas.py.
use route_cc600::atlas::build::{Feature, encode, encode_precise};
use std::io::{Read, Write};

fn main() {
    let mut input = String::new();
    std::io::stdin().read_to_string(&mut input).unwrap();
    let json: serde_json::Value = serde_json::from_str(&input).unwrap();
    let features: Vec<_> = json["features"]
        .as_array()
        .unwrap()
        .iter()
        .map(|f| Feature {
            class: f["class"].as_u64().unwrap() as u8,
            level: f["level"].as_u64().unwrap() as u8,
            label: f["label"].as_str().unwrap().to_owned(),
            points: f["points"]
                .as_array()
                .unwrap()
                .iter()
                .map(|p| (p[0].as_i64().unwrap() as i32, p[1].as_i64().unwrap() as i32))
                .collect(),
        })
        .collect();
    let encode = if json["version"].as_u64() == Some(2) {
        encode_precise
    } else {
        encode
    };
    let bytes =
        encode(json["name"].as_str().unwrap(), &features).expect("valid atlas within 512 KiB");
    std::io::stdout().write_all(&bytes).unwrap();
}
