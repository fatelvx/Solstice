import { useEditorStore } from '../../stores/editorStore'

/** Shown when New / Open / closing the app would discard unsaved changes. */
export default function UnsavedDialog() {
  const confirmPending = useEditorStore((s) => s.confirmPending)
  const cancelPending = useEditorStore((s) => s.cancelPending)

  return (
    <div className="dialog-backdrop" onClick={cancelPending}>
      <div className="dialog" onClick={(e) => e.stopPropagation()}>
        <h2>Unsaved changes</h2>
        <p className="dialog-text">
          This chart has unsaved changes. Save them before continuing?
        </p>
        <div className="dialog-buttons">
          <button className="primary" autoFocus onClick={() => void confirmPending(true)}>
            Save
          </button>
          <button className="danger" onClick={() => void confirmPending(false)}>
            Discard
          </button>
          <button onClick={cancelPending}>Cancel</button>
        </div>
      </div>
    </div>
  )
}
