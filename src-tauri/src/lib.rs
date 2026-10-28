pub mod db;
pub mod parser;

use petgraph::algo::astar;
use petgraph::graph::{DiGraph, NodeIndex};
use rusqlite::Connection;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::path::PathBuf;
use std::process::Command;
use std::sync::Mutex;
use tauri::{Manager, State};
use tera::{Context, Tera};

#[cfg(target_os = "windows")]
use std::os::windows::process::CommandExt;

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ProbandData {
    pub henry_code: String,
    pub generation: i32,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct SpouseConnection {
    pub id: String,
    pub date: Option<String>,
    pub place: Option<String>,
    pub divorce_date: Option<String>,
    pub is_divorced: bool,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
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
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct PersonUpdate {
    pub original_id: String,
    pub person: Person,
}

pub struct AppState {
    pub db: Mutex<Connection>,
    pub app_dir: PathBuf,
    pub active_tree: Mutex<String>,
}

#[tauri::command]
fn get_trees(state: State<AppState>) -> Result<Vec<String>, String> {
    let mut trees = Vec::new();
    if let Ok(entries) = fs::read_dir(&state.app_dir) {
        for entry in entries.flatten() {
            let path = entry.path();
            if path.extension().and_then(|s| s.to_str()) == Some("db") {
                if let Some(stem) = path.file_stem().and_then(|s| s.to_str()) {
                    trees.push(stem.to_string());
                }
            }
        }
    }
    trees.sort();
    trees.dedup();
    Ok(trees)
}

#[tauri::command]
fn switch_tree(state: State<AppState>, tree_name: String) -> Result<(), String> {
    let db_path = state.app_dir.join(format!("{}.db", tree_name));
    let new_conn = db::init_database(&db_path).map_err(|e| e.to_string())?;
    let mut conn = state.db.lock().map_err(|e| e.to_string())?;
    *conn = new_conn;
    let mut active = state.active_tree.lock().map_err(|e| e.to_string())?;
    *active = tree_name;
    Ok(())
}

pub fn delete_tree_internal(
    app_dir: &std::path::Path,
    conn: &mut Connection,
    active: &mut String,
    tree_name: &str,
) -> Result<Vec<String>, String> {
    if tree_name.is_empty() || tree_name.contains('/') || tree_name.contains('\\') || tree_name.contains("..") {
        return Err("Ungültiger Stammbaum-Name".into());
    }

    // Vorhandene Bäume ermitteln (ohne den zu löschenden)
    let mut remaining_trees = Vec::new();
    if let Ok(entries) = fs::read_dir(app_dir) {
        for entry in entries.flatten() {
            let path = entry.path();
            if path.extension().and_then(|s| s.to_str()) == Some("db") {
                if let Some(stem) = path.file_stem().and_then(|s| s.to_str()) {
                    if stem != tree_name {
                        remaining_trees.push(stem.to_string());
                    }
                }
            }
        }
    }
    remaining_trees.sort();
    remaining_trees.dedup();

    // Immer zuerst WAL-Checkpoint durchführen und auf initialisierte In-Memory-DB wechseln,
    // damit alle File-Locks auf Windows garantiert sofort freigegeben werden.
    let _ = conn.execute_batch("PRAGMA wal_checkpoint(TRUNCATE);");
    *conn = db::init_in_memory_database().map_err(|e| e.to_string())?;

    // Alle zugehörigen Dateien dieses Stammbaums sammeln und physisch von der Festplatte entfernen
    let mut files_to_delete = Vec::new();
    if let Ok(entries) = fs::read_dir(app_dir) {
        for entry in entries.flatten() {
            let path = entry.path();
            if let Some(file_name) = path.file_name().and_then(|s| s.to_str()) {
                if file_name == format!("{}.db", tree_name)
                    || file_name.starts_with(&format!("{}.db-", tree_name))
                    || file_name == format!("{}.sqlite", tree_name)
                    || file_name.starts_with(&format!("{}.sqlite-", tree_name))
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
    if !active.is_empty() && *active != tree_name && remaining_trees.contains(active) {
        let keep_path = app_dir.join(format!("{}.db", active));
        *conn = db::init_database(&keep_path).map_err(|e| e.to_string())?;
    } else if let Some(first) = remaining_trees.first() {
        let next_path = app_dir.join(format!("{}.db", first));
        *conn = db::init_database(&next_path).map_err(|e| e.to_string())?;
        *active = first.clone();
    } else {
        *active = String::new();
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
    
    let mut codes_stmt = conn.prepare("SELECT proband_id, person_id, henry_code, generation FROM proband_henry_codes").map_err(|e| e.to_string())?;
    let code_rows = codes_stmt.query_map([], |row| {
        Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?, row.get::<_, String>(2)?, row.get::<_, i32>(3)?))
    }).map_err(|e| e.to_string())?;

    let mut codes_map: HashMap<String, HashMap<String, ProbandData>> = HashMap::new();
    for r in code_rows {
        if let Ok((proband_id, person_id, henry_code, generation)) = r {
            codes_map.entry(person_id).or_default().insert(proband_id, ProbandData { henry_code, generation });
        }
    }

    let mut spouse_map: HashMap<String, Vec<SpouseConnection>> = HashMap::new();
    let mut parent_map: HashMap<String, Vec<String>> = HashMap::new();
    let mut family_parents: HashMap<String, Vec<String>> = HashMap::new();

    let mut fam_stmt = conn.prepare("SELECT id, husband_id, wife_id, marriage_date, divorce_date, is_divorced, json_data FROM families").unwrap();
    let fam_rows = fam_stmt.query_map([], |row| {
        Ok((
            row.get::<_, String>(0)?, row.get::<_, Option<String>>(1)?, row.get::<_, Option<String>>(2)?,
            row.get::<_, Option<String>>(3)?, row.get::<_, Option<String>>(4)?, row.get::<_, bool>(5)?,
            row.get::<_, String>(6)?
        ))
    }).unwrap();
    
    for f in fam_rows {
        if let Ok((fam_id, h_opt, w_opt, m_date, d_date, is_divorced, json_str)) = f {
            let mut m_place = None;
            if let Ok(json_val) = serde_json::from_str::<serde_json::Value>(&json_str) {
                if let Some(marr) = json_val.get("MARR") {
                    if let Some(plac) = marr.get("PLAC") {
                        m_place = plac.as_str().map(|s| s.to_string());
                    }
                }
            }
            
            let mut parents = Vec::new();
            if let Some(h) = h_opt.clone() { parents.push(h.clone()); }
            if let Some(w) = w_opt.clone() { parents.push(w.clone()); }
            family_parents.insert(fam_id, parents);

            if let (Some(h), Some(w)) = (h_opt, w_opt) {
                let conn_w = SpouseConnection { id: w.clone(), date: m_date.clone(), place: m_place.clone(), divorce_date: d_date.clone(), is_divorced };
                let conn_h = SpouseConnection { id: h.clone(), date: m_date, place: m_place, divorce_date: d_date, is_divorced };
                
                if !spouse_map.entry(h.clone()).or_default().iter().any(|c| c.id == w) { spouse_map.get_mut(&h).unwrap().push(conn_w); }
                if !spouse_map.entry(w.clone()).or_default().iter().any(|c| c.id == h) { spouse_map.get_mut(&w).unwrap().push(conn_h); }
            }
        }
    }

    let mut pc_stmt = conn.prepare("SELECT family_id, child_id FROM parent_child").unwrap();
    let pc_rows = pc_stmt.query_map([], |row| Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))).unwrap();
    for pc in pc_rows {
        if let Ok((fam_id, child_id)) = pc {
            if let Some(parents) = family_parents.get(&fam_id) {
                let p_list = parent_map.entry(child_id).or_default();
                for p in parents { if !p_list.contains(p) { p_list.push(p.clone()); } }
            }
        }
    }

    let mut stmt = conn.prepare("SELECT id, given_name, surname, sex, birth_date, birth_place, death_date, death_place, json(json_data) FROM individuals ORDER BY surname, given_name").map_err(|e| e.to_string())?;
    let rows = stmt.query_map([], |row| {
        let id: String = row.get(0)?;
        let extra_str: Option<String> = row.get(8)?;
        let extra_json = extra_str.and_then(|s| serde_json::from_str(&s).ok()).unwrap_or(serde_json::json!({}));
        let p_data = codes_map.remove(&id).unwrap_or_default();
        let spouses = spouse_map.remove(&id).unwrap_or_default();
        let parents = parent_map.remove(&id).unwrap_or_default();

        Ok(Person {
            id, given_name: row.get(1)?, surname: row.get(2)?, sex: row.get(3)?,
            birth_date: row.get(4)?, birth_place: row.get(5)?, death_date: row.get(6)?, death_place: row.get(7)?,
            proband_data: p_data, gedcom_extra: extra_json, spouses, parent_ids: parents,
        })
    }).map_err(|e| e.to_string())?;

    let mut result = Vec::new();
    for p in rows { result.push(p.map_err(|e| e.to_string())?); }
    Ok(result)
}

#[tauri::command]
fn get_person_details(state: State<AppState>, person_id: String) -> Result<PersonDetailsResponse, String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;

    let mut stmt = conn.prepare("SELECT f.husband_id, f.wife_id FROM parent_child pc JOIN families f ON pc.family_id = f.id WHERE pc.child_id = ?1").map_err(|e| e.to_string())?;
    let mut parent_ids = Vec::new();
    let rows = stmt.query_map([&person_id], |row| Ok((row.get::<_, Option<String>>(0)?, row.get::<_, Option<String>>(1)?))).map_err(|e| e.to_string())?;
    for r in rows {
        if let Ok((h, w)) = r {
            if let Some(hid) = h { parent_ids.push(hid); }
            if let Some(wid) = w { parent_ids.push(wid); }
        }
    }
    let mut parents = Vec::new();
    for pid in parent_ids { if let Some(p) = fetch_relative_person(&conn, &pid)? { parents.push(p); } }

    let mut stmt = conn.prepare("SELECT pc.child_id FROM parent_child pc WHERE pc.family_id IN (SELECT family_id FROM parent_child WHERE child_id = ?1) AND pc.child_id != ?1").map_err(|e| e.to_string())?;
    let sibling_ids: Vec<String> = stmt.query_map([&person_id], |row| row.get(0)).map_err(|e| e.to_string())?.filter_map(Result::ok).collect();
    let mut siblings = Vec::new();
    for sid in sibling_ids { if let Some(s) = fetch_relative_person(&conn, &sid)? { siblings.push(s); } }

    let mut stmt = conn.prepare("SELECT id, husband_id, wife_id, marriage_date, divorce_date, is_divorced FROM families WHERE husband_id = ?1 OR wife_id = ?1").map_err(|e| e.to_string())?;
    let spouses_iter = stmt.query_map([&person_id], |row| {
        Ok((row.get::<_, String>(0)?, row.get::<_, Option<String>>(1)?, row.get::<_, Option<String>>(2)?, row.get::<_, Option<String>>(3)?, row.get::<_, Option<String>>(4)?, row.get::<_, bool>(5)?))
    }).map_err(|e| e.to_string())?;

    let mut spouses = Vec::new();
    let mut children_ids = Vec::new();

    for res in spouses_iter {
        if let Ok((fam_id, h_id, w_id, m_date, d_date, is_divorced)) = res {
            let partner_id = if h_id.as_deref() == Some(&person_id) { w_id } else { h_id };
            let mut partner_name = None; let mut partner_henry = None; let mut partner_birth = None; let mut partner_death = None;

            if let Some(pid) = &partner_id {
                if let Some(p) = fetch_relative_person(&conn, pid)? {
                    partner_name = Some(format!("{}, {}", p.surname.as_deref().unwrap_or(""), p.given_name.as_deref().unwrap_or("N.N.")));
                    partner_henry = p.henry_code; partner_birth = p.birth_date; partner_death = p.death_date;
                }
            }

            spouses.push(SpouseInfo { family_id: fam_id.clone(), partner_id, partner_name, partner_henry, partner_birth, partner_death, marriage_date: m_date, divorce_date: d_date, is_divorced });

            let mut c_stmt = conn.prepare("SELECT child_id FROM parent_child WHERE family_id = ?1").map_err(|e| e.to_string())?;
            let c_ids: Vec<String> = c_stmt.query_map([&fam_id], |r| r.get(0)).map_err(|e| e.to_string())?.filter_map(Result::ok).collect();
            for cid in c_ids { if !children_ids.contains(&cid) { children_ids.push(cid); } }
        }
    }

    let mut children = Vec::new();
    for cid in children_ids { if let Some(c) = fetch_relative_person(&conn, &cid)? { children.push(c); } }
    children.sort_by(|a, b| {
        let ka = parse_birth_sort_key(a.birth_date.as_deref().unwrap_or(""));
        let kb = parse_birth_sort_key(b.birth_date.as_deref().unwrap_or(""));
        ka.cmp(&kb).then_with(|| a.id.cmp(&b.id))
    });

    let mut stmt = conn.prepare("SELECT json_data FROM individuals WHERE id = ?1").map_err(|e| e.to_string())?;
    let json_str: String = stmt.query_row([&person_id], |row| row.get(0)).map_err(|e| e.to_string())?;
    let json_val: serde_json::Value = serde_json::from_str(&json_str).unwrap_or(serde_json::json!({}));

    let mut notes = Vec::new();
    let mut gedcom_tags: HashMap<String, String> = HashMap::new();

    if let Some(obj) = json_val.as_object() {
        for (k, v) in obj {
            if k == "NOTE" {
                if let Some(s) = v.as_str() { notes.push(s.to_string()); }
                else if let Some(map) = v.as_object() { if let Some(val) = map.get("_val").and_then(|x| x.as_str()) { notes.push(val.to_string()); } }
            }
            if let Some(s) = v.as_str() { gedcom_tags.insert(k.clone(), s.to_string()); } 
            else if let Some(map) = v.as_object() {
                let main_val = map.get("_val").and_then(|x| x.as_str()).unwrap_or("");
                let sub_str = map.iter().filter(|(sub_k, _)| *sub_k != "_val").map(|(sub_k, sub_v)| format!("{}: {}", sub_k, sub_v.as_str().unwrap_or(""))).collect::<Vec<String>>().join(", ");
                let combined = if sub_str.is_empty() { main_val.to_string() } else { format!("{} ({})", main_val, sub_str) };
                gedcom_tags.insert(k.clone(), combined);
            }
        }
    }
    Ok(PersonDetailsResponse { parents, siblings, spouses, children, notes, gedcom_tags })
}

fn fetch_relative_person(conn: &Connection, id: &str) -> Result<Option<RelativePerson>, String> {
    let mut stmt = conn.prepare("SELECT id, given_name, surname, henry_code, birth_date, death_date FROM individuals WHERE id = ?1").map_err(|e| e.to_string())?;
    let mut rows = stmt.query_map([id], |row| {
        Ok(RelativePerson { id: row.get(0)?, given_name: row.get(1)?, surname: row.get(2)?, henry_code: row.get(3)?, birth_date: row.get(4)?, death_date: row.get(5)? })
    }).map_err(|e| e.to_string())?;

    if let Some(row) = rows.next() { Ok(Some(row.map_err(|e| e.to_string())?)) } else { Ok(None) }
}

#[tauri::command]
fn get_root_ancestors(state: State<AppState>) -> Result<Vec<RootAncestorConfig>, String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    let mut stmt = conn.prepare("SELECT r.person_id, r.starting_code, i.given_name, i.surname FROM root_ancestors r JOIN individuals i ON r.person_id = i.id ORDER BY r.starting_code ASC").map_err(|e| e.to_string())?;
    let rows = stmt.query_map([], |row| { Ok(RootAncestorConfig { person_id: row.get(0)?, starting_code: row.get(1)?, given_name: row.get(2)?, surname: row.get(3)? }) }).map_err(|e| e.to_string())?;
    let mut result = Vec::new();
    for r in rows { result.push(r.map_err(|e| e.to_string())?); }
    Ok(result)
}

