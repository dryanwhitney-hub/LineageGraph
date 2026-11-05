use chrono::{Datelike, Timelike};
use rusqlite::Connection;
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet, VecDeque};
use std::fs;
use std::path::Path;

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(tag = "mode", rename_all = "snake_case")]
pub enum GedcomExportScope {
    All,
    Descendants {
        person_id: String,
        include_spouses: bool,
    },
    Ancestors {
        person_id: String,
    },
    SpecificList {
        person_ids: Vec<String>,
    },
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct GedcomExportPreview {
    pub total_persons: usize,
    pub total_families: usize,
    pub preview_text: String,
    pub full_content: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct GedcomExportResult {
    pub total_persons: usize,
    pub total_families: usize,
    pub file_path: String,
}

struct IndRecord {
    id: String,
    given_name: Option<String>,
    surname: Option<String>,
    sex: Option<String>,
    birth_date: Option<String>,
    birth_place: Option<String>,
    death_date: Option<String>,
    death_place: Option<String>,
    json_data: String,
}

struct FamRecord {
    id: String,
    husband_id: Option<String>,
    wife_id: Option<String>,
    marriage_date: Option<String>,
    divorce_date: Option<String>,
    is_divorced: bool,
    json_data: String,
}

pub fn generate_gedcom(
    conn: &Connection,
    scope: &GedcomExportScope,
) -> Result<(String, usize, usize), String> {
    // 1. Zu exportierende Personen gemäß Scope ermitteln
    let selected_person_ids = resolve_scope_person_ids(conn, scope)?;

    // 2. Familien und Eltern-Kind-Verbindungen laden
    let mut fam_stmt = conn
        .prepare("SELECT id, husband_id, wife_id, marriage_date, divorce_date, is_divorced, json_data FROM families")
        .map_err(|e| e.to_string())?;
    let fam_iter = fam_stmt
        .query_map([], |r| {
            Ok(FamRecord {
                id: r.get(0)?,
                husband_id: r.get(1)?,
                wife_id: r.get(2)?,
                marriage_date: r.get(3)?,
                divorce_date: r.get(4)?,
                is_divorced: r.get(5)?,
                json_data: r.get(6)?,
            })
        })
        .map_err(|e| e.to_string())?;

    let mut families: Vec<FamRecord> = Vec::new();
    for f in fam_iter {
        families.push(f.map_err(|e| e.to_string())?);
    }

    let mut pc_stmt = conn
        .prepare("SELECT family_id, child_id FROM parent_child")
        .map_err(|e| e.to_string())?;
    let pc_iter = pc_stmt
        .query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?)))
        .map_err(|e| e.to_string())?;

    let mut family_children: HashMap<String, Vec<String>> = HashMap::new();
    let mut person_fams: HashMap<String, Vec<String>> = HashMap::new();
    let mut person_famc: HashMap<String, Vec<String>> = HashMap::new();

    for f in &families {
        if let Some(ref h) = f.husband_id {
            person_fams.entry(h.clone()).or_default().push(f.id.clone());
        }
        if let Some(ref w) = f.wife_id {
            person_fams.entry(w.clone()).or_default().push(f.id.clone());
        }
    }

    for res in pc_iter {
        let (fam_id, child_id) = res.map_err(|e| e.to_string())?;
        family_children
            .entry(fam_id.clone())
            .or_default()
            .push(child_id.clone());
        person_famc
            .entry(child_id)
            .or_default()
            .push(fam_id);
    }

    // Eine Familie wird exportiert, wenn mindestens ein Beteiligter in den exportierten Personen ist
    let mut selected_family_ids = HashSet::new();
    for f in &families {
        let h_in = f
            .husband_id
            .as_ref()
            .is_some_and(|h| selected_person_ids.contains(h));
        let w_in = f
            .wife_id
            .as_ref()
            .is_some_and(|w| selected_person_ids.contains(w));
        let mut child_in = false;
        if let Some(children) = family_children.get(&f.id) {
            child_in = children.iter().any(|c| selected_person_ids.contains(c));
        }

        if h_in || w_in || child_in {
            selected_family_ids.insert(f.id.clone());
        }
    }

    // 3. Personen laden und sortieren
    let mut ind_stmt = conn
        .prepare("SELECT id, given_name, surname, sex, birth_date, birth_place, death_date, death_place, json_data FROM individuals ORDER BY surname, given_name, id")
        .map_err(|e| e.to_string())?;
    let ind_iter = ind_stmt
        .query_map([], |r| {
            Ok(IndRecord {
                id: r.get(0)?,
                given_name: r.get(1)?,
                surname: r.get(2)?,
                sex: r.get(3)?,
                birth_date: r.get(4)?,
                birth_place: r.get(5)?,
                death_date: r.get(6)?,
                death_place: r.get(7)?,
                json_data: r.get(8)?,
            })
        })
        .map_err(|e| e.to_string())?;

    let mut individuals: Vec<IndRecord> = Vec::new();
    for ind in ind_iter {
        let record = ind.map_err(|e| e.to_string())?;
        if selected_person_ids.contains(&record.id) {
            individuals.push(record);
        }
    }

    // 4. GEDCOM String zusammenbauen
    let mut out = String::with_capacity(64 * 1024);

    // 4.1 Header
    let now = chrono::Local::now();
    let month_str = match now.month() {
        1 => "JAN",
        2 => "FEB",
        3 => "MAR",
        4 => "APR",
        5 => "MAY",
        6 => "JUN",
        7 => "JUL",
        8 => "AUG",
        9 => "SEP",
        10 => "OCT",
        11 => "NOV",
        12 => "DEC",
        _ => "JAN",
    };
    let date_str = format!("{} {} {}", now.day(), month_str, now.year());
    let time_str = format!("{:02}:{:02}:{:02}", now.hour(), now.minute(), now.second());

    out.push_str("0 HEAD\n");
    out.push_str("1 SOUR STAMMBAUM\n");
    out.push_str("2 VERS 0.1.0\n");
    out.push_str("2 NAME Stammbaum Familienbuch\n");
    out.push_str(&format!("1 DATE {}\n", date_str));
    out.push_str(&format!("2 TIME {}\n", time_str));
    out.push_str("1 GEDC\n");
    out.push_str("2 VERS 5.5.1\n");
    out.push_str("2 FORM LINEAGE-LINKED\n");
    out.push_str("1 CHAR UTF-8\n");

    // 4.2 Individuals
    for ind in &individuals {
        out.push_str(&format!("0 @{}@ INDI\n", ind.id));

        let given = ind.given_name.as_deref().unwrap_or("").trim();
        let surname = ind.surname.as_deref().unwrap_or("").trim();
        if !given.is_empty() || !surname.is_empty() {
            out.push_str(&format!("1 NAME {} /{}/\n", given, surname));
            if !given.is_empty() {
                out.push_str(&format!("2 GIVN {}\n", given));
            }
            if !surname.is_empty() {
                out.push_str(&format!("2 SURN {}\n", surname));
            }
        }

        if let Some(ref sex) = ind.sex {
            let s = sex.trim();
            if !s.is_empty() {
                out.push_str(&format!("1 SEX {}\n", s));
            }
        }

        if ind.birth_date.is_some() || ind.birth_place.is_some() {
            out.push_str("1 BIRT\n");
            if let Some(ref d) = ind.birth_date {
                if !d.trim().is_empty() {
                    out.push_str(&format!("2 DATE {}\n", d.trim()));
                }
            }
            if let Some(ref p) = ind.birth_place {
                if !p.trim().is_empty() {
                    out.push_str(&format!("2 PLAC {}\n", p.trim()));
                }
            }
        }

        if ind.death_date.is_some() || ind.death_place.is_some() {
            out.push_str("1 DEAT\n");
            if let Some(ref d) = ind.death_date {
                if !d.trim().is_empty() {
                    out.push_str(&format!("2 DATE {}\n", d.trim()));
                }
            }
            if let Some(ref p) = ind.death_place {
                if !p.trim().is_empty() {
                    out.push_str(&format!("2 PLAC {}\n", p.trim()));
                }
            }
        }

        // FAMS Links
        if let Some(fams) = person_fams.get(&ind.id) {
            for fid in fams {
                if selected_family_ids.contains(fid) {
                    out.push_str(&format!("1 FAMS @{}@\n", fid));
                }
            }
        }

        // FAMC Links
        if let Some(famc) = person_famc.get(&ind.id) {
            for fid in famc {
                if selected_family_ids.contains(fid) {
                    out.push_str(&format!("1 FAMC @{}@\n", fid));
                }
            }
        }

        // Zusätzliche GEDCOM-Tags aus json_data exportieren
        append_json_extra_tags(&mut out, &ind.json_data, false);
    }

    // 4.3 Families
    for f in &families {
        if !selected_family_ids.contains(&f.id) {
            continue;
        }

        out.push_str(&format!("0 @{}@ FAM\n", f.id));

        if let Some(ref h) = f.husband_id {
            if selected_person_ids.contains(h) {
                out.push_str(&format!("1 HUSB @{}@\n", h));
            }
        }

        if let Some(ref w) = f.wife_id {
            if selected_person_ids.contains(w) {
                out.push_str(&format!("1 WIFE @{}@\n", w));
            }
        }

        if let Some(children) = family_children.get(&f.id) {
            for cid in children {
                if selected_person_ids.contains(cid) {
                    out.push_str(&format!("1 CHIL @{}@\n", cid));
                }
            }
        }

        if let Some(ref m_date) = f.marriage_date {
            if !m_date.trim().is_empty() {
                out.push_str("1 MARR\n");
                out.push_str(&format!("2 DATE {}\n", m_date.trim()));
            }
        }

        if f.is_divorced || f.divorce_date.is_some() {
            out.push_str("1 DIV\n");
            if let Some(ref d_date) = f.divorce_date {
                if !d_date.trim().is_empty() {
                    out.push_str(&format!("2 DATE {}\n", d_date.trim()));
                }
            }
        }

        // Zusätzliche Tags der Familie aus json_data exportieren
        append_json_extra_tags(&mut out, &f.json_data, true);
    }

    // 4.4 Trailer
    out.push_str("0 TRLR\n");

    let count_persons = individuals.len();
    let count_families = selected_family_ids.len();

    Ok((out, count_persons, count_families))
}

