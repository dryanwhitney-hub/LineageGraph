# Test- und Qualitäts-Dokument (TEST_CASES.md)

**System:** LineageGraph (Froning Familienbuch)  
**Dokument-Version:** 3.0.0  
**Status:** Freigegebenes Qualitäts- und Testdokument  
**Datum:** 5. November 2026  
**Referenzierte Dokumente:** [REQ.md](file:///c:/dev/Froning/app/LineageGraph/docs/REQ.md), [SPEC.md](file:///c:/dev/Froning/app/LineageGraph/docs/SPEC.md), [Architecture.md](file:///c:/dev/Froning/app/LineageGraph/docs/Architecture.md)

---

## Teil 1: Teststrategie & Testumfang

### 1.1 Testmethodik & Qualitätssicherungs-Architektur

LineageGraph folgt einer mehrstufigen Test- und Qualitätssicherungsstrategie (*Testing Pyramid*), die auf die Besonderheiten einer hybriden Desktop-Anwendung (Tauri v2 mit Rust-Backend und Vue 3/TypeScript-Frontend) zugeschnitten ist:

```
           / \
          /   \        E2E- & Manuelle UI-Tests
         / E2E \       (Tauri Desktop Applikation, Canvas Panning & Zoom, Dialoge)
        /-------\
       /         \     Integrationstests & Tauri-IPC-Tests
      / IPC / INT \    (Tauri-Commands, DB-Transaktionen, GEDCOM Merge, Scoped Exports)
     /-------------\
    /               \  Unit-Tests (Rust Cargo & Frontend Composables)
   /   UNIT TESTS    \ (Henry-Code-Engine, Petgraph A*, Rekursionsprüfung, XREF-Gen, Layout)
  /-------------------\
```

1. **Unit-Tests (Rust / `cargo test`):**
   * Verifikation aller mathematischen, graphentheoretischen und datenbanknahen Kernalgorithmen in [`src-tauri/src/lib.rs`](file:///c:/dev/Froning/app/LineageGraph/src-tauri/src/lib.rs), [`src-tauri/src/db.rs`](file:///c:/dev/Froning/app/LineageGraph/src-tauri/src/db.rs), [`src-tauri/src/gedcom_import_merge.rs`](file:///c:/dev/Froning/app/LineageGraph/src-tauri/src/gedcom_import_merge.rs), [`src-tauri/src/gedcom_export.rs`](file:///c:/dev/Froning/app/LineageGraph/src-tauri/src/gedcom_export.rs) und [`src-tauri/src/csv_export.rs`](file:///c:/dev/Froning/app/LineageGraph/src-tauri/src/csv_export.rs).
   * Deterministische Ausführung mit In-Memory-Datenbanken (`Connection::open_in_memory()`) oder isolierten temporären Verzeichnissen.
   * Aktueller Stand: 16 automatisierte Rust-Unit-Tests im Backend (`cargo test --manifest-path src-tauri/Cargo.toml`).

2. **Component-, Composable- & State-Tests (Vue 3 / TypeScript):**
   * Validierung reaktiver State-Stores und Berechnungslogik in [`src/composables/usePersons.ts`](file:///c:/dev/Froning/app/LineageGraph/src/composables/usePersons.ts), [`src/composables/useShortestPath.ts`](file:///c:/dev/Froning/app/LineageGraph/src/composables/useShortestPath.ts), [`src/composables/useDesignLayout.ts`](file:///c:/dev/Froning/app/LineageGraph/src/composables/useDesignLayout.ts) und [`src/composables/useDesignHistory.ts`](file:///c:/dev/Froning/app/LineageGraph/src/composables/useDesignHistory.ts).
   * Validierung der Filter-, Sortier- und Formatierungsfunktionen sowie des Canvas-Viewports und SVG-Routings.
   * Statische Typprüfung via `vue-tsc --noEmit`.

3. **Integrationstests (Tauri IPC & System-Integration):**
   * Testen des JSON-RPC-Protokolls zwischen `@tauri-apps/api/core::invoke()` und den registrierten Command-Handlern.
   * Überprüfung von Betriebssystem-Interaktionen: Filelock-Freigabe unter Windows bei Datenbanklöschung, Erzeugen temporärer Dateien für den LaTeX-Kompilierungsprozess (`pdflatex`), Native OS-Dateidialoge via `@tauri-apps/plugin-dialog`.

---

## Teil 2: Strukturierte Testfälle nach Domänen

### 2.1 Domäne: Stammbaum- & Workspace-Verwaltung (TRM)

#### TC-TRM-001: Auflisten und Umschalten von Stammbäumen
- **Traceability:** [REQ-TRM-001](file:///c:/dev/Froning/app/LineageGraph/docs/REQ.md#req-trm-001-multi-stammbaum-verwaltung--umschaltung) -> [SPEC-TRM-001](file:///c:/dev/Froning/app/LineageGraph/docs/SPEC.md#spec-trm-001---req-trm-001)
- **Test-Typ:** Integration Test (Tauri IPC / State)
- **Test-Ziel:** Sicherstellen, dass alle im AppData-Ordner vorhandenen `.db`-Dateien erkannt und unterbrechungsfrei geladen werden können.
- **Preconditions:** Mindestens zwei Datenbanken (`BaumA.db`, `BaumB.db`) existieren im Anwendungsdatenverzeichnis. `BaumA` ist aktuell geladen.
- **Testschritte:**
  1. IPC-Kommando `get_trees` aufrufen.
  2. Rückgabeliste prüfen.
  3. IPC-Kommando `switch_tree("BaumB")` aufrufen.
  4. IPC-Kommando `get_all_persons` aufrufen.
- **Erwartetes Ergebnis:**
  * `get_trees` liefert `["BaumA", "BaumB"]`.
  * `switch_tree` schließt die Verbindung zu `BaumA.db` und öffnet `BaumB.db` ohne Dateilocks.
  * `get_all_persons` liefert ausschließlich die Entitäten aus `BaumB`.

#### TC-TRM-002: Zweistufige Sicherheitslöschung mit Filelock-Freigabe & Schutz fremder Bäume
- **Traceability:** [REQ-TRM-002](file:///c:/dev/Froning/app/LineageGraph/docs/REQ.md#req-trm-002-zweistufige-sicherheitsl%C3%B6schung-mit-prozess-schutz) -> [SPEC-TRM-002](file:///c:/dev/Froning/app/LineageGraph/docs/SPEC.md#spec-trm-002---req-trm-002)
- **Test-Typ:** Unit & Integration Test (*Implemented: `tests::test_delete_tree_removes_database_and_preserves_others`*)
- **Test-Ziel:** Verifikation, dass das Löschen eines Baumes alle zugehörigen Dateien (`.db`, `-wal`, `-shm`, `-journal`) physisch tilgt, andere Bäume unberührt lässt und unter Windows keine Dateilocks blockieren.
- **Preconditions:** Drei Test-Datenbanken (`delete_me.db`, `keep_a.db`, `keep_b.db`) mit WAL-Modus sind angelegt. `delete_me` ist aktiv verbunden.
- **Testschritte:**
  1. `delete_tree_internal(&mut conn, &app_dir, &mut active_tree, "delete_me")` ausführen.
  2. Dateisystem im App-Verzeichnis prüfen.
  3. Prüfen, ob `keep_a.db` und `keep_b.db` unverändert existieren.
- **Erwartetes Ergebnis:**
  * Verbindung wird via `wal_checkpoint` geleert und auf In-Memory umgebogen.
  * Alle `delete_me.*`-Dateien sind von der Festplatte gelöscht.
  * `keep_a.db` und `keep_b.db` bleiben vollständig intakt.
  * Die Rückgabeliste enthält nur noch `["keep_a", "keep_b"]`.

#### TC-TRM-003: Konsistenter Leerzustand nach Löschung des letzten Stammbaums
- **Traceability:** [REQ-TRM-003](file:///c:/dev/Froning/app/LineageGraph/docs/REQ.md#req-trm-003-automatischer-fallback--leerzustands-behandlung) -> [SPEC-TRM-003](file:///c:/dev/Froning/app/LineageGraph/docs/SPEC.md#spec-trm-003---req-trm-003)
- **Test-Typ:** Integration Test (Frontend Orchestrierung & Backend)
- **Test-Ziel:** Validieren, dass nach Löschen des einzigen vorhandenen Stammbaums kein Geisterzustand entsteht und die UI in den sauberen Leerzustand wechselt.
- **Preconditions:** Es existiert genau ein Stammbaum (`LetzterBaum.db`).
- **Testschritte:**
  1. Löschvorgang für `LetzterBaum` im UI durchlaufen und bestätigen.
  2. Reaktiven Zustand in `usePersons.ts` prüfen.
  3. Konfigurationsdialog (`SettingsModal.vue`) aufrufen.
- **Erwartetes Ergebnis:**
  * `delete_tree` liefert ein leeres Array `[]`.
  * `activeTree.value` ist leerer String `""`.
  * `persons.value` und `rootAncestors.value` sind vollständig geleert (`[]`).
  * In `SettingsModal.vue` erscheint der Text *"Kein aktiver Stammbaum vorhanden"* und der Löschbutton ist deaktiviert/ausgeblendet.

#### TC-TRM-004: Automatisierte Versionsprüfung bei Start & Manuelle Prüfung in Einstellungen
- **Traceability:** [REQ-TRM-004](file:///c:/dev/Froning/app/LineageGraph/docs/REQ.md#req-trm-004-app-aktualisierung--versionspr%C3%BCfung) -> [SPEC-TRM-004](file:///c:/dev/Froning/app/LineageGraph/docs/SPEC.md#spec-trm-004---req-trm-004)
- **Test-Typ:** Unit & Integration Test (*Implemented: `tests::test_check_internet_connection`, `tests::test_resolve_user_guide_path` & Tauri IPC / Composable*)
- **Test-Ziel:** Validieren der robusten Konnektivitätsprüfung, des geräuschlosen Startverhaltens, der manuellen Aktualisierungsprüfung in den Einstellungen, des direkten Absprungs zum Anwenderhandbuch (`USER_GUIDE.md`) und der obligatorischen Bestätigungsabfrage vor dem Download.
- **Preconditions:** Anwendung initialisiert; Testumgebung verfügt wahlweise über Internetzugang oder Offline-Zustand.
- **Testschritte:**
  1. `cargo test -- test_check_internet_connection test_resolve_user_guide_path` ausführen.
  2. IPC-Aufruf `check_internet_connection` im Frontend über `useAppUpdater` absetzen.
  3. Beim Start (`onMounted` in `App.vue`): Verhalten bei fehlender Verbindung (kein Popup) vs. aktiver Verbindung prüfen.
  4. Im Einstellungsfenster (`SettingsModal.vue` -> Bereich `ℹ️ Über LineageGraph`) auf `🔍 Auf Updates prüfen` klicken.
  5. Bei gefundener neuer Version Anzeige von `UpdateConfirmModal.vue` und Abbruch via `Später erinnern` vs. Ausführung via `✨ Jetzt aktualisieren` prüfen.
  6. Klick auf `📖 Handbuch` in der Menüleiste bzw. `📖 Anwenderhandbuch (USER_GUIDE.md)` in den Einstellungen auslösen und prüfen, dass `open_user_guide` die lokale Markdown-Datei oder das Web-Repository öffnet.
- **Erwartetes Ergebnis:**
  * `check_connectivity()` bzw. `check_internet_connection()` terminiert innerhalb des Timeouts (<= 1500 ms) ohne Panic oder Blockieren der UI-Engine.
  * Beim Start blockiert eine fehlende Internetverbindung den Anwendungsstart in keiner Weise.
  * Die manuelle Suche in den Einstellungen gibt verständliche Statusmeldungen (`Die Anwendung ist auf dem neuesten Stand.`, `Keine Internetverbindung verfügbar.` etc.) aus.
  * Die Installation wird **niemals** ungefragt gestartet; das Bestätigungsmodal fordert zwingend die explizite Nutzerentscheidung ein.

---

### 2.2 Domäne: Personen- & Beziehungsstammdaten (DAT)

#### TC-DAT-001: Inkrementelle XREF-Generierung bei Neuanlage
- **Traceability:** [REQ-DAT-001](file:///c:/dev/Froning/app/LineageGraph/docs/REQ.md#req-dat-001-personen-erfassung--inkrementelle-xref-generierung) -> [SPEC-DAT-001](file:///c:/dev/Froning/app/LineageGraph/docs/SPEC.md#spec-dat-001---req-dat-001)
- **Test-Typ:** Unit Test (*Implemented: `tests::test_get_next_individual_id`*)
- **Test-Ziel:** Sicherstellen, dass die nächste freie ID numerisch inkrementiert wird und Lücken/höhere Nummern korrekt berücksichtigt werden.
- **Preconditions:** Datenbank enthält Personen mit den IDs `@I1@`, `@I2@`, `@I9@`.
- **Testschritte:**
  1. `get_next_individual_id(&conn)` ausführen.
  2. Person mit der neuen ID anlegen.
  3. Erneut `get_next_individual_id(&conn)` ausführen.
- **Erwartetes Ergebnis:**
  * Erster Aufruf liefert `"I10"`.
  * Zweiter Aufruf liefert `"I11"`.

#### TC-DAT-002: Batch-Aktualisierung von Personendaten & Kaskadierende ID-Umbenennung
- **Traceability:** [REQ-DAT-002](file:///c:/dev/Froning/app/LineageGraph/docs/REQ.md#req-dat-002-tabellarische-batch-editierung--validierungs-engine) -> [SPEC-DAT-002](file:///c:/dev/Froning/app/LineageGraph/docs/SPEC.md#spec-dat-002---req-dat-002)
- **Test-Typ:** Unit & Integration Test (*Implemented: `tests::test_update_persons_batch_and_traceability` & `test_update_persons_batch_rejects_invalid_xref`*)
- **Test-Ziel:** Absicherung der atomaren Speicherung geänderter Personendaten und kaskadierenden Umbenennung von Fremdschlüsseln in Familien, Relationen und Probanden.
- **Preconditions:** Person `I1` ist Vater in Familie `F1` mit Kind `I2` und Proband in `root_ancestors`.
- **Testschritte:**
  1. Update-Batch absenden: Person `I1` umbenennen nach `I999`, Vorname ändern auf `"Maximilian"`.
  2. Batch mit ungültiger ID `"I 999 with space"` absenden.
- **Erwartetes Ergebnis:**
  * Schritt 1: `individuals.id` ist `I999`, Name ist `Maximilian`. In `families.husband_id` steht `I999`, in `root_ancestors.person_id` steht `I999`. Alle Relationen bleiben erhalten.
  * Schritt 2: Aufruf schlägt fehl mit `Err("Ungültiges XREF-Format")`, keine Datenbankänderung.

#### TC-DAT-003: Vorfahren-Rekursionsprüfung bei Elternzuweisung
- **Traceability:** [REQ-DAT-003](file:///c:/dev/Froning/app/LineageGraph/docs/REQ.md#req-dat-003-eltern-kind-verkn%C3%BCpfung-mit-zyklus---rekursionserkennung) -> [SPEC-DAT-003](file:///c:/dev/Froning/app/LineageGraph/docs/SPEC.md#spec-dat-003---req-dat-003)
- **Test-Typ:** Unit Test (Backend Rekursionsalgorithmus)
- **Test-Ziel:** Nachweis, dass zyklische Abstammungsverhältnisse (Person wird ihr eigener Ahne) zuverlässig erkannt und abgewiesen werden.
- **Preconditions:** Stammreihe: Großvater `I1` -> Vater `I2` -> Kind `I3`.
- **Testschritte:**
  1. Versuch, `I3` als Vater von `I1` zuzuweisen (`update_person_parents("I1", Some("I3"), None)`).
  2. Versuch, `I1` als eigenen Vater zuzuweisen (`update_person_parents("I1", Some("I1"), None)`).
- **Erwartetes Ergebnis:**
  * Beide Aufrufe schlagen fehl mit `Err("Rekursion erkannt: Die Person ist bereits ein Vorfahre")`.
  * Die Datenbank bleibt unverändert; es entsteht kein Zyklus.

#### TC-DAT-004: Ehe-, Partner- und Kinder-Lifecycle (Link & Unlink)
- **Traceability:** [REQ-DAT-004](file:///c:/dev/Froning/app/LineageGraph/docs/REQ.md#req-dat-004-partnerschafts--und-ehedaten-management) -> [SPEC-DAT-004](file:///c:/dev/Froning/app/LineageGraph/docs/SPEC.md#spec-dat-004---req-dat-004)
- **Test-Typ:** Unit Test (*Implemented: `tests::test_update_family_marriage`, `tests::test_link_and_unlink_spouses`, `tests::test_add_and_remove_child_link`*)
- **Test-Ziel:** Validieren des Anlegens, Modifizierens und Lösens von Partner- und Eltern-Kind-Verbindungen.
- **Preconditions:** Zwei unverbundene Personen `I1` (M) und `I2` (F) sowie Kind `I3`.
- **Testschritte:**
  1. `link_spouses_internal(&mut conn, "I1", "I2")` aufrufen.
  2. `update_family_marriage_internal` ausführen (Heirat: 1950, Scheidung: 1960, is_divorced: true).
  3. `add_child_link_internal` für `I3` ausführen.
  4. `unlink_family_internal` für die erzeugte Familie ausführen.
- **Erwartetes Ergebnis:**
  * Nach Schritt 1: Neue Familie `F...` existiert mit Mann `I1` und Frau `I2`.
  * Nach Schritt 2: Ehedaten und Scheidungs-Flag sind korrekt in `families` hinterlegt.
  * Nach Schritt 3: In `parent_child` existiert das Paar `(Familie, I3)`.
  * Nach Schritt 4: Familie und `parent_child`-Eintrag sind gelöscht; die Personen `I1`, `I2`, `I3` existieren weiterhin.

#### TC-DAT-005: Audit-Felder (GEDCOM CHAN und UUID)
- **Traceability:** [REQ-DAT-005](file:///c:/dev/Froning/app/LineageGraph/docs/REQ.md#req-dat-005-audit---revisionsfelder-gedcom-chan--uid) -> [SPEC-DAT-005](file:///c:/dev/Froning/app/LineageGraph/docs/SPEC.md#spec-dat-005---req-dat-005)
- **Test-Typ:** Unit Test (*Implemented: `tests::test_system_fields_chan_and_uid`*)
- **Test-Ziel:** Sicherstellen, dass jede Neuanlage eine UUID erhält und jede Modifikation den `CHAN`-Zeitstempel aktualisiert.
- **Preconditions:** Person in Datenbank vorhanden.
- **Testschritte:**
  1. Personendaten über `update_persons_batch_internal` modifizieren.
  2. Feld `json_data` der Person in SQLite auslesen.
- **Erwartetes Ergebnis:**
  * `json_data` enthält das Objekt `"CHAN": {"DATE": "...", "TIME": "..."}` mit aktuellem Tagesdatum.
  * `_UID` enthält eine valide 32-Zeichen-Hexadezimal-UUID.

#### TC-DAT-006: Einzel- und Batch-Löschung mit Kaskadenbereinigung & Backup
- **Traceability:** [REQ-DAT-006](file:///c:/dev/Froning/app/LineageGraph/docs/REQ.md#req-dat-006-einzel---zweig-l%C3%B6schung-mit-backup-sicherung) -> [SPEC-DAT-006](file:///c:/dev/Froning/app/LineageGraph/docs/SPEC.md#spec-dat-006---req-dat-006)
- **Test-Typ:** Unit & Integration Test (*Implemented: `tests::test_delete_person_and_cleanup_empty_families`*)
- **Test-Ziel:** Sicherstellen, dass das Löschen von Personen alle abhängigen Referenzen (Familien, parent_child, Events, Henry-Codes, Research-Tasks) sauber kaskadierend entfernt und leere Familienverwaiste bereinigt werden.
- **Preconditions:** Familie F1 mit Vater I1, Mutter I2, Kind I3.
- **Testschritte:**
  1. `delete_person_internal(&mut conn, "I3")` aufrufen.
  2. Prüfen, dass `parent_child` für I3 entfernt ist, F1 aber mit I1 und I2 bestehen bleibt.
  3. `delete_persons_batch_internal(&mut conn, &["I1".to_string(), "I2".to_string()])` aufrufen.
  4. Prüfen, dass I1 und I2 aus `individuals` gelöscht sind und die verwaiste Familie F1 vollständig gelöscht wurde.
- **Erwartetes Ergebnis:**
  * I1, I2, I3 existieren nicht mehr in `individuals`.
  * Familie F1 wird vollständig aus `families` entfernt.
  * Keine verwaisten Fremdschlüsselverletzungen oder Zombi-Datensätze in der SQLite-Datenbank.

#### TC-DAT-007: Selektiver Personen-Merge mit Attribut- & Partner-Auflösung
- **Traceability:** [REQ-DAT-007](file:///c:/dev/Froning/app/LineageGraph/docs/REQ.md#req-dat-007-selektiver-personen-merge-mit-konfliktl%C3%B6sung) -> [SPEC-DAT-007](file:///c:/dev/Froning/app/LineageGraph/docs/SPEC.md#spec-dat-007---req-dat-007)
- **Test-Typ:** Unit & Integration Test (*Implemented: `tests::test_merge_persons_selective_fields`*)
- **Test-Ziel:** Verifikation, dass der Merge selektiv Stammdaten übernimmt, Kinder und Partner auf die Zielperson umhängt, Ereignisse filtert und eine Revisionsnotiz dokumentiert.
- **Preconditions:** Zielperson I_TARGET und Quellperson I_SOURCE mit jeweils eigenem Kind und eigenem Partner.
- **Testschritte:**
  1. `merge_persons_internal` aufrufen mit:
     - `given_name`: "Johann Heinrich" (von Quelle)
     - `surname`: "Froning" (von Ziel)
     - `birth_date`: "1800-01-01"
     - `parent_family_source`: "target"
     - `audit_note`: "Zusammengeführt am 2026-11-09."
  2. Zielperson I_TARGET und Quellperson I_SOURCE prüfen.
- **Erwartetes Ergebnis:**
  * I_TARGET besitzt `given_name = "Johann Heinrich"`, `birth_date = "1800-01-01"`.
  * Kinder und Partner von I_SOURCE sind nun mit I_TARGET verknüpft.
  * I_SOURCE existiert nicht mehr in `individuals`.
  * In `json_data` von I_TARGET ist die Revisionsnotiz in `NOTE` hinterlegt.

---

### 2.3 Domäne: Genealogische Berechnungen & Algorithmen (ALG)

#### TC-ALG-001: Multi-Probanden-Verwaltung & Unabhängige Nummernkreise
- **Traceability:** [REQ-ALG-001](file:///c:/dev/Froning/app/LineageGraph/docs/REQ.md#req-alg-001-multi-probanden-verwaltung-multi-root) -> [SPEC-ALG-001](file:///c:/dev/Froning/app/LineageGraph/docs/SPEC.md#spec-alg-001---req-alg-001)
- **Test-Typ:** Integration Test (Backend & Schema)
- **Test-Ziel:** Nachweis, dass mehrere Stammahnen mit individuellen Start-Codes unabhängig voneinander verwaltet und berechnet werden.
- **Preconditions:** Datenbank mit zwei getrennten Stammbäumen/Familienstämmen.
- **Testschritte:**
  1. `add_root_ancestor("I1", "1")` und `add_root_ancestor("I100", "A")` aufrufen.
  2. `calculate_henry_codes_from_roots` ausführen.
  3. Abfrage auf `proband_henry_codes` ausführen.
- **Erwartetes Ergebnis:**
  * Nachkommen von `I1` erhalten Codes beginnend mit `1` (z. B. `11`, `12`).
  * Nachkommen von `I100` erhalten Codes beginnend mit `A` (z. B. `A1`, `A2`).
  * Eine Person, die in beiden Linien vorkommt, besitzt in `proband_henry_codes` zwei separate Einträge mit jeweiliger Generationsnummer.

#### TC-ALG-002: Patrilineare/Matrilineare Henry-Code-Berechnung mit chronologischer Geschwister-Reihenfolge
- **Traceability:** [REQ-ALG-002](file:///c:/dev/Froning/app/LineageGraph/docs/REQ.md#req-alg-002-chronologische--patrilinearematrilineare-henry-code-berechnung) -> [SPEC-ALG-002](file:///c:/dev/Froning/app/LineageGraph/docs/SPEC.md#spec-alg-002---req-alg-002)
- **Test-Typ:** Unit Test (*Implemented: `tests::test_henry_code_matrilinear_when_father_not_in_tree_and_patrilinear_when_both_in_tree` & `tests::test_birth_date_sorting_of_descendants`*)
- **Test-Ziel:** Prüfung der patrilinearen Bevorzugung, des matrilinearen Fallbacks sowie der strengen Sortierung der Geschwister nach Geburtsdatum.
- **Preconditions:** Proband `I1` hat drei Kinder: Kind A (* 1885), Kind B (* 1880), Kind C (* 1890).
- **Testschritte:**
  1. Henry-Code-Berechnung ausführen.
  2. Codes von Kind B, Kind A, Kind C prüfen.
- **Erwartetes Ergebnis:**
  * Ältestes Kind B (* 1880) erhält Suffix `1` (Code `11`).
  * Zweitältestes Kind A (* 1885) erhält Suffix `2` (Code `12`).
  * Jüngstes Kind C (* 1890) erhält Suffix `3` (Code `13`).

#### TC-ALG-003: Kürzester Verwandtschaftspfad (A*- & BFS-Graphsuche)
- **Traceability:** [REQ-ALG-003](file:///c:/dev/Froning/app/LineageGraph/docs/REQ.md#req-alg-003-k%C3%BCrzester-verwandtschaftspfad-a---bfs-graphsuche) -> [SPEC-ALG-003](file:///c:/dev/Froning/app/LineageGraph/docs/SPEC.md#spec-alg-003---req-alg-003)
- **Test-Typ:** Unit & Integration Test (Petgraph & Frontend Composable)
- **Test-Ziel:** Auffinden der kürzesten Verbindung zwischen zwei entfernten Personen über Ahnen-, Nachkommen- und Partnerkanten.
- **Preconditions:** Personen A und B sind Cousins 2. Grades (gemeinsamer Urgroßvater U).
- **Testschritte:**
  1. `find_relationship_path("A", "B")` via IPC aufrufen.
  2. `findShortestPathWithSpouses` in `useShortestPath.ts` mit denselben IDs aufrufen.
- **Erwartetes Ergebnis:**
  * Beide Aufrufe liefern den exakten Verbindungspfad `[A, Vater_A, Großvater_A, U, Großvater_B, Vater_B, B]`.
  * Das Frontend markiert alle IDs in `highlightedPathIds`.

---

### 2.4 Domäne: Benutzeroberfläche & Views (UI)

#### TC-UI-001: Tabellen-Filterung, Sortierung und Spalten-Konfiguration
- **Traceability:** [REQ-UI-001](file:///c:/dev/Froning/app/LineageGraph/docs/REQ.md#req-ui-001-interaktive-datentabelle-mit-sortierung--multi-filtern) -> [SPEC-UI-001](file:///c:/dev/Froning/app/LineageGraph/docs/SPEC.md#spec-ui-001---req-ui-001)
- **Test-Typ:** Component Test (Vue / `PersonTableView.vue`)
- **Test-Ziel:** Korrektes Filtern bei kombinierter Text- und Datumseingabe sowie korrekte Sortierung nach Henry-Code und Namen.
- **Preconditions:** 500 Test-Personen in `persons.value` geladen.
- **Testschritte:**
  1. Spaltenfilter Nachname auf `"Froning"` setzen.
  2. Geburtsortfilter auf `"Münster"` setzen.
  3. Sortierung auf Spalte "Geburtsdatum" (aufsteigend) aktivieren.
- **Erwartetes Ergebnis:**
  * Die Tabelle zeigt nur Personen, deren Nachname "Froning" und Geburtsort "Münster" enthält.
  * Die Zeilen sind chronologisch nach Geburtsdatum aufsteigend sortiert.

#### TC-UI-002: Infinite Canvas Panning, Zooming und Knoten-Exploration
- **Traceability:** [REQ-UI-002](file:///c:/dev/Froning/app/LineageGraph/docs/REQ.md#req-ui-002-infinite-canvas-stammbaum-visualisierung) -> [SPEC-UI-002](file:///c:/dev/Froning/app/LineageGraph/docs/SPEC.md#spec-ui-002---req-ui-002)
- **Test-Typ:** UI / Component Test (`TreeCanvasView.vue`, `TreeNode.vue`)
- **Test-Ziel:** Reibungsloser Zoom (20 %–250 %), Verschieben des Viewports und interaktives Ein-/Ausklappen von Partnern und Eltern.
- **Preconditions:** Stammbaum im Modus "Canvas" geöffnet.
- **Testschritte:**
  1. Mausrad nach oben drehen (Zoom in).
  2. Canvas mit gedrückter Maustaste verschieben (Pan).
  3. Partner-Badge an einem Personen-Knoten anklicken.
- **Erwartetes Ergebnis:**
  * Zoom-Faktor steigt bis zum Limit von 2.5 (250 %).
  * CSS-Transformation `translate(x, y) scale(zoom)` folgt flüssig der Mausbewegung.
  * Ehepartner-Cluster klappt horizontal mit roter Verbindungslinie auf.

#### TC-UI-003: Slide-Over Detail-Drawer Navigation & Verwandten-Sprung
- **Traceability:** [REQ-UI-003](file:///c:/dev/Froning/app/LineageGraph/docs/REQ.md#req-ui-003-slide-over-detail-drawer--verwandtschafts-inspector) -> [SPEC-UI-003](file:///c:/dev/Froning/app/LineageGraph/docs/SPEC.md#spec-ui-003---req-ui-003)
- **Test-Typ:** Component Test (`PersonDetailsDrawer.vue`)
- **Test-Ziel:** Sofortige Aktualisierung aller Details und Verwandtschaftslisten bei Klick auf ein Familienmitglied.
- **Preconditions:** Detail-Drawer für Person `I1` geöffnet. Person `I2` wird in der Kinderliste aufgeführt.
- **Testschritte:**
  1. Auf den Eintrag von Kind `I2` im Drawer klicken.
- **Erwartetes Ergebnis:**
  * Event `jump-to` wird emittiert mit ID `I2`.
  * `selectedPerson` wechselt zu `I2`.
  * Detail-Drawer lädt Details für `I2`; Elternliste zeigt nun `I1`.

#### TC-UI-004: Freie Schnellabfrage (Free Query)
- **Traceability:** [REQ-UI-004](file:///c:/dev/Froning/app/LineageGraph/docs/REQ.md#req-ui-004-freie-schnellabfrage-free-query-modal) -> [SPEC-UI-004](file:///c:/dev/Froning/app/LineageGraph/docs/SPEC.md#spec-ui-004---req-ui-004)
- **Test-Typ:** Component Test (`FreeQueryModal.vue`)
- **Test-Ziel:** Schnelle Suche über bis zu 4 Filterkriterien gleichzeitig mit maximal 30 Ergebnissen.
- **Preconditions:** Modal geöffnet via Menü oder Tastenkürzel.
- **Testschritte:**
  1. Nachname `"Meyer"`, Geburtsjahr `"1900"` eingeben.
  2. Erstes Ergebnis in der Trefferliste anklicken.
- **Erwartetes Ergebnis:**
  * Live-Filterung zeigt sofort alle passenden Personen.
  * Klick selektiert die Person, schließt das Modal und zentriert die Ansicht.

#### TC-UI-005: Umschaltung der Lokalisierung (DE <-> EN)
- **Traceability:** [REQ-UI-005](file:///c:/dev/Froning/app/LineageGraph/docs/REQ.md#req-ui-005-vollst%C3%A4ndige-internationalisierung-de--en) -> [SPEC-UI-005](file:///c:/dev/Froning/app/LineageGraph/docs/SPEC.md#spec-ui-005---req-ui-005)
- **Test-Typ:** Component Test (`i18n.ts`, `SettingsModal.vue`)
- **Test-Ziel:** Lückenlose Übersetzung aller Benutzeroberflächenelemente bei Sprachwechsel zur Laufzeit.
- **Preconditions:** Sprache ist auf `de` eingestellt.
- **Testschritte:**
  1. Sprache in den Einstellungen auf `en` umstellen.
  2. Tabellenköpfe, Drawer-Titel und Menüeinträge prüfen.
- **Erwartetes Ergebnis:**
  * Alle sichtbaren Texte wechseln unmittelbar auf Englisch (z. B. "Nachname" -> "Surname", "Stammbaum" -> "Family Tree").
  * Es erscheinen keine unübersetzten I18n-Schlüssel.

---

### 2.5 Domäne: Stammbaum Design Studio (DSG)

#### TC-DSG-001: Hierarchische Pedigree-Layout-Generierung & Sub-Lane-Auflösung
- **Traceability:** [REQ-DSG-001](file:///c:/dev/Froning/app/LineageGraph/docs/REQ.md#req-dsg-001-automatisches-hierarchisches-pedigree-layout) -> [SPEC-DSG-001](file:///c:/dev/Froning/app/LineageGraph/docs/SPEC.md#spec-dsg-001---req-dsg-001)
- **Test-Typ:** Unit Test (`useDesignLayout.ts`)
- **Test-Ziel:** Kollisionsfreie Anordnung dichter Nachkommenzweige unter Berücksichtigung von Mindestabständen und automatischer vertikaler Staffelung (Sub-Lanes).
- **Preconditions:** Große Familie mit 8 Kindern, von denen 5 wiederum eigene Familien gegründet haben.
- **Testschritte:**
  1. Layout-Berechnung mit `autoSubLanes: true` und `horizontalLaneGap: 20` ausführen.
  2. X- und Y-Koordinaten aller Personenkarten auf Überlappung prüfen.
- **Erwartetes Ergebnis:**
  * Keine zwei Personenkarten weisen überschneidende Bounding-Boxes auf.
  * Dicht gedrängte Geschwistergruppen werden versetzt in Sub-Lanes platziert.

#### TC-DSG-002: Bottom-Up Track Assignment, Patrilineare Implex-Auflösung & SVG-Linienbrücken
- **Traceability:** [REQ-DSG-002](file:///c:/dev/Froning/app/LineageGraph/docs/REQ.md#req-dsg-002-orthogonale-linienf%C3%BChrung-bottom-up-track-assignment--linienbr%C3%BCcken-line-bridges) -> [SPEC-DSG-002](file:///c:/dev/Froning/app/LineageGraph/docs/SPEC.md#spec-dsg-002---req-dsg-002)
- **Test-Typ:** Unit & Component Test (`useDesignLayout.ts`, `designExport.ts`, `DesignConnectorLayer.vue`)
- **Test-Ziel:** Verifikation der Greedy-Track-Zuweisung für Bottom-Up-Layouts (Bedingung A: keine horizontale Intervallüberlappung inkl. Padding; Bedingung B: vertikale Kreuzungsfreiheit zu darüberliegenden Tracks; weiter nach außen greifende Verbindungen liegen näher am Elternknoten), der patrilinearen Zuordnung bei Implex-Fällen sowie der SVG-Leitungsbrücken.
- **Preconditions:**
  1. Zwei oder mehr Verbindungen fächern sich von Elternknoten unten zu Kind-/Geschwistergruppen oben auf (z. B. innere Verbindung `[300, 500]` und äußere Verbindung `[100, 480]`).
  2. Ein Kind besitzt sowohl Vater als auch Mutter als sichtbare Nachkommen im Baum (Implex-Fall).
- **Testschritte:**
  1. Track-Zuweisung (`assignNonOverlappingLanes`) und Kantengeometrie in `useDesignLayout.ts` sowie `generateDesignExportSvg` in `designExport.ts` berechnen.
  2. Zugewiesene Tracks (`Track 0` oben unter den Kindern, höhere Track-Indizes weiter unten Richtung Eltern) und verbundene Elternkacheln prüfen.
- **Erwartetes Ergebnis:**
  * Die engere Verbindung `[300, 500]` liegt in `Track 0` (oben unter den Kindern), die weiter nach außen greifende Verbindung `[100, 480]` in `Track 1` (weiter unten näher am Elternknoten), sodass 0 vertikale/horizontale Linienkreuzungen entstehen.
  * Nicht überlappende Verbindungen verwenden denselben Track wieder.
  * Im Implex-Fall wird das Kind bzw. die Kindergruppierung ausschließlich mit dem Vater verbunden (patrilineare Darstellung).
  * Unvermeidbare Schnittpunkte enthalten im SVG-Pfad den Bogenbefehl `A 8 8 0 0 1 ...`.

#### TC-DSG-003: Dynamisches Karten-Styling (Farben, Abmessungen, Badges)
- **Traceability:** [REQ-DSG-003](file:///c:/dev/Froning/app/LineageGraph/docs/REQ.md#req-dsg-003-voll-konfigurierbare-personenkarten) -> [SPEC-DSG-003](file:///c:/dev/Froning/app/LineageGraph/docs/SPEC.md#spec-dsg-003---req-dsg-003)
- **Test-Typ:** Component Test (`DesignPersonCard.vue`)
- **Test-Ziel:** Korrekte Anwendung benutzerspezifischer Farbschemata für Geschlechter und konfigurierter Datenfelder.
- **Preconditions:** Karte einer weiblichen Person wird gerendert. Konfiguration: `femaleBgColor: '#fce4ec'`, `showHenryCode: true`.
- **Testschritte:**
  1. Berechnete CSS-Stile und DOM-Elemente der Karte prüfen.
- **Erwartetes Ergebnis:**
  * Hintergrundfarbe der Karte entspricht `#fce4ec`.
  * Henry-Code-Badge wird sichtbar gerendert.

#### TC-DSG-004: Hintergrundbild-Upload & SQLite-Blob-Persistierung
- **Traceability:** [REQ-DSG-004](file:///c:/dev/Froning/app/LineageGraph/docs/REQ.md#req-dsg-004-hintergrundgestaltung--bild-persistierung) -> [SPEC-DSG-004](file:///c:/dev/Froning/app/LineageGraph/docs/SPEC.md#spec-dsg-004---req-dsg-004)
- **Test-Typ:** Integration Test (Frontend Storage & Backend IO)
- **Test-Ziel:** Erfolgreiches Einbinden, Skalieren und dauerhaftes Speichern eines Wappen- oder Hintergrundbildes.
- **Preconditions:** Design Studio geöffnet. Lokale Bilddatei `wappen.png` liegt vor.
- **Testschritte:**
  1. Bild über `DesignSidebar.vue` auswählen.
  2. Deckkraft auf `35%` einstellen.
  3. Seite neu laden und Hintergrund prüfen.
- **Erwartetes Ergebnis:**
  * Das Bild wird via `save_binary_file` oder IndexedDB persistent hinterlegt.
  * Nach dem Neuladen erscheint das Bild mit Deckkraft 0.35 hinter dem Stammbaum.

#### TC-DSG-005: Undo/Redo-Verlauf, Design-Erstellung mit Stammahn-Auswahl und isolierte Layout-Persistenz
- **Traceability:** [REQ-DSG-005](file:///c:/dev/Froning/app/LineageGraph/docs/REQ.md#req-dsg-005-layout-persistenz-dateiverwaltung--undoredo-verlauf) -> [SPEC-DSG-005](file:///c:/dev/Froning/app/LineageGraph/docs/SPEC.md#spec-dsg-005---req-dsg-005)
- **Test-Typ:** Integration & Composable Test (`useDesignHistory.ts`, `DesignSidebar.vue`, `DesignCanvas.vue`, Backend `design_layouts`)
- **Test-Ziel:** Wiederherstellbarkeit von Bearbeitungsschritten, Anlegen neuer Entwürfe für beliebige Stammahnen ohne Auto-Load-Konflikte sowie isoliertes Laden von Speicherständen pro Proband.
- **Preconditions:** Proband `I1` besitzt gespeichertes Layout `"Druckversion 1"`. Proband `I10` besitzt noch kein gespeichertes Layout.
- **Testschritte:**
  1. Ast einklappen und Undo ausführen (`undo()`).
  2. Im Stammahnen-Dropdown von `I1` zu `I10` wechseln.
  3. Prüfen, dass der initiale Baum für `I10` generiert wird und NICHT das Layout von `I1` geladen wird.
  4. "Neues Design" anfordern (`openNewDesignModal`), Stammahn `I1` auswählen und neues Design bestätigen.
  5. Prüfen, dass für `I1` ein frisches Ausgangslayout erzeugt wird, statt das bestehende `"Druckversion 1"` zu laden (`skipAutoLoadOnce`).
  6. Layout als `.json`-Datei exportieren (`save_design_file`) und über Dateidialog öffnen (`read_design_file` via `loadStateFromFile`).
- **Erwartetes Ergebnis:**
  * Nach Undo ist der Ast wieder ausgeklappt.
  * Beim Wechsel zu `I10` verbleibt die Sicht auf `I10` ohne fremdes Layout.
  * Neues Design für `I1` erzeugt einen frischen Ausgangszustand und schlägt einen neuen Namen vor.
  * Dateiexport und -import übertragen den vollständigen Layoutzustand fehlerfrei.

#### TC-DSG-006: Hierarchische Stamm- und Zweig-Layouts (Subtree Composition & Isolation)
- **Traceability:** [REQ-DSG-006](file:///c:/dev/Froning/app/LineageGraph/docs/REQ.md#req-dsg-006-hierarchische-stamm--und-zweig-layouts-subtree-composition) -> [SPEC-DSG-006](file:///c:/dev/Froning/app/LineageGraph/docs/SPEC.md#spec-dsg-006---req-dsg-006)
- **Test-Typ:** Unit & Integration Test (*Implemented: Rust Backend `test_save_and_get_design_layouts_with_subtrees` & Frontend `useDesignLayout.ts` / `useDesignHistory.ts`*)
- **Test-Ziel:** Nachweis der isolierten Erstellung, Speicherung und Filterung von Zweig-Layouts (`subtree`), der automatischen Isolierung des Zweigankers aus Geschwistergruppen, der dynamischen, schreibgeschützten Einbettung in Master-Layouts mit Outward Push (Verdrängung nach links/rechts zur Kollisionsvermeidung) und lokalem Wappen/Hintergrund.
- **Preconditions:** Stammbaum mit Stammahn `I1`, Nachkomme `I10` in einer Geschwistergruppe mit `I11` und `I12`, wobei `I10` eigene Nachkommen (`I101`, `I102`) besitzt.
- **Testschritte:**
  1. Im Backend via `save_design_layout` ein Master-Layout für `I1` sowie ein Subtree-Layout für `I10` (`layout_type: "subtree"`, `anchor_person_id: "I10"`) speichern.
  2. `get_design_layouts` mit Filtern nach `anchor_person_id` und `layout_type` aufrufen.
  3. Im Frontend das Master-Layout laden und die Person `I10` mit dem Subtree-Layout verknüpfen (`linkSubtreeToAnchor`).
  4. Berechnete Gruppen in `visibleGroupAndMemberMap` prüfen: Ist `I10` aus der Geschwistergruppe mit `I11` und `I12` herausgelöst? Werden `I11` und `I12` sowie Nachbarzweige nach außen geschoben, sodass keine Überlappung mit dem Subtree entsteht?
  5. Drag-, Einklapp- oder Trenn-Aktion auf einer eingebetteten Zweig-Gruppe anstoßen.
  6. Via `switchToSubtreeDesign` in die Zweig-Bearbeitung wechseln und über `returnToMasterDesign` zurückkehren.
- **Erwartetes Ergebnis:**
  * Backend filtert Layouts exakt nach `layout_type` und `anchor_person_id`.
  * `I10` wird automatisch in eine eigenständige Gruppe isoliert; links liegende Geschwister/Zweige werden nach links und rechts liegende nach rechts geschoben.
  * Im Master-Layout werden die Nachkommen von `I10` durch die transformierten Zweig-Gruppen ersetzt; deren Koordinaten verschieben sich mit `deltaX` und `levelOffset` konsistent relativ zu `I10` bei 0 Überlappungen.
  * Alle eingebetteten Zweig-Karten und Gruppen besitzen `isReadOnly: true`; Interaktionen sind gesperrt und mit Schloss-Symbolen gekennzeichnet.
  * Ein eventuelles Hintergrundbild des Zweigs wird maßstabsgetreu und transparent am Zweiganker gerendert.
  * Wechsel in den Zweig-Modus und Rückkehr zum Master behalten den Zustand verlustfrei bei.

---

### 2.6 Domäne: Import & Differentieller Datenabgleich (IMP)

#### TC-IMP-001: Atomarer GEDCOM-Vollimport (5.5 / 5.5.1)
- **Traceability:** [REQ-IMP-001](file:///c:/dev/Froning/app/LineageGraph/docs/REQ.md#req-imp-001-atomarer-gedcom-vollimport-55--551) -> [SPEC-IMP-001](file:///c:/dev/Froning/app/LineageGraph/docs/SPEC.md#spec-imp-001---req-imp-001)
- **Test-Typ:** Unit & Integration Test (`parser::import_gedcom`)
- **Test-Ziel:** Vollständige, fehlerfreie Übernahme von Personen, Familien, Heiratsdaten und Eltern-Kind-Verknüpfungen aus GEDCOM 5.5/5.5.1.
- **Preconditions:** Valide GEDCOM-Testdatei mit 20 Personen und 6 Familien.
- **Testschritte:**
  1. `import_gedcom(&mut conn, &file_path)` ausführen.
  2. Tabellen `individuals`, `families` und `parent_child` zählen.
- **Erwartetes Ergebnis:**
  * Genau 20 Personen und 6 Familien werden angelegt.
  * Alle `CHIL`- und `FAMC`-Verknüpfungen sind konsistent in `parent_child` eingetragen.
  * Transaktion wird im Fehlerfall vollständig zurückgerollt.

#### TC-IMP-002: GEDCOM-Staging & Heuristisches Konfidenz-Matching
- **Traceability:** [REQ-IMP-002](file:///c:/dev/Froning/app/LineageGraph/docs/REQ.md#req-imp-002-intelligentes-gedcom-staging--matching) -> [SPEC-IMP-002](file:///c:/dev/Froning/app/LineageGraph/docs/SPEC.md#spec-imp-002---req-imp-002)
- **Test-Typ:** Unit Test (`stage_gedcom_for_merge`)
- **Test-Ziel:** Zuverlässige Erkennung von Personenidentitäten anhand von XREF, Namen und Lebensdaten ohne Datenbankmodifikation.
- **Preconditions:** Datenbank enthält `Johann Froning (* 1850)`. Importdatei enthält denselben `Johann Froning` sowie eine neue Person `Maria Schulte`.
- **Testschritte:**
  1. `stage_gedcom_for_merge(&conn, &file_path)` ausführen.
  2. Erzeugten `GedcomMergePlan` prüfen.
- **Erwartetes Ergebnis:**
  * `Johann Froning` wird als `mapped_persons` mit hoher Konfidenz (>= 80) eingestuft.
  * `Maria Schulte` wird in `new_persons` eingestuft.
  * Die Datenbank bleibt im Read-Only-Zustand.

#### TC-IMP-003: Differentieller 3-Wege-Merge mit Konfliktlösung
- **Traceability:** [REQ-IMP-003](file:///c:/dev/Froning/app/LineageGraph/docs/REQ.md#req-imp-003-differentieller-3-wege-merge-mit-konfliktl%C3%B6sung) -> [SPEC-IMP-003](file:///c:/dev/Froning/app/LineageGraph/docs/SPEC.md#spec-imp-003---req-imp-003)
- **Test-Typ:** Unit & Integration Test (*Implemented: `tests::test_gedcom_merge_matching_diff_and_execution`*)
- **Test-Ziel:** Ausführung eines detaillierten Merge-Plans mit feldweiser Entscheidung zwischen Datenbank- und Importstand.
- **Preconditions:** Datenbankwert für Sterbedatum ist leer. Importdatei enthält Sterbedatum `1920`. Geburtsort steht im Konflikt (`"Münster"` vs. `"Muenster (Westf)"`).
- **Testschritte:**
  1. Resolution übergeben: Sterbedatum auf `"import"` setzen, Geburtsort auf `"db"` belassen.
  2. `apply_gedcom_merge(&mut conn, resolution)` ausführen.
- **Erwartetes Ergebnis:**
  * Sterbedatum wird auf `1920` aktualisiert (Ergänzung).
  * Geburtsort verbleibt unverändert auf `"Münster"`.
  * `MergeResultStats` meldet 1 aktualisierte Person und 0 Fehler.

---

### 2.7 Domäne: Multi-Format-Export & Chronik-Erstellung (EXP)

#### TC-EXP-001: GEDCOM-Teilmengen-Export nach Scopes
- **Traceability:** [REQ-EXP-001](file:///c:/dev/Froning/app/LineageGraph/docs/REQ.md#req-exp-001-gedcom-teilmengen-export) -> [SPEC-EXP-001](file:///c:/dev/Froning/app/LineageGraph/docs/SPEC.md#spec-exp-001---req-exp-001)
- **Test-Typ:** Unit Test (*Implemented: `tests::test_gedcom_export_scopes`*)
- **Test-Ziel:** Validieren, dass der GEDCOM-Exportfilter die Scopes `All`, `Descendants`, `Ancestors` und `SpecificList` exakt einhält.
- **Preconditions:** Stammbaum mit 3 Generationen (Großeltern, Eltern, Kinder) und Partnern.
- **Testschritte:**
  1. Export mit Scope `Descendants { person_id: "Vater", include_spouses: false }` ausführen.
  2. Exportierte GEDCOM-Struktur analysieren.
- **Erwartetes Ergebnis:**
  * Datei enthält nur den Vater und dessen Kinder.
  * Die Großeltern und nicht einbezogene Partner tauchen weder als `INDI` noch in `FAM` auf.

#### TC-EXP-002: Strukturierter CSV-Export mit Trennzeichen & UTF-8-BOM
- **Traceability:** [REQ-EXP-002](file:///c:/dev/Froning/app/LineageGraph/docs/REQ.md#req-exp-002-strukturierter-csv-export) -> [SPEC-EXP-002](file:///c:/dev/Froning/app/LineageGraph/docs/SPEC.md#spec-exp-002---req-exp-002)
- **Test-Typ:** Unit Test (*Implemented: `tests::test_csv_export_scopes_and_formatting`*)
- **Test-Ziel:** Prüfung der CSV-Formatierung, Maskierung von Kommas/Anführungszeichen und korrekter Klarnamensauflösung für Eltern.
- **Preconditions:** Personen mit Sonderzeichen im Namen (`"Froning, Dr. Heinrich"`) und Elternverknüpfungen.
- **Testschritte:**
  1. `generate_csv(&conn, &GedcomExportScope::All, ';', true)` ausführen.
- **Erwartetes Ergebnis:**
  * Erstes Zeichen ist das UTF-8 Byte-Order-Mark `\u{FEFF}`.
  * Semikolon dient als Trenner; Felder mit Sonderzeichen sind sauber in `""` eingefasst.
  * Spalten `Vater_Name` und `Mutter_Name` enthalten vollständige Namen statt reiner IDs.

#### TC-EXP-003: Autarke Single-File-HTML-Chronik (Desktop, Android, iOS & Sandboxes)
- **Traceability:** [REQ-EXP-003](file:///c:/dev/Froning/app/LineageGraph/docs/REQ.md#req-exp-003-autarke-interaktive-html-chronik) -> [SPEC-EXP-003](file:///c:/dev/Froning/app/LineageGraph/docs/SPEC.md#spec-exp-003---req-exp-003)
- **Test-Typ:** Integration & Mobile Compatibility Test (`src/utils/htmlExport.ts`)
- **Test-Ziel:** Sicherstellen, dass die generierte HTML-Datei installationsfrei, ohne Internetverbindung und ohne externe CDN-Aufrufe lokal auf Desktop, Android- und iOS-Geräten (inklusive iOS Dateien-App/Quick Look und WhatsApp-Viewer) sowie auf Webservern voll funktionsfähig läuft.
- **Preconditions:** Aktiver Personenbaum mit Stammvater, Nachkommen, Implex-Verweisen und Ehen.
- **Testschritte:**
  1. `buildInteractiveExportTree` und `generateInteractiveTreeHtml` aufrufen.
  2. Generierten HTML-Code auf externe Skript- oder CSS-Links (`http://`, `https://`) analysieren.
  3. Vorhandensein der minifizierten D3-Engine (`D3.js v7.9.2`) und des `<script id="tree-data-json" type="application/json">`-Blocks prüfen.
  4. Viewport-Meta-Tag auf `viewport-fit=cover` und CSS auf `height: 100dvh` sowie `env(safe-area-inset-*)` prüfen.
  5. Touch-Hitboxen (`circle.touch-hitbox` mit `r=22`) und Mindest-Touch-Größen (44x44px) verifizieren.
  6. Ausführen in simulierter Offline-/Null-Origin-Sandbox testen (Absicherung gegen `SecurityError` beim Web Storage über `safeStorage`).
  7. In-App-Vorschau in Produktions-Builds (WebView2) prüfen: Validieren, dass die CSP-Direktiven in `tauri.conf.json` (`script-src 'self' 'unsafe-inline' ...`, `frame-src 'self' blob: data:`) die Skriptausführung des Vorschau-Iframes nicht unterbinden.
- **Erwartetes Ergebnis:**
  * 0 externe Netzwerkabfragen (`<script src="...">` und `<link href="...">` sind nicht vorhanden).
  * Voll funktionsfähige clientseitige Volltextsuche, D3-Zoom/Pan mit `touch-action: none` ohne Gesten-Konflikte.
  * Korrektes Öffnen und Navigieren auf iOS Quick Look und mobilen Touchscreens.
  * Vollständige Anzeige der interaktiven Vorschau im Desktop- und Mobile-Modus sowohl in der Entwicklungsumgebung als auch in installierten Produktions-Releases.

#### TC-EXP-004: Hochauflösender Bild- & Vektorexport (SVG / PNG)
- **Traceability:** [REQ-EXP-004](file:///c:/dev/Froning/app/LineageGraph/docs/REQ.md#req-exp-004-hochaufl%C3%B6sender-bild---vektorexport-des-stammbaums) -> [SPEC-EXP-004](file:///c:/dev/Froning/app/LineageGraph/docs/SPEC.md#spec-exp-004---req-exp-004)
- **Test-Typ:** Component / Export Test (`src/utils/designExport.ts`)
- **Test-Ziel:** Validieren, dass der Stammbaum als maßstabsgetreues Vektor-SVG und als hochauflösendes Raster-PNG ohne abgeschnittene Ränder exportiert wird.
- **Preconditions:** Vollständig gelayouteter Design-Stammbaum auf der Leinwand.
- **Testschritte:**
  1. SVG-Export anstoßen.
  2. PNG-Export mit Skalierungsfaktor 2.0 anstoßen.
- **Erwartetes Ergebnis:**
  * SVG ist wohlgeformtes XML mit korrekter `viewBox` passend zur Gesamtbreite/-höhe.
  * PNG besitzt die doppelte Pixelauflösung und scharfe Schriften.

#### TC-EXP-005: LaTeX/TikZ-Buchchronik-Generierung & PDF-Kompilierung
- **Traceability:** [REQ-EXP-005](file:///c:/dev/Froning/app/LineageGraph/docs/REQ.md#req-exp-005-automatisierte-latextikz-buchchronik) -> [SPEC-EXP-005](file:///c:/dev/Froning/app/LineageGraph/docs/SPEC.md#spec-exp-005---req-exp-005)
- **Test-Typ:** Unit & Integration Test (`escape_latex`, `export_latex_pdf`)
- **Test-Ziel:** Prüfung der LaTeX-Sonderzeichenmaskierung gegen Kompilierungsfehler und Verifikation des `pdflatex`-Subprozesses.
- **Preconditions:** Personendaten mit Zeichen wie `&`, `%`, `$`, `_` und `#` im Namen/Beruf.
- **Testschritte:**
  1. `escape_latex("Müller & Co. / 100% Chef_Ehe")` aufrufen.
  2. TeX-Quelltext generieren.
- **Erwartetes Ergebnis:**
  * `escape_latex` liefert `Müller \& Co. / 100\% Chef\_Ehe`.
  * Kein LaTeX-Kompilierungsabbruch; standardkonformes Dokument wird erzeugt.

### 2.8 Domäne: Forschungsassistent & Genealogischer Lücken-Finder (RES)

#### TC-RES-001: Regelbasierte Lückenerkennung (Eltern, Tod, Orte, Geschwisterlücke)
- **Traceability:** [REQ-RES-001](file:///c:/dev/Froning/app/LineageGraph/docs/REQ.md#req-res-001-regelbasierte-l%C3%BCckenerkennung---heuristiken) -> [SPEC-RES-001](file:///c:/dev/Froning/app/LineageGraph/docs/SPEC.md#spec-res-001---req-res-001)
- **Test-Typ:** Unit Test (Rust `research::tests::test_analyze_gaps_in_memory`)
- **Test-Ziel:** Verifikation, dass alle vier genealogischen Lückentypen deterministisch und unter Berücksichtigung konfigurierbarer Schwellenwerte identifiziert werden.
- **Preconditions:** Datensatz mit Testpersonen: I1 (keine Eltern, Geburt 1820 ohne Tod), I2 (Kind von I1, Geburt 1850 ohne Geburtsort, Tod 1920), I3 (Kind von I1, Geburt 1856, Abstand zu I2 = 6,5 Jahre).
- **Testschritte:**
  1. `analyze_gaps` mit Scope `all` und Schwellenwerten (110 Jahre, 3.5 Jahre) aufrufen.
  2. Identifizierte Aufgaben nach Lückentypen filtern und prüfen.
- **Erwartetes Ergebnis:**
  * I1 erzeugt `MISSING_PARENTS` und `MISSING_DEATH`.
  * I2 erzeugt `MISSING_PLACE` (fehlender Geburtsort).
  * Familie von I1 erzeugt `CHILD_GAP` zwischen I2 und I3 mit errechnetem Abstand 6,5 Jahre.

#### TC-RES-002: Kontextuelle Recherche-Links & Parameter-Kodierung
- **Traceability:** [REQ-RES-002](file:///c:/dev/Froning/app/LineageGraph/docs/REQ.md#req-res-002-kontextuelle-recherche-handlungsempfehlungen---archiv-links) -> [SPEC-RES-002](file:///c:/dev/Froning/app/LineageGraph/docs/SPEC.md#spec-res-002---req-res-002)
- **Test-Typ:** Unit Test (Rust `research::tests::test_external_links_generation`)
- **Test-Ziel:** Verifikation der standardkonformen URL-Generierung für FamilySearch, Matricula, Archion und Meyers Gazetteer inklusive Umlaut- und Sonderzeichenkodierung.
- **Preconditions:** Personendaten: "Johann Müller", Geburtsjahr 1850, Ort "Münster".
- **Testschritte:**
  1. `generate_archive_links(Some("Johann"), Some("Müller"), Some(1850), Some("Münster"))` ausführen.
- **Erwartetes Ergebnis:**
  * FamilySearch-URL enthält kodierte Parameter für Vorname, Nachname und Datumsfenster (1848 bis 1852).
  * Matricula-, Archion- und Meyers-URLs sind wohlgeformt mit Ortsfilter auf "Münster".

#### TC-RES-003: Relevanz-Scoring, Status-Persistenz & Kaskadierung
- **Traceability:** [REQ-RES-003](file:///c:/dev/Froning/app/LineageGraph/docs/REQ.md#req-res-003-priorisierungs-scoring---persistente-aufgabenverwaltung) -> [SPEC-RES-003](file:///c:/dev/Froning/app/LineageGraph/docs/SPEC.md#spec-res-003---req-res-003)
- **Test-Typ:** Unit & Integration Test (Rust & SQLite)
- **Test-Ziel:** Prüfung der Prioritäts-Scoring-Logik (`urgent`, `high`, `medium`, `low`) und der persistenten Aufgabenverwaltung in der SQLite-Tabelle `research_tasks`.
- **Preconditions:** SQLite-Datenbank mit `research_tasks`-Schema.
- **Testschritte:**
  1. `calculate_priority_score` für direkte Ahnenlinie vs. Nebenlinie aufrufen.
  2. Aufgabe via `upsert_task_status` mit Status `in_progress` und Notizen anlegen.
  3. Gleiche Aufgabe mit geändertem Status `completed` aktualisieren (`ON CONFLICT`).
  4. Zugehörige Person löschen und kaskadierende Bereinigung der Aufgabe verifizieren.
- **Erwartetes Ergebnis:**
  * Ahnenlinien erhalten höheren Score (`urgent` / `high`) als Nebenlinien.
  * Status und Notizen werden idempotent persistiert.
  * `ON DELETE CASCADE` entfernt Aufgaben beim Löschen der Person rückstandslos.

#### TC-RES-004: Konfigurierbare Recherche-Portale & Personenzentriertes Dossier
- **Traceability:** [REQ-RES-004](file:///c:/dev/Froning/app/LineageGraph/docs/REQ.md#req-res-004-konfigurierbare-recherche-portale---personenzentriertes-forschungsdossier) -> [SPEC-RES-004](file:///c:/dev/Froning/app/LineageGraph/docs/SPEC.md#spec-res-004---req-res-004)
- **Test-Typ:** Frontend Component & Composable Test (TypeScript / Vue 3)
- **Test-Ziel:** Verifikation der Portal-Konfiguration (Aktivierung/Deaktivierung, Spezialisierungs- und Kostenstufen-Kennzeichnung), korrekte dynamische URL-Generierung und personenzentrierte Dossier-Interaktion (1-Klick-Statuswechsel, Akkordeon, Batch-Abschluss).
- **Preconditions:** LineageGraph Frontend mit `useResearchPortals` und `ResearchAssistantView.vue`.
- **Testschritte:**
  1. Portal-Konfiguration in den Einstellungen öffnen; kostenpflichtiges Portal (z. B. Archion) aktivieren und Standard-Portal (z. B. FamilySearch) prüfen.
  2. Im Forschungsassistenten Person mit mehreren Lücken auswählen; prüfen, dass Recherche-Portale einmalig im Dossier-Header erscheinen.
  3. Recherche-Link betätigen und prüfen, dass dynamisch generierte URL Namens-, Datums- und Ortsparameter korrekt encodiert.
  4. Lücken-Status per Dropdown/Pill einzeln umschalten (`Offen` -> `Erledigt`).
  5. Batch-Button `Alle als erledigt` betätigen und prüfen, dass alle offenen Lücken der Person auf `completed` gesetzt werden.
- **Erwartetes Ergebnis:**
  * Dynamische Portal-Steuerung ohne doppelte Links; flüssige 1-Klick-Statusverwaltung im kompakten Personendossier.

#### TC-RES-005: Erkennung isolierter Zweige, Generationsfilter & Anknüpfungs-Heuristik
- **Traceability:** [REQ-RES-005](file:///c:/dev/Froning/app/LineageGraph/docs/REQ.md#req-res-005-erkennung-und-analyse-isolierter-zweige-insel-finder) -> [SPEC-RES-005](file:///c:/dev/Froning/app/LineageGraph/docs/SPEC.md#spec-res-005---req-res-005)
- **Test-Typ:** Unit Test (Rust `research::tests::test_find_isolated_branches`) & Component Test (Vue 3)
- **Test-Ziel:** Verifikation der Zerlegung in Zusammenhangskomponenten, korrekte Bestimmung von Hauptstamm und isolierten Zweigen, Berechnung der Generationentiefe sowie Ermittlung von Anknüpfungsvorschlägen mit Konfidenz-Scoring.
- **Preconditions:** Testdatensatz mit Hauptstamm (I1 -> I2 -> I3), isoliertem Zweig (B1 -> B2, 2 Generationen, Nachname Becker) und Einzelperson (S1, Nachname Froning, Ort Münster).
- **Testschritte:**
  1. `find_isolated_branches(&persons, Some("I1"))` aufrufen.
  2. Prüfung von Komponentenanzahl, Hauptstamm-Größe und Anzahl isolierter Zweige / Einzelpersonen.
  3. Verifikation, dass Zweig Becker generation_depth = 2 und Spitzenahn B1 aufweist.
  4. Verifikation, dass S1 einen Anknüpfungsvorschlag an den Hauptstamm (Froning, Münster) mit Konfidenz >= 65 % generiert.
  5. UI-Test: Umschalten auf Sub-Tab `Isolierte Zweige & Inseln`, Filtern nach "≥ 2 Gen." und Prüfen der 1-Klick-Navigation.
- **Erwartetes Ergebnis:**
  * Exakte Erkennung isolierter Teilgraphen, robuste Generationszählung und relevante Anknüpfungshinweise.

---

## Teil 3: End-to-End Traceability-Matrix (Anforderung -> Spezifikation -> Test)

| Domäne | REQ-ID | SPEC-ID | TC-ID | Test-Typ | Abdeckungsgrad |
| :--- | :--- | :--- | :--- | :--- | :---: |
| **TRM** | [REQ-TRM-001](file:///c:/dev/Froning/app/LineageGraph/docs/REQ.md#req-trm-001-multi-stammbaum-verwaltung--umschaltung) | [SPEC-TRM-001](file:///c:/dev/Froning/app/LineageGraph/docs/SPEC.md#spec-trm-001---req-trm-001) | **TC-TRM-001** | Integration Test (IPC / State) | 100 % |
| **TRM** | [REQ-TRM-002](file:///c:/dev/Froning/app/LineageGraph/docs/REQ.md#req-trm-002-zweistufige-sicherheitsl%C3%B6schung-mit-prozess-schutz) | [SPEC-TRM-002](file:///c:/dev/Froning/app/LineageGraph/docs/SPEC.md#spec-trm-002---req-trm-002) | **TC-TRM-002** | Unit & Integration Test (Rust) | 100 % |
| **TRM** | [REQ-TRM-003](file:///c:/dev/Froning/app/LineageGraph/docs/REQ.md#req-trm-003-automatischer-fallback--leerzustands-behandlung) | [SPEC-TRM-003](file:///c:/dev/Froning/app/LineageGraph/docs/SPEC.md#spec-trm-003---req-trm-003) | **TC-TRM-003** | Integration Test (UI / State) | 100 % |
| **TRM** | [REQ-TRM-004](file:///c:/dev/Froning/app/LineageGraph/docs/REQ.md#req-trm-004-app-aktualisierung--versionspr%C3%BCfung) | [SPEC-TRM-004](file:///c:/dev/Froning/app/LineageGraph/docs/SPEC.md#spec-trm-004---req-trm-004) | **TC-TRM-004** | Unit & Integration Test (Rust / UI) | 100 % |
| **DAT** | [REQ-DAT-001](file:///c:/dev/Froning/app/LineageGraph/docs/REQ.md#req-dat-001-personen-erfassung--inkrementelle-xref-generierung) | [SPEC-DAT-001](file:///c:/dev/Froning/app/LineageGraph/docs/SPEC.md#spec-dat-001---req-dat-001) | **TC-DAT-001** | Unit Test (Rust) | 100 % |
| **DAT** | [REQ-DAT-002](file:///c:/dev/Froning/app/LineageGraph/docs/REQ.md#req-dat-002-tabellarische-batch-editierung--validierungs-engine) | [SPEC-DAT-002](file:///c:/dev/Froning/app/LineageGraph/docs/SPEC.md#spec-dat-002---req-dat-002) | **TC-DAT-002** | Unit & Integration Test (Rust / UI) | 100 % |
| **DAT** | [REQ-DAT-003](file:///c:/dev/Froning/app/LineageGraph/docs/REQ.md#req-dat-003-eltern-kind-verkn%C3%BCpfung-mit-zyklus---rekursionserkennung) | [SPEC-DAT-003](file:///c:/dev/Froning/app/LineageGraph/docs/SPEC.md#spec-dat-003---req-dat-003) | **TC-DAT-003** | Unit Test (Rust BFS) | 100 % |
| **DAT** | [REQ-DAT-004](file:///c:/dev/Froning/app/LineageGraph/docs/REQ.md#req-dat-004-partnerschafts--und-ehedaten-management) | [SPEC-DAT-004](file:///c:/dev/Froning/app/LineageGraph/docs/SPEC.md#spec-dat-004---req-dat-004) | **TC-DAT-004** | Unit Test (Rust) | 100 % |
| **DAT** | [REQ-DAT-005](file:///c:/dev/Froning/app/LineageGraph/docs/REQ.md#req-dat-005-audit---revisionsfelder-gedcom-chan--uid) | [SPEC-DAT-005](file:///c:/dev/Froning/app/LineageGraph/docs/SPEC.md#spec-dat-005---req-dat-005) | **TC-DAT-005** | Unit Test (Rust) | 100 % |
| **ALG** | [REQ-ALG-001](file:///c:/dev/Froning/app/LineageGraph/docs/REQ.md#req-alg-001-multi-probanden-verwaltung-multi-root) | [SPEC-ALG-001](file:///c:/dev/Froning/app/LineageGraph/docs/SPEC.md#spec-alg-001---req-alg-001) | **TC-ALG-001** | Integration Test (Backend / DB) | 100 % |
| **ALG** | [REQ-ALG-002](file:///c:/dev/Froning/app/LineageGraph/docs/REQ.md#req-alg-002-chronologische--patrilinearematrilineare-henry-code-berechnung) | [SPEC-ALG-002](file:///c:/dev/Froning/app/LineageGraph/docs/SPEC.md#spec-alg-002---req-alg-002) | **TC-ALG-002** | Unit Test (Rust Engine) | 100 % |
| **ALG** | [REQ-ALG-003](file:///c:/dev/Froning/app/LineageGraph/docs/REQ.md#req-alg-003-k%C3%BCrzester-verwandtschaftspfad-a---bfs-graphsuche) | [SPEC-ALG-003](file:///c:/dev/Froning/app/LineageGraph/docs/SPEC.md#spec-alg-003---req-alg-003) | **TC-ALG-003** | Unit & Integration Test (Petgraph & TS) | 100 % |
| **UI** | [REQ-UI-001](file:///c:/dev/Froning/app/LineageGraph/docs/REQ.md#req-ui-001-interaktive-datentabelle-mit-sortierung--multi-filtern) | [SPEC-UI-001](file:///c:/dev/Froning/app/LineageGraph/docs/SPEC.md#spec-ui-001---req-ui-001) | **TC-UI-001** | Component Test (Vue TableView) | 100 % |
| **UI** | [REQ-UI-002](file:///c:/dev/Froning/app/LineageGraph/docs/REQ.md#req-ui-002-infinite-canvas-stammbaum-visualisierung) | [SPEC-UI-002](file:///c:/dev/Froning/app/LineageGraph/docs/SPEC.md#spec-ui-002---req-ui-002) | **TC-UI-002** | UI / Component Test (TreeCanvas) | 100 % |
| **UI** | [REQ-UI-003](file:///c:/dev/Froning/app/LineageGraph/docs/REQ.md#req-ui-003-slide-over-detail-drawer--verwandtschafts-inspector) | [SPEC-UI-003](file:///c:/dev/Froning/app/LineageGraph/docs/SPEC.md#spec-ui-003---req-ui-003) | **TC-UI-003** | Component Test (DetailsDrawer) | 100 % |
| **UI** | [REQ-UI-004](file:///c:/dev/Froning/app/LineageGraph/docs/REQ.md#req-ui-004-freie-schnellabfrage-free-query-modal) | [SPEC-UI-004](file:///c:/dev/Froning/app/LineageGraph/docs/SPEC.md#spec-ui-004---req-ui-004) | **TC-UI-004** | Component Test (FreeQueryModal) | 100 % |
| **UI** | [REQ-UI-005](file:///c:/dev/Froning/app/LineageGraph/docs/REQ.md#req-ui-005-vollst%C3%A4ndige-internationalisierung-de--en) | [SPEC-UI-005](file:///c:/dev/Froning/app/LineageGraph/docs/SPEC.md#spec-ui-005---req-ui-005) | **TC-UI-005** | Component Test (Vue I18n) | 100 % |
| **DSG** | [REQ-DSG-001](file:///c:/dev/Froning/app/LineageGraph/docs/REQ.md#req-dsg-001-automatisches-hierarchisches-pedigree-layout) | [SPEC-DSG-001](file:///c:/dev/Froning/app/LineageGraph/docs/SPEC.md#spec-dsg-001---req-dsg-001) | **TC-DSG-001** | Unit Test (Layout Engine) | 100 % |
| **DSG** | [REQ-DSG-002](file:///c:/dev/Froning/app/LineageGraph/docs/REQ.md#req-dsg-002-orthogonale-linienf%C3%BChrung-bottom-up-track-assignment--linienbr%C3%BCcken-line-bridges) | [SPEC-DSG-002](file:///c:/dev/Froning/app/LineageGraph/docs/SPEC.md#spec-dsg-002---req-dsg-002) | **TC-DSG-002** | Unit & Component Test (Track Assignment & SVG) | 100 % |
| **DSG** | [REQ-DSG-003](file:///c:/dev/Froning/app/LineageGraph/docs/REQ.md#req-dsg-003-voll-konfigurierbare-personenkarten) | [SPEC-DSG-003](file:///c:/dev/Froning/app/LineageGraph/docs/SPEC.md#spec-dsg-003---req-dsg-003) | **TC-DSG-003** | Component Test (PersonCard) | 100 % |
| **DSG** | [REQ-DSG-004](file:///c:/dev/Froning/app/LineageGraph/docs/REQ.md#req-dsg-004-hintergrundgestaltung--bild-persistierung) | [SPEC-DSG-004](file:///c:/dev/Froning/app/LineageGraph/docs/SPEC.md#spec-dsg-004---req-dsg-004) | **TC-DSG-004** | Integration Test (Storage / IO) | 100 % |
| **DSG** | [REQ-DSG-005](file:///c:/dev/Froning/app/LineageGraph/docs/REQ.md#req-dsg-005-layout-persistenz--undoredo-verlauf) | [SPEC-DSG-005](file:///c:/dev/Froning/app/LineageGraph/docs/SPEC.md#spec-dsg-005---req-dsg-005) | **TC-DSG-005** | Integration Test (History / DB) | 100 % |
| **DSG** | [REQ-DSG-006](file:///c:/dev/Froning/app/LineageGraph/docs/REQ.md#req-dsg-006-hierarchische-stamm--und-zweig-layouts-subtree-composition) | [SPEC-DSG-006](file:///c:/dev/Froning/app/LineageGraph/docs/SPEC.md#spec-dsg-006---req-dsg-006) | **TC-DSG-006** | Unit & Integration Test (Rust / Vue) | 100 % |
| **IMP** | [REQ-IMP-001](file:///c:/dev/Froning/app/LineageGraph/docs/REQ.md#req-imp-001-atomarer-gedcom-vollimport-55--551) | [SPEC-IMP-001](file:///c:/dev/Froning/app/LineageGraph/docs/SPEC.md#spec-imp-001---req-imp-001) | **TC-IMP-001** | Unit & Integration Test (Parser) | 100 % |
| **IMP** | [REQ-IMP-002](file:///c:/dev/Froning/app/LineageGraph/docs/REQ.md#req-imp-002-intelligentes-gedcom-staging--matching) | [SPEC-IMP-002](file:///c:/dev/Froning/app/LineageGraph/docs/SPEC.md#spec-imp-002---req-imp-002) | **TC-IMP-002** | Unit Test (Staging Engine) | 100 % |
| **IMP** | [REQ-IMP-003](file:///c:/dev/Froning/app/LineageGraph/docs/REQ.md#req-imp-003-differentieller-3-wege-merge-mit-konfliktl%C3%B6sung) | [SPEC-IMP-003](file:///c:/dev/Froning/app/LineageGraph/docs/SPEC.md#spec-imp-003---req-imp-003) | **TC-IMP-003** | Unit & Integration Test (Rust Merge) | 100 % |
| **EXP** | [REQ-EXP-001](file:///c:/dev/Froning/app/LineageGraph/docs/REQ.md#req-exp-001-gedcom-teilmengen-export) | [SPEC-EXP-001](file:///c:/dev/Froning/app/LineageGraph/docs/SPEC.md#spec-exp-001---req-exp-001) | **TC-EXP-001** | Unit Test (Rust Exporter) | 100 % |
| **EXP** | [REQ-EXP-002](file:///c:/dev/Froning/app/LineageGraph/docs/REQ.md#req-exp-002-strukturierter-csv-export) | [SPEC-EXP-002](file:///c:/dev/Froning/app/LineageGraph/docs/SPEC.md#spec-exp-002---req-exp-002) | **TC-EXP-002** | Unit Test (Rust Exporter) | 100 % |
| **EXP** | [REQ-EXP-003](file:///c:/dev/Froning/app/LineageGraph/docs/REQ.md#req-exp-003-autarke-interaktive-html-chronik) | [SPEC-EXP-003](file:///c:/dev/Froning/app/LineageGraph/docs/SPEC.md#spec-exp-003---req-exp-003) | **TC-EXP-003** | Integration Test (HTML Generator) | 100 % |
| **EXP** | [REQ-EXP-004](file:///c:/dev/Froning/app/LineageGraph/docs/REQ.md#req-exp-004-hochaufl%C3%B6sender-bild---vektorexport-des-stammbaums) | [SPEC-EXP-004](file:///c:/dev/Froning/app/LineageGraph/docs/SPEC.md#spec-exp-004---req-exp-004) | **TC-EXP-004** | Component Test (Canvas Export) | 100 % |
| **EXP** | [REQ-EXP-005](file:///c:/dev/Froning/app/LineageGraph/docs/REQ.md#req-exp-005-automatisierte-latextikz-buchchronik) | [SPEC-EXP-005](file:///c:/dev/Froning/app/LineageGraph/docs/SPEC.md#spec-exp-005---req-exp-005) | **TC-EXP-005** | Unit & Integration Test (LaTeX/Tera) | 100 % |
| **RES** | [REQ-RES-001](file:///c:/dev/Froning/app/LineageGraph/docs/REQ.md#req-res-001-regelbasierte-l%C3%BCckenerkennung---heuristiken) | [SPEC-RES-001](file:///c:/dev/Froning/app/LineageGraph/docs/SPEC.md#spec-res-001---req-res-001) | **TC-RES-001** | Unit Test (Rust Research Engine) | 100 % |
| **RES** | [REQ-RES-002](file:///c:/dev/Froning/app/LineageGraph/docs/REQ.md#req-res-002-kontextuelle-recherche-handlungsempfehlungen---archiv-links) | [SPEC-RES-002](file:///c:/dev/Froning/app/LineageGraph/docs/SPEC.md#spec-res-002---req-res-002) | **TC-RES-002** | Unit Test (Rust URL Encoding) | 100 % |
| **RES** | [REQ-RES-003](file:///c:/dev/Froning/app/LineageGraph/docs/REQ.md#req-res-003-priorisierungs-scoring---persistente-aufgabenverwaltung) | [SPEC-RES-003](file:///c:/dev/Froning/app/LineageGraph/docs/SPEC.md#spec-res-003---req-res-003) | **TC-RES-003** | Unit & Integration Test (Rust/SQLite) | 100 % |
| **RES** | [REQ-RES-004](file:///c:/dev/Froning/app/LineageGraph/docs/REQ.md#req-res-004-konfigurierbare-recherche-portale---personenzentriertes-forschungsdossier) | [SPEC-RES-004](file:///c:/dev/Froning/app/LineageGraph/docs/SPEC.md#spec-res-004---req-res-004) | **TC-RES-004** | Component & Composable Test (Vue/TS) | 100 % |
| **RES** | [REQ-RES-005](file:///c:/dev/Froning/app/LineageGraph/docs/REQ.md#req-res-005-erkennung-und-analyse-isolierter-zweige-insel-finder) | [SPEC-RES-005](file:///c:/dev/Froning/app/LineageGraph/docs/SPEC.md#spec-res-005---req-res-005) | **TC-RES-005** | Unit Test (Rust Graph CC/BFS) & Vue 3 | 100 % |

