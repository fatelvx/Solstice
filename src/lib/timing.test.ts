// The canvas does per-pixel math with these mirrors of the Rust timing
// engine (src-tauri/src/editor/timing.rs). The fixtures and expected values
// below match the Rust unit tests, so a divergence between the two sides
// fails here.

import { describe, expect, it } from 'vitest'

import type { TimingEvent } from '../types/editor'
import {
  ROWS_PER_BEAT,
  ROWS_PER_MEASURE,
  SNAP_QUANTS,
  bpmAtRow,
  formatTime,
  rowColor,
  rowToTime,
  snapRowClosest,
  snapStep,
  timeToRowF,
} from './timing'

/** ms per row at the given BPM (Rust `ms_per_row`). */
const mpr = (bpm: number) => 60000 / (bpm * ROWS_PER_BEAT)

const constant120: TimingEvent[] = [
  { row: 0, time_ms: 0, end_time_ms: 0, ms_per_row: mpr(120) },
]

describe('rowToTime / timeToRowF', () => {
  it('converts at a constant BPM', () => {
    // 120 BPM -> 500ms per beat.
    expect(rowToTime(constant120, 0)).toBe(0)
    expect(rowToTime(constant120, 48)).toBeCloseTo(500, 9)
    expect(rowToTime(constant120, 192)).toBeCloseTo(2000, 9)
    expect(timeToRowF(constant120, 500)).toBeCloseTo(48, 9)
    expect(timeToRowF(constant120, 250)).toBeCloseTo(24, 9)
  })

  it('respects a negative offset', () => {
    const events: TimingEvent[] = [
      { row: 0, time_ms: -802, end_time_ms: -802, ms_per_row: mpr(120) },
    ]
    expect(rowToTime(events, 0)).toBe(-802)
    expect(rowToTime(events, 48)).toBeCloseTo(-302, 9)
    expect(timeToRowF(events, -802)).toBeCloseTo(0, 9)
  })

  it('handles a BPM change mid-chart', () => {
    // 120 BPM for 4 beats (2000ms), then 240 BPM.
    const events: TimingEvent[] = [
      { row: 0, time_ms: 0, end_time_ms: 0, ms_per_row: mpr(120) },
      { row: 192, time_ms: 2000, end_time_ms: 2000, ms_per_row: mpr(240) },
    ]
    expect(rowToTime(events, 240)).toBeCloseTo(2250, 9)
    expect(timeToRowF(events, 2250)).toBeCloseTo(240, 9)
  })

  it('freezes rows during stops', () => {
    // 120 BPM with a 250ms stop at beat 1 (row 48).
    const events: TimingEvent[] = [
      { row: 0, time_ms: 0, end_time_ms: 0, ms_per_row: mpr(120) },
      { row: 48, time_ms: 500, end_time_ms: 750, ms_per_row: mpr(120) },
    ]
    // The stopped row itself sounds at 500ms...
    expect(rowToTime(events, 48)).toBeCloseTo(500, 9)
    // ...the next beat happens 250ms late...
    expect(rowToTime(events, 96)).toBeCloseTo(1250, 9)
    // ...and any time inside the stop maps to the stopped row.
    expect(timeToRowF(events, 600)).toBe(48)
    expect(timeToRowF(events, 749)).toBe(48)
    expect(timeToRowF(events, 1250)).toBeCloseTo(96, 9)
  })

  it('reports the BPM in effect at a row', () => {
    const events: TimingEvent[] = [
      { row: 0, time_ms: 0, end_time_ms: 0, ms_per_row: mpr(120) },
      { row: 192, time_ms: 2000, end_time_ms: 2000, ms_per_row: mpr(150) },
    ]
    expect(bpmAtRow(events, 0)).toBeCloseTo(120, 9)
    expect(bpmAtRow(events, 191)).toBeCloseTo(120, 9)
    expect(bpmAtRow(events, 192)).toBeCloseTo(150, 9)
  })
})

describe('snapping', () => {
  it('matches ArrowVortex steps', () => {
    // 16ths -> step of 12 rows.
    expect(snapStep(16)).toBe(12)
    expect(snapStep(4)).toBe(48)
    expect(snapStep(192)).toBe(1)
    expect(snapRowClosest(13, 16)).toBe(12)
    expect(snapRowClosest(19, 16)).toBe(24)
    expect(snapRowClosest(24, 16)).toBe(24)
    // Clamped at zero.
    expect(snapRowClosest(-30, 4)).toBe(0)
  })

  it('every quant divides the measure', () => {
    for (const q of SNAP_QUANTS) {
      const step = snapStep(q)
      expect(ROWS_PER_MEASURE % step).toBe(0)
      for (const row of [0, 1, step - 1, step, step + 1, 191, 192, 1000]) {
        expect(snapRowClosest(row, q) % step).toBe(0)
      }
    }
  })
})

describe('rowColor', () => {
  it('follows the ITG row-type palette', () => {
    expect(rowColor(0)).toBe('#ff0000') // 4th  red
    expect(rowColor(24)).toBe('#2976f5') // 8th  blue
    expect(rowColor(16)).toBe('#910cce') // 12th purple
    expect(rowColor(12)).toBe('#ffff00') // 16th yellow
    expect(rowColor(8)).toBe('#ce0c71') // 24th pink
    expect(rowColor(6)).toBe('#f7941d') // 32nd orange
    expect(rowColor(4)).toBe('#69e7f5') // 48th teal
    expect(rowColor(3)).toBe('#00c600') // 64th green
    expect(rowColor(1)).toBe('#848484') // 192nd gray
    // Periodic across measures and safe for negative rows.
    expect(rowColor(192)).toBe('#ff0000')
    expect(rowColor(-192)).toBe('#ff0000')
  })
})

describe('formatTime', () => {
  it('formats minutes, seconds and milliseconds', () => {
    expect(formatTime(0)).toBe('0:00.000')
    expect(formatTime(61_234)).toBe('1:01.234')
    expect(formatTime(-500)).toBe('-0:00.500')
  })
})
