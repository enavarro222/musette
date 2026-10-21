//! Settings read over the BLE setting channel (layout version 1, as a
//! Rider 750 reports it). Each [`Field`] says which "get" to send and how to
//! read the answer; see docs/drivers/bryton-ble.md §4.3.
//!
//! A get is `[cmd, 2, args..., checksum]`; the answer is a type-1 frame
//! `[cmd, 1, payload..., checksum]` and [`Field::decode`] gets the payload.
//! The type-5 capability answer (`[cmd, 5, version u16, mask..., checksum]`)
//! gives, for commands with sub-items, a bit mask of the items the device has.

/// A decoded setting value.
#[derive(Clone, Debug, PartialEq)]
pub enum Value {
    Bool(bool),
    Int(i64),
    /// Metric and imperial values the device keeps side by side.
    Pair {
        metric: f32,
        imperial: f32,
    },
    Date {
        year: u16,
        month: u8,
        day: u8,
    },
    Text(String),
    /// Known layout, meaning not settled yet.
    Raw(Vec<u8>),
}

impl std::fmt::Display for Value {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Value::Bool(b) => write!(f, "{}", if *b { "on" } else { "off" }),
            Value::Int(i) => write!(f, "{i}"),
            Value::Pair { metric, imperial } => write!(f, "{metric} (imperial {imperial})"),
            Value::Date { year, month, day } => write!(f, "{year:04}-{month:02}-{day:02}"),
            Value::Text(s) => write!(f, "{s:?}"),
            Value::Raw(b) => {
                let hex: Vec<String> = b.iter().map(|x| format!("{x:02x}")).collect();
                write!(f, "raw {}", hex.join(" "))
            }
        }
    }
}

/// One readable setting.
pub struct Field {
    /// Stable key, `bike<N>.` prefix for per-bike values.
    pub key: &'static str,
    pub cmd: u8,
    /// Bytes after `[cmd, 2]` in the get.
    pub args: &'static [u8],
    /// Reads the answer payload (between `[cmd, 1]` and the checksum).
    pub decode: fn(&[u8]) -> Option<Value>,
}

fn f32_at(p: &[u8], i: usize) -> Option<f32> {
    Some(f32::from_le_bytes(p.get(i..i + 4)?.try_into().ok()?))
}

fn u16_at(p: &[u8], i: usize) -> Option<u16> {
    Some(u16::from_le_bytes(p.get(i..i + 2)?.try_into().ok()?))
}

fn byte0(p: &[u8]) -> Option<Value> {
    Some(Value::Int(*p.first()? as i64))
}

fn bool0(p: &[u8]) -> Option<Value> {
    Some(Value::Bool(*p.first()? != 0))
}

fn raw(p: &[u8]) -> Option<Value> {
    Some(Value::Raw(p.to_vec()))
}

/// `[bike, value]`
fn bike_bool(p: &[u8]) -> Option<Value> {
    Some(Value::Bool(*p.get(1)? != 0))
}

/// `[bike, value]`
fn bike_byte(p: &[u8]) -> Option<Value> {
    Some(Value::Int(*p.get(1)? as i64))
}

/// `[bike, f32 metric, f32 imperial]`
fn bike_pair(p: &[u8]) -> Option<Value> {
    Some(Value::Pair {
        metric: f32_at(p, 1)?,
        imperial: f32_at(p, 5)?,
    })
}

/// `[mode << 4 | bike, f32 dist metric, f32 dist imperial, f32 lat, f32 lon]`
fn auto_lap(p: &[u8]) -> Option<Value> {
    let mode = p.first()? >> 4;
    Some(Value::Text(format!(
        "mode {mode}, distance {} (imperial {}), position {} {}",
        f32_at(p, 1)?,
        f32_at(p, 5)?,
        f32_at(p, 9)?,
        f32_at(p, 13)?
    )))
}

/// User: `[seq, item, value...]`.
fn user_pair(p: &[u8]) -> Option<Value> {
    Some(Value::Pair {
        metric: f32_at(p, 2)?,
        imperial: f32_at(p, 6)?,
    })
}

fn user_date(p: &[u8]) -> Option<Value> {
    Some(Value::Date {
        year: u16_at(p, 2)?,
        month: *p.get(4)?,
        day: *p.get(5)?,
    })
}

