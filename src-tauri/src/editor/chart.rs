//! The editable, row-based representation of a chart.
//!
//! `.sol` stores times in milliseconds; the editor works on ArrowVortex's
//! 48-rows-per-beat grid. Loading quantizes ms to rows (the same way
//! ArrowVortex imports `.osu` files), saving re-derives ms from rows.

use serde::Serialize;

use crate::models::chart::{
    BpmChange, ChartInfo, Files, Meta, Origin, SolChart, SolNote, StopEvent, SvChange, SOL_VERSION,
};

use super::timing::{
    self, build_events, ms_per_row, row_to_time, time_to_row, BpmAtRow, StopAtRow, TimingEvent,
};

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize)]
pub struct EditorNote {
    pub row: i32,
    pub end_row: i32,
    pub col: u32,
}

impl EditorNote {
    pub fn is_hold(&self) -> bool {
        self.end_row > self.row
    }

    /// True if the note's [row, end_row] span touches the given span.
    pub fn intersects(&self, row: i32, end_row: i32) -> bool {
        self.end_row >= row && self.row <= end_row
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Serialize)]
pub struct EditorBpm {
    pub row: i32,
    pub bpm: f64,
    pub meter: u32,
}

#[derive(Debug, Clone, Copy, PartialEq, Serialize)]
pub struct EditorStop {
    pub row: i32,
    pub duration_ms: f64,
}

#[derive(Debug, Clone)]
pub struct EditorChart {
    pub meta: Meta,
    pub files: Files,
    pub keys: u32,
    pub origin: Origin,

    pub offset_ms: f64,
    pub preview_ms: f64,
    pub lead_in_ms: f64,
    pub bpms: Vec<EditorBpm>,
    pub stops: Vec<EditorStop>,
    /// osu! SV multipliers; carried through untouched (not editable in MVP).
    pub svs: Vec<SvChange>,

    /// Sorted by (row, col); at most one note per (row..end_row, col) span.
    pub notes: Vec<EditorNote>,

    events: Vec<TimingEvent>,
}

impl EditorChart {
    pub fn new(keys: u32, bpm: f64, offset_ms: f64) -> Self {
        let mut chart = Self {
            meta: Meta::default(),
            files: Files::default(),
            keys,
            origin: Origin::Sol,
            offset_ms,
            preview_ms: 0.0,
            lead_in_ms: 0.0,
            bpms: vec![EditorBpm {
                row: 0,
                bpm,
                meter: 4,
            }],
            stops: Vec::new(),
            svs: Vec::new(),
            notes: Vec::new(),
            events: Vec::new(),
        };
        chart.rebuild_timing();
        chart
    }

    pub fn events(&self) -> &[TimingEvent] {
        &self.events
    }

    pub fn rebuild_timing(&mut self) {
        self.bpms.sort_by_key(|b| b.row);
        self.bpms.dedup_by_key(|b| b.row);
        self.stops.sort_by_key(|s| s.row);
        let bpms: Vec<BpmAtRow> = self
            .bpms
            .iter()
            .map(|b| BpmAtRow {
                row: b.row,
                bpm: b.bpm,
            })
            .collect();
        let stops: Vec<StopAtRow> = self
            .stops
            .iter()
            .map(|s| StopAtRow {
                row: s.row,
                duration_ms: s.duration_ms,
            })
            .collect();
        self.events = build_events(self.offset_ms, &bpms, &stops);
    }

    pub fn row_to_time(&self, row: i32) -> f64 {
        row_to_time(&self.events, row)
    }

    pub fn time_to_row(&self, time_ms: f64) -> i32 {
        time_to_row(&self.events, time_ms)
    }

    /// Last row occupied by any note, rounded up to a whole measure (with a
    /// minimum of 4 measures so empty charts still show a grid).
    pub fn end_row(&self) -> i32 {
        let last = self.notes.iter().map(|n| n.end_row).max().unwrap_or(0);
        let measures = last / timing::ROWS_PER_MEASURE + 1;
        measures.max(4) * timing::ROWS_PER_MEASURE
    }

