// Mirrors the payload structs in src-tauri/src/editor/commands.rs.
// Field names are snake_case because serde serializes Rust field names as-is.

export interface Meta {
  title: string
  artist: string
  creator: string
  difficulty: string
  source: string
  tags: string
}

export interface FilesInfo {
  audio: string
  background?: string | null
  banner?: string | null
  cdtitle?: string | null
}

/** One span of constant tempo (editor/timing.rs `TimingEvent`). */
export interface TimingEvent {
  row: number
  time_ms: number
  end_time_ms: number
  ms_per_row: number
}

export interface NotePayload {
  row: number
  end_row: number
  col: number
  ms: number
  end_ms: number | null
}

export interface BpmPayload {
  row: number
  ms: number
  bpm: number
  meter: number
}

export interface StopPayload {
  row: number
  ms: number
  duration_ms: number
}

export interface ChartPayload {
  meta: Meta
  files: FilesInfo
  keys: number
  offset_ms: number
  preview_ms: number
  bpms: BpmPayload[]
  stops: StopPayload[]
  events: TimingEvent[]
  notes: NotePayload[]
  end_row: number
  dirty: boolean
  can_undo: boolean
  can_redo: boolean
  path: string | null
  audio_path: string | null
}
