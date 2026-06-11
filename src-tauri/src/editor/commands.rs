//! Tauri commands exposed to the editor UI.
//!
//! Rust owns the canonical chart state (notes, timing, snap math); the UI
//! receives a [`ChartPayload`] after every mutation and only does
//! presentation-side pixel math with it.

use std::path::PathBuf;
use std::sync::Mutex;

use serde::Serialize;
use tauri::State;
use tauri_plugin_dialog::DialogExt;

use crate::editor::chart::EditorChart;
use crate::editor::state::{EditorState, HistoryEntry, TimingSnapshot};
use crate::editor::timing::TimingEvent;
use crate::formats::sol;
use crate::models::chart::{Files, Meta};

pub type SharedState = Mutex<EditorState>;

#[derive(Serialize)]
pub struct NotePayload {
    pub row: i32,
    pub end_row: i32,
    pub col: u32,
    pub ms: f64,
    pub end_ms: Option<f64>,
}

#[derive(Serialize)]
pub struct BpmPayload {
    pub row: i32,
    pub ms: f64,
    pub bpm: f64,
    pub meter: u32,
}

#[derive(Serialize)]
pub struct StopPayload {
    pub row: i32,
    pub ms: f64,
    pub duration_ms: f64,
}

#[derive(Serialize)]
pub struct ChartPayload {
    pub meta: Meta,
    pub files: Files,
    pub keys: u32,
    pub offset_ms: f64,
    pub preview_ms: f64,
    pub bpms: Vec<BpmPayload>,
    pub stops: Vec<StopPayload>,
    pub events: Vec<TimingEvent>,
    pub notes: Vec<NotePayload>,
    pub end_row: i32,
    pub dirty: bool,
    pub can_undo: bool,
    pub can_redo: bool,
    pub path: Option<String>,
    /// Absolute path of the audio file, resolved against the .sol location.
    pub audio_path: Option<String>,
}

fn payload(state: &EditorState) -> Result<ChartPayload, String> {
    let chart = state.chart.as_ref().ok_or("no chart open")?;
    let audio_path = resolve_audio(chart, state.path.as_deref());
    Ok(ChartPayload {
        meta: chart.meta.clone(),
        files: chart.files.clone(),
        keys: chart.keys,
        offset_ms: chart.offset_ms,
        preview_ms: chart.preview_ms,
        bpms: chart
            .bpms
            .iter()
            .map(|b| BpmPayload {
                row: b.row,
                ms: chart.row_to_time(b.row),
                bpm: b.bpm,
                meter: b.meter,
            })
            .collect(),
        stops: chart
            .stops
            .iter()
            .map(|s| StopPayload {
                row: s.row,
                ms: chart.row_to_time(s.row),
                duration_ms: s.duration_ms,
            })
            .collect(),
        events: chart.events().to_vec(),
        notes: chart
            .notes
            .iter()
            .map(|n| NotePayload {
                row: n.row,
                end_row: n.end_row,
                col: n.col,
                ms: chart.row_to_time(n.row),
                end_ms: n.is_hold().then(|| chart.row_to_time(n.end_row)),
            })
            .collect(),
        end_row: chart.end_row(),
        dirty: state.dirty,
        can_undo: state.can_undo(),
        can_redo: state.can_redo(),
        path: state
            .path
            .as_ref()
            .map(|p| p.to_string_lossy().into_owned()),
        audio_path,
    })
}

fn resolve_audio(chart: &EditorChart, sol_path: Option<&std::path::Path>) -> Option<String> {
    let audio = chart.files.audio.trim();
    if audio.is_empty() {
        return None;
    }
    let p = std::path::Path::new(audio);
    if p.is_absolute() {
        return Some(audio.to_string());
    }
    let dir = sol_path?.parent()?;
    Some(dir.join(p).to_string_lossy().into_owned())
}

// ================================================================================================
// Chart lifecycle.

