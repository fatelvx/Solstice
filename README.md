<picture>
  <source
    srcset="https://img.shields.io/badge/status-alpha-orange?style=flat-square"
    media="(prefers-color-scheme: dark)"
  />
  <img src="https://img.shields.io/badge/status-alpha-orange?style=flat-square" alt="status" />
</picture>
<picture>
  <source
    srcset="https://img.shields.io/badge/license-MIT-blue?style=flat-square"
    media="(prefers-color-scheme: dark)"
  />
  <img src="https://img.shields.io/badge/license-MIT-blue?style=flat-square" alt="license" />
</picture>
<picture>
  <source
    srcset="https://img.shields.io/badge/PRs-welcome-brightgreen?style=flat-square"
    media="(prefers-color-scheme: dark)"
  />
  <img src="https://img.shields.io/badge/PRs-welcome-brightgreen?style=flat-square" alt="PRs" />
</picture>

# Solstice

**The all-in-one toolkit for rhythm game mappers.** Solstice combines an editor, format converter, and pack manager into a single cross-platform desktop app — built for the VSRG community, by the VSRG community.

---

## Features

| Module | What it does | Status |
|---|---|---|
| **Editor** | Full-featured charting UI based on the Arrow Vortex paradigm, rebuilt in Rust + React. Canvas/WebGL rendering, timing grids, snap, waveform display. | 🏗️ In progress |
| **Converter** | Format conversion engine. Parses external formats into `.sol` and exports back out — the editor never touches raw `.osu` or `.sm` files. | 🏗️ In progress |
| **Pack Manager** | Git-like version control for map packs. Self-implemented diff engine with human-readable changelogs. | 📋 Planned |

---

## The `.sol` Format

The superpower: a **universal YAML intermediate format**. Every module reads and writes `.sol` — external formats are parsed *into* `.sol` and exported *from* `.sol`. No module needs to know about the quirks of `.osu`, `.sm`, or any other format.

```
.osu / .sm / .ssc / .qua  ──→  parse  ──→  .sol (YAML)  ──→  export  ──→  .osu / .sm / ...
```

### Supported Formats

| Format | Import | Export |
|---|---|---|
| osu!mania (`.osu`) | ✅ | ✅ |
| Etterna / StepMania (`.sm` / `.ssc`) | ✅ | ✅ |
| Malody | 🔜 | 🔜 |
| Quaver | 🔜 | 🔜 |

---

## Quick Start

```bash
# Prerequisites: Rust, Node.js 18+, and Tauri system deps
# https://v2.tauri.app/start/prerequisites/

git clone https://github.com/fatelvx/Solstice.git
cd Solstice
npm install
npm run tauri dev    # dev mode with hot reload
npm run tauri build  # production build → .msi / .dmg / .AppImage
```

---

## Tech Stack

| Layer | Technology |
|---|---|
| Framework | [Tauri v2](https://v2.tauri.app) |
| Backend / Logic | [Rust](https://www.rust-lang.org/) |
| Frontend / UI | [React 19](https://react.dev/) + [TypeScript](https://www.typescriptlang.org/) + [Vite](https://vite.dev/) |
| Linting | ESLint + TypeScript strict |
| CI / CD | GitHub Actions + [Release Please](https://github.com/googleapis/release-please) |

---

## Project Structure

```
Solstice/
├── src/                  # React frontend
│   ├── components/       #   UI components (common/, converter/, editor/)
│   ├── hooks/            #   Custom React hooks
│   ├── stores/           #   Zustand stores
│   └── assets/           #   Images and static assets
├── src-tauri/            # Rust backend
│   ├── src/
│   │   ├── models/       #   Data models
│   │   ├── formats/      #   Format parsers/exporters
│   │   ├── converter/    #   Conversion engine
│   │   └── editor/       #   Editor backend logic
│   └── tauri.conf.json   # Tauri configuration
├── maps/                 # Local map storage
├── .github/workflows/    # CI/CD pipelines
├── CONTRIBUTING.md       # Contribution guide
├── AGENTS.md             # AI assistant context
└── README.md
```

---

## Contributing

Open source from day one — PRs welcome.

- **Branches:** `main` (stable), `dev` (development), `feat/*`, `fix/*`, `chore/*`
- **Commits:** [Conventional Commits](https://www.conventionalcommits.org/) enforced by commitlint + husky
- **Releases:** Fully automated via Release Please — never bump versions manually
- **Builds:** Automatic `.msi`, `.dmg`, `.AppImage` on every release

See [CONTRIBUTING.md](./CONTRIBUTING.md) for the full workflow.

---

## Team

| Person | Module | GitHub |
|---|---|---|
| kesrie | Editor | [@fatelvx](https://github.com/fatelvx) |
| Kaan | Converter | [@kaanreal](https://github.com/kaanreal) |

---

## License

[MIT](./LICENSE)