    // ============================================================================================
    // .sol conversion.

    /// Quantizes a ms-based `.sol` chart onto the row grid.
    ///
    /// Mirrors ArrowVortex's `.osu` import: BPM-change rows are accumulated
    /// in float precision and rounded once, then notes are mapped through the
    /// rebuilt timing. Stops pause time without advancing rows; `.sol`
    /// guarantees later ms values already include elapsed stop time.
    pub fn from_sol(sol: &SolChart) -> Self {
        // The grid is anchored at offset_ms, but never after the first BPM
        // change (rows are non-negative).
        let first_bpm_ms = sol.timing.bpms.first().map_or(0.0, |b| b.ms);
        let offset_ms = sol.timing.offset_ms.min(first_bpm_ms);

        #[derive(Clone, Copy)]
        enum Ev {
            Bpm(BpmChange),
            Stop(StopEvent),
        }
        let mut merged: Vec<Ev> = sol
            .timing
            .bpms
            .iter()
            .map(|b| Ev::Bpm(*b))
            .chain(sol.timing.stops.iter().map(|s| Ev::Stop(*s)))
            .collect();
        // Sort by time; on ties the BPM change applies before the stop.
        merged.sort_by(|a, b| {
            let (ams, ak) = match a {
                Ev::Bpm(x) => (x.ms, 0),
                Ev::Stop(x) => (x.ms, 1),
            };
            let (bms, bk) = match b {
                Ev::Bpm(x) => (x.ms, 0),
                Ev::Stop(x) => (x.ms, 1),
            };
            ams.partial_cmp(&bms)
                .unwrap_or(std::cmp::Ordering::Equal)
                .then(ak.cmp(&bk))
        });

        let mut bpms: Vec<EditorBpm> = Vec::with_capacity(sol.timing.bpms.len());
        let mut stops: Vec<EditorStop> = Vec::with_capacity(sol.timing.stops.len());

        // Before its own position, the first BPM extrapolates backwards
        // (Henkan's ms_to_beat convention).
        let mut spr = ms_per_row(sol.timing.bpms.first().map_or(120.0, |b| b.bpm));
        let mut row_f = 0.0f64;
        let mut time = offset_ms;

        for ev in &merged {
            let ev_ms = match ev {
                Ev::Bpm(b) => b.ms,
                Ev::Stop(s) => s.ms,
            };
            row_f += (ev_ms - time) / spr;
            let row = row_f.round().max(0.0) as i32;
            match ev {
                Ev::Bpm(b) => {
                    spr = ms_per_row(b.bpm);
                    bpms.push(EditorBpm {
                        row,
                        bpm: b.bpm,
                        meter: b.meter,
                    });
                    time = ev_ms;
                }
                Ev::Stop(s) => {
                    stops.push(EditorStop {
                        row,
                        duration_ms: s.duration_ms,
                    });
                    // Time passes during the stop; the row does not move.
                    time = ev_ms + s.duration_ms;
                }
            }
        }

        // The grid before the first BPM change runs at the same tempo.
        if bpms.first().map_or(true, |b| b.row > 0) {
            let first = bpms.first().copied().unwrap_or(EditorBpm {
                row: 0,
                bpm: 120.0,
                meter: 4,
            });
            bpms.insert(0, EditorBpm { row: 0, ..first });
        }

        let mut chart = Self {
            meta: sol.meta.clone(),
            files: sol.files.clone(),
            keys: sol.chart.keys,
            origin: sol.chart.origin,
            offset_ms,
            preview_ms: sol.timing.preview_ms,
            lead_in_ms: sol.timing.lead_in_ms,
            bpms,
            stops,
            svs: sol.timing.svs.clone(),
            notes: Vec::new(),
            events: Vec::new(),
        };
        chart.rebuild_timing();

        chart.notes = sol
            .notes
            .iter()
            .map(|n| {
                let row = chart.time_to_row(n.ms);
                let end_row = match n.end_ms {
                    Some(end) => chart.time_to_row(end).max(row),
                    None => row,
                };
                EditorNote {
                    row,
                    end_row,
                    col: n.col,
                }
            })
            .collect();
        chart.sort_notes();
        chart
    }

