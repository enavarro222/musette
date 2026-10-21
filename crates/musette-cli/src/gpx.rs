//! Minimal GPX reader for the CLI: track points (`trkpt`), else route
//! points (`rtept`), with `ele`. The app parses GPX with the platform XML
//! parser; this is only for trying routes on a device from a PC.

use anyhow::{bail, Result};
use track::Point;

fn attr(tag: &str, name: &str) -> Option<f64> {
    let key = format!("{name}=");
    let i = tag.find(&key)? + key.len();
    let quote = tag[i..].chars().next()?;
    let rest = &tag[i + 1..];
    rest[..rest.find(quote)?].trim().parse().ok()
}

fn points(text: &str, tag: &str) -> Vec<Point> {
    let open = format!("<{tag}");
    let close = format!("</{tag}>");
    let mut out = vec![];
    let mut rest = text;
    while let Some(i) = rest.find(&open) {
        rest = &rest[i..];
        let head_end = rest.find('>').unwrap_or(rest.len());
        let head = &rest[..head_end];
        let body_end = if head.ends_with('/') {
            head_end
        } else {
            rest.find(&close).unwrap_or(head_end)
        };
        let body = &rest[head_end.min(body_end)..body_end];
        let ele = body
            .find("<ele>")
            .and_then(|j| body[j + 5..].split('<').next())
            .and_then(|v| v.trim().parse().ok());
        if let (Some(lat), Some(lon)) = (attr(head, "lat"), attr(head, "lon")) {
            out.push(Point::new(lat, lon, ele));
        }
        rest = &rest[body_end.max(1)..];
    }
    out
}

pub fn read(text: &str) -> Result<Vec<Point>> {
    let mut pts = points(text, "trkpt");
    if pts.is_empty() {
        pts = points(text, "rtept");
    }
    if pts.len() < 2 {
        bail!("no track in this GPX");
    }
    Ok(pts)
}

#[cfg(test)]
mod tests {
    #[test]
    fn reads_track_points() {
        let gpx = r#"<gpx><trk><trkseg>
            <trkpt lat="45.1" lon='1.5'><ele>120.5</ele></trkpt>
            <trkpt lon="1.6" lat="45.2"/>
        </trkseg></trk></gpx>"#;
        let p = super::read(gpx).unwrap();
        assert_eq!(p.len(), 2);
        assert_eq!((p[0].lat, p[0].lon, p[0].ele), (45.1, 1.5, Some(120.5)));
        assert_eq!((p[1].lat, p[1].ele), (45.2, None));
    }
}
