import { useEditorStore } from '../../stores/editorStore'
import { SNAP_NAMES } from '../../lib/timing'

export default function Toolbar() {
  const chart = useEditorStore((s) => s.chart)
  const snapIndex = useEditorStore((s) => s.snapIndex)
  const pxPerBeat = useEditorStore((s) => s.pxPerBeat)
  const playing = useEditorStore((s) => s.playing)
  const setSnapIndex = useEditorStore((s) => s.setSnapIndex)
  const setPxPerBeat = useEditorStore((s) => s.setPxPerBeat)
  const setShowNewDialog = useEditorStore((s) => s.setShowNewDialog)
  const openSol = useEditorStore((s) => s.openSol)
  const saveSol = useEditorStore((s) => s.saveSol)
  const undo = useEditorStore((s) => s.undo)
  const redo = useEditorStore((s) => s.redo)
  const togglePlay = useEditorStore((s) => s.togglePlay)

  const title = chart
    ? `${chart.meta.artist || 'Unknown'} - ${chart.meta.title || 'Untitled'}` +
      (chart.meta.difficulty ? ` [${chart.meta.difficulty}]` : '')
    : 'Solstice Editor'

  return (
    <div className="toolbar">
      <div className="toolbar-group">
        <button onClick={() => setShowNewDialog(true)}>New</button>
        <button onClick={() => void openSol()}>Open</button>
        <button disabled={!chart} onClick={() => void saveSol(false)}>
          Save
        </button>
        <button disabled={!chart} onClick={() => void saveSol(true)}>
          Save As
        </button>
      </div>

      <div className="toolbar-group">
        <button disabled={!chart?.can_undo} onClick={() => void undo()} title="Ctrl+Z">
          Undo
        </button>
        <button disabled={!chart?.can_redo} onClick={() => void redo()} title="Ctrl+Y">
          Redo
        </button>
      </div>

      <div className="toolbar-group">
        <label>
          Snap{' '}
          <select
            value={snapIndex}
            onChange={(e) => setSnapIndex(Number(e.target.value))}
            title="Left/Right arrows cycle snap"
          >
            {SNAP_NAMES.map((name, i) => (
              <option key={name} value={i}>
                {name}
              </option>
            ))}
          </select>
        </label>
        <button onClick={() => setPxPerBeat(pxPerBeat / 1.25)} title="Zoom out (Ctrl+wheel)">
          −
        </button>
        <span className="toolbar-zoom">{Math.round(pxPerBeat)}px</span>
        <button onClick={() => setPxPerBeat(pxPerBeat * 1.25)} title="Zoom in (Ctrl+wheel)">
          +
        </button>
      </div>

      <div className="toolbar-group">
        <button disabled={!chart} onClick={togglePlay} title="Space">
          {playing ? '⏸ Pause' : '▶ Play'}
        </button>
      </div>

      <div className="toolbar-title">
        {title}
        {chart?.dirty ? ' •' : ''}
      </div>
    </div>
  )
}
