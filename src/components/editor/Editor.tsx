import { useEffect } from 'react'
import { getCurrentWindow } from '@tauri-apps/api/window'

import { useEditorStore } from '../../stores/editorStore'
import { ROWS_PER_MEASURE, SNAP_QUANTS, snapRowClosest, snapStep } from '../../lib/timing'
import Toolbar from './Toolbar'
import NoteField from './NoteField'
import TimingPanel from './TimingPanel'
import StatusBar from './StatusBar'
import NewChartDialog from './NewChartDialog'
import UnsavedDialog from './UnsavedDialog'
import './editor.css'

export default function Editor() {
  const chart = useEditorStore((s) => s.chart)
  const showNewDialog = useEditorStore((s) => s.showNewDialog)
  const pendingAction = useEditorStore((s) => s.pendingAction)
  const error = useEditorStore((s) => s.error)
  const restore = useEditorStore((s) => s.restore)

  // Re-fetch the open chart from Rust after a reload or HMR.
  useEffect(() => {
    void restore()
  }, [restore])

  // Closing the window with unsaved changes asks first.
  useEffect(() => {
    let unlisten: (() => void) | undefined
    let cancelled = false
    void getCurrentWindow()
      .onCloseRequested((event) => {
        const s = useEditorStore.getState()
        if (s.chart?.dirty) {
          event.preventDefault()
          s.requestClose()
        }
      })
      .then((u) => {
        if (cancelled) u()
        else unlisten = u
      })
    return () => {
      cancelled = true
      unlisten?.()
    }
  }, [])

  useEffect(() => {
    if (!error) return
    const t = setTimeout(() => useEditorStore.getState().setError(null), 5000)
    return () => clearTimeout(t)
  }, [error])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null
      const tag = target?.tagName
      if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return

      const s = useEditorStore.getState()

      if (e.key === 'Escape') {
        if (s.pendingAction) s.cancelPending()
        else if (s.showNewDialog && s.chart) s.setShowNewDialog(false)
        return
      }
      // A modal owns the keyboard; chart shortcuts must not fire behind it.
      if (s.pendingAction || s.showNewDialog || !s.chart) return

      const quant = SNAP_QUANTS[s.snapIndex]
      const step = snapStep(quant)
      const maxRow = s.chart.end_row + 8 * ROWS_PER_MEASURE
      const moveCursor = (delta: number) =>
        s.setCursorRow(
          Math.min(Math.max(snapRowClosest(s.cursorRow, quant) + delta, 0), maxRow),
        )

      if (e.ctrlKey || e.metaKey) {
        switch (e.key.toLowerCase()) {
          case 'z':
            e.preventDefault()
            void (e.shiftKey ? s.redo() : s.undo())
            return
          case 'y':
            e.preventDefault()
            void s.redo()
            return
          case 's':
            e.preventDefault()
            void s.saveSol(e.shiftKey)
            return
        }
        return
      }

      switch (e.key) {
        case ' ':
          e.preventDefault()
          s.togglePlay()
          return
        case 'ArrowUp':
          e.preventDefault()
          if (!s.playing) moveCursor(-step)
          return
        case 'ArrowDown':
          e.preventDefault()
          if (!s.playing) moveCursor(step)
          return
        case 'PageUp':
          e.preventDefault()
          if (!s.playing) moveCursor(-ROWS_PER_MEASURE)
          return
        case 'PageDown':
          e.preventDefault()
          if (!s.playing) moveCursor(ROWS_PER_MEASURE)
          return
        case 'Home':
          e.preventDefault()
          if (!s.playing) s.setCursorRow(0)
          return
        case 'End':
          e.preventDefault()
          if (!s.playing) s.setCursorRow(s.chart.end_row)
          return
        case 'ArrowLeft':
          e.preventDefault()
          s.cycleSnap(-1)
          return
        case 'ArrowRight':
          e.preventDefault()
          s.cycleSnap(1)
          return
      }

      // Number keys place taps at the cursor row ('1' = leftmost column).
      if (/^[0-9]$/.test(e.key) && !s.playing) {
        const col = e.key === '0' ? 9 : Number(e.key) - 1
        if (col < s.chart.keys) void s.placeNote(s.cursorRow, s.cursorRow, col)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  return (
    <div className="sol-editor">
      <Toolbar />
      <div className="editor-main">
        <NoteField />
        <TimingPanel />
      </div>
      <StatusBar />
      {(!chart || showNewDialog) && <NewChartDialog allowCancel={chart !== null} />}
      {pendingAction && <UnsavedDialog />}
      {error && <div className="editor-toast">{error}</div>}
    </div>
  )
}
