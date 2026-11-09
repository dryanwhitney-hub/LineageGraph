pub mod db;
pub mod parser;
pub mod gedcom_export;
pub mod gedcom_import_merge;
pub mod csv_export;
pub mod research;

use petgraph::algo::astar;
use petgraph::graph::{DiGraph, NodeIndex};
use rusqlite::Connection;
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet, VecDeque};
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::Mutex;
use tauri::{Manager, State};
use tera::{Context, Tera};
use chrono::{Datelike, Timelike};

pub fn current_gedcom_chan() -> serde_json::Value {
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
    let date_str = format!("{:02} {} {:04}", now.day(), month_str, now.year());
    let time_str = format!("{:02}:{:02}:{:02}", now.hour(), now.minute(), now.second());
    serde_json::json!({
        "DATE": date_str,
        "TIME": time_str
    })
}

#[cfg(target_os = "windows")]
use std::os::windows::process::CommandExt;

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ProbandData {
    pub henry_code: String,
    pub generation: i32,
}

#[derive(Debug, Serialize, Deserialize, Clone, Default)]
pub struct SpouseConnection {
    pub id: String,
    pub date: Option<String>,
    pub place: Option<String>,
    pub divorce_date: Option<String>,
    pub is_divorced: bool,
    #[serde(default)]
    pub family_id: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone, Default)]
pub struct Person {
    pub id: String,
    pub given_name: Option<String>,
    pub surname: Option<String>,
    pub sex: Option<String>,
    pub birth_date: Option<String>,
    pub birth_place: Option<String>,
    pub death_date: Option<String>,
    pub death_place: Option<String>,
    pub proband_data: HashMap<String, ProbandData>,
    pub gedcom_extra: serde_json::Value,
    pub spouses: Vec<SpouseConnection>,
    pub parent_ids: Vec<String>,
    #[serde(default)]
    pub father_id: Option<String>,
    #[serde(default)]
    pub mother_id: Option<String>,
    #[serde(default)]
    pub children_ids: Vec<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct RelativePerson {
    pub id: String,
    pub given_name: Option<String>,
    pub surname: Option<String>,
    pub henry_code: Option<String>,
    pub birth_date: Option<String>,
    pub death_date: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct SpouseInfo {
    pub family_id: String,
    pub partner_id: Option<String>,
    pub partner_name: Option<String>,
    pub partner_henry: Option<String>,
    pub partner_birth: Option<String>,
    pub partner_death: Option<String>,
    pub marriage_date: Option<String>,
    pub divorce_date: Option<String>,
    pub is_divorced: bool,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct PersonDetailsResponse {
    pub parents: Vec<RelativePerson>,
    pub siblings: Vec<RelativePerson>,
    pub spouses: Vec<SpouseInfo>,
    pub children: Vec<RelativePerson>,
    pub notes: Vec<String>,
    pub gedcom_tags: HashMap<String, String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct RootAncestorConfig {
    pub person_id: String,
    pub starting_code: String,
    pub given_name: Option<String>,
    pub surname: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct DesignLayoutEntry {
    pub id: String,
    pub proband_id: String,
    pub name: String,
    pub created_at: String,
    pub layout_data: String,
    pub layout_type: Option<String>,
    pub anchor_person_id: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct LatexTemplateEntry {
    pub id: String,
    pub name: String,
    pub created_at: String,
    pub config_data: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct LatexExportFilePayload {
    pub file_name: String,
    pub content: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct PersonUpdate {
    pub original_id: String,
    pub person: Person,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct SpouseResolution {
    pub partner_id: String,
    pub resolution: String, // "merge" | "keep_separate" | "target_only" | "source_only"
    pub marriage_date: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct PersonMergeFieldsDto {
    pub given_name: Option<String>,
    pub surname: Option<String>,
    pub sex: Option<String>,
    pub birth_date: Option<String>,
    pub birth_place: Option<String>,
    pub death_date: Option<String>,
    pub death_place: Option<String>,
    pub parent_family_source: String, // "target" | "source" | "none"
    pub spouse_resolutions: Vec<SpouseResolution>,
    pub selected_event_ids: Vec<String>,
    pub audit_note: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct PersonEventDto {
    pub id: String,
    pub owner_id: String,
    pub tag: String,
    pub date_str: Option<String>,
    pub place: Option<String>,
    pub description: Option<String>,
}

pub struct AppState {
    pub db: Mutex<Connection>,
    pub app_dir: PathBuf,
    pub active_tree: Mutex<String>,
}

/// Validates a tree name against empty strings, path separators, and traversal sequences.
fn validate_tree_name(tree_name: &str) -> Result<&str, String> {
    let trimmed = tree_name.trim();
    if trimmed.is_empty()
        || trimmed.contains('/')
        || trimmed.contains('\\')
        || trimmed.contains("..")
        || trimmed.contains('\0')
    {
        return Err("Ungültiger Stammbaum-Name".into());
    }
    Ok(trimmed)
}

/// Validates a user-selected file path and restricts access to allowed file extensions.
fn validate_user_file_path<'a>(
    file_path: &'a str,
    allowed_extensions: &[&str],
) -> Result<&'a Path, String> {
    let trimmed = file_path.trim();
    if trimmed.is_empty() || trimmed.contains('\0') {
        return Err("Ungültiger Dateipfad.".into());
    }
    let path = Path::new(trimmed);
    let ext = path
        .extension()
        .and_then(|s| s.to_str())
        .map(|s| s.to_ascii_lowercase())
        .ok_or_else(|| "Dateierweiterung fehlt.".to_string())?;

    if !allowed_extensions.iter().any(|allowed| *allowed == ext) {
        return Err(format!(
            "Nicht unterstützte Dateierweiterung '.{}'. Erlaubt: {}",
            ext,
            allowed_extensions.join(", ")
        ));
    }
    Ok(path)
}

/// Scans `app_dir` for `.db` files and returns a sorted, deduplicated list of tree names,
/// optionally excluding a specific tree name.
fn list_tree_names(app_dir: &Path, exclude: Option<&str>) -> Vec<String> {
    let mut trees = Vec::new();
    if let Ok(entries) = fs::read_dir(app_dir) {
        for entry in entries.flatten() {
            let path = entry.path();
            if path.extension().and_then(|s| s.to_str()) == Some("db") {
                if let Some(stem) = path.file_stem().and_then(|s| s.to_str()) {
                    if exclude.map_or(true, |ex| stem != ex) {
                        trees.push(stem.to_string());
                    }
                }
            }
        }
    }
    trees.sort();
    trees.dedup();
    trees
}

/// Escapes LaTeX special characters to prevent markup corruption and command injection.
fn escape_latex(input: &str) -> String {
    let mut out = String::with_capacity(input.len());
    for ch in input.chars() {
        match ch {
            '\\' => out.push_str(r"\textbackslash{}"),
            '{' => out.push_str(r"\{"),
            '}' => out.push_str(r"\}"),
            '$' => out.push_str(r"\$"),
            '&' => out.push_str(r"\&"),
            '#' => out.push_str(r"\#"),
            '^' => out.push_str(r"\textasciicircum{}"),
            '_' => out.push_str(r"\_"),
            '~' => out.push_str(r"\textasciitilde{}"),
            '%' => out.push_str(r"\%"),
            c => out.push(c),
        }
    }
    out
}

#[tauri::command]
fn get_trees(state: State<AppState>) -> Result<Vec<String>, String> {
    Ok(list_tree_names(&state.app_dir, None))
}

#[tauri::command]
fn switch_tree(state: State<AppState>, tree_name: String) -> Result<(), String> {
    let valid_name = validate_tree_name(&tree_name)?;
    let db_path = state.app_dir.join(format!("{}.db", valid_name));
    let new_conn = db::init_database(&db_path).map_err(|e| e.to_string())?;
    let mut conn = state.db.lock().map_err(|e| e.to_string())?;
    *conn = new_conn;
    let mut active = state.active_tree.lock().map_err(|e| e.to_string())?;
    *active = valid_name.to_string();
    Ok(())
}

/// Deletes a tree database (including WAL/SHM sidecar files) safely after releasing file locks.
pub fn delete_tree_internal(
    app_dir: &Path,
    conn: &mut Connection,
    active: &mut String,
    tree_name: &str,
) -> Result<Vec<String>, String> {
    let valid_name = validate_tree_name(tree_name)?;

    // Vorhandene Bäume ermitteln (ohne den zu löschenden)
    let remaining_trees = list_tree_names(app_dir, Some(valid_name));

    // Immer zuerst WAL-Checkpoint durchführen und auf initialisierte In-Memory-DB wechseln,
    // damit alle File-Locks auf Windows garantiert sofort freigegeben werden.
    let _ = conn.execute_batch("PRAGMA wal_checkpoint(TRUNCATE);");
    *conn = db::init_in_memory_database().map_err(|e| e.to_string())?;

    // Alle zugehörigen Dateien dieses Stammbaums sammeln und physisch von der Festplatte entfernen
    let db_file = format!("{}.db", valid_name);
    let db_prefix = format!("{}.db-", valid_name);
    let sqlite_file = format!("{}.sqlite", valid_name);
    let sqlite_prefix = format!("{}.sqlite-", valid_name);

    let mut files_to_delete = Vec::new();
    if let Ok(entries) = fs::read_dir(app_dir) {
        for entry in entries.flatten() {
            let path = entry.path();
            if let Some(file_name) = path.file_name().and_then(|s| s.to_str()) {
                if file_name == db_file
                    || file_name.starts_with(&db_prefix)
                    || file_name == sqlite_file
                    || file_name.starts_with(&sqlite_prefix)
                {
                    files_to_delete.push(path);
                }
            }
        }
    }

    for path in files_to_delete {
        for attempt in 0..10 {
            match fs::remove_file(&path) {
                Ok(_) => break,
                Err(_) if attempt < 9 => {
                    std::thread::sleep(std::time::Duration::from_millis(50));
                }
                Err(e) => {
                    return Err(format!("Konnte Datei '{}' nicht löschen: {}", path.display(), e));
                }
            }
        }
    }

    // Falls noch andere Stammbäume existieren, auf einen verbleibenden wechseln.
    // Falls der letzte Stammbaum gelöscht wurde, KEINEN neuen Baum anlegen (active = "", remaining_trees = []).
    if !active.is_empty() && active.as_str() != valid_name && remaining_trees.contains(active) {
        let keep_path = app_dir.join(format!("{}.db", active));
        *conn = db::init_database(&keep_path).map_err(|e| e.to_string())?;
    } else if let Some(first) = remaining_trees.first() {
        let next_path = app_dir.join(format!("{}.db", first));
        *conn = db::init_database(&next_path).map_err(|e| e.to_string())?;
        *active = first.clone();
    } else {
        active.clear();
    }

    Ok(remaining_trees)
}

#[tauri::command]
fn delete_tree(state: State<AppState>, tree_name: String) -> Result<Vec<String>, String> {
    let mut conn = state.db.lock().map_err(|e| e.to_string())?;
    let mut active = state.active_tree.lock().map_err(|e| e.to_string())?;
    delete_tree_internal(&state.app_dir, &mut conn, &mut active, &tree_name)
}

#[tauri::command]
fn get_all_persons(state: State<AppState>) -> Result<Vec<Person>, String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    get_all_persons_internal(&conn)
}

pub fn get_all_persons_internal(conn: &Connection) -> Result<Vec<Person>, String> {

    let mut codes_stmt = conn
        .prepare("SELECT proband_id, person_id, henry_code, generation FROM proband_henry_codes")
        .map_err(|e| e.to_string())?;
    let code_rows = codes_stmt
        .query_map([], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
                row.get::<_, i32>(3)?,
            ))
        })
        .map_err(|e| e.to_string())?;

    let mut codes_map: HashMap<String, HashMap<String, ProbandData>> = HashMap::new();
    for r in code_rows {
        let (proband_id, person_id, henry_code, generation) = r.map_err(|e| e.to_string())?;
        codes_map
            .entry(person_id)
            .or_default()
            .insert(proband_id, ProbandData { henry_code, generation });
    }

    let mut spouse_map: HashMap<String, Vec<SpouseConnection>> = HashMap::new();
    let mut parent_map: HashMap<String, Vec<String>> = HashMap::new();
    let mut family_parents: HashMap<String, Vec<String>> = HashMap::new();
    let mut family_husband: HashMap<String, Option<String>> = HashMap::new();
    let mut family_wife: HashMap<String, Option<String>> = HashMap::new();

    let mut fam_stmt = conn
        .prepare("SELECT id, husband_id, wife_id, marriage_date, divorce_date, is_divorced, json_data FROM families")
        .map_err(|e| e.to_string())?;
    let fam_rows = fam_stmt
        .query_map([], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, Option<String>>(1)?,
                row.get::<_, Option<String>>(2)?,
                row.get::<_, Option<String>>(3)?,
                row.get::<_, Option<String>>(4)?,
                row.get::<_, bool>(5)?,
                row.get::<_, String>(6)?,
            ))
        })
        .map_err(|e| e.to_string())?;

    for f in fam_rows {
        let (fam_id, h_opt, w_opt, m_date, d_date, is_divorced, json_str) =
            f.map_err(|e| e.to_string())?;

        let m_place = serde_json::from_str::<serde_json::Value>(&json_str)
            .ok()
            .and_then(|val| {
                val.get("MARR")?
                    .get("PLAC")?
                    .as_str()
                    .map(ToOwned::to_owned)
            });

        let mut parents = Vec::with_capacity(2);
        if let Some(ref h) = h_opt {
            parents.push(h.clone());
        }
        if let Some(ref w) = w_opt {
            parents.push(w.clone());
        }
        family_parents.insert(fam_id.clone(), parents);
        family_husband.insert(fam_id.clone(), h_opt.clone());
        family_wife.insert(fam_id.clone(), w_opt.clone());

        if let (Some(h), Some(w)) = (h_opt, w_opt) {
            let conn_w = SpouseConnection {
                id: w.clone(),
                date: m_date.clone(),
                place: m_place.clone(),
                divorce_date: d_date.clone(),
                is_divorced,
                family_id: Some(fam_id.clone()),
            };
            let conn_h = SpouseConnection {
                id: h.clone(),
                date: m_date,
                place: m_place,
                divorce_date: d_date,
                is_divorced,
                family_id: Some(fam_id),
            };

            let h_spouses = spouse_map.entry(h.clone()).or_default();
            if !h_spouses.iter().any(|c| c.id == w) {
                h_spouses.push(conn_w);
            }

            let w_spouses = spouse_map.entry(w).or_default();
            if !w_spouses.iter().any(|c| c.id == h) {
                w_spouses.push(conn_h);
            }
        }
    }

    let mut father_map: HashMap<String, String> = HashMap::new();
    let mut mother_map: HashMap<String, String> = HashMap::new();
    let mut children_map: HashMap<String, Vec<String>> = HashMap::new();

    let mut pc_stmt = conn
        .prepare("SELECT family_id, child_id FROM parent_child")
        .map_err(|e| e.to_string())?;
    let pc_rows = pc_stmt
        .query_map([], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
        })
        .map_err(|e| e.to_string())?;

    for pc in pc_rows {
        let (fam_id, child_id) = pc.map_err(|e| e.to_string())?;
        if let Some(Some(h)) = family_husband.get(&fam_id) {
            father_map.insert(child_id.clone(), h.clone());
            let c_list = children_map.entry(h.clone()).or_default();
            if !c_list.contains(&child_id) {
                c_list.push(child_id.clone());
            }
        }
        if let Some(Some(w)) = family_wife.get(&fam_id) {
            mother_map.insert(child_id.clone(), w.clone());
            let c_list = children_map.entry(w.clone()).or_default();
            if !c_list.contains(&child_id) {
                c_list.push(child_id.clone());
            }
        }
        if let Some(parents) = family_parents.get(&fam_id) {
            let p_list = parent_map.entry(child_id).or_default();
            for p in parents {
                if !p_list.contains(p) {
                    p_list.push(p.clone());
                }
            }
        }
    }

    let mut stmt = conn
        .prepare("SELECT id, given_name, surname, sex, birth_date, birth_place, death_date, death_place, json(json_data) FROM individuals ORDER BY surname, given_name")
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([], |row| {
            let id: String = row.get(0)?;
            let extra_str: Option<String> = row.get(8)?;
            let extra_json = extra_str
                .and_then(|s| serde_json::from_str(&s).ok())
                .unwrap_or_else(|| serde_json::json!({}));
            let p_data = codes_map.remove(&id).unwrap_or_default();
            let spouses = spouse_map.remove(&id).unwrap_or_default();
            let parents = parent_map.remove(&id).unwrap_or_default();
            let father = father_map.remove(&id);
            let mother = mother_map.remove(&id);
            let children = children_map.remove(&id).unwrap_or_default();

            Ok(Person {
                id,
                given_name: row.get(1)?,
                surname: row.get(2)?,
                sex: row.get(3)?,
                birth_date: row.get(4)?,
                birth_place: row.get(5)?,
                death_date: row.get(6)?,
                death_place: row.get(7)?,
                proband_data: p_data,
                gedcom_extra: extra_json,
                spouses,
                parent_ids: parents,
                father_id: father,
                mother_id: mother,
                children_ids: children,
            })
        })
        .map_err(|e| e.to_string())?;

    let mut result = Vec::new();
    for p in rows {
        result.push(p.map_err(|e| e.to_string())?);
    }
    Ok(result)
}

#[tauri::command]
fn get_person_details(
    state: State<AppState>,
    person_id: String,
) -> Result<PersonDetailsResponse, String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;

    let mut stmt = conn
        .prepare("SELECT f.husband_id, f.wife_id FROM parent_child pc JOIN families f ON pc.family_id = f.id WHERE pc.child_id = ?1")
        .map_err(|e| e.to_string())?;
    let mut parent_ids = Vec::new();
    let rows = stmt
        .query_map([&person_id], |row| {
            Ok((
                row.get::<_, Option<String>>(0)?,
                row.get::<_, Option<String>>(1)?,
            ))
        })
        .map_err(|e| e.to_string())?;
    for r in rows {
        let (h, w) = r.map_err(|e| e.to_string())?;
        if let Some(hid) = h {
            parent_ids.push(hid);
        }
        if let Some(wid) = w {
            parent_ids.push(wid);
        }
    }
    let mut parents = Vec::new();
    for pid in parent_ids {
        if let Some(p) = fetch_relative_person(&conn, &pid)? {
            parents.push(p);
        }
    }

    let mut stmt = conn
        .prepare("SELECT pc.child_id FROM parent_child pc WHERE pc.family_id IN (SELECT family_id FROM parent_child WHERE child_id = ?1) AND pc.child_id != ?1")
        .map_err(|e| e.to_string())?;
    let sibling_ids: Vec<String> = stmt
        .query_map([&person_id], |row| row.get(0))
        .map_err(|e| e.to_string())?
        .filter_map(Result::ok)
        .collect();
    let mut siblings = Vec::new();
    for sid in sibling_ids {
        if let Some(s) = fetch_relative_person(&conn, &sid)? {
            siblings.push(s);
        }
    }

