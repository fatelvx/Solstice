// Audio decoding, peak extraction for the waveform, and playback.
//
// The file is read by the Rust side (editor_read_audio) and decoded with Web
// Audio. Peaks follow ArrowVortex's waveform: min/max amplitude per bucket,
// aggregated per pixel line at draw time.

import { invoke } from '@tauri-apps/api/core'

const BUCKET_SIZE = 256

export interface Peaks {
  min: Float32Array
  max: Float32Array
  bucketSize: number
}

function computePeaks(mono: Float32Array): Peaks {
  const n = Math.ceil(mono.length / BUCKET_SIZE)
  const min = new Float32Array(n)
  const max = new Float32Array(n)
  for (let b = 0; b < n; b++) {
    const start = b * BUCKET_SIZE
    const end = Math.min(start + BUCKET_SIZE, mono.length)
    let lo = Infinity
    let hi = -Infinity
    for (let i = start; i < end; i++) {
      const v = mono[i]
      if (v < lo) lo = v
      if (v > hi) hi = v
    }
    min[b] = lo
    max[b] = hi
  }
  return { min, max, bucketSize: BUCKET_SIZE }
}

function mixToMono(buffer: AudioBuffer): Float32Array {
  const mono = new Float32Array(buffer.length)
  const channels = buffer.numberOfChannels
  for (let c = 0; c < channels; c++) {
    const data = buffer.getChannelData(c)
    for (let i = 0; i < data.length; i++) mono[i] += data[i]
  }
  if (channels > 1) {
    for (let i = 0; i < mono.length; i++) mono[i] /= channels
  }
  return mono
}

export class AudioEngine {
  private ctx: AudioContext | null = null
  private buffer: AudioBuffer | null = null
  private source: AudioBufferSourceNode | null = null
  private mono: Float32Array | null = null
  private startCtxTime = 0
  private startOffsetMs = 0
  private stopping = false

  peaks: Peaks | null = null
  sampleRate = 44100
  /** Path of the currently loaded file ('' when nothing is loaded). */
  loadedPath = ''
  /** Called when playback reaches the end of the audio file. */
  onEnded: (() => void) | null = null

  get ready(): boolean {
    return this.buffer !== null
  }

  get playing(): boolean {
    return this.source !== null
  }

  get durationMs(): number {
    return this.buffer ? this.buffer.duration * 1000 : 0
  }

  async load(path: string): Promise<void> {
    if (path === this.loadedPath) return
    this.stop()
    this.ctx ??= new AudioContext()
    const bytes = await invoke<ArrayBuffer>('editor_read_audio', { path })
    const buffer = await this.ctx.decodeAudioData(bytes)
    this.buffer = buffer
    this.sampleRate = buffer.sampleRate
    this.mono = mixToMono(buffer)
    this.peaks = computePeaks(this.mono)
    this.loadedPath = path
  }

  unload(): void {
    this.stop()
    this.buffer = null
    this.mono = null
    this.peaks = null
    this.loadedPath = ''
  }

  /** Starts playback at the given chart time (may be negative; audio waits). */
  play(fromMs: number): void {
    if (!this.ctx || !this.buffer) return
    this.stop()
    void this.ctx.resume()
    const source = this.ctx.createBufferSource()
    source.buffer = this.buffer
    source.connect(this.ctx.destination)
    source.onended = () => {
      if (!this.stopping && this.source === source) {
        this.source = null
        // Natural end: the playhead rests at the end of the audio.
        this.startOffsetMs = this.durationMs
        this.onEnded?.()
      }
    }
    if (fromMs >= 0) {
      source.start(0, fromMs / 1000)
    } else {
      source.start(this.ctx.currentTime - fromMs / 1000, 0)
    }
    this.source = source
    this.startCtxTime = this.ctx.currentTime
    this.startOffsetMs = fromMs
  }

  /** Stops playback and returns the chart time where it stopped. */
  stop(): number {
    const t = this.timeMs()
    if (this.source) {
      this.stopping = true
      try {
        this.source.stop()
      } catch {
        // already stopped
      }
      this.source.disconnect()
      this.source = null
      this.stopping = false
    }
    return t
  }

  /** Current playback position in chart time. */
  timeMs(): number {
    if (!this.ctx || !this.source) return this.startOffsetMs
    return this.startOffsetMs + (this.ctx.currentTime - this.startCtxTime) * 1000
  }

  /**
   * Min/max amplitude in the given time span, or null when the span is
   * outside the audio. Spans wider than two buckets use the peak table;
   * narrow spans read raw samples.
   */
  peakRange(t0Ms: number, t1Ms: number): [number, number] | null {
    const mono = this.mono
    const peaks = this.peaks
    if (!mono || !peaks) return null
    let s0 = Math.floor((t0Ms / 1000) * this.sampleRate)
    let s1 = Math.ceil((t1Ms / 1000) * this.sampleRate)
    if (s1 <= 0 || s0 >= mono.length) return null
    s0 = Math.max(0, s0)
    s1 = Math.min(mono.length, Math.max(s1, s0 + 1))

    let lo = Infinity
    let hi = -Infinity
    if (s1 - s0 >= peaks.bucketSize * 2) {
      const b0 = Math.floor(s0 / peaks.bucketSize)
      const b1 = Math.min(peaks.min.length - 1, Math.floor((s1 - 1) / peaks.bucketSize))
      for (let b = b0; b <= b1; b++) {
        if (peaks.min[b] < lo) lo = peaks.min[b]
        if (peaks.max[b] > hi) hi = peaks.max[b]
      }
    } else {
      for (let i = s0; i < s1; i++) {
        const v = mono[i]
        if (v < lo) lo = v
        if (v > hi) hi = v
      }
    }
    return lo <= hi ? [lo, hi] : null
  }
}

/** The app-wide playback engine (the editor edits one chart at a time). */
export const audioEngine = new AudioEngine()