#[tauri::command]
pub fn editor_new_chart(
    state: State<'_, SharedState>,
    keys: u32,
    bpm: f64,
    offset_ms: f64,
) -> Result<ChartPayload, String> {
    if !(1..=32).contains(&keys) {
        return Err(format!("keys must be 1-32, got {keys}"));
    }
    if !(bpm.is_finite() && bpm > 0.0) {
        return Err(format!("invalid bpm {bpm}"));
    }
    let mut s = state.lock().map_err(|e| e.to_string())?;
    s.open(EditorChart::new(keys, bpm, offset_ms), None);
    payload(&s)
}

#[tauri::command]
pub fn editor_open_sol(
    state: State<'_, SharedState>,
    path: String,
) -> Result<ChartPayload, String> {
    let content = std::fs::read_to_string(&path).map_err(|e| format!("read {path}: {e}"))?;
    let sol_chart = sol::parse(&content).map_err(|e| e.to_string())?;
    let chart = EditorChart::from_sol(&sol_chart);
    let mut s = state.lock().map_err(|e| e.to_string())?;
    s.open(chart, Some(PathBuf::from(path)));
    payload(&s)
}

#[tauri::command]
pub fn editor_save_sol(
    state: State<'_, SharedState>,
    path: Option<String>,
) -> Result<ChartPayload, String> {
    let mut s = state.lock().map_err(|e| e.to_string())?;
    let target = path
        .map(PathBuf::from)
        .or_else(|| s.path.clone())
        .ok_or("no save path: pass one or save-as first")?;
    let chart = s.chart.as_ref().ok_or("no chart open")?;
    let yaml = sol::write(&chart.to_sol()).map_err(|e| e.to_string())?;
    std::fs::write(&target, yaml).map_err(|e| format!("write {}: {e}", target.display()))?;
    s.path = Some(target);
    s.dirty = false;
    payload(&s)
}

#[tauri::command]
pub fn editor_get_chart(state: State<'_, SharedState>) -> Result<Option<ChartPayload>, String> {
    let s = state.lock().map_err(|e| e.to_string())?;
    if s.chart.is_none() {
        return Ok(None);
    }
    payload(&s).map(Some)
}

// ================================================================================================
// Note editing.

#[tauri::command]
pub fn editor_place_note(
    state: State<'_, SharedState>,
    row: i32,
    end_row: i32,
    col: u32,
) -> Result<ChartPayload, String> {
    let mut s = state.lock().map_err(|e| e.to_string())?;
    let chart = s.chart.as_mut().ok_or("no chart open")?;
    let (added, removed) = chart.place_note(row, end_row, col);
    s.push(HistoryEntry::Notes { added, removed });
    payload(&s)
}

#[tauri::command]
pub fn editor_remove_note(
    state: State<'_, SharedState>,
    row: i32,
    col: u32,
) -> Result<ChartPayload, String> {
    let mut s = state.lock().map_err(|e| e.to_string())?;
    let chart = s.chart.as_mut().ok_or("no chart open")?;
    let removed = chart.remove_note(row, col);
    s.push(HistoryEntry::Notes {
        added: Vec::new(),
        removed,
    });
    payload(&s)
}

#[tauri::command]
pub fn editor_undo(state: State<'_, SharedState>) -> Result<ChartPayload, String> {
    let mut s = state.lock().map_err(|e| e.to_string())?;
    s.undo();
    payload(&s)
}

#[tauri::command]
pub fn editor_redo(state: State<'_, SharedState>) -> Result<ChartPayload, String> {
    let mut s = state.lock().map_err(|e| e.to_string())?;
    s.redo();
    payload(&s)
}

// ================================================================================================
// Tempo editing.

