import { useState } from 'react'

import { useEditorStore } from '../../stores/editorStore'

export default function NewChartDialog(props: { allowCancel: boolean }) {
  const newChart = useEditorStore((s) => s.newChart)
  const requestOpen = useEditorStore((s) => s.requestOpen)
  const setShowNewDialog = useEditorStore((s) => s.setShowNewDialog)

  const [keys, setKeys] = useState(4)
  const [bpm, setBpm] = useState('120')
  const [offset, setOffset] = useState('0')

  const create = () => {
    const bpmV = Number(bpm)
    const offsetV = Number(offset)
    if (Number.isFinite(bpmV) && bpmV > 0 && Number.isFinite(offsetV)) {
      void newChart(keys, bpmV, offsetV)
    }
  }

  return (
    <div className="dialog-backdrop">
      <div className="dialog">
        <h2>New chart</h2>
        <label className="field">
          <span>Keys</span>
          <select value={keys} onChange={(e) => setKeys(Number(e.target.value))}>
            {[4, 5, 6, 7, 8, 9, 10].map((k) => (
              <option key={k} value={k}>
                {k}K
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>BPM</span>
          <input
            type="number"
            min={1}
            step={0.001}
            value={bpm}
            onChange={(e) => setBpm(e.target.value)}
          />
        </label>
        <label className="field">
          <span>Offset (ms)</span>
          <input
            type="number"
            step={1}
            value={offset}
            onChange={(e) => setOffset(e.target.value)}
          />
        </label>
        <div className="dialog-buttons">
          <button className="primary" onClick={create}>
            Create
          </button>
          <button onClick={requestOpen}>Open .sol…</button>
          {props.allowCancel && (
            <button onClick={() => setShowNewDialog(false)}>Cancel</button>
          )}
        </div>
      </div>
    </div>
  )
}