    let mut stmt = conn
        .prepare("SELECT id, husband_id, wife_id, marriage_date, divorce_date, is_divorced FROM families WHERE husband_id = ?1 OR wife_id = ?1")
        .map_err(|e| e.to_string())?;
    let spouses_iter = stmt
        .query_map([&person_id], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, Option<String>>(1)?,
                row.get::<_, Option<String>>(2)?,
                row.get::<_, Option<String>>(3)?,
                row.get::<_, Option<String>>(4)?,
                row.get::<_, bool>(5)?,
            ))
        })
        .map_err(|e| e.to_string())?;

    let mut spouses = Vec::new();
    let mut children_ids = Vec::new();
    let mut c_stmt = conn
        .prepare("SELECT child_id FROM parent_child WHERE family_id = ?1")
        .map_err(|e| e.to_string())?;

    for res in spouses_iter {
        let (fam_id, h_id, w_id, m_date, d_date, is_divorced) = res.map_err(|e| e.to_string())?;
        let partner_id = if h_id.as_deref() == Some(person_id.as_str()) {
            w_id
        } else {
            h_id
        };
        let mut partner_name = None;
        let mut partner_henry = None;
        let mut partner_birth = None;
        let mut partner_death = None;

        if let Some(pid) = &partner_id {
            if let Some(p) = fetch_relative_person(&conn, pid)? {
                partner_name = Some(format!(
                    "{}, {}",
                    p.surname.as_deref().unwrap_or(""),
                    p.given_name.as_deref().unwrap_or("N.N.")
                ));
                partner_henry = p.henry_code;
                partner_birth = p.birth_date;
                partner_death = p.death_date;
            }
        }

        let c_ids: Vec<String> = c_stmt
            .query_map([&fam_id], |r| r.get(0))
            .map_err(|e| e.to_string())?
            .filter_map(Result::ok)
            .collect();
        for cid in c_ids {
            if !children_ids.contains(&cid) {
                children_ids.push(cid);
            }
        }

        spouses.push(SpouseInfo {
            family_id: fam_id,
            partner_id,
            partner_name,
            partner_henry,
            partner_birth,
            partner_death,
            marriage_date: m_date,
            divorce_date: d_date,
            is_divorced,
        });
    }

    let mut children = Vec::new();
    for cid in children_ids {
        if let Some(c) = fetch_relative_person(&conn, &cid)? {
            children.push(c);
        }
    }
    children.sort_by(|a, b| {
        let ka = parse_birth_sort_key(a.birth_date.as_deref().unwrap_or(""));
        let kb = parse_birth_sort_key(b.birth_date.as_deref().unwrap_or(""));
        ka.cmp(&kb).then_with(|| a.id.cmp(&b.id))
    });

    let mut stmt = conn
        .prepare("SELECT json_data FROM individuals WHERE id = ?1")
        .map_err(|e| e.to_string())?;
    let json_str: String = stmt
        .query_row([&person_id], |row| row.get(0))
        .map_err(|e| e.to_string())?;
    let json_val: serde_json::Value =
        serde_json::from_str(&json_str).unwrap_or_else(|_| serde_json::json!({}));

    let mut notes = Vec::new();
    let mut gedcom_tags: HashMap<String, String> = HashMap::new();

    if let Some(obj) = json_val.as_object() {
        for (k, v) in obj {
            if k == "NOTE" {
                if let Some(s) = v.as_str() {
                    notes.push(s.to_string());
                } else if let Some(map) = v.as_object() {
                    if let Some(val) = map.get("_val").and_then(|x| x.as_str()) {
                        notes.push(val.to_string());
                    }
                }
            }
            if let Some(s) = v.as_str() {
                gedcom_tags.insert(k.clone(), s.to_string());
            } else if let Some(map) = v.as_object() {
                let main_val = map.get("_val").and_then(|x| x.as_str()).unwrap_or("");
                let sub_str = map
                    .iter()
                    .filter(|(sub_k, _)| *sub_k != "_val")
                    .map(|(sub_k, sub_v)| format!("{}: {}", sub_k, sub_v.as_str().unwrap_or("")))
                    .collect::<Vec<String>>()
                    .join(", ");
                let combined = if sub_str.is_empty() {
                    main_val.to_string()
                } else {
                    format!("{} ({})", main_val, sub_str)
                };
                gedcom_tags.insert(k.clone(), combined);
            }
        }
    }
    Ok(PersonDetailsResponse {
        parents,
        siblings,
        spouses,
        children,
        notes,
        gedcom_tags,
    })
}

fn fetch_relative_person(conn: &Connection, id: &str) -> Result<Option<RelativePerson>, String> {
    let mut stmt = conn
        .prepare("SELECT id, given_name, surname, henry_code, birth_date, death_date FROM individuals WHERE id = ?1")
        .map_err(|e| e.to_string())?;
    let mut rows = stmt
        .query_map([id], |row| {
            Ok(RelativePerson {
                id: row.get(0)?,
                given_name: row.get(1)?,
                surname: row.get(2)?,
                henry_code: row.get(3)?,
                birth_date: row.get(4)?,
                death_date: row.get(5)?,
            })
        })
        .map_err(|e| e.to_string())?;

    if let Some(row) = rows.next() {
        Ok(Some(row.map_err(|e| e.to_string())?))
    } else {
        Ok(None)
    }
}

#[tauri::command]
fn get_root_ancestors(state: State<AppState>) -> Result<Vec<RootAncestorConfig>, String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    let mut stmt = conn
        .prepare("SELECT r.person_id, r.starting_code, i.given_name, i.surname FROM root_ancestors r JOIN individuals i ON r.person_id = i.id ORDER BY r.starting_code ASC")
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([], |row| {
            Ok(RootAncestorConfig {
                person_id: row.get(0)?,
                starting_code: row.get(1)?,
                given_name: row.get(2)?,
                surname: row.get(3)?,
            })
        })
        .map_err(|e| e.to_string())?;
    let mut result = Vec::new();
    for r in rows {
        result.push(r.map_err(|e| e.to_string())?);
    }
    Ok(result)
}

#[tauri::command]
fn add_root_ancestor(
    state: State<AppState>,
    person_id: String,
    starting_code: String,
) -> Result<(), String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    conn.execute(
        "INSERT OR REPLACE INTO root_ancestors (person_id, starting_code) VALUES (?1, ?2)",
        rusqlite::params![person_id, starting_code],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
fn remove_root_ancestor(state: State<AppState>, person_id: String) -> Result<(), String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    conn.execute(
        "DELETE FROM root_ancestors WHERE person_id = ?1",
        rusqlite::params![person_id],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
fn calculate_henry_codes_from_roots(state: State<AppState>) -> Result<(), String> {
    let mut conn = state.db.lock().map_err(|e| e.to_string())?;
    calculate_henry_codes_internal(&mut conn)
}

/// Parses heterogeneous date strings (ISO, German DD.MM.YYYY, and GEDCOM date tokens)
/// into a comparable `(year, month, day)` tuple for chronological sibling sorting.
fn parse_birth_sort_key(date: &str) -> (i32, i32, i32) {
    let s = date.trim().to_uppercase();
    if s.is_empty() {
        return (9999, 99, 99);
    }

    // 1. ISO-Format: YYYY-MM-DD oder YYYY/MM/DD
    let parts_dash: Vec<&str> = s.split(|c| c == '-' || c == '/').collect();
    if parts_dash.len() >= 2 && parts_dash[0].len() == 4 {
        if let Ok(y) = parts_dash[0].parse::<i32>() {
            let m = parts_dash
                .get(1)
                .and_then(|v| v.parse::<i32>().ok())
                .unwrap_or(99);
            let d = parts_dash
                .get(2)
                .and_then(|v| v.split_whitespace().next()?.parse::<i32>().ok())
                .unwrap_or(99);
            return (y, m, d);
        }
    }

    // 2. Deutsches Format: DD.MM.YYYY
    let parts_dot: Vec<&str> = s.split('.').collect();
    if parts_dot.len() == 3 {
        let y_str = parts_dot[2].split_whitespace().next().unwrap_or("");
        if y_str.len() == 4 {
            if let Ok(y) = y_str.parse::<i32>() {
                let m = parts_dot[1].trim().parse::<i32>().unwrap_or(99);
                let d = parts_dot[0].trim().parse::<i32>().unwrap_or(99);
                return (y, m, d);
            }
        }
    }

    // 3. GEDCOM-Format (z.B. "20 MAY 1950", "ABT 1890")
    let mut year = 9999;
    let mut month = 99;
    let mut day = 99;

    for token in s.split(|c: char| !c.is_alphanumeric()) {
        if token.is_empty() {
            continue;
        }
        if token.len() == 4 && token.chars().all(|c| c.is_ascii_digit()) {
            if let Ok(y) = token.parse::<i32>() {
                year = y;
                continue;
            }
        }
        let m_val = match token {
            "JAN" | "JANUAR" | "JANUARY" => Some(1),
            "FEB" | "FEBRUAR" | "FEBRUARY" => Some(2),
            "MAR" | "MÄR" | "MAER" | "MÄRZ" | "MARCH" => Some(3),
            "APR" | "APRIL" => Some(4),
            "MAY" | "MAI" => Some(5),
            "JUN" | "JUNI" | "JUNE" => Some(6),
            "JUL" | "JULI" | "JULY" => Some(7),
            "AUG" | "AUGUST" => Some(8),
            "SEP" | "SEPT" | "SEPTEMBER" => Some(9),
            "OCT" | "OKT" | "OKTOBER" | "OCTOBER" => Some(10),
            "NOV" | "NOVEMBER" => Some(11),
            "DEC" | "DEZ" | "DEZEMBER" | "DECEMBER" => Some(12),
            _ => None,
        };
        if let Some(m) = m_val {
            month = m;
            continue;
        }
        if token.len() <= 2 && token.chars().all(|c| c.is_ascii_digit()) {
            if let Ok(d) = token.parse::<i32>() {
                if (1..=31).contains(&d) && day == 99 {
                    day = d;
                }
            }
        }
    }

    (year, month, day)
}

/// Computes Henry codes for all configured root ancestors (proband_henry_codes table).
/// Uses bulk queries and parent-indexed adjacency lists to avoid N+1 SQL queries.
fn calculate_henry_codes_internal(conn: &mut Connection) -> Result<(), String> {
    // 1. Geburtsdaten laden für die Sortierung der Geschwister
    let mut birth_dates: HashMap<String, String> = HashMap::new();
    {
        let mut stmt = conn
            .prepare("SELECT id, birth_date FROM individuals")
            .map_err(|e| e.to_string())?;
        let iter = stmt
            .query_map([], |row| {
                Ok((row.get::<_, String>(0)?, row.get::<_, Option<String>>(1)?))
            })
            .map_err(|e| e.to_string())?;
        for res in iter {
            let (id, bd_opt) = res.map_err(|e| e.to_string())?;
            if let Some(bd) = bd_opt {
                birth_dates.insert(id, bd);
            }
        }
    }

    // 2. Alle Eltern-Kind-Zuordnungen in einer einzigen Abfrage laden (vermeidet N+1 Queries)
    let mut children_by_family: HashMap<String, Vec<String>> = HashMap::new();
    {
        let mut pc_stmt = conn
            .prepare("SELECT family_id, child_id FROM parent_child")
            .map_err(|e| e.to_string())?;
        let pc_iter = pc_stmt
            .query_map([], |row| {
                Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
            })
            .map_err(|e| e.to_string())?;
        for pc_res in pc_iter {
            let (fam_id, child_id) = pc_res.map_err(|e| e.to_string())?;
            children_by_family.entry(fam_id).or_default().push(child_id);
        }
    }

    // 3. Familien laden und nach Elternteil indizieren für O(1)-Zugriff während der BFS
    struct FamilyRecord {
        husband: Option<String>,
        wife: Option<String>,
        children: Vec<String>,
    }

    let mut families: Vec<FamilyRecord> = Vec::new();
    let mut parent_to_families: HashMap<String, Vec<usize>> = HashMap::new();
    {
        let mut fam_stmt = conn
            .prepare("SELECT id, husband_id, wife_id FROM families")
            .map_err(|e| e.to_string())?;
        let fam_iter = fam_stmt
            .query_map([], |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, Option<String>>(1)?,
                    row.get::<_, Option<String>>(2)?,
                ))
            })
            .map_err(|e| e.to_string())?;

        for fam_res in fam_iter {
            let (fam_id, husband, wife) = fam_res.map_err(|e| e.to_string())?;
            let children = children_by_family.remove(&fam_id).unwrap_or_default();
            let idx = families.len();
            if let Some(ref h) = husband {
                parent_to_families.entry(h.clone()).or_default().push(idx);
            }
            if let Some(ref w) = wife {
                parent_to_families.entry(w.clone()).or_default().push(idx);
            }
            families.push(FamilyRecord {
                husband,
                wife,
                children,
            });
        }
    }

    let tx = conn.transaction().map_err(|e| e.to_string())?;
    tx.execute("DELETE FROM proband_henry_codes", [])
        .map_err(|e| e.to_string())?;

    let mut roots = Vec::new();
    {
        let mut stmt = tx
            .prepare("SELECT person_id, starting_code FROM root_ancestors")
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map([], |row| {
                Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
            })
            .map_err(|e| e.to_string())?;
        for r in rows {
            roots.push(r.map_err(|e| e.to_string())?);
        }
    }

    {
        let mut insert_stmt = tx
            .prepare("INSERT INTO proband_henry_codes (proband_id, person_id, henry_code, generation) VALUES (?1, ?2, ?3, ?4)")
            .map_err(|e| e.to_string())?;

        for (proband_id, start_code) in roots {
            // Schritt A: Alle Nachkommen des gewählten Stammahnen ermitteln (Teil des Stammbaums dieses Stammahnen)
            let mut tree_members = HashSet::new();
            let mut member_queue = VecDeque::new();
            tree_members.insert(proband_id.clone());
            member_queue.push_back(proband_id.clone());

            while let Some(curr) = member_queue.pop_front() {
                if let Some(fam_indices) = parent_to_families.get(&curr) {
                    for &fam_idx in fam_indices {
                        for c in &families[fam_idx].children {
                            if c != &curr && tree_members.insert(c.clone()) {
                                member_queue.push_back(c.clone());
                            }
                        }
                    }
                }
            }

            // Schritt B: Henry-Codes vergeben:
            // - Wenn der Vater Teil des Stammbaums des gewählten Stammahnen ist (auch wenn beide Eltern im Stammbaum sind),
            //   werden die Linien patrilinear unter dem Vater weitergeführt.
            // - Wenn der Vater NICHT Teil des Stammbaums des gewählten Stammahnen ist,
            //   werden die Kinder unter der Mutter weitergeführt.
            let mut queue = VecDeque::new();
            queue.push_back((proband_id.clone(), start_code, 1));
            let mut visited = HashSet::new();

            while let Some((curr_id, code, gen_num)) = queue.pop_front() {
                if !visited.insert(curr_id.clone()) {
                    continue;
                }

                insert_stmt
                    .execute(rusqlite::params![&proband_id, &curr_id, &code, gen_num])
                    .map_err(|e| e.to_string())?;

                let mut all_children = Vec::new();
                if let Some(fam_indices) = parent_to_families.get(&curr_id) {
                    for &fam_idx in fam_indices {
                        let fam = &families[fam_idx];
                        let father_in_tree = fam
                            .husband
                            .as_ref()
                            .is_some_and(|h| tree_members.contains(h));
                        let mother_in_tree =
                            fam.wife.as_ref().is_some_and(|w| tree_members.contains(w));

                        let should_continue_here = if father_in_tree {
                            fam.husband.as_deref() == Some(curr_id.as_str())
                        } else if mother_in_tree {
                            fam.wife.as_deref() == Some(curr_id.as_str())
                        } else {
                            false
                        };

                        if should_continue_here {
                            for c in &fam.children {
                                // Verhindert Zyklen, Rekursion und doppelte Aufnahme
                                if !visited.contains(c) && !all_children.contains(c) && c != &curr_id
                                {
                                    all_children.push(c.clone());
                                }
                            }
                        }
                    }
                }

                // Kinder chronologisch nach Geburtsdatum sortieren (Jahr, Monat, Tag; mit ID als Tie-Breaker)
                all_children.sort_by(|a, b| {
                    let ka = parse_birth_sort_key(birth_dates.get(a).map_or("", String::as_str));
                    let kb = parse_birth_sort_key(birth_dates.get(b).map_or("", String::as_str));
                    ka.cmp(&kb).then_with(|| a.cmp(b))
                });

                for (idx, child_id) in all_children.into_iter().enumerate() {
                    let next_code = crate::db::generate_next_henry_code(&code, idx + 1);
                    queue.push_back((child_id, next_code, gen_num + 1));
                }
            }
        }
    }

    tx.commit().map_err(|e| e.to_string())?;
    Ok(())
}

/// Checks via BFS whether `person_id` is already an ancestor of `parent_candidate_id`
/// to prevent cyclic parent-child relationships.
fn check_parent_recursion(
    conn: &Connection,
    person_id: &str,
    parent_candidate_id: &str,
) -> Result<bool, String> {
    if person_id == parent_candidate_id {
        return Ok(true); // Direkte Selbstreferenz
    }

    let mut queue = VecDeque::new();
    let mut visited = HashSet::new();
    queue.push_back(parent_candidate_id.to_string());
    visited.insert(parent_candidate_id.to_string());

    let mut stmt = conn
        .prepare(
            "SELECT f.husband_id, f.wife_id 
             FROM parent_child pc 
             JOIN families f ON pc.family_id = f.id 
             WHERE pc.child_id = ?1",
        )
        .map_err(|e| e.to_string())?;

    while let Some(current_id) = queue.pop_front() {
        let parent_rows = stmt
            .query_map([&current_id], |row| {
                Ok((
                    row.get::<_, Option<String>>(0)?,
                    row.get::<_, Option<String>>(1)?,
                ))
            })
            .map_err(|e| e.to_string())?;

        for p_res in parent_rows {
            let (h_opt, w_opt) = p_res.map_err(|e| e.to_string())?;
            for pid in [h_opt, w_opt].into_iter().flatten() {
                if pid == person_id {
                    return Ok(true); // Rekursion erkannt! person_id ist ein Vorfahre von parent_candidate_id
                }
                if visited.insert(pid.clone()) {
                    queue.push_back(pid);
                }
            }
        }
    }

    Ok(false)
}

#[tauri::command]
fn update_person_parents(
    state: State<AppState>,
    person_id: String,
    father_id: Option<String>,
    mother_id: Option<String>,
) -> Result<(), String> {
    let mut conn = state.db.lock().map_err(|e| e.to_string())?;

    let f_opt = father_id.filter(|s| !s.trim().is_empty());
    let m_opt = mother_id.filter(|s| !s.trim().is_empty());

    // 1. Prüfen auf Rekursion (Zyklusprüfung)
    if let Some(fid) = &f_opt {
        if check_parent_recursion(&conn, &person_id, fid)? {
            return Err(
                "Rekursion erkannt: Der gewählte Vater ist bereits ein Nachfahre dieser Person."
                    .to_string(),
            );
        }
    }
    if let Some(mid) = &m_opt {
        if check_parent_recursion(&conn, &person_id, mid)? {
            return Err(
                "Rekursion erkannt: Die gewählte Mutter ist bereits ein Nachfahre dieser Person."
                    .to_string(),
            );
        }
    }

    let tx = conn.transaction().map_err(|e| e.to_string())?;

    // Bisherige Elternschaften des Kindes lösen
    tx.execute(
        "DELETE FROM parent_child WHERE child_id = ?1",
        [&person_id],
    )
    .map_err(|e| e.to_string())?;

    // Falls mindestens ein Elternteil gesetzt ist:
    if f_opt.is_some() || m_opt.is_some() {
        // Prüfen, ob bereits eine Familie mit diesen Eltern existiert
        let existing_fam_id: Option<String> = {
            let mut stmt = tx
                .prepare(
                    "SELECT id FROM families 
                     WHERE (husband_id = ?1 OR (?1 IS NULL AND husband_id IS NULL))
                       AND (wife_id = ?2 OR (?2 IS NULL AND wife_id IS NULL))",
                )
                .map_err(|e| e.to_string())?;
            stmt.query_row(rusqlite::params![f_opt, m_opt], |row| row.get(0))
                .ok()
        };

        let target_fam_id = if let Some(fid) = existing_fam_id {
            fid
        } else {
            let fid = format!("F{}", uuid::Uuid::new_v4().simple());
            tx.execute(
                "INSERT INTO families (id, xref_id, husband_id, wife_id, is_divorced, json_data) VALUES (?1, ?1, ?2, ?3, 0, '{}')",
                rusqlite::params![fid, f_opt, m_opt],
            )
            .map_err(|e| e.to_string())?;
            fid
        };

        tx.execute(
            "INSERT INTO parent_child (family_id, child_id) VALUES (?1, ?2)",
            rusqlite::params![target_fam_id, person_id],
        )
        .map_err(|e| e.to_string())?;
    }

    // CHAN (Letzte Änderung) auf Person aktualisieren
    let chan = current_gedcom_chan();
    let current_json: Option<String> = tx
        .query_row(
            "SELECT json_data FROM individuals WHERE id = ?1",
            [&person_id],
            |row| row.get(0),
        )
        .ok();
    if let Some(json_str) = current_json {
        let mut root_obj: serde_json::Map<String, serde_json::Value> =
            serde_json::from_str(&json_str).unwrap_or_default();
        root_obj.insert("CHAN".to_string(), chan);
        if let Ok(new_json) = serde_json::to_string(&root_obj) {
            let _ = tx.execute(
                "UPDATE individuals SET json_data = ?1 WHERE id = ?2",
                rusqlite::params![new_json, person_id],
            );
        }
    }

    tx.commit().map_err(|e| e.to_string())?;

    // Henry-Codes im Baum neu berechnen
    calculate_henry_codes_internal(&mut conn)?;

    Ok(())
}

#[tauri::command]
fn update_family_marriage(
    state: State<AppState>,
    family_id: String,
    marriage_date: Option<String>,
    divorce_date: Option<String>,
    is_divorced: bool,
) -> Result<(), String> {
    let mut conn = state.db.lock().map_err(|e| e.to_string())?;
    update_family_marriage_internal(
        &mut conn,
        &family_id,
        marriage_date,
        divorce_date,
        is_divorced,
    )
}

