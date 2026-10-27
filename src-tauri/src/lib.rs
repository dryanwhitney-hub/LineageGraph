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

    // Hilfsfunktion: Isoliert das Jahr (4 Ziffern) aus einem GEDCOM Datumsstring
    fn extract_year(date: &str) -> i32 {
        let bytes = date.as_bytes();
        for i in 0..bytes.len().saturating_sub(3) {
            if bytes[i].is_ascii_digit() && bytes[i+1].is_ascii_digit() && bytes[i+2].is_ascii_digit() && bytes[i+3].is_ascii_digit() {
                if let Ok(y) = std::str::from_utf8(&bytes[i..i+4]).unwrap().parse::<i32>() {
                    return y;
                }
            }
        }
        9999 // Fallback: Unbekannte an den Schluss
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
                // Korrigierte patrilineare Vererbungslogik:
                // Prüft immer, ob curr_id tatsächlich Vater (oder bei Stammahnin/Single Mutter) DIESER Familie ist!
                let is_father = husband.as_ref() == Some(&curr_id);
                let is_mother_at_root = wife.as_ref() == Some(&curr_id) && curr_id == proband_id;
                let is_mother_single = wife.as_ref() == Some(&curr_id) && husband.is_none();

                if is_father || is_mother_at_root || is_mother_single {
                    for c in children { 
                        // Verhindert Zyklen, Rekursion und doppelte Aufnahme
                        if !visited.contains(c) && !all_children.contains(c) && c != &curr_id {
                            all_children.push(c.clone()); 
                        } 
                    }
                }
            }
            
            // Kinder nach Geburtsjahr sortieren
            all_children.sort_by(|a, b| {
                let ya = extract_year(birth_dates.get(a).unwrap_or(&String::new()));
                let yb = extract_year(birth_dates.get(b).unwrap_or(&String::new()));
                ya.cmp(&yb)
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
    death_place: Option<String>
) -> Result<String, String> {
    let mut conn = state.db.lock().map_err(|e| e.to_string())?;
    let new_id = format!("I{}", uuid::Uuid::new_v4().simple());
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

#[tauri::command]
fn update_person(state: State<AppState>, person: Person) -> Result<(), String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    conn.execute("UPDATE individuals SET given_name = ?1, surname = ?2, sex = ?3 WHERE id = ?4", rusqlite::params![person.given_name, person.surname, person.sex, person.id]).map_err(|e| e.to_string())?;
    Ok(())
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
            import_gedcom_file, update_person, update_person_parents, add_person, get_root_ancestors, add_root_ancestor,
            remove_root_ancestor, calculate_henry_codes_from_roots
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
}