#[tauri::command]
fn add_root_ancestor(state: State<AppState>, person_id: String, starting_code: String) -> Result<(), String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    conn.execute("INSERT OR REPLACE INTO root_ancestors (person_id, starting_code) VALUES (?1, ?2)", rusqlite::params![person_id, starting_code]).map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
fn remove_root_ancestor(state: State<AppState>, person_id: String) -> Result<(), String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    conn.execute("DELETE FROM root_ancestors WHERE person_id = ?1", rusqlite::params![person_id]).map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
fn calculate_henry_codes_from_roots(state: State<AppState>) -> Result<(), String> {
    let mut conn = state.db.lock().map_err(|e| e.to_string())?;
    calculate_henry_codes_internal(&mut conn)
}

fn parse_birth_sort_key(date: &str) -> (i32, i32, i32) {
    let s = date.trim().to_uppercase();
    if s.is_empty() {
        return (9999, 99, 99);
    }

    // 1. ISO-Format: YYYY-MM-DD oder YYYY/MM/DD
    let parts_dash: Vec<&str> = s.split(|c| c == '-' || c == '/').collect();
    if parts_dash.len() >= 2 && parts_dash[0].len() == 4 {
        if let Ok(y) = parts_dash[0].parse::<i32>() {
            let m = parts_dash.get(1).and_then(|v| v.parse::<i32>().ok()).unwrap_or(99);
            let d = parts_dash.get(2).and_then(|v| v.split_whitespace().next()?.parse::<i32>().ok()).unwrap_or(99);
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

fn calculate_henry_codes_internal(conn: &mut Connection) -> Result<(), String> {
    // 1. Geburtsdaten laden für die Sortierung der Geschwister
    let mut birth_dates: HashMap<String, String> = HashMap::new();
    {
        let mut stmt = conn.prepare("SELECT id, birth_date FROM individuals").map_err(|e| e.to_string())?;
        let iter = stmt.query_map([], |row| Ok((row.get::<_, String>(0)?, row.get::<_, Option<String>>(1)?))).map_err(|e| e.to_string())?;
        for res in iter {
            if let Ok((id, Some(bd))) = res {
                birth_dates.insert(id, bd);
            }
        }
    }

    let families_map: HashMap<String, (Option<String>, Option<String>, Vec<String>)> = {
        let mut fam_stmt = conn.prepare("SELECT id, husband_id, wife_id FROM families").map_err(|e| e.to_string())?;
        let fam_iter = fam_stmt.query_map([], |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?))).map_err(|e| e.to_string())?;
        let mut map = HashMap::new();
        for fam_res in fam_iter {
            if let Ok((fam_id, h, w)) = fam_res {
                let mut c_stmt = conn.prepare("SELECT child_id FROM parent_child WHERE family_id = ?").map_err(|e| e.to_string())?;
                let children: Vec<String> = c_stmt.query_map([&fam_id], |r| r.get(0)).map_err(|e| e.to_string())?.filter_map(Result::ok).collect();
                map.insert(fam_id, (h, w, children));
            }
        }
        map
    };

    let tx = conn.transaction().map_err(|e| e.to_string())?;
    tx.execute("DELETE FROM proband_henry_codes", []).map_err(|e| e.to_string())?;

    let mut roots = Vec::new();
    {
        let mut stmt = tx.prepare("SELECT person_id, starting_code FROM root_ancestors").map_err(|e| e.to_string())?;
        let rows = stmt.query_map([], |row| Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))).map_err(|e| e.to_string())?;
        for r in rows { if let Ok(res) = r { roots.push(res); } }
    }

    for (proband_id, start_code) in roots {
        // 1. Alle Nachkommen des gewählten Stammahnen ermitteln (Teil des Stammbaums dieses Stammahnen)
        let mut tree_members = std::collections::HashSet::new();
        let mut member_queue = std::collections::VecDeque::new();
        tree_members.insert(proband_id.clone());
        member_queue.push_back(proband_id.clone());

        while let Some(curr) = member_queue.pop_front() {
            for (_fam_id, (husband, wife, children)) in &families_map {
                if husband.as_ref() == Some(&curr) || wife.as_ref() == Some(&curr) {
                    for c in children {
                        if c != &curr && !tree_members.contains(c) {
                            tree_members.insert(c.clone());
                            member_queue.push_back(c.clone());
                        }
                    }
                }
            }
        }

        // 2. Henry-Codes vergeben:
        // - Wenn der Vater Teil des Stammbaums des gewählten Stammahnen ist (auch wenn beide Eltern im Stammbaum sind),
        //   werden die Linien patrilinear unter dem Vater weitergeführt.
        // - Wenn der Vater NICHT Teil des Stammbaums des gewählten Stammahnen ist,
        //   werden die Kinder unter der Mutter weitergeführt.
        let mut queue = std::collections::VecDeque::new();
        queue.push_back((proband_id.clone(), start_code, 1));
        let mut visited = std::collections::HashSet::new();

        while let Some((curr_id, code, gen_num)) = queue.pop_front() {
            if visited.contains(&curr_id) { continue; }
            visited.insert(curr_id.clone());

            tx.execute(
                "INSERT INTO proband_henry_codes (proband_id, person_id, henry_code, generation) VALUES (?1, ?2, ?3, ?4)",
                rusqlite::params![proband_id, curr_id, code, gen_num],
            ).map_err(|e| e.to_string())?;

            let mut all_children = Vec::new();
            for (_fam_id, (husband, wife, children)) in &families_map {
                let father_in_tree = husband.as_ref().map_or(false, |h| tree_members.contains(h));
                let mother_in_tree = wife.as_ref().map_or(false, |w| tree_members.contains(w));

                let should_continue_here = if father_in_tree {
                    husband.as_ref() == Some(&curr_id)
                } else if mother_in_tree {
                    wife.as_ref() == Some(&curr_id)
                } else {
                    false
                };

                if should_continue_here {
                    for c in children { 
                        // Verhindert Zyklen, Rekursion und doppelte Aufnahme
                        if !visited.contains(c) && !all_children.contains(c) && c != &curr_id {
                            all_children.push(c.clone()); 
                        } 
                    }
                }
            }
            
            // Kinder chronologisch nach Geburtsdatum sortieren (Jahr, Monat, Tag; mit ID als Tie-Breaker)
            all_children.sort_by(|a, b| {
                let ka = parse_birth_sort_key(birth_dates.get(a).map(|s| s.as_str()).unwrap_or(""));
                let kb = parse_birth_sort_key(birth_dates.get(b).map(|s| s.as_str()).unwrap_or(""));
                ka.cmp(&kb).then_with(|| a.cmp(b))
            });
            
            for (idx, child_id) in all_children.iter().enumerate() {
                queue.push_back((child_id.clone(), crate::db::generate_next_henry_code(&code, idx + 1), gen_num + 1));
            }
        }
    }
    tx.commit().map_err(|e| e.to_string())?;
    Ok(())
}