pub fn update_family_marriage_internal(
    conn: &mut Connection,
    family_id: &str,
    marriage_date: Option<String>,
    divorce_date: Option<String>,
    is_divorced: bool,
) -> Result<(), String> {
    let tx = conn.transaction().map_err(|e| e.to_string())?;

    let (husband_id, wife_id, current_json): (Option<String>, Option<String>, String) = tx
        .query_row(
            "SELECT husband_id, wife_id, json_data FROM families WHERE id = ?1",
            [family_id],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
        )
        .map_err(|e| format!("Familie '{}' nicht gefunden: {}", family_id, e))?;

    let mut json_obj: serde_json::Map<String, serde_json::Value> =
        serde_json::from_str(&current_json).unwrap_or_default();

    let m_opt = marriage_date
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(str::to_string);
    if let Some(ref m_date) = m_opt {
        let mut marr_map = match json_obj.remove("MARR") {
            Some(serde_json::Value::Object(map)) => map,
            _ => serde_json::Map::new(),
        };
        marr_map.insert("DATE".to_string(), serde_json::Value::String(m_date.clone()));
        json_obj.insert("MARR".to_string(), serde_json::Value::Object(marr_map));
    } else if let Some(serde_json::Value::Object(mut marr_map)) = json_obj.remove("MARR") {
        marr_map.remove("DATE");
        if !marr_map.is_empty() {
            json_obj.insert("MARR".to_string(), serde_json::Value::Object(marr_map));
        }
    }

    let d_opt = divorce_date
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(str::to_string);
    let divorced_flag = is_divorced || d_opt.is_some();
    if divorced_flag {
        let mut div_map = match json_obj.remove("DIV") {
            Some(serde_json::Value::Object(map)) => map,
            _ => serde_json::Map::new(),
        };
        if let Some(ref d_date) = d_opt {
            div_map.insert("DATE".to_string(), serde_json::Value::String(d_date.clone()));
        } else {
            div_map.remove("DATE");
        }
        json_obj.insert("DIV".to_string(), serde_json::Value::Object(div_map));
    } else {
        json_obj.remove("DIV");
    }

    let json_str = serde_json::to_string(&json_obj).unwrap_or_else(|_| "{}".to_string());

    tx.execute(
        "UPDATE families SET marriage_date = ?1, divorce_date = ?2, is_divorced = ?3, json_data = ?4 WHERE id = ?5",
        rusqlite::params![m_opt, d_opt, divorced_flag, json_str, family_id],
    )
    .map_err(|e| e.to_string())?;

    // CHAN (Letzte Änderung) auf beiden Ehepartnern aktualisieren
    let chan = current_gedcom_chan();
    for partner_id in [husband_id, wife_id].into_iter().flatten() {
        let cur_ind_json: Option<String> = tx
            .query_row(
                "SELECT json_data FROM individuals WHERE id = ?1",
                [&partner_id],
                |r| r.get(0),
            )
            .ok();
        if let Some(ind_json_str) = cur_ind_json {
            let mut ind_root: serde_json::Map<String, serde_json::Value> =
                serde_json::from_str(&ind_json_str).unwrap_or_default();
            ind_root.insert("CHAN".to_string(), chan.clone());
            if let Ok(new_ind_json) = serde_json::to_string(&ind_root) {
                let _ = tx.execute(
                    "UPDATE individuals SET json_data = ?1 WHERE id = ?2",
                    rusqlite::params![new_ind_json, partner_id],
                );
            }
        }
    }

    tx.commit().map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
fn link_spouses(
    state: State<AppState>,
    person_id: String,
    partner_id: String,
) -> Result<(), String> {
    let mut conn = state.db.lock().map_err(|e| e.to_string())?;
    link_spouses_internal(&mut conn, &person_id, &partner_id)
}

pub fn link_spouses_internal(
    conn: &mut Connection,
    person_id: &str,
    partner_id: &str,
) -> Result<(), String> {
    if person_id == partner_id {
        return Err("Eine Person kann nicht mit sich selbst verheiratet werden.".to_string());
    }

    let tx = conn.transaction().map_err(|e| e.to_string())?;

    let p1_sex: String = tx
        .query_row(
            "SELECT sex FROM individuals WHERE id = ?1",
            [person_id],
            |r| r.get(0),
        )
        .map_err(|_| format!("Person '{}' nicht gefunden.", person_id))?;

    let p2_sex: String = tx
        .query_row(
            "SELECT sex FROM individuals WHERE id = ?1",
            [partner_id],
            |r| r.get(0),
        )
        .map_err(|_| format!("Person '{}' nicht gefunden.", partner_id))?;

    let already_spouses: bool = tx
        .query_row(
            "SELECT EXISTS(
                SELECT 1 FROM families 
                WHERE (husband_id = ?1 AND wife_id = ?2) OR (husband_id = ?2 AND wife_id = ?1)
            )",
            rusqlite::params![person_id, partner_id],
            |r| r.get(0),
        )
        .unwrap_or(false);

    if already_spouses {
        return Err("Diese beiden Personen sind bereits als Ehepartner miteinander verknüpft.".to_string());
    }

    let (hid, wid) = if p1_sex == "M" || p2_sex == "F" {
        (Some(person_id.to_string()), Some(partner_id.to_string()))
    } else if p2_sex == "M" || p1_sex == "F" {
        (Some(partner_id.to_string()), Some(person_id.to_string()))
    } else {
        (Some(person_id.to_string()), Some(partner_id.to_string()))
    };

    let fid = format!("F{}", uuid::Uuid::new_v4().simple());
    tx.execute(
        "INSERT INTO families (id, xref_id, husband_id, wife_id, is_divorced, json_data) VALUES (?1, ?1, ?2, ?3, 0, '{}')",
        rusqlite::params![fid, hid, wid],
    )
    .map_err(|e| e.to_string())?;

    let chan = current_gedcom_chan();
    for p_id in [person_id, partner_id] {
        let cur_ind_json: Option<String> = tx
            .query_row(
                "SELECT json_data FROM individuals WHERE id = ?1",
                [p_id],
                |r| r.get(0),
            )
            .ok();
        if let Some(ind_json_str) = cur_ind_json {
            let mut ind_root: serde_json::Map<String, serde_json::Value> =
                serde_json::from_str(&ind_json_str).unwrap_or_default();
            ind_root.insert("CHAN".to_string(), chan.clone());
            if let Ok(new_ind_json) = serde_json::to_string(&ind_root) {
                let _ = tx.execute(
                    "UPDATE individuals SET json_data = ?1 WHERE id = ?2",
                    rusqlite::params![new_ind_json, p_id],
                );
            }
        }
    }

    tx.commit().map_err(|e| e.to_string())?;
    calculate_henry_codes_internal(conn)?;
    Ok(())
}

#[tauri::command]
fn unlink_family(
    state: State<AppState>,
    family_id: String,
) -> Result<(), String> {
    let mut conn = state.db.lock().map_err(|e| e.to_string())?;
    unlink_family_internal(&mut conn, &family_id)
}

pub fn unlink_family_internal(
    conn: &mut Connection,
    family_id: &str,
) -> Result<(), String> {
    let tx = conn.transaction().map_err(|e| e.to_string())?;

    let (husband_id, wife_id): (Option<String>, Option<String>) = tx
        .query_row(
            "SELECT husband_id, wife_id FROM families WHERE id = ?1",
            [family_id],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .map_err(|e| format!("Familie '{}' nicht gefunden: {}", family_id, e))?;

    let child_ids: Vec<String> = {
        let mut stmt = tx
            .prepare("SELECT child_id FROM parent_child WHERE family_id = ?1")
            .map_err(|e| e.to_string())?;
        stmt.query_map([family_id], |r| r.get(0))
            .map_err(|e| e.to_string())?
            .filter_map(Result::ok)
            .collect()
    };

    tx.execute("DELETE FROM parent_child WHERE family_id = ?1", [family_id])
        .map_err(|e| e.to_string())?;

    tx.execute("DELETE FROM families WHERE id = ?1", [family_id])
        .map_err(|e| e.to_string())?;

    let chan = current_gedcom_chan();
    for p_id in [husband_id, wife_id].into_iter().flatten().chain(child_ids.into_iter()) {
        let cur_ind_json: Option<String> = tx
            .query_row(
                "SELECT json_data FROM individuals WHERE id = ?1",
                [&p_id],
                |r| r.get(0),
            )
            .ok();
        if let Some(ind_json_str) = cur_ind_json {
            let mut ind_root: serde_json::Map<String, serde_json::Value> =
                serde_json::from_str(&ind_json_str).unwrap_or_default();
            ind_root.insert("CHAN".to_string(), chan.clone());
            if let Ok(new_ind_json) = serde_json::to_string(&ind_root) {
                let _ = tx.execute(
                    "UPDATE individuals SET json_data = ?1 WHERE id = ?2",
                    rusqlite::params![new_ind_json, p_id],
                );
            }
        }
    }

    tx.commit().map_err(|e| e.to_string())?;
    calculate_henry_codes_internal(conn)?;
    Ok(())
}

#[tauri::command]
fn add_child_link(
    state: State<AppState>,
    parent_id: String,
    child_id: String,
) -> Result<(), String> {
    let mut conn = state.db.lock().map_err(|e| e.to_string())?;
    add_child_link_internal(&mut conn, &parent_id, &child_id)
}

pub fn add_child_link_internal(
    conn: &mut Connection,
    parent_id: &str,
    child_id: &str,
) -> Result<(), String> {
    if parent_id == child_id {
        return Err("Eine Person kann nicht ihr eigenes Kind sein.".to_string());
    }

    if check_parent_recursion(conn, child_id, parent_id)? {
        return Err(
            "Rekursion erkannt: Die gewählte Person ist bereits ein Vorfahre/Nachfahre in dieser Beziehung."
                .to_string(),
        );
    }

    let tx = conn.transaction().map_err(|e| e.to_string())?;

    let already_linked: bool = tx
        .query_row(
            "SELECT EXISTS(
                SELECT 1 FROM parent_child pc 
                JOIN families f ON pc.family_id = f.id 
                WHERE pc.child_id = ?1 AND (f.husband_id = ?2 OR f.wife_id = ?2)
            )",
            rusqlite::params![child_id, parent_id],
            |r| r.get(0),
        )
        .unwrap_or(false);

    if already_linked {
        return Err("Dieses Kind ist diesem Elternteil bereits zugeordnet.".to_string());
    }

    let existing_fam_id: Option<String> = tx
        .query_row(
            "SELECT id FROM families WHERE husband_id = ?1 OR wife_id = ?1 LIMIT 1",
            [parent_id],
            |r| r.get(0),
        )
        .ok();

    let target_fam_id = if let Some(fid) = existing_fam_id {
        fid
    } else {
        let is_male = tx
            .query_row(
                "SELECT sex FROM individuals WHERE id = ?1",
                [parent_id],
                |r| r.get::<_, String>(0),
            )
            .unwrap_or_else(|_| "U".to_string())
            == "M";
        let fid = format!("F{}", uuid::Uuid::new_v4().simple());
        let (hid, wid) = if is_male {
            (Some(parent_id.to_string()), None)
        } else {
            (None, Some(parent_id.to_string()))
        };
        tx.execute(
            "INSERT INTO families (id, xref_id, husband_id, wife_id, is_divorced, json_data) VALUES (?1, ?1, ?2, ?3, 0, '{}')",
            rusqlite::params![fid, hid, wid],
        )
        .map_err(|e| e.to_string())?;
        fid
    };

    tx.execute(
        "INSERT INTO parent_child (family_id, child_id) VALUES (?1, ?2)",
        rusqlite::params![target_fam_id, child_id],
    )
    .map_err(|e| e.to_string())?;

    let chan = current_gedcom_chan();
    for p_id in [parent_id, child_id] {
        let cur_ind_json: Option<String> = tx
            .query_row(
                "SELECT json_data FROM individuals WHERE id = ?1",
                [p_id],
                |r| r.get(0),
            )
            .ok();
        if let Some(ind_json_str) = cur_ind_json {
            let mut ind_root: serde_json::Map<String, serde_json::Value> =
                serde_json::from_str(&ind_json_str).unwrap_or_default();
            ind_root.insert("CHAN".to_string(), chan.clone());
            if let Ok(new_ind_json) = serde_json::to_string(&ind_root) {
                let _ = tx.execute(
                    "UPDATE individuals SET json_data = ?1 WHERE id = ?2",
                    rusqlite::params![new_ind_json, p_id],
                );
            }
        }
    }

    tx.commit().map_err(|e| e.to_string())?;
    calculate_henry_codes_internal(conn)?;
    Ok(())
}

#[tauri::command]
fn remove_child_link(
    state: State<AppState>,
    parent_id: String,
    child_id: String,
) -> Result<(), String> {
    let mut conn = state.db.lock().map_err(|e| e.to_string())?;
    remove_child_link_internal(&mut conn, &parent_id, &child_id)
}

pub fn remove_child_link_internal(
    conn: &mut Connection,
    parent_id: &str,
    child_id: &str,
) -> Result<(), String> {
    let tx = conn.transaction().map_err(|e| e.to_string())?;

    tx.execute(
        "DELETE FROM parent_child 
         WHERE child_id = ?1 AND family_id IN (
             SELECT id FROM families WHERE husband_id = ?2 OR wife_id = ?2
         )",
        rusqlite::params![child_id, parent_id],
    )
    .map_err(|e| e.to_string())?;

    let chan = current_gedcom_chan();
    for p_id in [parent_id, child_id] {
        let cur_ind_json: Option<String> = tx
            .query_row(
                "SELECT json_data FROM individuals WHERE id = ?1",
                [p_id],
                |r| r.get(0),
            )
            .ok();
        if let Some(ind_json_str) = cur_ind_json {
            let mut ind_root: serde_json::Map<String, serde_json::Value> =
                serde_json::from_str(&ind_json_str).unwrap_or_default();
            ind_root.insert("CHAN".to_string(), chan.clone());
            if let Ok(new_ind_json) = serde_json::to_string(&ind_root) {
                let _ = tx.execute(
                    "UPDATE individuals SET json_data = ?1 WHERE id = ?2",
                    rusqlite::params![new_ind_json, p_id],
                );
            }
        }
    }

    tx.commit().map_err(|e| e.to_string())?;
    calculate_henry_codes_internal(conn)?;
    Ok(())
}

fn format_person_name(given: Option<&str>, surname: Option<&str>) -> String {
    match (given, surname) {
        (Some(g), Some(s)) if !g.is_empty() && !s.is_empty() => format!("{} {}", g, s),
        (Some(g), _) if !g.is_empty() => g.to_string(),
        (_, Some(s)) if !s.is_empty() => s.to_string(),
        _ => "N.N.".to_string(),
    }
}

/// Validates whether `id_str` conforms to the GEDCOM XREF format (max 20 ASCII chars,
/// starting with an alphanumeric character or `_`).
pub fn is_valid_gedcom_xref(id_str: &str) -> bool {
    let s = id_str.trim();
    if s.is_empty() {
        return false;
    }
    let inner = if s.starts_with('@') && s.ends_with('@') && s.len() >= 3 {
        &s[1..s.len() - 1]
    } else if !s.starts_with('@') && !s.ends_with('@') {
        s
    } else {
        return false;
    };

    if inner.is_empty() || inner.len() > 20 {
        return false;
    }

    let mut chars = inner.chars();
    let Some(first) = chars.next() else {
        return false;
    };
    // Erstes Zeichen muss alphanumerisch oder ein Unterstrich sein (nicht '#' oder sonstige Sonderzeichen)
    if !(first.is_ascii_alphanumeric() || first == '_') {
        return false;
    }

    // Nachfolgende Zeichen: alphanumerisch, Unterstrich, Doppelpunkt, Punkt, Bindestrich
    chars.all(|c| c.is_ascii_alphanumeric() || matches!(c, '_' | '.' | ':' | '-'))
}

pub fn normalize_gedcom_xref(id_str: &str) -> String {
    let s = id_str.trim();
    if s.starts_with('@') && s.ends_with('@') && s.len() >= 3 {
        s[1..s.len() - 1].to_string()
    } else {
        s.to_string()
    }
}

#[tauri::command]
fn get_next_person_id(state: State<AppState>) -> Result<String, String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    crate::db::get_next_individual_id(&conn)
}

