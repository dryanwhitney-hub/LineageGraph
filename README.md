# LineageGraph (Froning Familienbuch)

Eine plattformübergreifende Desktop-Anwendung zur Erfassung, Verwaltung, computergestützten genealogischen Analyse, visuellen Aufbereitung und Veröffentlichung von Familiengeschichten.

- **Frontend:** Vue 3 + TypeScript + Vite + HTML5 Canvas & SVG
- **Backend:** Tauri v2 + Rust 2024 + Rusqlite (WAL-Modus)
- **Persistenz:** Lokale SQLite-Datenbanken im Anwendungsdatenverzeichnis

---

## Dokumentation & ALM-Spezifikationen

Die gesamte Dokumentation ist modular strukturiert und über den zentralen **[INDEX.md](file:///c:/dev/Froning/app/LineageGraph/INDEX.md)** zugänglich:

- **[INDEX.md](file:///c:/dev/Froning/app/LineageGraph/INDEX.md):** Zentraler Dokumentations- und Navigations-Hub
- **[USER_GUIDE.md](file:///c:/dev/Froning/app/LineageGraph/USER_GUIDE.md):** Umfassendes Anwenderhandbuch für Endnutzer & Genealogen
- **[REQ.md](file:///c:/dev/Froning/app/LineageGraph/docs/REQ.md):** Fachliches Anforderungsdokument (Requirements Specification)
- **[SPEC.md](file:///c:/dev/Froning/app/LineageGraph/docs/SPEC.md):** Technische Spezifikation & Komponenten-Mapping
- **[Architecture.md](file:///c:/dev/Froning/app/LineageGraph/docs/Architecture.md):** C4/Komponenten-Architekturschaubild & Traceability-Matrix
- **[TEST_CASES.md](file:///c:/dev/Froning/app/LineageGraph/docs/TEST_CASES.md):** Test- und Qualitäts-Dokument (Unit-, Component- & Integrationstests)

---

## Entwicklung & Build

- `npm run dev` startet den Vite-Entwicklungsserver für das Frontend.
- `npm run build` führt die TypeScript-Typenprüfung (`vue-tsc`) und den Produktions-Build durch.
- `npm run tauri dev` startet die vollständige Desktop-Anwendung im Entwicklungsmodus.
- `cargo test --manifest-path src-tauri/Cargo.toml` führt alle Backend-Tests aus.
