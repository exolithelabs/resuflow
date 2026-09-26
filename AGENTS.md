# AGENTS.md — ResuFlow

This repository is the **ResuFlow product**: a Windows direct-download desktop app and an Arch Linux pacman package with CLI-compatible entrypoints. It is not a personal resume catalog. User profile and resume data live in a separate workspace.

## Product model

- `bin/resuflow.mjs` is the CLI entrypoint.
- `src/` is the Node CLI, workspace I/O, HTTP API, PDF export, and desktop launcher.
- `web/` is the localhost Web UI (browser and Tauri webview).
- `src-tauri/` is the Tauri desktop shell. Shipping packages bundle Node and the app sources as a self-contained sidecar and load `http://127.0.0.1:4173/`.
- `distro/` is the Linux packaging source of truth: `distro/arch/PKGBUILD` plus generated `distro/arch/.SRCINFO` for pacman, the shared `resuflow.desktop` entry and AppStream metainfo under `distro/linux/`, and `distro/linux/build-arch-package.sh`, which builds the `.pkg.tar.zst` in CI.
- The Windows installer and the Arch Linux package are produced in GitHub Actions (`.github/workflows/desktop.yml`), not locally. Windows releases are currently unsigned and include a SHA-256 checksum plus GitHub provenance attestation. Tagged releases publish the Arch package, its checksum, the PKGBUILD input tarballs, and build-provenance attestations as GitHub Release assets.
- Windows packages are downloaded from the product website. Arch packages are downloaded from the latest GitHub release; manually rebuilding with the checked-in PKGBUILD is supported.
- `templates/` renders structured JSON to print-ready HTML.
- User data is **never** stored in this repo. It belongs in the workspace:
  - `profile.json`
  - `resumes/<slug>/resume.json`
  - generated PDFs under `resumes/<slug>/dist/` and `dist/`

Do not add personal names, employers, emails, or resume content here.

## Commands

```bash
# Install the Arch pacman package from the latest GitHub release (`sudo pacman -U resuflow-linux-<arch>.pkg.tar.zst`), or on Windows from the product website.
resuflow init [dir]
resuflow [dir]
resuflow --browser [dir]
resuflow serve [dir]
resuflow build [dir]
```

The server binds to `127.0.0.1` only and reads/writes the workspace directory. The desktop window and the browser can use the same server at the same time.

## Creating or changing resume content

When helping a user write resume text (in their workspace, not this repo):

1. `skills/resume-research/SKILL.md`
2. `skills/impact-writer/SKILL.md`
3. `skills/ats-optimizer/SKILL.md`
4. `skills/resume-critic/SKILL.md`

Do not invent employers, dates, metrics, technologies, credentials, or outcomes. If a claim is not supported by the user's workspace, public materials they point to, or explicit user input, mark it as needing verification.

## Resume principles

- Tailor each resume to a target role. Do not only swap the title.
- Prefer specific evidence over generic adjectives.
- Use numbers only when supported.
- Surface AI/technical skills only when the user can defend them in an interview.
- Keep output ATS-friendly: semantic HTML, standard section names, real text.

## Quality bar for the app

- End-user installs do not require Node.js or npm
- Windows is distributed as an NSIS installer
- The Windows installer adds its install directory to the current user's PATH and removes that entry on uninstall
- Public Windows installers are currently unsigned, explicitly disclosed as such, and accompanied by a SHA-256 checksum and GitHub provenance attestation
- Arch Linux is distributed only as the `resuflow` pacman package published on tagged GitHub releases; per-package GPG signatures are not used, so verify the published SHA-256 checksum and release attestation before installing
- The Arch package installs `/usr/bin/resuflow` plus a `resuflow-cli` alias, desktop entry, icons, and licenses; `/usr/bin` is already on PATH, so no profile scripts or hooks are involved
- CI builds the Arch package in an `archlinux:base` container, installs it in a clean container, and blocks the release on failure
- `npm run version:set -- <semver>` synchronizes npm, Tauri, Cargo, lockfiles, PKGBUILD, and .SRCINFO; `npm run distro:check` validates the Arch metadata
- `init` creates a workspace outside this repo
- First desktop launch creates a default workspace under Documents if none exists
- Default app launch opens the Tauri desktop window
- `--browser` still serves the same UI on localhost
- While running, MCP is at `http://127.0.0.1:4173/mcp` for external agents and requires the per-process bearer token shown in the app
- Website download packages come from the Desktop downloads GitHub Actions workflow
- Tagged Windows and Linux builds publish a GitHub Release, and the app checks that public release feed for newer-version notifications
- Release tags and npm/Tauri/Cargo/PKGBUILD/.SRCINFO versions must match; use `npm run version:set -- <semver>`
- Creating, editing, previewing, and exporting a resume works without touching app source
- PDFs print cleanly to A4
- No user data is committed to this repository
