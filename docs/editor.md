# Editor (MVP)

The editor follows ArrowVortex's core design, split across the Tauri boundary:
Rust owns the chart and all timing math; React only renders and forwards
intent. Every edit command returns the full updated chart, so the UI never
holds chart state that can drift.

## Architecture

| Layer | Path | Responsibility |
|---|---|---|
| Timing engine | `src-tauri/src/editor/timing.rs` | 48-rows-per-beat grid, BPM/stop flattening, row↔time conversion, snapping |
| Chart model | `src-tauri/src/editor/chart.rs` | Row-based notes, note placement/removal, tempo edits, `.sol` import/export |
| Session | `src-tauri/src/editor/state.rs` | Open chart, dirty flag, undo/redo history |
| Commands | `src-tauri/src/editor/commands.rs` | Tauri command surface (`editor_*`), `ChartPayload` snapshots |
| Store | `src/stores/editorStore.ts` | Zustand mirror of the payload + view state (snap, zoom, cursor) |
| Notefield | `src/components/editor/NoteField.tsx` | Canvas rendering (waveform, grid, notes) and pointer input |
| Panels | `src/components/editor/*.tsx` | Toolbar, timing sidebar, status bar, new-chart dialog |

Times in `.sol` are milliseconds; the editor quantizes to rows on load and
re-derives ms on save (`EditorChart::from_sol` / `to_sol`). Audio is read by
Rust (`editor_read_audio`) and decoded with Web Audio; the waveform draws
min/max peaks per pixel line, mapped through the timing events so BPM changes
and stops stay aligned with the grid.

## Controls

| Input | Action |
|---|---|
| Left click / drag | Place tap / hold (placing on an identical note removes it) |
| Right click | Remove the note under the cursor (hold bodies count) |
| Mouse wheel | Move cursor by one snap step |
| Ctrl+wheel | Zoom |
| `1`–`9`, `0` | Place tap at the cursor in that column |
| Up/Down | Move cursor by one snap step |
| PageUp/PageDown | Move cursor by one measure |
| Home/End | Jump to start / last note |
| Left/Right | Cycle snap (4th … 192nd, ArrowVortex order) |
| Space | Play / pause from the cursor |
| Ctrl+Z / Ctrl+Y | Undo / redo |
| Ctrl+S / Ctrl+Shift+S | Save / save as |

BPM changes and stops are edited in the sidebar and apply at the cursor row.
Note colors follow the ITG/ArrowVortex row-type palette (4th red, 8th blue,
12th purple, 16th yellow, …).
