// Canvas notefield: waveform, beat grid, notes, and placement interactions.
//
// Vertical layout like ArrowVortex: row 0 at the top, time flows downward,
// and the view is anchored so the cursor (or the playhead, while playing)
// sits on the receptor line. All chart math is in rows; Rust owns the data.

import { useCallback, useEffect, useRef, useState } from 'react'

import { useEditorStore } from '../../stores/editorStore'
import { audioEngine } from '../../lib/audio'
import {
  ROWS_PER_BEAT,
  ROWS_PER_MEASURE,
  SNAP_QUANTS,
  rowColor,
  rowToTime,
  snapRowClosest,
  snapStep,
  timeToRowF,
} from '../../lib/timing'

const COL_WIDTH = 56
const NOTE_HEIGHT = 14
const RECEPTOR_FRAC = 0.25
const OVERSCROLL_ROWS = 8 * ROWS_PER_MEASURE
const ZOOM_FACTOR = 1.2

interface Drag {
  col: number
  startRow: number
  currentRow: number
}

interface Hover {
  rowF: number
  col: number
}

export default function NoteField() {
  const chart = useEditorStore((s) => s.chart)
  const snapIndex = useEditorStore((s) => s.snapIndex)
  const pxPerBeat = useEditorStore((s) => s.pxPerBeat)
  const cursorRow = useEditorStore((s) => s.cursorRow)
  const playing = useEditorStore((s) => s.playing)
  const audioGeneration = useEditorStore((s) => s.audioGeneration)

  const containerRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const drawRef = useRef<() => void>(() => {})
  const [size, setSize] = useState({ w: 0, h: 0 })
  const [hover, setHover] = useState<Hover | null>(null)
  const [drag, setDrag] = useState<Drag | null>(null)

  // ==============================================================================================
  // Rendering.

  const draw = useCallback(() => {
    // audioGeneration is bumped when waveform data finishes loading; reading
    // it here ties the redraw effect to it (the peaks live outside React).
    void audioGeneration
    const canvas = canvasRef.current
    const ctx = canvas?.getContext('2d')
    if (!canvas || !ctx || size.w === 0 || size.h === 0) return
    const dpr = window.devicePixelRatio || 1
    // Resize here, not in a separate effect: setting width clears the canvas,
    // which would wipe a frame drawn by an effect that ran earlier.
    if (canvas.width !== size.w * dpr || canvas.height !== size.h * dpr) {
      canvas.width = size.w * dpr
      canvas.height = size.h * dpr
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)

    const { w: W, h: H } = size
    ctx.fillStyle = '#0d0e12'
    ctx.fillRect(0, 0, W, H)
    if (!chart) return

    const events = chart.events
    const quant = SNAP_QUANTS[snapIndex]
    const step = snapStep(quant)
    const pxPerRow = pxPerBeat / ROWS_PER_BEAT
    const receptorY = Math.round(H * RECEPTOR_FRAC)
    const anchorRowF = playing ? timeToRowF(events, audioEngine.timeMs()) : cursorRow
    const fieldW = chart.keys * COL_WIDTH
    const x0 = Math.round((W - fieldW) / 2)
    const rowAtY = (y: number) => anchorRowF + (y - receptorY) / pxPerRow
    const yAtRow = (row: number) => receptorY + (row - anchorRowF) * pxPerRow

    // Notefield background.
    ctx.fillStyle = 'rgba(255, 255, 255, 0.03)'
    ctx.fillRect(x0, 0, fieldW, H)

    // Waveform: min/max amplitude of the audio span covered by each pixel
    // line, drawn sideways behind the notefield (ArrowVortex style).
    if (audioEngine.peaks) {
      ctx.fillStyle = 'rgba(82, 139, 255, 0.32)'
      const cx = x0 + fieldW / 2
      const halfW = fieldW / 2 - 2
      let tPrev = rowToTime(events, rowAtY(0))
      for (let y = 0; y < H; y++) {
        const tNext = rowToTime(events, rowAtY(y + 1))
        const pk = audioEngine.peakRange(tPrev, tNext)
        tPrev = tNext
        if (!pk) continue
        const xMin = cx + Math.max(-1, pk[0]) * halfW
        const xMax = cx + Math.min(1, pk[1]) * halfW
        ctx.fillRect(xMin, y, Math.max(1, xMax - xMin), 1)
      }
    }

    // Column separators.
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.08)'
    ctx.beginPath()
    for (let c = 0; c <= chart.keys; c++) {
      const x = x0 + c * COL_WIDTH + 0.5
      ctx.moveTo(x, 0)
      ctx.lineTo(x, H)
    }
    ctx.stroke()

    // Snap grid: snap lines, brighter beat lines, brightest measure lines
    // with measure numbers. Every snap step divides a beat, so beat and
    // measure rows always land on the grid.
    ctx.font = '11px ui-monospace, Consolas, monospace'
    ctx.textAlign = 'right'
    const firstRow = Math.max(0, Math.floor(rowAtY(0) / step) * step)
    const lastRow = rowAtY(H)
    for (let row = firstRow; row <= lastRow; row += step) {
      const y = Math.round(yAtRow(row)) + 0.5
      if (row % ROWS_PER_MEASURE === 0) {
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.30)'
        ctx.fillStyle = 'rgba(255, 255, 255, 0.45)'
        ctx.fillText(String(row / ROWS_PER_MEASURE), x0 - 8, y + 4)
      } else if (row % ROWS_PER_BEAT === 0) {
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.15)'
      } else {
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.06)'
      }
      ctx.beginPath()
      ctx.moveTo(x0, y)
      ctx.lineTo(x0 + fieldW, y)
      ctx.stroke()
    }

    // BPM / stop markers beside the notefield.
    ctx.textAlign = 'left'
    for (const b of chart.bpms) {
      const y = yAtRow(b.row)
      if (y < -4 || y > H + 4) continue
      ctx.strokeStyle = 'rgba(99, 220, 99, 0.6)'
      ctx.beginPath()
      ctx.moveTo(x0 + fieldW, Math.round(y) + 0.5)
      ctx.lineTo(x0 + fieldW + 6, Math.round(y) + 0.5)
      ctx.stroke()
      ctx.fillStyle = '#63dc63'
      ctx.fillText(`${b.bpm.toFixed(3).replace(/\.?0+$/, '')} BPM`, x0 + fieldW + 9, y + 4)
    }
    for (const s of chart.stops) {
      const y = yAtRow(s.row)
      if (y < -4 || y > H + 4) continue
      ctx.fillStyle = '#ff6261'
      ctx.fillText(`STOP ${s.duration_ms}ms`, x0 + fieldW + 9, y + 16)
    }

    // Notes, colored by their row's quantization.
    const noteW = COL_WIDTH - 12
    const bodyW = COL_WIDTH - 26
    const drawNote = (row: number, endRow: number, col: number, alpha: number) => {
      const x = x0 + col * COL_WIDTH + (COL_WIDTH - noteW) / 2
      const yHead = yAtRow(row)
      const color = rowColor(row)
      ctx.globalAlpha = alpha
      if (endRow > row) {
        const yEnd = yAtRow(endRow)
        const bx = x0 + col * COL_WIDTH + (COL_WIDTH - bodyW) / 2
        ctx.globalAlpha = alpha * 0.45
        ctx.fillStyle = color
        ctx.fillRect(bx, yHead, bodyW, yEnd - yHead)
        ctx.globalAlpha = alpha * 0.8
        ctx.fillRect(bx, yEnd - 3, bodyW, 4)
        ctx.globalAlpha = alpha
      }
      ctx.fillStyle = color
      ctx.beginPath()
      ctx.roundRect(x, yHead - NOTE_HEIGHT / 2, noteW, NOTE_HEIGHT, 3)
      ctx.fill()
      ctx.strokeStyle = 'rgba(0, 0, 0, 0.6)'
      ctx.stroke()
      ctx.globalAlpha = 1
    }

    const topRow = rowAtY(-NOTE_HEIGHT)
    const bottomRow = rowAtY(H + NOTE_HEIGHT)
    for (const n of chart.notes) {
      if (n.end_row < topRow || n.row > bottomRow) continue
      drawNote(n.row, n.end_row, n.col, 1)
    }

    // Placement previews.
    if (!playing && drag) {
      const a = Math.min(drag.startRow, drag.currentRow)
      const b = Math.max(drag.startRow, drag.currentRow)
      drawNote(a, b, drag.col, 0.4)
    } else if (!playing && hover && hover.col >= 0) {
      drawNote(snapRowClosest(hover.rowF, quant), snapRowClosest(hover.rowF, quant), hover.col, 0.25)
    }

    // Receptor line at the cursor (or the playhead while playing).
    const cy = Math.round(playing ? receptorY : yAtRow(cursorRow)) + 0.5
    ctx.strokeStyle = playing ? '#63dc63' : '#c084fc'
    ctx.beginPath()
    ctx.moveTo(x0 - 4, cy)
    ctx.lineTo(x0 + fieldW + 4, cy)
    ctx.stroke()
    for (let c = 0; c < chart.keys; c++) {
      const x = x0 + c * COL_WIDTH + (COL_WIDTH - noteW) / 2
      ctx.strokeStyle = playing ? 'rgba(99, 220, 99, 0.5)' : 'rgba(192, 132, 252, 0.5)'
      ctx.beginPath()
      ctx.roundRect(x - 2, cy - NOTE_HEIGHT / 2 - 3, noteW + 4, NOTE_HEIGHT + 6, 4)
      ctx.stroke()
    }
  }, [chart, snapIndex, pxPerBeat, cursorRow, playing, size, hover, drag, audioGeneration])

  // Redraw on every state change; keep the latest draw for the rAF loop.
  useEffect(() => {
    drawRef.current = draw
    draw()
  }, [draw])

  // While playing, the anchor follows the audio clock every frame.
  useEffect(() => {
    if (!playing) return
    let raf = requestAnimationFrame(function loop() {
      drawRef.current()
      raf = requestAnimationFrame(loop)
    })
    return () => cancelAnimationFrame(raf)
  }, [playing])

  // Canvas sizing (device-pixel aware).
  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const ro = new ResizeObserver(() => {
      const r = el.getBoundingClientRect()
      setSize({ w: Math.round(r.width), h: Math.round(r.height) })
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  // ==============================================================================================
  // Interactions.

  /** Pointer position -> field coordinates, reading live store state. */
  const locate = (e: { clientX: number; clientY: number }) => {
    const canvas = canvasRef.current
    const s = useEditorStore.getState()
    if (!canvas || !s.chart) return null
    const rect = canvas.getBoundingClientRect()
    const x = e.clientX - rect.left
    const y = e.clientY - rect.top
    const pxPerRow = s.pxPerBeat / ROWS_PER_BEAT
    const receptorY = Math.round(rect.height * RECEPTOR_FRAC)
    const anchorRowF = s.playing
      ? timeToRowF(s.chart.events, audioEngine.timeMs())
      : s.cursorRow
    const fieldW = s.chart.keys * COL_WIDTH
    const x0 = Math.round((rect.width - fieldW) / 2)
    const col = x >= x0 && x < x0 + fieldW ? Math.floor((x - x0) / COL_WIDTH) : -1
    const rowF = anchorRowF + (y - receptorY) / pxPerRow
    return { col, rowF }
  }

  const onPointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const s = useEditorStore.getState()
    const at = locate(e)
    if (!at || !s.chart || s.playing) return
    if (e.button === 0 && at.col >= 0) {
      const row = snapRowClosest(at.rowF, SNAP_QUANTS[s.snapIndex])
      setDrag({ col: at.col, startRow: row, currentRow: row })
      e.currentTarget.setPointerCapture(e.pointerId)
    } else if (e.button === 2 && at.col >= 0) {
      // Remove the nearest note in the column (hold bodies count).
      const tolRows = Math.max(4, 10 / (s.pxPerBeat / ROWS_PER_BEAT))
      let best: { row: number; dist: number } | null = null
      for (const n of s.chart.notes) {
        if (n.col !== at.col) continue
        const dist =
          at.rowF < n.row ? n.row - at.rowF : at.rowF > n.end_row ? at.rowF - n.end_row : 0
        if (!best || dist < best.dist) best = { row: n.row, dist }
      }
      if (best && best.dist <= tolRows) void s.removeNote(best.row, at.col)
    }
  }

  const onPointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const s = useEditorStore.getState()
    const at = locate(e)
    if (!at) return
    setHover(at.col >= 0 ? { rowF: at.rowF, col: at.col } : null)
    if (drag) {
      const row = snapRowClosest(at.rowF, SNAP_QUANTS[s.snapIndex])
      if (row !== drag.currentRow) setDrag({ ...drag, currentRow: row })
    }
  }

  const onPointerUp = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (e.button !== 0 || !drag) return
    const s = useEditorStore.getState()
    const a = Math.min(drag.startRow, drag.currentRow)
    const b = Math.max(drag.startRow, drag.currentRow)
    setDrag(null)
    void s.placeNote(a, b, drag.col)
  }

  // Wheel must be a native non-passive listener so preventDefault works.
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      const s = useEditorStore.getState()
      if (!s.chart) return
      const dir = e.deltaY > 0 ? 1 : -1
      if (e.ctrlKey) {
        s.setPxPerBeat(s.pxPerBeat * (dir > 0 ? 1 / ZOOM_FACTOR : ZOOM_FACTOR))
        return
      }
      if (s.playing) return
      const quant = SNAP_QUANTS[s.snapIndex]
      const next = snapRowClosest(s.cursorRow, quant) + dir * snapStep(quant)
      const maxRow = s.chart.end_row + OVERSCROLL_ROWS
      s.setCursorRow(Math.min(Math.max(next, 0), maxRow))
    }
    canvas.addEventListener('wheel', onWheel, { passive: false })
    return () => canvas.removeEventListener('wheel', onWheel)
  }, [])

  return (
    <div ref={containerRef} className="notefield">
      <canvas
        ref={canvasRef}
        style={{ width: size.w, height: size.h }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerLeave={() => setHover(null)}
        onContextMenu={(e) => e.preventDefault()}
      />
    </div>
  )
}