    pub fn to_sol(&self) -> SolChart {
        SolChart {
            sol: SOL_VERSION,
            meta: self.meta.clone(),
            files: self.files.clone(),
            chart: ChartInfo {
                keys: self.keys,
                origin: self.origin,
            },
            timing: crate::models::chart::Timing {
                offset_ms: self.offset_ms,
                preview_ms: self.preview_ms,
                lead_in_ms: self.lead_in_ms,
                bpms: self
                    .bpms
                    .iter()
                    .map(|b| BpmChange {
                        ms: self.row_to_time(b.row),
                        bpm: b.bpm,
                        meter: b.meter,
                    })
                    .collect(),
                svs: self.svs.clone(),
                stops: self
                    .stops
                    .iter()
                    .map(|s| StopEvent {
                        ms: self.row_to_time(s.row),
                        duration_ms: s.duration_ms,
                    })
                    .collect(),
            },
            notes: self
                .notes
                .iter()
                .map(|n| SolNote {
                    ms: self.row_to_time(n.row),
                    col: n.col,
                    end_ms: n.is_hold().then(|| self.row_to_time(n.end_row)),
                })
                .collect(),
        }
    }

    // ============================================================================================
    // Note editing (ArrowVortex `NoteEdit` semantics).

    fn sort_notes(&mut self) {
        self.notes.sort();
        self.notes.dedup();
    }

    /// Places a note, overwriting anything it intersects in the same column.
    ///
    /// Returns `(added, removed)`. Placing a note identical to an existing
    /// one acts as a toggle and removes it instead.
    pub fn place_note(
        &mut self,
        row: i32,
        end_row: i32,
        col: u32,
    ) -> (Vec<EditorNote>, Vec<EditorNote>) {
        let row = row.max(0);
        let end_row = end_row.max(row);
        if col >= self.keys {
            return (Vec::new(), Vec::new());
        }
        let note = EditorNote { row, end_row, col };

        let removed: Vec<EditorNote> = self
            .notes
            .iter()
            .copied()
            .filter(|n| n.col == col && n.intersects(row, end_row))
            .collect();
        self.notes
            .retain(|n| !(n.col == col && n.intersects(row, end_row)));

        if removed.len() == 1 && removed[0] == note {
            return (Vec::new(), removed); // toggle off
        }

        self.notes.push(note);
        self.sort_notes();
        (vec![note], removed)
    }

    /// Removes the note whose span contains `row` in the given column.
    pub fn remove_note(&mut self, row: i32, col: u32) -> Vec<EditorNote> {
        let removed: Vec<EditorNote> = self
            .notes
            .iter()
            .copied()
            .filter(|n| n.col == col && n.intersects(row, row))
            .collect();
        self.notes
            .retain(|n| !(n.col == col && n.intersects(row, row)));
        removed
    }

    /// Applies a raw edit (used by undo/redo).
    pub fn apply_edit(&mut self, add: &[EditorNote], remove: &[EditorNote]) {
        self.notes.retain(|n| !remove.contains(n));
        self.notes.extend_from_slice(add);
        self.sort_notes();
    }

    // ============================================================================================
    // Tempo editing.

    /// Inserts or replaces the BPM change at the given row.
    pub fn set_bpm(&mut self, row: i32, bpm: f64) {
        let row = row.max(0);
        match self.bpms.iter_mut().find(|b| b.row == row) {
            Some(b) => b.bpm = bpm,
            None => self.bpms.push(EditorBpm { row, bpm, meter: 4 }),
        }
        self.rebuild_timing();
    }