fn check_parent_recursion(conn: &Connection, person_id: &str, parent_candidate_id: &str) -> Result<bool, String> {
    if person_id == parent_candidate_id {
        return Ok(true); // Direkte Selbstreferenz
    }
    
    let mut queue = std::collections::VecDeque::new();
    let mut visited = std::collections::HashSet::new();
    queue.push_back(parent_candidate_id.to_string());
    visited.insert(parent_candidate_id.to_string());

    let mut stmt = conn.prepare(
        "SELECT f.husband_id, f.wife_id 
         FROM parent_child pc 
         JOIN families f ON pc.family_id = f.id 
         WHERE pc.child_id = ?1"
    ).map_err(|e| e.to_string())?;

    while let Some(current_id) = queue.pop_front() {
        let parent_rows = stmt.query_map([&current_id], |row| {
            Ok((row.get::<_, Option<String>>(0)?, row.get::<_, Option<String>>(1)?))
        }).map_err(|e| e.to_string())?;

        for p_res in parent_rows {
            if let Ok((h_opt, w_opt)) = p_res {
                for parent_opt in [h_opt, w_opt] {
                    if let Some(pid) = parent_opt {
                        if pid == person_id {
                            return Ok(true); // Rekursion erkannt! person_id ist ein Vorfahre von parent_candidate_id
                        }
                        if !visited.contains(&pid) {
                            visited.insert(pid.clone());
                            queue.push_back(pid);
                        }
                    }
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
            return Err("Rekursion erkannt: Der gewählte Vater ist bereits ein Nachfahre dieser Person.".to_string());
        }
    }
    if let Some(mid) = &m_opt {
        if check_parent_recursion(&conn, &person_id, mid)? {
            return Err("Rekursion erkannt: Die gewählte Mutter ist bereits ein Nachfahre dieser Person.".to_string());
        }
    }

    let tx = conn.transaction().map_err(|e| e.to_string())?;

    // Bisherige Elternschaften des Kindes lösen
    tx.execute("DELETE FROM parent_child WHERE child_id = ?1", [&person_id]).map_err(|e| e.to_string())?;

    // Falls mindestens ein Elternteil gesetzt ist:
    if f_opt.is_some() || m_opt.is_some() {
        // Prüfen, ob bereits eine Familie mit diesen Eltern existiert
        let existing_fam_id: Option<String> = {
            let mut stmt = tx.prepare(
                "SELECT id FROM families 
                 WHERE (husband_id = ?1 OR (?1 IS NULL AND husband_id IS NULL))
                   AND (wife_id = ?2 OR (?2 IS NULL AND wife_id IS NULL))"
            ).map_err(|e| e.to_string())?;
            stmt.query_row(rusqlite::params![f_opt, m_opt], |row| row.get(0)).ok()
        };

        let target_fam_id = if let Some(fid) = existing_fam_id {
            fid
        } else {
            let fid = format!("F{}", uuid::Uuid::new_v4().simple());
            tx.execute(
                "INSERT INTO families (id, xref_id, husband_id, wife_id, is_divorced, json_data) VALUES (?1, ?1, ?2, ?3, 0, '{}')",
                rusqlite::params![fid, f_opt, m_opt],
            ).map_err(|e| e.to_string())?;
            fid
        };

        tx.execute(
            "INSERT INTO parent_child (family_id, child_id) VALUES (?1, ?2)",
            rusqlite::params![target_fam_id, person_id],
        ).map_err(|e| e.to_string())?;
    }

    tx.commit().map_err(|e| e.to_string())?;

    // Henry-Codes im Baum neu berechnen
    let _ = calculate_henry_codes_internal(&mut conn);

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
    let first = chars.next().unwrap();
    // Erstes Zeichen muss alphanumerisch oder ein Unterstrich sein (nicht '#' oder sonstige Sonderzeichen)
    if !(first.is_ascii_alphanumeric() || first == '_') {
        return false;
    }

    // Nachfolgende Zeichen: alphanumerisch, Unterstrich, Doppelpunkt, Punkt, Bindestrich
    for c in chars {
        if !(c.is_ascii_alphanumeric() || c == '_' || c == '.' || c == ':' || c == '-') {
            return false;
        }
    }

    true
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
        let trimmed = cid.trim().to_string();
        if !is_valid_gedcom_xref(&trimmed) {
            return Err(format!("Ungültige XREF-ID '{}'. Entspricht nicht dem GEDCOM-Format.", trimmed));
        }
        let normalized = normalize_gedcom_xref(&trimmed);
        let existing: Option<(Option<String>, Option<String>)> = conn
            .query_row(
                "SELECT given_name, surname FROM individuals WHERE id = ?1",
                [&normalized],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .ok();
        if let Some((g, s)) = existing {
            let name = format_person_name(g.as_deref(), s.as_deref());
            return Err(format!("Die ID '{}' wird bereits von '{}' verwendet.", normalized, name));
        }
        normalized
    } else {
        crate::db::get_next_individual_id(&conn)?
    };

    let tx = conn.transaction().map_err(|e| e.to_string())?;

    let name_val = format!("{} /{}//", given_name, surname);
    let json_val = serde_json::json!({
        "NAME": name_val, "GIVN": given_name, "SURN": surname, "SEX": sex
    });

    tx.execute(
        "INSERT INTO individuals (id, xref_id, given_name, surname, sex, birth_date, birth_place, death_date, death_place, json_data) VALUES (?1, ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
        rusqlite::params![new_id, given_name, surname, sex, birth_date, birth_place, death_date, death_place, json_val.to_string()],
    ).map_err(|e| e.to_string())?;

    if let (Some(target_id), Some(rel)) = (target_person_id, relation_type) {
        if rel == "child" {
            let mut fam_stmt = tx.prepare("SELECT id FROM families WHERE husband_id = ?1 OR wife_id = ?1").map_err(|e| e.to_string())?;
            let fam_id: Option<String> = fam_stmt.query_row([&target_id], |row| row.get(0)).ok();
            let target_fam_id = if let Some(fid) = fam_id { fid } else {
                let fid = format!("F{}", uuid::Uuid::new_v4().simple());
                let is_male = tx.query_row("SELECT sex FROM individuals WHERE id = ?1", [&target_id], |row| row.get::<_, String>(0)).unwrap_or_default() == "M";
                let (h, w) = if is_male { (Some(target_id.clone()), None) } else { (None, Some(target_id.clone())) };
                tx.execute("INSERT INTO families (id, xref_id, husband_id, wife_id, is_divorced, json_data) VALUES (?1, ?1, ?2, ?3, 0, ?4)", rusqlite::params![fid, h, w, "{}"]).map_err(|e| e.to_string())?;
                fid
            };
            tx.execute("INSERT INTO parent_child (family_id, child_id) VALUES (?1, ?2)", rusqlite::params![target_fam_id, new_id]).map_err(|e| e.to_string())?;
        } else if rel == "parent" {
            let fam_id = format!("F{}", uuid::Uuid::new_v4().simple());
            let is_male = sex == "M";
            let (h, w) = if is_male { (Some(new_id.clone()), None) } else { (None, Some(new_id.clone())) };
            tx.execute("INSERT INTO families (id, xref_id, husband_id, wife_id, is_divorced, json_data) VALUES (?1, ?1, ?2, ?3, 0, ?4)", rusqlite::params![fam_id, h, w, "{}"]).map_err(|e| e.to_string())?;
            tx.execute("INSERT INTO parent_child (family_id, child_id) VALUES (?1, ?2)", rusqlite::params![fam_id, target_id]).map_err(|e| e.to_string())?;
        } else if rel == "spouse" {
            let fam_id = format!("F{}", uuid::Uuid::new_v4().simple());
            let is_male = tx.query_row("SELECT sex FROM individuals WHERE id = ?1", [&target_id], |row| row.get::<_, String>(0)).unwrap_or_default() == "M";
            let (h, w) = if is_male { (Some(target_id.clone()), Some(new_id.clone())) } else { (Some(new_id.clone()), Some(target_id.clone())) };
            tx.execute("INSERT INTO families (id, xref_id, husband_id, wife_id, is_divorced, json_data) VALUES (?1, ?1, ?2, ?3, 0, ?4)", rusqlite::params![fam_id, h, w, "{}"]).map_err(|e| e.to_string())?;
        }
    }

    tx.commit().map_err(|e| e.to_string())?;
    let _ = calculate_henry_codes_internal(&mut conn);
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
        ).map_err(|e| e.to_string())?;
    } else {
        conn.execute(
            "UPDATE individuals SET id = ?1 WHERE id = ?2",
            rusqlite::params![to_id, from_id],
        ).map_err(|e| e.to_string())?;
    }

    conn.execute(
        "UPDATE families SET husband_id = ?1 WHERE husband_id = ?2",
        rusqlite::params![to_id, from_id],
    ).map_err(|e| e.to_string())?;

    conn.execute(
        "UPDATE families SET wife_id = ?1 WHERE wife_id = ?2",
        rusqlite::params![to_id, from_id],
    ).map_err(|e| e.to_string())?;

    conn.execute(
        "UPDATE parent_child SET child_id = ?1 WHERE child_id = ?2",
        rusqlite::params![to_id, from_id],
    ).map_err(|e| e.to_string())?;

    conn.execute(
        "UPDATE events SET owner_id = ?1 WHERE owner_id = ?2 AND owner_type = 'INDI'",
        rusqlite::params![to_id, from_id],
    ).map_err(|e| e.to_string())?;

    conn.execute(
        "UPDATE root_ancestors SET person_id = ?1 WHERE person_id = ?2",
        rusqlite::params![to_id, from_id],
    ).map_err(|e| e.to_string())?;

    conn.execute(
        "UPDATE proband_henry_codes SET person_id = ?1 WHERE person_id = ?2",
        rusqlite::params![to_id, from_id],
    ).map_err(|e| e.to_string())?;

    conn.execute(
        "UPDATE proband_henry_codes SET proband_id = ?1 WHERE proband_id = ?2",
        rusqlite::params![to_id, from_id],
    ).map_err(|e| e.to_string())?;

    conn.execute(
        "UPDATE design_layouts SET proband_id = ?1 WHERE proband_id = ?2",
        rusqlite::params![to_id, from_id],
    ).map_err(|e| e.to_string())?;

    Ok(())
}

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
        let name = format_person_name(u.person.given_name.as_deref(), u.person.surname.as_deref());
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
    let mut target_id_map: HashMap<String, String> = HashMap::new();
    for u in &updates {
        let new_id = u.person.id.clone();
        let name = format_person_name(u.person.given_name.as_deref(), u.person.surname.as_deref());
        if let Some(first_name) = target_id_map.get(&new_id) {
            return Err(format!(
                "Die ID '{}' wird mehrfach vergeben (an '{}' und '{}').",
                new_id, first_name, name
            ));
        }
        target_id_map.insert(new_id, name);
    }

    // 3. Gesamtheitliche Konsistenz: Kollision gegen bestehende, unberührte Personen in DB prüfen
    let batch_orig_ids: std::collections::HashSet<String> = updates.iter().map(|u| u.original_id.clone()).collect();
    for u in &updates {
        let new_id = &u.person.id;
        if new_id != &u.original_id {
            // Wenn die Ziel-ID Teil der geänderten Gruppe ist, wird dieser Platz von einer anderen Person geräumt (z.B. Tausch/Zyklus)
            if !batch_orig_ids.contains(new_id) {
                let existing: Option<(Option<String>, Option<String>)> = conn
                    .query_row(
                        "SELECT given_name, surname FROM individuals WHERE id = ?1",
                        [new_id],
                        |r| Ok((r.get(0)?, r.get(1)?)),
                    )
                    .ok();
                if let Some((g, s)) = existing {
                    let name = format_person_name(g.as_deref(), s.as_deref());
                    return Err(format!("Die ID '{}' wird bereits von '{}' verwendet.", new_id, name));
                }
            }
        }
    }

    // 4. Durchführung der Änderungen mit 2-Phasen Rename (unter Deaktivierung der Fremdschlüssel-Prüfung)
    conn.execute_batch("PRAGMA foreign_keys = OFF;").map_err(|e| e.to_string())?;

    let res = (|| -> Result<(), String> {
        let tx = conn.transaction().map_err(|e| e.to_string())?;

        // Phase 1: Vorübergehend auf eindeutige Temp-IDs umbenennen (verhindert Primary-Key-Konflikte bei Zyklen & Tausch)
        let mut temp_renames: Vec<(&PersonUpdate, String)> = Vec::new();
        for u in &updates {
            let new_id = &u.person.id;
            if new_id != &u.original_id {
                let temp_id = format!("__TMP_ID_{}__", uuid::Uuid::new_v4().simple());
                rename_person_references(&tx, &u.original_id, &temp_id, false)?;
                temp_renames.push((u, temp_id));
            }
        }

        // Phase 2: Von Temp-IDs auf endgültige neue IDs umbenennen
        for (u, temp_id) in &temp_renames {
            let new_id = &u.person.id;
            rename_person_references(&tx, temp_id, new_id, true)?;
        }

        // Phase 3: Alle Datensatz-Felder der Personen aktualisieren
        for u in &updates {
            let target_id = &u.person.id;
            let json_str = serde_json::to_string(&u.person.gedcom_extra).unwrap_or_else(|_| "{}".to_string());
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
                    target_id
                ],
            ).map_err(|e| e.to_string())?;
        }

        // Phase 4: Layout-Referenzen in design_layouts JSON-Daten aktualisieren
        for u in &updates {
            let new_id = &u.person.id;
            if new_id != &u.original_id {
                let old_pat = format!("\"{}\"", u.original_id);
                let new_pat = format!("\"{}\"", new_id);
                let mut stmt = tx.prepare("SELECT id, layout_data FROM design_layouts").map_err(|e| e.to_string())?;
                let rows: Vec<(String, String)> = stmt
                    .query_map([], |r| Ok((r.get(0)?, r.get(1)?)))
                    .map_err(|e| e.to_string())?
                    .filter_map(Result::ok)
                    .collect();

                for (dl_id, ldata) in rows {
                    if ldata.contains(&old_pat) {
                        let updated = ldata.replace(&old_pat, &new_pat);
                        tx.execute("UPDATE design_layouts SET layout_data = ?1 WHERE id = ?2", [&updated, &dl_id])
                            .map_err(|e| e.to_string())?;
                    }
                }
            }
        }

        tx.commit().map_err(|e| e.to_string())?;
        Ok(())
    })();

    let _ = conn.execute_batch("PRAGMA foreign_keys = ON;");
    res?;

    // Henry-Codes neu berechnen
    let _ = calculate_henry_codes_internal(conn);
    Ok(())
}