fn user_byte(p: &[u8]) -> Option<Value> {
    Some(Value::Int(*p.get(2)? as i64))
}

fn user_text(p: &[u8]) -> Option<Value> {
    let s = p.get(2..)?;
    let s = s.split(|&b| b == 0).next()?;
    Some(Value::Text(String::from_utf8_lossy(s).into_owned()))
}

/// Bike: `[seq, item, bike, priority1, priority2, priority3]`.
fn speed_source(p: &[u8]) -> Option<Value> {
    let pr = p.get(3..6)?;
    Some(Value::Text(format!(
        "priorities {} {} {}",
        pr[0], pr[1], pr[2]
    )))
}

/// Bike name, a long command: the get with seq 0 answers `[0, 5, bike,
/// chunks, length]`, then seq `k` gives chunk `k` (14 bytes, UTF-8). This
/// reads chunk 1 only: names up to 14 bytes.
fn bike_name(p: &[u8]) -> Option<Value> {
    let s = p.get(3..)?;
    let s = s.split(|&b| b == 0).next()?;
    Some(Value::Text(
        String::from_utf8_lossy(s).trim_end().to_string(),
    ))
}

/// Zones: `[item, u16]`; item 0 is the base value (FTP W, max HR, LTHR).
fn zone_base(p: &[u8]) -> Option<Value> {
    Some(Value::Int(u16_at(p, 1)? as i64))
}

macro_rules! per_bike {
    ($key:literal, $cmd:expr, $decode:expr) => {
        [
            Field {
                key: concat!("bike0.", $key),
                cmd: $cmd,
                args: &[0],
                decode: $decode,
            },
            Field {
                key: concat!("bike1.", $key),
                cmd: $cmd,
                args: &[1],
                decode: $decode,
            },
            Field {
                key: concat!("bike2.", $key),
                cmd: $cmd,
                args: &[2],
                decode: $decode,
            },
        ]
    };
}

/// The settings `musette setting read` shows. Per-bike commands take a
/// bike slot 0-2: slot n is `System/Bike<n+1>Profile.ini` on the drive
/// (checked on a Rider 750 by changing auto pause on the device). The
/// device's menu may list the bikes in another order.
pub fn fields() -> Vec<Field> {
    let mut v = vec![
        Field {
            key: "backlight",
            cmd: 20,
            args: &[],
            decode: byte0,
        },
        Field {
            key: "battery",
            cmd: 24,
            args: &[],
            decode: raw,
        },
        Field {
            key: "key_tone",
            cmd: 25,
            args: &[],
            decode: bool0,
        },
        Field {
            key: "sound",
            cmd: 26,
            args: &[],
            decode: bool0,
        },
        Field {
            key: "unit",
            cmd: 29,
            args: &[],
            decode: byte0,
        },
        Field {
            key: "user.height",
            cmd: 30,
            args: &[0, 0],
            decode: user_pair,
        },
        Field {
            key: "user.weight",
            cmd: 30,
            args: &[0, 1],
            decode: user_pair,
        },
        Field {
            key: "user.birthday",
            cmd: 30,
            args: &[0, 2],
            decode: user_date,
        },
        Field {
            key: "user.gender",
            cmd: 30,
            args: &[0, 3],
            decode: user_byte,
        },
        Field {
            key: "user.language",
            cmd: 30,
            args: &[0, 6],
            decode: user_text,
        },
        Field {
            key: "zone.ftp",
            cmd: 33,
            args: &[0],
            decode: zone_base,
        },
        Field {
            key: "zone.max_hr",
            cmd: 34,
            args: &[0],
            decode: zone_base,
        },
        Field {
            key: "zone.lthr",
            cmd: 35,
            args: &[0],
            decode: zone_base,
        },
        Field {
            key: "log_state",
            cmd: 41,
            args: &[],
            decode: raw,
        },
    ];
    v.extend(per_bike!("auto_pause", 27, bike_bool));
    v.extend(per_bike!("auto_lap", 28, auto_lap));
    v.extend(per_bike!("gps", 40, bike_byte));
    v.extend(per_bike!("odometer", 45, bike_pair));
    // Cmd 31 args: [seq, item, bike]. Name: chunk (seq) 1.
    for (bike, name, speed) in [
        (&[1, 5, 0], "bike0.name", &[0, 0, 0]),
        (&[1, 5, 1], "bike1.name", &[0, 0, 1]),
        (&[1, 5, 2], "bike2.name", &[0, 0, 2]),
    ] {
        v.push(Field {
            key: name,
            cmd: 31,
            args: bike,
            decode: bike_name,
        });
        v.push(Field {
            key: SPEED_KEYS[speed[2] as usize],
            cmd: 31,
            args: speed,
            decode: speed_source,
        });
    }
    v
}

