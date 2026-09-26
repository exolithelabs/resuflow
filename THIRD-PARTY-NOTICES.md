# Third-party notices

ResuFlow includes third-party software. Their licenses remain separate
from the Apache-2.0 license for ResuFlow itself.

## Direct JavaScript dependencies

- `@modelcontextprotocol/sdk` — MIT
- `marked` — MIT
- `open` — MIT
- `playwright` — Apache-2.0
- `sanitize-html` — MIT
- `zod` — MIT

The desktop build also uses `@tauri-apps/cli` (Apache-2.0 OR MIT) during
development and packaging. The Rust desktop shell directly depends on Tauri,
Serde, Serde JSON, and UUID, which are distributed under MIT and/or
Apache-2.0 terms. The complete dependency manifests and package metadata are
included in the source tree; bundled JavaScript dependencies retain their
upstream license files.

Please consult each dependency's own license and notice files when
redistributing a modified build.