#[tauri::command]
fn update_persons_batch(state: State<AppState>, updates: Vec<PersonUpdate>) -> Result<(), String> {
    let mut conn = state.db.lock().map_err(|e| e.to_string())?;
    update_persons_batch_internal(&mut conn, updates)
}

#[tauri::command]
fn update_person(state: State<AppState>, person: Person, original_id: Option<String>) -> Result<(), String> {
    let orig_id = original_id.unwrap_or_else(|| person.id.clone());
    let mut conn = state.db.lock().map_err(|e| e.to_string())?;
    update_persons_batch_internal(&mut conn, vec![PersonUpdate { original_id: orig_id, person }])
}

#[tauri::command]
fn import_gedcom_file(state: State<AppState>, file_path: String) -> Result<usize, String> {
    let mut conn = state.db.lock().map_err(|e| e.to_string())?;
    let mut active = state.active_tree.lock().map_err(|e| e.to_string())?;
    let path = std::path::Path::new(&file_path);

    if active.is_empty() {
        let tree_name = path
            .file_stem()
            .and_then(|s| s.to_str())
            .map(|s| s.trim().to_string())
            .filter(|s| !s.is_empty() && !s.contains('/') && !s.contains('\\') && !s.contains(".."))
            .unwrap_or_else(|| "stammbaum".to_string());
        let db_path = state.app_dir.join(format!("{}.db", tree_name));
        *conn = db::init_database(&db_path).map_err(|e| e.to_string())?;
        *active = tree_name;
    }

    let count = parser::import_gedcom(&mut conn, path)?;
    // Henry-Codes für eventuell bestehende Probanden berechnen
    let _ = calculate_henry_codes_internal(&mut conn);
    Ok(count)
}

