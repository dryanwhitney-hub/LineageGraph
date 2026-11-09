# Repository Guide

## Project shape

- **Frontend:** Vue 3 (Composition API) + TypeScript built with Vite and packaged as a Tauri v2 desktop application.
  - Entry point: `src/main.ts`. Primary shell: `src/App.vue`.
  - Views: Table view (`src/components/table/PersonTableView.vue`), Canvas tree (`src/components/tree/TreeCanvasView.vue`), Design studio (`src/components/DesignTree.vue`), Export hub (`src/components/ExportView.vue`).
  - Core composables: `src/composables/usePersons.ts` (Entity state & mutations), `useShortestPath.ts` (BFS/A* pathfinding), `useDesignLayout.ts` (Pedigree layout), `useDesignHistory.ts` (Undo/Redo).
  - Localization: `src/locales/de.json` and `src/locales/en.json`, configured in `src/i18n.ts`.
- **Backend:** Rust 2024 / Tauri v2 application located in `src-tauri/`.
  - Main & command router: `src-tauri/src/lib.rs` (39 registered IPC commands, AppState mutex holding active SQLite connection).
  - Persistence & schema: `src-tauri/src/db.rs` (schema definition, migrations, Henry-code utilities).
  - Domain services:
    - `src-tauri/src/parser.rs`: Atomic full GEDCOM 5.5/5.5.1 stream import.
    - `src-tauri/src/gedcom_import_merge.rs`: 3-way differential GEDCOM staging, heuristic scoring, conflict diff & merge.
    - `src-tauri/src/gedcom_export.rs`: Scoped GEDCOM export (All, Descendants, Ancestors, SpecificList).
    - `src-tauri/src/csv_export.rs`: Scoped CSV export with UTF-8 BOM and delimiter selection.
- **Data storage:** Isolated SQLite databases (`<tree_name>.db`, `-wal`, `-shm`) stored locally in the OS application data directory (`AppState.app_dir`).

## Commands

- `npm run dev`: Starts the Vite development server.
- `npm run build`: Runs TypeScript verification (`vue-tsc --noEmit`) and creates the frontend production bundle.
- `npm run tauri dev`: Runs the full Tauri desktop application in development mode.
- `cargo check --manifest-path src-tauri/Cargo.toml`: Type-checks the Rust backend.
- `cargo test --manifest-path src-tauri/Cargo.toml`: Runs the Rust automated unit/integration test suite.

Tauri's configured build hooks run `npm run build` before packaging. Use the existing package scripts and Rust toolchain; do not introduce a second build system.

## Change guidance

### Codebase & Architecture
- **IPC & Payloads:** Keep frontend and backend command names and serialized payloads in exact sync when modifying or adding Tauri commands.
- **Database integrity:** Keep all SQLite schema definitions and runtime migrations centralized in `src-tauri/src/db.rs`. Always preserve `PRAGMA foreign_keys = ON;` and `PRAGMA journal_mode = WAL;`.
- **Windows Filelock Safety:** When disconnecting or deleting databases, always flush WAL (`wal_checkpoint(TRUNCATE)`) and swap the active connection to in-memory before file removal to prevent Windows sharing violations.
- **Transaction Safety:** GEDCOM full imports clear and replace records in the active tree inside a single database transaction. GEDCOM merge operations must also run atomically.
- **Localization:** Never hardcode user-facing strings in Vue templates. Always add keys to both `src/locales/de.json` and `src/locales/en.json`.
- **Scope Discipline:** Keep changes strictly scoped to the task. Do not edit generated files under `src-tauri/gen/` or build output.

### ALM Documentation Maintenance
Whenever code modifications introduce, change, or deprecate functional capabilities, schema fields, Tauri commands, or UI workflows, you **MUST** update the ALM documentation suite to keep traceability intact:

1. **`REQ.md` (Requirements):**
   - Add or update the corresponding requirement (`REQ-<DOMÄNE>-<NR>`).
   - Specify the business value, acceptance criteria, and business rules.
2. **`SPEC.md` (Specifications):**
   - Map the requirement to a technical specification (`SPEC-<DOMÄNE>-<NR> -> REQ-...`).
   - Document the architectural layer, affected files, data flow, structs/composables, and algorithms.
3. **`Architecture.md` (Architecture & Traceability Matrix):**
   - Update the Traceability Matrix (`REQ-ID` | `Requirement` | `SPEC-ID` | `Layer` | `Source Files`).
   - If architectural tiers, IPC bridges, or DB entities change, update the Mermaid component or ER diagrams.
4. **`TEST_CASES.md` (Test & Quality):**
   - Add or adapt the test case (`TC-<DOMÄNE>-<NR>`).
   - Maintain the end-to-end matrix (`REQ-ID` -> `SPEC-ID` -> `TC-ID`) with test type and coverage level.
5. **`USER_GUIDE.md` (User Manual):**
   - If the change affects visible functionality or user workflows, document it in clear, non-technical language following the three-part structure: *What does it do?*, *How do I use it?*, and *What is the result?*.
6. **`INDEX.md` (Navigation Hub):**
   - Ensure all section links, counts, and domain references remain consistent.

### Software Bill of Materials (SBOM) Maintenance
- The project maintains a CycloneDX 1.7 Software Bill of Materials in `sbom-cyclonedx.json` (generated via Syft from `package-lock.json` and `src-tauri/Cargo.lock`).
- **Trigger:** Whenever dependencies are added, updated, or removed in `package.json` / `package-lock.json` or `src-tauri/Cargo.toml` / `src-tauri/Cargo.lock`:
  - Regenerate or update `sbom-cyclonedx.json` using Syft (`syft dir:. -o cyclonedx-json=sbom-cyclonedx.json`) or an equivalent CycloneDX generator.
  - If Syft is not installed in the local environment, update `sbom-cyclonedx.json` metadata/components or note the pending SBOM regeneration in your change summary.