const SPEED_KEYS: [&str; 3] = [
    "bike0.speed_source",
    "bike1.speed_source",
    "bike2.speed_source",
];

/// The payload of a type-1 answer to `cmd`, without the checksum.
pub fn answer_payload(cmd: u8, frame: &[u8]) -> Option<&[u8]> {
    if frame.len() < 3 || frame[0] != cmd || frame[1] != crate::ble::setting::TYPE_SET {
        return None;
    }
    crate::ble::setting_valid(frame).then(|| &frame[2..frame.len() - 1])
}

/// A type-5 capability answer: layout version and item mask bytes.
pub fn parse_capability(cmd: u8, frame: &[u8]) -> Option<(u16, Vec<u8>)> {
    if frame.len() < 5 || frame[0] != cmd || frame[1] != crate::ble::setting::TYPE_CAPABILITY {
        return None;
    }
    let version = u16::from_le_bytes([frame[2], frame[3]]);
    Some((version, frame[4..frame.len() - 1].to_vec()))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::ble::setting_frame;

    fn decode(key: &str, payload: &[u8]) -> Value {
        let f = fields().into_iter().find(|f| f.key == key).unwrap();
        let frame = setting_frame(f.cmd, 1, payload);
        (f.decode)(answer_payload(f.cmd, &frame).unwrap()).unwrap()
    }

    #[test]
    fn user_values() {
        let mut p = vec![0, 0];
        p.extend(180.0f32.to_le_bytes());
        p.extend(70.87f32.to_le_bytes());
        assert_eq!(
            decode("user.height", &p),
            Value::Pair {
                metric: 180.0,
                imperial: 70.87
            }
        );
        assert_eq!(
            decode("user.birthday", &[0, 2, 0xd0, 0x07, 1, 31]),
            Value::Date {
                year: 2000,
                month: 1,
                day: 31
            }
        );
        assert_eq!(
            decode("user.language", &[0, 6, b'E', b'N', b'G']),
            Value::Text("ENG".into())
        );
    }

    #[test]
    fn simple_values() {
        assert_eq!(decode("backlight", &[6]), Value::Int(6));
        assert_eq!(decode("key_tone", &[0]), Value::Bool(false));
        assert_eq!(decode("zone.ftp", &[0, 250, 0]), Value::Int(250));
        assert_eq!(decode("bike1.auto_pause", &[1, 1]), Value::Bool(true));
        let mut odo = vec![0];
        odo.extend(1000.0f32.to_le_bytes());
        odo.extend(621.37f32.to_le_bytes());
        assert_eq!(
            decode("bike0.odometer", &odo),
            Value::Pair {
                metric: 1000.0,
                imperial: 621.37
            }
        );
        assert_eq!(
            decode("bike1.speed_source", &[0, 0, 1, 1, 0, 2]),
            Value::Text("priorities 1 0 2".into())
        );
        let mut name = vec![1, 5, 2];
        name.extend("Vélo X ".as_bytes());
        name.resize(17, 0);
        assert_eq!(decode("bike2.name", &name), Value::Text("Vélo X".into()));
    }

    #[test]
    fn capability_answers() {
        // Seen on a Rider 750: user (30) has items 0-3, 5, 6.
        assert_eq!(
            parse_capability(30, &[0x1e, 5, 1, 0, 0x6f, 0x93]),
            Some((1, vec![0x6f]))
        );
        assert_eq!(parse_capability(30, &[0x1e, 0x0b]), None);
        assert_eq!(answer_payload(20, &[0x14, 1, 6, 0x1b]), Some(&[6u8][..]));
        assert_eq!(
            answer_payload(20, &[0x14, 1, 6, 0x1c]),
            None,
            "bad checksum"
        );
    }
}