#[tauri::command]
fn find_relationship_path(state: State<AppState>, start_id: String, target_id: String) -> Result<Vec<String>, String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    let mut stmt = conn.prepare("SELECT family_id, child_id FROM parent_child").map_err(|e| e.to_string())?;
    let mut graph = DiGraph::<String, ()>::new();
    let mut nodes: HashMap<String, NodeIndex> = HashMap::new();
    let edges = stmt.query_map([], |row| Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))).map_err(|e| e.to_string())?;

    for edge in edges {
        let (f_id, c_id) = edge.map_err(|e| e.to_string())?;
        let f_idx = *nodes.entry(f_id.clone()).or_insert_with(|| graph.add_node(f_id));
        let c_idx = *nodes.entry(c_id.clone()).or_insert_with(|| graph.add_node(c_id));
        graph.add_edge(f_idx, c_idx, ());
        graph.add_edge(c_idx, f_idx, ());
    }

    let (&start_idx, &target_idx) = match (nodes.get(&start_id), nodes.get(&target_id)) { (Some(s), Some(t)) => (s, t), _ => return Err("Person nicht gefunden.".into()) };
    if let Some((_, path)) = astar(&graph, start_idx, |finish| finish == target_idx, |_| 1, |_| 0) { Ok(path.into_iter().map(|idx| graph[idx].clone()).collect()) } else { Ok(vec![]) }
}

