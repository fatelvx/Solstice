//! Universal chart model backing the `.sol` format.
//!
//! All times are milliseconds from the start of the audio file, matching
//! Henkan's internal `Beatmap` model. See `docs/sol-format.md` for the
//! on-disk schema and the osu!mania / SM field mappings.

use serde::{Deserialize, Serialize};

pub const SOL_VERSION: u32 = 1;

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct SolChart {
    pub sol: u32,
    #[serde(default)]
    pub meta: Meta,
    #[serde(default)]
    pub files: Files,
    pub chart: ChartInfo,
    pub timing: Timing,
    #[serde(default)]
    pub notes: Vec<SolNote>,
}

#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
pub struct Meta {
    #[serde(default)]
    pub title: String,
    #[serde(default)]
    pub artist: String,
    #[serde(default)]
    pub creator: String,
    #[serde(default)]
    pub difficulty: String,
    #[serde(default)]
    pub source: String,
    #[serde(default)]
    pub tags: String,
}

#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
pub struct Files {
    #[serde(default)]
    pub audio: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub background: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub banner: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub cdtitle: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ChartInfo {
    pub keys: u32,
    #[serde(default)]
    pub origin: Origin,
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Origin {
    OsuMania,
    Etterna,
    #[default]
    Sol,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Timing {
    /// Time at which beat 0 of the global beat grid occurs (SM: -OFFSET*1000).
    #[serde(default)]
    pub offset_ms: f64,
    #[serde(default)]
    pub preview_ms: f64,
    #[serde(default)]
    pub lead_in_ms: f64,
    pub bpms: Vec<BpmChange>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub svs: Vec<SvChange>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub stops: Vec<StopEvent>,
}

#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
pub struct BpmChange {
    pub ms: f64,
    pub bpm: f64,
    #[serde(default = "default_meter")]
    pub meter: u32,
}

fn default_meter() -> u32 {
    4
}

#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
pub struct SvChange {
    pub ms: f64,
    pub mult: f64,
}

#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
pub struct StopEvent {
    pub ms: f64,
    pub duration_ms: f64,
}

#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
pub struct SolNote {
    pub ms: f64,
    pub col: u32,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub end_ms: Option<f64>,
}

impl SolNote {
    pub fn is_hold(&self) -> bool {
        self.end_ms.is_some()
    }
}

impl SolChart {
    /// A minimal valid chart: one BPM change, no notes.
    pub fn new(keys: u32, bpm: f64, offset_ms: f64) -> Self {
        Self {
            sol: SOL_VERSION,
            meta: Meta::default(),
            files: Files::default(),
            chart: ChartInfo {
                keys,
                origin: Origin::Sol,
            },
            timing: Timing {
                offset_ms,
                preview_ms: 0.0,
                lead_in_ms: 0.0,
                bpms: vec![BpmChange {
                    ms: offset_ms,
                    bpm,
                    meter: 4,
                }],
                svs: Vec::new(),
                stops: Vec::new(),
            },
            notes: Vec::new(),
        }
    }

    /// Chart duration in ms (Henkan `compute_duration` semantics).
    pub fn duration_ms(&self) -> f64 {
        self.notes
            .iter()
            .map(|n| n.end_ms.unwrap_or(n.ms))
            .fold(0.0, f64::max)
    }
}
