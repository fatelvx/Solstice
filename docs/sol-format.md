# The `.sol` Chart Format (v1)

`.sol` is Solstice's universal internal chart format. It is a YAML document
that represents one chart (one difficulty) of a vertical-scrolling rhythm game
map. The schema is the superset of the data that Henkan's osu!mania and
SM/Etterna parsers actually handle, so any chart that survives a Henkan
conversion round-trips through `.sol` without loss.

One `.sol` file = one chart. A song folder may contain several `.sol` files
(one per difficulty) next to the shared audio/background assets, mirroring how
`.osu` files work.

All times are **milliseconds** from the start of the audio file, stored as
floats. This matches Henkan's internal `Beatmap` model (osu!'s native timeline)
and keeps SM/Etterna data exact, because beat-based SM values are converted to
ms by the importer using the same arithmetic Henkan uses.

## Top level

```yaml
sol: 1            # format version, required, integer
meta: { ... }     # song / chart metadata
files: { ... }    # asset file references, relative to the .sol file
chart: { ... }    # gameplay parameters
timing: { ... }   # BPM, SV, stops, preview
notes: [ ... ]    # note data
```

Unknown keys are ignored by readers (forward compatibility). Writers must only
emit keys defined here for the declared version.

## `meta`

| key          | type   | required | osu!mania source | SM/Etterna source |
|--------------|--------|----------|------------------|-------------------|
| `title`      | string | yes      | `Title`          | `#TITLE`          |
| `artist`     | string | yes      | `Artist`         | `#ARTIST`         |
| `creator`    | string | yes      | `Creator`        | `#CREDIT`         |
| `difficulty` | string | yes      | `Version`        | chart description slot of `#NOTES` |
| `source`     | string | no (default `""`) | `Source` | `#GENRE` (Henkan convention) |
| `tags`       | string | no (default `""`) | `Tags`   | — (not representable) |

## `files`

Paths are relative to the directory containing the `.sol` file. Forward
slashes only.

| key          | type   | required | osu!mania source       | SM/Etterna source |
|--------------|--------|----------|------------------------|-------------------|
| `audio`      | string | yes      | `AudioFilename`        | `#MUSIC`          |
| `background` | string | no       | `[Events]` background  | `#BACKGROUND`     |
| `banner`     | string | no       | —                      | `#BANNER`         |
| `cdtitle`    | string | no       | —                      | `#CDTITLE`        |

## `chart`

| key      | type   | required | notes |
|----------|--------|----------|-------|
| `keys`   | int    | yes      | column count, 1–32 (osu `CircleSize`, SM steptype: `dance-single`=4, `pump-single`=5, `dance-solo`=6, `kb7-single`=7, `dance-double`=8, `pump-double`=10) |
| `origin` | string | no (default `sol`) | `osu_mania`, `etterna` or `sol`; the format the chart was first imported from |

## `timing`

| key          | type  | required | meaning |
|--------------|-------|----------|---------|
| `offset_ms`  | float | no (default `0`) | The time at which **beat 0** of the global beat grid occurs. SM: `-#OFFSET * 1000`. osu!: derived from the first uninherited timing point (pulled back a whole number of measures so it is ≤ 0, as Henkan's exporter does). The editor's row grid is anchored here. |
| `preview_ms` | float | no (default `0`) | Song-select preview start. osu `PreviewTime`, SM `#SAMPLESTART * 1000`. |
| `lead_in_ms` | float | no (default `0`) | osu `AudioLeadIn`. No SM equivalent. |
| `bpms`       | list  | yes (≥ 1 entry) | BPM changes, ascending by `ms`. |
| `svs`        | list  | no (default `[]`) | Scroll-velocity multipliers (osu inherited points). Ascending by `ms`. |
| `stops`      | list  | no (default `[]`) | SM `#STOPS`. Ascending by `ms`. |

### `bpms` entries

```yaml
- {ms: 752.0, bpm: 154.4, meter: 4}
```

| key     | type  | required | meaning |
|---------|-------|----------|---------|
| `ms`    | float | yes      | time of the BPM change |
| `bpm`   | float | yes      | beats per minute (`60000 / beat_length` for osu) |
| `meter` | int   | no (default `4`) | beats per measure (osu timing-point meter; SM has no per-change meter) |

### `svs` entries

```yaml
- {ms: 3000.0, mult: 0.5}
```

`mult` is the scroll multiplier (osu: `-100 / beat_length` of an inherited
point). SM/Etterna has no SV; exporters to SM drop this list.

### `stops` entries

```yaml
- {ms: 8000.0, duration_ms: 250.0}
```

A stop freezes scrolling at `ms` for `duration_ms`. `ms` is the time the stop
*begins*; BPM entries later in the timeline already account for elapsed stop
time (the SM importer folds `#STOPS` into the ms timeline exactly like
Henkan's `build_timing` does). osu!mania has no stops; exporters to osu must
have already baked them into note/BPM times, which the ms-based timeline
guarantees.

## `notes`

A list sorted ascending by `ms`, then by `col`. One entry per note:

```yaml
- {ms: 1000.0, col: 0}                     # tap
- {ms: 1500.0, col: 1, end_ms: 2500.0}     # hold
```

| key      | type  | required | meaning |
|----------|-------|----------|---------|
| `ms`     | float | yes      | hit time |
| `col`    | int   | yes      | 0-based column, `< chart.keys` |
| `end_ms` | float | no       | hold release time; present ⇔ the note is a hold. Must be `> ms`. |

osu!mania mapping: tap = type-1 hit object, hold = type-128 with end time.
SM mapping: tap = `1`, hold = `2`…`3` span (rolls `4` are imported as holds,
matching Henkan).

## Derived data (never stored)

* chart duration — `max(end_ms ?? ms)` over all notes (Henkan
  `compute_duration`).
* per-note beat/row positions — the editor quantizes ms to its internal
  48-rows-per-beat grid on load (ArrowVortex semantics) and re-derives ms on
  save.

## Example

```yaml
sol: 1
meta:
  title: "Test Song"
  artist: "Test Artist"
  creator: "TestMapper"
  difficulty: "Another"
  source: "Game"
  tags: "test song"
files:
  audio: "song.mp3"
  background: "bg.jpg"
chart:
  keys: 4
  origin: osu_mania
timing:
  offset_ms: -1000
  preview_ms: 30000
  lead_in_ms: 500
  bpms:
    - {ms: 1000, bpm: 120, meter: 4}
    - {ms: 5000, bpm: 240, meter: 4}
  svs:
    - {ms: 3000, mult: 1.0}
  stops: []
notes:
  - {ms: 1500, col: 0}
  - {ms: 2000, col: 1, end_ms: 3500}
```