fn timing_edit(
    state: &State<'_, SharedState>,
    f: impl FnOnce(&mut EditorChart),
) -> Result<ChartPayload, String> {
    let mut s = state.lock().map_err(|e| e.to_string())?;
    let chart = s.chart.as_mut().ok_or("no chart open")?;
    let before = TimingSnapshot::of(chart);
    f(chart);
    let after = TimingSnapshot::of(chart);
    if before != after {
        s.push(HistoryEntry::Timing { before, after });
    }
    payload(&s)
}

#[tauri::command]
pub fn editor_set_bpm(
    state: State<'_, SharedState>,
    row: i32,
    bpm: f64,
) -> Result<ChartPayload, String> {
    if !(bpm.is_finite() && bpm > 0.0) {
        return Err(format!("invalid bpm {bpm}"));
    }
    timing_edit(&state, |c| c.set_bpm(row, bpm))
}

#[tauri::command]
pub fn editor_remove_bpm(state: State<'_, SharedState>, row: i32) -> Result<ChartPayload, String> {
    timing_edit(&state, |c| {
        c.remove_bpm(row);
    })
}

#[tauri::command]
pub fn editor_set_stop(
    state: State<'_, SharedState>,
    row: i32,
    duration_ms: f64,
) -> Result<ChartPayload, String> {
    if !duration_ms.is_finite() || duration_ms < 0.0 {
        return Err(format!("invalid stop duration {duration_ms}"));
    }
    timing_edit(&state, |c| c.set_stop(row, duration_ms))
}

#[tauri::command]
pub fn editor_set_offset(
    state: State<'_, SharedState>,
    offset_ms: f64,
) -> Result<ChartPayload, String> {
    if !offset_ms.is_finite() {
        return Err("invalid offset".into());
    }
    timing_edit(&state, |c| c.set_offset(offset_ms))
}

// ================================================================================================
// Files and dialogs.

#[tauri::command]
pub fn editor_set_audio(
    state: State<'_, SharedState>,
    path: String,
) -> Result<ChartPayload, String> {
    let mut s = state.lock().map_err(|e| e.to_string())?;
    // Store relative to the .sol file when possible so the chart folder is
    // portable; fall back to the absolute path.
    let audio = match s.path.as_ref().and_then(|p| p.parent()) {
        Some(dir) => std::path::Path::new(&path)
            .strip_prefix(dir)
            .map(|rel| rel.to_string_lossy().replace('\\', "/"))
            .unwrap_or_else(|_| path.clone()),
        None => path.clone(),
    };
    let chart = s.chart.as_mut().ok_or("no chart open")?;
    chart.files.audio = audio;
    s.dirty = true;
    payload(&s)
}

/// Reads an audio file and returns raw bytes (an `ArrayBuffer` on the JS
/// side) for Web Audio decoding. Async so the read happens off the main
/// thread.
#[tauri::command]
pub async fn editor_read_audio(path: String) -> Result<tauri::ipc::Response, String> {
    let bytes = std::fs::read(&path).map_err(|e| format!("read {path}: {e}"))?;
    Ok(tauri::ipc::Response::new(bytes))
}

/// Opens a native file dialog. `kind` is one of `sol_open`, `sol_save`,
/// `audio`. Returns the picked path, or `None` if cancelled.
#[tauri::command]
pub async fn editor_pick_file(
    app: tauri::AppHandle,
    kind: String,
) -> Result<Option<String>, String> {
    let dialog = app.dialog().file();
    let picked = match kind.as_str() {
        "sol_open" => dialog
            .add_filter("Solstice chart", &["sol"])
            .blocking_pick_file()
            .map(|p| p.to_string()),
        "sol_save" => dialog
            .add_filter("Solstice chart", &["sol"])
            .blocking_save_file()
            .map(|p| p.to_string()),
        "audio" => dialog
            .add_filter("Audio", &["mp3", "ogg", "wav", "flac", "m4a"])
            .blocking_pick_file()
            .map(|p| p.to_string()),
        other => return Err(format!("unknown dialog kind {other}")),
    };
    Ok(picked)
}