#[tauri::command]
fn export_latex_pdf(state: State<AppState>, output_dir: String) -> Result<String, String> {
    let persons = get_all_persons(state)?;
    let mut tera = Tera::default();
    tera.add_raw_template("chronik.tex", r#"\documentclass[a4paper,11pt]{scrbook}\usepackage[utf8]{inputenc}\begin{document}\chapter{Familienverzeichnis}{% for p in persons %}\textbf{ {{ p.surname }}, {{ p.given_name | default(value="N.N.") }} }\\{% endfor %}\end{document}"#).map_err(|e| e.to_string())?;
    let mut context = Context::new(); context.insert("persons", &persons);
    let rendered_tex = tera.render("chronik.tex", &context).map_err(|e| e.to_string())?;
    let tex_path = PathBuf::from(&output_dir).join("chronik.tex");
    fs::write(&tex_path, rendered_tex).map_err(|e| e.to_string())?;
    let mut cmd = Command::new("pdflatex");
    cmd.arg("-interaction=nonstopmode").arg("-output-directory").arg(&output_dir).arg(&tex_path);
    #[cfg(target_os = "windows")] cmd.creation_flags(0x08000000);
    let output = cmd.output().map_err(|e| format!("Fehler beim Start von pdflatex: {}", e))?;
    if output.status.success() { Ok(format!("{}/chronik.pdf", output_dir)) } else { Err(format!("LaTeX-Fehler:\n{}", String::from_utf8_lossy(&output.stdout))) }
}

#[tauri::command]
fn save_design_layout(
    state: State<'_, AppState>,
    proband_id: String,
    name: String,
    created_at: String,
    layout_data: String,
    overwrite_id: Option<String>,
) -> Result<DesignLayoutEntry, String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;

    if let Some(ref oid) = overwrite_id {
        if !oid.is_empty() {
            conn.execute(
                "UPDATE design_layouts SET name = ?1, created_at = ?2, layout_data = ?3 WHERE id = ?4",
                [&name, &created_at, &layout_data, oid],
            ).map_err(|e| e.to_string())?;
            return Ok(DesignLayoutEntry {
                id: oid.clone(),
                proband_id,
                name,
                created_at,
                layout_data,
            });
        }
    }

    let existing_id: Option<String> = conn.query_row(
        "SELECT id FROM design_layouts WHERE proband_id = ?1 AND name = ?2 LIMIT 1",
        [&proband_id, &name],
        |r| r.get(0),
    ).ok();

    if let Some(eid) = existing_id {
        conn.execute(
            "UPDATE design_layouts SET created_at = ?1, layout_data = ?2 WHERE id = ?3",
            [&created_at, &layout_data, &eid],
        ).map_err(|e| e.to_string())?;
        return Ok(DesignLayoutEntry {
            id: eid,
            proband_id,
            name,
            created_at,
            layout_data,
        });
    }

    let id = uuid::Uuid::new_v4().to_string();
    conn.execute(
        "INSERT INTO design_layouts (id, proband_id, name, created_at, layout_data) VALUES (?1, ?2, ?3, ?4, ?5)",
        [&id, &proband_id, &name, &created_at, &layout_data],
    ).map_err(|e| e.to_string())?;
    Ok(DesignLayoutEntry {
        id,
        proband_id,
        name,
        created_at,
        layout_data,
    })
}