fn append_json_extra_tags(out: &mut String, json_str: &str, is_family: bool) {
    let Ok(val) = serde_json::from_str::<serde_json::Value>(json_str) else {
        return;
    };
    let Some(map) = val.as_object() else {
        return;
    };

    let ignored_tags: &[&str] = if is_family {
        &["HUSB", "WIFE", "CHIL", "MARR", "DIV", "ID", "XREF"]
    } else {
        &[
            "NAME", "GIVN", "SURN", "SEX", "BIRT", "DEAT", "FAMS", "FAMC", "ID", "XREF",
        ]
    };

    for (tag, subval) in map {
        let tag_upper = tag.to_uppercase();
        if ignored_tags.contains(&tag_upper.as_str()) {
            continue;
        }

        if tag_upper == "CHAN" {
            if let Some(chan_obj) = subval.as_object() {
                out.push_str("1 CHAN\n");
                if let Some(d) = chan_obj.get("DATE").and_then(|v| v.as_str()) {
                    out.push_str(&format!("2 DATE {}\n", d));
                }
                if let Some(t) = chan_obj.get("TIME").and_then(|v| v.as_str()) {
                    out.push_str(&format!("3 TIME {}\n", t));
                }
            }
            continue;
        }

        if tag_upper == "_UID" || tag_upper == "UID" {
            let uid_str = subval
                .get("_val")
                .and_then(|v| v.as_str())
                .or_else(|| subval.as_str());
            if let Some(u) = uid_str {
                out.push_str(&format!("1 _UID {}\n", u));
            }
            continue;
        }

        if let Some(submap) = subval.as_object() {
            let l1_val = submap.get("_val").and_then(|v| v.as_str()).unwrap_or("");
            if !l1_val.trim().is_empty() {
                out.push_str(&format!("1 {} {}\n", tag_upper, l1_val.trim()));
            } else {
                out.push_str(&format!("1 {}\n", tag_upper));
            }

            for (subtag, leaf) in submap {
                if subtag == "_val" {
                    continue;
                }
                if let Some(leaf_str) = leaf.as_str() {
                    if !leaf_str.trim().is_empty() {
                        out.push_str(&format!("2 {} {}\n", subtag.to_uppercase(), leaf_str.trim()));
                    }
                }
            }
        } else if let Some(s) = subval.as_str() {
            if !s.trim().is_empty() {
                out.push_str(&format!("1 {} {}\n", tag_upper, s.trim()));
            }
        }
    }
}

