# ResuFlow

Build focused, ATS-friendly resumes in a private local workspace.

Software built by Dhiraj Yadav for his own use, shared here for anyone who finds it useful.

ResuFlow combines a desktop editor, browser UI, CLI, PDF export, and an MCP endpoint for the AI agent you choose. Your profile and resumes remain ordinary Markdown files on your computer—the application does not upload them or bundle them into its installation.

[Overview](#overview) · [Features](#features) · [How it works](#how-it-works) · [Install](#install) · [CLI](#command-line) · [MCP](#connect-an-ai-agent-with-mcp) · [Privacy](#local-first-by-design) · [Development](#development) · [Releases](#releases-and-updates) · [License](#license)

## Overview

Most resume tools lock career information inside a hosted account or proprietary document. ResuFlow keeps the application separate from the data: the app can be upgraded or removed without affecting the user's resume workspace.

Use the desktop window for a focused experience, open the same interface in a regular browser, automate work from the CLI, or connect an external AI agent over MCP.

### Designed for

- Role-specific resume variants instead of one generic document.
- Markdown files that remain readable without the application.
- Print-ready A4 PDF exports with real, selectable text.
- External AI tools without embedding an LLM or API credentials in the app.
- Local workflows that can optionally be placed under the user's own version control.

## Features

### Local Markdown workspace

Profiles, resumes, memory, and custom agent skills live outside the application installation. Users can inspect, edit, back up, or version these files with normal filesystem tools.

### Desktop and browser interface

The Tauri desktop application starts a Node server bound to `127.0.0.1`. The same interface can be opened in the desktop window and a normal browser at the same time.

### Resume variants

Create independent resumes for different roles while sharing profile and contact information. Each resume has its own Markdown source, preview, status, tags, and generated PDF.

### PDF export

Render the selected resume into print-ready A4 HTML and PDF. Chromium is installed by Playwright on the first PDF export if it is not already available, so that first export may require an internet connection.

### Bring your own AI agent

ResuFlow does not run or require a built-in LLM. Connect Grok, Cursor, Codex, Gemini, or another MCP-compatible client and decide which provider receives the information you explicitly expose to it.

### Built-in writing guidance

The repository includes skills for resume research, impact writing, ATS optimization, and critique. Users can create additional skills inside their own workspace.

## How it works

```text
Desktop window or browser
          |
          v
Local server on 127.0.0.1
          |
          +-- Web UI
          +-- CLI
          +-- MCP endpoint
          +-- PDF renderer
          |
          v
User-controlled workspace
```

On first desktop launch, ResuFlow creates `Documents/ResuFlow` unless another workspace is selected.

```text
ResuFlow/
  resuflow.json
  profile.md
  memory.md
  skills/
  resumes/
    <slug>/
      resume.md
      dist/resume.pdf
  dist/
    <slug>.pdf
```

The application never creates a Git repository in the workspace. Version control remains optional and user-controlled.

## Install

### Windows

[Download ResuFlow for Windows](https://github.com/exolithelabs/resuflow/releases/latest/download/ResuFlow-Windows-x64-setup.exe)

[Download the SHA-256 checksum](https://github.com/exolithelabs/resuflow/releases/latest/download/ResuFlow-Windows-x64-setup.exe.sha256)

1. Download the `*-setup.exe` installer and its `.sha256` checksum.
2. Run the installer for the current Windows user.
3. Open ResuFlow from the Start menu or a newly opened terminal.

```powershell
resuflow
```

The installer adds ResuFlow to the current user's PATH. Uninstall it from **Windows Settings > Apps**; uninstall also removes the installer-managed PATH entry and never deletes resume workspaces.

Windows packages include the Node sidecar, so users do not need Node.js, npm, Microsoft Store, or another package manager.

Windows releases are currently unsigned and can display a Microsoft Defender SmartScreen **Unknown publisher** warning. Verify the published SHA-256 checksum before running the installer. Code signing may be added later when the project has an appropriate signing service.

### Linux (Arch)

[Download the ResuFlow pacman package](https://github.com/exolithelabs/resuflow/releases/latest/download/resuflow-linux-x86_64.pkg.tar.zst)

[Download the SHA-256 checksum](https://github.com/exolithelabs/resuflow/releases/latest/download/resuflow-linux-x86_64.pkg.tar.zst.sha256)

Two install flows are supported (replace `x86_64` with `aarch64` on ARM machines). Both also upgrade over an existing `resuflow` package.

**Option 1 — install straight from the release URL (no local file):**

```bash
sudo pacman -U https://github.com/exolithelabs/resuflow/releases/latest/download/resuflow-linux-x86_64.pkg.tar.zst
```

To pin an exact release instead of latest, use its versioned URL:

```bash
sudo pacman -U "https://github.com/exolithelabs/resuflow/releases/download/v0.1.1/resuflow-0.1.1-1-x86_64.pkg.tar.zst"
```

**Option 2 — download to a local folder first, then install the local file:**

```bash
cd ~/Downloads # or any folder you choose
curl -fsSLO \
  https://github.com/exolithelabs/resuflow/releases/latest/download/resuflow-linux-x86_64.pkg.tar.zst{,.sha256}
sha256sum -c resuflow-linux-x86_64.pkg.tar.zst.sha256 # optional but recommended
sudo pacman -U ./resuflow-linux-x86_64.pkg.tar.zst
```

If the file was already saved via the browser, just `cd` to that folder (or pass the full path) and install it:

```bash
cd ~/Downloads # or wherever the file was saved
sudo pacman -U ./resuflow-linux-x86_64.pkg.tar.zst
# Absolute paths work too:
sudo pacman -U "$HOME/Downloads/resuflow-linux-x86_64.pkg.tar.zst"
```

Run it with:

```bash
resuflow
```

Arch users can also rebuild from the published source tarball with the checked-in `distro/arch/PKGBUILD`. The package installs a `resuflow-cli` symlink with the same CLI commands, plus the desktop entry, icons, and licenses. `distro/linux/build-arch-package.sh` performs that build end to end (vendored dependency caches, pinned checksums, `makepkg`) and is the path CI runs.

## Command line

The application provides the same commands on Windows and Linux:

```text
resuflow [dir]               Open the desktop application
resuflow --browser [dir]     Open the localhost UI in a browser
resuflow serve [dir]         Start the localhost server only
resuflow init [dir]          Create a resume workspace
resuflow build [dir]         Generate PDFs for every resume
resuflow --help              Show command help
```

On Arch Linux, pass command-line arguments to either entry point. For example:

```bash
resuflow --browser ~/Documents/my-resumes
resuflow-cli --browser ~/Documents/my-resumes
```

Examples:

```bash
resuflow init ~/Documents/my-resumes
resuflow --browser ~/Documents/my-resumes
resuflow build ~/Documents/my-resumes
```

The server uses `http://127.0.0.1:4173/` by default. If that port is occupied, the desktop launcher starts its own verified sidecar on a free localhost port instead of trusting or reusing the existing process.

## Connect an AI agent with MCP

While the server is running, MCP is available at:

```text
http://127.0.0.1:4173/mcp
```

Use the port displayed by the running application if the default port was unavailable.

Generic MCP configuration:

```json
{
  "mcpServers": {
    "resuflow": {
      "url": "http://127.0.0.1:4173/mcp",
      "headers": {
        "Authorization": "Bearer <token shown by ResuFlow>"
      }
    }
  }
}
```

Copy the complete configuration, including the per-process token, from **Read docs** inside the running app. The token changes whenever the server restarts; do not publish or commit it. Available MCP operations include reading and writing resumes, profile data, memory, and user-created skills. Only connect clients you trust to the local endpoint.

## Local-first by design

- The server binds to `127.0.0.1`, not the public network.
- Local API and MCP requests require a random per-process token and reject untrusted Host and Origin headers.
- Resume data is stored in a user-selected workspace, never in this repository or the app installation.
- Removing or upgrading the application does not remove workspaces.
- The application contains no LLM credentials and does not choose an AI provider for the user.
- Connecting an external agent may send selected workspace content to that agent's provider under its own privacy policy.

## Development

Requirements:

- Node.js 20 or newer.
- Rust stable.
- Tauri system dependencies for the development operating system.

Install dependencies and start the browser development workflow:

```bash
npm ci
node bin/resuflow.mjs init ../my-resumes
node bin/resuflow.mjs --browser --dir ../my-resumes
```

Run the desktop development shell:

```bash
npm run desktop:dev
```

Useful verification commands:

```bash
npm run version:check
cargo test --manifest-path src-tauri/Cargo.toml
```

User data must never be added to this repository. Use a workspace outside the source checkout for development and testing.

## Releases and updates

### Windows releases

The [Windows desktop workflow](.github/workflows/desktop.yml) builds the NSIS installer when a `v*` tag is pushed or the workflow is started manually. Tagged builds publish a non-draft GitHub Release containing stable installer and checksum filenames, allowing the README and product website to use permanent latest-release download links.

Windows releases are currently published unsigned. Every release includes a SHA-256 checksum and a GitHub build-provenance attestation, and the release page explicitly identifies an unsigned installer. If Authenticode signing is added later, configure both encrypted GitHub Actions secrets using an exportable PFX code-signing certificate:

- `WINDOWS_CERTIFICATE`: base64-encoded PFX code-signing certificate.
- `WINDOWS_CERTIFICATE_PASSWORD`: PFX password.

If both secrets are absent, the workflow publishes the unsigned tagged installer. If only one secret is present or the PFX is invalid, the build fails. When both are valid, the certificate is imported only into the ephemeral GitHub-hosted runner and Tauri signs and timestamps the Windows package. Certificate files and private keys must never be committed.

### Linux releases

The [desktop downloads workflow](.github/workflows/desktop.yml) builds the Arch Linux `resuflow` pacman package on every `v*` tag (and on manual runs). Tagged builds publish the `.pkg.tar.zst` plus its `.sha256` checksum, the source tarball and vendored npm/Cargo caches that feed `distro/arch/PKGBUILD`, and a GitHub build-provenance attestation covering all of them. The `verify-linux` job installs the package into a fresh `archlinux:base` container via both `pacman -U <url>` and `pacman -U <local file>`, upgrades over the existing install, runs the desktop entry, CLI, and bundled Node sidecar end to end, and blocks publication if any of it fails.

Rebuild the exact release sources yourself with the checked-in PKGBUILD:

```bash
cd distro/arch
makepkg -s
```

Pacman treats x86_64 and aarch64 as separate packages; the versioned release filename carries the version, pkgrel, and architecture (`resuflow-<version>-1-x86_64.pkg.tar.zst`). Each release also publishes a stable alias (`resuflow-linux-x86_64.pkg.tar.zst`) so the README and product website can use permanent latest-release download links; use the versioned filename to pin an exact release.

### Version management

The release version is synchronized across npm, Tauri, Cargo, their lockfiles, and the Arch packaging metadata (`PKGBUILD` plus `.SRCINFO`):

```bash
npm run version:set -- 0.2.0
npm run version:check
git tag v0.2.0
```

GitHub Actions rejects a version tag that does not match the packaged version.

### Updating

- **Windows:** download and run the newer installer over the existing installation.
- **Linux (Arch):** install the newer package over the existing one, either straight from its URL or from a locally downloaded file:

```bash
sudo pacman -U https://github.com/exolithelabs/resuflow/releases/latest/download/resuflow-linux-x86_64.pkg.tar.zst
# or, from the folder holding the downloaded package:
sudo pacman -U ./resuflow-linux-x86_64.pkg.tar.zst
```

The app checks GitHub's latest public release in the background and displays a dismissible notification when a newer semantic version is available. Users can also run a fresh check from **Settings > Check for updates**. This uses GitHub's public API without credentials, is cached, and never blocks offline work. Automatic download and installation through the Tauri updater are not enabled yet; that requires a final HTTPS update-manifest URL and a separate updater-signing key pair.

## Uninstall

### Windows

Use **Windows Settings > Apps > ResuFlow > Uninstall**.

### Linux (Arch)

```bash
sudo pacman -Rns resuflow
```

Both uninstall paths preserve every resume workspace.

## Project status

ResuFlow is preparing for its initial open-source release. Review the issue tracker and release notes before relying on pre-release builds for critical data.

## Frequently asked questions

### Does ResuFlow upload my resumes?

No. The application itself reads and writes the selected local workspace. An external AI agent may transmit content according to that provider's behavior and privacy policy.

### Is an AI subscription required?

No. Resume editing, previewing, and PDF export work without an AI provider. MCP integration is optional.

### Can I use both the desktop app and a browser?

Yes. Use **Settings > Open in browser** while the desktop application is running.

### Will updating or uninstalling delete my resumes?

No. Application files and workspace data are deliberately stored separately.

### Where are Linux packages?

Linux users can install the Arch pacman package from the latest [GitHub release](https://github.com/exolithelabs/resuflow/releases/latest). Pacman is the only supported Linux distribution format.

## Contributing

External pull requests are not accepted and will be closed. Submit bug reports and focused suggestions through the structured [GitHub issue forms](https://github.com/exolithelabs/resuflow/issues/new/choose); see [CONTRIBUTING.md](CONTRIBUTING.md). Report security vulnerabilities privately according to [SECURITY.md](SECURITY.md), without attaching real resume data.

## License

ResuFlow is open-source software available under the [Apache License 2.0](LICENSE). Third-party dependencies retain their own licenses; see [THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md).

---

Built for people who want polished resumes without giving up ownership of their career data.
