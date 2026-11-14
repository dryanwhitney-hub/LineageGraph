# Technische Spezifikation & Traceability (SPEC)

**System:** LineageGraph (Froning Familienbuch)  
**Dokument-Version:** 3.1.0  
**Status:** Freigegebener Ist-Stand  
**Datum:** 14. November 2026  
**Referenzierte Dokumente:** [REQ.md](file:///c:/dev/Froning/app/LineageGraph/docs/REQ.md), [Architecture.md](file:///c:/dev/Froning/app/LineageGraph/docs/Architecture.md)

---

## 1. Einleitung & Nachvollziehbarkeit (Traceability)

Dieses Dokument übersetzt die im fachlichen Anforderungsdokument ([REQ.md](file:///c:/dev/Froning/app/LineageGraph/docs/REQ.md)) spezifizierten Anforderungen in exakte technische Spezifikationen. Jede `SPEC-ID` verweist direkt auf die zugehörige `REQ-ID` und legt die architektonische Schicht, die betroffenen Quellcode-Dateien sowie die konkrete algorithmische und datentechnische Umsetzung dar.

---

## 2. Technische Spezifikationen

### 2.1 Domäne: Stammbaum- & Workspace-Verwaltung (TRM)

#### SPEC-TRM-001 -> REQ-TRM-001
- **Fachliche Anforderung:** Multi-Stammbaum-Verwaltung & Umschaltung ([REQ-TRM-001](file:///c:/dev/Froning/app/LineageGraph/docs/REQ.md#req-trm-001-multi-stammbaum-verwaltung--umschaltung))
- **Architektonische Schicht & Komponenten-Mapping:**
  - Rust Backend: [`src-tauri/src/lib.rs`](file:///c:/dev/Froning/app/LineageGraph/src-tauri/src/lib.rs#L245-L260) (`get_trees`, `switch_tree`)
  - Vue Composable: [`src/composables/usePersons.ts`](file:///c:/dev/Froning/app/LineageGraph/src/composables/usePersons.ts) (`handleTreeSwitch`, `initTrees`)
  - UI-Komponente: [`src/components/modals/SettingsModal.vue`](file:///c:/dev/Froning/app/LineageGraph/src/components/modals/SettingsModal.vue)
- **Technische Umsetzung:**
  `list_tree_names` liest das Anwendungsdatenverzeichnis (`state.app_dir`) aus, filtert alle Dateien mit der Endung `.db` und liefert eine deduplizierte, alphabetisch sortierte Liste von Stammbaumnamen zurück. `switch_tree` validiert den Stammbaumnamen mit `validate_tree_name` gegen ungültige Zeichen und Path-Traversal-Sequenzen (`..`, `/`, `\`, `\0`), initialisiert via [`src-tauri/src/db.rs`](file:///c:/dev/Froning/app/LineageGraph/src-tauri/src/db.rs) (`init_database`) die SQLite-Verbindung neu und aktualisiert die Mutex-Felder `db` und `active_tree` im `AppState`. Das Frontend stößt über `usePersons` anschließend eine Neuladung aller Personen, Probanden und Relationen an.

#### SPEC-TRM-002 -> REQ-TRM-002
- **Fachliche Anforderung:** Zweistufige Sicherheitslöschung mit Prozess-Schutz ([REQ-TRM-002](file:///c:/dev/Froning/app/LineageGraph/docs/REQ.md#req-trm-002-zweistufige-sicherheitsl%C3%B6schung-mit-prozess-schutz))
- **Architektonische Schicht & Komponenten-Mapping:**
  - Rust Backend: [`src-tauri/src/lib.rs`](file:///c:/dev/Froning/app/LineageGraph/src-tauri/src/lib.rs#L261-L365) (`delete_tree`, `delete_tree_internal`)
  - UI-Komponente: [`src/components/modals/DeleteTreeModal.vue`](file:///c:/dev/Froning/app/LineageGraph/src/components/modals/DeleteTreeModal.vue)
  - Vue Composable: [`src/composables/usePersons.ts`](file:///c:/dev/Froning/app/LineageGraph/src/composables/usePersons.ts) (`startDeleteTree`, `confirmDeleteTree`, `cancelDeleteTree`)
- **Technische Umsetzung:**
  `delete_tree_internal` synchronisiert die SQLite-Verbindung mittels `PRAGMA wal_checkpoint(TRUNCATE);` und ersetzt die aktive Datenbank im Mutex durch `init_in_memory_database()`. Dadurch werden alle Windows-Betriebssystem-Dateilocks auf die physischen Dateien freigegeben. Danach werden `<tree>.db`, `<tree>.db-wal`, `<tree>.db-shm`, `<tree>.db-journal` sowie `<tree>.sqlite*` iterativ gelöscht. Bei Dateisperren greift ein 5-stufiger Retry-Mechanismus mit 100 ms Backoff. Das Frontend rendert `DeleteTreeModal.vue` mit `z-index: 1200` und setzt den DOM-Autofokus auf den hervorgehobenen Abbrechen-Button.

#### SPEC-TRM-003 -> REQ-TRM-003
- **Fachliche Anforderung:** Automatischer Fallback & Leerzustands-Behandlung ([REQ-TRM-003](file:///c:/dev/Froning/app/LineageGraph/docs/REQ.md#req-trm-003-automatischer-fallback--leerzustands-behandlung))
- **Architektonische Schicht & Komponenten-Mapping:**
  - Rust Backend: [`src-tauri/src/lib.rs`](file:///c:/dev/Froning/app/LineageGraph/src-tauri/src/lib.rs#L2400-L2450) (`create_tree_and_import`)
  - UI-Orchestrierung: [`src/App.vue`](file:///c:/dev/Froning/app/LineageGraph/src/App.vue#L100-L135)
  - UI-Komponente: [`src/components/modals/GedcomImportModal.vue`](file:///c:/dev/Froning/app/LineageGraph/src/components/modals/GedcomImportModal.vue)
- **Technische Umsetzung:**
  `delete_tree` gibt die Liste der verbliebenen Stammbäume zurück. Ist die Liste leer, setzt das Frontend `activeTree = ''`, leert alle reaktiven Referenzen (`persons.value = []`, `rootAncestors.value = []`, `selectedPerson.value = null`) und blendet in den Einstellungen den Löschbutton aus. Bei Aufruf von `create_tree_and_import` validiert das Backend den neuen Wunschnamen, initialisiert die entsprechende `.db`-Datei und stößt den Import an.

#### SPEC-TRM-004 -> REQ-TRM-004
- **Fachliche Anforderung:** App-Aktualisierung & Versionsprüfung ([REQ-TRM-004](file:///c:/dev/Froning/app/LineageGraph/docs/REQ.md#req-trm-004-app-aktualisierung--versionspr%C3%BCfung))
- **Architektonische Schicht & Komponenten-Mapping:**
  - Rust Backend: [`src-tauri/src/lib.rs`](file:///c:/dev/Froning/app/LineageGraph/src-tauri/src/lib.rs#L2645-L2720) (`check_internet_connection`, `check_connectivity`, `open_user_guide`, `resolve_user_guide_path`)
  - Tauri Plugin & Capabilities: [`src-tauri/tauri.conf.json`](file:///c:/dev/Froning/app/LineageGraph/src-tauri/tauri.conf.json), [`src-tauri/capabilities/default.json`](file:///c:/dev/Froning/app/LineageGraph/src-tauri/capabilities/default.json) (`updater:default`, `opener:default`, `@tauri-apps/plugin-updater`, `@tauri-apps/plugin-opener`)
  - Frontend Composable: [`src/composables/useAppUpdater.ts`](file:///c:/dev/Froning/app/LineageGraph/src/composables/useAppUpdater.ts)
  - UI-Komponenten: [`src/components/modals/UpdateConfirmModal.vue`](file:///c:/dev/Froning/app/LineageGraph/src/components/modals/UpdateConfirmModal.vue), [`src/components/modals/SettingsModal.vue`](file:///c:/dev/Froning/app/LineageGraph/src/components/modals/SettingsModal.vue), [`src/App.vue`](file:///c:/dev/Froning/app/LineageGraph/src/App.vue)
- **Technische Umsetzung:**
  `check_connectivity` führt über `std::net::TcpStream::connect_timeout` (1500 ms) nicht-blockierende TCP-Pings gegen robuste DNS/HTTPS-Endpunkte (`1.1.1.1:53`, `8.8.8.8:53`, `github.com:443`) durch (gekapselt in `tauri::async_runtime::spawn_blocking`). Das Frontend fragt `check_internet_connection` über die Tauri-IPC-Bridge ab. Bei vorhandenem Internet ruft `useAppUpdater.checkForUpdates` die Funktion `check()` von `@tauri-apps/plugin-updater` auf, welche die Update-Metadaten (`latest.json` auf GitHub Releases) abgleicht. Beim Start (`onMounted` in `App.vue`) erfolgt die Prüfung geräuschlos im Hintergrund; in `SettingsModal.vue` kann sie im dedizierten Bereich „ℹ️ Über LineageGraph“ manuell mit direktem Feedback ausgelöst werden. Steht ein Update bereit, poppt `UpdateConfirmModal.vue` auf, das Versionsnummer, Release-Datum und Changelog anzeigt. Erst bei Klick auf „Jetzt aktualisieren“ lädt `downloadAndInstall` das Paket mit prozentualer Fortschrittsanzeige herunter und stößt den Windows NSIS-Installer an.
  Für den Absprung zur Dokumentation (`USER_GUIDE.md`) öffnet der IPC-Befehl `open_user_guide` die lokale Markdown-Datei über den Standard-Editor/Betrachter des Betriebssystems oder fällt bei Nichtvorhandensein transparent auf die Web-Dokumentation im GitHub-Repository zurück. Zudem steht in der oberen Menüleiste eine direkte Schaltfläche `📖 Handbuch` zur Verfügung.

#### SPEC-TRM-005 -> REQ-TRM-005
- **Fachliche Anforderung:** Konfigurierbarer Speicherort & Peer-Synchronisation ([REQ-TRM-005](file:///c:/dev/Froning/app/LineageGraph/docs/REQ.md#req-trm-005-konfigurierbarer-speicherort--peer-synchronisation))
- **Architektonische Schicht & Komponenten-Mapping:**
  - Rust Backend: [`src-tauri/src/lib.rs`](file:///c:/dev/Froning/app/LineageGraph/src-tauri/src/lib.rs) (`get_storage_info`, `inspect_storage_directory`, `change_storage_directory`, `poll_storage_sync_state`, `close_peer_session`, `open_storage_directory`, `StorageInfoDto`, `TargetDirInspectionDto`, `StorageSyncStateDto`)
  - UI-Komponenten: [`src/components/modals/SettingsModal.vue`](file:///c:/dev/Froning/app/LineageGraph/src/components/modals/SettingsModal.vue), [`src/App.vue`](file:///c:/dev/Froning/app/LineageGraph/src/App.vue)
- **Technische Umsetzung:**
  `inspect_storage_directory` prüft Zielpfad-Existenz, Schreibrechte, Netzwerkpfad-Heuristik und bereits vorhandene `.db`-Dateien. `change_storage_directory` flusht das aktuelle WAL, schließt die SQLite-Verbindung, kopiert bzw. wechselt in den Zielordner und persistiert die Pfadkonfiguration; bei Nichterreichbarkeit greift ein Fallback auf das lokale `default_data_dir` mit Warnhinweis (`is_fallback_active`, `storage_warning`). Im laufenden Betrieb pollt `App.vue` über `poll_storage_sync_state`, erkennt Änderungen über `genealogy_fingerprint` sowie `design_doc_timestamps` (inkl. automatischem Reload in `DesignTree.vue`) und tauscht aktive Peer-Sitzungen (`PeerSessionDto`) mit konfigurierbarem `peerDisplayName` aus. Beim Beenden meldet `close_peer_session` die Sitzung ab.

#### SPEC-TRM-006 -> REQ-TRM-006
- **Fachliche Anforderung:** Lokale Baum-Backups & Komplettsicherung ([REQ-TRM-006](file:///c:/dev/Froning/app/LineageGraph/docs/REQ.md#req-trm-006-lokale-baum-backups--komplettsicherung))
- **Architektonische Schicht & Komponenten-Mapping:**
  - Rust Backend: [`src-tauri/src/lib.rs`](file:///c:/dev/Froning/app/LineageGraph/src-tauri/src/lib.rs) (`list_tree_backups`, `create_tree_backup`, `restore_tree_backup`, `delete_tree_backup`, `backup_all_databases`, `TreeBackupInfoDto`)
  - UI-Komponente: [`src/components/modals/SettingsModal.vue`](file:///c:/dev/Froning/app/LineageGraph/src/components/modals/SettingsModal.vue)
- **Technische Umsetzung:**
  `create_tree_backup` sichert die aktive `.db`-Datei nach `wal_checkpoint(TRUNCATE)` als zeitgestempelten Snapshot im Backup-Unterverzeichnis. `list_tree_backups` listet vorhandene Sicherungen mit Metadaten (`TreeBackupInfoDto`), `delete_tree_backup` entfernt einzelne Snapshots und `restore_tree_backup` trennt sicher die aktive SQLite-Verbindung, stellt die gewählte Backup-Datei wieder her und lädt die Datenbank neu. `backup_all_databases` exportiert alle `.db`-Dateien des aktuellen Datenverzeichnisses gebündelt in einen benutzerdefinierten Zielordner.

---

### 2.2 Domäne: Personen- & Beziehungsstammdaten (DAT)

#### SPEC-DAT-001 -> REQ-DAT-001
- **Fachliche Anforderung:** Personen-Erfassung & Inkrementelle XREF-Generierung ([REQ-DAT-001](file:///c:/dev/Froning/app/LineageGraph/docs/REQ.md#req-dat-001-personen-erfassung--inkrementelle-xref-generierung))
- **Architektonische Schicht & Komponenten-Mapping:**
  - Rust Backend: [`src-tauri/src/db.rs`](file:///c:/dev/Froning/app/LineageGraph/src-tauri/src/db.rs#L168-L208) (`get_next_individual_id`), [`src-tauri/src/lib.rs`](file:///c:/dev/Froning/app/LineageGraph/src-tauri/src/lib.rs#L890-L980) (`add_person`, `get_next_person_id`)
  - UI-Modal: [`src/components/modals/AddPersonModal.vue`](file:///c:/dev/Froning/app/LineageGraph/src/components/modals/AddPersonModal.vue)
  - Vue Composable: [`src/composables/usePersons.ts`](file:///c:/dev/Froning/app/LineageGraph/src/composables/usePersons.ts) (`handleAddPerson`, `calculateNextIdFromPersons`)
- **Technische Umsetzung:**
  `get_next_individual_id` parst alle IDs aus der Tabelle `individuals`, extrahiert Präfixe und Zahlenwerte (`@I12@` -> `I`, `12`) und bestimmt das Maximum. Bei Neuanlage (`add_person`) wird der Datensatz in `individuals` eingefügt. Wurde ein Verwandtschaftstyp angegeben (`child`, `parent`, `spouse`), wird atomar die zugehörige Verknüpfung in `families` und `parent_child` angelegt.

#### SPEC-DAT-002 -> REQ-DAT-002
- **Fachliche Anforderung:** Tabellarische Batch-Editierung & Validierungs-Engine ([REQ-DAT-002](file:///c:/dev/Froning/app/LineageGraph/docs/REQ.md#req-dat-002-tabellarische-batch-editierung--validierungs-engine))
- **Architektonische Schicht & Komponenten-Mapping:**
  - Rust Backend: [`src-tauri/src/lib.rs`](file:///c:/dev/Froning/app/LineageGraph/src-tauri/src/lib.rs#L985-L1070) (`update_persons_batch`, `update_persons_batch_internal`, `is_valid_gedcom_xref`)
  - Vue Component: [`src/components/table/PersonTableView.vue`](file:///c:/dev/Froning/app/LineageGraph/src/components/table/PersonTableView.vue)
  - Vue Composable: [`src/composables/usePersons.ts`](file:///c:/dev/Froning/app/LineageGraph/src/composables/usePersons.ts) (`saveChanges`, `editedPersons`)
- **Technische Umsetzung:**
  `PersonTableView` speichert Benutzereingaben in der Map `editedPersons`. Beim Klick auf "Speichern" wird das Array `updates: Vec<PersonUpdate>` per IPC an `update_persons_batch` übergeben. Das Backend validiert alle Ziel-IDs mit `is_valid_gedcom_xref`. Hat sich eine ID geändert (`original_id != person.id`), benennt `rename_person_references` sämtliche Vorkommen in `families (husband_id, wife_id)`, `parent_child (child_id)`, `events (owner_id)`, `root_ancestors` und `design_layouts` transaktional um.

#### SPEC-DAT-003 -> REQ-DAT-003
- **Fachliche Anforderung:** Eltern-Kind-Verknüpfung mit Zyklus- & Rekursionserkennung ([REQ-DAT-003](file:///c:/dev/Froning/app/LineageGraph/docs/REQ.md#req-dat-003-eltern-kind-verkn%C3%BCpfung-mit-zyklus---rekursionserkennung))
- **Architektonische Schicht & Komponenten-Mapping:**
  - Rust Backend: [`src-tauri/src/lib.rs`](file:///c:/dev/Froning/app/LineageGraph/src-tauri/src/lib.rs#L660-L750) (`check_parent_recursion`, `update_person_parents`)
  - UI-Komponente: [`src/components/details/PersonDetailsDrawer.vue`](file:///c:/dev/Froning/app/LineageGraph/src/components/details/PersonDetailsDrawer.vue)
  - Vue Composable: [`src/composables/usePersons.ts`](file:///c:/dev/Froning/app/LineageGraph/src/composables/usePersons.ts) (`savePersonParents`)
- **Technische Umsetzung:**
  `check_parent_recursion` führt eine iterative Breitensuche (BFS mit `VecDeque`) über die Vorfahren des beabsichtigten Elternteils durch. Wird dabei die ID der zu bearbeitenden Person erreicht, schlägt die Prüfung fehl (`Err("Rekursion erkannt")`). Bei Erfolg ermittelt `update_person_parents` die bestehende Eltern-Familie des Kindes in `parent_child`, aktualisiert `husband_id` und `wife_id` oder erzeugt eine neue Familie und triggert abschließend `calculate_henry_codes_internal`.

#### SPEC-DAT-004 -> REQ-DAT-004
- **Fachliche Anforderung:** Partnerschafts- und Ehedaten-Management ([REQ-DAT-004](file:///c:/dev/Froning/app/LineageGraph/docs/REQ.md#req-dat-004-partnerschafts--und-ehedaten-management))
- **Architektonische Schicht & Komponenten-Mapping:**
  - Rust Backend: [`src-tauri/src/lib.rs`](file:///c:/dev/Froning/app/LineageGraph/src-tauri/src/lib.rs#L755-L880) (`update_family_marriage`, `link_spouses`, `unlink_family`, `add_child_link`, `remove_child_link`)
  - UI-Komponente: [`src/components/details/PersonDetailsDrawer.vue`](file:///c:/dev/Froning/app/LineageGraph/src/components/details/PersonDetailsDrawer.vue)
- **Technische Umsetzung:**
  `update_family_marriage` modifiziert `marriage_date`, `divorce_date` und `is_divorced` in der Tabelle `families`. `link_spouses` erzeugt einen neuen Familiendatensatz mit eindeutiger ID (`F<Nr>`), ordnet Mann und Frau zu und trägt sie ein. `unlink_family` löscht die Familie und zugehörige `parent_child`-Einträge. `add_child_link` prüft Zyklen und trägt das Kind in `parent_child` ein.

#### SPEC-DAT-005 -> REQ-DAT-005
- **Fachliche Anforderung:** Audit- & Revisionsfelder (GEDCOM CHAN / UID) ([REQ-DAT-005](file:///c:/dev/Froning/app/LineageGraph/docs/REQ.md#req-dat-005-audit---revisionsfelder-gedcom-chan--uid))
- **Architektonische Schicht & Komponenten-Mapping:**
  - Rust Backend: [`src-tauri/src/lib.rs`](file:///c:/dev/Froning/app/LineageGraph/src-tauri/src/lib.rs#L20-L43) (`current_gedcom_chan`)
  - Schema Setup: [`src-tauri/src/db.rs`](file:///c:/dev/Froning/app/LineageGraph/src-tauri/src/db.rs)
- **Technische Umsetzung:**
  `current_gedcom_chan()` erzeugt ein standardkonformes JSON-Objekt mit den Feldern `DATE` (`DD MMM YYYY`) und `TIME` (`HH:MM:SS`) unter Verwendung von `chrono::Local::now()`. Dieses Objekt wird im `json_data`-Blob der `individuals`-Tabelle unter dem Schlüssel `CHAN` abgelegt. Fehlt beim Import oder bei Neuanlage ein `_UID`, wird mittels `uuid::Uuid::new_v4()` eine eindeutige 32-Zeichen-Hex-ID erzeugt.

#### SPEC-DAT-006 -> REQ-DAT-006
- **Fachliche Anforderung:** Einzel- & Zweig-Löschung mit Backup-Sicherung ([REQ-DAT-006](file:///c:/dev/Froning/app/LineageGraph/docs/REQ.md#req-dat-006-einzel---zweig-l%C3%B6schung-mit-backup-sicherung))
- **Architektonische Schicht & Komponenten-Mapping:**
  - Rust Backend: [`src-tauri/src/lib.rs`](file:///c:/dev/Froning/app/LineageGraph/src-tauri/src/lib.rs) (`backup_current_tree_db`, `delete_person`, `delete_persons_batch`, `delete_persons_batch_internal`)
  - UI-Modal: [`src/components/modals/DeletePersonModal.vue`](file:///c:/dev/Froning/app/LineageGraph/src/components/modals/DeletePersonModal.vue)
  - Vue Composables: [`src/composables/usePersons.ts`](file:///c:/dev/Froning/app/LineageGraph/src/composables/usePersons.ts) (`deletePerson`, `deletePersonsBatch`)
  - UI-Trigger: [`src/components/research/ResearchAssistantView.vue`](file:///c:/dev/Froning/app/LineageGraph/src/components/research/ResearchAssistantView.vue), [`src/components/details/PersonDetailsDrawer.vue`](file:///c:/dev/Froning/app/LineageGraph/src/components/details/PersonDetailsDrawer.vue)
- **Technische Umsetzung:**
  1. `backup_current_tree_db` kopiert die aktive SQLite-Datenbank transaktionssicher vor dem Löschvorgang in `<tree_name>_<action>_<timestamp>.db.bak`.
  2. `delete_persons_batch_internal` führt kaskadierende Löschungen aus: Löschen aus `research_tasks`, `events`, `parent_child`, Nullsetzen/Löschen von Partnerreferenzen in `families`, Entfernen verwaister Familien ohne Partner und Kinder, Löschen aus `root_ancestors` und `proband_henry_codes` sowie Entfernen aus `individuals`.
  3. Nach erfolgreichem Löschen wird `calculate_henry_codes_internal` ausgeführt.
  4. Im Frontend sichert `DeletePersonModal` den Vorgang über einen 2-stufigen Bestätigungsdialog mit Autofokus auf `Abbrechen`.

#### SPEC-DAT-007 -> REQ-DAT-007
- **Fachliche Anforderung:** Selektiver Personen-Merge mit Konfliktlösung ([REQ-DAT-007](file:///c:/dev/Froning/app/LineageGraph/docs/REQ.md#req-dat-007-selektiver-personen-merge-mit-konfliktl%C3%B6sung))
- **Architektonische Schicht & Komponenten-Mapping:**
  - Rust Backend: [`src-tauri/src/lib.rs`](file:///c:/dev/Froning/app/LineageGraph/src-tauri/src/lib.rs) (`merge_persons`, `merge_persons_internal`, `get_person_events_internal`, `backup_current_tree_db`)
  - UI-Modals: [`src/components/modals/PersonMergeModal.vue`](file:///c:/dev/Froning/app/LineageGraph/src/components/modals/PersonMergeModal.vue), `merge-picker-modal` in [`src/App.vue`](file:///c:/dev/Froning/app/LineageGraph/src/App.vue)
  - Vue Composables: [`src/composables/usePersons.ts`](file:///c:/dev/Froning/app/LineageGraph/src/composables/usePersons.ts) (`mergePersons`, `getPersonEvents`)
  - Quick-Inspector: [`src/components/research/ResearchAssistantView.vue`](file:///c:/dev/Froning/app/LineageGraph/src/components/research/ResearchAssistantView.vue)
- **Technische Umsetzung:**
  1. Automatischer `.bak`-Snapshot via `backup_current_tree_db(..., "merge")`.
  2. `merge_persons_internal` übernimmt selektierte Attribute (`given_name`, `surname`, `sex`, `birth_date`, `birth_place`, `death_date`, `death_place`) in den Ziel-Eintrag.
  3. Re-Pointing von Beziehungen: Elternverhältnisse (`parent_family_source`), Kinder (`parent_child.child_id`), Partner (`families.husband_id` / `wife_id` mit Doppelheiratsauflösung oder -erhalt) und Research Tasks (`research_tasks.person_id`).
  4. Ereignisse (`events`): Quell-Events aus `selected_event_ids` werden auf `target_id` umgeschrieben; nicht selektierte Quell-Events werden entfernt.
  5. Audit-Notiz: `audit_note` wird in `json_data.NOTE` dokumentiert; Quell-Person wird kaskadierend aus `individuals` gelöscht.
  6. Automatische Neuberechnung der Henry-Codes für alle Probanden.

#### SPEC-DAT-008 -> REQ-DAT-008
- **Fachliche Anforderung:** Mehrsprachige Datums-Normalisierung & Konfigurierbare Formatierung ([REQ-DAT-008](file:///c:/dev/Froning/app/LineageGraph/docs/REQ.md#req-dat-008-mehrsprachige-datums-normalisierung--konfigurierbare-formatierung))
- **Architektonische Schicht & Komponenten-Mapping:**
  - Rust Backend: [`src-tauri/src/gedcom_date.rs`](file:///c:/dev/Froning/app/LineageGraph/src-tauri/src/gedcom_date.rs) (`SimpleDate`, `GedcomDateExpr`, `parse_month_token`), [`src-tauri/src/parser.rs`](file:///c:/dev/Froning/app/LineageGraph/src-tauri/src/parser.rs), [`src-tauri/src/gedcom_export.rs`](file:///c:/dev/Froning/app/LineageGraph/src-tauri/src/gedcom_export.rs), [`src-tauri/src/gedcom_import_merge.rs`](file:///c:/dev/Froning/app/LineageGraph/src-tauri/src/gedcom_import_merge.rs), [`src-tauri/src/lib.rs`](file:///c:/dev/Froning/app/LineageGraph/src-tauri/src/lib.rs)
  - Frontend Composable & Komponente: [`src/composables/useDateFormat.ts`](file:///c:/dev/Froning/app/LineageGraph/src/composables/useDateFormat.ts) (`useDateFormat`, `formatDisplayDate`, `normalizeDateInputToGedcom`, `resolveEffectiveFormat`), [`src/components/common/DateInput.vue`](file:///c:/dev/Froning/app/LineageGraph/src/components/common/DateInput.vue)
  - Integration in UI: [`src/components/modals/AddPersonModal.vue`](file:///c:/dev/Froning/app/LineageGraph/src/components/modals/AddPersonModal.vue), [`src/components/details/PersonDetailsDrawer.vue`](file:///c:/dev/Froning/app/LineageGraph/src/components/details/PersonDetailsDrawer.vue), [`src/components/table/PersonTableView.vue`](file:///c:/dev/Froning/app/LineageGraph/src/components/table/PersonTableView.vue), [`src/components/modals/SettingsModal.vue`](file:///c:/dev/Froning/app/LineageGraph/src/components/modals/SettingsModal.vue)
- **Technische Umsetzung:**
  `gedcom_date.rs` parst mehrsprachige Monatsnamen (DE/EN/FR/PT), numerische Datumsformate sowie GEDCOM-Ausdrücke (`ABT`, `CAL`, `EST`, `BEF`, `AFT`, `BET ... AND ...`, `FROM ... TO ...`, `INT`, Phrasen) in ein strukturiertes `GedcomDateExpr` und normalisiert sie über `to_gedcom()` kanonisch in GEDCOM 5.5.1. Im Frontend stellt `DateInput.vue` eine kontrollierte Eingabekomponente bereit, die beim Fokus/Verlassen über `normalizeDateInputToGedcom` normalisiert und über `formatDisplayDate` gemäß der in `SettingsModal.vue` gewählten `DateFormatOption` (`locale`, `dd.mm.yyyy`, `yyyy-mm-dd`, `dd/mm/yyyy`, `mm/dd/yyyy`, `dd_mmm_yyyy`, `gedcom`, gespeichert in `localStorage` unter `lineagegraph_date_format`) anzeigt.

---

### 2.3 Domäne: Genealogische Berechnungen & Algorithmen (ALG)

#### SPEC-ALG-001 -> REQ-ALG-001
- **Fachliche Anforderung:** Multi-Probanden-Verwaltung (Multi-Root) ([REQ-ALG-001](file:///c:/dev/Froning/app/LineageGraph/docs/REQ.md#req-alg-001-multi-probanden-verwaltung-multi-root))
- **Architektonische Schicht & Komponenten-Mapping:**
  - Rust Backend: [`src-tauri/src/lib.rs`](file:///c:/dev/Froning/app/LineageGraph/src-tauri/src/lib.rs#L440-L490) (`get_root_ancestors`, `add_root_ancestor`, `remove_root_ancestor`)
  - Vue Composable: [`src/composables/usePersons.ts`](file:///c:/dev/Froning/app/LineageGraph/src/composables/usePersons.ts) (`rootAncestors`, `activeProbandTab`)
  - UI-Navigation: [`src/App.vue`](file:///c:/dev/Froning/app/LineageGraph/src/App.vue) (Probanden-Tabs)
- **Technische Umsetzung:**
  Die Tabelle `root_ancestors` speichert Tupel aus `person_id` und `starting_code`. `get_root_ancestors` führt einen `INNER JOIN` mit `individuals` aus, um Vor- und Nachnamen der Probanden für das Frontend anzureichern. Die Tabelle `proband_henry_codes` hält für jede Person den bezogenen Code und die Generationsnummer getrennt nach Proband (`proband_id`, `person_id`).

#### SPEC-ALG-002 -> REQ-ALG-002
- **Fachliche Anforderung:** Chronologische & Patrilineare/Matrilineare Henry-Code-Berechnung ([REQ-ALG-002](file:///c:/dev/Froning/app/LineageGraph/docs/REQ.md#req-alg-002-chronologische--patrilinearematrilineare-henry-code-berechnung))
- **Architektonische Schicht & Komponenten-Mapping:**
  - Rust Backend: [`src-tauri/src/db.rs`](file:///c:/dev/Froning/app/LineageGraph/src-tauri/src/db.rs#L143-L167) (`generate_next_henry_code`), [`src-tauri/src/lib.rs`](file:///c:/dev/Froning/app/LineageGraph/src-tauri/src/lib.rs#L495-L650) (`calculate_henry_codes_internal`, `parse_birth_sort_key`)
- **Technische Umsetzung:**
  `calculate_henry_codes_internal` löscht zunächst alle Einträge in `proband_henry_codes`. Für jeden konfigurierten Probanden wird eine BFS-Warteschlange initialisiert. Kinder werden primär über Familien gesucht, in denen die Person Vater (`husband_id`) ist; falls keine vorhanden oder die Person eine Stammahnin ist, über Familien als Mutter (`wife_id`). Die Geschwister jeder Familie werden mit `parse_birth_sort_key` chronologisch geordnet (Datumsstrings werden robust nach Jahr, Monat und Tag geparst; Personen ohne Datum werden nach ID gereiht). `generate_next_henry_code` berechnet die hierarchische Zeichenkette ohne Punktnotation.

#### SPEC-ALG-003 -> REQ-ALG-003
- **Fachliche Anforderung:** Kürzester Verwandtschaftspfad (A*- & BFS-Graphsuche) ([REQ-ALG-003](file:///c:/dev/Froning/app/LineageGraph/docs/REQ.md#req-alg-003-k%C3%BCrzester-verwandtschaftspfad-a---bfs-graphsuche))
- **Architektonische Schicht & Komponenten-Mapping:**
  - Rust Backend: [`src-tauri/src/lib.rs`](file:///c:/dev/Froning/app/LineageGraph/src-tauri/src/lib.rs#L1100-L1180) (`find_relationship_path`)
  - Frontend Composable: [`src/composables/useShortestPath.ts`](file:///c:/dev/Froning/app/LineageGraph/src/composables/useShortestPath.ts) (`findShortestPathWithSpouses`, `buildAncestorPathsMap`)
  - UI-Modal: [`src/components/modals/ShortestPathModal.vue`](file:///c:/dev/Froning/app/LineageGraph/src/components/modals/ShortestPathModal.vue)
- **Technische Umsetzung:**
  Im Backend wird über `petgraph::graph::DiGraph` ein Adjazenzgraph aller Personen und Beziehungen aufgebaut. Der A*-Algorithmus (`petgraph::algo::astar`) berechnet den kürzesten gerichteten Pfad. Im Frontend bietet `useShortestPath.ts` eine clientseitige Breitensuche (`findShortestPathWithSpouses`), die Pfade inklusive Schwägerschaften berechnet und die beteiligten Personen-IDs im Canvas-Stammbaum über `highlightedPathIds` optisch hervorhebt.

---

### 2.4 Domäne: Benutzeroberfläche & Views (UI)

#### SPEC-UI-001 -> REQ-UI-001
- **Fachliche Anforderung:** Interaktive Datentabelle mit Sortierung & Multi-Filtern ([REQ-UI-001](file:///c:/dev/Froning/app/LineageGraph/docs/REQ.md#req-ui-001-interaktive-datentabelle-mit-sortierung--multi-filtern))
- **Architektonische Schicht & Komponenten-Mapping:**
  - Vue Komponente: [`src/components/table/PersonTableView.vue`](file:///c:/dev/Froning/app/LineageGraph/src/components/table/PersonTableView.vue)
  - Vue Composable: [`src/composables/usePersons.ts`](file:///c:/dev/Froning/app/LineageGraph/src/composables/usePersons.ts) (`filteredPersons`, `sortKey`, `sortAsc`, `columnFilters`)
- **Technische Umsetzung:**
  `PersonTableView` implementiert eine reaktive Filterkette über ein `computed`-Property. Für jede Spalte existiert ein Eingabefeld in `columnFilters`. Die Sortierlogik berücksichtigt numerische Werte (Generation), Datumsangaben sowie lexikografische Strings mit Umlautunterstützung via `localeCompare`.

#### SPEC-UI-002 -> REQ-UI-002
- **Fachliche Anforderung:** Infinite Canvas Stammbaum-Visualisierung ([REQ-UI-002](file:///c:/dev/Froning/app/LineageGraph/docs/REQ.md#req-ui-002-infinite-canvas-stammbaum-visualisierung))
- **Architektonische Schicht & Komponenten-Mapping:**
  - Vue Komponenten: [`src/components/tree/TreeCanvasView.vue`](file:///c:/dev/Froning/app/LineageGraph/src/components/tree/TreeCanvasView.vue), [`src/components/TreeNode.vue`](file:///c:/dev/Froning/app/LineageGraph/src/components/TreeNode.vue)
- **Technische Umsetzung:**
  `TreeCanvasView` kapselt einen Pan/Zoom-Viewport mit CSS-Transform (`translate(x, y) scale(zoom)`). `TreeNode.vue` rendert rekursiv Nachkommen und Seitenäste. Partner-Cluster werden horizontal über rote Verbindungslinien verknüpft, Eltern-Knoten vertikal über gestrichelte Linien. Klickbare Badges erlauben das zentrierte Anspringen entfernter Zweige.

#### SPEC-UI-003 -> REQ-UI-003
- **Fachliche Anforderung:** Slide-Over Detail-Drawer & Verwandtschafts-Inspector ([REQ-UI-003](file:///c:/dev/Froning/app/LineageGraph/docs/REQ.md#req-ui-003-slide-over-detail-drawer--verwandtschafts-inspector))
- **Architektonische Schicht & Komponenten-Mapping:**
  - Vue Komponente: [`src/components/details/PersonDetailsDrawer.vue`](file:///c:/dev/Froning/app/LineageGraph/src/components/details/PersonDetailsDrawer.vue)
  - Rust Backend: [`src-tauri/src/lib.rs`](file:///c:/dev/Froning/app/LineageGraph/src-tauri/src/lib.rs#L380-L435) (`get_person_details`)
- **Technische Umsetzung:**
  `get_person_details` liest für eine Person alle Eltern, Geschwister, Partner, Kinder, Notizen und das ungeparste `json_data` aus. Der Drawer (`PersonDetailsDrawer.vue`) wird exklusiv in `table`- und `tree`-Ansichten gemountet und nimmt im eingeklappten Zustand `0px` Breite ein. Im Lesemodus erlauben klickbare Karten für Eltern, Partner und Kinder den direkten Wechsel der selektierten Person (`@jump-to`). Im Editiermodus stehen durchsuchbare Auswahl-Picker (`.searchable-picker`) für Eltern, Partner und Kinder sowie ein einziger zentraler Speichern-Button (`saveChanges`) bereit, der Lebensdaten, Elternzuweisungen und Ehen atomar speichert.

#### SPEC-UI-004 -> REQ-UI-004
- **Fachliche Anforderung:** Freie Schnellabfrage (Free Query Modal) ([REQ-UI-004](file:///c:/dev/Froning/app/LineageGraph/docs/REQ.md#req-ui-004-freie-schnellabfrage-free-query-modal))
- **Architektonische Schicht & Komponenten-Mapping:**
  - UI-Modal: [`src/components/modals/FreeQueryModal.vue`](file:///c:/dev/Froning/app/LineageGraph/src/components/modals/FreeQueryModal.vue)
- **Technische Umsetzung:**
  Modales Dialogfenster mit isoliertem Event-Bubbling (`@mousedown.stop`, `@wheel.stop`). Ein kombiniertes Filterprädikat durchsucht Nachname, Vorname, Geburtsdaten und ID und liefert bis zu 30 Treffer zur direkten Selektion zurück.

#### SPEC-UI-005 -> REQ-UI-005
- **Fachliche Anforderung:** Vollständige Internationalisierung (DE / EN / FR / PT) ([REQ-UI-005](file:///c:/dev/Froning/app/LineageGraph/docs/REQ.md#req-ui-005-vollst%C3%A4ndige-internationalisierung-de--en--fr--pt))
- **Architektonische Schicht & Komponenten-Mapping:**
  - Frontend-Konfiguration & Registry: [`src/i18n.ts`](file:///c:/dev/Froning/app/LineageGraph/src/i18n.ts) (`setAppLocale`, `tLocale`), [`src/locales/registry.ts`](file:///c:/dev/Froning/app/LineageGraph/src/locales/registry.ts) (`SUPPORTED_LOCALES`, `resolveLocale`, `getLocaleDefinition`)
  - Sprachdateien: [`src/locales/de.json`](file:///c:/dev/Froning/app/LineageGraph/src/locales/de.json), [`src/locales/en.json`](file:///c:/dev/Froning/app/LineageGraph/src/locales/en.json), [`src/locales/fr.json`](file:///c:/dev/Froning/app/LineageGraph/src/locales/fr.json), [`src/locales/pt.json`](file:///c:/dev/Froning/app/LineageGraph/src/locales/pt.json)
  - UI-Komponenten & Build-Check: [`src/components/common/LanguageSelector.vue`](file:///c:/dev/Froning/app/LineageGraph/src/components/common/LanguageSelector.vue), [`src/components/common/ExportLanguageSelect.vue`](file:///c:/dev/Froning/app/LineageGraph/src/components/common/ExportLanguageSelect.vue), [`scripts/check-locales.mjs`](file:///c:/dev/Froning/app/LineageGraph/scripts/check-locales.mjs)
- **Technische Umsetzung:**
  Verwendung von `vue-i18n` v11 (Composition API `useI18n()`). `SUPPORTED_LOCALES` in `registry.ts` definiert `de`, `en`, `fr` und `pt` samt Endonym, BCP-47-Tag und `latexBabel`-Paket. `setAppLocale` persistiert die Sprachwahl in `localStorage` (`lineagegraph.locale`) und aktualisiert `<html lang="...">`. `tLocale` ermöglicht gezielte Übersetzungen für Exporte ohne Änderung der globalen UI-Sprache. Das Build-Skript `npm run check:locales` (`scripts/check-locales.mjs`) verifiziert vor jedem Produktions-Build die vollständige Schlüssel-Parität aller Sprachdateien.

#### SPEC-UI-006 -> REQ-UI-006
- **Fachliche Anforderung:** Genealogische Statistik- & Analyse-Ansicht ([REQ-UI-006](file:///c:/dev/Froning/app/LineageGraph/docs/REQ.md#req-ui-006-genealogische-statistik---analyse-ansicht))
- **Architektonische Schicht & Komponenten-Mapping:**
  - Composable & Datums-Parser: [`src/composables/useStatistics.ts`](file:///c:/dev/Froning/app/LineageGraph/src/composables/useStatistics.ts), [`src/utils/gedcomDate.ts`](file:///c:/dev/Froning/app/LineageGraph/src/utils/gedcomDate.ts)
  - Hauptansicht & Tabs: [`src/components/stats/StatisticsView.vue`](file:///c:/dev/Froning/app/LineageGraph/src/components/stats/StatisticsView.vue), [`src/components/stats/tabs/DemographicsTab.vue`](file:///c:/dev/Froning/app/LineageGraph/src/components/stats/tabs/DemographicsTab.vue), [`src/components/stats/tabs/FamiliesTab.vue`](file:///c:/dev/Froning/app/LineageGraph/src/components/stats/tabs/FamiliesTab.vue), [`src/components/stats/tabs/NamesPlacesTab.vue`](file:///c:/dev/Froning/app/LineageGraph/src/components/stats/tabs/NamesPlacesTab.vue), [`src/components/stats/tabs/QualityStructureTab.vue`](file:///c:/dev/Froning/app/LineageGraph/src/components/stats/tabs/QualityStructureTab.vue)
  - D3-Diagramme: [`src/components/stats/charts/D3BarChart.vue`](file:///c:/dev/Froning/app/LineageGraph/src/components/stats/charts/D3BarChart.vue), [`src/components/stats/charts/D3GroupedBarChart.vue`](file:///c:/dev/Froning/app/LineageGraph/src/components/stats/charts/D3GroupedBarChart.vue), [`src/components/stats/charts/D3LineChart.vue`](file:///c:/dev/Froning/app/LineageGraph/src/components/stats/charts/D3LineChart.vue)
- **Technische Umsetzung:**
  `useStatistics.ts` berechnet reaktiv aus `persons` und `rootAncestors` unter Berücksichtigung von `StatisticsFilterState` (`probandId`, `sex`, `yearFrom`, `yearTo`, `onlyExactDates`, `familyGrouping`) Kennzahlen und Buckets (`StatBucket`, `GroupedSeriesBucket`, `LineSeries`, `ImplexGenerationRow`). `gedcomDate.ts` extrahiert Jahreszahlen, Lebensalter (`computeAgeYears`), Zeitintervalle (`computeIntervalYears`) und Jahrhunderte (`getCentury`). Klicks auf Balken, Linienpunkte oder Tabellenzeilen öffnen in `StatisticsView.vue` ein Drilldown-Panel mit den zugehörigen Personen und direkten Sprungaktionen (`select-person`, `open-in-table`).

---

### 2.5 Domäne: Stammbaum Design Studio (DSG)

#### SPEC-DSG-001 -> REQ-DSG-001
- **Fachliche Anforderung:** Automatisches hierarchisches Pedigree-Layout & Wuchsrichtung ([REQ-DSG-001](file:///c:/dev/Froning/app/LineageGraph/docs/REQ.md#req-dsg-001-automatisches-hierarchisches-pedigree-layout--wuchsrichtung))
- **Architektonische Schicht & Komponenten-Mapping:**
  - Domain Layout Engine: [`src/domain/design/contourLayoutEngine.ts`](file:///c:/dev/Froning/app/LineageGraph/src/domain/design/contourLayoutEngine.ts), [`src/domain/design/lineageResolver.ts`](file:///c:/dev/Froning/app/LineageGraph/src/domain/design/lineageResolver.ts) (`resolveGenealogyTree`), [`src/domain/design/sceneGraphBuilder.ts`](file:///c:/dev/Froning/app/LineageGraph/src/domain/design/sceneGraphBuilder.ts) (`buildDesignSceneGraph`), [`src/domain/design/groupWrapper.ts`](file:///c:/dev/Froning/app/LineageGraph/src/domain/design/groupWrapper.ts)
  - State Store & UI: [`src/composables/useDesignStudioStore.ts`](file:///c:/dev/Froning/app/LineageGraph/src/composables/useDesignStudioStore.ts), [`src/components/DesignTree.vue`](file:///c:/dev/Froning/app/LineageGraph/src/components/DesignTree.vue), [`src/components/design/DesignCanvas.vue`](file:///c:/dev/Froning/app/LineageGraph/src/components/design/DesignCanvas.vue)
- **Technische Umsetzung:**
  `lineageResolver.ts` löst ausgehend von `rootPersonId` gemäß `LineagePolicy` (`patrilinear`, `matrilinear`, `oldest_branch`) den Baum auf. `contourLayoutEngine.ts` berechnet mittels Kontur-Algorithmus kollisionsfreie horizontale Positionen für Partner- und Geschwistergruppen (`BRANCH_GAP_X`, `DOCKED_GROUP_GAP_X`), partitioniert Generationen gemäß `GrowthDirection` (`bottom_up` oder `top_down`) und berücksichtigt `GroupDesignRule` (`maxColumnsPerRow`, `relativeDeltaX`, `dockTargetGroupKey`, `levelOverride`). `sceneGraphBuilder.ts` erzeugt daraus den vollständigen `DesignSceneGraph`.

#### SPEC-DSG-002 -> REQ-DSG-002
- **Fachliche Anforderung:** Orthogonale & organische Linienführung, Track Assignment & Linienbrücken ([REQ-DSG-002](file:///c:/dev/Froning/app/LineageGraph/docs/REQ.md#req-dsg-002-orthogonale--organische-linienf%C3%BChrung-track-assignment--linienbr%C3%BCcken))
- **Architektonische Schicht & Komponenten-Mapping:**
  - Domain Edge Router: [`src/domain/design/edgeRouter.ts`](file:///c:/dev/Froning/app/LineageGraph/src/domain/design/edgeRouter.ts)
  - Export Utility: [`src/utils/designSceneExport.ts`](file:///c:/dev/Froning/app/LineageGraph/src/utils/designSceneExport.ts)
  - Vue Komponente: [`src/components/design/DesignConnectorLayer.vue`](file:///c:/dev/Froning/app/LineageGraph/src/components/design/DesignConnectorLayer.vue)
- **Technische Umsetzung:**
  1. **Elternauflösung & Kindergruppierungen:** `lineageResolver.ts` und `edgeRouter.ts` ermitteln für jede sichtbare Personenkachel den maßgeblichen Elterneintrag gemäß `lineagePolicy` bzw. expliziter `implexActiveParentId`-Regel (`PersonDesignRule`). Kinder desselben Elternteils auf einer Ebene werden in zusammenhängende Gruppierungen zusammengefasst.
  2. **Routing-Modi & Track Assignment (`edgeRouter.ts`):** Unterstützt `orthogonal_bus` (rechtwinklige Bus-Führung mit Greedy Track Assignment zur Vermeidung horizontaler Intervall-Überlappungen und vertikaler Kreuzungen) sowie `organic_bezier` (geschwungene Bezier-Pfade). Manuelle Wegpunkt-Verschiebungen werden über `EdgeWaypointRule` (`laneOffsetDelta`, `verticalChannelDeltaX`) eingerechnet.
  3. **Linienbrücken (`enableLineBridges`):** An verbleibenden Schnittpunkten zwischen horizontalen und vertikalen Segmenten wird ein SVG-Bogenbefehl (`A radius radius ...`) eingefügt.

#### SPEC-DSG-003 -> REQ-DSG-003
- **Fachliche Anforderung:** Voll konfigurierbare Personenkarten & Dichteprofile ([REQ-DSG-003](file:///c:/dev/Froning/app/LineageGraph/docs/REQ.md#req-dsg-003-voll-konfigurierbare-personenkarten--dichteprofile))
- **Architektonische Schicht & Komponenten-Mapping:**
  - Domain & Typen: [`src/domain/design/cardMetrics.ts`](file:///c:/dev/Froning/app/LineageGraph/src/domain/design/cardMetrics.ts), [`src/domain/design/sceneTypes.ts`](file:///c:/dev/Froning/app/LineageGraph/src/domain/design/sceneTypes.ts) (`CardDensityProfile`), [`src/types/design.ts`](file:///c:/dev/Froning/app/LineageGraph/src/types/design.ts)
  - Vue Komponenten: [`src/components/design/DesignPersonCard.vue`](file:///c:/dev/Froning/app/LineageGraph/src/components/design/DesignPersonCard.vue), [`src/components/design/DesignSidebar.vue`](file:///c:/dev/Froning/app/LineageGraph/src/components/design/DesignSidebar.vue), [`src/components/design/DesignCanvas.vue`](file:///c:/dev/Froning/app/LineageGraph/src/components/design/DesignCanvas.vue)
- **Technische Umsetzung:**
  `cardMetrics.ts` berechnet dynamische Kartenabmessungen und Zeileninhalte anhand von `CardDensityProfile` (`detail`, `standard`, `compact_years`, `narrow`) und `DesignCardConfig`. `DesignPersonCard.vue` rendert die Kachel ohne überlagernde Mini-Buttons in der Kopfzeile. Über `DesignSidebar.vue` werden Kachel-Zeilen, Farben, Dichteprofile und Linien-/Brückenparameter mit Live-Vorschau konfiguriert. Kontextabhängige Einzel- und Gruppenaktionen sind im schwebenden HUD in `DesignCanvas.vue` gebündelt.

#### SPEC-DSG-004 -> REQ-DSG-004
- **Fachliche Anforderung:** Hintergrundgestaltung & Medien-Asset-Persistierung ([REQ-DSG-004](file:///c:/dev/Froning/app/LineageGraph/docs/REQ.md#req-dsg-004-hintergrundgestaltung--medien-asset-persistierung))
- **Architektonische Schicht & Komponenten-Mapping:**
  - Rust Backend: [`src-tauri/src/design_repo.rs`](file:///c:/dev/Froning/app/LineageGraph/src-tauri/src/design_repo.rs), [`src-tauri/src/lib.rs`](file:///c:/dev/Froning/app/LineageGraph/src-tauri/src/lib.rs) (`upload_design_media_asset`, `get_design_media_asset`)
  - SQLite Schema: [`src-tauri/src/db.rs`](file:///c:/dev/Froning/app/LineageGraph/src-tauri/src/db.rs) (`media_assets`)
  - Frontend Store & UI: [`src/composables/useDesignStudioStore.ts`](file:///c:/dev/Froning/app/LineageGraph/src/composables/useDesignStudioStore.ts), [`src/components/design/DesignSidebar.vue`](file:///c:/dev/Froning/app/LineageGraph/src/components/design/DesignSidebar.vue)
- **Technische Umsetzung:**
  Hintergrundbilder (PNG, JPG, SVG) werden über `upload_design_media_asset` in der SQLite-Tabelle `media_assets` (inklusive `sha256` zur Deduplizierung, MIME-Typ, Abmessungen und Binärdaten) gespeichert und über `bg_asset_id` am `DesignDocumentModel` referenziert. `get_design_media_asset` liefert die Bilddaten als Data-URL zurück. In der Sidebar lassen sich Opacity (0–100 %), Positionierung und Skalierung über `DesignBackgroundConfig` justieren.

#### SPEC-DSG-005 -> REQ-DSG-005
- **Fachliche Anforderung:** Dokumenten-Persistenz (v2), Dateiverwaltung & Undo/Redo-Verlauf ([REQ-DSG-005](file:///c:/dev/Froning/app/LineageGraph/docs/REQ.md#req-dsg-005-dokumenten-persistenz-v2-dateiverwaltung--undoredo-verlauf))
- **Architektonische Schicht & Komponenten-Mapping:**
  - Frontend Store & Views: [`src/composables/useDesignStudioStore.ts`](file:///c:/dev/Froning/app/LineageGraph/src/composables/useDesignStudioStore.ts), [`src/components/design/DesignSidebar.vue`](file:///c:/dev/Froning/app/LineageGraph/src/components/design/DesignSidebar.vue), [`src/components/design/DesignCanvas.vue`](file:///c:/dev/Froning/app/LineageGraph/src/components/design/DesignCanvas.vue)
  - Rust Backend: [`src-tauri/src/design_repo.rs`](file:///c:/dev/Froning/app/LineageGraph/src-tauri/src/design_repo.rs), [`src-tauri/src/lib.rs`](file:///c:/dev/Froning/app/LineageGraph/src-tauri/src/lib.rs) (`list_design_documents`, `load_design_tree_bundle`, `save_design_document_v2`, `delete_design_document_v2`, `read_design_file`, `save_design_file`, sowie Legacy `save_design_layout`, `get_design_layouts`, `delete_design_layout`)
  - SQLite Schema: [`src-tauri/src/db.rs`](file:///c:/dev/Froning/app/LineageGraph/src-tauri/src/db.rs) (`design_documents`, `design_person_rules`, `design_group_rules`, `design_subtree_mounts`, `design_edge_waypoints`, `design_layouts`)
- **Technische Umsetzung:**
  `useDesignStudioStore.ts` verwaltet das aktive `DesignDocumentModel`, die Undo/Redo-Historie und das Laden/Speichern über `design_repo.rs`. Dokumente werden relational in `design_documents` samt verknüpften Regel-Tabellen (`design_person_rules`, `design_group_rules`, `design_subtree_mounts`, `design_edge_waypoints`) gespeichert. `list_design_documents` filtert strikt nach Stammahn (`root_person_id`), während `read_design_file` und `save_design_file` den JSON-Dateiaustausch über den nativen Dateidialog ermöglichen.

#### SPEC-DSG-006 -> REQ-DSG-006
- **Fachliche Anforderung:** Hierarchische Stamm- und Zweig-Layouts (Subtree Composition) ([REQ-DSG-006](file:///c:/dev/Froning/app/LineageGraph/docs/REQ.md#req-dsg-006-hierarchische-stamm--und-zweig-layouts-subtree-composition))
- **Architektonische Schicht & Komponenten-Mapping:**
  - Domain & Typen: [`src/domain/design/sceneTypes.ts`](file:///c:/dev/Froning/app/LineageGraph/src/domain/design/sceneTypes.ts) (`SubtreeMountRule`, `SubtreeDisplayMode`, `DesignTreeBundle`), [`src/domain/design/sceneGraphBuilder.ts`](file:///c:/dev/Froning/app/LineageGraph/src/domain/design/sceneGraphBuilder.ts), [`src/domain/design/contourLayoutEngine.ts`](file:///c:/dev/Froning/app/LineageGraph/src/domain/design/contourLayoutEngine.ts)
  - Frontend Store & UI: [`src/composables/useDesignStudioStore.ts`](file:///c:/dev/Froning/app/LineageGraph/src/composables/useDesignStudioStore.ts), [`src/components/DesignTree.vue`](file:///c:/dev/Froning/app/LineageGraph/src/components/DesignTree.vue), [`src/components/design/DesignSidebar.vue`](file:///c:/dev/Froning/app/LineageGraph/src/components/design/DesignSidebar.vue), [`src/components/design/DesignCanvas.vue`](file:///c:/dev/Froning/app/LineageGraph/src/components/design/DesignCanvas.vue), [`src/components/design/DesignPersonCard.vue`](file:///c:/dev/Froning/app/LineageGraph/src/components/design/DesignPersonCard.vue)
  - Rust Backend: [`src-tauri/src/design_repo.rs`](file:///c:/dev/Froning/app/LineageGraph/src-tauri/src/design_repo.rs), [`src-tauri/src/db.rs`](file:///c:/dev/Froning/app/LineageGraph/src-tauri/src/db.rs) (`design_documents`, `design_subtree_mounts`), [`src-tauri/src/lib.rs`](file:///c:/dev/Froning/app/LineageGraph/src-tauri/src/lib.rs) (`load_design_tree_bundle`, `save_design_document_v2`)
- **Technische Umsetzung:**
  1. **Backend & Persistenz:** Zweig-Dokumente (`document_kind = 'subtree'`) werden über `design_subtree_mounts` (`anchor_person_id`, `sub_document_id`, `display_mode`: `'inline' | 'capsule'`, `relative_delta_x`) an das Master-Dokument gebunden. `load_design_tree_bundle` lädt das Master-Dokument inklusive aller rekursiv referenzierten Sub-Dokumente (`subDocuments`) und Medien-Assets (`mediaAssets`, `mediaMetas`) in einem Aufruf.
  2. **Szenen-Komposition & Outward Push:** `sceneGraphBuilder.ts` und `contourLayoutEngine.ts` isolieren Ankerknoten, betten das Sub-Dokument relativ zum Ankerknoten ein (`inline` vollständig, `capsule` als kompakte Kapsel) und verdrängen angrenzende Master-Gruppen kollisionsfrei nach außen.
  3. **Lokale Hintergründe & Schreibschutz:** Über `bg_asset_id` verknüpfte Medien-Assets des Zweig-Dokuments werden am Zweig-Anker gerendert. Eingebettete Zweig-Karten sind im Master schreibgeschützt; ein Klick auf „Zweig bearbeiten“ wechselt nahtlos in das Subtree-Dokument und zurück zum Master.

#### SPEC-DSG-007 -> REQ-DSG-007
- **Fachliche Anforderung:** Verschlüsselter Projekt-Export & -Import (.lgproj) ([REQ-DSG-007](file:///c:/dev/Froning/app/LineageGraph/docs/REQ.md#req-dsg-007-verschl%C3%BCsselter-projekt-export---import-lgproj))
- **Architektonische Schicht & Komponenten-Mapping:**
  - Rust Backend: [`src-tauri/src/design_repo.rs`](file:///c:/dev/Froning/app/LineageGraph/src-tauri/src/design_repo.rs) (`LGPROJ_MAGIC`, `PBKDF2_ITERS`), [`src-tauri/src/lib.rs`](file:///c:/dev/Froning/app/LineageGraph/src-tauri/src/lib.rs) (`export_encrypted_project`, `import_encrypted_project`)
  - Kryptografie-Crates: `aes-gcm`, `pbkdf2`, `hmac`, `sha2`, `rand`, `base64` ([`src-tauri/Cargo.toml`](file:///c:/dev/Froning/app/LineageGraph/src-tauri/Cargo.toml))
  - Frontend Store: [`src/composables/useDesignStudioStore.ts`](file:///c:/dev/Froning/app/LineageGraph/src/composables/useDesignStudioStore.ts)
- **Technische Umsetzung:**
  `export_encrypted_project` serialisiert das vollständige Design-Bundle (Dokumente, Regeln, Subtree-Mounts, Medien-Assets) in JSON, leitet aus dem Benutzerpasswort und einem zufälligen Salt mittels `PBKDF2-HMAC-SHA256` (`100_000` Iterationen) einen 256-Bit-Schlüssel ab und verschlüsselt die Nutzdaten mit `Aes256Gcm`. Die Ausgabedatei beginnt mit dem 8-Byte-Header `LGPROJ01`. `import_encrypted_project` prüft den Header, entschlüsselt die Nutzdaten und importiert Dokumente sowie Medien-Assets transaktional in die aktive SQLite-Datenbank.

---

### 2.6 Domäne: Import & Differentieller Datenabgleich (IMP)

#### SPEC-IMP-001 -> REQ-IMP-001
- **Fachliche Anforderung:** Atomarer GEDCOM-Vollimport (5.5 / 5.5.1) ([REQ-IMP-001](file:///c:/dev/Froning/app/LineageGraph/docs/REQ.md#req-imp-001-atomarer-gedcom-vollimport-55--551))
- **Architektonische Schicht & Komponenten-Mapping:**
  - Rust Backend: [`src-tauri/src/parser.rs`](file:///c:/dev/Froning/app/LineageGraph/src-tauri/src/parser.rs) (`import_gedcom`), [`src-tauri/src/lib.rs`](file:///c:/dev/Froning/app/LineageGraph/src-tauri/src/lib.rs#L1075-L1095) (`import_gedcom_file`)
- **Technische Umsetzung:**
  `parser::import_gedcom` liest Zeilen gepuffert via `BufReader` ein, baut hierarchische Records aus Level-Nummer, Tag und Wert auf und parst Personen (`INDI`) und Familien (`FAM`). In einer einzigen Transaktion werden die bestehenden Tabellen geleert und die neuen Entitäten sowie alle Eltern-Kind-Relationen in `parent_child` geschrieben.

#### SPEC-IMP-002 -> REQ-IMP-002
- **Fachliche Anforderung:** Intelligentes GEDCOM-Staging & Matching ([REQ-IMP-002](file:///c:/dev/Froning/app/LineageGraph/docs/REQ.md#req-imp-002-intelligentes-gedcom-staging--matching))
- **Architektonische Schicht & Komponenten-Mapping:**
  - Rust Backend: [`src-tauri/src/gedcom_import_merge.rs`](file:///c:/dev/Froning/app/LineageGraph/src-tauri/src/gedcom_import_merge.rs#L100-L350) (`stage_gedcom_for_merge`)
- **Technische Umsetzung:**
  `stage_gedcom_for_merge` liest die GEDCOM-Datei in den Speicher (`StagedGedcomData`). Anschließend wird ein Match-Score gegen die bestehende `individuals`-Tabelle berechnet: Identische XREF ergibt 100 Punkte, exakte Namens- und Datumsübereinstimmung 80 Punkte, phonetische/Teilübereinstimmungen 50–70 Punkte. Das Ergebnis wird als `GedcomMergePlan` an das Frontend übergeben.

#### SPEC-IMP-003 -> REQ-IMP-003
- **Fachliche Anforderung:** Differentieller 3-Wege-Merge mit Konfliktlösung ([REQ-IMP-003](file:///c:/dev/Froning/app/LineageGraph/docs/REQ.md#req-imp-003-differentieller-3-wege-merge-mit-konfliktl%C3%B6sung))
- **Architektonische Schicht & Komponenten-Mapping:**
  - Rust Backend: [`src-tauri/src/gedcom_import_merge.rs`](file:///c:/dev/Froning/app/LineageGraph/src-tauri/src/gedcom_import_merge.rs#L360-L750) (`apply_gedcom_merge`)
  - UI-Modal: [`src/components/modals/GedcomImportModal.vue`](file:///c:/dev/Froning/app/LineageGraph/src/components/modals/GedcomImportModal.vue)
- **Technische Umsetzung:**
  In `GedcomImportModal.vue` kann der Benutzer zwischen den Modi `new` (neuer Stammbaum), `replace` (Vollimport) und `merge` (Differenziell) wählen. Im Merge-Modus wird ein Side-by-Side-Diff angezeigt. Der Benutzer legt feldweise (`fieldChoices`) und pro Datensatz fest, welcher Stand Vorrang hat. `apply_gedcom_merge` führt diese Instruktionen atomar in der SQLite-Datenbank aus und liefert detaillierte Ergebnisstatistiken (`MergeResultStats`) zurück.

---

### 2.7 Domäne: Multi-Format-Export & Chronik-Erstellung (EXP)

#### SPEC-EXP-001 -> REQ-EXP-001
- **Fachliche Anforderung:** GEDCOM-Teilmengen-Export ([REQ-EXP-001](file:///c:/dev/Froning/app/LineageGraph/docs/REQ.md#req-exp-001-gedcom-teilmengen-export))
- **Architektonische Schicht & Komponenten-Mapping:**
  - Rust Backend: [`src-tauri/src/gedcom_export.rs`](file:///c:/dev/Froning/app/LineageGraph/src-tauri/src/gedcom_export.rs) (`generate_gedcom`, `resolve_scope_person_ids`), [`src-tauri/src/lib.rs`](file:///c:/dev/Froning/app/LineageGraph/src-tauri/src/lib.rs#L2460-L2520) (`preview_gedcom_export`, `export_gedcom_to_file`)
  - UI-Komponente: [`src/components/export/GedcomExportPane.vue`](file:///c:/dev/Froning/app/LineageGraph/src/components/export/GedcomExportPane.vue)
- **Technische Umsetzung:**
  `resolve_scope_person_ids` ermittelt basierend auf dem gewählten Scope (`All`, `Descendants`, `Ancestors`, `SpecificList`) die Menge aller zu exportierenden Personen-IDs per BFS. `generate_gedcom` erzeugt standardkonforme `0 HEAD`, `0 @I...@ INDI`, `0 @F...@ FAM` und `0 TRLR` Blöcke, inklusive `CHAN`-Tags und filtert Familienverbindungen, deren Partner nicht im Scope liegen.

#### SPEC-EXP-002 -> REQ-EXP-002
- **Fachliche Anforderung:** Strukturierter CSV-Export ([REQ-EXP-002](file:///c:/dev/Froning/app/LineageGraph/docs/REQ.md#req-exp-002-strukturierter-csv-export))
- **Architektonische Schicht & Komponenten-Mapping:**
  - Rust Backend: [`src-tauri/src/csv_export.rs`](file:///c:/dev/Froning/app/LineageGraph/src-tauri/src/csv_export.rs) (`generate_csv`), [`src-tauri/src/lib.rs`](file:///c:/dev/Froning/app/LineageGraph/src-tauri/src/lib.rs#L2530-L2580) (`preview_csv_export`, `export_csv_to_file`)
  - UI-Komponente: [`src/components/export/CsvExportPane.vue`](file:///c:/dev/Froning/app/LineageGraph/src/components/export/CsvExportPane.vue)
- **Technische Umsetzung:**
  `generate_csv` filtert Personen nach Scope, löst Vater- und Mütternamen über eine In-Memory-Lookup-Map auf und schreibt CSV-Zeilen mit Anführungszeichen-Maskierung (`escape_csv_field`). Bei aktivierter Option `include_bom` wird das UTF-8 Byte-Order-Mark `\u{FEFF}` vorangestellt. In `CsvExportPane.vue` kann die Vorschau zwischen einer formatierten HTML-Tabelle (`parsedCsvTable`) und dem `.csv`-Rohtext umgeschaltet werden.

#### SPEC-EXP-003 -> REQ-EXP-003
- **Fachliche Anforderung:** Autarke interaktive HTML-Chronik ([REQ-EXP-003](file:///c:/dev/Froning/app/LineageGraph/docs/REQ.md#req-exp-003-autarke-interaktive-html-chronik))
- **Architektonische Schicht & Komponenten-Mapping:**
  - Frontend Utility: [`src/utils/htmlExport.ts`](file:///c:/dev/Froning/app/LineageGraph/src/utils/htmlExport.ts) (`buildInteractiveExportTree`, `generateInteractiveTreeHtml`)
  - Vendor Assets: [`src/assets/vendor/d3.v7.min.ts`](file:///c:/dev/Froning/app/LineageGraph/src/assets/vendor/d3.v7.min.ts)
  - UI-Komponenten: [`src/components/export/HtmlExportPane.vue`](file:///c:/dev/Froning/app/LineageGraph/src/components/export/HtmlExportPane.vue), [`src/components/common/ExportLanguageSelect.vue`](file:///c:/dev/Froning/app/LineageGraph/src/components/common/ExportLanguageSelect.vue)
- **Technische Umsetzung:**
  `htmlExport.ts` kompiliert alle Personendaten, Verwandtschaftsbeziehungen und Stammbaumäste in einen einzigen, autarken HTML5-String. Das Dokument enthält eingebettete CSS-Stile, SVG-Icons und vanilla JavaScript für interaktive Suche, Personenauswahl, einen auf Desktop und Mobilgeräten einklappbaren Detail-Drawer (`#sidebar`) sowie klickbare Sprunglinks (`jumpToHenry`) für Eltern, Implex-Verweise und Kinder ohne externe Netzwerkabhängigkeiten:
  - **Mehrsprachigkeit & Responsive Vorschau:** Über `ExportLanguageSelect.vue` und `tLocale` kann die Exportsprache (`de`, `en`, `fr`, `pt`) gezielt gewählt werden; `HtmlExportPane.vue` bietet zudem einen Umschalter zwischen Desktop- und Mobile-Vorschau (`previewViewport`, `mobileOrientation`).
  - **Single-File Bundle:** D3.js v7.9.2 ist direkt über `d3.v7.min.ts` als Minified String im Skriptblock vor dem schließenden `</body>` eingebunden; Personendaten werden als strukturiertes `<script type="application/json" id="tree-data-json">` injectet und mit `</script`-Maskierung geschützt.
  - **Mobil- & Touch-Härtung (iOS & Android):** Viewport mit `viewport-fit=cover`, Mindest-Touch-Ziele von 44x44px für alle Schaltflächen und transparente SVG-Knoten-Hitboxen (`circle.touch-hitbox` mit `r=22`), `touch-action: none` zur Entkopplung des SVG-Pinch/Pans von Browser-Gesten sowie Safe-Area-Insets (`env(safe-area-inset-*)`) und Dynamic Viewport Height (`100dvh`). Auf Viewports `<= 900px` wird die Menüleiste auf `overflow: visible` umgestellt, das Suchfeld flexibel über die Leiste gestreckt (Vorschlags-Dropdown schwebt unbeschnitten frei über der Leinwand) und Werkzeugschaltflächen werden kompakt in einem Dropdown-Kontextmenü (`.menu-dropdown-wrapper` / `#btn-mobile-menu`) gebündelt.
  - **Sandbox- & Storage-Schutz:** Persistierung von Sprachauswahl und Ehepartner-Anzeige über einen `safeStorage`-Wrapper mit In-Memory-Fallback zur Vermeidung von `SecurityError`-Abbrüchen in iOS Quick Look oder isolierten `file://`-Kontexten.
  - **Tauri Production Security & Preview-CSP:** In `src-tauri/tauri.conf.json` ist die Content Security Policy (`csp`) explizit auf `default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval' blob: data:; img-src 'self' asset: https://asset.localhost data: blob:; style-src 'self' 'unsafe-inline'; font-src 'self' data:; connect-src 'self' ipc: http://ipc.localhost; frame-src 'self' blob: data:; child-src 'self' blob: data:;` konfiguriert. Dies gewährleistet, dass die eingebetteten In-Memory-Skripte und D3-Visualisierungen im In-App-Vorschau-Iframe (WebView2) auch in installierten Produktions-Builds fehlerfrei ausgeführt werden.

#### SPEC-EXP-004 -> REQ-EXP-004
- **Fachliche Anforderung:** Hochauflösender Bild- & Vektorexport des Stammbaums ([REQ-EXP-004](file:///c:/dev/Froning/app/LineageGraph/docs/REQ.md#req-exp-004-hochaufl%C3%B6sender-bild---vektorexport-des-stammbaums))
- **Architektonische Schicht & Komponenten-Mapping:**
  - Frontend Utility: [`src/utils/designSceneExport.ts`](file:///c:/dev/Froning/app/LineageGraph/src/utils/designSceneExport.ts)
  - UI-Komponente: [`src/components/export/DesignImageExportPane.vue`](file:///c:/dev/Froning/app/LineageGraph/src/components/export/DesignImageExportPane.vue)
- **Technische Umsetzung:**
  `designSceneExport.ts` rendert den berechneten `DesignSceneGraph` (inklusive Personen-Karten, orthogonaler/organischer Verbinder, Linienbrücken und eingebetteter Hintergrundbilder) direkt in ein bereinigtes SVG-XML-Dokument. Für PNG-Grafiken wird die SVG auf ein offscreen HTML5 `<canvas>`-Element gezeichnet und mit benutzerdefiniertem Skalierungsfaktor (z. B. 2x oder 3x) via `canvas.toBlob('image/png')` gerendert.

#### SPEC-EXP-005 -> REQ-EXP-005
- **Fachliche Anforderung:** Automatisierte LaTeX/TikZ-Buchchronik ([REQ-EXP-005](file:///c:/dev/Froning/app/LineageGraph/docs/REQ.md#req-exp-005-automatisierte-latextikz-buchchronik))
- **Architektonische Schicht & Komponenten-Mapping:**
  - Frontend Utility: [`src/utils/latexExport.ts`](file:///c:/dev/Froning/app/LineageGraph/src/utils/latexExport.ts)
  - Rust Backend: [`src-tauri/src/lib.rs`](file:///c:/dev/Froning/app/LineageGraph/src-tauri/src/lib.rs#L1200-L1350) (`export_latex_pdf`, `save_latex_export_bundle`, `escape_latex`)
  - UI-Komponenten: [`src/components/export/LatexExportPane.vue`](file:///c:/dev/Froning/app/LineageGraph/src/components/export/LatexExportPane.vue), [`src/components/export/LatexConfigModal.vue`](file:///c:/dev/Froning/app/LineageGraph/src/components/export/LatexConfigModal.vue)
- **Technische Umsetzung:**
  `escape_latex` maskiert alle Sonderzeichen (`&`, `%`, `$`, `#`, `_`, `{`, `}`, `~`, `^`, `\`). `tera` rendert `chronik.tex`. Unter Windows/Linux führt `export_latex_pdf` den Prozess `pdflatex -interaction=nonstopmode chronik.tex` in einem temporären Arbeitsverzeichnis aus und liefert den Pfad der erzeugten PDF zurück. Über `save_latex_export_bundle` kann der vollständige TeX-Quellcode inklusive Grafiken für die manuelle Weiterverarbeitung exportiert werden.

### 3.8 Forschungsassistent & Genealogischer Lücken-Finder (RES)

#### SPEC-RES-001 -> REQ-RES-001
- **Fachliche Anforderung:** Regelbasierte Lückenerkennung & Heuristiken ([REQ-RES-001](file:///c:/dev/Froning/app/LineageGraph/docs/REQ.md#req-res-001-regelbasierte-l%C3%BCckenerkennung---heuristiken))
- **Architektonische Schicht & Komponenten-Mapping:**
  - Rust Backend: [`src-tauri/src/research.rs`](file:///c:/dev/Froning/app/LineageGraph/src-tauri/src/research.rs) (`analyze_gaps`, `extract_year`, `parse_date_fractional_year`)
  - Tauri Command: [`src-tauri/src/lib.rs`](file:///c:/dev/Froning/app/LineageGraph/src-tauri/src/lib.rs) (`analyze_research_gaps`, `get_research_statistics`)
  - Types: [`src/types/research.ts`](file:///c:/dev/Froning/app/LineageGraph/src/types/research.ts)
  - Composable: [`src/composables/useResearchAssistant.ts`](file:///c:/dev/Froning/app/LineageGraph/src/composables/useResearchAssistant.ts)
- **Technische Umsetzung:**
  `analyze_gaps` iteriert über den scoped Personensatz und führt vier deterministische Heuristiken aus:
  1. `MISSING_PARENTS`: Prüfung auf `father_id.is_none()` und `mother_id.is_none()` (Ahnenende/Stammeltern) bzw. Fehlen eines Einzelvaters/einer Einzelmutter.
  2. `MISSING_DEATH`: Prüfung, ob `death_date` fehlt und die Geburt länger als `max_age_years` (Default: 110 Jahre) zurückliegt.
  3. `MISSING_PLACE`: Prüfung, ob `birth_date` vorliegt aber `birth_place` fehlt, oder `death_date` vorliegt aber `death_place` fehlt.
  4. `CHILD_GAP`: Prüfung sequentieller Geschwisterabstände via `parse_date_fractional_year`; Spannen `>= child_gap_years` (Default: 3,5 Jahre) werden erfasst.

#### SPEC-RES-002 -> REQ-RES-002
- **Fachliche Anforderung:** Kontextuelle Recherche-Handlungsempfehlungen & Archiv-Links ([REQ-RES-002](file:///c:/dev/Froning/app/LineageGraph/docs/REQ.md#req-res-002-kontextuelle-recherche-handlungsempfehlungen---archiv-links))
- **Architektonische Schicht & Komponenten-Mapping:**
  - Rust Backend: [`src-tauri/src/research.rs`](file:///c:/dev/Froning/app/LineageGraph/src-tauri/src/research.rs) (`generate_archive_links`, `url_encode`)
  - UI-Komponente: [`src/components/research/ResearchAssistantView.vue`](file:///c:/dev/Froning/app/LineageGraph/src/components/research/ResearchAssistantView.vue)
- **Technische Umsetzung:**
  `generate_archive_links` baut URL-kodierte Zielaufrufe auf:
  - FamilySearch: URL mit `q.givenName`, `q.surname`, `q.birthLikePlace` und Datumsfenster `[year-2, year+2]`.
  - Matricula Online: Gezielte Ortssuche nach katholischen Kirchenbüchern via `https://data.matricula-online.eu/de/suche/?place=...`.
  - Archion: Ortssuche nach evangelischen Kirchenbüchern via `https://www.archion.de/de/suche/?q=...`.
  - Meyers Gazetteer: Historische Ortssuche zur Pfarreizuordnung via `https://www.meyersgaz.org/place/search?search=...`.
  In `ResearchAssistantView.vue` öffnen die Buttons externe Links über den nativen Tauri-Opener (`@tauri-apps/plugin-opener`). Kontextuelle Hinweise differenzieren historische Zäsuren (z. B. Standesamtseinführung ab 1874/1876 vs. Pfarrkirchenbücher).

#### SPEC-RES-003 -> REQ-RES-003
- **Fachliche Anforderung:** Priorisierungs-Scoring & Persistente Aufgabenverwaltung ([REQ-RES-003](file:///c:/dev/Froning/app/LineageGraph/docs/REQ.md#req-res-003-priorisierungs-scoring---persistente-aufgabenverwaltung))
- **Architektonische Schicht & Komponenten-Mapping:**
  - SQLite Schema: [`src-tauri/src/db.rs`](file:///c:/dev/Froning/app/LineageGraph/src-tauri/src/db.rs) (`research_tasks` Tabelle und Indizes)
  - Rust Backend: [`src-tauri/src/research.rs`](file:///c:/dev/Froning/app/LineageGraph/src-tauri/src/research.rs) (`calculate_priority_score`, `upsert_task_status`, `load_persisted_tasks`)
  - Tauri Command: [`src-tauri/src/lib.rs`](file:///c:/dev/Froning/app/LineageGraph/src-tauri/src/lib.rs) (`update_research_task_status`)
  - Frontend View & Navigation: [`src/components/research/ResearchAssistantView.vue`](file:///c:/dev/Froning/app/LineageGraph/src/components/research/ResearchAssistantView.vue), [`src/App.vue`](file:///c:/dev/Froning/app/LineageGraph/src/App.vue)
- **Technische Umsetzung:**
  - **Scoring:** Basisscore nach Lückentyp (MISSING_PARENTS: 70, CHILD_GAP: 55, MISSING_DEATH: 50, MISSING_PLACE: 40) mit Boost für direkte Ahnenlinie des aktiven Probanden (+20) und Vorhandensein von Referenzdaten (+10). Scorebereiche: `>= 85` (Dringend), `65-84` (Hoch), `45-64` (Mittel), `< 45` (Gering).
  - **Persistenz & Kaskadierung:** Tabelle `research_tasks` mit Fremdschlüssel `FOREIGN KEY(person_id) REFERENCES individuals(id) ON DELETE CASCADE` und `ON CONFLICT(id) DO UPDATE`.
  - **Hybride Erledigung:** Automatische Zuordnung zu `completed`, wenn eine persistierte Aufgabe bei erneutem Scan nicht mehr in den neu ermittelten Lücken auftaucht, kombiniert mit manuellem Status-Umschalter und Freitextnotizen.

#### SPEC-RES-004 -> REQ-RES-004
- **Fachliche Anforderung:** Konfigurierbare Recherche-Portale & Personenzentriertes Forschungsdossier ([REQ-RES-004](file:///c:/dev/Froning/app/LineageGraph/docs/REQ.md#req-res-004-konfigurierbare-recherche-portale---personenzentriertes-forschungsdossier))
- **Architektonische Schicht & Komponenten-Mapping:**
  - Types: [`src/types/research.ts`](file:///c:/dev/Froning/app/LineageGraph/src/types/research.ts) (`ResearchPortalConfig`, `PortalAccessType`, `ResearchSettings`)
  - Composable: [`src/composables/useResearchPortals.ts`](file:///c:/dev/Froning/app/LineageGraph/src/composables/useResearchPortals.ts) (`generatePortalUrl`, `loadStoredPortals`, `savePortals`, `resetToDefaults`)
  - Einstellungen: [`src/components/modals/SettingsModal.vue`](file:///c:/dev/Froning/app/LineageGraph/src/components/modals/SettingsModal.vue) (Reiter `Forschungsassistent` -> Portal-Bibliothek mit Spezialisierungs- und Kostenart-Badges)
  - UI-Dossier & Lücken-Matrix: [`src/components/research/ResearchAssistantView.vue`](file:///c:/dev/Froning/app/LineageGraph/src/components/research/ResearchAssistantView.vue)
- **Technische Umsetzung:**
  - **Portal-Konfiguration:** 9 vorkonfigurierte Portale (`familysearch`, `matricula`, `archion`, `ancestry`, `myheritage`, `compgen_gedbas`, `meyers`, `findagrave`, `geneanet`) mit Spezialisierungen und Kostenstufen (`free`, `free_registration`, `subscription`, `freemium`). Kostenpflichtige Portale sind per Default inaktiv und können vom Nutzer mit 1 Klick aktiviert werden.
  - **URL-Interpolation:** `generatePortalUrl` ersetzt Platzhalter `{given}`, `{surname}`, `{place}`, `{birth_place}`, `{death_place}`, `{birth_year}`, `{death_year}`, `{birth_from}`, `{birth_to}` URL-kodiert und bereinigt leere Parameter.
  - **Personenzentriertes Dossier:** Zentralisierte Recherche-Leiste einmalig pro Personenkopf; kompakte Lücken-Checkliste mit 1-Klick Status-Pill-Dropdown (`Offen`, `In Recherche`, `Erledigt`, `Ignoriert`), Akkordeon-Aufklappung für ausführliche Handlungsempfehlungen und per-Task-Notizen; Batch-Aktion `Alle als erledigt markieren` und Filter `Erledigte ausblenden`.

  - **Navigation:** 1-Klick-Sprünge zur Person in den Stammbaum-Canvas (`navigate-tree`), die Tabellenansicht (`navigate-table`) und den Personendetail-Drawer (`open-details`).

#### SPEC-RES-005 -> REQ-RES-005
- **Fachliche Anforderung:** Erkennung und Analyse isolierter Zweige (Insel-Finder) ([REQ-RES-005](file:///c:/dev/Froning/app/LineageGraph/docs/REQ.md#req-res-005-erkennung-und-analyse-isolierter-zweige-insel-finder))
- **Architektonische Schicht & Komponenten-Mapping:**
  - Rust Backend: [`src-tauri/src/research.rs`](file:///c:/dev/Froning/app/LineageGraph/src-tauri/src/research.rs) (`find_isolated_branches`, `calc_branch_depth`, `make_person_summary`)
  - Tauri Command: [`src-tauri/src/lib.rs`](file:///c:/dev/Froning/app/LineageGraph/src-tauri/src/lib.rs) (`get_isolated_branches`)
  - Types: [`src/types/research.ts`](file:///c:/dev/Froning/app/LineageGraph/src/types/research.ts) (`IsolatedBranchesResultDto`, `IsolatedBranchDto`, `BranchPersonSummary`, `SuggestedConnection`)
  - Composable: [`src/composables/useResearchAssistant.ts`](file:///c:/dev/Froning/app/LineageGraph/src/composables/useResearchAssistant.ts) (`isolatedBranchesData`, `loadIsolatedBranches`)
  - UI-Komponente: [`src/components/research/ResearchAssistantView.vue`](file:///c:/dev/Froning/app/LineageGraph/src/components/research/ResearchAssistantView.vue)
- **Technische Umsetzung:**
  - **Graph-Konnektivität & BFS:** Modellierung eines ungerichteten Adjazenzgraphen über `parent_ids`, `children_ids` und `spouses`. BFS segmentiert alle Personen in Zusammenhangskomponenten.
  - **Hauptstamm-Identifikation:** Komponente mit `active_proband_id` (oder größter Personenzahl bei fehlendem Probanden) wird als Hauptstamm (`main_tree`) festgelegt; alle weiteren Komponenten bilden die isolierten Zweige.
  - **Metadaten-Aggregation:** Bestimmung der Spitzenahnen (Personen im Zweig ohne Eltern innerhalb der Komponente), Berechnung der Generationentiefe via längstem DAG-Pfad (`calc_branch_depth`), Zeitintervall (`earliest_year` bis `latest_year`) und Häufigkeitsverteilung von Nachnamen und Orten.
  - **Anknüpfungs-Heuristik:** Abgleich von isolierten Personen gegen den Hauptstamm (indiziert nach normalisiertem Nachnamen). Konfidenz-Scoring: Basisscore (50) bei Nachnamensgleichheit, Bonus (+25) bei Übereinstimmung des Geburts-/Sterbeortes, Bonus (+15 bis +20) bei zeitlicher Nähe (±15 bis ±45 Jahre).
  - **UI-Präsentation & Interaktion:** Header-Subtab-Umschalter mit Badge-Zählern, KPI-Dashboard, flexibler Toolbar-Filter für Typ und Generationen ("n Generationen" mit dynamischem Number-Input) sowie Volltextsuche. 1-Klick-Aktionen zur Navigation in den Baum (`navigate-tree`), Tabelle (`navigate-table`) und direkte Lückenanalyse (`handleAnalyzeBranch`).


