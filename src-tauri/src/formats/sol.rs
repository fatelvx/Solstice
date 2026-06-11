//! Parser and writer for the `.sol` chart format (see `docs/sol-format.md`).
//!
//! Parsing accepts any YAML layout via serde; writing emits a canonical
//! layout with one flow-style mapping per timing event / note so that large
//! charts stay diffable line-by-line.

use std::fmt::Write as _;

use thiserror::Error;

use crate::models::chart::{SolChart, SOL_VERSION};

#[derive(Debug, Error)]
pub enum SolError {
    #[error("invalid YAML: {0}")]
    Yaml(#[from] serde_yaml_ng::Error),
    #[error("unsupported .sol version {0} (this build supports up to {SOL_VERSION})")]
    Version(u32),
    #[error("invalid chart: {0}")]
    Invalid(String),
}

/// Parses a `.sol` document and validates it.
pub fn parse(content: &str) -> Result<SolChart, SolError> {
    let mut chart: SolChart = serde_yaml_ng::from_str(content)?;
    if chart.sol > SOL_VERSION {
        return Err(SolError::Version(chart.sol));
    }
    sanitize(&mut chart);
    validate(&chart)?;
    Ok(chart)
}

/// Serializes a chart to the canonical `.sol` layout.
pub fn write(chart: &SolChart) -> Result<String, SolError> {
    validate(chart)?;

    let mut out = String::new();
    let w = &mut out;

    let _ = writeln!(w, "sol: {}", chart.sol);

    let _ = writeln!(w, "meta:");
    let _ = writeln!(w, "  title: {}", quote(&chart.meta.title));
    let _ = writeln!(w, "  artist: {}", quote(&chart.meta.artist));
    let _ = writeln!(w, "  creator: {}", quote(&chart.meta.creator));
    let _ = writeln!(w, "  difficulty: {}", quote(&chart.meta.difficulty));
    let _ = writeln!(w, "  source: {}", quote(&chart.meta.source));
    let _ = writeln!(w, "  tags: {}", quote(&chart.meta.tags));

    let _ = writeln!(w, "files:");
    let _ = writeln!(w, "  audio: {}", quote(&chart.files.audio));
    if let Some(ref bg) = chart.files.background {
        let _ = writeln!(w, "  background: {}", quote(bg));
    }
    if let Some(ref banner) = chart.files.banner {
        let _ = writeln!(w, "  banner: {}", quote(banner));
    }
    if let Some(ref cdtitle) = chart.files.cdtitle {
        let _ = writeln!(w, "  cdtitle: {}", quote(cdtitle));
    }

    let _ = writeln!(w, "chart:");
    let _ = writeln!(w, "  keys: {}", chart.chart.keys);
    let origin = match chart.chart.origin {
        crate::models::chart::Origin::OsuMania => "osu_mania",
        crate::models::chart::Origin::Etterna => "etterna",
        crate::models::chart::Origin::Sol => "sol",
    };
    let _ = writeln!(w, "  origin: {}", origin);

    let _ = writeln!(w, "timing:");
    let _ = writeln!(w, "  offset_ms: {}", num(chart.timing.offset_ms));
    let _ = writeln!(w, "  preview_ms: {}", num(chart.timing.preview_ms));
    let _ = writeln!(w, "  lead_in_ms: {}", num(chart.timing.lead_in_ms));
    let _ = writeln!(w, "  bpms:");
    for b in &chart.timing.bpms {
        let _ = writeln!(
            w,
            "    - {{ms: {}, bpm: {}, meter: {}}}",
            num(b.ms),
            num(b.bpm),
            b.meter
        );
    }
    if !chart.timing.svs.is_empty() {
        let _ = writeln!(w, "  svs:");
        for sv in &chart.timing.svs {
            let _ = writeln!(w, "    - {{ms: {}, mult: {}}}", num(sv.ms), num(sv.mult));
        }
    }
    if !chart.timing.stops.is_empty() {
        let _ = writeln!(w, "  stops:");
        for s in &chart.timing.stops {
            let _ = writeln!(
                w,
                "    - {{ms: {}, duration_ms: {}}}",
                num(s.ms),
                num(s.duration_ms)
            );
        }
    }

    if chart.notes.is_empty() {
        let _ = writeln!(w, "notes: []");
    } else {
        let _ = writeln!(w, "notes:");
        for n in &chart.notes {
            match n.end_ms {
                Some(end) => {
                    let _ = writeln!(
                        w,
                        "  - {{ms: {}, col: {}, end_ms: {}}}",
                        num(n.ms),
                        n.col,
                        num(end)
                    );
                }
                None => {
                    let _ = writeln!(w, "  - {{ms: {}, col: {}}}", num(n.ms), n.col);
                }
            }
        }
    }

    Ok(out)
}

/// Sorts event lists into canonical order; parsing accepts unsorted input.
fn sanitize(chart: &mut SolChart) {
    let by_ms = |a: f64, b: f64| a.partial_cmp(&b).unwrap_or(std::cmp::Ordering::Equal);
    chart.timing.bpms.sort_by(|a, b| by_ms(a.ms, b.ms));
    chart.timing.svs.sort_by(|a, b| by_ms(a.ms, b.ms));
    chart.timing.stops.sort_by(|a, b| by_ms(a.ms, b.ms));
    chart
        .notes
        .sort_by(|a, b| by_ms(a.ms, b.ms).then(a.col.cmp(&b.col)));
}

fn validate(chart: &SolChart) -> Result<(), SolError> {
    let keys = chart.chart.keys;
    if !(1..=32).contains(&keys) {
        return Err(SolError::Invalid(format!("keys must be 1-32, got {keys}")));
    }
    if chart.timing.bpms.is_empty() {
        return Err(SolError::Invalid("timing.bpms must not be empty".into()));
    }
    for b in &chart.timing.bpms {
        if !b.bpm.is_finite() || b.bpm <= 0.0 {
            return Err(SolError::Invalid(format!(
                "invalid bpm {} at {}ms",
                b.bpm, b.ms
            )));
        }
    }
    for s in &chart.timing.stops {
        if !s.duration_ms.is_finite() || s.duration_ms < 0.0 {
            return Err(SolError::Invalid(format!(
                "invalid stop duration {} at {}ms",
                s.duration_ms, s.ms
            )));
        }
    }
    for n in &chart.notes {
        if n.col >= keys {
            return Err(SolError::Invalid(format!(
                "note at {}ms has col {} but chart has {} keys",
                n.ms, n.col, keys
            )));
        }
        if let Some(end) = n.end_ms {
            if end <= n.ms {
                return Err(SolError::Invalid(format!(
                    "hold at {}ms ends at {}ms (must be after its start)",
                    n.ms, end
                )));
            }
        }
    }
    Ok(())
}

/// Formats an f64 so it parses back to the same value ("{}" is shortest
/// round-trip in Rust) while staying a valid YAML number.
fn num(v: f64) -> String {
    if v.is_finite() {
        format!("{}", v)
    } else {
        "0".to_string()
    }
}

/// Always double-quotes strings so titles like `no: yes` or `1.5` can never
/// change type under a YAML parser.
fn quote(s: &str) -> String {
    let mut out = String::with_capacity(s.len() + 2);
    out.push('"');
    for c in s.chars() {
        match c {
            '"' => out.push_str("\\\""),
            '\\' => out.push_str("\\\\"),
            '\n' => out.push_str("\\n"),
            '\r' => out.push_str("\\r"),
            '\t' => out.push_str("\\t"),
            c if (c as u32) < 0x20 => {
                let _ = write!(out, "\\u{:04x}", c as u32);
            }
            c => out.push(c),
        }
    }
    out.push('"');
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::chart::*;

    fn sample_chart() -> SolChart {
        SolChart {
            sol: SOL_VERSION,
            meta: Meta {
                title: "Test Song".into(),
                artist: "Test Artist".into(),
                creator: "TestMapper".into(),
                difficulty: "Another".into(),
                source: "Game".into(),
                tags: "test song".into(),
            },
            files: Files {
                audio: "song.mp3".into(),
                background: Some("bg.jpg".into()),
                banner: None,
                cdtitle: None,
            },
            chart: ChartInfo {
                keys: 4,
                origin: Origin::OsuMania,
            },
            timing: Timing {
                offset_ms: -1000.0,
                preview_ms: 30000.0,
                lead_in_ms: 500.0,
                bpms: vec![
                    BpmChange {
                        ms: 1000.0,
                        bpm: 120.0,
                        meter: 4,
                    },
                    BpmChange {
                        ms: 5000.0,
                        bpm: 240.0,
                        meter: 4,
                    },
                ],
                svs: vec![SvChange {
                    ms: 3000.0,
                    mult: 0.5,
                }],
                stops: vec![StopEvent {
                    ms: 8000.0,
                    duration_ms: 250.0,
                }],
            },
            notes: vec![
                SolNote {
                    ms: 1500.0,
                    col: 0,
                    end_ms: None,
                },
                SolNote {
                    ms: 2000.0,
                    col: 1,
                    end_ms: Some(3500.0),
                },
            ],
        }
    }

    #[test]
    fn roundtrip_preserves_chart() {
        let chart = sample_chart();
        let yaml = write(&chart).unwrap();
        let reparsed = parse(&yaml).unwrap();
        assert_eq!(chart, reparsed);
    }

    #[test]
    fn parses_handwritten_yaml() {
        let yaml = r#"
sol: 1
meta:
  title: Freedom Dive
  artist: xi
  creator: someone
  difficulty: FOUR DIMENSIONS
timing:
  offset_ms: 0
  bpms:
    - {ms: 0, bpm: 222.22}
chart:
  keys: 4
notes:
  - {ms: 100, col: 3}
  - {ms: 50, col: 1, end_ms: 250}
"#;
        let chart = parse(yaml).unwrap();
        assert_eq!(chart.meta.title, "Freedom Dive");
        assert_eq!(chart.chart.keys, 4);
        assert_eq!(chart.timing.bpms.len(), 1);
        // notes get sorted by ms during parse
        assert_eq!(chart.notes[0].ms, 50.0);
        assert!(chart.notes[0].is_hold());
        assert_eq!(chart.notes[1].col, 3);
    }

    #[test]
    fn defaults_are_applied() {
        let yaml = r#"
sol: 1
chart: {keys: 7}
timing:
  bpms: [{ms: 0, bpm: 180}]
"#;
        let chart = parse(yaml).unwrap();
        assert_eq!(chart.meta.title, "");
        assert_eq!(chart.timing.offset_ms, 0.0);
        assert_eq!(chart.timing.bpms[0].meter, 4);
        assert_eq!(chart.chart.origin, Origin::Sol);
        assert!(chart.notes.is_empty());
    }

    #[test]
    fn rejects_future_version() {
        let yaml = "sol: 99\nchart: {keys: 4}\ntiming: {bpms: [{ms: 0, bpm: 120}]}\n";
        assert!(matches!(parse(yaml), Err(SolError::Version(99))));
    }

    #[test]
    fn rejects_invalid_charts() {
        // no bpms
        let yaml = "sol: 1\nchart: {keys: 4}\ntiming: {bpms: []}\n";
        assert!(parse(yaml).is_err());
        // column out of range
        let yaml = "sol: 1\nchart: {keys: 4}\ntiming: {bpms: [{ms: 0, bpm: 120}]}\nnotes: [{ms: 0, col: 4}]\n";
        assert!(parse(yaml).is_err());
        // hold ending before it starts
        let yaml = "sol: 1\nchart: {keys: 4}\ntiming: {bpms: [{ms: 0, bpm: 120}]}\nnotes: [{ms: 100, col: 0, end_ms: 50}]\n";
        assert!(parse(yaml).is_err());
        // zero bpm
        let yaml = "sol: 1\nchart: {keys: 4}\ntiming: {bpms: [{ms: 0, bpm: 0}]}\n";
        assert!(parse(yaml).is_err());
    }

    #[test]
    fn quoting_survives_hostile_metadata() {
        let mut chart = sample_chart();
        chart.meta.title = "no: yes \"quoted\" \\ back".into();
        chart.meta.artist = "line\nbreak\ttab".into();
        chart.meta.tags = "1.5".into();
        let yaml = write(&chart).unwrap();
        let reparsed = parse(&yaml).unwrap();
        assert_eq!(chart, reparsed);
    }

    #[test]
    fn empty_chart_roundtrips() {
        let chart = SolChart::new(4, 120.0, 0.0);
        let yaml = write(&chart).unwrap();
        let reparsed = parse(&yaml).unwrap();
        assert_eq!(chart, reparsed);
        assert_eq!(reparsed.duration_ms(), 0.0);
    }
}
