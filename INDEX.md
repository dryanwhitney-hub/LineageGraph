# Dokumentations-Hub & System-Index: LineageGraph (Froning Familienbuch)

**System:** LineageGraph (*stammbaum*)  
**Dokument-Version:** 3.0.0  
**Datum:** 5. November 2026  
**Technologie-Stack:** Desktop-Applikation (Tauri v2 + Vue 3 + TypeScript + Rust 2024 + SQLite)

---

## Modulare Dokumentationsstruktur

Die Dokumentation von LineageGraph ist in fünf aufeinander abgestimmte Teildokumente mit durchgängiger **Traceability** aufgeteilt:

```
+----------------------------------------------------------------------------------------------------+
|                                              INDEX.md                                              |
|                               (Zentraler Dokumentations- & Navigations-Hub)                        |
+----------------------------------------------------------------------------------------------------+
           |                                       |                                       |
           v                                       v                                       v
+-----------------------+              +-----------------------+               +-----------------------+
|     USER_GUIDE.md     |              |        REQ.md         |               |    Architecture.md    |
| (Anwenderhandbuch für |              | (Fachliche            |               | (C4/Komponenten-      |
|  Familienforscher)    |              |  Anforderungen)       |               |  Architektur & ERD)   |
+-----------------------+              +-----------------------+               +-----------------------+
                                                   |                                       |
                                                   v                                       |
                                       +-----------------------+                           |
                                       |        SPEC.md        | <-------------------------+
                                       | (Technische           |                           |
                                       |  Spezifikationen)     |                           |
                                       +-----------------------+                           |
                                                   |                                       |
                                                   v                                       v
                                       +-------------------------------------------------------+
                                       |                     TEST_CASES.md                     |
                                       |    (Teststrategie, Testfälle & End-to-End Matrix)     |
                                       +-------------------------------------------------------+
```

---

## Die Dokumente im Detail

