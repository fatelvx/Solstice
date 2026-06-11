// Editor UI state. Rust owns the chart (notes, timing, undo history); every
// mutation goes through a Tauri command and the returned ChartPayload
// replaces `chart` wholesale. This store only adds view state on top.

import { create } from 'zustand'
import { invoke } from '@tauri-apps/api/core'

import type { ChartPayload } from '../types/editor'
import { audioEngine } from '../lib/audio'
import { rowToTime, snapRowClosest, SNAP_QUANTS, timeToRowF } from '../lib/timing'

interface EditorStore {
  chart: ChartPayload | null
  error: string | null
  /** Index into SNAP_QUANTS. */
  snapIndex: number
  pxPerBeat: number
  cursorRow: number
  playing: boolean
  /** Bumped when waveform data finishes loading so the canvas redraws. */
  audioGeneration: number
  showNewDialog: boolean

  setError(error: string | null): void
  setSnapIndex(i: number): void
  cycleSnap(dir: 1 | -1): void
  setPxPerBeat(v: number): void
  setCursorRow(row: number): void
  setShowNewDialog(show: boolean): void

  /** Re-fetches the open chart from Rust (page reload / dev HMR). */
  restore(): Promise<void>
  newChart(keys: number, bpm: number, offsetMs: number): Promise<void>
  openSol(): Promise<void>
  saveSol(saveAs: boolean): Promise<void>
  placeNote(row: number, endRow: number, col: number): Promise<void>
  removeNote(row: number, col: number): Promise<void>
  undo(): Promise<void>
  redo(): Promise<void>
  setBpm(row: number, bpm: number): Promise<void>
  removeBpm(row: number): Promise<void>
  setStop(row: number, durationMs: number): Promise<void>
  setOffset(offsetMs: number): Promise<void>
  pickAudio(): Promise<void>
  togglePlay(): void
  stopPlayback(): void
}

export const useEditorStore = create<EditorStore>()((set, get) => {
  function fail(e: unknown) {
    set({ error: e instanceof Error ? e.message : String(e) })
  }

  function applyPayload(chart: ChartPayload) {
    set({ chart })
    const path = chart.audio_path
    if (path && path !== audioEngine.loadedPath) {
      audioEngine
        .load(path)
        .then(() => set((s) => ({ audioGeneration: s.audioGeneration + 1 })))
        .catch(fail)
    } else if (!path && audioEngine.loadedPath) {
      audioEngine.unload()
      set((s) => ({ audioGeneration: s.audioGeneration + 1 }))
    }
  }

  /** Runs a Rust command that returns the updated chart. */
  async function command(cmd: string, args?: Record<string, unknown>): Promise<void> {
    try {
      applyPayload(await invoke<ChartPayload>(cmd, args))
    } catch (e) {
      fail(e)
    }
  }

  audioEngine.onEnded = () => get().stopPlayback()

  return {
    chart: null,
    error: null,
    snapIndex: SNAP_QUANTS.indexOf(16),
    pxPerBeat: 64,
    cursorRow: 0,
    playing: false,
    audioGeneration: 0,
    showNewDialog: false,

    setError: (error) => set({ error }),
    setSnapIndex: (i) =>
      set({ snapIndex: Math.min(Math.max(i, 0), SNAP_QUANTS.length - 1) }),
    cycleSnap: (dir) =>
      set((s) => ({
        snapIndex: (s.snapIndex + dir + SNAP_QUANTS.length) % SNAP_QUANTS.length,
      })),
    setPxPerBeat: (v) => set({ pxPerBeat: Math.min(Math.max(v, 16), 384) }),
    setCursorRow: (row) => set({ cursorRow: Math.max(0, Math.round(row)) }),
    setShowNewDialog: (showNewDialog) => set({ showNewDialog }),

    restore: async () => {
      try {
        const chart = await invoke<ChartPayload | null>('editor_get_chart')
        if (chart) applyPayload(chart)
      } catch (e) {
        fail(e)
      }
    },

    newChart: async (keys, bpm, offsetMs) => {
      get().stopPlayback()
      await command('editor_new_chart', { keys, bpm, offsetMs })
      set({ cursorRow: 0, showNewDialog: false })
    },

    openSol: async () => {
      try {
        const path = await invoke<string | null>('editor_pick_file', { kind: 'sol_open' })
        if (!path) return
        get().stopPlayback()
        applyPayload(await invoke<ChartPayload>('editor_open_sol', { path }))
        set({ cursorRow: 0, showNewDialog: false })
      } catch (e) {
        fail(e)
      }
    },

    saveSol: async (saveAs) => {
      const { chart } = get()
      if (!chart) return
      try {
        let path: string | null = null
        if (saveAs || !chart.path) {
          path = await invoke<string | null>('editor_pick_file', { kind: 'sol_save' })
          if (!path) return
        }
        applyPayload(await invoke<ChartPayload>('editor_save_sol', { path }))
      } catch (e) {
        fail(e)
      }
    },

    placeNote: (row, endRow, col) => command('editor_place_note', { row, endRow, col }),
    removeNote: (row, col) => command('editor_remove_note', { row, col }),
    undo: () => command('editor_undo'),
    redo: () => command('editor_redo'),
    setBpm: (row, bpm) => command('editor_set_bpm', { row, bpm }),
    removeBpm: (row) => command('editor_remove_bpm', { row }),
    setStop: (row, durationMs) => command('editor_set_stop', { row, durationMs }),
    setOffset: (offsetMs) => command('editor_set_offset', { offsetMs }),

    pickAudio: async () => {
      try {
        const path = await invoke<string | null>('editor_pick_file', { kind: 'audio' })
        if (!path) return
        applyPayload(await invoke<ChartPayload>('editor_set_audio', { path }))
      } catch (e) {
        fail(e)
      }
    },

    togglePlay: () => {
      const { chart, playing, cursorRow } = get()
      if (!chart) return
      if (playing) {
        get().stopPlayback()
        return
      }
      if (!audioEngine.ready) {
        set({ error: 'No audio loaded — set an audio file first.' })
        return
      }
      audioEngine.play(rowToTime(chart.events, cursorRow))
      set({ playing: true })
    },

    stopPlayback: () => {
      const { chart, playing, snapIndex } = get()
      if (!playing) return
      const t = audioEngine.stop()
      const row = chart ? Math.max(0, Math.round(timeToRowF(chart.events, t))) : 0
      set({
        playing: false,
        cursorRow: snapRowClosest(row, SNAP_QUANTS[snapIndex]),
      })
    },
  }
})