    /// Removes the BPM change at the given row. The change at row 0 cannot be
    /// removed (the chart always needs a tempo).
    pub fn remove_bpm(&mut self, row: i32) -> bool {
        if row <= 0 {
            return false;
        }
        let before = self.bpms.len();
        self.bpms.retain(|b| b.row != row);
        let changed = self.bpms.len() != before;
        if changed {
            self.rebuild_timing();
        }
        changed
    }

    /// Inserts/replaces a stop; a duration of 0 removes it.
    pub fn set_stop(&mut self, row: i32, duration_ms: f64) {
        let row = row.max(0);
        self.stops.retain(|s| s.row != row);
        if duration_ms > 0.0 {
            self.stops.push(EditorStop { row, duration_ms });
        }
        self.rebuild_timing();
    }

    pub fn set_offset(&mut self, offset_ms: f64) {
        self.offset_ms = offset_ms;
        self.rebuild_timing();
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::formats::sol;

    fn sol_fixture() -> SolChart {
        sol::parse(
            r#"
sol: 1
meta: {title: "T", artist: "A", creator: "C", difficulty: "D"}
files: {audio: "song.mp3"}
chart: {keys: 4, origin: osu_mania}
timing:
  offset_ms: 0
  bpms:
    - {ms: 0, bpm: 120}
    - {ms: 4000, bpm: 150}
  stops:
    - {ms: 2000, duration_ms: 250}
notes:
  - {ms: 0, col: 0}
  - {ms: 500, col: 1}
  - {ms: 2000, col: 2, end_ms: 3250}
  - {ms: 4400, col: 3}
"#,
        )
        .unwrap()
    }

    #[test]
    fn from_sol_quantizes_to_rows() {
        let chart = EditorChart::from_sol(&sol_fixture());
        // 120 BPM → 500ms per beat; stop at beat 4 (row 192) for 250ms.
        assert_eq!(
            chart.bpms[0],
            EditorBpm {
                row: 0,
                bpm: 120.0,
                meter: 4
            }
        );
        assert_eq!(chart.stops[0].row, 192);
        // The 150 BPM change at 4000ms: 2000ms of 120bpm (rows 0-192), 250ms
        // stop, then 1750ms at 120bpm = 168 rows → row 360.
        assert_eq!(chart.bpms[1].row, 360);

        assert_eq!(
            chart.notes[0],
            EditorNote {
                row: 0,
                end_row: 0,
                col: 0
            }
        );
        assert_eq!(
            chart.notes[1],
            EditorNote {
                row: 48,
                end_row: 48,
                col: 1
            }
        );
        // Hold starts on the stop row, ends 1000ms (after stop) later = 96 rows.
        assert_eq!(
            chart.notes[2],
            EditorNote {
                row: 192,
                end_row: 288,
                col: 2
            }
        );
        // Note at 4400ms: 400ms past the 150bpm change = 1 beat = 48 rows.
        assert_eq!(
            chart.notes[3],
            EditorNote {
                row: 408,
                end_row: 408,
                col: 3
            }
        );
    }

    #[test]
    fn sol_roundtrip_is_stable() {
        let original = sol_fixture();
        let chart = EditorChart::from_sol(&original);
        let saved = chart.to_sol();

        assert_eq!(saved.meta, original.meta);
        assert_eq!(saved.chart, original.chart);
        assert_eq!(saved.notes.len(), original.notes.len());
        for (a, b) in saved.notes.iter().zip(original.notes.iter()) {
            assert!((a.ms - b.ms).abs() < 1.0, "{} vs {}", a.ms, b.ms);
            assert_eq!(a.col, b.col);
            match (a.end_ms, b.end_ms) {
                (Some(x), Some(y)) => assert!((x - y).abs() < 1.0),
                (None, None) => {}
                _ => panic!("hold/tap mismatch"),
            }
        }
        for (a, b) in saved.timing.bpms.iter().zip(original.timing.bpms.iter()) {
            assert!((a.ms - b.ms).abs() < 1.0);
            assert_eq!(a.bpm, b.bpm);
        }
        assert_eq!(saved.timing.stops.len(), 1);
        assert!((saved.timing.stops[0].ms - 2000.0).abs() < 1.0);

        // A second pass must be byte-identical (fully converged).
        let chart2 = EditorChart::from_sol(&saved);
        let saved2 = chart2.to_sol();
        assert_eq!(saved, saved2);
    }

    #[test]
    fn notes_before_first_bpm_get_grid() {
        // Henkan's "Haunted" case: first timing point after the first notes.
        let sol = sol::parse(
            r#"
sol: 1
chart: {keys: 4}
timing:
  offset_ms: -802
  bpms:
    - {ms: 752, bpm: 154.4}
notes:
  - {ms: 169, col: 0}
  - {ms: 751, col: 3}
"#,
        )
        .unwrap();
        let chart = EditorChart::from_sol(&sol);
        // A backfilled BPM exists at row 0 and rows are non-negative.
        assert_eq!(chart.bpms[0].row, 0);
        assert!((chart.bpms[0].bpm - 154.4).abs() < 1e-9);
        assert!(chart.notes.iter().all(|n| n.row >= 0));
        // 169ms is 971ms after offset; at 154.4bpm a beat is ~388.6ms,
        // so the note sits ~2.5 beats in → row 120.
        assert_eq!(chart.notes[0].row, 120);
    }

    #[test]
    fn place_note_overwrites_and_toggles() {
        let mut chart = EditorChart::new(4, 120.0, 0.0);

        let (added, removed) = chart.place_note(48, 48, 0);
        assert_eq!(added.len(), 1);
        assert!(removed.is_empty());

        // Placing the same note again toggles it off.
        let (added, removed) = chart.place_note(48, 48, 0);
        assert!(added.is_empty());
        assert_eq!(removed.len(), 1);
        assert!(chart.notes.is_empty());

        // A hold over taps swallows them.
        chart.place_note(48, 48, 0);
        chart.place_note(96, 96, 0);
        let (added, removed) = chart.place_note(0, 192, 0);
        assert_eq!(
            added[0],
            EditorNote {
                row: 0,
                end_row: 192,
                col: 0
            }
        );
        assert_eq!(removed.len(), 2);
        assert_eq!(chart.notes.len(), 1);

        // Other columns are unaffected.
        chart.place_note(48, 48, 1);
        assert_eq!(chart.notes.len(), 2);
    }

    #[test]
    fn remove_note_hits_hold_bodies() {
        let mut chart = EditorChart::new(4, 120.0, 0.0);
        chart.place_note(48, 192, 2);
        // Clicking in the middle of the hold removes it.
        let removed = chart.remove_note(100, 2);
        assert_eq!(removed.len(), 1);
        assert!(chart.notes.is_empty());
    }

    #[test]
    fn undo_data_restores_state() {
        let mut chart = EditorChart::new(4, 120.0, 0.0);
        chart.place_note(48, 48, 0);
        let (added, removed) = chart.place_note(0, 192, 0);
        // Undo: remove what was added, add back what was removed.
        chart.apply_edit(&removed, &added);
        assert_eq!(
            chart.notes,
            vec![EditorNote {
                row: 48,
                end_row: 48,
                col: 0
            }]
        );
    }

    #[test]
    fn bpm_edits_rebuild_timing() {
        let mut chart = EditorChart::new(4, 120.0, 0.0);
        assert!((chart.row_to_time(192) - 2000.0).abs() < 1e-9);
        chart.set_bpm(192, 240.0);
        assert!((chart.row_to_time(240) - 2250.0).abs() < 1e-9);
        assert!(chart.remove_bpm(192));
        assert!((chart.row_to_time(240) - 2500.0).abs() < 1e-9);
        // Row 0 BPM is protected.
        assert!(!chart.remove_bpm(0));
        chart.set_offset(-100.0);
        assert!((chart.row_to_time(0) - (-100.0)).abs() < 1e-9);
    }
}
