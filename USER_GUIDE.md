# Anwenderhandbuch: LineageGraph (Froning Familienbuch)

**Willkommen bei LineageGraph!**  
Dieses Handbuch führt Sie Schritt für Schritt durch alle Funktionen der Anwendung. LineageGraph ist ein modernes, benutzerfreundliches Programm zur Erfassung, Visualisierung, computergestützten Auswertung und ansprechenden Veröffentlichung Ihrer Familiengeschichte.

---

## Inhaltsverzeichnis

- [Kapitel 1: Einstieg & Workspace-Verwaltung](#kapitel-1-einstieg--workspace-verwaltung)
  - [1.1 Die Programmoberfläche im Überblick](#11-die-programmoberfläche-im-überblick)
  - [1.2 Stammbäume anlegen, auswählen und wechseln](#12-stammbäume-anlegen-auswählen-und-wechseln)
  - [1.3 Stammbäume sicher entfernen](#13-stammbäume-sicher-entfernen)
  - [1.4 Arbeiten im Leerzustand](#14-arbeiten-im-leerzustand)
- [Kapitel 2: Fachliche Module & Workflows](#kapitel-2-fachliche-module--workflows)
  - [2.1 Personen- und Familiendaten verwalten](#21-personen--und-familiendaten-verwalten)
    - [2.1.1 Neue Personen erfassen mit automatischer ID-Vergabe](#211-neue-personen-erfassen-mit-automatischer-id-vergabe)
    - [2.1.2 Tabellarische Massenbearbeitung im Editier-Modus](#212-tabellarische-massenbearbeitung-im-editier-modus)
    - [2.1.3 Elternteile zuweisen & Schutz vor Zirkelbezügen](#213-elternteile-zuweisen--schutz-vor-zirkelbezügen)
    - [2.1.4 Ehen, Partnerschaften und Scheidungen pflegen](#214-ehen-partnerschaften-und-scheidungen-pflegen)
    - [2.1.5 Kinder zuweisen und Familienverbindungen lösen](#215-kinder-zuweisen-und-familienverbindungen-lösen)
    - [2.1.6 Revisionssichere Änderungsverfolgung](#216-revisionssichere-änderungsverfolgung)
  - [2.2 Genealogische Ordnungen & Verwandtschaftsanalyse](#22-genealogische-ordnungen--verwandtschaftsanalyse)
    - [2.2.1 Stammahnen (Probanden) festlegen & Sichten wechseln](#221-stammahnen-probanden-festlegen--sichten-wechseln)
    - [2.2.2 Das Henry-Zählsystem verstehen & berechnen](#222-das-henry-zählsystem-verstehen--berechnen)
    - [2.2.3 Kürzesten Verwandtschaftspfad zwischen zwei Personen ermitteln](#223-kürzesten-verwandtschaftspfad-zwischen-zwei-personen-ermitteln)
  - [2.3 Benutzeroberfläche & interaktive Ansichten](#23-benutzeroberfläche--interaktive-ansichten)
    - [2.3.1 Die interaktive Datentabelle nutzen](#231-die-interaktive-datentabelle-nutzen)
    - [2.3.2 Der interaktive Stammbaum-Canvas](#232-der-interaktive-stammbaum-canvas)
    - [2.3.3 Das Eintragsdetail-Panel (Inspektor)](#233-das-eintragsdetail-panel-inspektor)
    - [2.3.4 Die freie Schnellabfrage (Free Query)](#234-die-freie-schnellabfrage-free-query)
    - [2.3.5 Sprache umschalten (Deutsch / Englisch)](#235-sprache-umschalten-deutsch--englisch)
  - [2.4 Stammbaum Design Studio](#24-stammbaum-design-studio)
    - [2.4.1 Der Design-Modus & das hierarchische Schaubild](#241-der-design-modus--das-hierarchische-schaubild)
    - [2.4.2 Geschwistergruppen, Ebenen und Leitungsbrücken](#242-geschwistergruppen-ebenen-und-leitungsbrücken)
    - [2.4.3 Individuelle Kachel- und Zeilengestaltung](#243-individuelle-kachel--und-zeilengestaltung)
    - [2.4.4 Hintergrundbilder & Familienwappen einbinden](#244-hintergrundbilder--familienwappen-einbinden)
    - [2.4.5 Design-Zustände speichern, laden und teilen](#245-design-zustände-speichern-laden-und-teilen)
  - [2.5 GEDCOM-Import & 3-Wege-Datenabgleich](#25-gedcom-import--3-wege-datenabgleich)
    - [2.5.1 GEDCOM-Dateien importieren: Neues Projekt vs. Ersetzen](#251-gedcom-dateien-importieren-neues-projekt-vs-ersetzen)
    - [2.5.2 Der intelligente Abgleich-Assistent (Staging & Erkennung)](#252-der-intelligente-abgleich-assistent-staging--erkennung)
    - [2.5.3 Differentieller 3-Wege-Merge mit Konfliktlösung](#253-differentieller-3-wege-merge-mit-konfliktlösung)
  - [2.6 Export-Center & Chronik-Erstellung](#26-export-center--chronik-erstellung)
    - [2.6.1 GEDCOM-Teilmengen exportieren](#261-gedcom-teilmengen-exportieren)
    - [2.6.2 Tabellen-Export als CSV für Excel](#262-tabellen-export-als-csv-für-excel)
    - [2.6.3 Interaktive HTML-Chronik für den Webbrowser](#263-interaktive-html-chronik-für-den-webbrowser)
    - [2.6.4 Stammbaum-Bilder exportieren (PNG / JPG / SVG)](#264-stammbaum-bilder-exportieren-png--jpg--svg)
    - [2.6.5 Druckfertige Buchchroniken mit LaTeX erzeugen](#265-druckfertige-buchchroniken-mit-latex-erzeugen)
- [Kapitel 3: Praktische Tipps, Fehlersicherheiten & Best Practices](#kapitel-3-praktische-tipps-fehlersicherheiten--best-practices)
  - [3.1 Das zweistufige Sicherheitskonzept gegen Datenverlust](#31-das-zweistufige-sicherheitskonzept-gegen-datenverlust)
  - [3.2 Warum der Schutz vor Verwandtschaftsschleifen unverzichtbar ist](#32-warum-der-schutz-vor-verwandtschaftsschleifen-unverzichtbar-ist)
  - [3.3 Der sichere Umgang mit Personenabgleichen beim Merge](#33-der-sichere-umgang-mit-personenabgleichen-beim-merge)
  - [3.4 Empfohlene Arbeitsabläufe für die Familienforschung](#34-empfohlene-arbeitsabläufe-für-die-familienforschung)

---

# Kapitel 1: Einstieg & Workspace-Verwaltung

## 1.1 Die Programmoberfläche im Überblick

Nach dem Start von LineageGraph öffnet sich das Hauptfenster. Die Benutzeroberfläche gliedert sich in folgende Hauptbereiche:

1. **Die Kopfzeile (Header):**
   * **Programm-Titel & Aktiver Stammbaum:** Zeigt an, welche Familiendatenbank aktuell geöffnet ist.
   * **Haupt-Modus-Schalter:** Wechselt zwischen den vier Hauptansichten:
     * 📋 **Tabelle:** Tabellarische Erfassung, Filterung und Sortierung aller Personen.
     * 🌳 **Stammbaum:** Interaktiver Canvas-Stammbaum mit stufenlosem Panning & Zoom.
     * 🎨 **Design Mode:** Visuelles Design-Studio zur Gestaltung druckreifer Stammbäume.
     * 📦 **Export:** Zentraler Hub zur Generierung von Büchern, Webseiten, Bildern und Tabellen.
   * **Probanden-Tabs:** Schnellauswahl der definierten Stammahnen zur sofortigen Neuberechnung und Anzeige der Henry-Nummerierung.
   * **Aktionsschaltflächen:** Schneller Zugriff auf *„+ Person anlegen“*, *„GEDCOM importieren“* und die *„⚙️ Konfiguration“*.

2. **Der zentrale Arbeitsbereich:**
   * Zeigt je nach gewähltem Modus die Tabelle, den interaktiven Canvas-Baum, das Design Studio oder das Export-Center.

3. **Das Detail-Panel (Slide-Over Drawer):**
   * Rechts einblendbare Leiste, die zu jeder selektierten Person alle Lebensdaten, Eltern, Geschwister, Partner, Kinder, Notizen und historischen GEDCOM-Rohdaten übersichtlich zusammenfasst.

---

## 1.2 Stammbäume anlegen, auswählen und wechseln

### Was macht die Funktion?
Sie können beliebig viele voneinander unabhängige Stammbäume (z. B. für verschiedene Familienzweige oder getrennte Forschungsprojekte) auf Ihrem Computer verwalten. Jeder Stammbaum wird isoliert gespeichert, sodass Sie ohne Vermischungsgefahr zwischen verschiedenen Beständen hin- und herwechseln können.

### Wie bediene ich sie?
1. Klicken Sie in der Kopfzeile rechts auf das Zahnrad-Symbol **„⚙️ Konfiguration“**.
2. Wählen Sie den Reiter **„Allgemein“** und blicken Sie auf den Bereich **„Stammbaum-Verwaltung“**.
3. **Stammbaum wechseln:** Klicken Sie im Dropdown-Menü *„Aktiver Stammbaum“* auf den gewünschten Namen. Die Anwendung lädt die Daten sofort ohne Programmneustart.
4. **Neuen Stammbaum erstellen:**
   * Geben Sie im Textfeld *„Neuer Stammbaum“* den gewünschten Namen ein (z. B. `Familie_Mueller`).
   * Klicken Sie auf **„Erstellen“**.
   * Der neue, leere Stammbaum wird angelegt und sofort als aktives Projekt ausgewählt.

### Was ist das Ergebnis?
Das Hauptfenster aktualisiert sich sofort. Alle Tabellen, Diagramme und Detailansichten zeigen ausschließlich die Personen des neu ausgewählten Stammbaums.

---

## 1.3 Stammbäume sicher entfernen

### Was macht die Funktion?
Entfernt einen nicht mehr benötigten Stammbaum restlos von Ihrer Festplatte. Um versehentliche Löschungen zuverlässig auszuschließen, ist der Vorgang durch eine strenge Sicherheitsprüfung geschützt.

### Wie bediene ich sie?
1. Öffnen Sie die **„⚙️ Konfiguration“** und wählen Sie im Bereich *„Stammbaum-Verwaltung“* den zu löschenden Stammbaum aus.
2. Klicken Sie auf die rote Schaltfläche **„Stammbaum entfernen“**.
3. **Sicherheitsstufe 1:** Es öffnet sich ein hervorgehobenes Dialogfenster mit der Frage:  
   *„Soll der ausgewählte Stammbaum «Name» entfernt werden?“*  
   *Hinweis:* Die Schaltfläche **„Abbrechen“** ist farblich hervorgehoben und automatisch vorselektiert.
4. Klicken Sie bewusst auf **„Bestätigen“**.
5. **Sicherheitsstufe 2:** Eine zweite Abfrage warnt:  
   *„Der ausgewählte Stammbaum «Name» wird endgültig entfernt.“*
6. Erst nach erneutem Klick auf **„Bestätigen“** wird der Baum endgültig gelöscht.

### Was ist das Ergebnis?
Alle zu diesem Stammbaum gehörenden Dateien werden rückstandsfrei gelöscht. Andere Stammbäume bleiben vollkommen unberührt. Die Anwendung wechselt automatisch zum nächsten verfügbaren Stammbaum.

---

## 1.4 Arbeiten im Leerzustand

### Was macht die Funktion?
Haben Sie alle Stammbäume gelöscht oder starten die Anwendung zum ersten Mal, führt Sie LineageGraph in einen sauberen Leerzustand. Dadurch werden Programmabstürze verhindert und Sie werden intuitiv zur Neuanlage geführt.

### Wie bediene ich sie?
* Im Leerzustand zeigt die Anwendung den Hinweis: *„Kein aktiver Stammbaum vorhanden. Bitte legen Sie einen neuen Stammbaum an oder importieren Sie eine GEDCOM-Datei.“*
* Die Schaltfläche *„Stammbaum entfernen“* wird automatisch ausgeblendet.
* Sobald Sie oben auf **„GEDCOM-Datei importieren“** klicken oder in den Einstellungen einen Namen eingeben, wird Ihr erstes Projekt erzeugt.

### Was ist das Ergebnis?
Sie erhalten ein sauberes, frisches Projekt ohne alte Restdaten.

---

# Kapitel 2: Fachliche Module & Workflows

## 2.1 Personen- und Familiendaten verwalten

### 2.1.1 Neue Personen erfassen mit automatischer ID-Vergabe

#### Was macht die Funktion?
Legt eine neue Person in Ihrer Familiendatenbank an – entweder als unabhängige Einzelperson oder direkt mit familiärem Bezug (als Kind, Elternteil oder Partner einer bestehenden Person). Das System vergibt automatisch eine eindeutige Kennnummer nach internationalem GEDCOM-Standard (z. B. `I1`, `I245`).

#### Wie bediene ich sie?
1. Klicken Sie in der Kopfzeile auf die grüne Schaltfläche **„+ Person anlegen“**.
2. Wählen Sie im Dialog die Bezugsart:
   * **Keine Bezugsperson / Unabhängige Person:** Die Person wird frei angelegt.
   * **Vater / Mutter von:** Verknüpft die neue Person als Elternteil einer bestehenden Person.
   * **Sohn / Tochter von:** Ordnet die neue Person als Kind ein.
   * **Ehepartner von:** Erstellt eine Partnerschafts-Verbindung.
3. Wählen Sie bei familiärem Bezug über das Suchfeld die gewünschte Bezugsperson aus.
4. Tragen Sie Vorname, Nachname, Geschlecht (`Männlich`, `Weiblich`, `Unbekannt`) sowie Geburts- und Sterbedaten (Datum und Ort) ein.
5. Über *„Alle Tabellenfelder anzeigen“* können Sie zusätzliche Angaben (Taufdaten, Beruf, Religion, Wohnort, Notizen) direkt miterfassen.
6. Klicken Sie auf **„Hinzufügen“**.

#### Was ist das Ergebnis?
Die Person erscheint sofort in der Tabelle und im Stammbaum. Etwaige Familienbeziehungen werden im Hintergrund automatisch korrekt verknüpft.

---

### 2.1.2 Tabellarische Massenbearbeitung im Editier-Modus

#### Was macht die Funktion?
Ermöglicht das schnelle Ändern von Namen, Lebensdaten und Kennungen direkt in der Tabelle – ähnlich wie in einer Tabellenkalkulation. Änderungen werden zunächst farblich markiert und erst nach Ihrer Bestätigung in einem Rutsch gespeichert.

#### Wie bediene ich sie?
1. Klicken Sie oberhalb der Tabelle auf **„Tabelle editieren“**. Die Zellen werden zu beschreibbaren Textfeldern.
2. Klicken Sie in eine Zelle (z. B. Nachname oder Geburtsdatum) und tippen Sie den neuen Wert ein.
3. **ID ändern:** Wenn Sie eine Kennung ändern, prüft das System in Echtzeit, ob das Format gültig ist und noch nicht anderweitig vergeben wurde. Bei Bestätigung werden alle Verknüpfungen der Person automatisch angepasst.
4. Klicken Sie auf die grüne Schaltfläche **„Änderungen speichern“** (oder auf *„Bearbeiten abbrechen“*, um alle Modifikationen zu verwerfen).

#### Was ist das Ergebnis?
Alle Änderungen werden dauerhaft gespeichert. Die Tabelle wechselt zurück in den Lese-Modus und eine Erfolgsmeldung bestätigt den Vorgang.

---

### 2.1.3 Elternteile zuweisen & Schutz vor Zirkelbezügen

#### Was macht die Funktion?
Weist einer Person interaktiv Vater und Mutter zu oder korrigiert bestehende Elternzuweisungen. Eine integrierte biologische Plausibilitätsprüfung verhindert unlösbare Verwandtschaftsschleifen (z. B. dass ein Kind als Vorfahre seiner eigenen Eltern eingetragen wird).

#### Wie bediene ich sie?
1. Wählen Sie eine Person in der Tabelle oder im Stammbaum aus, sodass sich rechts das **Detail-Panel** öffnet.
2. Aktivieren Sie den Editier-Modus (**„Tabelle editieren“**).
3. Scrollen Sie im Detail-Panel zum Bereich **„Eltern bearbeiten“**.
4. Wählen Sie im Dropdown-Feld für **Vater** oder **Mutter** die passende Person aus (oder wählen Sie *„-- Keiner / Entfernen --“*).
5. Klicken Sie auf **„Eltern speichern“**.

#### Was ist das Ergebnis?
* **Regulärer Fall:** Die Eltern-Kind-Verknüpfung wird aktualisiert und alle Generations- und Henry-Codes im gesamten Stammbaum werden sofort neu berechnet.
* **Schutzfall (Zyklus erkannt):** Sollte die ausgewählte Person bereits ein Nachkomme sein, bricht das System ab und zeigt eine deutliche Warnung:  
  *„⚠️ Rekursion erkannt: Die Person ist bereits ein Vorfahre.“*  
  Ihre Datenbank bleibt vor logischen Widersprüchen geschützt.

---

### 2.1.4 Ehen, Partnerschaften und Scheidungen pflegen

#### Was macht die Funktion?
Erfasst Hochzeitsdaten, Scheidungsdaten und den formalen Scheidungsstatus für bestehende oder neue Partnerschaften.

#### Wie bediene ich sie?
1. Öffnen Sie das **Detail-Panel** der gewünschten Person im Editier-Modus.
2. Im Bereich **„Ehepartner & Familien“** finden Sie alle Partnerverbindungen.
3. Tragen Sie das **Hochzeitsdatum** oder **Scheidungsdatum** ein und setzen Sie bei Bedarf den Haken bei **„Geschieden“**.
4. Klicken Sie bei der jeweiligen Familie auf **„Ehedaten speichern“**.
5. **Neuen Partner verknüpfen:** Klicken Sie auf **„+ Partner/in verknüpfen“**, wählen Sie die Person aus der Liste und bestätigen Sie.

#### Was ist das Ergebnis?
Die Partnerschaftsdaten werden aktualisiert. Im Stammbaum-Canvas werden verheiratete Paare mit einer roten Verbindungslinie verknüpft; bei Scheidung wird das internationale genealogische Symbol `o|o` bzw. `⚮` eingeblendet.

---

### 2.1.5 Kinder zuweisen und Familienverbindungen lösen

#### Was macht die Funktion?
Ermöglicht das direkte Hinzufügen weiterer Kinder zu einer bestehenden Ehe oder das vollständige Auflösen einer Partnerschaft, ohne die Personen selbst zu löschen.

#### Wie bediene ich sie?
1. **Kind zuordnen:** Klicken Sie im Detail-Panel der Familie auf **„+ Kind zuordnen“**, wählen Sie das Kind aus der Liste und bestätigen Sie.
2. **Kind-Zuordnung lösen:** Klicken Sie neben dem Kind auf **„Zuordnung aufheben“** und bestätigen Sie die Abfrage.
3. **Eheverbindung lösen:** Klicken Sie neben der Familie auf **„Verbindung lösen“**.

#### Was ist das Ergebnis?
Beim Lösen der Ehe wird ausschließlich die Verbindung zwischen den Partnern getrennt. Beide Personen und ihre Lebensdaten bleiben vollständig in der Datenbank erhalten.

---

### 2.1.6 Revisionssichere Änderungsverfolgung

#### Was macht die Funktion?
LineageGraph führt bei jeder Neuanlage oder Bearbeitung automatisch ein lückenloses Änderungsprotokoll nach internationalem GEDCOM-Standard.

#### Wie bediene ich sie?
Dieser Vorgang läuft vollautomatisch im Hintergrund:
* Bei Neuanlage erhält jede Person eine weltweite eindeutige Identifikationsnummer (UUID).
* Bei jeder Speicherung wird der Zeitstempel der letzten Änderung (`CHAN`) sekundengenau aktualisiert.

#### Was ist das Ergebnis?
In der Tabelle und im Detail-Panel sehen Sie in der Spalte *„Letzte Änderung“* exakt, wann ein Eintrag zuletzt gepflegt wurde.

---

## 2.2 Genealogische Ordnungen & Verwandtschaftsanalyse

### 2.2.1 Stammahnen (Probanden) festlegen & Sichten wechseln

#### Was macht die Funktion?
In großen Familienbüchern gibt es oft mehrere Stammväter oder -mütter. Sie können beliebig viele Personen als sogenannte **Stammahnen** (Probanden) definieren und ihnen ein individuelles Startkürzel geben (z. B. `1`, `2`, `A` oder `Linie-Nord`).

#### Wie bediene ich sie?
1. Öffnen Sie die **„⚙️ Konfiguration“** und wechseln Sie in den Reiter **„Stammbaum Ansicht“** bzw. **„Stammahne konfigurieren“**.
2. Wählen Sie unter *„Stammahne auswählen“* die gewünschte Person aus.
3. Geben Sie im Feld *„Start-Code“* das gewünschte Kürzel ein (z. B. `1`).
4. Klicken Sie auf **„Festlegen & Berechnen“**.
5. **Ansicht umschalten:** In der oberen Menüleiste erscheinen nun Reiter für jeden definierten Stammahn sowie der Reiter *„Alle Sichten“*. Klicken Sie einfach auf den Namen, um den gesamten Stammbaum aus der Perspektive dieses Stammahnen zu betrachten.

#### Was ist das Ergebnis?
Alle Nachkommen des gewählten Stammahnen werden sofort mit den entsprechenden hierarchischen Kennungen versehen. Der interaktive Stammbaum richtet sich automatisch an diesem Ahnen aus.

---

### 2.2.2 Das Henry-Zählsystem verstehen & berechnen

#### Was macht die Funktion?
Das Henry-System ist ein weltweit bewährtes Nummerierungssystem in der Genealogie. Es weist jedem Nachkommen eine Ziffernkette zu, aus der sich die genaue Generationsabfolge und Geschwisterposition ablesen lässt:
* Der Stammahn hat den Code `1`.
* Sein erstgeborenes Kind erhält den Code `11`, das zweitgeborene `12`, das drittgeborene `13`.
* Das erste Kind von Kind `12` erhält den Code `121`.
* Ab dem 10. Kind werden Buchstaben verwendet (`A` = 10. Kind, `B` = 11. Kind usw.).

#### Wie bediene ich sie?
1. Die Berechnung erfolgt automatisch, sobald Sie einen Stammahn festlegen.
2. Wenn Sie Geburtsdaten von Kindern nachträglich korrigieren, klicken Sie in den Einstellungen auf **„Henry-Codes neu berechnen“**.

#### Was ist das Ergebnis?
Das System sortiert alle Geschwister chronologisch nach ihrem tatsächlichen Geburtsdatum und vergibt lückenlose, wohlgeformte Henry-Codes ohne störende Sonderzeichen.

---

### 2.2.3 Kürzesten Verwandtschaftspfad zwischen zwei Personen ermitteln

#### Was macht die Funktion?
Findet blitzschnell heraus, wie zwei beliebige Personen im Stammbaum miteinander verwandt oder verschwägert sind. Das System berechnet die kürzeste Kette von Eltern, Kindern und Ehepartnern.

#### Wie bediene ich sie?
1. Wählen Sie im Stammbaum oder der Tabelle die erste Person aus.
2. Öffnen Sie im Detail-Panel den Bereich **„Kürzester Pfad zu Person“** (oder nutzen Sie die Verwandtschaftssuche).
3. Tippen Sie den Namen der Zielperson in das Suchfeld ein und wählen Sie sie aus.
4. **Schieberegler „Über Ehepartner“:**
   * *Aktiviert:* Bezieht Schwägerschaften (z. B. Schwiegereltern, angeheiratete Tanten) in die Pfadsuche ein.
   * *Deaktiviert:* Sucht ausschließlich nach direkter Blutsverwandtschaft.
5. Klicken Sie auf **„Pfad anzeigen“**.

#### Was ist das Ergebnis?
Im Stammbaum-Canvas wird der gesamte Verbindungspfad zwischen beiden Personen farblich leuchtend hervorgehoben. Ein Info-Kasten listet alle Zwischenstationen der Verwandtschaftskette lückenlos auf.

---

## 2.3 Benutzeroberfläche & interaktive Ansichten

### 2.3.1 Die interaktive Datentabelle nutzen

#### Was macht die Funktion?
Bietet eine tabellarische Gesamtsicht aller Personen mit Sofortsuche, Mehrfachfiltern und individueller Spaltenanordnung.

#### Wie bediene ich sie?
1. **Suchen & Filtern:** Unter jedem Spaltenkopf befindet sich ein Filterfeld. Tippen Sie z. B. bei Nachname `"Schulte"` und bei Geburtsdatum `"18"` ein, um alle Schultes aus dem 19. Jahrhundert zu sehen.
2. **Sortieren:** Klicken Sie auf einen Spaltenkopf, um die Liste aufsteigend oder absteigend zu sortieren.
3. **Spalten anpassen:** Klicken Sie in der **„⚙️ Konfiguration“** auf den Reiter **„Tabellarische Ansicht“**. Hier können Sie per Mausklick festlegen, welche Spalten (z. B. Beruf, Religion, Taufdaten) ein- oder ausgeblendet werden sollen.

#### Was ist das Ergebnis?
Die Tabelle reagiert verzögerungsfrei auf Ihre Eingaben und filtert selbst Bestände mit zehntausenden Personen flüssig.

---

### 2.3.2 Der interaktive Stammbaum-Canvas

#### Was macht die Funktion?
Visualisiert den Stammbaum als frei bewegliche, unendliche grafische Leinwand (Infinite Canvas).

#### Wie bediene ich sie?
* **Verschieben (Pan):** Klicken Sie mit gedrückter linker Maustaste auf eine freie Fläche und ziehen Sie den Stammbaum in die gewünschte Richtung.
* **Zoomen:** Drehen Sie das Mausrad (oder nutzen Sie die schwebende Zoomleiste unten), um stufenlos zwischen 20 % und 250 % zu zoomen.
* **Äste auf- und zuklappen:** Klicken Sie auf das Ordner-Symbol an einem Personen-Knoten, um Nachkommen aus- oder einzublenden.
* **Partner- & Eltern-Cluster:** Klicken Sie auf die roten bzw. gestrichelten Badges, um Ehepartner oder Elternzweige dynamisch einzublenden.
* **Navigation:** Klicken Sie auf **„🏠 Zurück zum Stammahnen“**, um den Bildausschnitt sofort wieder auf den Ursprung zu zentrieren.

#### Was ist das Ergebnis?
Sie navigieren mühelos durch vielverzweigte Generationen, ohne die Übersicht zu verlieren.

---

### 2.3.3 Das Eintragsdetail-Panel (Inspektor)

#### Was macht die Funktion?
Bietet eine detaillierte Zusammenfassung aller verfügbaren Informationen zu einer Person und erlaubt die Navigation durch Anklicken von Verwandten.

#### Wie bediene ich sie?
1. Klicken Sie auf eine beliebige Person in der Tabelle oder im Stammbaum.
2. Das Panel öffnet sich von der rechten Bildschirmseite.
3. Klicken Sie auf einen beliebigen Namen unter *Eltern*, *Geschwister*, *Partner* oder *Kinder*.

#### Was ist das Ergebnis?
Die Ansicht wechselt augenblicklich auf die angeklickte Person. Der Stammbaum springt automatisch dorthin und zentriert den ausgewählten Eintrag.

---

### 2.3.4 Die freie Schnellabfrage (Free Query)

#### Was macht die Funktion?
Ermöglicht das sekundenschnelle Auffinden einer Person über eine Tastatur-orientierte Universalsuche, ohne dass man durch den Stammbaum scrollen muss.

#### Wie bediene ich sie?
1. Klicken Sie auf die Schaltfläche **„🧭 Freie Ansicht“** bzw. **„🔍 Neue Personenabfrage“**.
2. Füllen Sie eines oder mehrere Felder aus: *Nachname*, *Vorname*, *Geburtsjahr/Geburtsort* oder *ID*.
3. Die Trefferliste aktualisiert sich bei jedem Tastendruck.
4. Klicken Sie beim gewünschten Treffer auf **„Auswählen“**.

#### Was ist das Ergebnis?
Das Suchfenster schließt sich und der Stammbaum öffnet sich exakt an der Position der gefundenen Person.

---

### 2.3.5 Sprache umschalten (Deutsch / Englisch)

#### Was macht die Funktion?
Schaltet die gesamte Programmoberfläche inklusive aller Fachbegriffe, Tooltips und Meldungen zwischen Deutsch und Englisch um.

#### Wie bediene ich sie?
1. Öffnen Sie die **„⚙️ Konfiguration“** (Reiter *„Allgemein“*).
2. Wählen Sie unter *„Sprache / Language“* entweder **Deutsch** oder **English**.

#### Was ist das Ergebnis?
Alle Texte passen sich sofort ohne Neustart der Anwendung an.

---

## 2.4 Stammbaum Design Studio

### 2.4.1 Der Design-Modus & das hierarchische Schaubild

#### Was macht die Funktion?
Verwandelt Ihre Familiendaten in ein professionell gelayoutetes, druckreifes Stammbaum-Schaubild. Alle Personen werden in exakten Generationsebenen von unten nach oben angeordnet.

#### Wie bediene ich sie?
1. Klicken Sie in der Hauptnavigation auf **„🎨 Design Mode“**.
2. Wählen Sie den gewünschten Stammahn aus, der als Wurzel des Schaubilds dienen soll.
3. Das System berechnet automatisch ein harmonisches Layout, bei dem alle Zweige kollisionsfrei nebeneinander stehen.
4. Klicken Sie auf **„⛶ Ganzes Schaubild“**, um die gesamte Ahnentafel bildschirmfüllend einzupassen.

#### Was ist das Ergebnis?
Ein ästhetisches Diagramm mit sauber ausgerichteten Personenkarten und rechtwinkligen Verbindungslinien.

---

### 2.4.2 Geschwistergruppen, Ebenen und Leitungsbrücken

#### Was macht die Funktion?
Löst das klassische Problem unübersichtlicher Stammbäume: Sich kreuzende Linien erhalten automatische **Leitungsbrücken** (Bögen), sodass der Betrachter Abstammungslinien mühelos mit dem Auge verfolgen kann. Zudem können Geschwister flexibel gruppiert oder verschoben werden.

#### Wie bediene ich sie?
* **Ebenenabstände optimieren:** Öffnen Sie die Kachel-Optionen und aktivieren Sie *„Ebenen-Anordnung der Querlinien optimieren (Linienbrücken minimieren)“*.
* **Bogenradius einstellen:** Justieren Sie den Bogenradius der Kreuzungen nach eigenem Geschmack.
* **Gruppen anpassen:** Über Schaltflächen an den Karten können Sie Geschwistergruppen bei Bedarf auftrennen (*„✂️ Gruppe auflösen“*) oder als geschlossenen Block verschieben.

#### Was ist das Ergebnis?
Ein übersichtliches Schaubild ohne verwirrende Linienknoten.

---

### 2.4.3 Individuelle Kachel- und Zeilengestaltung

#### Was macht die Funktion?
Sie bestimmen bis ins Detail, wie die einzelnen Personenkarten im Stammbaum aussehen: Schriftgrößen, Rahmenfarben für Geschlechter, Schatteneffekte und welche Datenzeilen gedruckt werden.

#### Wie bediene ich sie?
1. Klicken Sie im Design Mode auf **„Kachel-Optionen“**.
2. **Inhalte wählen:** Bestimmen Sie für jede der 5 Datenzeilen die Anzeige (z. B. Henry-ID, vollständiger Name, Geburts- und Sterbedaten, Heiratsdatum, Partnerangaben).
3. **Formatierung:** Stellen Sie Zeilen nach Wunsch auf **Fett** oder *Kursiv*.
4. **Jahreszahlen-Schalter:** Schalten Sie mit einem Klick zwischen vollen Datumsangaben (`* 12.05.1845`) und reinen Jahreszahlen (`* 1845`) um, um Platz zu sparen.
5. In der Live-Vorschau sehen Sie die Kacheloptik in Echtzeit.

#### Was ist das Ergebnis?
Ein maßgeschneidertes Erscheinungsbild, das perfekt zu Ihrem Anlass (z. B. Familientreffen, Wandposter oder Jubiläumsbuch) passt.

---

### 2.4.4 Hintergrundbilder & Familienwappen einbinden

#### Was macht die Funktion?
Erlaubt das Hinterlegen hochauflösender Wappen, historischer Urkunden oder Schmuckgrafiken hinter dem Stammbaum.

#### Wie bediene ich sie?
1. Klicken Sie in der Werkzeugleiste des Design-Modus auf **„Hintergrundbild“**.
2. Klicken Sie auf **„Hintergrundbild hochladen...“** und wählen Sie Ihre Grafikdatei (PNG, JPG oder SVG) aus.
3. Passen Sie die **Deckkraft (Transparenz)** per Schieberegler an (empfohlen: 20 %–40 %, damit die Schrift perfekt lesbar bleibt).
4. Wählen Sie die Positionierung (z. B. *„Zentrieren“*, *„Unten mittig“* oder freies Verschieben mit der Maus).

#### Was ist das Ergebnis?
Das Wappen fügt sich harmonisch hinter den Personenkarten ein und wird dauerhaft in Ihrem Stammbaum-Projekt gespeichert.

---

### 2.4.5 Design-Zustände speichern, laden und teilen

#### Was macht die Funktion?
Sie können verschiedene Layout-Entwürfe abspeichern, jederzeit wieder aufrufen oder als eigenständige Datei exportieren, um sie mit Verwandten zu teilen.

#### Wie bediene ich sie?
* **Rückgängig (Undo):** Drücken Sie `Strg + Z` (oder klicken Sie auf *„Zurück“*), um eine versehentliche Verschiebung sofort rückgängig zu machen.
* **Stand speichern:** Klicken Sie auf **„Design speichern“**, vergeben Sie einen Namen (z. B. `Hauptstamm_Poster_A0`) und wählen Sie *„In Stammbaum speichern“*.
* **Stand laden:** Klicken Sie auf **„Design laden“** und wählen Sie einen gespeicherten Entwurf aus der Liste.
* **Als Datei teilen:** Über *„Als Datei ablegen (.json)“* exportieren Sie das Layout als transportable Datei.

#### Was ist das Ergebnis?
Ihre manuelle Layoutarbeit ist absolut sicher und Sie können gefahrlos verschiedene Designvarianten ausprobieren.

---

## 2.5 GEDCOM-Import & 3-Wege-Datenabgleich

### 2.5.1 GEDCOM-Dateien importieren: Neues Projekt vs. Ersetzen

#### Was macht die Funktion?
Importiert Familiendaten aus anderen Genealogie-Programmen (z. B. Ahnenblatt, Ancestry, MyHeritage, FamilySearch) über das universelle GEDCOM-Format.

#### Wie bediene ich sie?
1. Klicken Sie oben rechts auf **„GEDCOM-Datei importieren“**.
2. Wählen Sie Ihre `.ged`-Datei auf der Festplatte aus.
3. Der Import-Assistent fragt Sie nach dem gewünschten Modus:
   * **Neues Projekt anlegen (eigener Stammbaum):** Ihr aktueller Stammbaum bleibt unangetastet; es wird ein komplett neues Projekt mit dem Dateinamen erzeugt.
   * **Aktiven Stammbaum komplett ersetzen:** Löscht alle Einträge im aktuellen Baum und lädt die neue Datei ein (nur empfohlen bei vollständigen Neuübernahmen).
4. Bestätigen Sie die Auswahl.

#### Was ist das Ergebnis?
Alle Personen, Familien, Eltern-Kind-Verknüpfungen, Ereignisse und Notizen werden vollständig eingelesen.

---

### 2.5.2 Der intelligente Abgleich-Assistent (Staging & Erkennung)

#### Was macht die Funktion?
Wenn Sie bereits Daten erfasst haben und eine aktualisierte Datei eines Verwandten erhalten, analysiert der Assistent vor dem Import alle Unterschiede, ohne Ihre Datenbank zu verändern.

#### Wie bediene ich sie?
1. Wählen Sie im Import-Assistenten den Modus **„In bestehenden Stammbaum einpflegen (Update / Merge)“**.
2. Klicken Sie auf **„Abgleich & Vorschau laden...“**.
3. Das System vergleicht Personen anhand von Kennungen, Namen und Lebensdaten und berechnet eine prozentuale Übereinstimmungsquote (Match-Confidence).

#### Was ist das Ergebnis?
Sie erhalten eine übersichtliche Statistik:
* Wie viele Personen wurden zweifelsfrei wiedererkannt (*Gemappt*).
* Wie viele Personen sind komplett neu (*Neu*).
* An wie vielen Stellen gibt es abweichende Angaben (*Konflikte*).

---

### 2.5.3 Differentieller 3-Wege-Merge mit Konfliktlösung

#### Was macht die Funktion?
Sie haben die volle Kontrolle über jedes einzelne Datenfeld: Weicht ein Geburtsdatum oder Sterbeort ab, entscheiden Sie per Mausklick, ob Ihr bisheriger Datenbankwert oder die Angabe aus der Importdatei übernommen werden soll.

#### Wie bediene ich sie?
1. Nutzen Sie die Filter-Reiter: *„Nur mit Konflikten“* oder *„Neue Personen“*.
2. In der Vergleichstabelle sehen Sie links Ihren aktuellen Datenbankwert und rechts den Wert aus der Datei.
3. Schalten Sie den Auswahl-Schalter pro Feld einfach auf **„DB“** oder **„Import“**.
4. Nutzen Sie Sammelknöpfe wie *„Alle Importwerte übernehmen“*, um den Vorgang zu beschleunigen.
5. Bei neuen Personen können Sie einzelne Personen abwählen, falls diese nicht importiert werden sollen.
6. Klicken Sie auf **„Zusammenführung jetzt ausführen“**.

#### Was ist das Ergebnis?
Die Zusammenführung wird atomar ausgeführt. Eine Erfolgsübersicht zeigt Ihnen genau, wie viele Personen aktualisiert, neu angelegt und wie viele bestehende Elternverbindungen geschützt wurden.

---

## 2.6 Export-Center & Chronik-Erstellung

### 2.6.1 GEDCOM-Teilmengen exportieren

#### Was macht die Funktion?
Erzeugt standardkonforme GEDCOM-Dateien zur Weitergabe an andere Forscher – wahlweise als Gesamtexport oder als gezielter Teilausschnitt.

#### Wie bediene ich sie?
1. Wechseln Sie in das Modul **„📦 Export“** und wählen Sie den Reiter **„GEDCOM-Teilbaum“**.
2. Wählen Sie den gewünschten Umfang:
   * **Gesamter Stammbaum:** Exportiert alle Daten.
   * **Alle Nachkommen eines Eintrags:** Exportiert eine Person samt Nachkommenschaft (optional inklusive Partner).
   * **Alle Vorfahren eines Eintrags:** Exportiert die reine Ahnenlinie einer Person nach oben.
   * **Ausgewählte Personenliste:** Ermöglicht das Zusammenstellen einer individuellen Personenliste.
3. Prüfen Sie die Export-Statistik und klicken Sie auf **„GEDCOM-Datei exportieren...“**.

#### Was ist das Ergebnis?
Eine saubere, normierte `.ged`-Datei wird an Ihrem Wunschort abgespeichert.

---

### 2.6.2 Tabellen-Export als CSV für Excel

#### Was macht die Funktion?
Exportiert Ihre Personendaten in eine Tabellendatei, die sich direkt und ohne Zeichensatzfehler in Microsoft Excel, Apple Numbers oder LibreOffice öffnen lässt.

#### Wie bediene ich sie?
1. Wählen Sie im Export-Modul den Reiter **„Tabellen-Export (CSV)“**.
2. Wählen Sie das Trennzeichen: Für den deutschsprachigen Raum wird **Semikolon ( ; )** empfohlen.
3. Lassen Sie den Haken bei **„UTF-8 BOM einschließen“** aktiviert, damit Umlaute in Excel sofort fehlerfrei dargestellt werden.
4. Prüfen Sie die Vorschau und klicken Sie auf **„CSV-Datei exportieren...“**.

#### Was ist das Ergebnis?
Eine formatierte `.csv`-Datei mit aufgelösten Klarnamen für Eltern und Partner wird erzeugt.

---

### 2.6.3 Interaktive HTML-Chronik für den Webbrowser

#### Was macht die Funktion?
Erzeugt eine eigenständige, interaktive HTML-Datei, die Sie per E-Mail oder USB-Stick an Ihre Familie weitergeben können. Empfänger benötigen keinerlei Software – ein Doppelklick öffnet den Stammbaum in jedem modernen Webbrowser.

#### Wie bediene ich sie?
1. Wählen Sie im Export-Modul den Reiter **„Interaktiver HTML-Export“**.
2. Wählen Sie den gewünschten Stammahn aus.
3. Vergeben Sie nach Wunsch einen zweisprachigen Dokumenttitel (Deutsch / Englisch).
4. Testen Sie die interaktive Browser-Vorschau direkt im Fenster (inklusive Umschaltung zwischen Desktop- und Smartphone-Ansicht).
5. Klicken Sie auf **„Als HTML-Datei speichern“**.

#### Was ist das Ergebnis?
Eine einzige, in sich geschlossene `.html`-Datei mit integrierter Suchfunktion, ausklappbaren Stammbäumen und ansprechendem Design.

---

### 2.6.4 Stammbaum-Bilder exportieren (PNG / JPG / SVG)

#### Was macht die Funktion?
Exportiert Ihren gestalteten Design-Stammbaum als gestochen scharfe Bilddatei für den Posterdruck oder als verlustfreie Vektorgrafik.

#### Wie bediene ich sie?
1. Wählen Sie den Reiter **„Design Mode Bild (PNG / JPG / SVG)“**.
2. Wählen Sie Ihren zuvor im Design-Modus gespeicherten Zustand aus.
3. Legen Sie fest, ob das **Hintergrundbild** und das **Ebenenraster** mitgedruckt werden sollen.
4. Wählen Sie das Format:
   * **PNG:** Mit transparentem Hintergrund (ideal für Collagen).
   * **JPG:** Mit klassisch weißem Hintergrund.
   * **SVG:** Reine Vektordatei (beliebig vergrößerbar ohne Qualitätsverlust).
5. Wählen Sie die Auflösung: **2x (Druckqualität / High-Res)** liefert gestochen scharfe Ausdrucke für große Wandplakate.
6. Klicken Sie auf **„Bilddatei exportieren“**.

#### Was ist das Ergebnis?
Eine druckreife Bilddatei in brillanter Auflösung.

---

### 2.6.5 Druckfertige Buchchroniken mit LaTeX erzeugen

#### Was macht die Funktion?
Für höchste buchbinderische Ansprüche: Generiert mehrseitige, gesetzte Buchchroniken als PDF-Dokumente mit automatischer Kapitelaufteilung, Ahnentafeln und Generationeneinrückung.

#### Wie bediene ich sie?
1. Wählen Sie den Reiter **„Druckformat (LaTeX)“**.
2. Wählen Sie Modus und Richtung (*„Nachkommenliste“* oder *„Ahnenliste“*) sowie die gewünschte Generationstiefe.
3. Über **„Erscheinungsbild & Textmaske anpassen...“** können Sie Textelemente, genealogische Zeichen (`*`, `†`, `⚭`) und Schriftstile individuell festlegen.
4. Schalten Sie bei großen Werken die Option *„Stämme erkennen & in eigene Dateien aufteilen“* ein.
5. Klicken Sie auf **„LaTeX-Datei speichern“** (oder exportieren Sie das fertige Gesamtbündel).

#### Was ist das Ergebnis?
Ein professioneller Buchdruck-Satz, der über gängige PDF-Compiler direkt in ein edles Familienbuch gedruckt werden kann.

---

# Kapitel 3: Praktische Tipps, Fehlersicherheiten & Best Practices

## 3.1 Das zweistufige Sicherheitskonzept gegen Datenverlust
Das versehentliche Löschen eines Stammbaums kann die Forschungsarbeit vieler Jahre vernichten. LineageGraph schützt Sie daher dreifach:
1. **Zwei getrennte Hürden:** Ein Stammbaum wird niemals mit einem einzigen Klick entfernt. Sie müssen den Löschwunsch in zwei aufeinanderfolgenden Fenstern ausdrücklich bestätigen.
2. **Abbrechen hat Vorrang (Autofokus):** In beiden Fenstern ist der Button **„Abbrechen“** farblich hervorgehoben und besitzt den Tastaturfokus. Wenn Sie aus Schreck oder Versehen die `Enter`- oder `Leertaste` drücken, bricht der Vorgang sofort ab.
3. **Isolierte Speicherung:** Jeder Stammbaum liegt in einer separaten Datei. Selbst wenn Sie einen Stammbaum löschen, bleiben alle anderen Stammbäume absolut unberührt.

---

## 3.2 Warum der Schutz vor Verwandtschaftsschleifen unverzichtbar ist
In der manuellen Genealogie passiert schnell ein Tippfehler: Aus Versehen wählt man beim Urgroßvater dessen eigenen Enkel als Vater aus.
* **Die Gefahr:** Ohne Schutz geraten Stammbaum-Programme bei solchen „Zeitschleifen“ in Endlosberechnungen und stürzen ab.
* **Die Lösung von LineageGraph:** Bevor eine Elternzuweisung gespeichert wird, prüft das Programm im Hintergrund blitzschnell den gesamten Vorfahrenbaum. Wird erkannt, dass die Zielperson bereits ein biologischer Nachkomme ist, wird das Speichern blockiert und eine verständliche Fehlermeldung ausgegeben.

---

## 3.3 Der sichere Umgang mit Personenabgleichen beim Merge
Wenn Sie neue Daten in einen bestehenden Stammbaum einpflegen, beachten Sie folgende Best Practices:
* **Vorab sichern:** Speichern Sie vor einem großen Merge zur Sicherheit Ihren Stammbaum als GEDCOM-Datei ab.
* **Konfliktfilter nutzen:** Lassen Sie sich im Import-Assistenten zuerst die Zeilen mit dem Status *„Nur mit Konflikten“* anzeigen. Prüfen Sie bei abweichenden Geburts- oder Sterbedaten genau, welche Quelle glaubwürdiger ist.
* **Ergänzungen begrüßen:** Bei Datenfeldern, die in Ihrer Datenbank bisher leer waren, übernimmt das System automatisch die neuen Angaben aus der Importdatei – Sie gewinnen wertvolle Informationen hinzu, ohne Bestehendes zu gefährden.

---

## 3.4 Empfohlene Arbeitsabläufe für die Familienforschung

1. **Strukturierter Beginn:**
   * Legen Sie für jede Hauptlinie Ihrer Familie ein eigenes Projekt an.
   * Definieren Sie frühzeitig die ältesten bekannten Spitzenahnen als **Stammahnen**, um die Vorteile der automatischen Henry-Nummerierung voll auszuschöpfen.
2. **Effiziente Datenerfassung:**
   * Nutzen Sie für die rasche Erfassung von Urkunden die **Tabellenansicht** mit dem **Editier-Modus**.
   * Nutzen Sie für die visuelle Kontrolle und das Aufspüren von Forschungslücken den **interaktiven Stammbaum-Canvas**.
3. **Ergebnisse präsentieren:**
   * Für den schnellen Austausch in der Familie: Erzeugen Sie eine **Interaktive HTML-Chronik** – Ihre Verwandten werden begeistert sein, wie einfach sie auf dem Smartphone oder PC durch die Familiengeschichte stöbern können.
   * Für runde Geburtstage oder Familientreffen: Gestalten Sie im **Design Studio** ein Wappen-Poster und exportieren Sie es als hochauflösendes **PNG** oder **SVG** für den Copyshop.