#[tauri::command]
fn get_design_layouts(
    state: State<'_, AppState>,
    proband_id: Option<String>,
) -> Result<Vec<DesignLayoutEntry>, String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    let mut list = Vec::new();
    if let Some(pid) = proband_id {
        if !pid.is_empty() {
            let mut stmt = conn.prepare(
                "SELECT id, proband_id, name, created_at, layout_data FROM design_layouts WHERE proband_id = ?1 ORDER BY created_at DESC"
            ).map_err(|e| e.to_string())?;
            let rows = stmt.query_map([&pid], |r| {
                Ok(DesignLayoutEntry {
                    id: r.get(0)?,
                    proband_id: r.get(1)?,
                    name: r.get(2)?,
                    created_at: r.get(3)?,
                    layout_data: r.get(4)?,
                })
            }).map_err(|e| e.to_string())?;
            for row in rows.flatten() {
                list.push(row);
            }
            return Ok(list);
        }
    }
    let mut stmt = conn.prepare(
        "SELECT id, proband_id, name, created_at, layout_data FROM design_layouts ORDER BY created_at DESC"
    ).map_err(|e| e.to_string())?;
    let rows = stmt.query_map([], |r| {
        Ok(DesignLayoutEntry {
            id: r.get(0)?,
            proband_id: r.get(1)?,
            name: r.get(2)?,
            created_at: r.get(3)?,
            layout_data: r.get(4)?,
        })
    }).map_err(|e| e.to_string())?;
    for row in rows.flatten() {
        list.push(row);
    }
    Ok(list)
}

#[tauri::command]
fn delete_design_layout(
    state: State<'_, AppState>,
    id: String,
) -> Result<(), String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    conn.execute("DELETE FROM design_layouts WHERE id = ?1", [&id])
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
fn save_design_file(file_path: String, content: String) -> Result<(), String> {
    fs::write(&file_path, content).map_err(|e| e.to_string())
}

