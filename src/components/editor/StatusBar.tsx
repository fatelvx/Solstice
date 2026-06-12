import { useEditorStore } from '../../stores/editorStore'
import {
  ROWS_PER_BEAT,
  ROWS_PER_MEASURE,
  SNAP_NAMES,
  bpmAtRow,
  formatTime,
  rowToTime,
} from '../../lib/timing'

export default function StatusBar() {
  const chart = useEditorStore((s) => s.chart)
  const cursorRow = useEditorStore((s) => s.cursorRow)
  const snapIndex = useEditorStore((s) => s.snapIndex)

  if (!chart) return <div className="status-bar" />

  const time = rowToTime(chart.events, cursorRow)
  const bpm = bpmAtRow(chart.events, cursorRow)

  return (
    <div className="status-bar">
      <span>{formatTime(time)}</span>
      <span>measure {Math.floor(cursorRow / ROWS_PER_MEASURE)}</span>
      <span>beat {(cursorRow / ROWS_PER_BEAT).toFixed(2)}</span>
      <span>row {cursorRow}</span>
      <span>{bpm.toFixed(3).replace(/\.?0+$/, '')} BPM</span>
      <span>snap {SNAP_NAMES[snapIndex]}</span>
      <span className="status-spacer" />
      <span>
        {chart.notes.length} note{chart.notes.length === 1 ? '' : 's'} · {chart.keys}K
      </span>
    </div>
  )
}
