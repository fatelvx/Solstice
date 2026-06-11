# Solstice

Universal rhythm game toolkit — editor, converter, and pack manager.

## Prerequisites

- **Node.js** >= 20
- **Rust** (install via [rustup.rs](https://rustup.rs/))
- **Platform-specific:**
  - **Windows:** nothing extra
  - **macOS:** Xcode CLI tools (`xcode-select --install`)
  - **Linux:** `sudo apt install libwebkit2gtk-4.1-dev libgtk-3-dev librsvg2-dev patchelf libayatana-appindicator3-dev`

## Setup

```bash
git clone https://github.com/fatelvx/Solstice.git
cd Solstice
npm install
```

## Run

```bash
npm run tauri dev     # desktop app with hot reload
npm run tauri build   # production build (.msi / .dmg / .AppImage)
```

Frontend-only (no Tauri):
```bash
npm run dev           # http://localhost:5173
```

## Project Structure

```
src/                  # React frontend
  components/
    common/           # Shared UI components
    converter/        # Converter UI
    editor/           # Chart editor UI
  hooks/              # Custom React hooks
  stores/             # Zustand state stores

src-tauri/            # Rust backend
  src/
    models/           # Data models (.sol schema, note/timing structs)
    formats/          # Format parsers/exporters (.osu, .sm, .ssc, .qua)
    converter/        # Conversion engine
    editor/           # Editor backend logic

maps/                 # Local beatmap storage
tests/                # Tests
```

## Tech Stack

| Layer | Tech |
|---|---|
| Frontend | React 19, TypeScript 6, Vite 8 |
| Desktop | Tauri v2 (Rust) |
| State | Zustand |
| Styling | CSS (vanilla) |
| Build | GitHub Actions + Release Please |

## Development Guidelines

- **No `@tauri-apps/*` imports in UI components** — use an abstraction layer so the same code can run in a browser later
- **Commits:** `feat:` / `fix:` trigger version bumps — use `chore:` for silent commits
- **Branches:** `dev` ← `feat/*`, `fix/*`; `main` is release-only
- **PRs:** squash-merge into `dev`, reviewed by a teammate
- **Lint:** `npm run lint` before pushing
- **Rust:** `cargo clippy` (run in `src-tauri/`)

## Releases

Automated via Release Please. Merge the release PR to produce a tagged release with cross-platform builds. No manual versioning.
