// Canvas notefield: waveform, beat grid, notes, and placement interactions.
//
// Vertical layout like ArrowVortex: row 0 at the top, time flows downward,
// and the view is anchored so the cursor (or the playhead, while playing)
// sits on the receptor line. All chart math is in rows; Rust owns the data.
//
// The view never jumps: cursor motion eases toward its target row
// (exponential approach, ~60ms time constant), and the same animated anchor
// drives both drawing and pointer hit-testing so clicks always land where
// the eye says they will.

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
/** Wheel distance that equals one snap step (accumulated for trackpads). */
const WHEEL_NOTCH = 60
/** Time constant of the scroll easing, in ms. */
const SCROLL_TAU = 60

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
  /** Animated view anchor; trails cursorRow and follows the playhead. */
  const animRowRef = useRef(0)
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
    const anchorRowF = playing
      ? timeToRowF(events, audioEngine.timeMs())
      : animRowRef.current
    // Keep the animated anchor in sync during playback so that stopping
    // (which sets the cursor to the playhead row) never causes a swoop.
    if (playing) animRowRef.current = anchorRowF
    const fieldW = chart.keys * COL_WIDTH
    const x0 = Math.round((W - fieldW) / 2)
    const rowAtY = (y: number) => anchorRowF + (y - receptorY) / pxPerRow
    const yAtRow = (row: number) => receptorY + (row - anchorRowF) * pxPerRow

    // Notefield background with softly shaded edges.
    ctx.fillStyle = 'rgba(255, 255, 255, 0.03)'
    ctx.fillRect(x0, 0, fieldW, H)
    const edge = ctx.createLinearGradient(x0, 0, x0 + fieldW, 0)
    edge.addColorStop(0, 'rgba(0, 0, 0, 0.35)')
    edge.addColorStop(0.06, 'rgba(0, 0, 0, 0)')
    edge.addColorStop(0.94, 'rgba(0, 0, 0, 0)')
    edge.addColorStop(1, 'rgba(0, 0, 0, 0.35)')
    ctx.fillStyle = edge
    ctx.fillRect(x0, 0, fieldW, H)

    // Waveform: min/max amplitude of the audio span covered by each pixel
    // line, drawn sideways behind the notefield (ArrowVortex style).
    if (audioEngine.peaks) {
      ctx.fillStyle = 'rgba(82, 139, 255, 0.30)'
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
        ctx.fillText(String(row / ROWS_PER_MEASURE), x0 - 10, y + 4)
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

    // Notes, colored by their row's quantization, lit from the top.
    const noteW = COL_WIDTH - 12
    const bodyW = COL_WIDTH - 26
    const drawNote = (
      row: number,
      endRow: number,
      col: number,
      alpha: number,
      ghost = false,
    ) => {
      const x = x0 + col * COL_WIDTH + (COL_WIDTH - noteW) / 2
      const yHead = yAtRow(row)
      const color = rowColor(row)
      ctx.globalAlpha = alpha
      if (endRow > row) {
        const yEnd = yAtRow(endRow)
        const bx = x0 + col * COL_WIDTH + (COL_WIDTH - bodyW) / 2
        ctx.globalAlpha = alpha * 0.4
        ctx.fillStyle = color
        ctx.beginPath()
        ctx.roundRect(bx, yHead, bodyW, Math.max(yEnd - yHead, 2), 3)
        ctx.fill()
        ctx.globalAlpha = alpha * 0.85
        ctx.beginPath()
        ctx.roundRect(bx, yEnd - 3, bodyW, 5, 2)
        ctx.fill()
        ctx.globalAlpha = alpha
      }
      const top = yHead - NOTE_HEIGHT / 2
      ctx.fillStyle = color
      ctx.beginPath()
      ctx.roundRect(x, top, noteW, NOTE_HEIGHT, 3)
      ctx.fill()
      if (!ghost) {
        const sheen = ctx.createLinearGradient(0, top, 0, top + NOTE_HEIGHT)
        sheen.addColorStop(0, 'rgba(255, 255, 255, 0.32)')
        sheen.addColorStop(0.45, 'rgba(255, 255, 255, 0.05)')
        sheen.addColorStop(1, 'rgba(0, 0, 0, 0.22)')
        ctx.fillStyle = sheen
        ctx.beginPath()
        ctx.roundRect(x, top, noteW, NOTE_HEIGHT, 3)
        ctx.fill()
      }
      ctx.strokeStyle = 'rgba(0, 0, 0, 0.55)'
      if (ghost) ctx.setLineDash([4, 3])
      ctx.beginPath()
      ctx.roundRect(x, top, noteW, NOTE_HEIGHT, 3)
      ctx.stroke()
      ctx.setLineDash([])
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
      drawNote(a, b, drag.col, 0.45, true)
    } else if (!playing && hover && hover.col >= 0) {
      const r = snapRowClosest(hover.rowF, quant)
      drawNote(r, r, hover.col, 0.28, true)
    }

    // Receptor line at the cursor (or the playhead while playing), with a
    // soft glow so the eye always finds it.
    const accent = playing ? '#63dc63' : '#c084fc'
    const cy = Math.round(playing ? receptorY : yAtRow(cursorRow)) + 0.5
    ctx.save()
    ctx.shadowColor = accent
    ctx.shadowBlur = 10
    ctx.strokeStyle = accent
    ctx.lineWidth = 1.5
    ctx.beginPath()
    ctx.moveTo(x0 - 4, cy)
    ctx.lineTo(x0 + fieldW + 4, cy)
    ctx.stroke()
    ctx.restore()
    ctx.strokeStyle = playing ? 'rgba(99, 220, 99, 0.55)' : 'rgba(192, 132, 252, 0.55)'
    ctx.lineWidth = 1.5
    for (let c = 0; c < chart.keys; c++) {
      const x = x0 + c * COL_WIDTH + (COL_WIDTH - noteW) / 2
      ctx.beginPath()
      ctx.roundRect(x - 2, cy - NOTE_HEIGHT / 2 - 3, noteW + 4, NOTE_HEIGHT + 6, 4)
      ctx.stroke()
    }
    ctx.lineWidth = 1
  }, [chart, snapIndex, pxPerBeat, cursorRow, playing, size, hover, drag, audioGeneration])

  // Redraw on every state change; keep the latest draw for the rAF loops.
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

  // Cursor easing: animate the anchor toward the cursor row.
  useEffect(() => {
    if (playing) return
    let raf = 0
    let last = performance.now()
    const tick = (now: number) => {
      const dt = Math.min(64, now - last)
      last = now
      const d = cursorRow - animRowRef.current
      if (Math.abs(d) * (pxPerBeat / ROWS_PER_BEAT) < 0.4) {
        animRowRef.current = cursorRow
        drawRef.current()
        return
      }
      animRowRef.current += d * (1 - Math.exp(-dt / SCROLL_TAU))
      drawRef.current()
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [cursorRow, playing, pxPerBeat])

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

  /** Pointer position -> field coordinates, using the animated anchor. */
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
      : animRowRef.current
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
  // Deltas accumulate so trackpads (many small events) and mice (one big
  // notch) both scroll exactly one snap step per WHEEL_NOTCH of travel.
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    let accum = 0
    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      const s = useEditorStore.getState()
      if (!s.chart) return
      if (e.ctrlKey) {
        const dir = e.deltaY > 0 ? 1 : -1
        s.setPxPerBeat(s.pxPerBeat * (dir > 0 ? 1 / ZOOM_FACTOR : ZOOM_FACTOR))
        return
      }
      if (s.playing) return
      let notches: number
      if (Math.abs(e.deltaY) >= WHEEL_NOTCH) {
        // Discrete wheel: one step per notch (~100px), N for coalesced spins.
        notches = Math.round(e.deltaY / 100) || Math.sign(e.deltaY)
        accum = 0
      } else {
        // Trackpad: accumulate small pixel deltas into steps.
        if (Math.sign(e.deltaY) !== Math.sign(accum)) accum = 0
        accum += e.deltaY
        notches = Math.trunc(accum / WHEEL_NOTCH)
        accum -= notches * WHEEL_NOTCH
      }
      if (notches === 0) return
      const quant = SNAP_QUANTS[s.snapIndex]
      const next = snapRowClosest(s.cursorRow, quant) + notches * snapStep(quant)
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
