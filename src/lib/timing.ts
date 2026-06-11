// Presentation-side timing math. Rust owns the canonical conversions
// (src-tauri/src/editor/timing.rs); this mirrors the row<->time formulas so
// the canvas can do per-pixel math against the serialized TimingEvent list
// without a round-trip per frame.

import type { TimingEvent } from '../types/editor'

export const ROWS_PER_BEAT = 48
export const ROWS_PER_MEASURE = ROWS_PER_BEAT * 4

/** Snap resolutions as note divisions per 4/4 measure (ArrowVortex SnapType). */
export const SNAP_QUANTS = [4, 8, 12, 16, 24, 32, 48, 64, 96, 192] as const
export const SNAP_NAMES = [
  '4th',
  '8th',
  '12th',
  '16th',
  '24th',
  '32nd',
  '48th',
  '64th',
  '96th',
  '192nd',
] as const

/** Rows per snap step for a quant (e.g. quant 16 -> 12 rows). */
export function snapStep(quant: number): number {
  return quant > 0 && ROWS_PER_MEASURE % quant === 0 ? ROWS_PER_MEASURE / quant : 1
}

/** Nearest on-grid row for the given snap quant, clamped to be non-negative. */
export function snapRowClosest(row: number, quant: number): number {
  const step = snapStep(quant)
  return Math.max(0, Math.round(row / step) * step)
}

/** Index of the last event whose `row` is <= the given row. */
function eventAtRow(events: TimingEvent[], row: number): TimingEvent {
  let lo = 0
  let hi = events.length - 1
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1
    if (events[mid].row <= row) lo = mid
    else hi = mid - 1
  }
  return events[lo]
}

function eventAtTime(events: TimingEvent[], timeMs: number): TimingEvent {
  let lo = 0
  let hi = events.length - 1
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1
    if (events[mid].time_ms <= timeMs) lo = mid
    else hi = mid - 1
  }
  return events[lo]
}

/** Time at a (possibly fractional) row. */
export function rowToTime(events: TimingEvent[], row: number): number {
  const e = eventAtRow(events, row)
  return row > e.row ? e.end_time_ms + (row - e.row) * e.ms_per_row : e.time_ms
}

/** Float-precision row at a time (rows freeze during stops). */
export function timeToRowF(events: TimingEvent[], timeMs: number): number {
  const e = eventAtTime(events, timeMs)
  return timeMs > e.end_time_ms ? e.row + (timeMs - e.end_time_ms) / e.ms_per_row : e.row
}

/** BPM in effect at the given row. */
export function bpmAtRow(events: TimingEvent[], row: number): number {
  return 60000 / (eventAtRow(events, row).ms_per_row * ROWS_PER_BEAT)
}

// ================================================================================================
// Row colors (ArrowVortex ROW_TYPE_COLOR / ToRowType).

const ROW_TYPE_MODS = [48, 24, 16, 12, 8, 6, 4, 3]
const ROW_TYPE_COLORS = [
  '#ff0000', // 4th    red
  '#2976f5', // 8th    blue
  '#910cce', // 12th   purple
  '#ffff00', // 16th   yellow
  '#ce0c71', // 24th   pink
  '#f7941d', // 32nd   orange
  '#69e7f5', // 48th   teal
  '#00c600', // 64th   green
  '#848484', // 192nd  gray
]

/** Note color for the row's quantization, matching ArrowVortex/ITG. */
export function rowColor(row: number): string {
  const i = ((row % ROWS_PER_MEASURE) + ROWS_PER_MEASURE) % ROWS_PER_MEASURE
  for (let j = 0; j < ROW_TYPE_MODS.length; j++) {
    if (i % ROW_TYPE_MODS[j] === 0) return ROW_TYPE_COLORS[j]
  }
  return ROW_TYPE_COLORS[8]
}

export function formatTime(ms: number): string {
  const sign = ms < 0 ? '-' : ''
  const abs = Math.abs(ms)
  const m = Math.floor(abs / 60000)
  const s = Math.floor((abs % 60000) / 1000)
  const milli = Math.floor(abs % 1000)
  return `${sign}${m}:${String(s).padStart(2, '0')}.${String(milli).padStart(3, '0')}`
}