#[tauri::command]
fn read_design_file(file_path: String) -> Result<String, String> {
    fs::read_to_string(&file_path).map_err(|e| e.to_string())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .setup(|app| {
            let app_dir = app.path().app_data_dir().expect("Kein App-Verzeichnis");
            std::fs::create_dir_all(&app_dir).unwrap();

            let mut existing_trees = Vec::new();
            if let Ok(entries) = fs::read_dir(&app_dir) {
                for entry in entries.flatten() {
                    let path = entry.path();
                    if path.extension().and_then(|s| s.to_str()) == Some("db") {
                        if let Some(stem) = path.file_stem().and_then(|s| s.to_str()) {
                            existing_trees.push(stem.to_string());
                        }
                    }
                }
            }
            existing_trees.sort();
            existing_trees.dedup();

            let (conn, initial_tree) = if let Some(first) = existing_trees.first() {
                let c = crate::db::init_database(&app_dir.join(format!("{}.db", first))).expect("DB Init Fehler");
                (c, first.clone())
            } else {
                let c = crate::db::init_in_memory_database().expect("In-Memory DB Init Fehler");
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
        .invoke_handler(tauri::generate_handler![
            get_trees, switch_tree, delete_tree, get_all_persons, get_person_details, find_relationship_path, export_latex_pdf,
            import_gedcom_file, update_person, update_persons_batch, get_next_person_id, update_person_parents, add_person, get_root_ancestors, add_root_ancestor,
            remove_root_ancestor, calculate_henry_codes_from_roots,
            save_design_layout, get_design_layouts, delete_design_layout, save_design_file, read_design_file
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
        let temp_dir = std::env::temp_dir().join(format!("test_stammbaum_{}", std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_nanos()));
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
        let remaining = delete_tree_internal(&temp_dir, &mut conn, &mut active, "baum_a").unwrap();

        // 3. Prüfen: baum_a.db existiert nicht mehr
        assert!(!db1_path.exists(), "baum_a.db muss physisch gelöscht sein!");
        assert!(!temp_dir.join("baum_a.db-wal").exists());
        assert!(!temp_dir.join("baum_a.db-shm").exists());

        // 4. Prüfen: baum_b.db existiert weiterhin unberührt
        assert!(db2_path.exists(), "baum_b.db darf nicht gelöscht worden sein!");
        assert_eq!(active, "baum_b");
        assert_eq!(remaining, vec!["baum_b".to_string()]);

        // 5. In conn darf jetzt nur noch Erika aus baum_b existieren
        let count_b: i64 = conn.query_row("SELECT count(*) FROM individuals WHERE id = 'I2'", [], |r| r.get(0)).unwrap();
        assert_eq!(count_b, 1);
        let count_a: i64 = conn.query_row("SELECT count(*) FROM individuals WHERE id = 'I1'", [], |r| r.get(0)).unwrap();
        assert_eq!(count_a, 0);

        // 6. Nun auch baum_b löschen (letzter Baum)
        let remaining2 = delete_tree_internal(&temp_dir, &mut conn, &mut active, "baum_b").unwrap();
        assert!(!db2_path.exists(), "baum_b.db muss physisch gelöscht sein!");
        assert!(!temp_dir.join("stammbaum.db").exists(), "Es darf kein neuer leerer Stammbaum auf Disk angelegt werden!");
        assert_eq!(active, "");
        assert!(remaining2.is_empty(), "Nach Löschen des letzten Baums muss die Liste der Bäume leer sein!");

        // In-Memory-DB muss 0 Personen haben
        let count_fresh: i64 = conn.query_row("SELECT count(*) FROM individuals", [], |r| r.get(0)).unwrap();
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
        conn.execute("INSERT INTO parent_child (family_id, child_id) VALUES ('F1', 'I2')", []).unwrap();
        conn.execute("INSERT INTO parent_child (family_id, child_id) VALUES ('F1', 'I3')", []).unwrap();

        conn.execute("INSERT INTO families (id, xref_id, husband_id, wife_id, is_divorced, json_data) VALUES ('F2', 'F2', 'I_EXT', 'I3', 0, '{}')", []).unwrap();
        conn.execute("INSERT INTO parent_child (family_id, child_id) VALUES ('F2', 'I4')", []).unwrap();

        conn.execute("INSERT INTO families (id, xref_id, husband_id, wife_id, is_divorced, json_data) VALUES ('F3', 'F3', 'I2', NULL, 0, '{}')", []).unwrap();
        conn.execute("INSERT INTO parent_child (family_id, child_id) VALUES ('F3', 'I5')", []).unwrap();

        conn.execute("INSERT INTO families (id, xref_id, husband_id, wife_id, is_divorced, json_data) VALUES ('F4', 'F4', 'I5', 'I4', 0, '{}')", []).unwrap();
        conn.execute("INSERT INTO parent_child (family_id, child_id) VALUES ('F4', 'I6')", []).unwrap();

        conn.execute("INSERT INTO root_ancestors (person_id, starting_code) VALUES ('I1', '1')", []).unwrap();
        calculate_henry_codes_internal(&mut conn).unwrap();

        let get_code = |pid: &str| -> Option<String> {
            conn.query_row(
                "SELECT henry_code FROM proband_henry_codes WHERE proband_id = 'I1' AND person_id = ?1",
                [pid],
                |r| r.get(0),
            ).ok()
        };

        assert_eq!(get_code("I1"), Some("1".to_string()));
        assert_eq!(get_code("I2"), Some("11".to_string()));
        assert_eq!(get_code("I3"), Some("12".to_string()));
        assert_eq!(get_code("I_EXT"), None);
        assert_eq!(get_code("I4"), Some("121".to_string()), "Kind muss unter der Mutter weitergeführt werden, da Vater nicht im Stammbaum ist");
        assert_eq!(get_code("I5"), Some("111".to_string()));
        assert_eq!(get_code("I6"), Some("1111".to_string()), "Wenn beide Eltern im Stammbaum sind, muss die Linie patrilinear unter dem Vater weitergeführt werden");
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
        assert_eq!(crate::db::get_next_individual_id(&conn).unwrap(), "I191142");
    }

    #[test]
    fn test_update_persons_batch_and_traceability() {
        let mut conn = db::init_in_memory_database().unwrap();

        // 1. Zwei Personen und eine Familie anlegen
        conn.execute("INSERT INTO individuals (id, xref_id, given_name, surname, sex, json_data) VALUES ('I1', 'I1', 'Vater', 'Ahne', 'M', '{}')", []).unwrap();
        conn.execute("INSERT INTO individuals (id, xref_id, given_name, surname, sex, json_data) VALUES ('I2', 'I2', 'Kind', 'Ahne', 'M', '{}')", []).unwrap();
        conn.execute("INSERT INTO families (id, xref_id, husband_id, wife_id, is_divorced, json_data) VALUES ('F1', 'F1', 'I1', NULL, 0, '{}')", []).unwrap();
        conn.execute("INSERT INTO parent_child (family_id, child_id) VALUES ('F1', 'I2')", []).unwrap();
        conn.execute("INSERT INTO root_ancestors (person_id, starting_code) VALUES ('I1', '1')", []).unwrap();
        calculate_henry_codes_internal(&mut conn).unwrap();

        // 2. Prüfung auf leere ID (Pflichtfeld)
        let empty_id_update = vec![PersonUpdate {
            original_id: "I1".to_string(),
            person: Person {
                id: "   ".to_string(),
                given_name: Some("Vater".to_string()),
                surname: Some("Ahne".to_string()),
                sex: Some("M".to_string()),
                birth_date: None,
                birth_place: None,
                death_date: None,
                death_place: None,
                proband_data: HashMap::new(),
                gedcom_extra: serde_json::json!({}),
                spouses: vec![],
                parent_ids: vec![],
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
                birth_date: None,
                birth_place: None,
                death_date: None,
                death_place: None,
                proband_data: HashMap::new(),
                gedcom_extra: serde_json::json!({}),
                spouses: vec![],
                parent_ids: vec![],
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
                birth_date: None,
                birth_place: None,
                death_date: None,
                death_place: None,
                proband_data: HashMap::new(),
                gedcom_extra: serde_json::json!({}),
                spouses: vec![],
                parent_ids: vec![],
            },
        }];
        update_persons_batch_internal(&mut conn, rename_update).unwrap();

        // Überprüfen: individuals hat jetzt I100 und nicht mehr I1
        let count_i1: i64 = conn.query_row("SELECT count(*) FROM individuals WHERE id = 'I1'", [], |r| r.get(0)).unwrap();
        assert_eq!(count_i1, 0);
        let count_i100: i64 = conn.query_row("SELECT count(*) FROM individuals WHERE id = 'I100'", [], |r| r.get(0)).unwrap();
        assert_eq!(count_i100, 1);

        // Überprüfen: families.husband_id wurde auf I100 aktualisiert
        let husband: String = conn.query_row("SELECT husband_id FROM families WHERE id = 'F1'", [], |r| r.get(0)).unwrap();
        assert_eq!(husband, "I100");

        // Überprüfen: root_ancestors wurde auf I100 aktualisiert
        let root_p: String = conn.query_row("SELECT person_id FROM root_ancestors", [], |r| r.get(0)).unwrap();
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
                    birth_date: None,
                    birth_place: None,
                    death_date: None,
                    death_place: None,
                    proband_data: HashMap::new(),
                    gedcom_extra: serde_json::json!({}),
                    spouses: vec![],
                    parent_ids: vec![],
                },
            },
            PersonUpdate {
                original_id: "I2".to_string(),
                person: Person {
                    id: "I100".to_string(),
                    given_name: Some("Kind".to_string()),
                    surname: Some("Ahne".to_string()),
                    sex: Some("M".to_string()),
                    birth_date: None,
                    birth_place: None,
                    death_date: None,
                    death_place: None,
                    proband_data: HashMap::new(),
                    gedcom_extra: serde_json::json!({}),
                    spouses: vec![],
                    parent_ids: vec![],
                },
            },
        ];
        update_persons_batch_internal(&mut conn, swap_updates).unwrap();

        // Vater hat jetzt I2
        let vater_id: String = conn.query_row("SELECT id FROM individuals WHERE given_name = 'VaterNeu'", [], |r| r.get(0)).unwrap();
        assert_eq!(vater_id, "I2");
        // Kind hat jetzt I100
        let kind_id: String = conn.query_row("SELECT id FROM individuals WHERE given_name = 'Kind'", [], |r| r.get(0)).unwrap();
        assert_eq!(kind_id, "I100");
        // Familie husband ist jetzt I2, child_id ist jetzt I100
        let h: String = conn.query_row("SELECT husband_id FROM families WHERE id = 'F1'", [], |r| r.get(0)).unwrap();
        assert_eq!(h, "I2");
        let c: String = conn.query_row("SELECT child_id FROM parent_child WHERE family_id = 'F1'", [], |r| r.get(0)).unwrap();
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
        let invalid_update = vec![
            PersonUpdate {
                original_id: "I1".to_string(),
                person: Person {
                    id: "Ungültige ID mit Leerzeichen!".to_string(),
                    given_name: Some("Test".to_string()),
                    surname: Some("Person".to_string()),
                    sex: Some("M".to_string()),
                    birth_date: None,
                    birth_place: None,
                    death_date: None,
                    death_place: None,
                    proband_data: HashMap::new(),
                    gedcom_extra: serde_json::json!({}),
                    spouses: vec![],
                    parent_ids: vec![],
                },
            },
        ];
        let res = update_persons_batch_internal(&mut conn, invalid_update);
        assert!(res.is_err());
        assert!(res.unwrap_err().contains("Ungültige XREF-ID"));
    }
}