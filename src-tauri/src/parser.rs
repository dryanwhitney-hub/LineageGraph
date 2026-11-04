use rusqlite::{params, Connection};
use std::collections::HashSet;
use std::fs::File;
use std::io::{BufRead, BufReader};
use std::path::Path;

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

pub fn import_gedcom(conn: &mut Connection, path: &Path) -> Result<usize, String> {
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
            let value = if parts.len() > 2 { Some(parts[2..].join(" ")) } else { None };
            rec.lines.push(RawLine { level, tag, value });
        }
    }
    if let Some(rec) = current_record {
        records.push(rec);
    }

    let tx = conn.transaction().map_err(|e| e.to_string())?;

    // Vor dem Import alle bestehenden Datensätze im aktiven Stammbaum atomar löschen
    tx.execute("DELETE FROM proband_henry_codes", []).map_err(|e| e.to_string())?;
    tx.execute("DELETE FROM parent_child", []).map_err(|e| e.to_string())?;
    tx.execute("DELETE FROM families", []).map_err(|e| e.to_string())?;
    tx.execute("DELETE FROM individuals", []).map_err(|e| e.to_string())?;

    let mut count = 0;
    let mut parent_child_pairs: HashSet<(String, String)> = HashSet::new();

    for rec in records {
        if rec.tag == "INDI" && !rec.xref.is_empty() {
            let id = rec.xref.clone();
            let mut given_name = None;
            let mut surname = None;
            let mut sex = "U".to_string();
            let mut birth_date = None;
            let mut birth_place = None;
            let mut death_date = None;
            let mut death_place = None;

            let mut root_obj = serde_json::Map::new();
            let mut active_l1_tag = String::new();
            let mut active_l1_map = serde_json::Map::new();

            for line in &rec.lines {
                if line.level == 1 {
                    if !active_l1_tag.is_empty() {
                        root_obj.insert(active_l1_tag.clone(), serde_json::Value::Object(active_l1_map));
                        active_l1_map = serde_json::Map::new();
                    }
                    active_l1_tag = line.tag.clone();

                    if line.tag == "SEX" {
                        if let Some(v) = &line.value {
                            sex = v.trim().to_string();
                        }
                    } else if line.tag == "FAMC" {
                        if let Some(v) = &line.value {
                            let fam_id = v.replace('@', "").trim().to_string();
                            if !fam_id.is_empty() {
                                parent_child_pairs.insert((fam_id, id.clone()));
                            }
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
                        active_l1_map.insert("_val".to_string(), serde_json::Value::String(v.clone()));
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
                        if line.tag == "DATE" { birth_date = line.value.clone(); }
                        if line.tag == "PLAC" { birth_place = line.value.clone(); }
                    } else if active_l1_tag == "DEAT" {
                        if line.tag == "DATE" { death_date = line.value.clone(); }
                        if line.tag == "PLAC" { death_place = line.value.clone(); }
                    }
                }
            }
            if !active_l1_tag.is_empty() {
                root_obj.insert(active_l1_tag, serde_json::Value::Object(active_l1_map));
            }

            let json_str = serde_json::to_string(&root_obj).unwrap_or_else(|_| "{}".to_string());

            tx.execute(
                "INSERT INTO individuals (id, xref_id, given_name, surname, sex, birth_date, birth_place, death_date, death_place, json_data)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)",
                params![id, id, given_name, surname, sex, birth_date, birth_place, death_date, death_place, json_str],
            ).map_err(|e| e.to_string())?;

            count += 1;

        } else if rec.tag == "FAM" && !rec.xref.is_empty() {
            let id = rec.xref.clone();
            let mut husband_id = None;
            let mut wife_id = None;
            let mut marriage_date = None;
            let mut divorce_date = None;
            let mut is_divorced = false;

            let mut root_obj = serde_json::Map::new();
            let mut active_l1_tag = String::new();
            let mut active_l1_map = serde_json::Map::new();

            for line in &rec.lines {
                if line.level == 1 {
                    if !active_l1_tag.is_empty() {
                        root_obj.insert(active_l1_tag.clone(), serde_json::Value::Object(active_l1_map));
                        active_l1_map = serde_json::Map::new();
                    }
                    active_l1_tag = line.tag.clone();

                    if line.tag == "HUSB" {
                        husband_id = line.value.as_ref().map(|s| s.replace('@', "").trim().to_string());
                    } else if line.tag == "WIFE" {
                        wife_id = line.value.as_ref().map(|s| s.replace('@', "").trim().to_string());
                    } else if line.tag == "CHIL" {
                        if let Some(v) = &line.value {
                            let child_id = v.replace('@', "").trim().to_string();
                            if !child_id.is_empty() {
                                parent_child_pairs.insert((id.clone(), child_id));
                            }
                        }
                    } else if line.tag == "DIV" {
                        is_divorced = true;
                    }

                    if let Some(v) = &line.value {
                        active_l1_map.insert("_val".to_string(), serde_json::Value::String(v.clone()));
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

            let json_str = serde_json::to_string(&root_obj).unwrap_or_else(|_| "{}".to_string());

            tx.execute(
                "INSERT INTO families (id, xref_id, husband_id, wife_id, marriage_date, divorce_date, is_divorced, json_data)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
                params![id, id, husband_id, wife_id, marriage_date, divorce_date, is_divorced, json_str],
            ).map_err(|e| e.to_string())?;
        }
    }

    // 3. Parent-Child Relationen eintragen
    for (fam_id, child_id) in parent_child_pairs {
        tx.execute(
            "INSERT OR IGNORE INTO parent_child (family_id, child_id) VALUES (?1, ?2)",
            params![fam_id, child_id],
        ).map_err(|e| e.to_string())?;
    }

    tx.commit().map_err(|e| e.to_string())?;
    Ok(count)
}