pub fn resolve_scope_person_ids(
    conn: &Connection,
    scope: &GedcomExportScope,
) -> Result<HashSet<String>, String> {
    match scope {
        GedcomExportScope::All => {
            let mut stmt = conn
                .prepare("SELECT id FROM individuals")
                .map_err(|e| e.to_string())?;
            let ids: Vec<String> = stmt
                .query_map([], |r| r.get(0))
                .map_err(|e| e.to_string())?
                .filter_map(Result::ok)
                .collect();
            Ok(ids.into_iter().collect())
        }
        GedcomExportScope::Descendants {
            person_id,
            include_spouses,
        } => {
            let mut selected = HashSet::new();
            let mut queue = VecDeque::new();

            let exists: bool = conn
                .query_row(
                    "SELECT 1 FROM individuals WHERE id = ?1",
                    [person_id],
                    |_| Ok(true),
                )
                .unwrap_or(false);

            if exists {
                selected.insert(person_id.clone());
                queue.push_back(person_id.clone());
            }

            while let Some(current_id) = queue.pop_front() {
                let mut stmt = conn
                    .prepare(
                        "SELECT pc.child_id FROM parent_child pc 
                         JOIN families f ON pc.family_id = f.id 
                         WHERE f.husband_id = ?1 OR f.wife_id = ?1",
                    )
                    .map_err(|e| e.to_string())?;
                let children: Vec<String> = stmt
                    .query_map([&current_id], |r| r.get(0))
                    .map_err(|e| e.to_string())?
                    .filter_map(Result::ok)
                    .collect();

                for cid in children {
                    if selected.insert(cid.clone()) {
                        queue.push_back(cid);
                    }
                }
            }

            if *include_spouses {
                let mut spouse_ids = Vec::new();
                for pid in &selected {
                    let mut stmt = conn
                        .prepare(
                            "SELECT husband_id, wife_id FROM families WHERE husband_id = ?1 OR wife_id = ?1",
                        )
                        .map_err(|e| e.to_string())?;
                    let pairs = stmt
                        .query_map([pid], |r| {
                            Ok((r.get::<_, Option<String>>(0)?, r.get::<_, Option<String>>(1)?))
                        })
                        .map_err(|e| e.to_string())?;

                    for p in pairs.flatten() {
                        if let (Some(h), Some(w)) = p {
                            if &h == pid && !selected.contains(&w) {
                                spouse_ids.push(w);
                            } else if &w == pid && !selected.contains(&h) {
                                spouse_ids.push(h);
                            }
                        }
                    }
                }
                for sid in spouse_ids {
                    selected.insert(sid);
                }
            }

            Ok(selected)
        }
        GedcomExportScope::Ancestors { person_id } => {
            let mut selected = HashSet::new();
            let mut queue = VecDeque::new();

            let exists: bool = conn
                .query_row(
                    "SELECT 1 FROM individuals WHERE id = ?1",
                    [person_id],
                    |_| Ok(true),
                )
                .unwrap_or(false);

            if exists {
                selected.insert(person_id.clone());
                queue.push_back(person_id.clone());
            }

            while let Some(current_id) = queue.pop_front() {
                let mut stmt = conn
                    .prepare(
                        "SELECT f.husband_id, f.wife_id FROM families f 
                         JOIN parent_child pc ON f.id = pc.family_id 
                         WHERE pc.child_id = ?1",
                    )
                    .map_err(|e| e.to_string())?;
                let parents = stmt
                    .query_map([&current_id], |r| {
                        Ok((r.get::<_, Option<String>>(0)?, r.get::<_, Option<String>>(1)?))
                    })
                    .map_err(|e| e.to_string())?;

                for p in parents.flatten() {
                    for parent_opt in [p.0, p.1] {
                        if let Some(par) = parent_opt {
                            if selected.insert(par.clone()) {
                                queue.push_back(par);
                            }
                        }
                    }
                }
            }

            Ok(selected)
        }
        GedcomExportScope::SpecificList { person_ids } => {
            let mut selected = HashSet::new();
            for pid in person_ids {
                let exists: bool = conn
                    .query_row(
                        "SELECT 1 FROM individuals WHERE id = ?1",
                        [pid],
                        |_| Ok(true),
                    )
                    .unwrap_or(false);
                if exists {
                    selected.insert(pid.clone());
                }
            }
            Ok(selected)
        }
    }
}

pub fn export_gedcom_to_file(
    conn: &Connection,
    file_path: &Path,
    scope: &GedcomExportScope,
) -> Result<GedcomExportResult, String> {
    let (content, total_persons, total_families) = generate_gedcom(conn, scope)?;
    fs::write(file_path, content.as_bytes())
        .map_err(|e| format!("Fehler beim Schreiben der Datei: {}", e))?;
    Ok(GedcomExportResult {
        total_persons,
        total_families,
        file_path: file_path.to_string_lossy().to_string(),
    })
}

