# Solstice — AI Context

## Project

Universal rhythm game toolkit: editor + converter + pack manager.
Tauri v2 desktop app (Rust backend, React 19 + TypeScript + Vite frontend).

## Key Files

| Path | Purpose |
|---|---|
| `src-tauri/src/lib.rs` | Tauri app entry, command registration |
| `src-tauri/src/main.rs` | Binary entry point |
| `src-tauri/src/models/` | Rust data models (`.sol` schema) |
| `src-tauri/src/formats/` | Format parsers/exporters (`.osu`, `.sm`, etc.) |
| `src-tauri/src/converter/` | Conversion engine |
| `src-tauri/src/editor/` | Editor backend logic |
| `src/App.tsx` | React root component |
| `src/components/` | UI components |
| `src/stores/` | Zustand state stores |
| `commitlint.config.js` | Conventional Commits config |
| `tauri.conf.json` | Tauri app configuration |

## Conventions

- **Commits:** Conventional Commits (`feat:`, `fix:`, `chore:`, `docs:`, `refactor:`, `test:`)
- **Branches:** `dev` ← `feat/*`, `fix/*`, `chore/*`; `main` is release-only
- **PRs:** All changes go through PRs into `dev`, squash-merged, reviewed by the other team member
- **Releases:** Automated via Release Please — never manually bump versions
- **CI:** Runs lint, typecheck, and cross-platform build on every push/PR

## Tech Notes

- `.sol` is a YAML-based universal intermediate format
- All Rust structs should derive `Serialize`/`Deserialize`
- Frontend state managed with Zustand
- Rust handles core logic (parsing, timing, conversion); React handles rendering and interaction
- Tauri commands bridge Rust → frontend

## Quick Commands

```bash
npm run dev          # Vite dev server
npm run tauri dev    # Full Tauri dev mode
npm run tauri build  # Production build
npm run lint         # ESLint
npm run typecheck    # TypeScript check
npm run format       # Prettier
cargo clippy         # Rust lints (in src-tauri/)
```
