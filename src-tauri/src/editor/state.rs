//! Editor session state: the open chart, its file path, and undo history.

use std::path::PathBuf;

use super::chart::{EditorBpm, EditorChart, EditorNote, EditorStop};

/// One undoable operation. Note edits store exact deltas (ArrowVortex
/// `NoteEdit`); tempo edits snapshot the timing fields, which are tiny.
#[derive(Debug, Clone)]
pub enum HistoryEntry {
    Notes {
        added: Vec<EditorNote>,
        removed: Vec<EditorNote>,
    },
    Timing {
        before: TimingSnapshot,
        after: TimingSnapshot,
    },
}

#[derive(Debug, Clone, PartialEq)]
pub struct TimingSnapshot {
    pub offset_ms: f64,
    pub bpms: Vec<EditorBpm>,
    pub stops: Vec<EditorStop>,
}

impl TimingSnapshot {
    pub fn of(chart: &EditorChart) -> Self {
        Self {
            offset_ms: chart.offset_ms,
            bpms: chart.bpms.clone(),
            stops: chart.stops.clone(),
        }
    }

    pub fn restore(&self, chart: &mut EditorChart) {
        chart.offset_ms = self.offset_ms;
        chart.bpms = self.bpms.clone();
        chart.stops = self.stops.clone();
        chart.rebuild_timing();
    }
}

const MAX_HISTORY: usize = 256;

#[derive(Default)]
pub struct EditorState {
    pub chart: Option<EditorChart>,
    pub path: Option<PathBuf>,
    pub dirty: bool,
    undo: Vec<HistoryEntry>,
    redo: Vec<HistoryEntry>,
}

impl EditorState {
    pub fn open(&mut self, chart: EditorChart, path: Option<PathBuf>) {
        self.chart = Some(chart);
        self.path = path;
        self.dirty = false;
        self.undo.clear();
        self.redo.clear();
    }

    /// Records an edit that has already been applied to the chart.
    pub fn push(&mut self, entry: HistoryEntry) {
        // No-op edits (e.g. clicking an empty cell off-grid) don't pollute
        // the history.
        if let HistoryEntry::Notes { added, removed } = &entry {
            if added.is_empty() && removed.is_empty() {
                return;
            }
        }
        self.undo.push(entry);
        if self.undo.len() > MAX_HISTORY {
            self.undo.remove(0);
        }
        self.redo.clear();
        self.dirty = true;
    }

    pub fn undo(&mut self) -> bool {
        let Some(chart) = self.chart.as_mut() else {
            return false;
        };
        let Some(entry) = self.undo.pop() else {
            return false;
        };
        match &entry {
            HistoryEntry::Notes { added, removed } => chart.apply_edit(removed, added),
            HistoryEntry::Timing { before, .. } => before.restore(chart),
        }
        self.redo.push(entry);
        self.dirty = true;
        true
    }

    pub fn redo(&mut self) -> bool {
        let Some(chart) = self.chart.as_mut() else {
            return false;
        };
        let Some(entry) = self.redo.pop() else {
            return false;
        };
        match &entry {
            HistoryEntry::Notes { added, removed } => chart.apply_edit(added, removed),
            HistoryEntry::Timing { after, .. } => after.restore(chart),
        }
        self.undo.push(entry);
        self.dirty = true;
        true
    }

    pub fn can_undo(&self) -> bool {
        !self.undo.is_empty()
    }

    pub fn can_redo(&self) -> bool {
        !self.redo.is_empty()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn note_undo_redo_cycle() {
        let mut state = EditorState::default();
        state.open(EditorChart::new(4, 120.0, 0.0), None);

        let chart = state.chart.as_mut().unwrap();
        let (added, removed) = chart.place_note(48, 48, 0);
        state.push(HistoryEntry::Notes { added, removed });
        assert!(state.dirty);

        let chart = state.chart.as_mut().unwrap();
        let (added, removed) = chart.place_note(0, 96, 0); // swallows the tap
        state.push(HistoryEntry::Notes { added, removed });
        assert_eq!(state.chart.as_ref().unwrap().notes.len(), 1);

        assert!(state.undo());
        assert_eq!(state.chart.as_ref().unwrap().notes.len(), 1);
        assert_eq!(state.chart.as_ref().unwrap().notes[0].row, 48);

        assert!(state.undo());
        assert!(state.chart.as_ref().unwrap().notes.is_empty());
        assert!(!state.undo());

        assert!(state.redo());
        assert!(state.redo());
        assert_eq!(state.chart.as_ref().unwrap().notes[0].end_row, 96);
        assert!(!state.redo());
    }

    #[test]
    fn timing_undo_restores_bpms() {
        let mut state = EditorState::default();
        state.open(EditorChart::new(4, 120.0, 0.0), None);

        let chart = state.chart.as_mut().unwrap();
        let before = TimingSnapshot::of(chart);
        chart.set_bpm(192, 240.0);
        let after = TimingSnapshot::of(chart);
        state.push(HistoryEntry::Timing { before, after });

        assert_eq!(state.chart.as_ref().unwrap().bpms.len(), 2);
        assert!(state.undo());
        assert_eq!(state.chart.as_ref().unwrap().bpms.len(), 1);
        assert!(state.redo());
        assert_eq!(state.chart.as_ref().unwrap().bpms.len(), 2);
    }

    #[test]
    fn new_edit_clears_redo() {
        let mut state = EditorState::default();
        state.open(EditorChart::new(4, 120.0, 0.0), None);

        let chart = state.chart.as_mut().unwrap();
        let (added, removed) = chart.place_note(0, 0, 0);
        state.push(HistoryEntry::Notes { added, removed });
        assert!(state.undo());
        assert!(state.can_redo());

        let chart = state.chart.as_mut().unwrap();
        let (added, removed) = chart.place_note(48, 48, 1);
        state.push(HistoryEntry::Notes { added, removed });
        assert!(!state.can_redo());
    }
}