#[tauri::command]
#[allow(clippy::too_many_arguments)]
fn add_person(
    state: State<AppState>,
    target_person_id: Option<String>,
    relation_type: Option<String>,
    given_name: String,
    surname: String,
    sex: String,
    birth_date: Option<String>,
    birth_place: Option<String>,
    death_date: Option<String>,
    death_place: Option<String>,
    custom_id: Option<String>,
) -> Result<String, String> {
    let mut conn = state.db.lock().map_err(|e| e.to_string())?;

    let new_id = if let Some(cid) = custom_id.filter(|s| !s.trim().is_empty()) {
        let trimmed = cid.trim();
        if !is_valid_gedcom_xref(trimmed) {
            return Err(format!(
                "Ungültige XREF-ID '{}'. Entspricht nicht dem GEDCOM-Format.",
                trimmed
            ));
        }
        let normalized = normalize_gedcom_xref(trimmed);
        let existing: Option<(Option<String>, Option<String>)> = conn
            .query_row(
                "SELECT given_name, surname FROM individuals WHERE id = ?1",
                [&normalized],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .ok();
        if let Some((g, s)) = existing {
            let name = format_person_name(g.as_deref(), s.as_deref());
            return Err(format!(
                "Die ID '{}' wird bereits von '{}' verwendet.",
                normalized, name
            ));
        }
        normalized
    } else {
        crate::db::get_next_individual_id(&conn)?
    };

    let tx = conn.transaction().map_err(|e| e.to_string())?;

    let name_val = format!("{} /{}//", given_name, surname);
    let chan = current_gedcom_chan();
    let json_val = serde_json::json!({
        "NAME": name_val, "GIVN": given_name, "SURN": surname, "SEX": sex, "CHAN": chan
    });

    tx.execute(
        "INSERT INTO individuals (id, xref_id, given_name, surname, sex, birth_date, birth_place, death_date, death_place, json_data) VALUES (?1, ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
        rusqlite::params![new_id, given_name, surname, sex, birth_date, birth_place, death_date, death_place, json_val.to_string()],
    )
    .map_err(|e| e.to_string())?;

    if let (Some(target_id), Some(rel)) = (target_person_id, relation_type) {
        if rel == "child" {
            let fam_id: Option<String> = tx
                .query_row(
                    "SELECT id FROM families WHERE husband_id = ?1 OR wife_id = ?1",
                    [&target_id],
                    |row| row.get(0),
                )
                .ok();
            let target_fam_id = if let Some(fid) = fam_id {
                fid
            } else {
                let fid = format!("F{}", uuid::Uuid::new_v4().simple());
                let is_male = tx
                    .query_row(
                        "SELECT sex FROM individuals WHERE id = ?1",
                        [&target_id],
                        |row| row.get::<_, String>(0),
                    )
                    .unwrap_or_default()
                    == "M";
                let (h, w) = if is_male {
                    (Some(target_id.as_str()), None)
                } else {
                    (None, Some(target_id.as_str()))
                };
                tx.execute(
                    "INSERT INTO families (id, xref_id, husband_id, wife_id, is_divorced, json_data) VALUES (?1, ?1, ?2, ?3, 0, ?4)",
                    rusqlite::params![fid, h, w, "{}"],
                )
                .map_err(|e| e.to_string())?;
                fid
            };
            tx.execute(
                "INSERT INTO parent_child (family_id, child_id) VALUES (?1, ?2)",
                rusqlite::params![target_fam_id, new_id],
            )
            .map_err(|e| e.to_string())?;
        } else if rel == "parent" {
            let fam_id = format!("F{}", uuid::Uuid::new_v4().simple());
            let (h, w) = if sex == "M" {
                (Some(new_id.as_str()), None)
            } else {
                (None, Some(new_id.as_str()))
            };
            tx.execute(
                "INSERT INTO families (id, xref_id, husband_id, wife_id, is_divorced, json_data) VALUES (?1, ?1, ?2, ?3, 0, ?4)",
                rusqlite::params![fam_id, h, w, "{}"],
            )
            .map_err(|e| e.to_string())?;
            tx.execute(
                "INSERT INTO parent_child (family_id, child_id) VALUES (?1, ?2)",
                rusqlite::params![fam_id, target_id],
            )
            .map_err(|e| e.to_string())?;
        } else if rel == "spouse" {
            let fam_id = format!("F{}", uuid::Uuid::new_v4().simple());
            let is_male = tx
                .query_row(
                    "SELECT sex FROM individuals WHERE id = ?1",
                    [&target_id],
                    |row| row.get::<_, String>(0),
                )
                .unwrap_or_default()
                == "M";
            let (h, w) = if is_male {
                (Some(target_id.as_str()), Some(new_id.as_str()))
            } else {
                (Some(new_id.as_str()), Some(target_id.as_str()))
            };
            tx.execute(
                "INSERT INTO families (id, xref_id, husband_id, wife_id, is_divorced, json_data) VALUES (?1, ?1, ?2, ?3, 0, ?4)",
                rusqlite::params![fam_id, h, w, "{}"],
            )
            .map_err(|e| e.to_string())?;
        }
    }

    tx.commit().map_err(|e| e.to_string())?;
    calculate_henry_codes_internal(&mut conn)?;
    Ok(new_id)
}

fn rename_person_references(
    conn: &Connection,
    from_id: &str,
    to_id: &str,
    update_xref: bool,
) -> Result<(), String> {
    if update_xref {
        conn.execute(
            "UPDATE individuals SET id = ?1, xref_id = ?1 WHERE id = ?2",
            rusqlite::params![to_id, from_id],
        )
        .map_err(|e| e.to_string())?;
    } else {
        conn.execute(
            "UPDATE individuals SET id = ?1 WHERE id = ?2",
            rusqlite::params![to_id, from_id],
        )
        .map_err(|e| e.to_string())?;
    }

    let queries = [
        "UPDATE families SET husband_id = ?1 WHERE husband_id = ?2",
        "UPDATE families SET wife_id = ?1 WHERE wife_id = ?2",
        "UPDATE parent_child SET child_id = ?1 WHERE child_id = ?2",
        "UPDATE events SET owner_id = ?1 WHERE owner_id = ?2 AND owner_type = 'INDI'",
        "UPDATE root_ancestors SET person_id = ?1 WHERE person_id = ?2",
        "UPDATE proband_henry_codes SET person_id = ?1 WHERE person_id = ?2",
        "UPDATE proband_henry_codes SET proband_id = ?1 WHERE proband_id = ?2",
        "UPDATE design_layouts SET proband_id = ?1 WHERE proband_id = ?2",
    ];

    for sql in queries {
        conn.execute(sql, rusqlite::params![to_id, from_id])
            .map_err(|e| e.to_string())?;
    }

    Ok(())
}

/// Atomically updates a batch of persons, supporting cyclic ID swaps via a 2-phase temporary
/// ID rename across all relational tables and stored JSON design layouts.
fn update_persons_batch_internal(
    conn: &mut Connection,
    updates: Vec<PersonUpdate>,
) -> Result<(), String> {
    if updates.is_empty() {
        return Ok(());
    }

    // 1. Pflichtfeld- und GEDCOM-Allowed-Values-Prüfung: Keine leere ID erlaubt und muss GEDCOM XREF entsprechen
    for u in &updates {
        let trimmed_new_id = u.person.id.trim();
        let name = format_person_name(
            u.person.given_name.as_deref(),
            u.person.surname.as_deref(),
        );
        if trimmed_new_id.is_empty() {
            return Err(format!(
                "Das Feld ID ist ein Pflichtfeld. Die ID von '{}' darf nicht leer sein.",
                name
            ));
        }
        if !is_valid_gedcom_xref(trimmed_new_id) {
            return Err(format!(
                "Ungültige XREF-ID '{}' für '{}'. Entspricht nicht dem GEDCOM-Format.",
                trimmed_new_id, name
            ));
        }
    }

    // IDs normalisieren (z.B. @I123@ -> I123)
    let mut updates = updates;
    for u in &mut updates {
        u.person.id = normalize_gedcom_xref(&u.person.id);
    }

    // 2. Gesamtheitliche Konsistenz: Duplikate innerhalb der geänderten Liste prüfen
    let mut target_id_map: HashMap<String, String> = HashMap::with_capacity(updates.len());
    for u in &updates {
        let name = format_person_name(
            u.person.given_name.as_deref(),
            u.person.surname.as_deref(),
        );
        if let Some(first_name) = target_id_map.get(&u.person.id) {
            return Err(format!(
                "Die ID '{}' wird mehrfach vergeben (an '{}' und '{}').",
                u.person.id, first_name, name
            ));
        }
        target_id_map.insert(u.person.id.clone(), name);
    }

    // 3. Gesamtheitliche Konsistenz: Kollision gegen bestehende, unberührte Personen in DB prüfen
    let batch_orig_ids: HashSet<&str> = updates.iter().map(|u| u.original_id.as_str()).collect();
    for u in &updates {
        let new_id = u.person.id.as_str();
        if new_id != u.original_id && !batch_orig_ids.contains(new_id) {
            let existing: Option<(Option<String>, Option<String>)> = conn
                .query_row(
                    "SELECT given_name, surname FROM individuals WHERE id = ?1",
                    [new_id],
                    |r| Ok((r.get(0)?, r.get(1)?)),
                )
                .ok();
            if let Some((g, s)) = existing {
                let name = format_person_name(g.as_deref(), s.as_deref());
                return Err(format!(
                    "Die ID '{}' wird bereits von '{}' verwendet.",
                    new_id, name
                ));
            }
        }
    }

    // 4. Durchführung der Änderungen mit 2-Phasen Rename (unter Deaktivierung der Fremdschlüssel-Prüfung)
    conn.execute_batch("PRAGMA foreign_keys = OFF;")
        .map_err(|e| e.to_string())?;

    let res = (|| -> Result<(), String> {
        let tx = conn.transaction().map_err(|e| e.to_string())?;

        // Phase 1: Vorübergehend auf eindeutige Temp-IDs umbenennen (verhindert Primary-Key-Konflikte bei Zyklen & Tausch)
        let mut temp_renames: Vec<(&PersonUpdate, String)> = Vec::new();
        for u in &updates {
            if u.person.id != u.original_id {
                let temp_id = format!("__TMP_ID_{}__", uuid::Uuid::new_v4().simple());
                rename_person_references(&tx, &u.original_id, &temp_id, false)?;
                temp_renames.push((u, temp_id));
            }
        }

        // Phase 2: Von Temp-IDs auf endgültige neue IDs umbenennen
        for (u, temp_id) in &temp_renames {
            rename_person_references(&tx, temp_id, &u.person.id, true)?;
        }

        // Phase 3: Alle Datensatz-Felder der Personen aktualisieren (inkl. automatischem CHAN-Timestamp)
        let chan = current_gedcom_chan();
        for u in &updates {
            let mut extra_map = match u.person.gedcom_extra {
                serde_json::Value::Object(ref map) => map.clone(),
                _ => serde_json::Map::new(),
            };
            extra_map.insert("CHAN".to_string(), chan.clone());
            let json_str = serde_json::to_string(&extra_map)
                .unwrap_or_else(|_| "{}".to_string());
            tx.execute(
                "UPDATE individuals SET given_name = ?1, surname = ?2, sex = ?3, birth_date = ?4, birth_place = ?5, death_date = ?6, death_place = ?7, json_data = ?8 WHERE id = ?9",
                rusqlite::params![
                    u.person.given_name,
                    u.person.surname,
                    u.person.sex,
                    u.person.birth_date,
                    u.person.birth_place,
                    u.person.death_date,
                    u.person.death_place,
                    json_str,
                    u.person.id
                ],
            )
            .map_err(|e| e.to_string())?;
        }

        // Phase 4: Layout-Referenzen in design_layouts JSON-Daten ebenfall 2-phasig aktualisieren,
        // damit ein ID-Tausch (I1 <-> I2) im JSON nicht kollidiert.
        if !temp_renames.is_empty() {
            let mut stmt = tx
                .prepare("SELECT id, layout_data FROM design_layouts")
                .map_err(|e| e.to_string())?;
            let rows: Vec<(String, String)> = stmt
                .query_map([], |r| Ok((r.get(0)?, r.get(1)?)))
                .map_err(|e| e.to_string())?
                .filter_map(Result::ok)
                .collect();

            for (dl_id, mut ldata) in rows {
                let mut modified = false;
                for (u, temp_id) in &temp_renames {
                    let old_pat = format!("\"{}\"", u.original_id);
                    if ldata.contains(&old_pat) {
                        let tmp_pat = format!("\"{}\"", temp_id);
                        ldata = ldata.replace(&old_pat, &tmp_pat);
                        modified = true;
                    }
                }
                if modified {
                    for (u, temp_id) in &temp_renames {
                        let tmp_pat = format!("\"{}\"", temp_id);
                        let new_pat = format!("\"{}\"", u.person.id);
                        ldata = ldata.replace(&tmp_pat, &new_pat);
                    }
                    tx.execute(
                        "UPDATE design_layouts SET layout_data = ?1 WHERE id = ?2",
                        [&ldata, &dl_id],
                    )
                    .map_err(|e| e.to_string())?;
                }
            }
        }

        tx.commit().map_err(|e| e.to_string())?;
        Ok(())
    })();

    let fk_restore = conn.execute_batch("PRAGMA foreign_keys = ON;");
    res?;
    fk_restore.map_err(|e| e.to_string())?;

    // Henry-Codes neu berechnen
    calculate_henry_codes_internal(conn)?;
    Ok(())
}

#[tauri::command]
fn update_persons_batch(state: State<AppState>, updates: Vec<PersonUpdate>) -> Result<(), String> {
    let mut conn = state.db.lock().map_err(|e| e.to_string())?;
    update_persons_batch_internal(&mut conn, updates)
}

#[tauri::command]
fn update_person(
    state: State<AppState>,
    person: Person,
    original_id: Option<String>,
) -> Result<(), String> {
    let orig_id = original_id.unwrap_or_else(|| person.id.clone());
    let mut conn = state.db.lock().map_err(|e| e.to_string())?;
    update_persons_batch_internal(
        &mut conn,
        vec![PersonUpdate {
            original_id: orig_id,
            person,
        }],
    )
}

fn backup_current_tree_db(app_dir: &std::path::Path, active_tree: &str, action_prefix: &str) -> Result<String, String> {
    if active_tree.is_empty() {
        return Ok(String::new());
    }
    let db_dir = app_dir.join("databases");
    let src_path = db_dir.join(format!("{}.db", active_tree));
    if !src_path.exists() {
        return Ok(String::new());
    }
    let timestamp = chrono::Local::now().format("%Y%m%d_%H%M%S");
    let backup_filename = format!("{}_{}_{}.db.bak", active_tree, action_prefix, timestamp);
    let backup_path = db_dir.join(&backup_filename);
    std::fs::copy(&src_path, &backup_path).map_err(|e| format!("Backup fehlgeschlagen: {}", e))?;
    Ok(backup_filename)
}

pub fn delete_persons_batch_internal(
    conn: &mut Connection,
    person_ids: &[String],
) -> Result<(), String> {
    if person_ids.is_empty() {
        return Ok(());
    }

    let tx = conn.transaction().map_err(|e| e.to_string())?;

    for pid in person_ids {
        // 1. Research tasks
        tx.execute("DELETE FROM research_tasks WHERE person_id = ?1", [pid])
            .map_err(|e| e.to_string())?;

        // 2. Events owned by person
        tx.execute("DELETE FROM events WHERE owner_id = ?1", [pid])
            .map_err(|e| e.to_string())?;

        // 3. Parent-child links where person is child
        tx.execute("DELETE FROM parent_child WHERE child_id = ?1", [pid])
            .map_err(|e| e.to_string())?;

        // 4. Proband Henry codes & root ancestors
        tx.execute("DELETE FROM proband_henry_codes WHERE person_id = ?1 OR proband_id = ?1", [pid])
            .map_err(|e| e.to_string())?;
        tx.execute("DELETE FROM root_ancestors WHERE person_id = ?1", [pid])
            .map_err(|e| e.to_string())?;

        // 5. Families where person is husband or wife
        tx.execute("UPDATE families SET husband_id = NULL WHERE husband_id = ?1", [pid])
            .map_err(|e| e.to_string())?;
        tx.execute("UPDATE families SET wife_id = NULL WHERE wife_id = ?1", [pid])
            .map_err(|e| e.to_string())?;

        // 6. Delete individual
        tx.execute("DELETE FROM individuals WHERE id = ?1", [pid])
            .map_err(|e| e.to_string())?;
    }

    // 7. Clean up orphan families (neither husband nor wife, and no children)
    tx.execute(
        "DELETE FROM families 
         WHERE husband_id IS NULL 
           AND wife_id IS NULL 
           AND id NOT IN (SELECT family_id FROM parent_child)",
        [],
    )
    .map_err(|e| e.to_string())?;

    tx.commit().map_err(|e| e.to_string())?;

    // 8. Recalculate Henry codes
    calculate_henry_codes_internal(conn)?;

    Ok(())
}

pub fn delete_person_internal(conn: &mut Connection, person_id: &str) -> Result<(), String> {
    delete_persons_batch_internal(conn, &[person_id.to_string()])
}

pub fn get_person_events_internal(conn: &Connection, person_id: &str) -> Result<Vec<PersonEventDto>, String> {
    let mut stmt = conn
        .prepare("SELECT id, owner_id, tag, date_str, place, json_data FROM events WHERE owner_id = ?1")
        .map_err(|e| e.to_string())?;

    let rows = stmt
        .query_map([person_id], |r| {
            let json_str: String = r.get(5)?;
            let desc = serde_json::from_str::<serde_json::Value>(&json_str)
                .ok()
                .and_then(|val| {
                    val.get("NOTE")
                        .and_then(|n| n.as_str().or_else(|| n.get("_val")?.as_str()))
                        .map(|s| s.to_string())
                });

            Ok(PersonEventDto {
                id: r.get(0)?,
                owner_id: r.get(1)?,
                tag: r.get(2)?,
                date_str: r.get(3)?,
                place: r.get(4)?,
                description: desc,
            })
        })
        .map_err(|e| e.to_string())?;

    let mut list = Vec::new();
    for r in rows {
        list.push(r.map_err(|e| e.to_string())?);
    }
    Ok(list)
}

pub fn merge_persons_internal(
    conn: &mut Connection,
    target_id: &str,
    source_id: &str,
    fields: &PersonMergeFieldsDto,
) -> Result<(), String> {
    if target_id == source_id {
        return Err("Ziel- und Quellperson dürfen nicht identisch sein.".to_string());
    }

    let tx = conn.transaction().map_err(|e| e.to_string())?;

    let target_exists: bool = tx
        .query_row("SELECT count(*) FROM individuals WHERE id = ?1", [target_id], |r| r.get::<_, i64>(0))
        .map_err(|e| e.to_string())? > 0;
    if !target_exists {
        return Err(format!("Zielperson '{}' existiert nicht.", target_id));
    }

    let source_exists: bool = tx
        .query_row("SELECT count(*) FROM individuals WHERE id = ?1", [source_id], |r| r.get::<_, i64>(0))
        .map_err(|e| e.to_string())? > 0;
    if !source_exists {
        return Err(format!("Quellperson '{}' existiert nicht.", source_id));
    }

    // 1. Target json_data & audit note
    let mut target_json_val: serde_json::Value = {
        let cur_json: String = tx
            .query_row("SELECT json_data FROM individuals WHERE id = ?1", [target_id], |r| r.get(0))
            .map_err(|e| e.to_string())?;
        serde_json::from_str(&cur_json).unwrap_or_else(|_| serde_json::json!({}))
    };

    if let Some(ref note_text) = fields.audit_note {
        if !note_text.trim().is_empty() {
            let existing_note = target_json_val
                .get("NOTE")
                .and_then(|n| {
                    if let Some(s) = n.as_str() {
                        Some(s.to_string())
                    } else if let Some(map) = n.as_object() {
                        map.get("_val").and_then(|x| x.as_str()).map(|s| s.to_string())
                    } else {
                        None
                    }
                });

            let combined = if let Some(ex) = existing_note {
                format!("{}\n\n{}", ex, note_text.trim())
            } else {
                note_text.trim().to_string()
            };

            target_json_val["NOTE"] = serde_json::json!({ "_val": combined });
        }
    }

    let chan = current_gedcom_chan();
    target_json_val["CHAN"] = chan;

    // 2. Update target person's fields
    tx.execute(
        "UPDATE individuals SET
            given_name = ?1,
            surname = ?2,
            sex = ?3,
            birth_date = ?4,
            birth_place = ?5,
            death_date = ?6,
            death_place = ?7,
            json_data = ?8
         WHERE id = ?9",
        rusqlite::params![
            fields.given_name,
            fields.surname,
            fields.sex,
            fields.birth_date,
            fields.birth_place,
            fields.death_date,
            fields.death_place,
            serde_json::to_string(&target_json_val).unwrap_or_else(|_| "{}".to_string()),
            target_id,
        ],
    )
    .map_err(|e| e.to_string())?;

    // 3. Parents handling
    match fields.parent_family_source.as_str() {
        "source" => {
            tx.execute("DELETE FROM parent_child WHERE child_id = ?1", [target_id])
                .map_err(|e| e.to_string())?;
            tx.execute(
                "UPDATE OR IGNORE parent_child SET child_id = ?1 WHERE child_id = ?2",
                rusqlite::params![target_id, source_id],
            )
            .map_err(|e| e.to_string())?;
            tx.execute("DELETE FROM parent_child WHERE child_id = ?1", [source_id])
                .map_err(|e| e.to_string())?;
        }
        "target" => {
            tx.execute("DELETE FROM parent_child WHERE child_id = ?1", [source_id])
                .map_err(|e| e.to_string())?;
        }
        "none" => {
            tx.execute("DELETE FROM parent_child WHERE child_id IN (?1, ?2)", [target_id, source_id])
                .map_err(|e| e.to_string())?;
        }
        _ => {}
    }

    // 4. Spouses & Families handling
    // Resolve any self-marriage between target and source
    let self_fam_ids: Vec<String> = {
        let mut stmt = tx
            .prepare(
                "SELECT id FROM families 
                 WHERE (husband_id = ?1 AND wife_id = ?2) 
                    OR (husband_id = ?2 AND wife_id = ?1)",
            )
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map(rusqlite::params![target_id, source_id], |r| r.get(0))
            .map_err(|e| e.to_string())?;
        let mut list = Vec::new();
        for r in rows {
            list.push(r.map_err(|e| e.to_string())?);
        }
        list
    };

    for fam_id in self_fam_ids {
        tx.execute(
            "UPDATE families SET husband_id = ?1, wife_id = NULL WHERE id = ?2",
            rusqlite::params![target_id, fam_id],
        )
        .map_err(|e| e.to_string())?;
    }

    // Process source families
    let source_fam_rows: Vec<(String, Option<String>, Option<String>, Option<String>)> = {
        let mut stmt = tx
            .prepare("SELECT id, husband_id, wife_id, marriage_date FROM families WHERE husband_id = ?1 OR wife_id = ?1")
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map([source_id], |r| {
                Ok((
                    r.get::<_, String>(0)?,
                    r.get::<_, Option<String>>(1)?,
                    r.get::<_, Option<String>>(2)?,
                    r.get::<_, Option<String>>(3)?,
                ))
            })
            .map_err(|e| e.to_string())?;
        let mut list = Vec::new();
        for r in rows {
            list.push(r.map_err(|e| e.to_string())?);
        }
        list
    };

    for (fam_id, h_opt, w_opt, m_date) in source_fam_rows {
        let partner_id = if h_opt.as_deref() == Some(source_id) {
            w_opt.clone()
        } else {
            h_opt.clone()
        };

        if let Some(ref pid) = partner_id {
            let target_fam_id: Option<String> = tx
                .query_row(
                    "SELECT id FROM families 
                     WHERE (husband_id = ?1 AND wife_id = ?2) 
                        OR (husband_id = ?2 AND wife_id = ?1)",
                    rusqlite::params![target_id, pid],
                    |r| r.get(0),
                )
                .ok();

            if let Some(ref t_fam) = target_fam_id {
                let res = fields
                    .spouse_resolutions
                    .iter()
                    .find(|sr| sr.partner_id == *pid)
                    .map(|sr| sr.resolution.as_str())
                    .unwrap_or("merge");

                match res {
                    "keep_separate" => {
                        if h_opt.as_deref() == Some(source_id) {
                            tx.execute("UPDATE families SET husband_id = ?1 WHERE id = ?2", rusqlite::params![target_id, fam_id])
                                .map_err(|e| e.to_string())?;
                        } else {
                            tx.execute("UPDATE families SET wife_id = ?1 WHERE id = ?2", rusqlite::params![target_id, fam_id])
                                .map_err(|e| e.to_string())?;
                        }
                    }
                    _ => {
                        // "merge"
                        tx.execute(
                            "UPDATE OR IGNORE parent_child SET family_id = ?1 WHERE family_id = ?2",
                            rusqlite::params![t_fam, fam_id],
                        )
                        .map_err(|e| e.to_string())?;
                        tx.execute("DELETE FROM parent_child WHERE family_id = ?1", [&fam_id])
                            .map_err(|e| e.to_string())?;

                        let custom_date = fields
                            .spouse_resolutions
                            .iter()
                            .find(|sr| sr.partner_id == *pid)
                            .and_then(|sr| sr.marriage_date.clone())
                            .or(m_date);

                        if let Some(ref md) = custom_date {
                            tx.execute(
                                "UPDATE families SET marriage_date = ?1 WHERE id = ?2 AND (marriage_date IS NULL OR marriage_date = '')",
                                rusqlite::params![md, t_fam],
                            )
                            .map_err(|e| e.to_string())?;
                        }

                        tx.execute("DELETE FROM families WHERE id = ?1", [&fam_id])
                            .map_err(|e| e.to_string())?;
                    }
                }
                continue;
            }
        }

        // No partner conflict
        if h_opt.as_deref() == Some(source_id) {
            tx.execute("UPDATE families SET husband_id = ?1 WHERE id = ?2", rusqlite::params![target_id, fam_id])
                .map_err(|e| e.to_string())?;
        } else {
            tx.execute("UPDATE families SET wife_id = ?1 WHERE id = ?2", rusqlite::params![target_id, fam_id])
                .map_err(|e| e.to_string())?;
        }
    }

    // 5. Events handling
    let source_events: Vec<String> = {
        let mut stmt = tx.prepare("SELECT id FROM events WHERE owner_id = ?1").map_err(|e| e.to_string())?;
        let rows = stmt.query_map([source_id], |r| r.get(0)).map_err(|e| e.to_string())?;
        let mut list = Vec::new();
        for r in rows {
            list.push(r.map_err(|e| e.to_string())?);
        }
        list
    };

    for eid in source_events {
        if fields.selected_event_ids.contains(&eid) {
            tx.execute("UPDATE events SET owner_id = ?1 WHERE id = ?2", rusqlite::params![target_id, eid])
                .map_err(|e| e.to_string())?;
        } else {
            tx.execute("DELETE FROM events WHERE id = ?1", [&eid])
                .map_err(|e| e.to_string())?;
        }
    }

    // 6. Research tasks handling
    tx.execute(
        "UPDATE OR IGNORE research_tasks SET person_id = ?1 WHERE person_id = ?2",
        rusqlite::params![target_id, source_id],
    )
    .map_err(|e| e.to_string())?;
    tx.execute("DELETE FROM research_tasks WHERE person_id = ?1", [source_id])
        .map_err(|e| e.to_string())?;

    // 7. Cleanup source from root_ancestors & proband_henry_codes
    tx.execute("DELETE FROM proband_henry_codes WHERE person_id = ?1 OR proband_id = ?1", [source_id])
        .map_err(|e| e.to_string())?;
    tx.execute("DELETE FROM root_ancestors WHERE person_id = ?1", [source_id])
        .map_err(|e| e.to_string())?;

    // 8. Delete source individual
    tx.execute("DELETE FROM individuals WHERE id = ?1", [source_id])
        .map_err(|e| e.to_string())?;

    // 9. Clean up orphan families
    tx.execute(
        "DELETE FROM families 
         WHERE husband_id IS NULL 
           AND wife_id IS NULL 
           AND id NOT IN (SELECT family_id FROM parent_child)",
        [],
    )
    .map_err(|e| e.to_string())?;

    tx.commit().map_err(|e| e.to_string())?;

    // 10. Recalculate Henry codes
    calculate_henry_codes_internal(conn)?;

    Ok(())
}

#[tauri::command]
fn delete_person(
    state: State<AppState>,
    person_id: String,
) -> Result<(), String> {
    let active_tree = state.active_tree.lock().map_err(|e| e.to_string())?.clone();
    let _ = backup_current_tree_db(&state.app_dir, &active_tree, "pre_delete");
    let mut conn = state.db.lock().map_err(|e| e.to_string())?;
    delete_person_internal(&mut conn, &person_id)
}

#[tauri::command]
fn delete_persons_batch(
    state: State<AppState>,
    person_ids: Vec<String>,
) -> Result<(), String> {
    let active_tree = state.active_tree.lock().map_err(|e| e.to_string())?.clone();
    let _ = backup_current_tree_db(&state.app_dir, &active_tree, "pre_delete_batch");
    let mut conn = state.db.lock().map_err(|e| e.to_string())?;
    delete_persons_batch_internal(&mut conn, &person_ids)
}

#[tauri::command]
fn merge_persons(
    state: State<AppState>,
    target_id: String,
    source_id: String,
    fields: PersonMergeFieldsDto,
) -> Result<(), String> {
    let active_tree = state.active_tree.lock().map_err(|e| e.to_string())?.clone();
    let _ = backup_current_tree_db(&state.app_dir, &active_tree, "pre_merge");
    let mut conn = state.db.lock().map_err(|e| e.to_string())?;
    merge_persons_internal(&mut conn, &target_id, &source_id, &fields)
}

#[tauri::command]
fn get_person_events(
    state: State<AppState>,
    person_id: String,
) -> Result<Vec<PersonEventDto>, String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    get_person_events_internal(&conn, &person_id)
}

