use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use std::fs::File;
use std::io::{BufRead, BufReader};
use std::path::Path;

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct StagedPerson {
    pub xref: String,
    pub given_name: Option<String>,
    pub surname: Option<String>,
    pub sex: String,
    pub birth_date: Option<String>,
    pub birth_place: Option<String>,
    pub death_date: Option<String>,
    pub death_place: Option<String>,
    pub uid: Option<String>,
    pub json_data: serde_json::Value,
    pub famc: Option<String>,
    pub fams: Vec<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct StagedFamily {
    pub xref: String,
    pub husband_xref: Option<String>,
    pub wife_xref: Option<String>,
    pub marriage_date: Option<String>,
    pub divorce_date: Option<String>,
    pub is_divorced: bool,
    pub json_data: serde_json::Value,
    pub children_xrefs: Vec<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct StagedGedcomData {
    pub individuals: Vec<StagedPerson>,
    pub families: Vec<StagedFamily>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct FieldDiff {
    pub field_name: String,
    pub db_value: Option<String>,
    pub staged_value: Option<String>,
    pub diff_type: String, // "identical", "addition", "conflict"
    pub chosen_source: String, // "db" or "import"
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct PersonDiffItem {
    pub staged_xref: String,
    pub db_person_id: String,
    pub match_confidence: u32,
    pub match_reason: String,
    pub db_label: String,
    pub staged_label: String,
    pub has_conflicts: bool,
    pub has_additions: bool,
    pub fields: HashMap<String, FieldDiff>,
    pub default_extra_action: String, // "overwrite", "append", "db"
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct NewPersonItem {
    pub staged_xref: String,
    pub label: String,
    pub given_name: Option<String>,
    pub surname: Option<String>,
    pub birth_date: Option<String>,
    pub death_date: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct GedcomMergePlan {
    pub file_path: String,
    pub total_staged_persons: usize,
    pub total_staged_families: usize,
    pub mapped_persons: Vec<PersonDiffItem>,
    pub new_persons: Vec<NewPersonItem>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct PersonResolution {
    pub staged_xref: String,
    pub target_db_id: String,
    pub field_choices: HashMap<String, String>, // field_name -> "db" or "import"
    pub extra_action: String,                   // "overwrite", "append", "db"
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct GedcomMergeResolution {
    pub file_path: String,
    pub mappings: Vec<PersonResolution>,
    pub new_person_xrefs: Vec<String>,
    pub ignored_xrefs: Vec<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct MergeResultStats {
    pub updated_persons_count: usize,
    pub new_persons_count: usize,
    pub new_families_count: usize,
    pub new_parent_child_count: usize,
    pub preserved_parents_count: usize,
}

struct RawLine {
    level: u8,
    tag: String,
    value: Option<String>,
}

struct RawRecord {
    xref: String,
    tag: String,
    lines: Vec<RawLine>,
}

/// Parst eine GEDCOM-Datei vollständig in den Arbeitsspeicher
pub fn parse_gedcom_in_memory(path: &Path) -> Result<StagedGedcomData, String> {
    let file = File::open(path).map_err(|e| format!("Fehler beim Öffnen: {}", e))?;
    let reader = BufReader::new(file);

    let mut records: Vec<RawRecord> = Vec::new();
    let mut current_record: Option<RawRecord> = None;

    for line_result in reader.lines() {
        let line = match line_result {
            Ok(l) => l,
            Err(_) => continue,
        };
        let trimmed = line.trim();
        if trimmed.is_empty() {
            continue;
        }

        let parts: Vec<&str> = trimmed.splitn(3, ' ').collect();
        if parts.is_empty() {
            continue;
        }

        let level = parts[0].parse::<u8>().unwrap_or(0);

        if level == 0 {
            if let Some(rec) = current_record.take() {
                records.push(rec);
            }
            if parts.len() >= 3 && parts[1].starts_with('@') && parts[1].ends_with('@') {
                current_record = Some(RawRecord {
                    xref: parts[1].replace('@', ""),
                    tag: parts[2].to_string(),
                    lines: vec![],
                });
            } else if parts.len() >= 2 {
                current_record = Some(RawRecord {
                    xref: "".to_string(),
                    tag: parts[1].to_string(),
                    lines: vec![],
                });
            }
        } else if let Some(ref mut rec) = current_record {
            let tag = parts.get(1).unwrap_or(&"").to_string();
            let value = if parts.len() > 2 {
                Some(parts[2..].join(" "))
            } else {
                None
            };
            rec.lines.push(RawLine { level, tag, value });
        }
    }
    if let Some(rec) = current_record {
        records.push(rec);
    }

    let mut individuals = Vec::new();
    let mut families = Vec::new();

    for rec in records {
        if rec.tag == "INDI" && !rec.xref.is_empty() {
            let xref = rec.xref.clone();
            let mut given_name = None;
            let mut surname = None;
            let mut sex = "U".to_string();
            let mut birth_date = None;
            let mut birth_place = None;
            let mut death_date = None;
            let mut death_place = None;
            let mut famc = None;
            let mut fams = Vec::new();

            let mut root_obj = serde_json::Map::new();
            let mut active_l1_tag = String::new();
            let mut active_l1_map = serde_json::Map::new();

            for line in &rec.lines {
                if line.level == 1 {
                    if !active_l1_tag.is_empty() {
                        root_obj.insert(
                            active_l1_tag.clone(),
                            serde_json::Value::Object(active_l1_map),
                        );
                        active_l1_map = serde_json::Map::new();
                    }
                    active_l1_tag = line.tag.clone();

                    if line.tag == "SEX" {
                        if let Some(v) = &line.value {
                            sex = v.trim().to_string();
                        }
                    } else if line.tag == "FAMC" {
                        if let Some(v) = &line.value {
                            famc = Some(v.replace('@', "").trim().to_string());
                        }
                    } else if line.tag == "FAMS" {
                        if let Some(v) = &line.value {
                            fams.push(v.replace('@', "").trim().to_string());
                        }
                    } else if line.tag == "NAME" {
                        if let Some(v) = &line.value {
                            let n_parts: Vec<&str> = v.split('/').collect();
                            if !n_parts.is_empty() && !n_parts[0].trim().is_empty() {
                                given_name = Some(n_parts[0].trim().to_string());
                            }
                            if n_parts.len() > 1 && !n_parts[1].trim().is_empty() {
                                surname = Some(n_parts[1].trim().to_string());
                            }
                        }
                    }

                    if let Some(v) = &line.value {
                        active_l1_map
                            .insert("_val".to_string(), serde_json::Value::String(v.clone()));
                    }
                } else if line.level >= 2 {
                    if let Some(v) = &line.value {
                        active_l1_map.insert(line.tag.clone(), serde_json::Value::String(v.clone()));
                    }
                    if active_l1_tag == "NAME" {
                        if line.tag == "GIVN" && given_name.is_none() {
                            given_name = line.value.clone();
                        }
                        if line.tag == "SURN" && surname.is_none() {
                            surname = line.value.clone();
                        }
                    } else if active_l1_tag == "BIRT" {
                        if line.tag == "DATE" {
                            birth_date = line.value.clone();
                        }
                        if line.tag == "PLAC" {
                            birth_place = line.value.clone();
                        }
                    } else if active_l1_tag == "DEAT" {
                        if line.tag == "DATE" {
                            death_date = line.value.clone();
                        }
                        if line.tag == "PLAC" {
                            death_place = line.value.clone();
                        }
                    }
                }
            }
            if !active_l1_tag.is_empty() {
                root_obj.insert(active_l1_tag, serde_json::Value::Object(active_l1_map));
            }

            let uid = root_obj
                .get("_UID")
                .and_then(|v| v.get("_val"))
                .and_then(|s| s.as_str())
                .map(|s| s.trim().to_string());

            individuals.push(StagedPerson {
                xref,
                given_name,
                surname,
                sex,
                birth_date,
                birth_place,
                death_date,
                death_place,
                uid,
                json_data: serde_json::Value::Object(root_obj),
                famc,
                fams,
            });
        } else if rec.tag == "FAM" && !rec.xref.is_empty() {
            let xref = rec.xref.clone();
            let mut husband_xref = None;
            let mut wife_xref = None;
            let mut marriage_date = None;
            let mut divorce_date = None;
            let mut is_divorced = false;
            let mut children_xrefs = Vec::new();

            let mut root_obj = serde_json::Map::new();
            let mut active_l1_tag = String::new();
            let mut active_l1_map = serde_json::Map::new();

            for line in &rec.lines {
                if line.level == 1 {
                    if !active_l1_tag.is_empty() {
                        root_obj.insert(
                            active_l1_tag.clone(),
                            serde_json::Value::Object(active_l1_map),
                        );
                        active_l1_map = serde_json::Map::new();
                    }
                    active_l1_tag = line.tag.clone();

                    if line.tag == "HUSB" {
                        husband_xref =
                            line.value.as_ref().map(|s| s.replace('@', "").trim().to_string());
                    } else if line.tag == "WIFE" {
                        wife_xref =
                            line.value.as_ref().map(|s| s.replace('@', "").trim().to_string());
                    } else if line.tag == "CHIL" {
                        if let Some(v) = &line.value {
                            let cid = v.replace('@', "").trim().to_string();
                            if !cid.is_empty() {
                                children_xrefs.push(cid);
                            }
                        }
                    } else if line.tag == "DIV" {
                        is_divorced = true;
                    }

                    if let Some(v) = &line.value {
                        active_l1_map
                            .insert("_val".to_string(), serde_json::Value::String(v.clone()));
                    }
                } else if line.level >= 2 {
                    if let Some(v) = &line.value {
                        active_l1_map.insert(line.tag.clone(), serde_json::Value::String(v.clone()));
                    }
                    if active_l1_tag == "MARR" && line.tag == "DATE" {
                        marriage_date = line.value.clone();
                    }
                    if active_l1_tag == "DIV" && line.tag == "DATE" {
                        divorce_date = line.value.clone();
                        is_divorced = true;
                    }
                }
            }
            if !active_l1_tag.is_empty() {
                root_obj.insert(active_l1_tag, serde_json::Value::Object(active_l1_map));
            }

            families.push(StagedFamily {
                xref,
                husband_xref,
                wife_xref,
                marriage_date,
                divorce_date,
                is_divorced,
                json_data: serde_json::Value::Object(root_obj),
                children_xrefs,
            });
        }
    }

    Ok(StagedGedcomData {
        individuals,
        families,
    })
}

#[derive(Debug, Clone)]
struct DbPersonSnapshot {
    id: String,
    xref_id: String,
    given_name: Option<String>,
    surname: Option<String>,
    sex: Option<String>,
    birth_date: Option<String>,
    birth_place: Option<String>,
    death_date: Option<String>,
    death_place: Option<String>,
    uid: Option<String>,
}

fn load_db_persons(conn: &Connection) -> Result<Vec<DbPersonSnapshot>, String> {
    let mut stmt = conn
        .prepare(
            "SELECT id, xref_id, given_name, surname, sex, birth_date, birth_place, death_date, death_place, json_data 
             FROM individuals",
        )
        .map_err(|e| e.to_string())?;

    let iter = stmt
        .query_map([], |r| {
            let json_str: String = r.get(9)?;
            let json_val: serde_json::Value =
                serde_json::from_str(&json_str).unwrap_or(serde_json::json!({}));
            let uid = json_val
                .get("_UID")
                .and_then(|v| v.get("_val"))
                .and_then(|s| s.as_str())
                .map(|s| s.trim().to_string());

            Ok(DbPersonSnapshot {
                id: r.get(0)?,
                xref_id: r.get(1)?,
                given_name: r.get(2)?,
                surname: r.get(3)?,
                sex: r.get(4)?,
                birth_date: r.get(5)?,
                birth_place: r.get(6)?,
                death_date: r.get(7)?,
                death_place: r.get(8)?,
                uid,
            })
        })
        .map_err(|e| e.to_string())?;

    let mut out = Vec::new();
    for p in iter {
        out.push(p.map_err(|e| e.to_string())?);
    }
    Ok(out)
}

/// Hilfsfunktion: Prüft, ob Vornamen eine Teilübereinstimmung besitzen (Token-basiert)
fn check_given_name_partial_match(a: &str, b: &str) -> bool {
    let tokens_a: HashSet<String> = a
        .split(|c: char| c.is_whitespace() || c == '-' || c == ',')
        .map(|s| s.trim().to_lowercase())
        .filter(|s| s.len() >= 2)
        .collect();

    let tokens_b: HashSet<String> = b
        .split(|c: char| c.is_whitespace() || c == '-' || c == ',')
        .map(|s| s.trim().to_lowercase())
        .filter(|s| s.len() >= 2)
        .collect();

    !tokens_a.is_disjoint(&tokens_b)
}

/// Extrahiert eine 4-stellige Jahreszahl aus einem Datums-String
fn extract_year(date_str: &str) -> Option<i32> {
    for part in date_str.split_whitespace() {
        if part.len() == 4 && part.chars().all(|c| c.is_ascii_digit()) {
            if let Ok(y) = part.parse::<i32>() {
                return Some(y);
            }
        }
    }
    None
}

/// Analysiert den Abgleich und erzeugt den Merge-Plan mit Diff
pub fn analyze_gedcom_merge(
    conn: &Connection,
    file_path: &str,
    staged: &StagedGedcomData,
) -> Result<GedcomMergePlan, String> {
    let db_persons = load_db_persons(conn)?;

    // Indizes für schnelles Matching
    let mut db_by_uid: HashMap<String, usize> = HashMap::new();
    let mut db_by_xref: HashMap<String, usize> = HashMap::new();
    let mut db_by_id: HashMap<String, usize> = HashMap::new();

    for (idx, p) in db_persons.iter().enumerate() {
        if let Some(ref u) = p.uid {
            if !u.is_empty() {
                db_by_uid.insert(u.clone(), idx);
            }
        }
        let clean_xref = p.xref_id.replace('@', "").trim().to_lowercase();
        if !clean_xref.is_empty() {
            db_by_xref.insert(clean_xref, idx);
        }
        db_by_id.insert(p.id.to_lowercase(), idx);
    }

    let mut mapped_persons = Vec::new();
    let mut new_persons = Vec::new();
    let mut used_db_indices: HashSet<usize> = HashSet::new();

    for staged_p in &staged.individuals {
        let mut best_match: Option<(usize, u32, &'static str)> = None;

        // 1. Stufe: _UID (100% Match)
        if let Some(ref u) = staged_p.uid {
            if let Some(&idx) = db_by_uid.get(u) {
                best_match = Some((idx, 100, "_UID (Eindeutige GEDCOM-Identifikation)"));
            }
        }

        // 2. Stufe: XREF-ID Match (~90%)
        if best_match.is_none() {
            let clean_staged_xref = staged_p.xref.replace('@', "").trim().to_lowercase();
            if let Some(&idx) = db_by_xref.get(&clean_staged_xref).or_else(|| db_by_id.get(&clean_staged_xref)) {
                if !used_db_indices.contains(&idx) {
                    best_match = Some((idx, 90, "XREF-ID Übereinstimmung"));
                }
            }
        }

        // 3. Stufe: Name & Lebensdaten Matching
        if best_match.is_none() {
            let staged_sur = staged_p.surname.as_deref().unwrap_or("").trim().to_lowercase();
            let staged_giv = staged_p.given_name.as_deref().unwrap_or("").trim();
            let staged_b_year = staged_p.birth_date.as_deref().and_then(extract_year);
            let staged_d_year = staged_p.death_date.as_deref().and_then(extract_year);

            if !staged_sur.is_empty() {
                let mut candidate_match: Option<(usize, u32, &'static str)> = None;

                for (idx, db_p) in db_persons.iter().enumerate() {
                    if used_db_indices.contains(&idx) {
                        continue;
                    }
                    let db_sur = db_p.surname.as_deref().unwrap_or("").trim().to_lowercase();
                    if db_sur != staged_sur {
                        continue;
                    }

                    let db_giv = db_p.given_name.as_deref().unwrap_or("").trim();
                    let giv_exact = !staged_giv.is_empty() && staged_giv.eq_ignore_ascii_case(db_giv);
                    let giv_partial = !staged_giv.is_empty()
                        && !db_giv.is_empty()
                        && check_given_name_partial_match(staged_giv, db_giv);

                    let db_b_year = db_p.birth_date.as_deref().and_then(extract_year);
                    let db_d_year = db_p.death_date.as_deref().and_then(extract_year);

                    let b_year_match = staged_b_year.is_some() && staged_b_year == db_b_year;
                    let d_year_match = staged_d_year.is_some() && staged_d_year == db_d_year;

                    if giv_exact && (b_year_match || d_year_match) {
                        candidate_match = Some((idx, 85, "Name und Lebensdaten stimmen überein"));
                        break;
                    } else if giv_exact && staged_b_year.is_none() && db_b_year.is_none() {
                        if candidate_match.as_ref().map_or(0, |m| m.1) < 80 {
                            candidate_match = Some((idx, 80, "Name stimmt exakt überein (ohne Lebensdaten)"));
                        }
                    } else if giv_partial && (b_year_match || d_year_match) {
                        if candidate_match.as_ref().map_or(0, |m| m.1) < 70 {
                            candidate_match = Some((idx, 70, "Teil-Vorname und Lebensdaten stimmen überein"));
                        }
                    }
                }

                if let Some(c) = candidate_match {
                    best_match = Some(c);
                }
            }
        }

        // Ergebnis zuordnen
        if let Some((idx, confidence, reason)) = best_match {
            used_db_indices.insert(idx);
            let db_p = &db_persons[idx];

            let db_label = format!(
                "[{}] {}, {} (*{})",
                db_p.id,
                db_p.surname.as_deref().unwrap_or("N.N."),
                db_p.given_name.as_deref().unwrap_or("N.N."),
                db_p.birth_date.as_deref().unwrap_or("?")
            );
            let staged_label = format!(
                "[{}] {}, {} (*{})",
                staged_p.xref,
                staged_p.surname.as_deref().unwrap_or("N.N."),
                staged_p.given_name.as_deref().unwrap_or("N.N."),
                staged_p.birth_date.as_deref().unwrap_or("?")
            );

            // Diff berechnen
            let mut fields = HashMap::new();
            let mut has_conflicts = false;
            let mut has_additions = false;

            let field_defs = [
                ("given_name", db_p.given_name.as_deref(), staged_p.given_name.as_deref()),
                ("surname", db_p.surname.as_deref(), staged_p.surname.as_deref()),
                ("sex", db_p.sex.as_deref(), Some(staged_p.sex.as_str())),
                ("birth_date", db_p.birth_date.as_deref(), staged_p.birth_date.as_deref()),
                ("birth_place", db_p.birth_place.as_deref(), staged_p.birth_place.as_deref()),
                ("death_date", db_p.death_date.as_deref(), staged_p.death_date.as_deref()),
                ("death_place", db_p.death_place.as_deref(), staged_p.death_place.as_deref()),
            ];

            for (fname, db_val_opt, st_val_opt) in field_defs {
                let db_trimmed = db_val_opt.map(|s| s.trim()).filter(|s| !s.is_empty());
                let st_trimmed = st_val_opt.map(|s| s.trim()).filter(|s| !s.is_empty());

                let (diff_type, chosen_source) = match (db_trimmed, st_trimmed) {
                    (None, None) => ("identical", "db"),
                    (Some(a), Some(b)) if a == b => ("identical", "db"),
                    (None, Some(_)) => {
                        has_additions = true;
                        ("addition", "import") // Ergänzung: standardmäßig Import
                    }
                    (Some(_), None) => ("identical", "db"), // DB-Wert behalten
                    (Some(_), Some(_)) => {
                        has_conflicts = true;
                        ("conflict", "db") // Konflikt: Standardmäßig DB (Datenschutz)
                    }
                };

                fields.insert(
                    fname.to_string(),
                    FieldDiff {
                        field_name: fname.to_string(),
                        db_value: db_trimmed.map(|s| s.to_string()),
                        staged_value: st_trimmed.map(|s| s.to_string()),
                        diff_type: diff_type.to_string(),
                        chosen_source: chosen_source.to_string(),
                    },
                );
            }

            mapped_persons.push(PersonDiffItem {
                staged_xref: staged_p.xref.clone(),
                db_person_id: db_p.id.clone(),
                match_confidence: confidence,
                match_reason: reason.to_string(),
                db_label,
                staged_label,
                has_conflicts,
                has_additions,
                fields,
                default_extra_action: "overwrite".to_string(),
            });
        } else {
            let label = format!(
                "[{}] {}, {} (*{})",
                staged_p.xref,
                staged_p.surname.as_deref().unwrap_or("N.N."),
                staged_p.given_name.as_deref().unwrap_or("N.N."),
                staged_p.birth_date.as_deref().unwrap_or("?")
            );
            new_persons.push(NewPersonItem {
                staged_xref: staged_p.xref.clone(),
                label,
                given_name: staged_p.given_name.clone(),
                surname: staged_p.surname.clone(),
                birth_date: staged_p.birth_date.clone(),
                death_date: staged_p.death_date.clone(),
            });
        }
    }

    Ok(GedcomMergePlan {
        file_path: file_path.to_string(),
        total_staged_persons: staged.individuals.len(),
        total_staged_families: staged.families.len(),
        mapped_persons,
        new_persons,
    })
}

/// Führt den Merge-Prozess innerhalb einer Transaktion aus
pub fn execute_gedcom_merge(
    conn: &mut Connection,
    staged: &StagedGedcomData,
    resolution: &GedcomMergeResolution,
) -> Result<MergeResultStats, String> {
    let tx = conn.transaction().map_err(|e| e.to_string())?;

    let staged_persons_by_xref: HashMap<String, &StagedPerson> = staged
        .individuals
        .iter()
        .map(|p| (p.xref.clone(), p))
        .collect();

    let mut id_map: HashMap<String, String> = HashMap::new(); // staged_xref -> db_person_id
    let mut updated_persons_count = 0;
    let mut new_persons_count = 0;
    let mut preserved_parents_count = 0;

    let now_chan = crate::current_gedcom_chan();

    // 1. Gemappte Personen aktualisieren
    for m in &resolution.mappings {
        let staged_p = match staged_persons_by_xref.get(&m.staged_xref) {
            Some(p) => *p,
            None => continue,
        };

        id_map.insert(m.staged_xref.clone(), m.target_db_id.clone());

        // Bestehende DB-Person laden
        let mut curr_stmt = tx
            .prepare(
                "SELECT given_name, surname, sex, birth_date, birth_place, death_date, death_place, json_data 
                 FROM individuals WHERE id = ?1",
            )
            .map_err(|e| e.to_string())?;

        let mut curr_row = curr_stmt
            .query([&m.target_db_id])
            .map_err(|e| e.to_string())?;

        let row = match curr_row.next().map_err(|e| e.to_string())? {
            Some(r) => r,
            None => continue, // Nicht gefunden
        };

        let db_given: Option<String> = row.get(0).ok();
        let db_sur: Option<String> = row.get(1).ok();
        let db_sex: Option<String> = row.get(2).ok();
        let db_bdate: Option<String> = row.get(3).ok();
        let db_bplace: Option<String> = row.get(4).ok();
        let db_ddate: Option<String> = row.get(5).ok();
        let db_dplace: Option<String> = row.get(6).ok();
        let db_json_str: String = row.get(7).unwrap_or_else(|_| "{}".to_string());
        let mut db_json: serde_json::Value =
            serde_json::from_str(&db_json_str).unwrap_or(serde_json::json!({}));

        // Werte gemäß Benutzerauswahl wählen
        let pick_str = |field_name: &str, db_val: Option<String>, st_val: Option<String>| -> Option<String> {
            let choice = m.field_choices.get(field_name).map(|s| s.as_str()).unwrap_or("db");
            if choice == "import" {
                st_val
            } else {
                db_val
            }
        };

        let new_given = pick_str("given_name", db_given, staged_p.given_name.clone());
        let new_sur = pick_str("surname", db_sur, staged_p.surname.clone());
        let new_sex = pick_str("sex", db_sex, Some(staged_p.sex.clone())).unwrap_or_else(|| "U".to_string());
        let new_bdate = pick_str("birth_date", db_bdate, staged_p.birth_date.clone());
        let new_bplace = pick_str("birth_place", db_bplace, staged_p.birth_place.clone());
        let new_ddate = pick_str("death_date", db_ddate, staged_p.death_date.clone());
        let new_dplace = pick_str("death_place", db_dplace, staged_p.death_place.clone());

        // Zusatzdaten aktualisieren
        match m.extra_action.as_str() {
            "overwrite" => {
                let existing_uid = db_json.get("_UID").cloned();
                db_json = staged_p.json_data.clone();
                if let Some(uid_val) = existing_uid {
                    if let Some(obj) = db_json.as_object_mut() {
                        obj.insert("_UID".to_string(), uid_val);
                    }
                }
            }
            "append" => {
                if let (Some(db_obj), Some(st_obj)) = (db_json.as_object_mut(), staged_p.json_data.as_object()) {
                    for (k, v) in st_obj {
                        if k == "_UID" || k == "CHAN" {
                            continue;
                        }
                        if !db_obj.contains_key(k) {
                            db_obj.insert(k.clone(), v.clone());
                        } else if let Some(v_str) = v.get("_val").and_then(|s| s.as_str()) {
                            // Wenn Notiz existiert, anhängen
                            if let Some(curr_node) = db_obj.get_mut(k) {
                                if let Some(curr_val) = curr_node.get_mut("_val") {
                                    if let Some(cv) = curr_val.as_str() {
                                        if !cv.contains(v_str) {
                                            *curr_val = serde_json::Value::String(format!("{}\n\n[Import]: {}", cv, v_str));
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            }
            _ => {
                // "db": Nichts tun
            }
        }

        // Systemfeld CHAN auf jetzt setzen
        if let Some(obj) = db_json.as_object_mut() {
            obj.insert("CHAN".to_string(), now_chan.clone());
        }

        let updated_json_str = serde_json::to_string(&db_json).unwrap_or_else(|_| "{}".to_string());

        tx.execute(
            "UPDATE individuals SET given_name = ?1, surname = ?2, sex = ?3, birth_date = ?4, birth_place = ?5, death_date = ?6, death_place = ?7, json_data = ?8 
             WHERE id = ?9",
            params![
                new_given,
                new_sur,
                new_sex,
                new_bdate,
                new_bplace,
                new_ddate,
                new_dplace,
                updated_json_str,
                m.target_db_id
            ],
        ).map_err(|e| e.to_string())?;

        updated_persons_count += 1;
    }

    // 2. Neue Personen einfügen
    let ignored_set: HashSet<String> = resolution.ignored_xrefs.iter().cloned().collect();

    for new_xref in &resolution.new_person_xrefs {
        if ignored_set.contains(new_xref) {
            continue;
        }
        let staged_p = match staged_persons_by_xref.get(new_xref) {
            Some(p) => *p,
            None => continue,
        };

        // Prüfen, ob new_xref in DB schon existiert -> Wenn ja, neue ID vergeben
        let exists: bool = tx
            .query_row(
                "SELECT 1 FROM individuals WHERE id = ?1",
                [&staged_p.xref],
                |_| Ok(true),
            )
            .unwrap_or(false);

        let actual_id = if !exists && !id_map.values().any(|v| v == &staged_p.xref) {
            staged_p.xref.clone()
        } else {
            crate::db::get_next_individual_id(&tx)?
        };

        id_map.insert(staged_p.xref.clone(), actual_id.clone());

        let mut json_val = staged_p.json_data.clone();
        if let Some(obj) = json_val.as_object_mut() {
            obj.insert("CHAN".to_string(), now_chan.clone());
            if !obj.contains_key("_UID") {
                let generated_uid = format!("{:X}", uuid::Uuid::new_v4().simple());
                obj.insert("_UID".to_string(), serde_json::json!({ "_val": generated_uid }));
            }
        }
        let json_str = serde_json::to_string(&json_val).unwrap_or_else(|_| "{}".to_string());

        tx.execute(
            "INSERT INTO individuals (id, xref_id, given_name, surname, sex, birth_date, birth_place, death_date, death_place, json_data)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)",
            params![
                actual_id,
                actual_id,
                staged_p.given_name,
                staged_p.surname,
                staged_p.sex,
                staged_p.birth_date,
                staged_p.birth_place,
                staged_p.death_date,
                staged_p.death_place,
                json_str
            ],
        ).map_err(|e| e.to_string())?;

        new_persons_count += 1;
    }

    // 3. Familien & Verwandtschaften einpflegen
    let mut new_families_count = 0;
    let mut new_parent_child_count = 0;

    for staged_fam in &staged.families {
        let h_id = staged_fam
            .husband_xref
            .as_ref()
            .and_then(|x| id_map.get(x))
            .cloned();
        let w_id = staged_fam
            .wife_xref
            .as_ref()
            .and_then(|x| id_map.get(x))
            .cloned();

        let children_ids: Vec<String> = staged_fam
            .children_xrefs
            .iter()
            .filter_map(|x| id_map.get(x))
            .cloned()
            .collect();

        // Wenn weder Ehepartner noch Kinder gemappt oder importiert wurden, überspringen
        if h_id.is_none() && w_id.is_none() && children_ids.is_empty() {
            continue;
        }

        // Prüfen, ob für diese Ehepartner bereits eine Familie in der DB existiert
        let existing_fam_id: Option<String> = if h_id.is_some() || w_id.is_some() {
            let mut query_fam = tx.prepare(
                "SELECT id FROM families 
                 WHERE (husband_id IS ?1 OR (?1 IS NULL AND husband_id IS NULL))
                   AND (wife_id IS ?2 OR (?2 IS NULL AND wife_id IS NULL))",
            ).map_err(|e| e.to_string())?;

            let mut rows = query_fam
                .query(params![h_id, w_id])
                .map_err(|e| e.to_string())?;

            if let Some(r) = rows.next().map_err(|e| e.to_string())? {
                Some(r.get(0).map_err(|e| e.to_string())?)
            } else {
                None
            }
        } else {
            None
        };

        let target_fam_id = if let Some(fid) = existing_fam_id {
            // Familie existiert bereits: fehlende Heiratsdaten nachtragen
            if staged_fam.marriage_date.is_some() || staged_fam.divorce_date.is_some() {
                tx.execute(
                    "UPDATE families SET 
                        marriage_date = COALESCE(marriage_date, ?1),
                        divorce_date = COALESCE(divorce_date, ?2),
                        is_divorced = CASE WHEN is_divorced = 1 OR ?3 = 1 THEN 1 ELSE 0 END
                     WHERE id = ?4",
                    params![
                        staged_fam.marriage_date,
                        staged_fam.divorce_date,
                        if staged_fam.is_divorced { 1 } else { 0 },
                        fid
                    ],
                ).map_err(|e| e.to_string())?;
            }
            fid
        } else {
            // Neue Familie anlegen
            let mut fid = staged_fam.xref.clone();
            let fam_exists: bool = tx
                .query_row("SELECT 1 FROM families WHERE id = ?1", [&fid], |_| Ok(true))
                .unwrap_or(false);

            if fam_exists {
                let max_num: i64 = tx
                    .query_row("SELECT COALESCE(MAX(CAST(SUBSTR(id, 2) AS INTEGER)), 0) FROM families WHERE id LIKE 'F%'", [], |r| r.get(0))
                    .unwrap_or(0);
                fid = format!("F{}", max_num + 1);
            }

            let json_str = serde_json::to_string(&staged_fam.json_data).unwrap_or_else(|_| "{}".to_string());

            tx.execute(
                "INSERT INTO families (id, xref_id, husband_id, wife_id, marriage_date, divorce_date, is_divorced, json_data)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
                params![
                    fid,
                    fid,
                    h_id,
                    w_id,
                    staged_fam.marriage_date,
                    staged_fam.divorce_date,
                    if staged_fam.is_divorced { 1 } else { 0 },
                    json_str
                ],
            ).map_err(|e| e.to_string())?;

            new_families_count += 1;
            fid
        };

        // Eltern-Kind-Verknüpfungen (mit sicherer Option A: bestehende Eltern werden geschützt)
        for c_id in children_ids {
            let existing_parent_count: i64 = tx
                .query_row(
                    "SELECT COUNT(*) FROM parent_child WHERE child_id = ?1",
                    [&c_id],
                    |r| r.get(0),
                )
                .unwrap_or(0);

            if existing_parent_count == 0 {
                tx.execute(
                    "INSERT OR IGNORE INTO parent_child (family_id, child_id) VALUES (?1, ?2)",
                    params![target_fam_id, c_id],
                ).map_err(|e| e.to_string())?;
                new_parent_child_count += 1;
            } else {
                // Kind hat bereits Eltern in DB: Sichere Option A greift
                preserved_parents_count += 1;
            }
        }
    }

    tx.commit().map_err(|e| e.to_string())?;

    // Henry-Codes neu berechnen
    let _ = crate::calculate_henry_codes_internal(conn);

    Ok(MergeResultStats {
        updated_persons_count,
        new_persons_count,
        new_families_count,
        new_parent_child_count,
        preserved_parents_count,
    })
}
