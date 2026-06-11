// Sidebar for timing edits: offset, BPM changes, stops, and the audio file.
// Everything is applied "at the cursor row", mirroring how ArrowVortex's
// tempo dialogs operate on the cursor position.

import { useState } from 'react'

import { useEditorStore } from '../../stores/editorStore'
import { ROWS_PER_BEAT, bpmAtRow } from '../../lib/timing'

// Callers pass `key={value}` so the field resets when the chart value changes.
function NumberField(props: {
  label: string
  value: number
  step?: number
  onCommit: (v: number) => void
}) {
  const [text, setText] = useState(String(props.value))

  const commit = () => {
    const v = Number(text)
    if (Number.isFinite(v) && v !== props.value) props.onCommit(v)
    else setText(String(props.value))
  }

  return (
    <label className="field">
      <span>{props.label}</span>
      <input
        type="number"
        step={props.step ?? 1}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
        }}
      />
    </label>
  )
}

export default function TimingPanel() {
  const chart = useEditorStore((s) => s.chart)
  const cursorRow = useEditorStore((s) => s.cursorRow)
  const setCursorRow = useEditorStore((s) => s.setCursorRow)
  const setOffset = useEditorStore((s) => s.setOffset)
  const setBpm = useEditorStore((s) => s.setBpm)
  const removeBpm = useEditorStore((s) => s.removeBpm)
  const setStop = useEditorStore((s) => s.setStop)
  const pickAudio = useEditorStore((s) => s.pickAudio)

  const [newBpm, setNewBpm] = useState('120')
  const [newStop, setNewStop] = useState('250')

  if (!chart) return <div className="timing-panel" />

  const cursorBpm = bpmAtRow(chart.events, cursorRow)
  const beatLabel = (row: number) => (row / ROWS_PER_BEAT).toFixed(row % ROWS_PER_BEAT ? 2 : 0)

  return (
    <div className="timing-panel">
      <section>
        <h3>Sync</h3>
        <NumberField
          key={chart.offset_ms}
          label="Offset (ms)"
          value={chart.offset_ms}
          step={1}
          onCommit={(v) => void setOffset(v)}
        />
        <div className="field">
          <span>Audio</span>
          <button className="file-button" onClick={() => void pickAudio()}>
            {chart.files.audio || 'Choose file…'}
          </button>
        </div>
      </section>

      <section>
        <h3>BPM</h3>
        <ul className="event-list">
          {chart.bpms.map((b) => (
            <li key={b.row}>
              <button className="jump" onClick={() => setCursorRow(b.row)}>
                beat {beatLabel(b.row)}
              </button>
              <span className="value">{b.bpm.toFixed(3).replace(/\.?0+$/, '')}</span>
              <button
                className="delete"
                disabled={b.row === 0}
                title={b.row === 0 ? 'The chart always needs a starting BPM' : 'Remove'}
                onClick={() => void removeBpm(b.row)}
              >
                ×
              </button>
            </li>
          ))}
        </ul>
        <div className="add-row">
          <input
            type="number"
            min={1}
            step={0.001}
            value={newBpm}
            onChange={(e) => setNewBpm(e.target.value)}
          />
          <button
            onClick={() => {
              const v = Number(newBpm)
              if (Number.isFinite(v) && v > 0) void setBpm(cursorRow, v)
            }}
          >
            Set @ cursor
          </button>
        </div>
        <p className="hint">Current: {cursorBpm.toFixed(3).replace(/\.?0+$/, '')} BPM</p>
      </section>

      <section>
        <h3>Stops</h3>
        <ul className="event-list">
          {chart.stops.map((s) => (
            <li key={s.row}>
              <button className="jump" onClick={() => setCursorRow(s.row)}>
                beat {beatLabel(s.row)}
              </button>
              <span className="value">{s.duration_ms}ms</span>
              <button className="delete" title="Remove" onClick={() => void setStop(s.row, 0)}>
                ×
              </button>
            </li>
          ))}
        </ul>
        <div className="add-row">
          <input
            type="number"
            min={1}
            step={1}
            value={newStop}
            onChange={(e) => setNewStop(e.target.value)}
          />
          <button
            onClick={() => {
              const v = Number(newStop)
              if (Number.isFinite(v) && v > 0) void setStop(cursorRow, v)
            }}
          >
            Set @ cursor
          </button>
        </div>
      </section>
    </div>
  )
}