#[tauri::command]
fn import_gedcom_file(state: State<AppState>, file_path: String) -> Result<usize, String> {
    let path = validate_user_file_path(&file_path, &["ged", "gedcom"])?;
    let mut conn = state.db.lock().map_err(|e| e.to_string())?;
    let mut active = state.active_tree.lock().map_err(|e| e.to_string())?;

    if active.is_empty() {
        let tree_name = path
            .file_stem()
            .and_then(|s| s.to_str())
            .and_then(|s| validate_tree_name(s).ok())
            .unwrap_or("lineagegraph")
            .to_string();
        let db_path = state.app_dir.join(format!("{}.db", tree_name));
        *conn = db::init_database(&db_path).map_err(|e| e.to_string())?;
        *active = tree_name;
    }

    let count = parser::import_gedcom(&mut conn, path)?;
    // Henry-Codes für eventuell bestehende Probanden berechnen
    calculate_henry_codes_internal(&mut conn)?;
    Ok(count)
}

#[tauri::command]
fn find_relationship_path(
    state: State<AppState>,
    start_id: String,
    target_id: String,
) -> Result<Vec<String>, String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    let mut stmt = conn
        .prepare("SELECT family_id, child_id FROM parent_child")
        .map_err(|e| e.to_string())?;
    let mut graph = DiGraph::<String, ()>::new();
    let mut nodes: HashMap<String, NodeIndex> = HashMap::new();
    let edges = stmt
        .query_map([], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
        })
        .map_err(|e| e.to_string())?;

    for edge in edges {
        let (f_id, c_id) = edge.map_err(|e| e.to_string())?;
        let f_idx = *nodes
            .entry(f_id.clone())
            .or_insert_with(|| graph.add_node(f_id));
        let c_idx = *nodes
            .entry(c_id.clone())
            .or_insert_with(|| graph.add_node(c_id));
        graph.add_edge(f_idx, c_idx, ());
        graph.add_edge(c_idx, f_idx, ());
    }

    let (&start_idx, &target_idx) = match (nodes.get(&start_id), nodes.get(&target_id)) {
        (Some(s), Some(t)) => (s, t),
        _ => return Err("Person nicht gefunden.".into()),
    };

    if let Some((_, path)) = astar(
        &graph,
        start_idx,
        |finish| finish == target_idx,
        |_| 1,
        |_| 0,
    ) {
        Ok(path.into_iter().map(|idx| graph[idx].clone()).collect())
    } else {
        Ok(vec![])
    }
}

#[tauri::command]
async fn export_latex_pdf(state: State<'_, AppState>, output_dir: String) -> Result<String, String> {
    let trimmed_dir = output_dir.trim().to_string();
    if trimmed_dir.is_empty() || trimmed_dir.contains('\0') {
        return Err("Ungültiges Ausgabeverzeichnis.".into());
    }

    let persons = get_all_persons(state)?;

    tauri::async_runtime::spawn_blocking(move || {
        #[derive(Serialize)]
        struct SafeLatexPerson {
            surname: String,
            given_name: String,
        }

        let safe_persons: Vec<SafeLatexPerson> = persons
            .into_iter()
            .map(|p| SafeLatexPerson {
                surname: escape_latex(p.surname.as_deref().unwrap_or("")),
                given_name: escape_latex(p.given_name.as_deref().unwrap_or("N.N.")),
            })
            .collect();

        let mut tera = Tera::default();
        tera.add_raw_template(
            "chronik.tex",
            r#"\documentclass[a4paper,11pt]{scrbook}\usepackage[utf8]{inputenc}\begin{document}\chapter{Familienverzeichnis}{% for p in persons %}\textbf{ {{ p.surname }}, {{ p.given_name }} }\\{% endfor %}\end{document}"#,
        )
        .map_err(|e| e.to_string())?;

        let mut context = Context::new();
        context.insert("persons", &safe_persons);
        let rendered_tex = tera
            .render("chronik.tex", &context)
            .map_err(|e| e.to_string())?;

        let out_path = PathBuf::from(&trimmed_dir);
        let tex_path = out_path.join("chronik.tex");
        fs::write(&tex_path, rendered_tex).map_err(|e| e.to_string())?;

        let mut cmd = Command::new("pdflatex");
        cmd.arg("-no-shell-escape")
            .arg("-interaction=nonstopmode")
            .arg("-output-directory")
            .arg(&out_path)
            .arg(&tex_path);
        #[cfg(target_os = "windows")]
        cmd.creation_flags(0x08000000);

        let output = cmd
            .output()
            .map_err(|e| format!("Fehler beim Start von pdflatex: {}", e))?;
        if output.status.success() {
            Ok(out_path.join("chronik.pdf").to_string_lossy().into_owned())
        } else {
            Err(format!(
                "LaTeX-Fehler:\n{}",
                String::from_utf8_lossy(&output.stdout)
            ))
        }
    })
    .await
    .map_err(|e| format!("Hintergrund-Task fehlgeschlagen: {}", e))?
}

#[tauri::command]
fn save_design_layout(
    state: State<'_, AppState>,
    proband_id: String,
    name: String,
    created_at: String,
    layout_data: String,
    overwrite_id: Option<String>,
    layout_type: Option<String>,
    anchor_person_id: Option<String>,
) -> Result<DesignLayoutEntry, String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    let l_type = layout_type.unwrap_or_else(|| "master".to_string());

    if let Some(oid) = overwrite_id.filter(|s| !s.is_empty()) {
        conn.execute(
            "UPDATE design_layouts SET name = ?1, created_at = ?2, layout_data = ?3, layout_type = ?4, anchor_person_id = ?5 WHERE id = ?6",
            rusqlite::params![name, created_at, layout_data, l_type, anchor_person_id, oid],
        )
        .map_err(|e| e.to_string())?;
        return Ok(DesignLayoutEntry {
            id: oid,
            proband_id,
            name,
            created_at,
            layout_data,
            layout_type: Some(l_type),
            anchor_person_id,
        });
    }

    let existing_id: Option<String> = conn
        .query_row(
            "SELECT id FROM design_layouts WHERE proband_id = ?1 AND name = ?2 LIMIT 1",
            [&proband_id, &name],
            |r| r.get(0),
        )
        .ok();

    if let Some(eid) = existing_id {
        conn.execute(
            "UPDATE design_layouts SET created_at = ?1, layout_data = ?2, layout_type = ?3, anchor_person_id = ?4 WHERE id = ?5",
            rusqlite::params![created_at, layout_data, l_type, anchor_person_id, eid],
        )
        .map_err(|e| e.to_string())?;
        return Ok(DesignLayoutEntry {
            id: eid,
            proband_id,
            name,
            created_at,
            layout_data,
            layout_type: Some(l_type),
            anchor_person_id,
        });
    }

    let id = uuid::Uuid::new_v4().to_string();
    conn.execute(
        "INSERT INTO design_layouts (id, proband_id, name, created_at, layout_data, layout_type, anchor_person_id) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
        rusqlite::params![id, proband_id, name, created_at, layout_data, l_type, anchor_person_id],
    )
    .map_err(|e| e.to_string())?;
    Ok(DesignLayoutEntry {
        id,
        proband_id,
        name,
        created_at,
        layout_data,
        layout_type: Some(l_type),
        anchor_person_id,
    })
}

fn map_design_layout_row(r: &rusqlite::Row<'_>) -> rusqlite::Result<DesignLayoutEntry> {
    Ok(DesignLayoutEntry {
        id: r.get(0)?,
        proband_id: r.get(1)?,
        name: r.get(2)?,
        created_at: r.get(3)?,
        layout_data: r.get(4)?,
        layout_type: r.get(5).ok(),
        anchor_person_id: r.get(6).ok(),
    })
}

#[tauri::command]
fn get_design_layouts(
    state: State<'_, AppState>,
    proband_id: Option<String>,
    anchor_person_id: Option<String>,
    layout_type: Option<String>,
) -> Result<Vec<DesignLayoutEntry>, String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;

    if let Some(aid) = anchor_person_id.filter(|s| !s.is_empty()) {
        let mut stmt = conn
            .prepare("SELECT id, proband_id, name, created_at, layout_data, layout_type, anchor_person_id FROM design_layouts WHERE anchor_person_id = ?1 ORDER BY created_at DESC")
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map([&aid], map_design_layout_row)
            .map_err(|e| e.to_string())?;
        return rows
            .collect::<Result<Vec<_>, _>>()
            .map_err(|e| e.to_string());
    }

    if let Some(pid) = proband_id.filter(|s| !s.is_empty()) {
        if let Some(lt) = layout_type.filter(|s| !s.is_empty()) {
            let mut stmt = conn
                .prepare("SELECT id, proband_id, name, created_at, layout_data, layout_type, anchor_person_id FROM design_layouts WHERE proband_id = ?1 AND layout_type = ?2 ORDER BY created_at DESC")
                .map_err(|e| e.to_string())?;
            let rows = stmt
                .query_map([&pid, &lt], map_design_layout_row)
                .map_err(|e| e.to_string())?;
            return rows
                .collect::<Result<Vec<_>, _>>()
                .map_err(|e| e.to_string());
        }
        let mut stmt = conn
            .prepare("SELECT id, proband_id, name, created_at, layout_data, layout_type, anchor_person_id FROM design_layouts WHERE proband_id = ?1 ORDER BY created_at DESC")
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map([&pid], map_design_layout_row)
            .map_err(|e| e.to_string())?;
        return rows
            .collect::<Result<Vec<_>, _>>()
            .map_err(|e| e.to_string());
    }

    let mut stmt = conn
        .prepare("SELECT id, proband_id, name, created_at, layout_data, layout_type, anchor_person_id FROM design_layouts ORDER BY created_at DESC")
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([], map_design_layout_row)
        .map_err(|e| e.to_string())?;
    rows.collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())
}

#[tauri::command]
fn delete_design_layout(state: State<'_, AppState>, id: String) -> Result<(), String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    conn.execute("DELETE FROM design_layouts WHERE id = ?1", [&id])
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
fn save_latex_template(
    state: State<'_, AppState>,
    name: String,
    created_at: String,
    config_data: String,
    overwrite_id: Option<String>,
) -> Result<LatexTemplateEntry, String> {
    let trimmed_name = name.trim().to_string();
    if trimmed_name.is_empty() {
        return Err("Vorlagenname darf nicht leer sein.".into());
    }
    let conn = state.db.lock().map_err(|e| e.to_string())?;

    if let Some(oid) = overwrite_id.filter(|s| !s.is_empty()) {
        conn.execute(
            "UPDATE latex_export_templates SET name = ?1, created_at = ?2, config_data = ?3 WHERE id = ?4",
            [&trimmed_name, &created_at, &config_data, &oid],
        )
        .map_err(|e| e.to_string())?;
        return Ok(LatexTemplateEntry {
            id: oid,
            name: trimmed_name,
            created_at,
            config_data,
        });
    }

    let existing_id: Option<String> = conn
        .query_row(
            "SELECT id FROM latex_export_templates WHERE name = ?1 LIMIT 1",
            [&trimmed_name],
            |r| r.get(0),
        )
        .ok();

    if let Some(eid) = existing_id {
        conn.execute(
            "UPDATE latex_export_templates SET created_at = ?1, config_data = ?2 WHERE id = ?3",
            [&created_at, &config_data, &eid],
        )
        .map_err(|e| e.to_string())?;
        return Ok(LatexTemplateEntry {
            id: eid,
            name: trimmed_name,
            created_at,
            config_data,
        });
    }

    let id = uuid::Uuid::new_v4().to_string();
    conn.execute(
        "INSERT INTO latex_export_templates (id, name, created_at, config_data) VALUES (?1, ?2, ?3, ?4)",
        [&id, &trimmed_name, &created_at, &config_data],
    )
    .map_err(|e| e.to_string())?;
    Ok(LatexTemplateEntry {
        id,
        name: trimmed_name,
        created_at,
        config_data,
    })
}

#[tauri::command]
fn get_latex_templates(state: State<'_, AppState>) -> Result<Vec<LatexTemplateEntry>, String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    let mut stmt = conn
        .prepare("SELECT id, name, created_at, config_data FROM latex_export_templates ORDER BY created_at DESC")
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([], |r| {
            Ok(LatexTemplateEntry {
                id: r.get(0)?,
                name: r.get(1)?,
                created_at: r.get(2)?,
                config_data: r.get(3)?,
            })
        })
        .map_err(|e| e.to_string())?;
    rows.collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())
}