1. **[USER_GUIDE.md – Anwenderhandbuch](file:///c:/dev/Froning/app/LineageGraph/USER_GUIDE.md)**
   * Vollständiges, verständliches Handbuch für Endnutzer und Genealogen ohne technischen Jargon.
   * Schritt-für-Schritt-Anleitungen für alle 27 Funktionen (Nutzen, Bedienung, Ergebnis).
   * Praxistipps zu Datensicherheit (2-Stufen-Löschung), Rekursionsvermeidung, Update-Verwaltung und Merge-Konfliktlösung.

2. **[REQ.md – Fachliches Anforderungsdokument (Requirements Specification)](file:///c:/dev/Froning/app/LineageGraph/REQ.md)**
   * Enthält alle 27 fachlichen Anforderungen gegliedert nach 7 Domänen (`TRM`, `DAT`, `ALG`, `UI`, `DSG`, `IMP`, `EXP`).
   * Definiert für jede Anforderung: `REQ-ID`, Titel & Kurzbeschreibung, Fachlicher Zweck / Business Value sowie verbindliche Akzeptanzkriterien und Geschäftsregeln.
   * Verlinkt direkt auf die entsprechenden technischen Spezifikationen in `SPEC.md`.

3. **[SPEC.md – Technische Spezifikation & Traceability](file:///c:/dev/Froning/app/LineageGraph/SPEC.md)**
   * Übersetzt alle Anforderungen in präzise technische Spezifikationen (`SPEC-ID -> REQ-ID`).
   * Beinhaltet die genaue Verortung in den Systemkomponenten (Vue-Komponenten, Composables, Tauri IPC-Commands, Rust-Module, Datenbank-Tabellen) mit Dateipfaden.
   * Dokumentiert den Datenfluss, die State-Logik und Datenstrukturen.

4. **[Architecture.md – Systemarchitektur & Traceability-Matrix](file:///c:/dev/Froning/app/LineageGraph/Architecture.md)**
   * Vollständige **Traceability-Matrix** (`REQ-ID` | `Fachliche Anforderung` | `SPEC-ID` | `Schicht` | `Betroffene Quellcodedateien`).
   * Detailliertes **Architekturschaubild (Mermaid.js)** mit der Trennung von Vue 3 Frontend, Tauri IPC-Bridge, Rust-Backend und lokaler SQLite-Speicherung.
   * **Entity-Relationship-Diagramm (ERD)** des relationalen Datenmodells (`individuals`, `families`, `parent_child`, `root_ancestors`, `proband_henry_codes`, `design_layouts`, `events`, `latex_export_templates`).

5. **[TEST_CASES.md – Test- und Qualitäts-Dokument](file:///c:/dev/Froning/app/LineageGraph/TEST_CASES.md)**
   * Vollständiges Test- und Qualitätssicherungskonzept für Rust-Unit-Tests, Vue-Component-Tests und Tauri-IPC-Integrationstests.
   * Präzise definierte Testfälle je Domäne mit **Traceability** (`REQ-ID -> SPEC-ID -> TC-ID`), Preconditions, Testschritten und Erwartungswerten.
   * **End-to-End Traceability-Matrix** (`Domäne` | `REQ-ID` | `SPEC-ID` | `TC-ID` | `Test-Typ` | `Abdeckungsgrad`).

---

## Schnellzugriff auf die Domänen

| Domäne | Code | Inhaltliche Schwerpunkte | Verweise |
| :--- | :---: | :--- | :--- |
| **Stammbaum-Verwaltung** | `TRM` | Multi-Tree-Isolierung, 2-Stufen-Löschung mit Windows-Filelock-Schutz, Fallback-Zustände, App-Aktualisierung & Versionsprüfung | [REQ](file:///c:/dev/Froning/app/LineageGraph/REQ.md#21-stammbaum--und-workspace-verwaltung-trm) · [SPEC](file:///c:/dev/Froning/app/LineageGraph/SPEC.md#21-dom%C3%A4ne-stammbaum--und-workspace-verwaltung-trm) · [Guide](file:///c:/dev/Froning/app/LineageGraph/USER_GUIDE.md#kapitel-1-einstieg--workspace-verwaltung) |
| **Personen- & Beziehungsdaten** | `DAT` | XREF-Generierung, Inline-Batch-Editierung, Rekursionsschutz bei Elternwahl, Ehen/Scheidungen, CHAN/UID-Audit | [REQ](file:///c:/dev/Froning/app/LineageGraph/REQ.md#22-personen--und-beziehungsstammdaten-dat) · [SPEC](file:///c:/dev/Froning/app/LineageGraph/SPEC.md#22-dom%C3%A4ne-personen--und-beziehungsstammdaten-dat) · [Guide](file:///c:/dev/Froning/app/LineageGraph/USER_GUIDE.md#21-personen--und-familiendaten-verwalten) |
| **Genealogische Algorithmen** | `ALG` | Multi-Probanden-Verwaltung, chronologische & patrilineare/matrilineare Henry-Code-Engine, kürzester Beziehungspfad via A* | [REQ](file:///c:/dev/Froning/app/LineageGraph/REQ.md#23-genealogische-berechnungen--algorithmen-alg) · [SPEC](file:///c:/dev/Froning/app/LineageGraph/SPEC.md#23-dom%C3%A4ne-genealogische-berechnungen--algorithmen-alg) · [Guide](file:///c:/dev/Froning/app/LineageGraph/USER_GUIDE.md#22-genealogische-ordnungen--verwandtschaftsanalyse) |
| **Benutzeroberfläche & Views** | `UI` | Multi-Filter-Datentabelle, Infinite-Canvas-Stammbaum, Slide-Over Detail Drawer, Freie Schnellsuche, I18n DE/EN | [REQ](file:///c:/dev/Froning/app/LineageGraph/REQ.md#24-benutzeroberfl%C3%A4che--views-ui) · [SPEC](file:///c:/dev/Froning/app/LineageGraph/SPEC.md#24-dom%C3%A4ne-benutzeroberfl%C3%A4che--views-ui) · [Guide](file:///c:/dev/Froning/app/LineageGraph/USER_GUIDE.md#23-benutzeroberfl%C3%A4che--interaktive-ansichten) |
| **Design Studio & Layout** | `DSG` | Hierarchisches Pedigree-Layout, orthogonale Leitungsbrücken, Kartengestaltung, Hintergrund-Blob-Speicher, Undo/Redo | [REQ](file:///c:/dev/Froning/app/LineageGraph/REQ.md#25-stammbaum-design-studio-dsg) · [SPEC](file:///c:/dev/Froning/app/LineageGraph/SPEC.md#25-dom%C3%A4ne-stammbaum-design-studio-dsg) · [Guide](file:///c:/dev/Froning/app/LineageGraph/USER_GUIDE.md#24-stammbaum-design-studio) |
| **Import & Merge-System** | `IMP` | Atomarer GEDCOM-Vollimport, RAM-Staging & Konfidenz-Matching, differentieller 3-Wege-Merge mit Konfliktlösung | [REQ](file:///c:/dev/Froning/app/LineageGraph/REQ.md#26-import--differentieller-datenabgleich-imp) · [SPEC](file:///c:/dev/Froning/app/LineageGraph/SPEC.md#26-dom%C3%A4ne-import--differentieller-datenabgleich-imp) · [Guide](file:///c:/dev/Froning/app/LineageGraph/USER_GUIDE.md#25-gedcom-import--3-wege-datenabgleich) |
| **Export & Publikation** | `EXP` | Scoped GEDCOM-Export, strukturierter CSV-Export mit BOM, autarke Single-File-HTML-Chronik, SVG/PNG-Export, LaTeX/PDF | [REQ](file:///c:/dev/Froning/app/LineageGraph/REQ.md#27-multi-format-export--chronik-erstellung-exp) · [SPEC](file:///c:/dev/Froning/app/LineageGraph/SPEC.md#27-dom%C3%A4ne-multi-format-export--chronik-erstellung-exp) · [Guide](file:///c:/dev/Froning/app/LineageGraph/USER_GUIDE.md#26-export-center--chronik-erstellung) |

