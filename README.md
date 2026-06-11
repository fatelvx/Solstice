# Solstice

> The all-in-one toolkit for rhythm game mappers.

Solstice is a universal rhythm game tool that brings together an editor, converter, and pack manager into a single platform - built for the VSRG community, by the VSRG community.

---

## Features

- **Editor** - Charter UI rebuilt from the ground up, based on Arrow Vortex but without the baggage
- **Converter** - Accurate, timing-correct format conversion between rhythm game formats
- **Pack Manager** - Git-like version control for your map packs *(coming soon)*

---

## Supported Formats

| Format | Import | Export |
|---|---|---|
| osu!mania (`.osu`) | ✅ | ✅ |
| Etterna / StepMania (`.sm` / `.ssc`) | ✅ | ✅ |
| Malody | 🔜 | 🔜 |
| Quaver | 🔜 | 🔜 |

---

## Universal Format - `.sol`

Solstice uses `.sol` (YAML) as its internal universal format. All modules speak `.sol` - no module needs to know about external formats directly.

```text
.osu / .sm / .ssc / .qua
          ↓ parse
       .sol (YAML)
          ↓ export
.osu / .sm / .ssc / .qua
```

---

## Tech Stack

- [Tauri](https://tauri.app/) - Cross-platform framework
- [Rust](https://www.rust-lang.org/) - Core logic, parsing, timing
- [React](https://react.dev/) + [TypeScript](https://www.typescriptlang.org/) - UI layer

---

## Development

### Prerequisites

- [Node.js](https://nodejs.org/) 18+
- [Rust](https://www.rust-lang.org/tools/install)
- [Tauri CLI](https://tauri.app/start/prerequisites/)

### Getting Started

```bash
git clone https://github.com/fatelvx/Solstice.git
cd Solstice
npm install
npm run tauri dev
```

---

## Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md) for branch rules, commit style, and PR guidelines.

---

## Team

| | Role |
|---|---|
| https://github.com/fatelvx | Editor module |
| [Kaan](https://github.com/kaanreal) | Converter module |

---

## License

MIT
