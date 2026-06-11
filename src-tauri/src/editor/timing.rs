//! Row-based timing engine, ported from ArrowVortex's `TimingData`.
//!
//! Charts are edited on a fixed grid of 48 rows per beat (192 per 4/4
//! measure, StepMania's maximum resolution). BPM changes and stops live on
//! grid rows; this module flattens them into a list of [`TimingEvent`]s that
//! makes row↔time conversion a binary search plus linear interpolation.

use serde::Serialize;

pub const ROWS_PER_BEAT: i32 = 48;
pub const ROWS_PER_MEASURE: i32 = ROWS_PER_BEAT * 4;

/// Milliseconds per row at the given BPM.
pub fn ms_per_row(bpm: f64) -> f64 {
    60_000.0 / (bpm * ROWS_PER_BEAT as f64)
}

/// One span of constant tempo. Mirrors ArrowVortex's `TimingData::Event`:
/// `time_ms` is when the row is reached, `end_time_ms` is when scrolling
/// resumes (after any stop at this row), and `ms_per_row` applies from
/// `end_time_ms` until the next event.
#[derive(Debug, Clone, Copy, PartialEq, Serialize)]
pub struct TimingEvent {
    pub row: i32,
    pub time_ms: f64,
    pub end_time_ms: f64,
    pub ms_per_row: f64,
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct BpmAtRow {
    pub row: i32,
    pub bpm: f64,
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct StopAtRow {
    pub row: i32,
    pub duration_ms: f64,
}

/// Flattens BPM changes and stops into timing events.
///
/// `bpms` must be sorted by row and contain an entry at row 0 (callers ensure
/// this; [`crate::editor::chart::EditorChart`] sanitizes on load). `offset_ms`
/// is the time of row 0.
pub fn build_events(offset_ms: f64, bpms: &[BpmAtRow], stops: &[StopAtRow]) -> Vec<TimingEvent> {
    let mut events: Vec<TimingEvent> = Vec::with_capacity(bpms.len() + stops.len());

    let mut bi = 0usize;
    let mut si = 0usize;
    let mut time = offset_ms;
    let mut spr = ms_per_row(if bpms.is_empty() { 120.0 } else { bpms[0].bpm });
    let mut prev_row = 0i32;

    while bi < bpms.len() || si < stops.len() {
        let next_bpm_row = bpms.get(bi).map_or(i32::MAX, |b| b.row);
        let next_stop_row = stops.get(si).map_or(i32::MAX, |s| s.row);
        let row = next_bpm_row.min(next_stop_row);

        // Advance time to this row using the tempo in effect before it.
        time += (row - prev_row) as f64 * spr;

        // Apply every segment that sits on this row: the BPM change takes
        // effect at the row, the stop pauses scrolling after it.
        let mut stop_ms = 0.0;
        if next_bpm_row == row {
            spr = ms_per_row(bpms[bi].bpm);
            bi += 1;
        }
        if next_stop_row == row {
            stop_ms = stops[si].duration_ms;
            si += 1;
        }

        events.push(TimingEvent {
            row,
            time_ms: time,
            end_time_ms: time + stop_ms,
            ms_per_row: spr,
        });

        time += stop_ms;
        prev_row = row;
    }

    if events.is_empty() || events[0].row > 0 {
        events.insert(
            0,
            TimingEvent {
                row: 0,
                time_ms: offset_ms,
                end_time_ms: offset_ms,
                ms_per_row: spr,
            },
        );
    }

    events
}

fn event_at_row(events: &[TimingEvent], row: i32) -> &TimingEvent {
    let idx = events.partition_point(|e| e.row <= row);
    &events[idx.saturating_sub(1)]
}

fn event_at_time(events: &[TimingEvent], time_ms: f64) -> &TimingEvent {
    let idx = events.partition_point(|e| e.time_ms <= time_ms);
    &events[idx.saturating_sub(1)]
}

pub fn row_to_time(events: &[TimingEvent], row: i32) -> f64 {
    let e = event_at_row(events, row);
    if row > e.row {
        e.end_time_ms + (row - e.row) as f64 * e.ms_per_row
    } else {
        e.time_ms
    }
}

pub fn time_to_row(events: &[TimingEvent], time_ms: f64) -> i32 {
    let e = event_at_time(events, time_ms);
    if time_ms > e.end_time_ms {
        e.row + ((time_ms - e.end_time_ms) / e.ms_per_row).round() as i32
    } else {
        e.row
    }
}

/// Float-precision row position (for smooth scrolling in the UI).
pub fn time_to_row_f(events: &[TimingEvent], time_ms: f64) -> f64 {
    let e = event_at_time(events, time_ms);
    if time_ms > e.end_time_ms {
        e.row as f64 + (time_ms - e.end_time_ms) / e.ms_per_row
    } else {
        e.row as f64
    }
}

pub fn time_to_beat(events: &[TimingEvent], time_ms: f64) -> f64 {
    time_to_row_f(events, time_ms) / ROWS_PER_BEAT as f64
}

// ================================================================================================
// Snapping.

/// Snap resolutions, expressed as note divisions per 4/4 measure.
/// 4 = quarter notes ... 192 = the full grid. (ArrowVortex `SnapType`.)
pub const SNAP_QUANTS: [i32; 10] = [4, 8, 12, 16, 24, 32, 48, 64, 96, 192];

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SnapDir {
    /// Snap to the previous position (jumps even when already aligned).
    Prev,
    /// Snap to the next position (jumps even when already aligned).
    Next,
    /// Snap to the closest position (no-op when already aligned).
    Closest,
}

/// Rows per snap step for a quant (e.g. quant 4 → 48 rows).
/// Quants that do not divide 192 fall back to the full grid.
pub fn snap_step(quant: i32) -> i32 {
    if quant > 0 && ROWS_PER_MEASURE % quant == 0 {
        ROWS_PER_MEASURE / quant
    } else {
        1
    }
}

/// ArrowVortex `View::snapRow`. Rows are clamped to be non-negative.
pub fn snap_row(row: i32, quant: i32, dir: SnapDir) -> i32 {
    let step = snap_step(quant);
    let snapped = match dir {
        SnapDir::Closest => {
            if row.rem_euclid(step) == 0 {
                row
            } else {
                let prev = snap_row(row, quant, SnapDir::Prev);
                let next = snap_row(row, quant, SnapDir::Next);
                if row - prev < next - row {
                    prev
                } else {
                    next
                }
            }
        }
        // Bump by one first so an aligned row jumps to the adjacent position.
        SnapDir::Prev => {
            let r = row - 1;
            r - r.rem_euclid(step)
        }
        SnapDir::Next => {
            let r = row + 1;
            let rem = r.rem_euclid(step);
            if rem == 0 {
                r
            } else {
                r + step - rem
            }
        }
    };
    snapped.max(0)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn constant_bpm_conversion() {
        // 120 BPM → 500ms per beat → 500/48 ms per row.
        let events = build_events(0.0, &[BpmAtRow { row: 0, bpm: 120.0 }], &[]);
        assert_eq!(events.len(), 1);
        assert_eq!(row_to_time(&events, 0), 0.0);
        assert!((row_to_time(&events, 48) - 500.0).abs() < 1e-9);
        assert!((row_to_time(&events, 192) - 2000.0).abs() < 1e-9);
        assert_eq!(time_to_row(&events, 500.0), 48);
        assert_eq!(time_to_row(&events, 2000.0), 192);
        assert!((time_to_beat(&events, 250.0) - 0.5).abs() < 1e-9);
    }

    #[test]
    fn offset_shifts_grid() {
        let events = build_events(-802.0, &[BpmAtRow { row: 0, bpm: 120.0 }], &[]);
        assert_eq!(row_to_time(&events, 0), -802.0);
        assert!((row_to_time(&events, 48) - (-302.0)).abs() < 1e-9);
        assert_eq!(time_to_row(&events, -802.0), 0);
    }

    #[test]
    fn bpm_change_mid_chart() {
        // 120 BPM for 4 beats (2000ms), then 240 BPM.
        let events = build_events(
            0.0,
            &[
                BpmAtRow { row: 0, bpm: 120.0 },
                BpmAtRow {
                    row: 192,
                    bpm: 240.0,
                },
            ],
            &[],
        );
        assert_eq!(events.len(), 2);
        assert!((events[1].time_ms - 2000.0).abs() < 1e-9);
        // After the change, a beat lasts 250ms.
        assert!((row_to_time(&events, 240) - 2250.0).abs() < 1e-9);
        assert_eq!(time_to_row(&events, 2250.0), 240);
    }

    #[test]
    fn stops_pause_rows() {
        // 120 BPM with a 250ms stop at beat 1 (row 48).
        let events = build_events(
            0.0,
            &[BpmAtRow { row: 0, bpm: 120.0 }],
            &[StopAtRow {
                row: 48,
                duration_ms: 250.0,
            }],
        );
        // The stopped row itself sounds at 500ms...
        assert!((row_to_time(&events, 48) - 500.0).abs() < 1e-9);
        // ...but the next beat happens 250ms late.
        assert!((row_to_time(&events, 96) - 1250.0).abs() < 1e-9);
        // Any time inside the stop maps to the stopped row.
        assert_eq!(time_to_row(&events, 600.0), 48);
        assert_eq!(time_to_row(&events, 749.0), 48);
        assert_eq!(time_to_row(&events, 1250.0), 96);
    }

    #[test]
    fn bpm_and_stop_on_same_row() {
        let events = build_events(
            0.0,
            &[
                BpmAtRow { row: 0, bpm: 120.0 },
                BpmAtRow { row: 48, bpm: 60.0 },
            ],
            &[StopAtRow {
                row: 48,
                duration_ms: 100.0,
            }],
        );
        assert_eq!(events.len(), 2);
        // New tempo (1000ms/beat) applies after the stop.
        assert!((row_to_time(&events, 96) - 1600.0).abs() < 1e-9);
    }

    #[test]
    fn snapping_matches_arrowvortex() {
        // 16ths → step of 12 rows.
        assert_eq!(snap_step(16), 12);
        assert_eq!(snap_row(0, 16, SnapDir::Next), 12);
        assert_eq!(snap_row(12, 16, SnapDir::Prev), 0);
        assert_eq!(snap_row(13, 16, SnapDir::Prev), 12);
        assert_eq!(snap_row(13, 16, SnapDir::Next), 24);
        assert_eq!(snap_row(13, 16, SnapDir::Closest), 12);
        assert_eq!(snap_row(19, 16, SnapDir::Closest), 24);
        // Aligned + closest stays put.
        assert_eq!(snap_row(24, 16, SnapDir::Closest), 24);
        // Clamped at zero.
        assert_eq!(snap_row(0, 4, SnapDir::Prev), 0);
    }

    #[test]
    fn snap_roundtrip_all_quants() {
        for &q in &SNAP_QUANTS {
            let step = snap_step(q);
            assert_eq!(ROWS_PER_MEASURE % step, 0);
            for row in [0, 1, step - 1, step, step + 1, 191, 192, 1000] {
                let s = snap_row(row, q, SnapDir::Closest);
                assert_eq!(s.rem_euclid(step), 0, "quant {q} row {row}");
            }
        }
    }
}
