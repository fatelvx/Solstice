# Contributing

## Getting Started

```bash
git clone https://github.com/fatelvx/Solstice.git
cd Solstice
npm install
npm run prepare    # sets up husky git hooks
npm run tauri dev  # launch dev environment
```

---

## Branch Naming

| Branch | Purpose |
|---|---|
| `main` | Stable releases. Protected — no direct pushes. |
| `dev` | Main development branch. Protected — all PRs target this. |
| `feat/<slug>` | New features (branch from `dev`) |
| `fix/<slug>` | Bug fixes (branch from `dev`) |
| `chore/<slug>` | Tooling, deps, non-functional (branch from `dev`) |

---

## Commit Convention

We use [Conventional Commits](https://www.conventionalcommits.org/). Commits are linted automatically via husky + commitlint.

```
<type>(<scope>): <description>

[optional body]

[optional footer]
```

### Types

| Type | Usage | Release bump |
|---|---|---|
| `feat` | New feature | minor |
| `fix` | Bug fix | patch |
| `chore` | Maintenance, tooling | none |
| `docs` | Documentation | none |
| `refactor` | Code change with no behavior change | none |
| `test` | Adding/fixing tests | none |
| `style` | Formatting, semicolons | none |
| `perf` | Performance improvement | none |
| `ci` | CI/CD changes | none |

**Breaking changes:** append `!` after the type (`feat!:`) or add `BREAKING CHANGE:` in the body → triggers a major version bump.

### Examples

```
feat(editor): add long note hold rendering
fix(converter): apply -50ms offset on osu→sm export
docs(readme): update supported formats table
refactor(core): extract timing calc into separate module
chore(deps): update tauri to 2.11.2
```

---

## Pull Request Workflow

1. Branch from `dev` using the naming convention above.
2. Make your changes. Keep commits atomic and well-named.
3. Push and open a PR against `dev`.
4. CI runs lint → typecheck → build automatically.
5. Request review from the other team member.
6. After approval, **squash-merge** into `dev`.

### PR Title

Must follow Conventional Commits format — it becomes the commit message on squash-merge.

```
feat(editor): add snap grid overlay
fix(converter): handle negative audio offsets
```

### PR Description

Use the template at `.github/PULL_REQUEST_TEMPLATE.md`. Include what the PR does, any related issues, and testing notes.

---

## Release Process

Fully automated. No manual version bumps, no manual changelogs, no manual builds.

1. **Release Please** watches `main`. It maintains a "release PR" with an auto-generated changelog based on conventional commits since the last release.
2. When the release PR is **merged**, Release Please creates a GitHub Release with the changelog and tags the commit.
3. A GitHub Actions workflow triggers on the release tag and **builds platform artifacts**:
   - `.msi` (Windows)
   - `.dmg` (macOS)
   - `.AppImage` (Linux)
4. Artifacts are uploaded to the release automatically.

**Do not** edit `version` in `Cargo.toml`, `tauri.conf.json`, or `package.json` manually — Release Please handles all version bumps.

---

## Code Quality

### Before pushing / opening a PR

```bash
npm run lint       # ESLint
npm run typecheck  # TypeScript strict check
npm run format     # Prettier formatting
```

### Rust

- Follow `cargo fmt` and `cargo clippy` defaults
- Run `cargo clippy --all-targets --all-features` before pushing

### TypeScript/React

- ESLint and TypeScript strict mode are configured
- Prettier handles formatting (run via `npm run format` or let your editor do it)

---

## AI-Assisted Development

If you're using AI coding tools, `AGENTS.md` at the project root contains the project context and conventions. Most AI tools read this file automatically.
