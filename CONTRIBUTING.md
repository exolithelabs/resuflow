# Contributing to ResuFlow

ResuFlow is maintained as a personal open-source project. External code contributions are not currently accepted. Please do not open pull requests; they will be closed without review.

Bug reports and focused suggestions are welcome through the repository's [issue forms](https://github.com/exolithelabs/resuflow/issues/new/choose). Use the appropriate form so reports contain enough context to evaluate. Report security vulnerabilities privately according to [SECURITY.md](SECURITY.md).

## Project boundaries

- Open an issue for substantial features or changes to workspace formats.
- Keep application source and user workspaces separate.
- Never commit real resumes, profile data, credentials, signing keys, or generated workspaces.
- Preserve the local-first design and the `127.0.0.1` network boundary.

## Development

Install Node.js 20+, Rust stable, and the Tauri prerequisites for your operating system.

```bash
npm ci
npm test
npm run version:check
cargo test --manifest-path src-tauri/Cargo.toml
```

Create test workspaces outside the source checkout:

```bash
node bin/resuflow.mjs init ../resuflow-test-workspace
node bin/resuflow.mjs --browser --dir ../resuflow-test-workspace
```

You are welcome to fork the Apache-2.0-licensed project and modify your fork for your own needs. The development instructions above are provided for that purpose.
