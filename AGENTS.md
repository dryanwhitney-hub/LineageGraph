# Repository Guide

## Project shape

- This is a Vue 3 + TypeScript frontend built with Vite and wrapped in a Tauri v2 desktop application.
- Frontend entry point: `src/main.ts`. The primary UI is in `src/App.vue`; translations are in `src/locales/` and configured in `src/i18n.ts`.
- Rust/Tauri backend: `src-tauri/src/lib.rs`. It registers commands invoked by the frontend and manages the active SQLite connection.
- Database setup and schema migrations: `src-tauri/src/db.rs`. GEDCOM parsing and import: `src-tauri/src/parser.rs`.

## Commands

- `npm run dev` starts the Vite frontend.
- `npm run build` runs Vue/TypeScript checks and creates the frontend production build.
- `npm run tauri dev` runs the desktop application in development.
- `cargo check --manifest-path src-tauri/Cargo.toml` checks the Rust backend.
- `cargo test --manifest-path src-tauri/Cargo.toml` runs Rust tests.

Tauri's configured build hooks run `npm run build` before packaging. Use the existing package scripts and Rust toolchain; do not introduce a second build system.

## Change guidance

- Keep frontend/backend command names and serialized payloads in sync when changing Tauri commands.
- Keep database schema changes and their migrations together in `src-tauri/src/db.rs`.
- GEDCOM imports clear and replace records in the currently selected tree inside a transaction. Preserve that behavior deliberately, and account for it when changing import flow.
- Preserve the existing Vue, TypeScript, Rust, and localization conventions. Add or update translations in both `src/locales/en.json` and `src/locales/de.json` for user-facing strings.
- Keep changes scoped to the feature; do not modify generated files under `src-tauri/gen/` or build output unless the task specifically requires it.