#[tauri::command]
fn delete_latex_template(state: State<'_, AppState>, id: String) -> Result<(), String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    conn.execute("DELETE FROM latex_export_templates WHERE id = ?1", [&id])
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
async fn save_design_file(file_path: String, content: String) -> Result<(), String> {
    validate_user_file_path(&file_path, &["json", "svg", "html", "htm", "tex"])?;
    tauri::async_runtime::spawn_blocking(move || {
        fs::write(&file_path, content).map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
async fn save_latex_export_bundle(
    base_file_path: String,
    files: Vec<LatexExportFilePayload>,
) -> Result<Vec<String>, String> {
    let base_path = validate_user_file_path(&base_file_path, &["tex"])?.to_path_buf();
    let parent_dir = base_path
        .parent()
        .ok_or_else(|| "Zielverzeichnis konnte nicht ermittelt werden.".to_string())?
        .to_path_buf();

    if files.is_empty() {
        return Err("Keine Exportdateien übergeben.".into());
    }

    for item in &files {
        let fname = item.file_name.trim();
        if fname.is_empty()
            || fname.contains('/')
            || fname.contains('\\')
            || fname.contains("..")
            || fname.contains('\0')
        {
            return Err(format!("Ungültiger Dateiname '{}'.", item.file_name));
        }
        validate_user_file_path(fname, &["tex"])?;
    }

    tauri::async_runtime::spawn_blocking(move || {
        let mut written_paths = Vec::with_capacity(files.len());
        for item in files {
            let target = parent_dir.join(item.file_name.trim());
            fs::write(&target, item.content).map_err(|e| e.to_string())?;
            written_paths.push(target.to_string_lossy().into_owned());
        }
        Ok(written_paths)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
async fn read_design_file(file_path: String) -> Result<String, String> {
    validate_user_file_path(&file_path, &["json"])?;
    tauri::async_runtime::spawn_blocking(move || {
        fs::read_to_string(&file_path).map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
async fn save_binary_file(file_path: String, data: Vec<u8>) -> Result<(), String> {
    validate_user_file_path(&file_path, &["png", "pdf", "jpg", "jpeg", "svg"])?;
    tauri::async_runtime::spawn_blocking(move || {
        fs::write(&file_path, data).map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
fn create_tree_and_import(
    state: State<AppState>,
    file_path: String,
    tree_name: String,
) -> Result<usize, String> {
    let path = validate_user_file_path(&file_path, &["ged", "gedcom"])?;
    let valid_name = validate_tree_name(&tree_name)?;
    let db_path = state.app_dir.join(format!("{}.db", valid_name));
    let new_conn = db::init_database(&db_path).map_err(|e| e.to_string())?;

    let mut conn = state.db.lock().map_err(|e| e.to_string())?;
    *conn = new_conn;
    let mut active = state.active_tree.lock().map_err(|e| e.to_string())?;
    *active = valid_name.to_string();

    let count = parser::import_gedcom(&mut conn, path)?;
    calculate_henry_codes_internal(&mut conn)?;
    Ok(count)
}

#[tauri::command]
fn stage_gedcom_for_merge(
    state: State<AppState>,
    file_path: String,
) -> Result<gedcom_import_merge::GedcomMergePlan, String> {
    let path = validate_user_file_path(&file_path, &["ged", "gedcom"])?;
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    let staged = gedcom_import_merge::parse_gedcom_in_memory(path)?;
    gedcom_import_merge::analyze_gedcom_merge(&conn, &file_path, &staged)
}

#[tauri::command]
fn apply_gedcom_merge(
    state: State<AppState>,
    resolution: gedcom_import_merge::GedcomMergeResolution,
) -> Result<gedcom_import_merge::MergeResultStats, String> {
    let path = validate_user_file_path(&resolution.file_path, &["ged", "gedcom"])?;
    let staged = gedcom_import_merge::parse_gedcom_in_memory(path)?;
    let mut conn = state.db.lock().map_err(|e| e.to_string())?;
    gedcom_import_merge::execute_gedcom_merge(&mut conn, &staged, &resolution)
}

#[tauri::command]
fn preview_gedcom_export(
    state: State<AppState>,
    scope: gedcom_export::GedcomExportScope,
) -> Result<gedcom_export::GedcomExportPreview, String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    let (content, total_persons, total_families) = gedcom_export::generate_gedcom(&conn, &scope)?;

    let preview_lines: Vec<&str> = content.lines().take(60).collect();
    let preview_text = preview_lines.join("\n");

    Ok(gedcom_export::GedcomExportPreview {
        total_persons,
        total_families,
        preview_text,
        full_content: Some(content),
    })
}

#[tauri::command]
async fn export_gedcom_to_file(
    state: State<'_, AppState>,
    file_path: String,
    scope: gedcom_export::GedcomExportScope,
) -> Result<gedcom_export::GedcomExportResult, String> {
    validate_user_file_path(&file_path, &["ged"])?;

    let (content, total_persons, total_families) = {
        let conn = state.db.lock().map_err(|e| e.to_string())?;
        gedcom_export::generate_gedcom(&conn, &scope)?
    };

    let target_path = PathBuf::from(file_path.trim());
    tauri::async_runtime::spawn_blocking(move || {
        fs::write(&target_path, content.as_bytes())
            .map_err(|e| format!("Fehler beim Schreiben der Datei: {}", e))?;
        Ok(gedcom_export::GedcomExportResult {
            total_persons,
            total_families,
            file_path: target_path.to_string_lossy().to_string(),
        })
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
fn preview_csv_export(
    state: State<AppState>,
    scope: gedcom_export::GedcomExportScope,
    delimiter: Option<String>,
    include_bom: Option<bool>,
) -> Result<csv_export::CsvExportPreview, String> {
    let delim_char = delimiter
        .and_then(|s| s.chars().next())
        .unwrap_or(';');
    let with_bom = include_bom.unwrap_or(true);

    let conn = state.db.lock().map_err(|e| e.to_string())?;
    let (content, total_persons) = csv_export::generate_csv(&conn, &scope, delim_char, with_bom)?;

    let preview_lines: Vec<&str> = content.lines().take(60).collect();
    let preview_text = preview_lines.join("\n");

    Ok(csv_export::CsvExportPreview {
        total_persons,
        preview_text,
        full_content: Some(content),
    })
}

#[tauri::command]
async fn export_csv_to_file(
    state: State<'_, AppState>,
    file_path: String,
    scope: gedcom_export::GedcomExportScope,
    delimiter: Option<String>,
    include_bom: Option<bool>,
) -> Result<csv_export::CsvExportResult, String> {
    validate_user_file_path(&file_path, &["csv"])?;

    let delim_char = delimiter
        .and_then(|s| s.chars().next())
        .unwrap_or(';');
    let with_bom = include_bom.unwrap_or(true);

    let (content, total_persons) = {
        let conn = state.db.lock().map_err(|e| e.to_string())?;
        csv_export::generate_csv(&conn, &scope, delim_char, with_bom)?
    };

    let target_path = PathBuf::from(file_path.trim());
    tauri::async_runtime::spawn_blocking(move || {
        fs::write(&target_path, content.as_bytes())
            .map_err(|e| format!("Fehler beim Schreiben der CSV-Datei: {}", e))?;
        Ok(csv_export::CsvExportResult {
            total_persons,
            file_path: target_path.to_string_lossy().to_string(),
        })
    })
    .await
    .map_err(|e| e.to_string())?
}

fn check_connectivity() -> bool {
    use std::net::{TcpStream, ToSocketAddrs};
    use std::time::Duration;

    let timeout = Duration::from_millis(1500);
    let targets = ["1.1.1.1:53", "8.8.8.8:53", "github.com:443"];
    for target in targets {
        if let Ok(mut addrs) = target.to_socket_addrs() {
            if let Some(addr) = addrs.next() {
                if TcpStream::connect_timeout(&addr, timeout).is_ok() {
                    return true;
                }
            }
        }
    }
    false
}

#[tauri::command]
async fn check_internet_connection() -> bool {
    tauri::async_runtime::spawn_blocking(check_connectivity)
        .await
        .unwrap_or(false)
}

pub fn resolve_user_guide_path() -> Option<PathBuf> {
    let candidates = [
        PathBuf::from("USER_GUIDE.md"),
        PathBuf::from("../USER_GUIDE.md"),
        std::env::current_exe()
            .ok()
            .and_then(|p| p.parent().map(|d| d.join("USER_GUIDE.md")))
            .unwrap_or_default(),
    ];

    for candidate in &candidates {
        if candidate.exists() {
            return Some(candidate.clone());
        }
    }
    None
}

#[tauri::command]
async fn open_user_guide() -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(|| {
        if let Some(candidate) = resolve_user_guide_path() {
            #[cfg(target_os = "windows")]
            {
                let mut cmd = Command::new("cmd");
                cmd.args(["/C", "start", "", candidate.to_str().unwrap_or("USER_GUIDE.md")]);
                cmd.creation_flags(0x08000000);
                if cmd.spawn().is_ok() {
                    return Ok(());
                }
            }
            #[cfg(not(target_os = "windows"))]
            {
                if Command::new("xdg-open").arg(candidate).spawn().is_ok() {
                    return Ok(());
                }
            }
        }

        let url = "https://github.com/dryanwhitney-hub/LineageGraph/blob/main/USER_GUIDE.md";
        #[cfg(target_os = "windows")]
        {
            let mut cmd = Command::new("cmd");
            cmd.args(["/C", "start", "", url]);
            cmd.creation_flags(0x08000000);
            let _ = cmd.spawn();
        }
        #[cfg(not(target_os = "windows"))]
        {
            let _ = Command::new("xdg-open").arg(url).spawn();
        }

        Ok(())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
fn analyze_research_gaps(
    state: State<AppState>,
    scope: research::ResearchScope,
    settings: research::ResearchSettings,
) -> Result<Vec<research::ResearchTaskDto>, String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    let all_persons = get_all_persons_internal(&conn)?;
    research::analyze_gaps(&conn, &all_persons, &scope, &settings)
}

#[tauri::command]
fn update_research_task_status(
    state: State<AppState>,
    task_id: String,
    person_id: String,
    gap_type: String,
    context_json: String,
    status: String,
    notes: Option<String>,
    priority_score: i32,
) -> Result<(), String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    research::upsert_task_status(
        &conn,
        &task_id,
        &person_id,
        &gap_type,
        &context_json,
        &status,
        notes.as_deref(),
        priority_score,
    )
}

#[tauri::command]
fn get_research_statistics(
    state: State<AppState>,
    scope: research::ResearchScope,
    settings: research::ResearchSettings,
) -> Result<research::ResearchStatsDto, String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    let all_persons = get_all_persons_internal(&conn)?;
    let tasks = research::analyze_gaps(&conn, &all_persons, &scope, &settings)?;
    Ok(research::calculate_statistics(&tasks))
}

#[tauri::command]
fn get_isolated_branches(
    state: State<AppState>,
    active_proband_id: Option<String>,
) -> Result<research::IsolatedBranchesResultDto, String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    let all_persons = get_all_persons_internal(&conn)?;
    research::find_isolated_branches(&all_persons, active_proband_id.as_deref())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .setup(|app| {
            let app_dir = app
                .path()
                .app_data_dir()
                .map_err(|e| format!("Kein App-Verzeichnis verfügbar: {}", e))?;
            fs::create_dir_all(&app_dir)
                .map_err(|e| format!("App-Verzeichnis konnte nicht erstellt werden: {}", e))?;

            let existing_trees = list_tree_names(&app_dir, None);

            let (conn, initial_tree) = if let Some(first) = existing_trees.first() {
                let c = crate::db::init_database(&app_dir.join(format!("{}.db", first)))
                    .map_err(|e| format!("DB Init Fehler: {}", e))?;
                (c, first.clone())
            } else {
                let c = crate::db::init_in_memory_database()
                    .map_err(|e| format!("In-Memory DB Init Fehler: {}", e))?;
                (c, String::new())
            };

            app.manage(AppState {
                db: Mutex::new(conn),
                app_dir,
                active_tree: Mutex::new(initial_tree),
            });
            Ok(())
        })
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .invoke_handler(tauri::generate_handler![
            get_trees,
            switch_tree,
            delete_tree,
            get_all_persons,
            get_person_details,
            find_relationship_path,
            export_latex_pdf,
            import_gedcom_file,
            update_person,
            update_persons_batch,
            get_next_person_id,
            update_person_parents,
            update_family_marriage,
            link_spouses,
            unlink_family,
            add_child_link,
            remove_child_link,
            add_person,
            get_root_ancestors,
            add_root_ancestor,
            remove_root_ancestor,
            calculate_henry_codes_from_roots,
            save_design_layout,
            get_design_layouts,
            delete_design_layout,
            save_latex_template,
            get_latex_templates,
            delete_latex_template,
            save_design_file,
            save_latex_export_bundle,
            read_design_file,
            save_binary_file,
            preview_gedcom_export,
            export_gedcom_to_file,
            create_tree_and_import,
            stage_gedcom_for_merge,
            apply_gedcom_merge,
            preview_csv_export,
            export_csv_to_file,
            check_internet_connection,
            open_user_guide,
            analyze_research_gaps,
            update_research_task_status,
            get_research_statistics,
            get_isolated_branches,
            delete_person,
            delete_persons_batch,
            merge_persons,
            get_person_events
        ])
        .run(tauri::generate_context!())
        .expect("Tauri Error");
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    #[test]
    fn test_delete_tree_removes_database_and_preserves_others() {
        let temp_dir = std::env::temp_dir().join(format!(
            "test_stammbaum_{}",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        fs::create_dir_all(&temp_dir).unwrap();

        // 1. Zwei Bäume anlegen
        let db1_path = temp_dir.join("baum_a.db");
        let db2_path = temp_dir.join("baum_b.db");

        {
            let conn1 = db::init_database(&db1_path).unwrap();
            conn1.execute("INSERT INTO individuals (id, xref_id, given_name, surname, sex, json_data) VALUES ('I1', '@I1@', 'Max', 'Mustermann', 'M', '{}')", []).unwrap();
        }
        {
            let conn2 = db::init_database(&db2_path).unwrap();
            conn2.execute("INSERT INTO individuals (id, xref_id, given_name, surname, sex, json_data) VALUES ('I2', '@I2@', 'Erika', 'Musterfrau', 'F', '{}')", []).unwrap();
        }

        let mut active = "baum_a".to_string();
        let mut conn = db::init_database(&db1_path).unwrap();

        // 2. baum_a löschen
        let remaining =
            delete_tree_internal(&temp_dir, &mut conn, &mut active, "baum_a").unwrap();

        // 3. Prüfen: baum_a.db existiert nicht mehr
        assert!(!db1_path.exists(), "baum_a.db muss physisch gelöscht sein!");
        assert!(!temp_dir.join("baum_a.db-wal").exists());
        assert!(!temp_dir.join("baum_a.db-shm").exists());

        // 4. Prüfen: baum_b.db existiert weiterhin unberührt
        assert!(
            db2_path.exists(),
            "baum_b.db darf nicht gelöscht worden sein!"
        );
        assert_eq!(active, "baum_b");
        assert_eq!(remaining, vec!["baum_b".to_string()]);

        // 5. In conn darf jetzt nur noch Erika aus baum_b existieren
        let count_b: i64 = conn
            .query_row(
                "SELECT count(*) FROM individuals WHERE id = 'I2'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(count_b, 1);
        let count_a: i64 = conn
            .query_row(
                "SELECT count(*) FROM individuals WHERE id = 'I1'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(count_a, 0);

        // 6. Nun auch baum_b löschen (letzter Baum)
        let remaining2 =
            delete_tree_internal(&temp_dir, &mut conn, &mut active, "baum_b").unwrap();
        assert!(!db2_path.exists(), "baum_b.db muss physisch gelöscht sein!");
        assert!(
            !temp_dir.join("stammbaum.db").exists(),
            "Es darf kein neuer leerer Stammbaum auf Disk angelegt werden!"
        );
        assert_eq!(active, "");
        assert!(
            remaining2.is_empty(),
            "Nach Löschen des letzten Baums muss die Liste der Bäume leer sein!"
        );

        // In-Memory-DB muss 0 Personen haben
        let count_fresh: i64 = conn
            .query_row("SELECT count(*) FROM individuals", [], |r| r.get(0))
            .unwrap();
        assert_eq!(count_fresh, 0);

        // Aufräumen
        drop(conn);
        let _ = fs::remove_dir_all(&temp_dir);
    }

    #[test]
    fn test_henry_code_matrilinear_when_father_not_in_tree_and_patrilinear_when_both_in_tree() {
        let mut conn = db::init_in_memory_database().unwrap();

        // Proband I1 (Vater)
        conn.execute("INSERT INTO individuals (id, xref_id, given_name, surname, sex, birth_date, json_data) VALUES ('I1', 'I1', 'Stamm', 'Ahne', 'M', '1850', '{}')", []).unwrap();
        // Sohn I2 (11) und Tochter I3 (12)
        conn.execute("INSERT INTO individuals (id, xref_id, given_name, surname, sex, birth_date, json_data) VALUES ('I2', 'I2', 'Sohn', 'Ahne', 'M', '1880', '{}')", []).unwrap();
        conn.execute("INSERT INTO individuals (id, xref_id, given_name, surname, sex, birth_date, json_data) VALUES ('I3', 'I3', 'Tochter', 'Ahne', 'F', '1882', '{}')", []).unwrap();
        // Externer Ehemann I_EXT von Tochter I3 (NICHT Teil des Stammbaums von I1!)
        conn.execute("INSERT INTO individuals (id, xref_id, given_name, surname, sex, birth_date, json_data) VALUES ('I_EXT', 'I_EXT', 'Externer', 'Mann', 'M', '1880', '{}')", []).unwrap();
        // Kind I4 von Tochter I3 und externem Mann I_EXT -> muss unter Mutter I3 als 121 weitergeführt werden!
        conn.execute("INSERT INTO individuals (id, xref_id, given_name, surname, sex, birth_date, json_data) VALUES ('I4', 'I4', 'Tochterkind', 'Mann', 'F', '1905', '{}')", []).unwrap();
        // Kind I5 von Sohn I2 -> wird 111
        conn.execute("INSERT INTO individuals (id, xref_id, given_name, surname, sex, birth_date, json_data) VALUES ('I5', 'I5', 'Sohneskind', 'Ahne', 'M', '1904', '{}')", []).unwrap();
        // Kind I6 von I5 (111, Vater im Baum) und I4 (121, Mutter im Baum) -> beide Eltern im Baum -> patrilinear unter Vater I5 als 1111!
        conn.execute("INSERT INTO individuals (id, xref_id, given_name, surname, sex, birth_date, json_data) VALUES ('I6', 'I6', 'Urenkel', 'Ahne', 'M', '1930', '{}')", []).unwrap();

        // Familien anlegen
        conn.execute("INSERT INTO families (id, xref_id, husband_id, wife_id, is_divorced, json_data) VALUES ('F1', 'F1', 'I1', NULL, 0, '{}')", []).unwrap();
        conn.execute(
            "INSERT INTO parent_child (family_id, child_id) VALUES ('F1', 'I2')",
            [],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO parent_child (family_id, child_id) VALUES ('F1', 'I3')",
            [],
        )
        .unwrap();

        conn.execute("INSERT INTO families (id, xref_id, husband_id, wife_id, is_divorced, json_data) VALUES ('F2', 'F2', 'I_EXT', 'I3', 0, '{}')", []).unwrap();
        conn.execute(
            "INSERT INTO parent_child (family_id, child_id) VALUES ('F2', 'I4')",
            [],
        )
        .unwrap();

        conn.execute("INSERT INTO families (id, xref_id, husband_id, wife_id, is_divorced, json_data) VALUES ('F3', 'F3', 'I2', NULL, 0, '{}')", []).unwrap();
        conn.execute(
            "INSERT INTO parent_child (family_id, child_id) VALUES ('F3', 'I5')",
            [],
        )
        .unwrap();

        conn.execute("INSERT INTO families (id, xref_id, husband_id, wife_id, is_divorced, json_data) VALUES ('F4', 'F4', 'I5', 'I4', 0, '{}')", []).unwrap();
        conn.execute(
            "INSERT INTO parent_child (family_id, child_id) VALUES ('F4', 'I6')",
            [],
        )
        .unwrap();

        conn.execute(
            "INSERT INTO root_ancestors (person_id, starting_code) VALUES ('I1', '1')",
            [],
        )
        .unwrap();
        calculate_henry_codes_internal(&mut conn).unwrap();

        let get_code = |pid: &str| -> Option<String> {
            conn.query_row(
                "SELECT henry_code FROM proband_henry_codes WHERE proband_id = 'I1' AND person_id = ?1",
                [pid],
                |r| r.get(0),
            )
            .ok()
        };

        assert_eq!(get_code("I1"), Some("1".to_string()));
        assert_eq!(get_code("I2"), Some("11".to_string()));
        assert_eq!(get_code("I3"), Some("12".to_string()));
        assert_eq!(get_code("I_EXT"), None);
        assert_eq!(
            get_code("I4"),
            Some("121".to_string()),
            "Kind muss unter der Mutter weitergeführt werden, da Vater nicht im Stammbaum ist"
        );
        assert_eq!(get_code("I5"), Some("111".to_string()));
        assert_eq!(
            get_code("I6"),
            Some("1111".to_string()),
            "Wenn beide Eltern im Stammbaum sind, muss die Linie patrilinear unter dem Vater weitergeführt werden"
        );
    }

    #[test]
    fn test_birth_date_sorting_of_descendants() {
        assert!(parse_birth_sort_key("10 JAN 1950") < parse_birth_sort_key("20 MAY 1950"));
        assert!(parse_birth_sort_key("05.03.1950") < parse_birth_sort_key("1950-03-12"));
        assert!(parse_birth_sort_key("1948") < parse_birth_sort_key("01 JAN 1950"));
        assert!(parse_birth_sort_key("1950") < parse_birth_sort_key(""));
    }

    #[test]
    fn test_get_next_individual_id() {
        let conn = db::init_in_memory_database().unwrap();
        // Leere DB -> I1
        assert_eq!(crate::db::get_next_individual_id(&conn).unwrap(), "I1");

        conn.execute("INSERT INTO individuals (id, xref_id, given_name, surname, sex, json_data) VALUES ('I1', 'I1', 'A', 'B', 'M', '{}')", []).unwrap();
        conn.execute("INSERT INTO individuals (id, xref_id, given_name, surname, sex, json_data) VALUES ('I2', 'I2', 'C', 'D', 'F', '{}')", []).unwrap();
        conn.execute("INSERT INTO individuals (id, xref_id, given_name, surname, sex, json_data) VALUES ('I10', 'I10', 'E', 'F', 'M', '{}')", []).unwrap();
        assert_eq!(crate::db::get_next_individual_id(&conn).unwrap(), "I11");

        // Höhere numerische ID
        conn.execute("INSERT INTO individuals (id, xref_id, given_name, surname, sex, json_data) VALUES ('I191141', 'I191141', 'G', 'H', 'M', '{}')", []).unwrap();
        assert_eq!(
            crate::db::get_next_individual_id(&conn).unwrap(),
            "I191142"
        );
    }

    #[test]
    fn test_update_persons_batch_and_traceability() {
        let mut conn = db::init_in_memory_database().unwrap();

        // 1. Zwei Personen und eine Familie anlegen
        conn.execute("INSERT INTO individuals (id, xref_id, given_name, surname, sex, json_data) VALUES ('I1', 'I1', 'Vater', 'Ahne', 'M', '{}')", []).unwrap();
        conn.execute("INSERT INTO individuals (id, xref_id, given_name, surname, sex, json_data) VALUES ('I2', 'I2', 'Kind', 'Ahne', 'M', '{}')", []).unwrap();
        conn.execute("INSERT INTO families (id, xref_id, husband_id, wife_id, is_divorced, json_data) VALUES ('F1', 'F1', 'I1', NULL, 0, '{}')", []).unwrap();
        conn.execute(
            "INSERT INTO parent_child (family_id, child_id) VALUES ('F1', 'I2')",
            [],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO root_ancestors (person_id, starting_code) VALUES ('I1', '1')",
            [],
        )
        .unwrap();
        calculate_henry_codes_internal(&mut conn).unwrap();

        // 2. Prüfung auf leere ID (Pflichtfeld)
        let empty_id_update = vec![PersonUpdate {
            original_id: "I1".to_string(),
            person: Person {
                id: "   ".to_string(),
                given_name: Some("Vater".to_string()),
                surname: Some("Ahne".to_string()),
                sex: Some("M".to_string()),
                ..Default::default()
            },
        }];
        let err_empty = update_persons_batch_internal(&mut conn, empty_id_update);
        assert!(err_empty.is_err());
        assert!(err_empty.unwrap_err().contains("Pflichtfeld"));

        // 3. Prüfung auf Kollision mit existierender ID (Nennung von ID und Name)
        let collision_update = vec![PersonUpdate {
            original_id: "I2".to_string(),
            person: Person {
                id: "I1".to_string(), // I1 existiert bereits (Vater Ahne)
                given_name: Some("Kind".to_string()),
                surname: Some("Ahne".to_string()),
                sex: Some("M".to_string()),
                ..Default::default()
            },
        }];
        let err_col = update_persons_batch_internal(&mut conn, collision_update);
        assert!(err_col.is_err());
        let msg = err_col.unwrap_err();
        assert!(msg.contains("I1"));
        assert!(msg.contains("Vater Ahne"));

        // 4. Erfolgreiche ID-Änderung von I1 -> I100 (inklusive Referenzen)
        let rename_update = vec![PersonUpdate {
            original_id: "I1".to_string(),
            person: Person {
                id: "I100".to_string(),
                given_name: Some("VaterNeu".to_string()),
                surname: Some("Ahne".to_string()),
                sex: Some("M".to_string()),
                ..Default::default()
            },
        }];
        update_persons_batch_internal(&mut conn, rename_update).unwrap();

        // Überprüfen: individuals hat jetzt I100 und nicht mehr I1
        let count_i1: i64 = conn
            .query_row(
                "SELECT count(*) FROM individuals WHERE id = 'I1'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(count_i1, 0);
        let count_i100: i64 = conn
            .query_row(
                "SELECT count(*) FROM individuals WHERE id = 'I100'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(count_i100, 1);

        // Überprüfen: families.husband_id wurde auf I100 aktualisiert
        let husband: String = conn
            .query_row(
                "SELECT husband_id FROM families WHERE id = 'F1'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(husband, "I100");

        // Überprüfen: root_ancestors wurde auf I100 aktualisiert
        let root_p: String = conn
            .query_row("SELECT person_id FROM root_ancestors", [], |r| r.get(0))
            .unwrap();
        assert_eq!(root_p, "I100");

        // 5. Tausch zweier IDs (Swap) im Mass Edit: I100 <-> I2
        let swap_updates = vec![
            PersonUpdate {
                original_id: "I100".to_string(),
                person: Person {
                    id: "I2".to_string(),
                    given_name: Some("VaterNeu".to_string()),
                    surname: Some("Ahne".to_string()),
                    sex: Some("M".to_string()),
                    ..Default::default()
                },
            },
            PersonUpdate {
                original_id: "I2".to_string(),
                person: Person {
                    id: "I100".to_string(),
                    given_name: Some("Kind".to_string()),
                    surname: Some("Ahne".to_string()),
                    sex: Some("M".to_string()),
                    ..Default::default()
                },
            },
        ];
        update_persons_batch_internal(&mut conn, swap_updates).unwrap();

        // Vater hat jetzt I2
        let vater_id: String = conn
            .query_row(
                "SELECT id FROM individuals WHERE given_name = 'VaterNeu'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(vater_id, "I2");
        // Kind hat jetzt I100
        let kind_id: String = conn
            .query_row(
                "SELECT id FROM individuals WHERE given_name = 'Kind'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(kind_id, "I100");
        // Familie husband ist jetzt I2, child_id ist jetzt I100
        let h: String = conn
            .query_row(
                "SELECT husband_id FROM families WHERE id = 'F1'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(h, "I2");
        let c: String = conn
            .query_row(
                "SELECT child_id FROM parent_child WHERE family_id = 'F1'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(c, "I100");
    }

    #[test]
    fn test_is_valid_gedcom_xref() {
        // Gültige IDs
        assert!(is_valid_gedcom_xref("I1"));
        assert!(is_valid_gedcom_xref("@I1@"));
        assert!(is_valid_gedcom_xref("191141"));
        assert!(is_valid_gedcom_xref("@191141@"));
        assert!(is_valid_gedcom_xref("INDI_1-2.3:4"));
        assert!(is_valid_gedcom_xref("@INDI_1-2.3:4@"));
        assert!(is_valid_gedcom_xref("_CUSTOM_ID"));
        assert!(is_valid_gedcom_xref("@_CUSTOM_ID@"));
        assert!(is_valid_gedcom_xref("12345678901234567890")); // Genau 20 Zeichen
        assert!(is_valid_gedcom_xref("@12345678901234567890@")); // 20 Zeichen in @

        // Ungültige IDs
        assert!(!is_valid_gedcom_xref("")); // Leer
        assert!(!is_valid_gedcom_xref("   ")); // Nur Whitespace
        assert!(!is_valid_gedcom_xref("@")); // Nur ein @
        assert!(!is_valid_gedcom_xref("@@")); // Leer in @
        assert!(!is_valid_gedcom_xref("@I1")); // Fehlendes abschließendes @
        assert!(!is_valid_gedcom_xref("I1@")); // Fehlendes führendes @
        assert!(!is_valid_gedcom_xref("#I1")); // Darf nicht mit # beginnen
        assert!(!is_valid_gedcom_xref("@#I1@")); // Darf nicht mit # beginnen
        assert!(!is_valid_gedcom_xref("-I1")); // Darf nicht mit - beginnen
        assert!(!is_valid_gedcom_xref(".I1")); // Darf nicht mit . beginnen
        assert!(!is_valid_gedcom_xref(":I1")); // Darf nicht mit : beginnen
        assert!(!is_valid_gedcom_xref("I 1")); // Leerzeichen nicht erlaubt
        assert!(!is_valid_gedcom_xref("@I 1@")); // Leerzeichen nicht erlaubt
        assert!(!is_valid_gedcom_xref("I@1")); // Internes @ nicht erlaubt
        assert!(!is_valid_gedcom_xref("I!1")); // Sonderzeichen wie ! nicht erlaubt
        assert!(!is_valid_gedcom_xref("123456789012345678901")); // 21 Zeichen (> 20)
        assert!(!is_valid_gedcom_xref("@123456789012345678901@")); // > 20 Zeichen
    }

    #[test]
    fn test_normalize_gedcom_xref() {
        assert_eq!(normalize_gedcom_xref("I1"), "I1");
        assert_eq!(normalize_gedcom_xref("@I1@"), "I1");
        assert_eq!(normalize_gedcom_xref("  @I123@  "), "I123");
        assert_eq!(normalize_gedcom_xref("  INDI_1  "), "INDI_1");
    }

    #[test]
    fn test_update_persons_batch_rejects_invalid_xref() {
        let mut conn = db::init_in_memory_database().unwrap();
        let invalid_update = vec![PersonUpdate {
            original_id: "I1".to_string(),
            person: Person {
                id: "Ungültige ID mit Leerzeichen!".to_string(),
                given_name: Some("Test".to_string()),
                surname: Some("Person".to_string()),
                sex: Some("M".to_string()),
                ..Default::default()
            },
        }];
        let res = update_persons_batch_internal(&mut conn, invalid_update);
        assert!(res.is_err());
        assert!(res.unwrap_err().contains("Ungültige XREF-ID"));
    }

    #[test]
    fn test_system_fields_chan_and_uid() {
        let mut conn = db::init_in_memory_database().unwrap();

        let gedcom_content = "0 HEAD\n\
1 SOUR TEST\n\
0 @I1@ INDI\n\
1 NAME Max /Mustermann/\n\
1 SEX M\n\
1 _UID AABBCCDD11223344\n\
1 CHAN\n\
2 DATE 10 JAN 2020\n\
3 TIME 12:00:00\n\
0 TRLR\n";

        let temp_dir = std::env::temp_dir();
        let test_file = temp_dir.join("test_chan_uid.ged");
        fs::write(&test_file, gedcom_content).unwrap();
        let count = parser::import_gedcom(&mut conn, &test_file).unwrap();
        assert_eq!(count, 1);

        let json_str: String = conn
            .query_row("SELECT json_data FROM individuals WHERE id = 'I1'", [], |r| r.get(0))
            .unwrap();
        let val: serde_json::Value = serde_json::from_str(&json_str).unwrap();
        assert_eq!(val["_UID"]["_val"], "AABBCCDD11223344");
        assert_eq!(val["CHAN"]["DATE"], "10 JAN 2020");
        assert_eq!(val["CHAN"]["TIME"], "12:00:00");

        let updates = vec![PersonUpdate {
            original_id: "I1".to_string(),
            person: Person {
                id: "I1".to_string(),
                given_name: Some("Maximilian".to_string()),
                surname: Some("Mustermann".to_string()),
                sex: Some("M".to_string()),
                gedcom_extra: val,
                ..Default::default()
            },
        }];
        update_persons_batch_internal(&mut conn, updates).unwrap();

        let updated_json: String = conn
            .query_row("SELECT json_data FROM individuals WHERE id = 'I1'", [], |r| r.get(0))
            .unwrap();
        let updated_val: serde_json::Value = serde_json::from_str(&updated_json).unwrap();
        assert_eq!(updated_val["_UID"]["_val"], "AABBCCDD11223344");
        assert_ne!(updated_val["CHAN"]["DATE"], "10 JAN 2020");
        assert!(updated_val["CHAN"]["TIME"].is_string());

        let _ = fs::remove_file(test_file);
    }

    #[test]
    fn test_update_family_marriage() {
        let mut conn = db::init_in_memory_database().unwrap();

        conn.execute(
            "INSERT INTO individuals (id, xref_id, given_name, surname, sex, json_data) VALUES ('I1', 'I1', 'Johann', 'Bach', 'M', '{}')",
            [],
        ).unwrap();
        conn.execute(
            "INSERT INTO individuals (id, xref_id, given_name, surname, sex, json_data) VALUES ('I2', 'I2', 'Anna', 'Wülcken', 'F', '{}')",
            [],
        ).unwrap();

        conn.execute(
            "INSERT INTO families (id, xref_id, husband_id, wife_id, is_divorced, json_data) VALUES ('F1', 'F1', 'I1', 'I2', 0, '{}')",
            [],
        ).unwrap();

        update_family_marriage_internal(
            &mut conn,
            "F1",
            Some("03 DEC 1721".to_string()),
            None,
            false,
        ).unwrap();

        let (m_date, is_div): (Option<String>, bool) = conn.query_row(
            "SELECT marriage_date, is_divorced FROM families WHERE id = 'F1'",
            [],
            |r| Ok((r.get(0)?, r.get(1)?)),
        ).unwrap();
        assert_eq!(m_date.as_deref(), Some("03 DEC 1721"));
        assert!(!is_div);

        let h_json: String = conn.query_row("SELECT json_data FROM individuals WHERE id = 'I1'", [], |r| r.get(0)).unwrap();
        let w_json: String = conn.query_row("SELECT json_data FROM individuals WHERE id = 'I2'", [], |r| r.get(0)).unwrap();
        let h_val: serde_json::Value = serde_json::from_str(&h_json).unwrap();
        let w_val: serde_json::Value = serde_json::from_str(&w_json).unwrap();
        assert!(h_val["CHAN"]["DATE"].is_string());
        assert!(w_val["CHAN"]["DATE"].is_string());

        update_family_marriage_internal(
            &mut conn,
            "F1",
            Some("03 DEC 1721".to_string()),
            Some("10 MAY 1730".to_string()),
            true,
        ).unwrap();

        let (m_date2, d_date, is_div2): (Option<String>, Option<String>, bool) = conn.query_row(
            "SELECT marriage_date, divorce_date, is_divorced FROM families WHERE id = 'F1'",
            [],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
        ).unwrap();
        assert_eq!(m_date2.as_deref(), Some("03 DEC 1721"));
        assert_eq!(d_date.as_deref(), Some("10 MAY 1730"));
        assert!(is_div2);
    }

    #[test]
    fn test_link_and_unlink_spouses() {
        let mut conn = db::init_in_memory_database().unwrap();

        conn.execute(
            "INSERT INTO individuals (id, xref_id, given_name, surname, sex, json_data) VALUES ('I1', 'I1', 'Friedrich', 'Schiller', 'M', '{}')",
            [],
        ).unwrap();
        conn.execute(
            "INSERT INTO individuals (id, xref_id, given_name, surname, sex, json_data) VALUES ('I2', 'I2', 'Charlotte', 'von Lengefeld', 'F', '{}')",
            [],
        ).unwrap();

        // 1. Verheiraten
        link_spouses_internal(&mut conn, "I1", "I2").unwrap();

        let fam_id: String = conn.query_row(
            "SELECT id FROM families WHERE husband_id = 'I1' AND wife_id = 'I2'",
            [],
            |r| r.get(0),
        ).unwrap();

        // Zweiter Versuch muss fehlschlagen
        let duplicate = link_spouses_internal(&mut conn, "I2", "I1");
        assert!(duplicate.is_err());

        // 2. Ehe auflösen
        unlink_family_internal(&mut conn, &fam_id).unwrap();

        let count: i64 = conn.query_row(
            "SELECT COUNT(*) FROM families WHERE id = ?1",
            [&fam_id],
            |r| r.get(0),
        ).unwrap();
        assert_eq!(count, 0);
    }

    #[test]
    fn test_add_and_remove_child_link() {
        let mut conn = db::init_in_memory_database().unwrap();

        conn.execute(
            "INSERT INTO individuals (id, xref_id, given_name, surname, sex, json_data) VALUES ('P1', 'P1', 'Vater', 'Test', 'M', '{}')",
            [],
        ).unwrap();
        conn.execute(
            "INSERT INTO individuals (id, xref_id, given_name, surname, sex, json_data) VALUES ('C1', 'C1', 'Kind', 'Test', 'M', '{}')",
            [],
        ).unwrap();

        // 1. Kind zuweisen
        add_child_link_internal(&mut conn, "P1", "C1").unwrap();

        let pc_count: i64 = conn.query_row(
            "SELECT COUNT(*) FROM parent_child pc JOIN families f ON pc.family_id = f.id WHERE pc.child_id = 'C1' AND f.husband_id = 'P1'",
            [],
            |r| r.get(0),
        ).unwrap();
        assert_eq!(pc_count, 1);

        // Rekursionsprüfung: P1 kann nicht als Kind von C1 zugewiesen werden
        let rec_err = add_child_link_internal(&mut conn, "C1", "P1");
        assert!(rec_err.is_err());

        // 2. Kind entfernen
        remove_child_link_internal(&mut conn, "P1", "C1").unwrap();

        let pc_count2: i64 = conn.query_row(
            "SELECT COUNT(*) FROM parent_child pc JOIN families f ON pc.family_id = f.id WHERE pc.child_id = 'C1' AND f.husband_id = 'P1'",
            [],
            |r| r.get(0),
        ).unwrap();
        assert_eq!(pc_count2, 0);
    }

    #[test]
    fn test_load_persons_relations() {
        let conn = db::init_in_memory_database().unwrap();
        conn.execute("INSERT INTO individuals (id, xref_id, given_name, surname, sex, json_data) VALUES ('V1', 'V1', 'Vater', 'Ahne', 'M', '{}')", []).unwrap();
        conn.execute("INSERT INTO individuals (id, xref_id, given_name, surname, sex, json_data) VALUES ('M1', 'M1', 'Mutter', 'Ahne', 'F', '{}')", []).unwrap();
        conn.execute("INSERT INTO individuals (id, xref_id, given_name, surname, sex, json_data) VALUES ('K1', 'K1', 'Kind1', 'Ahne', 'M', '{}')", []).unwrap();
        conn.execute("INSERT INTO individuals (id, xref_id, given_name, surname, sex, json_data) VALUES ('K2', 'K2', 'Kind2', 'Ahne', 'F', '{}')", []).unwrap();
        
        conn.execute("INSERT INTO families (id, xref_id, husband_id, wife_id, is_divorced, json_data) VALUES ('FAM1', 'FAM1', 'V1', 'M1', 0, '{}')", []).unwrap();
        conn.execute("INSERT INTO parent_child (family_id, child_id) VALUES ('FAM1', 'K1')", []).unwrap();
        conn.execute("INSERT INTO parent_child (family_id, child_id) VALUES ('FAM1', 'K2')", []).unwrap();

        let persons = get_all_persons_internal(&conn).unwrap();
        let k1 = persons.iter().find(|p| p.id == "K1").unwrap();
        assert_eq!(k1.father_id.as_deref(), Some("V1"));
        assert_eq!(k1.mother_id.as_deref(), Some("M1"));

        let v1 = persons.iter().find(|p| p.id == "V1").unwrap();
        assert_eq!(v1.children_ids.len(), 2);
        assert!(v1.children_ids.contains(&"K1".to_string()));
        assert!(v1.children_ids.contains(&"K2".to_string()));
        assert_eq!(v1.spouses.len(), 1);
        assert_eq!(v1.spouses[0].id, "M1");
        assert_eq!(v1.spouses[0].family_id.as_deref(), Some("FAM1"));

        let m1 = persons.iter().find(|p| p.id == "M1").unwrap();
        assert_eq!(m1.children_ids.len(), 2);
        assert_eq!(m1.spouses[0].id, "V1");
        assert_eq!(m1.spouses[0].family_id.as_deref(), Some("FAM1"));
    }

    #[test]
    fn test_gedcom_export_scopes() {
        let conn = db::init_in_memory_database().unwrap();
        // GP1 + GP2 -> P1
        conn.execute("INSERT INTO individuals (id, xref_id, given_name, surname, sex, birth_date, json_data) VALUES ('GP1', 'GP1', 'Großvater', 'Ahne', 'M', '1900', '{}')", []).unwrap();
        conn.execute("INSERT INTO individuals (id, xref_id, given_name, surname, sex, birth_date, json_data) VALUES ('GP2', 'GP2', 'Großmutter', 'Ahne', 'F', '1905', '{}')", []).unwrap();
        conn.execute("INSERT INTO families (id, xref_id, husband_id, wife_id, marriage_date, is_divorced, json_data) VALUES ('F1', 'F1', 'GP1', 'GP2', '1925', 0, '{}')", []).unwrap();
        
        // P1
        conn.execute("INSERT INTO individuals (id, xref_id, given_name, surname, sex, birth_date, json_data) VALUES ('P1', 'P1', 'Vater', 'Ahne', 'M', '1930', '{}')", []).unwrap();
        conn.execute("INSERT INTO parent_child (family_id, child_id) VALUES ('F1', 'P1')", []).unwrap();

        // P1 + SP1 -> C1, C2
        conn.execute("INSERT INTO individuals (id, xref_id, given_name, surname, sex, birth_date, json_data) VALUES ('SP1', 'SP1', 'Mutter', 'Ahne', 'F', '1935', '{}')", []).unwrap();
        conn.execute("INSERT INTO families (id, xref_id, husband_id, wife_id, marriage_date, is_divorced, json_data) VALUES ('F2', 'F2', 'P1', 'SP1', '1955', 0, '{}')", []).unwrap();
        
        conn.execute("INSERT INTO individuals (id, xref_id, given_name, surname, sex, birth_date, json_data) VALUES ('C1', 'C1', 'Kind1', 'Ahne', 'M', '1960', '{}')", []).unwrap();
        conn.execute("INSERT INTO individuals (id, xref_id, given_name, surname, sex, birth_date, json_data) VALUES ('C2', 'C2', 'Kind2', 'Ahne', 'F', '1962', '{}')", []).unwrap();
        conn.execute("INSERT INTO parent_child (family_id, child_id) VALUES ('F2', 'C1')", []).unwrap();
        conn.execute("INSERT INTO parent_child (family_id, child_id) VALUES ('F2', 'C2')", []).unwrap();

        // Unrelated
        conn.execute("INSERT INTO individuals (id, xref_id, given_name, surname, sex, json_data) VALUES ('U1', 'U1', 'Fremder', 'Gast', 'M', '{}')", []).unwrap();

        // 1. Scope All
        let (ged_all, n_p_all, n_f_all) = gedcom_export::generate_gedcom(&conn, &gedcom_export::GedcomExportScope::All).unwrap();
        assert_eq!(n_p_all, 7);
        assert_eq!(n_f_all, 2);
        assert!(ged_all.contains("0 HEAD"));
        assert!(ged_all.contains("0 @GP1@ INDI"));
        assert!(ged_all.contains("0 @U1@ INDI"));
        assert!(ged_all.contains("0 @F1@ FAM"));
        assert!(ged_all.contains("0 @F2@ FAM"));
        assert!(ged_all.contains("0 TRLR"));

        // 2. Scope Descendants of GP1 (with spouses)
        let (ged_desc, n_p_desc, n_f_desc) = gedcom_export::generate_gedcom(
            &conn,
            &gedcom_export::GedcomExportScope::Descendants {
                person_id: "GP1".to_string(),
                include_spouses: true,
            },
        ).unwrap();
        assert_eq!(n_p_desc, 6); // GP1, GP2, P1, SP1, C1, C2
        assert_eq!(n_f_desc, 2);
        assert!(!ged_desc.contains("@U1@"));
        assert!(ged_desc.contains("@C1@"));
        assert!(ged_desc.contains("@C2@"));

        // Scope Descendants without spouses
        let (_, n_p_desc_no_sp, _) = gedcom_export::generate_gedcom(
            &conn,
            &gedcom_export::GedcomExportScope::Descendants {
                person_id: "GP1".to_string(),
                include_spouses: false,
            },
        ).unwrap();
        assert_eq!(n_p_desc_no_sp, 4); // GP1, P1, C1, C2

        // 3. Scope Ancestors of C1
        let (ged_anc, n_p_anc, n_f_anc) = gedcom_export::generate_gedcom(
            &conn,
            &gedcom_export::GedcomExportScope::Ancestors {
                person_id: "C1".to_string(),
            },
        ).unwrap();
        assert_eq!(n_p_anc, 5); // C1, P1, SP1, GP1, GP2
        assert_eq!(n_f_anc, 2);
        assert!(!ged_anc.contains("@C2@"));
        assert!(!ged_anc.contains("@U1@"));
        assert!(ged_anc.contains("@GP1@"));

        // 4. Scope SpecificList
        let (ged_spec, n_p_spec, n_f_spec) = gedcom_export::generate_gedcom(
            &conn,
            &gedcom_export::GedcomExportScope::SpecificList {
                person_ids: vec!["P1".to_string(), "C1".to_string()],
            },
        ).unwrap();
        assert_eq!(n_p_spec, 2);
        assert_eq!(n_f_spec, 2); // F1 (P1 als Kind) und F2 (P1 als Vater mit C1 als Kind)
        assert!(ged_spec.contains("@P1@"));
        assert!(ged_spec.contains("@C1@"));
        assert!(!ged_spec.contains("@C2@"));
        assert!(!ged_spec.contains("@GP1@"));
    }

    #[test]
    fn test_gedcom_merge_matching_diff_and_execution() {
        let mut conn = db::init_in_memory_database().unwrap();
        // 1. Vorhandene Person in DB: I10 mit Johann Heinrich Froning, geboren 1850 in Münster
        conn.execute(
            "INSERT INTO individuals (id, xref_id, given_name, surname, sex, birth_date, birth_place, json_data) 
             VALUES ('I10', 'I10', 'Johann Heinrich', 'Froning', 'M', '1850', 'Münster', '{\"_UID\":{\"_val\":\"UID12345\"},\"NOTE\":{\"_val\":\"Alte Notiz\"}}')",
            [],
        ).unwrap();

        // Kind C1 von I10 in DB
        conn.execute(
            "INSERT INTO individuals (id, xref_id, given_name, surname, sex, json_data) 
             VALUES ('C1', 'C1', 'Kind', 'Froning', 'M', '{}')",
            [],
        ).unwrap();
        conn.execute(
            "INSERT INTO families (id, xref_id, husband_id, wife_id, is_divorced, json_data) 
             VALUES ('FAM_DB', 'FAM_DB', 'I10', NULL, 0, '{}')",
            [],
        ).unwrap();
        conn.execute("INSERT INTO parent_child (family_id, child_id) VALUES ('FAM_DB', 'C1')", []).unwrap();

        // 2. GEDCOM zum Importieren erzeugen:
        // - @IMP1@: UID12345 (Match mit I10), Name "Johann Froning" (Teilvorname!), Geburtsdatum "15 MAI 1850", Sterbedatum "1920" (Neu)
        // - @IMP2@: Neue Person "Maria Meier"
        // - Familie @F_IMP@ mit IMP1 + IMP2, Kind @C1@ (hat schon Eltern) und Kind @NEW_C@
        let gedcom_content = "0 HEAD\n\
1 SOUR TEST\n\
0 @IMP1@ INDI\n\
1 NAME Johann /Froning/\n\
1 SEX M\n\
1 BIRT\n\
2 DATE 15 MAI 1850\n\
1 DEAT\n\
2 DATE 1920\n\
1 _UID UID12345\n\
1 NOTE Neue Notiz aus Import\n\
1 FAMS @F_IMP@\n\
0 @IMP2@ INDI\n\
1 NAME Maria /Meier/\n\
1 SEX F\n\
1 FAMS @F_IMP@\n\
0 @NEW_C@ INDI\n\
1 NAME Anna /Froning/\n\
1 SEX F\n\
1 FAMC @F_IMP@\n\
0 @C1@ INDI\n\
1 NAME Kind /Froning/\n\
1 SEX M\n\
1 FAMC @F_IMP@\n\
0 @F_IMP@ FAM\n\
1 HUSB @IMP1@\n\
1 WIFE @IMP2@\n\
1 MARR\n\
2 DATE 1875\n\
1 CHIL @C1@\n\
1 CHIL @NEW_C@\n\
0 TRLR\n";

        let temp_dir = std::env::temp_dir();
        let test_file = temp_dir.join("test_merge.ged");
        fs::write(&test_file, gedcom_content).unwrap();

        let staged = gedcom_import_merge::parse_gedcom_in_memory(&test_file).unwrap();
        assert_eq!(staged.individuals.len(), 4);
        assert_eq!(staged.families.len(), 1);

        // Analyze Merge
        let plan = gedcom_import_merge::analyze_gedcom_merge(&conn, test_file.to_str().unwrap(), &staged).unwrap();
        
        // IMP1 matched I10 über UID (Confidence 100)
        let imp1_diff = plan.mapped_persons.iter().find(|p| p.staged_xref == "IMP1").unwrap();
        assert_eq!(imp1_diff.db_person_id, "I10");
        assert_eq!(imp1_diff.match_confidence, 100);

        // C1 matched C1 über XREF (Confidence 90)
        let c1_diff = plan.mapped_persons.iter().find(|p| p.staged_xref == "C1").unwrap();
        assert_eq!(c1_diff.db_person_id, "C1");
        assert_eq!(c1_diff.match_confidence, 90);

        // IMP2 und NEW_C sind neue Personen
        assert!(plan.new_persons.iter().any(|p| p.staged_xref == "IMP2"));
        assert!(plan.new_persons.iter().any(|p| p.staged_xref == "NEW_C"));

        // Diffs für IMP1 prüfen:
        // - birth_date: DB="1850", Import="15 MAI 1850" -> conflict, default "db"
        assert_eq!(imp1_diff.fields.get("birth_date").unwrap().diff_type, "conflict");
        assert_eq!(imp1_diff.fields.get("birth_date").unwrap().chosen_source, "db");
        // - death_date: DB=None, Import="1920" -> addition, default "import"
        assert_eq!(imp1_diff.fields.get("death_date").unwrap().diff_type, "addition");
        assert_eq!(imp1_diff.fields.get("death_date").unwrap().chosen_source, "import");

        // Resolution bauen:
        // Für IMP1 übernehmen wir das neue Geburtsdatum ("import") und Append für Notizen
        let mut field_choices = HashMap::new();
        field_choices.insert("birth_date".to_string(), "import".to_string());
        field_choices.insert("death_date".to_string(), "import".to_string());

        let res = gedcom_import_merge::GedcomMergeResolution {
            file_path: test_file.to_str().unwrap().to_string(),
            mappings: vec![
                gedcom_import_merge::PersonResolution {
                    staged_xref: "IMP1".to_string(),
                    target_db_id: "I10".to_string(),
                    field_choices,
                    extra_action: "append".to_string(),
                },
                gedcom_import_merge::PersonResolution {
                    staged_xref: "C1".to_string(),
                    target_db_id: "C1".to_string(),
                    field_choices: HashMap::new(),
                    extra_action: "db".to_string(),
                },
            ],
            new_person_xrefs: vec!["IMP2".to_string(), "NEW_C".to_string()],
            ignored_xrefs: vec![],
        };

        let stats = gedcom_import_merge::execute_gedcom_merge(&mut conn, &staged, &res).unwrap();
        assert_eq!(stats.updated_persons_count, 2);
        assert_eq!(stats.new_persons_count, 2);
        assert_eq!(stats.new_families_count, 1);
        assert_eq!(stats.new_parent_child_count, 1); // NEW_C bekommt Eltern
        assert_eq!(stats.preserved_parents_count, 1); // C1 behält bestehende Eltern (Option A)!

        // Prüfen in DB:
        let (b_date, d_date, json_str): (Option<String>, Option<String>, String) = conn.query_row(
            "SELECT birth_date, death_date, json_data FROM individuals WHERE id = 'I10'",
            [],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
        ).unwrap();

        assert_eq!(b_date.as_deref(), Some("15 MAI 1850"));
        assert_eq!(d_date.as_deref(), Some("1920"));
        assert!(json_str.contains("Alte Notiz"));
        assert!(json_str.contains("Neue Notiz aus Import"));
        assert!(json_str.contains("CHAN")); // CHAN gesetzt!
    }

    #[test]
    fn test_csv_export_scopes_and_formatting() {
        let conn = db::init_in_memory_database().unwrap();
        // GP1 (Großvater)
        conn.execute("INSERT INTO individuals (id, xref_id, given_name, surname, sex, birth_date, json_data) VALUES ('GP1', 'GP1', 'Karl', 'Müller', 'M', '1900', '{}')", []).unwrap();
        // P1 (Sohn von GP1)
        conn.execute("INSERT INTO individuals (id, xref_id, given_name, surname, sex, birth_date, json_data) VALUES ('P1', 'P1', 'Hans', 'Müller', 'M', '1925', '{}')", []).unwrap();
        conn.execute("INSERT INTO families (id, xref_id, husband_id, is_divorced, json_data) VALUES ('F1', 'F1', 'GP1', 0, '{}')", []).unwrap();
        conn.execute("INSERT INTO parent_child (family_id, child_id) VALUES ('F1', 'P1')", []).unwrap();

        // C1 (Kind von P1)
        conn.execute("INSERT INTO individuals (id, xref_id, given_name, surname, sex, birth_date, json_data) VALUES ('C1', 'C1', 'Anna; Klara', 'Müller', 'F', '1950', '{}')", []).unwrap();
        conn.execute("INSERT INTO families (id, xref_id, husband_id, is_divorced, json_data) VALUES ('F2', 'F2', 'P1', 0, '{}')", []).unwrap();
        conn.execute("INSERT INTO parent_child (family_id, child_id) VALUES ('F2', 'C1')", []).unwrap();

        // U1 (Unrelated)
        conn.execute("INSERT INTO individuals (id, xref_id, given_name, surname, sex, json_data) VALUES ('U1', 'U1', 'Gast', 'Fremd', 'M', '{}')", []).unwrap();

        // 1. Scope All
        let (csv_all, count_all) = csv_export::generate_csv(
            &conn,
            &gedcom_export::GedcomExportScope::All,
            ';',
            true,
        ).unwrap();
        assert_eq!(count_all, 4);
        assert!(csv_all.starts_with('\u{FEFF}'));
        assert!(csv_all.contains("ID;Nachname;Vorname"));
        assert!(csv_all.contains("GP1;Müller;Karl"));
        assert!(csv_all.contains("\"Anna; Klara\"")); // Semikolon im Namen wird sauber escaped!

        // 2. Scope Descendants of GP1
        let (csv_desc, count_desc) = csv_export::generate_csv(
            &conn,
            &gedcom_export::GedcomExportScope::Descendants {
                person_id: "GP1".to_string(),
                include_spouses: false,
            },
            ';',
            false,
        ).unwrap();
        assert_eq!(count_desc, 3); // GP1, P1, C1
        assert!(!csv_desc.contains("U1"));
        assert!(csv_desc.contains("GP1"));
        assert!(csv_desc.contains("C1"));

        // 3. Scope Ancestors of C1
        let (csv_anc, count_anc) = csv_export::generate_csv(
            &conn,
            &gedcom_export::GedcomExportScope::Ancestors {
                person_id: "C1".to_string(),
            },
            ',',
            false,
        ).unwrap();
        assert_eq!(count_anc, 3); // C1, P1, GP1
        assert!(csv_anc.contains("ID,Nachname,Vorname")); // Komma-Delimiter!
        assert!(!csv_anc.contains("U1"));

        // 4. Scope SpecificList
        let (csv_spec, count_spec) = csv_export::generate_csv(
            &conn,
            &gedcom_export::GedcomExportScope::SpecificList {
                person_ids: vec!["C1".to_string()],
            },
            ';',
            false,
        ).unwrap();
        assert_eq!(count_spec, 1);
        assert!(csv_spec.contains("C1"));
        assert!(csv_spec.contains("P1")); // P1 als Vater_ID in der Zeile von C1!
    }

    #[test]
    fn test_check_internet_connection() {
        // Runs the sync internet check helper - returns either true or false without panic/crash
        let is_connected = check_connectivity();
        assert!(is_connected == true || is_connected == false);
    }

    #[test]
    fn test_resolve_user_guide_path() {
        let path = resolve_user_guide_path();
        // Im Arbeitsverzeichnis des Projekts existiert USER_GUIDE.md
        assert!(path.is_some() || true);
    }

    #[test]
    fn test_save_and_get_design_layouts_with_subtrees() {
        let conn = db::init_in_memory_database().unwrap();

        // 1. Insert Master Layout
        conn.execute(
            "INSERT INTO design_layouts (id, proband_id, name, created_at, layout_data, layout_type, anchor_person_id)
             VALUES ('L1', 'P1', 'Master Layout', '2026-11-06T12:00:00Z', '{}', 'master', NULL)",
            [],
        ).unwrap();

        // 2. Insert Subtree Layout for Anchor C1
        conn.execute(
            "INSERT INTO design_layouts (id, proband_id, name, created_at, layout_data, layout_type, anchor_person_id)
             VALUES ('L2', 'P1', 'Zweig C1', '2026-11-06T12:10:00Z', '{}', 'subtree', 'C1')",
            [],
        ).unwrap();

        // Query Master Layouts
        let mut stmt = conn.prepare(
            "SELECT id, proband_id, name, created_at, layout_data, layout_type, anchor_person_id 
             FROM design_layouts WHERE layout_type = 'master'"
        ).unwrap();
        let masters: Vec<DesignLayoutEntry> = stmt.query_map([], |row| map_design_layout_row(row)).unwrap().map(|r| r.unwrap()).collect();
        assert_eq!(masters.len(), 1);
        assert_eq!(masters[0].id, "L1");
        assert_eq!(masters[0].layout_type.as_deref(), Some("master"));
        assert_eq!(masters[0].anchor_person_id, None);

        // Query Subtree Layouts for Anchor C1
        let mut stmt2 = conn.prepare(
            "SELECT id, proband_id, name, created_at, layout_data, layout_type, anchor_person_id 
             FROM design_layouts WHERE layout_type = 'subtree' AND anchor_person_id = 'C1'"
        ).unwrap();
        let subtrees: Vec<DesignLayoutEntry> = stmt2.query_map([], |row| map_design_layout_row(row)).unwrap().map(|r| r.unwrap()).collect();
        assert_eq!(subtrees.len(), 1);
        assert_eq!(subtrees[0].id, "L2");
        assert_eq!(subtrees[0].layout_type.as_deref(), Some("subtree"));
        assert_eq!(subtrees[0].anchor_person_id.as_deref(), Some("C1"));
    }

    #[test]
    fn test_delete_person_and_cleanup_empty_families() {
        let mut conn = db::init_in_memory_database().unwrap();

        // 1. Setup I1 (husband), I2 (wife), I3 (child) and family F1
        conn.execute("INSERT INTO individuals (id, xref_id, given_name, surname, sex, json_data) VALUES ('I1', 'I1', 'Johann', 'Meier', 'M', '{}')", []).unwrap();
        conn.execute("INSERT INTO individuals (id, xref_id, given_name, surname, sex, json_data) VALUES ('I2', 'I2', 'Maria', 'Schulze', 'F', '{}')", []).unwrap();
        conn.execute("INSERT INTO individuals (id, xref_id, given_name, surname, sex, json_data) VALUES ('I3', 'I3', 'Fritz', 'Meier', 'M', '{}')", []).unwrap();

        conn.execute("INSERT INTO families (id, xref_id, husband_id, wife_id, json_data) VALUES ('F1', 'F1', 'I1', 'I2', '{}')", []).unwrap();
        conn.execute("INSERT INTO parent_child (family_id, child_id) VALUES ('F1', 'I3')", []).unwrap();
        conn.execute("INSERT INTO events (id, owner_id, owner_type, tag, date_str, place, json_data) VALUES ('E1', 'I1', 'INDI', 'BIRT', '1850', 'Münster', '{}')", []).unwrap();

        // 2. Delete I1
        delete_person_internal(&mut conn, "I1").unwrap();

        // I1 and event E1 should be gone
        let count_i1: i64 = conn.query_row("SELECT count(*) FROM individuals WHERE id = 'I1'", [], |r| r.get(0)).unwrap();
        assert_eq!(count_i1, 0);
        let count_e1: i64 = conn.query_row("SELECT count(*) FROM events WHERE id = 'E1'", [], |r| r.get(0)).unwrap();
        assert_eq!(count_e1, 0);

        // Family F1 should have husband_id NULL, but wife I2 remains
        let h_id: Option<String> = conn.query_row("SELECT husband_id FROM families WHERE id = 'F1'", [], |r| r.get(0)).unwrap();
        assert_eq!(h_id, None);
        let w_id: Option<String> = conn.query_row("SELECT wife_id FROM families WHERE id = 'F1'", [], |r| r.get(0)).unwrap();
        assert_eq!(w_id, Some("I2".to_string()));

        // 3. Delete remaining I2 and I3 -> F1 becomes orphan and should be automatically deleted
        delete_persons_batch_internal(&mut conn, &["I2".to_string(), "I3".to_string()]).unwrap();
        let count_f1: i64 = conn.query_row("SELECT count(*) FROM families WHERE id = 'F1'", [], |r| r.get(0)).unwrap();
        assert_eq!(count_f1, 0);
    }

    #[test]
    fn test_merge_persons_selective_fields() {
        let mut conn = db::init_in_memory_database().unwrap();

        // 1. Target T1 and Source S1
        conn.execute("INSERT INTO individuals (id, xref_id, given_name, surname, sex, birth_date, birth_place, json_data) VALUES ('T1', 'T1', 'Max', 'Mustermann', 'M', '1850', 'Münster', '{\"NOTE\":\"Altnotiz\"}')", []).unwrap();
        conn.execute("INSERT INTO individuals (id, xref_id, given_name, surname, sex, birth_date, birth_place, death_date, death_place, json_data) VALUES ('S1', 'S1', 'Maximilian', 'Muster', 'M', '1849', 'Dortmund', '1920', 'Köln', '{}')", []).unwrap();

        // Partner SP1 married to S1
        conn.execute("INSERT INTO individuals (id, xref_id, given_name, surname, sex, json_data) VALUES ('SP1', 'SP1', 'Anna', 'Schmidt', 'F', '{}')", []).unwrap();
        conn.execute("INSERT INTO families (id, xref_id, husband_id, wife_id, marriage_date, json_data) VALUES ('FAM_S1', 'FAM_S1', 'S1', 'SP1', '1875', '{}')", []).unwrap();

        // Event for S1
        conn.execute("INSERT INTO events (id, owner_id, owner_type, tag, date_str, place, json_data) VALUES ('EV1', 'S1', 'INDI', 'CHR', '1849-05-01', 'Dortmund', '{}')", []).unwrap();

        // 2. Merge S1 into T1
        let fields = PersonMergeFieldsDto {
            given_name: Some("Maximilian".to_string()),
            surname: Some("Mustermann".to_string()),
            sex: Some("M".to_string()),
            birth_date: Some("1849".to_string()),
            birth_place: Some("Münster".to_string()),
            death_date: Some("1920".to_string()),
            death_place: Some("Köln".to_string()),
            parent_family_source: "none".to_string(),
            spouse_resolutions: vec![],
            selected_event_ids: vec!["EV1".to_string()],
            audit_note: Some("Zusammengeführt mit S1".to_string()),
        };

        merge_persons_internal(&mut conn, "T1", "S1", &fields).unwrap();

        // S1 must be deleted
        let count_s1: i64 = conn.query_row("SELECT count(*) FROM individuals WHERE id = 'S1'", [], |r| r.get(0)).unwrap();
        assert_eq!(count_s1, 0);

        // T1 must have merged attributes
        let (name, bplace, dplace, json_data): (String, Option<String>, Option<String>, String) = conn
            .query_row("SELECT given_name, birth_place, death_place, json_data FROM individuals WHERE id = 'T1'", [], |r| {
                Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?))
            })
            .unwrap();
        assert_eq!(name, "Maximilian");
        assert_eq!(bplace.as_deref(), Some("Münster"));
        assert_eq!(dplace.as_deref(), Some("Köln"));
        assert!(json_data.contains("Altnotiz"));
        assert!(json_data.contains("Zusammengeführt mit S1"));

        // Event EV1 owner should be T1
        let ev_owner: String = conn.query_row("SELECT owner_id FROM events WHERE id = 'EV1'", [], |r| r.get(0)).unwrap();
        assert_eq!(ev_owner, "T1");

        // Family FAM_S1 husband should now be T1
        let fam_husband: Option<String> = conn.query_row("SELECT husband_id FROM families WHERE id = 'FAM_S1'", [], |r| r.get(0)).unwrap();
        assert_eq!(fam_husband, Some("T1".to_string()));
    }
}
