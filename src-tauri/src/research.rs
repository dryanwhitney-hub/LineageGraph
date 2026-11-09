use rusqlite::Connection;
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet, VecDeque};
use chrono::Datelike;
use crate::Person;

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ExternalArchiveLinks {
    pub matricula_url: Option<String>,
    pub archion_url: Option<String>,
    pub familysearch_url: Option<String>,
    pub meyers_url: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ResearchTaskDto {
    pub id: String,
    pub person_id: String,
    pub person_name: String,
    pub person_birth_date: Option<String>,
    pub person_birth_place: Option<String>,
    pub person_death_date: Option<String>,
    pub person_death_place: Option<String>,
    pub person_sex: Option<String>,
    pub proband_code: Option<String>,
    pub generation: Option<i32>,
    pub gap_type: String, // "MISSING_PARENTS" | "MISSING_DEATH" | "MISSING_PLACE" | "CHILD_GAP"
    pub title: String,
    pub description: String,
    pub advice: String,
    pub archive_hint: Option<String>,
    pub links: ExternalArchiveLinks,
    pub priority_score: i32,
    pub priority_label: String, // "urgent" | "high" | "medium" | "low"
    pub status: String, // "open" | "in_progress" | "completed" | "ignored"
    pub notes: Option<String>,
    pub context_json: String,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ResearchStatsDto {
    pub total_gaps: usize,
    pub open_count: usize,
    pub in_progress_count: usize,
    pub completed_count: usize,
    pub ignored_count: usize,
    pub missing_parents_count: usize,
    pub missing_death_count: usize,
    pub missing_place_count: usize,
    pub child_gap_count: usize,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct BranchPersonSummary {
    pub id: String,
    pub name: String,
    pub birth_date: Option<String>,
    pub death_date: Option<String>,
    pub birth_place: Option<String>,
    pub death_place: Option<String>,
    pub sex: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct SuggestedConnection {
    pub isolated_person_id: String,
    pub isolated_person_name: String,
    pub main_person_id: String,
    pub main_person_name: String,
    pub match_reason: String,
    pub confidence_score: u32,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct IsolatedBranchDto {
    pub id: usize,
    pub name: String,
    pub person_count: usize,
    pub generation_depth: usize,
    pub root_ancestors: Vec<BranchPersonSummary>,
    pub persons: Vec<BranchPersonSummary>,
    pub earliest_year: Option<i32>,
    pub latest_year: Option<i32>,
    pub top_places: Vec<String>,
    pub top_surnames: Vec<String>,
    pub suggested_connections: Vec<SuggestedConnection>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct IsolatedBranchesResultDto {
    pub total_persons: usize,
    pub total_components: usize,
    pub main_tree_person_count: usize,
    pub isolated_branches_count: usize,
    pub isolated_individuals_count: usize,
    pub branches: Vec<IsolatedBranchDto>,
}

#[derive(Debug, Serialize, Deserialize, Clone, Default)]
pub struct ResearchSettings {
    pub max_age_years: Option<i32>,
    pub child_gap_years: Option<f32>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ResearchScope {
    pub scope_type: String, // "all" | "proband_ancestors" | "proband_descendants" | "single_person"
    pub proband_id: Option<String>,
    pub person_id: Option<String>,
}

#[derive(Debug, Clone)]
struct PersistedTask {
    status: String,
    notes: Option<String>,
    created_at: String,
    updated_at: String,
    context_json: String,
    person_id: String,
    gap_type: String,
    priority_score: i32,
}

fn url_encode(input: &str) -> String {
    let mut encoded = String::new();
    for byte in input.bytes() {
        match byte {
            b'a'..=b'z' | b'A'..=b'Z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                encoded.push(byte as char);
            }
            b' ' => encoded.push('+'),
            _ => {
                encoded.push_str(&format!("%{:02X}", byte));
            }
        }
    }
    encoded
}

pub fn extract_year(date_str: &str) -> Option<i32> {
    let s = date_str.trim().to_uppercase();
    if s.is_empty() {
        return None;
    }
    for token in s.split(|c: char| !c.is_alphanumeric()) {
        if token.len() == 4 && token.chars().all(|c| c.is_ascii_digit()) {
            if let Ok(y) = token.parse::<i32>() {
                if (1000..=2200).contains(&y) {
                    return Some(y);
                }
            }
        }
    }
    None
}

pub fn parse_date_fractional_year(date_str: &str) -> Option<f64> {
    let s = date_str.trim().to_uppercase();
    if s.is_empty() {
        return None;
    }
    let parts_dash: Vec<&str> = s.split(|c| c == '-' || c == '/').collect();
    if parts_dash.len() >= 2 && parts_dash[0].len() == 4 {
        if let Ok(y) = parts_dash[0].parse::<f64>() {
            let m = parts_dash
                .get(1)
                .and_then(|v| v.parse::<f64>().ok())
                .unwrap_or(6.0);
            return Some(y + (m.clamp(1.0, 12.0) - 1.0) / 12.0);
        }
    }
    let parts_dot: Vec<&str> = s.split('.').collect();
    if parts_dot.len() == 3 {
        let y_str = parts_dot[2].split_whitespace().next().unwrap_or("");
        if let Ok(y) = y_str.parse::<f64>() {
            let m = parts_dot[1].trim().parse::<f64>().unwrap_or(6.0);
            return Some(y + (m.clamp(1.0, 12.0) - 1.0) / 12.0);
        }
    }
    if let Some(y) = extract_year(&s) {
        return Some(y as f64 + 0.5);
    }
    None
}

pub fn generate_archive_links(
    given_name: Option<&str>,
    surname: Option<&str>,
    year: Option<i32>,
    place: Option<&str>,
) -> ExternalArchiveLinks {
    let g = given_name.unwrap_or("").trim();
    let s = surname.unwrap_or("").trim();
    let p = place.unwrap_or("").trim();

    let fs_url = {
        let mut params = Vec::new();
        if !g.is_empty() {
            params.push(format!("q.givenName={}", url_encode(g)));
        }
        if !s.is_empty() {
            params.push(format!("q.surname={}", url_encode(s)));
        }
        if !p.is_empty() {
            params.push(format!("q.birthLikePlace={}", url_encode(p)));
        }
        if let Some(y) = year {
            params.push(format!("q.birthLikeDate.from={}", y.saturating_sub(2)));
            params.push(format!("q.birthLikeDate.to={}", y.saturating_add(2)));
        }
        if !params.is_empty() {
            Some(format!(
                "https://www.familysearch.org/search/record/results?{}",
                params.join("&")
            ))
        } else {
            None
        }
    };

    let matricula_url = if !p.is_empty() {
        Some(format!(
            "https://data.matricula-online.eu/de/suche/?place={}",
            url_encode(p)
        ))
    } else {
        None
    };

    let archion_url = if !p.is_empty() {
        Some(format!(
            "https://www.archion.de/de/suche/?q={}",
            url_encode(p)
        ))
    } else {
        None
    };

    let meyers_url = if !p.is_empty() {
        Some(format!(
            "https://www.meyersgaz.org/place/search?search={}",
            url_encode(p)
        ))
    } else {
        None
    };

    ExternalArchiveLinks {
        matricula_url,
        archion_url,
        familysearch_url: fs_url,
        meyers_url,
    }
}

pub fn calculate_priority_score(
    gap_type: &str,
    is_ancestor_line: bool,
    has_dates_or_places: bool,
    extra_boost: i32,
) -> (i32, String) {
    let mut score = match gap_type {
        "MISSING_PARENTS" => 70,
        "MISSING_DEATH" => 50,
        "MISSING_PLACE" => 40,
        "CHILD_GAP" => 55,
        _ => 50,
    };

    if is_ancestor_line {
        score += 20;
    }
    if has_dates_or_places {
        score += 10;
    }
    score += extra_boost;

    score = score.clamp(1, 100);

    let label = if score >= 85 {
        "urgent"
    } else if score >= 65 {
        "high"
    } else if score >= 45 {
        "medium"
    } else {
        "low"
    };

    (score, label.to_string())
}

fn load_persisted_tasks(conn: &Connection) -> Result<HashMap<String, PersistedTask>, String> {
    let mut stmt = conn
        .prepare("SELECT id, person_id, gap_type, context_json, status, priority_score, notes, created_at, updated_at FROM research_tasks")
        .map_err(|e| e.to_string())?;

    let rows = stmt
        .query_map([], |row| {
            Ok((
                row.get::<_, String>(0)?,
                PersistedTask {
                    person_id: row.get(1)?,
                    gap_type: row.get(2)?,
                    context_json: row.get(3)?,
                    status: row.get(4)?,
                    priority_score: row.get(5)?,
                    notes: row.get(6)?,
                    created_at: row.get(7)?,
                    updated_at: row.get(8)?,
                },
            ))
        })
        .map_err(|e| e.to_string())?;

    let mut map = HashMap::new();
    for r in rows {
        let (id, task) = r.map_err(|e| e.to_string())?;
        map.insert(id, task);
    }
    Ok(map)
}

pub fn analyze_gaps(
    conn: &Connection,
    all_persons: &[Person],
    scope: &ResearchScope,
    settings: &ResearchSettings,
) -> Result<Vec<ResearchTaskDto>, String> {
    let max_age = settings.max_age_years.unwrap_or(110);
    let child_gap_thresh = settings.child_gap_years.unwrap_or(3.5);
    let current_year = chrono::Local::now().year();

    let persisted = load_persisted_tasks(conn)?;

    let person_map: HashMap<String, &Person> = all_persons.iter().map(|p| (p.id.clone(), p)).collect();

    // Determine target person IDs based on Scope
    let target_person_ids: HashSet<String> = match scope.scope_type.as_str() {
        "single_person" => {
            let mut set = HashSet::new();
            if let Some(ref pid) = scope.person_id {
                set.insert(pid.clone());
            }
            set
        }
        "person_ancestors" => {
            let mut ancestors = HashSet::new();
            if let Some(ref pid) = scope.person_id {
                let mut queue = vec![pid.clone()];
                while let Some(curr_id) = queue.pop() {
                    if ancestors.insert(curr_id.clone()) {
                        if let Some(p) = person_map.get(&curr_id) {
                            if let Some(ref fid) = p.father_id {
                                queue.push(fid.clone());
                            }
                            if let Some(ref mid) = p.mother_id {
                                queue.push(mid.clone());
                            }
                        }
                    }
                }
            }
            ancestors
        }
        "person_descendants" => {
            let mut descendants = HashSet::new();
            if let Some(ref pid) = scope.person_id {
                let mut queue = vec![pid.clone()];
                while let Some(curr_id) = queue.pop() {
                    if descendants.insert(curr_id.clone()) {
                        if let Some(p) = person_map.get(&curr_id) {
                            for cid in &p.children_ids {
                                queue.push(cid.clone());
                            }
                        }
                    }
                }
            }
            descendants
        }
        "proband_ancestors" => {
            let mut ancestors = HashSet::new();
            if let Some(ref pid) = scope.proband_id {
                let mut queue = vec![pid.clone()];
                while let Some(curr_id) = queue.pop() {
                    if ancestors.insert(curr_id.clone()) {
                        if let Some(p) = person_map.get(&curr_id) {
                            if let Some(ref fid) = p.father_id {
                                queue.push(fid.clone());
                            }
                            if let Some(ref mid) = p.mother_id {
                                queue.push(mid.clone());
                            }
                        }
                    }
                }
            }
            ancestors
        }
        "proband_descendants" => {
            let mut descendants = HashSet::new();
            if let Some(ref pid) = scope.proband_id {
                let mut queue = vec![pid.clone()];
                while let Some(curr_id) = queue.pop() {
                    if descendants.insert(curr_id.clone()) {
                        if let Some(p) = person_map.get(&curr_id) {
                            for cid in &p.children_ids {
                                queue.push(cid.clone());
                            }
                        }
                    }
                }
            }
            descendants
        }
        _ => all_persons.iter().map(|p| p.id.clone()).collect(),
    };

    // Determine set of direct ancestors for priority boosting
    let proband_ancestors_set: HashSet<String> = {
        let boost_root_id = if scope.scope_type.starts_with("person_") || scope.scope_type == "single_person" {
            scope.person_id.as_ref().or(scope.proband_id.as_ref())
        } else {
            scope.proband_id.as_ref()
        };

        if let Some(pid) = boost_root_id {
            let mut set = HashSet::new();
            let mut queue = vec![pid.clone()];
            while let Some(curr_id) = queue.pop() {
                if set.insert(curr_id.clone()) {
                    if let Some(p) = person_map.get(&curr_id) {
                        if let Some(ref fid) = p.father_id {
                            queue.push(fid.clone());
                        }
                        if let Some(ref mid) = p.mother_id {
                            queue.push(mid.clone());
                        }
                    }
                }
            }
            set
        } else {
            HashSet::new()
        }
    };

    let now_iso = chrono::Local::now().to_rfc3339();
    let mut tasks = Vec::new();
    let mut detected_task_ids = HashSet::new();

    for p in all_persons {
        if !target_person_ids.contains(&p.id) {
            continue;
        }

        let is_direct_ancestor = proband_ancestors_set.contains(&p.id);
        let name_str = format!(
            "{} {}",
            p.given_name.as_deref().unwrap_or(""),
            p.surname.as_deref().unwrap_or("")
        )
        .trim()
        .to_string();
        let display_name = if name_str.is_empty() {
            p.id.clone()
        } else {
            name_str
        };

        let p_data = scope
            .proband_id
            .as_ref()
            .and_then(|pr_id| p.proband_data.get(pr_id))
            .or_else(|| p.proband_data.values().next());
        let proband_code = p_data.map(|d| d.henry_code.clone());
        let generation = p_data.map(|d| d.generation);

        let birth_year = p.birth_date.as_deref().and_then(extract_year);
        let death_year = p.death_date.as_deref().and_then(extract_year);
        let ref_year = birth_year.or(death_year);
        let ref_place = p.birth_place.as_deref().or(p.death_place.as_deref());

        let has_context = ref_year.is_some() || ref_place.is_some();

        // -------------------------------------------------------------
        // Heuristik 1: Fehlende Eltern (Ahnenlinien-Ende / Einzeleltern)
        // -------------------------------------------------------------
        if p.father_id.is_none() && p.mother_id.is_none() {
            let task_id = format!("task_{}_MISSING_PARENTS", p.id);
            detected_task_ids.insert(task_id.clone());

            let (score, label) = calculate_priority_score("MISSING_PARENTS", is_direct_ancestor, has_context, 0);
            let archive_hint = if let Some(by) = birth_year {
                if by >= 1874 {
                    Some("Geburtsjahr ab 1874 (Preußen) bzw. 1876 (Deutsches Reich): Ein amtliches Geburtsnebenregister beim zuständigen Standesamt enthält verbindliche Angaben zu den Eltern.".to_string())
                } else {
                    Some("Geburtsjahr vor Einführung der Standesämter: Durchsuche das Kirchenbuch (Taufregister) der Pfarrei am Geburtsort nach dem Taufeintrag mit Elternangaben.".to_string())
                }
            } else {
                Some("Ermittle zuerst das ungefähre Geburtsjahr oder den Heiratseintrag, um das passende Kirchenbuch bzw. Standesamt einzugrenzen.".to_string())
            };

            let advice = format!(
                "Prüfe die Heiratsurkunde von {} (oder die Heiratseinträge der Nachkommen), da dort in der Regel die Namen und der Herkunftsort der Eltern verzeichnet sind. Taufpaten der Kinder geben ebenfalls oft wertvolle Hinweise auf Großeltern.",
                display_name
            );

            let links = generate_archive_links(
                p.given_name.as_deref(),
                p.surname.as_deref(),
                birth_year,
                ref_place,
            );

            let (status, notes, c_at, u_at) = persisted
                .get(&task_id)
                .map(|pt| (pt.status.clone(), pt.notes.clone(), pt.created_at.clone(), pt.updated_at.clone()))
                .unwrap_or_else(|| ("open".to_string(), None, now_iso.clone(), now_iso.clone()));

            tasks.push(ResearchTaskDto {
                id: task_id,
                person_id: p.id.clone(),
                person_name: display_name.clone(),
                person_birth_date: p.birth_date.clone(),
                person_birth_place: p.birth_place.clone(),
                person_death_date: p.death_date.clone(),
                person_death_place: p.death_place.clone(),
                person_sex: p.sex.clone(),
                proband_code: proband_code.clone(),
                generation,
                gap_type: "MISSING_PARENTS".to_string(),
                title: format!("Fehlende Elternlinie: {}", display_name),
                description: format!("Für {} sind weder Vater noch Mutter im Stammbaum erfasst.", display_name),
                advice,
                archive_hint,
                links,
                priority_score: score,
                priority_label: label,
                status,
                notes,
                context_json: serde_json::json!({ "type": "both_parents_missing" }).to_string(),
                created_at: c_at,
                updated_at: u_at,
            });
        } else if p.father_id.is_none() || p.mother_id.is_none() {
            let missing_side = if p.father_id.is_none() { "Vater" } else { "Mutter" };
            let gap_type_sub = if p.father_id.is_none() { "MISSING_FATHER" } else { "MISSING_MOTHER" };
            let task_id = format!("task_{}_{}", p.id, gap_type_sub);
            detected_task_ids.insert(task_id.clone());

            let (score, label) = calculate_priority_score("MISSING_PARENTS", is_direct_ancestor, has_context, -10);
            let advice = format!(
                "Für {} fehlt der Eintrag für {}. Suche im Tauf- oder Geburtseintrag sowie in der Heiratsurkunde nach Angaben zu beiden Elternteilen.",
                display_name, missing_side
            );
            let archive_hint = Some("Standesamt (ab 1874/1876) oder Kirchenbuch Taufen am Geburtsort prüfen.".to_string());
            let links = generate_archive_links(
                p.given_name.as_deref(),
                p.surname.as_deref(),
                birth_year,
                ref_place,
            );

            let (status, notes, c_at, u_at) = persisted
                .get(&task_id)
                .map(|pt| (pt.status.clone(), pt.notes.clone(), pt.created_at.clone(), pt.updated_at.clone()))
                .unwrap_or_else(|| ("open".to_string(), None, now_iso.clone(), now_iso.clone()));

            tasks.push(ResearchTaskDto {
                id: task_id,
                person_id: p.id.clone(),
                person_name: display_name.clone(),
                person_birth_date: p.birth_date.clone(),
                person_birth_place: p.birth_place.clone(),
                person_death_date: p.death_date.clone(),
                person_death_place: p.death_place.clone(),
                person_sex: p.sex.clone(),
                proband_code: proband_code.clone(),
                generation,
                gap_type: "MISSING_PARENTS".to_string(),
                title: format!("Fehlender {}: {}", missing_side, display_name),
                description: format!("Für {} ist der {} noch unbekannt.", display_name, missing_side),
                advice,
                archive_hint,
                links,
                priority_score: score,
                priority_label: label,
                status,
                notes,
                context_json: serde_json::json!({ "type": gap_type_sub }).to_string(),
                created_at: c_at,
                updated_at: u_at,
            });
        }

        // -------------------------------------------------------------
        // Heuristik 2: Fehlender Sterbeeintrag bei vermutetem Tod (> max_age)
        // -------------------------------------------------------------
        let has_no_death = p.death_date.as_deref().map(|s| s.trim().is_empty()).unwrap_or(true);
        if has_no_death {
            if let Some(by) = birth_year {
                if (current_year - by) > max_age {
                    let task_id = format!("task_{}_MISSING_DEATH", p.id);
                    detected_task_ids.insert(task_id.clone());

                    let (score, label) = calculate_priority_score("MISSING_DEATH", is_direct_ancestor, has_context, 0);
                    let archive_hint = if (by + 70) >= 1874 {
                        Some("Sterbejahr vermutlich nach 1874: Standesamtliches Sterberegister am letzten Wohnort durchsuchen.".to_string())
                    } else {
                        Some("Sterbejahr vermutlich vor 1874: Kirchenbuch (Begräbnisse/Totenzettel) der Heimat- oder Wohnpfarrei einsehen.".to_string())
                    };

                    let advice = format!(
                        "Ermittle den letzten bekannten Aufenthaltsort von {} (z. B. aus der Heirat oder den Geburten der Kinder) und prüfe dortige Sterberegister.",
                        display_name
                    );

                    let links = generate_archive_links(
                        p.given_name.as_deref(),
                        p.surname.as_deref(),
                        Some(by + 70), // geschätztes Sterbejahr
                        ref_place,
                    );

                    let (status, notes, c_at, u_at) = persisted
                        .get(&task_id)
                        .map(|pt| (pt.status.clone(), pt.notes.clone(), pt.created_at.clone(), pt.updated_at.clone()))
                        .unwrap_or_else(|| ("open".to_string(), None, now_iso.clone(), now_iso.clone()));

                    tasks.push(ResearchTaskDto {
                        id: task_id,
                        person_id: p.id.clone(),
                        person_name: display_name.clone(),
                        person_birth_date: p.birth_date.clone(),
                        person_birth_place: p.birth_place.clone(),
                        person_death_date: p.death_date.clone(),
                        person_death_place: p.death_place.clone(),
                        person_sex: p.sex.clone(),
                        proband_code: proband_code.clone(),
                        generation,
                        gap_type: "MISSING_DEATH".to_string(),
                        title: format!("Fehlender Sterbeeintrag: {}", display_name),
                        description: format!(
                            "{} wurde ca. {} geboren (vor {} Jahren), es ist jedoch kein Sterbedatum hinterlegt.",
                            display_name, by, current_year - by
                        ),
                        advice,
                        archive_hint,
                        links,
                        priority_score: score,
                        priority_label: label,
                        status,
                        notes,
                        context_json: serde_json::json!({ "birth_year": by }).to_string(),
                        created_at: c_at,
                        updated_at: u_at,
                    });
                }
            }
        }

        // -------------------------------------------------------------
        // Heuristik 3: Fehlende Lebensorte (Geburtsort / Sterbeort)
        // -------------------------------------------------------------
        let has_birth_date = p.birth_date.as_deref().map(|s| !s.trim().is_empty()).unwrap_or(false);
        let has_no_birth_place = p.birth_place.as_deref().map(|s| s.trim().is_empty()).unwrap_or(true);
        if has_birth_date && has_no_birth_place {
            let task_id = format!("task_{}_MISSING_BIRTH_PLACE", p.id);
            detected_task_ids.insert(task_id.clone());

            let (score, label) = calculate_priority_score("MISSING_PLACE", is_direct_ancestor, false, 0);
            let advice = format!(
                "Das Geburtsdatum ({}) von {} ist bekannt, jedoch nicht der Geburtsort. Prüfe Heirats- oder Sterbeurkunden der Person bzw. deren Kinder auf Herkunftsvermerke.",
                p.birth_date.as_deref().unwrap_or(""), display_name
            );
            let links = generate_archive_links(
                p.given_name.as_deref(),
                p.surname.as_deref(),
                birth_year,
                p.death_place.as_deref(),
            );

            let (status, notes, c_at, u_at) = persisted
                .get(&task_id)
                .map(|pt| (pt.status.clone(), pt.notes.clone(), pt.created_at.clone(), pt.updated_at.clone()))
                .unwrap_or_else(|| ("open".to_string(), None, now_iso.clone(), now_iso.clone()));

            tasks.push(ResearchTaskDto {
                id: task_id,
                person_id: p.id.clone(),
                person_name: display_name.clone(),
                person_birth_date: p.birth_date.clone(),
                person_birth_place: p.birth_place.clone(),
                person_death_date: p.death_date.clone(),
                person_death_place: p.death_place.clone(),
                person_sex: p.sex.clone(),
                proband_code: proband_code.clone(),
                generation,
                gap_type: "MISSING_PLACE".to_string(),
                title: format!("Fehlender Geburtsort: {}", display_name),
                description: format!("Das Geburtsdatum von {} ist erfasst, der Geburtsort fehlt jedoch.", display_name),
                advice,
                archive_hint: Some("Meyers Gazetteer oder GenWiki zur Lokalisierung von Pfarreien heranziehen.".to_string()),
                links,
                priority_score: score,
                priority_label: label,
                status,
                notes,
                context_json: serde_json::json!({ "missing": "birth_place" }).to_string(),
                created_at: c_at,
                updated_at: u_at,
            });
        }

        let has_death_date = p.death_date.as_deref().map(|s| !s.trim().is_empty()).unwrap_or(false);
        let has_no_death_place = p.death_place.as_deref().map(|s| s.trim().is_empty()).unwrap_or(true);
        if has_death_date && has_no_death_place {
            let task_id = format!("task_{}_MISSING_DEATH_PLACE", p.id);
            detected_task_ids.insert(task_id.clone());

            let (score, label) = calculate_priority_score("MISSING_PLACE", is_direct_ancestor, false, -5);
            let advice = format!(
                "Das Sterbedatum ({}) von {} ist bekannt, jedoch nicht der Sterbeort. Suche nach Nachlassakten oder Eintragungen bei den überlebenden Angehörigen.",
                p.death_date.as_deref().unwrap_or(""), display_name
            );
            let links = generate_archive_links(
                p.given_name.as_deref(),
                p.surname.as_deref(),
                death_year,
                p.birth_place.as_deref(),
            );

            let (status, notes, c_at, u_at) = persisted
                .get(&task_id)
                .map(|pt| (pt.status.clone(), pt.notes.clone(), pt.created_at.clone(), pt.updated_at.clone()))
                .unwrap_or_else(|| ("open".to_string(), None, now_iso.clone(), now_iso.clone()));

            tasks.push(ResearchTaskDto {
                id: task_id,
                person_id: p.id.clone(),
                person_name: display_name.clone(),
                person_birth_date: p.birth_date.clone(),
                person_birth_place: p.birth_place.clone(),
                person_death_date: p.death_date.clone(),
                person_death_place: p.death_place.clone(),
                person_sex: p.sex.clone(),
                proband_code: proband_code.clone(),
                generation,
                gap_type: "MISSING_PLACE".to_string(),
                title: format!("Fehlender Sterbeort: {}", display_name),
                description: format!("Das Sterbedatum von {} ist erfasst, der Sterbeort fehlt jedoch.", display_name),
                advice,
                archive_hint: Some("Standesamt oder Pfarrei am Wohnort der Familie prüfen.".to_string()),
                links,
                priority_score: score,
                priority_label: label,
                status,
                notes,
                context_json: serde_json::json!({ "missing": "death_place" }).to_string(),
                created_at: c_at,
                updated_at: u_at,
            });
        }

        // -------------------------------------------------------------
        // Heuristik 4: Auffällige Kinderlücken (Geschwisterabstand)
        // -------------------------------------------------------------
        // Wir prüfen Kinder pro Elternteil nur für den Vater (oder wenn kein Vater vorhanden für die Mutter),
        // um Duplikate für dasselbe Elternpaar zu vermeiden.
        let should_check_children = if p.sex.as_deref() == Some("M") {
            true
        } else if p.sex.as_deref() == Some("F") {
            p.spouses.is_empty() // alleinstehende Mutter
        } else {
            true
        };

        if should_check_children && p.children_ids.len() >= 2 {
            let mut dated_children: Vec<(&Person, f64)> = Vec::new();
            for cid in &p.children_ids {
                if let Some(cp) = person_map.get(cid) {
                    if let Some(bd) = cp.birth_date.as_deref() {
                        if let Some(fy) = parse_date_fractional_year(bd) {
                            dated_children.push((cp, fy));
                        }
                    }
                }
            }

            dated_children.sort_by(|a, b| a.1.partial_cmp(&b.1).unwrap_or(std::cmp::Ordering::Equal));

            for w in dated_children.windows(2) {
                let (c1, y1) = w[0];
                let (c2, y2) = w[1];
                let diff = y2 - y1;

                if diff >= (child_gap_thresh as f64) && diff <= 15.0 {
                    let task_id = format!("task_{}_CHILD_GAP_{}_{}", p.id, c1.id, c2.id);
                    detected_task_ids.insert(task_id.clone());

                    let c1_name = format!("{} {}", c1.given_name.as_deref().unwrap_or(""), c1.surname.as_deref().unwrap_or("")).trim().to_string();
                    let c2_name = format!("{} {}", c2.given_name.as_deref().unwrap_or(""), c2.surname.as_deref().unwrap_or("")).trim().to_string();

                    let (score, label) = calculate_priority_score("CHILD_GAP", is_direct_ancestor, has_context, 0);
                    let advice = format!(
                        "Zwischen den Geburten von {} ({}) und {} ({}) liegen ca. {:.1} Jahre. In historischen Zeiten folgten Geburten meist in 2- bis 3-Jahres-Abständen. Durchsuche das Tauf- und Sterberegister der Pfarrei in den Jahren {:.0} bis {:.0} nach früh verstorbenen Kindern oder Totgeburten dieser Familie.",
                        c1_name, c1.birth_date.as_deref().unwrap_or("?"),
                        c2_name, c2.birth_date.as_deref().unwrap_or("?"),
                        diff, y1, y2
                    );

                    let links = generate_archive_links(
                        None,
                        p.surname.as_deref(),
                        Some((y1 + diff / 2.0) as i32),
                        ref_place,
                    );

                    let (status, notes, c_at, u_at) = persisted
                        .get(&task_id)
                        .map(|pt| (pt.status.clone(), pt.notes.clone(), pt.created_at.clone(), pt.updated_at.clone()))
                        .unwrap_or_else(|| ("open".to_string(), None, now_iso.clone(), now_iso.clone()));

                    tasks.push(ResearchTaskDto {
                        id: task_id,
                        person_id: p.id.clone(),
                        person_name: display_name.clone(),
                        person_birth_date: p.birth_date.clone(),
                        person_birth_place: p.birth_place.clone(),
                        person_death_date: p.death_date.clone(),
                        person_death_place: p.death_place.clone(),
                        person_sex: p.sex.clone(),
                        proband_code: proband_code.clone(),
                        generation,
                        gap_type: "CHILD_GAP".to_string(),
                        title: format!("Kinderlücke ({:.1} Jahre): Familie {}", diff, display_name),
                        description: format!(
                            "Großer zeitlicher Abstand zwischen Kind {} ({:.0}) und Kind {} ({:.0}).",
                            c1_name, y1, c2_name, y2
                        ),
                        advice,
                        archive_hint: Some("Tauf- und Begräbnisregister der Heimatpfarrei für diesen Zeitraum prüfen.".to_string()),
                        links,
                        priority_score: score,
                        priority_label: label,
                        status,
                        notes,
                        context_json: serde_json::json!({
                            "child1_id": c1.id,
                            "child2_id": c2.id,
                            "gap_years": diff
                        }).to_string(),
                        created_at: c_at,
                        updated_at: u_at,
                    });
                }
            }
        }
    }

    // -------------------------------------------------------------
    // Hybrid-Check: Vorhandene persistierte Aufgaben, die mittlerweile gelöst wurden
    // Wenn eine Aufgabe in SQLite existiert, aber nicht mehr in detected_task_ids ist:
    // Falls sie noch auf 'open' oder 'in_progress' stand, wurde sie automatisch durch Datenänderung gelöst!
    // -------------------------------------------------------------
    for (saved_id, pt) in &persisted {
        if !detected_task_ids.contains(saved_id) {
            if target_person_ids.contains(&pt.person_id) {
                if let Some(p) = person_map.get(&pt.person_id) {
                    let display_name = format!(
                        "{} {}",
                        p.given_name.as_deref().unwrap_or(""),
                        p.surname.as_deref().unwrap_or("")
                    ).trim().to_string();

                    let auto_status = if pt.status == "open" || pt.status == "in_progress" {
                        "completed".to_string()
                    } else {
                        pt.status.clone()
                    };

                    tasks.push(ResearchTaskDto {
                        id: saved_id.clone(),
                        person_id: pt.person_id.clone(),
                        person_name: if display_name.is_empty() { p.id.clone() } else { display_name },
                        person_birth_date: p.birth_date.clone(),
                        person_birth_place: p.birth_place.clone(),
                        person_death_date: p.death_date.clone(),
                        person_death_place: p.death_place.clone(),
                        person_sex: p.sex.clone(),
                        proband_code: None,
                        generation: None,
                        gap_type: pt.gap_type.clone(),
                        title: format!("Erledigte Lücke: {}", pt.gap_type),
                        description: "Diese Lücke wurde durch die Ergänzung der entsprechenden Daten im Stammbaum geschlossen.".to_string(),
                        advice: "Bereits vollständig erfasst.".to_string(),
                        archive_hint: None,
                        links: ExternalArchiveLinks {
                            matricula_url: None,
                            archion_url: None,
                            familysearch_url: None,
                            meyers_url: None,
                        },
                        priority_score: pt.priority_score,
                        priority_label: "low".to_string(),
                        status: auto_status,
                        notes: pt.notes.clone(),
                        context_json: pt.context_json.clone(),
                        created_at: pt.created_at.clone(),
                        updated_at: pt.updated_at.clone(),
                    });
                }
            }
        }
    }

    // Sort tasks: Primary by status ('open' / 'in_progress' first, then 'completed', then 'ignored'),
    // then by priority_score descending.
    tasks.sort_by(|a, b| {
        let status_order = |s: &str| match s {
            "in_progress" => 0,
            "open" => 1,
            "completed" => 2,
            "ignored" => 3,
            _ => 4,
        };
        let s_a = status_order(&a.status);
        let s_b = status_order(&b.status);
        if s_a != s_b {
            s_a.cmp(&s_b)
        } else {
            b.priority_score.cmp(&a.priority_score)
        }
    });

    Ok(tasks)
}

pub fn calculate_statistics(tasks: &[ResearchTaskDto]) -> ResearchStatsDto {
    let mut stats = ResearchStatsDto {
        total_gaps: tasks.len(),
        open_count: 0,
        in_progress_count: 0,
        completed_count: 0,
        ignored_count: 0,
        missing_parents_count: 0,
        missing_death_count: 0,
        missing_place_count: 0,
        child_gap_count: 0,
    };

    for t in tasks {
        match t.status.as_str() {
            "open" => stats.open_count += 1,
            "in_progress" => stats.in_progress_count += 1,
            "completed" => stats.completed_count += 1,
            "ignored" => stats.ignored_count += 1,
            _ => {}
        }
        match t.gap_type.as_str() {
            "MISSING_PARENTS" => stats.missing_parents_count += 1,
            "MISSING_DEATH" => stats.missing_death_count += 1,
            "MISSING_PLACE" => stats.missing_place_count += 1,
            "CHILD_GAP" => stats.child_gap_count += 1,
            _ => {}
        }
    }

    stats
}

pub fn upsert_task_status(
    conn: &Connection,
    task_id: &str,
    person_id: &str,
    gap_type: &str,
    context_json: &str,
    status: &str,
    notes: Option<&str>,
    priority_score: i32,
) -> Result<(), String> {
    let now_iso = chrono::Local::now().to_rfc3339();
    conn.execute(
        "INSERT INTO research_tasks (id, person_id, gap_type, context_json, status, priority_score, notes, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)
         ON CONFLICT(id) DO UPDATE SET
            status = excluded.status,
            notes = excluded.notes,
            updated_at = excluded.updated_at",
        rusqlite::params![
            task_id,
            person_id,
            gap_type,
            context_json,
            status,
            priority_score,
            notes,
            now_iso,
            now_iso
        ],
    )
    .map_err(|e| format!("Fehler beim Speichern der Recherche-Aufgabe: {}", e))?;

    Ok(())
}

fn make_person_summary(p: &Person) -> BranchPersonSummary {
    let name_str = format!(
        "{} {}",
        p.given_name.as_deref().unwrap_or(""),
        p.surname.as_deref().unwrap_or("")
    )
    .trim()
    .to_string();
    let display_name = if name_str.is_empty() {
        p.id.clone()
    } else {
        name_str
    };

    BranchPersonSummary {
        id: p.id.clone(),
        name: display_name,
        birth_date: p.birth_date.clone(),
        death_date: p.death_date.clone(),
        birth_place: p.birth_place.clone(),
        death_place: p.death_place.clone(),
        sex: p.sex.clone(),
    }
}

fn calc_branch_depth(
    pid: &str,
    child_map: &HashMap<String, Vec<String>>,
    memo: &mut HashMap<String, usize>,
    visiting: &mut HashSet<String>,
) -> usize {
    if let Some(&d) = memo.get(pid) {
        return d;
    }
    if visiting.contains(pid) {
        return 1;
    }
    visiting.insert(pid.to_string());
    let mut max_child_depth = 0;
    if let Some(children) = child_map.get(pid) {
        for ch in children {
            let cd = calc_branch_depth(ch, child_map, memo, visiting);
            if cd > max_child_depth {
                max_child_depth = cd;
            }
        }
    }
    visiting.remove(pid);
    let d = 1 + max_child_depth;
    memo.insert(pid.to_string(), d);
    d
}

pub fn find_isolated_branches(
    all_persons: &[Person],
    active_proband_id: Option<&str>,
) -> Result<IsolatedBranchesResultDto, String> {
    if all_persons.is_empty() {
        return Ok(IsolatedBranchesResultDto {
            total_persons: 0,
            total_components: 0,
            main_tree_person_count: 0,
            isolated_branches_count: 0,
            isolated_individuals_count: 0,
            branches: Vec::new(),
        });
    }

    let person_map: HashMap<&str, &Person> = all_persons.iter().map(|p| (p.id.as_str(), p)).collect();

    // 1. Build adjacency list (undirected graph of family connections)
    let mut adj: HashMap<&str, HashSet<&str>> = HashMap::new();
    for p in all_persons {
        adj.entry(&p.id).or_default();

        // Parents
        for parent_id in &p.parent_ids {
            if person_map.contains_key(parent_id.as_str()) {
                adj.entry(&p.id).or_default().insert(parent_id.as_str());
                adj.entry(parent_id.as_str()).or_default().insert(&p.id);
            }
        }
        if let Some(ref fid) = p.father_id {
            if person_map.contains_key(fid.as_str()) {
                adj.entry(&p.id).or_default().insert(fid.as_str());
                adj.entry(fid.as_str()).or_default().insert(&p.id);
            }
        }
        if let Some(ref mid) = p.mother_id {
            if person_map.contains_key(mid.as_str()) {
                adj.entry(&p.id).or_default().insert(mid.as_str());
                adj.entry(mid.as_str()).or_default().insert(&p.id);
            }
        }

        // Children
        for ch_id in &p.children_ids {
            if person_map.contains_key(ch_id.as_str()) {
                adj.entry(&p.id).or_default().insert(ch_id.as_str());
                adj.entry(ch_id.as_str()).or_default().insert(&p.id);
            }
        }

        // Spouses
        for sp in &p.spouses {
            if person_map.contains_key(sp.id.as_str()) {
                adj.entry(&p.id).or_default().insert(sp.id.as_str());
                adj.entry(sp.id.as_str()).or_default().insert(&p.id);
            }
        }
    }

    // 2. Compute Connected Components using BFS
    let mut visited: HashSet<&str> = HashSet::new();
    let mut components: Vec<Vec<&str>> = Vec::new();

    for p in all_persons {
        let p_id = p.id.as_str();
        if visited.contains(p_id) {
            continue;
        }

        let mut comp = Vec::new();
        let mut queue = VecDeque::new();
        visited.insert(p_id);
        queue.push_back(p_id);

        while let Some(curr) = queue.pop_front() {
            comp.push(curr);
            if let Some(neighbors) = adj.get(curr) {
                for &neighbor in neighbors {
                    if !visited.contains(neighbor) {
                        visited.insert(neighbor);
                        queue.push_back(neighbor);
                    }
                }
            }
        }

        components.push(comp);
    }

    let total_components = components.len();

    // 3. Determine Main Tree Component:
    // If active_proband_id is provided and present in a component, that component is the main tree.
    // Otherwise, the component with the largest number of persons is the main tree.
    let mut main_comp_idx = 0;
    let mut max_comp_size = 0;

    for (idx, comp) in components.iter().enumerate() {
        if comp.len() > max_comp_size {
            max_comp_size = comp.len();
            main_comp_idx = idx;
        }
    }

    if let Some(proband_id) = active_proband_id {
        if !proband_id.is_empty() {
            for (idx, comp) in components.iter().enumerate() {
                if comp.iter().any(|&id| id == proband_id) {
                    main_comp_idx = idx;
                    break;
                }
            }
        }
    }

    let main_comp_persons: HashSet<&str> = components
        .get(main_comp_idx)
        .map(|c| c.iter().copied().collect())
        .unwrap_or_default();
    let main_tree_person_count = main_comp_persons.len();

    // Build index of main tree persons by lowercase surname for fast connection suggestions
    let mut main_surname_map: HashMap<String, Vec<&Person>> = HashMap::new();
    for &pid in &main_comp_persons {
        if let Some(p) = person_map.get(pid) {
            if let Some(ref sn) = p.surname {
                let trimmed = sn.trim().to_lowercase();
                if trimmed.len() >= 2 {
                    main_surname_map.entry(trimmed).or_default().push(p);
                }
            }
        }
    }

    // 4. Process all isolated components
    let mut raw_branches: Vec<IsolatedBranchDto> = Vec::new();

    for (idx, comp) in components.iter().enumerate() {
        if idx == main_comp_idx {
            continue;
        }

        let comp_set: HashSet<&str> = comp.iter().copied().collect();
        let mut comp_persons: Vec<&Person> = comp.iter().filter_map(|&id| person_map.get(id).copied()).collect();

        // Sort persons roughly by birth year or name
        comp_persons.sort_by(|a, b| {
            let by_a = a.birth_date.as_deref().and_then(extract_year).unwrap_or(9999);
            let by_b = b.birth_date.as_deref().and_then(extract_year).unwrap_or(9999);
            by_a.cmp(&by_b).then_with(|| a.id.cmp(&b.id))
        });

        // Identify root ancestors: persons in component with no parents in this component
        let mut root_ancestors_list: Vec<&Person> = Vec::new();
        let mut child_map: HashMap<String, Vec<String>> = HashMap::new();

        for p in &comp_persons {
            let mut has_parent_in_comp = false;
            for parent_id in &p.parent_ids {
                if comp_set.contains(parent_id.as_str()) {
                    has_parent_in_comp = true;
                    break;
                }
            }
            if !has_parent_in_comp {
                if let Some(ref fid) = p.father_id {
                    if comp_set.contains(fid.as_str()) {
                        has_parent_in_comp = true;
                    }
                }
            }
            if !has_parent_in_comp {
                if let Some(ref mid) = p.mother_id {
                    if comp_set.contains(mid.as_str()) {
                        has_parent_in_comp = true;
                    }
                }
            }

            if !has_parent_in_comp {
                root_ancestors_list.push(p);
            }

            // Directed children in component
            let mut children_in_comp = Vec::new();
            for cid in &p.children_ids {
                if comp_set.contains(cid.as_str()) {
                    children_in_comp.push(cid.clone());
                }
            }
            child_map.insert(p.id.clone(), children_in_comp);
        }

        // Fallback: if cyclical relations exist and no roots found, use the oldest person
        if root_ancestors_list.is_empty() && !comp_persons.is_empty() {
            root_ancestors_list.push(comp_persons[0]);
        }

        // Calculate generation depth
        let mut memo: HashMap<String, usize> = HashMap::new();
        let mut visiting: HashSet<String> = HashSet::new();
        let mut generation_depth = 1;
        for r in &root_ancestors_list {
            let d = calc_branch_depth(&r.id, &child_map, &mut memo, &mut visiting);
            if d > generation_depth {
                generation_depth = d;
            }
        }
        if generation_depth < 1 {
            generation_depth = 1;
        }

        // Years range
        let mut earliest_year: Option<i32> = None;
        let mut latest_year: Option<i32> = None;
        for p in &comp_persons {
            if let Some(by) = p.birth_date.as_deref().and_then(extract_year) {
                earliest_year = Some(earliest_year.map_or(by, |ey| ey.min(by)));
                latest_year = Some(latest_year.map_or(by, |ly| ly.max(by)));
            }
            if let Some(dy) = p.death_date.as_deref().and_then(extract_year) {
                earliest_year = Some(earliest_year.map_or(dy, |ey| ey.min(dy)));
                latest_year = Some(latest_year.map_or(dy, |ly| ly.max(dy)));
            }
        }

        // Top places & surnames frequency
        let mut place_counts: HashMap<String, usize> = HashMap::new();
        let mut surname_counts: HashMap<String, usize> = HashMap::new();

        for p in &comp_persons {
            if let Some(ref bp) = p.birth_place {
                let trimmed = bp.trim().to_string();
                if !trimmed.is_empty() {
                    *place_counts.entry(trimmed).or_default() += 1;
                }
            }
            if let Some(ref dp) = p.death_place {
                let trimmed = dp.trim().to_string();
                if !trimmed.is_empty() {
                    *place_counts.entry(trimmed).or_default() += 1;
                }
            }
            if let Some(ref sn) = p.surname {
                let trimmed = sn.trim().to_string();
                if !trimmed.is_empty() && trimmed != "?" {
                    *surname_counts.entry(trimmed).or_default() += 1;
                }
            }
        }

        let mut sorted_places: Vec<(String, usize)> = place_counts.into_iter().collect();
        sorted_places.sort_by(|a, b| b.1.cmp(&a.1).then_with(|| a.0.cmp(&b.0)));
        let top_places: Vec<String> = sorted_places.into_iter().take(4).map(|(p, _)| p).collect();

        let mut sorted_surnames: Vec<(String, usize)> = surname_counts.into_iter().collect();
        sorted_surnames.sort_by(|a, b| b.1.cmp(&a.1).then_with(|| a.0.cmp(&b.0)));
        let top_surnames: Vec<String> = sorted_surnames.into_iter().take(3).map(|(s, _)| s).collect();

        // Branch naming
        let branch_name = if comp_persons.len() == 1 {
            let p = comp_persons[0];
            let name = format!(
                "{} {}",
                p.given_name.as_deref().unwrap_or(""),
                p.surname.as_deref().unwrap_or("")
            )
            .trim()
            .to_string();
            if name.is_empty() {
                format!("Einzelperson #{}", p.id)
            } else {
                format!("Einzelperson: {}", name)
            }
        } else if let Some(first_sn) = top_surnames.first() {
            format!("Zweig {}", first_sn)
        } else if let Some(root_sn) = root_ancestors_list.first().and_then(|r| r.surname.as_deref()) {
            format!("Zweig {}", root_sn.trim())
        } else {
            format!("Isolierter Zweig ({} Personen)", comp_persons.len())
        };

        // Root ancestors summaries
        let root_summaries: Vec<BranchPersonSummary> = root_ancestors_list.iter().map(|&p| make_person_summary(p)).collect();
        let person_summaries: Vec<BranchPersonSummary> = comp_persons.iter().map(|&p| make_person_summary(p)).collect();

        // Suggested connections heuristic against main tree
        let mut suggested_connections: Vec<SuggestedConnection> = Vec::new();
        let mut seen_pairs: HashSet<(String, String)> = HashSet::new();

        // Prioritize checking root ancestors and key persons of the branch
        for iso_p in &comp_persons {
            if let Some(ref sn) = iso_p.surname {
                let trimmed_sn = sn.trim().to_lowercase();
                if let Some(main_candidates) = main_surname_map.get(&trimmed_sn) {
                    let iso_by = iso_p.birth_date.as_deref().and_then(extract_year);
                    let iso_dy = iso_p.death_date.as_deref().and_then(extract_year);
                    let iso_place = iso_p.birth_place.as_deref().or(iso_p.death_place.as_deref());

                    for main_p in main_candidates {
                        let pair_key = (iso_p.id.clone(), main_p.id.clone());
                        if seen_pairs.contains(&pair_key) {
                            continue;
                        }

                        let main_by = main_p.birth_date.as_deref().and_then(extract_year);
                        let main_dy = main_p.death_date.as_deref().and_then(extract_year);
                        let main_place = main_p.birth_place.as_deref().or(main_p.death_place.as_deref());

                        let mut score = 50; // Base score for matching surname
                        let mut reason_parts = Vec::new();
                        reason_parts.push(format!("Gleicher Nachname '{}'", sn.trim()));

                        // Check location match
                        if let (Some(ip), Some(mp)) = (iso_place, main_place) {
                            let ip_lc = ip.trim().to_lowercase();
                            let mp_lc = mp.trim().to_lowercase();
                            if !ip_lc.is_empty() && !mp_lc.is_empty() {
                                if ip_lc == mp_lc || ip_lc.contains(&mp_lc) || mp_lc.contains(&ip_lc) {
                                    score += 25;
                                    reason_parts.push(format!("Ort '{}'", ip.trim()));
                                }
                            }
                        }

                        // Check time proximity
                        let year_diff = match (iso_by.or(iso_dy), main_by.or(main_dy)) {
                            (Some(y1), Some(y2)) => Some((y1 - y2).abs()),
                            _ => None,
                        };

                        if let Some(diff) = year_diff {
                            if diff <= 15 {
                                score += 20;
                                reason_parts.push(format!("Zeitlich nahe (±{} Jahre)", diff));
                            } else if diff <= 45 {
                                score += 15;
                                reason_parts.push(format!("Plausibler Generationsabstand ({} Jahre)", diff));
                            }
                        }

                        if score >= 65 {
                            seen_pairs.insert(pair_key);
                            let iso_name = format!(
                                "{} {}",
                                iso_p.given_name.as_deref().unwrap_or(""),
                                iso_p.surname.as_deref().unwrap_or("")
                            )
                            .trim()
                            .to_string();
                            let main_name = format!(
                                "{} {}",
                                main_p.given_name.as_deref().unwrap_or(""),
                                main_p.surname.as_deref().unwrap_or("")
                            )
                            .trim()
                            .to_string();

                            suggested_connections.push(SuggestedConnection {
                                isolated_person_id: iso_p.id.clone(),
                                isolated_person_name: if iso_name.is_empty() { iso_p.id.clone() } else { iso_name },
                                main_person_id: main_p.id.clone(),
                                main_person_name: if main_name.is_empty() { main_p.id.clone() } else { main_name },
                                match_reason: reason_parts.join(" • "),
                                confidence_score: score,
                            });
                        }
                    }
                }
            }
        }

        suggested_connections.sort_by(|a, b| b.confidence_score.cmp(&a.confidence_score));
        suggested_connections.truncate(4);

        raw_branches.push(IsolatedBranchDto {
            id: 0, // Will be set after sorting
            name: branch_name,
            person_count: comp_persons.len(),
            generation_depth,
            root_ancestors: root_summaries,
            persons: person_summaries,
            earliest_year,
            latest_year,
            top_places,
            top_surnames,
            suggested_connections,
        });
    }

    // Sort branches: largest first, then deepest generation, then name
    raw_branches.sort_by(|a, b| {
        b.person_count
            .cmp(&a.person_count)
            .then_with(|| b.generation_depth.cmp(&a.generation_depth))
            .then_with(|| a.name.cmp(&b.name))
    });

    // Assign sequential 1-based IDs
    for (idx, branch) in raw_branches.iter_mut().enumerate() {
        branch.id = idx + 1;
    }

    let isolated_branches_count = raw_branches.iter().filter(|b| b.person_count > 1).count();
    let isolated_individuals_count = raw_branches.iter().filter(|b| b.person_count == 1).count();

    Ok(IsolatedBranchesResultDto {
        total_persons: all_persons.len(),
        total_components,
        main_tree_person_count,
        isolated_branches_count,
        isolated_individuals_count,
        branches: raw_branches,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::init_in_memory_database;

    #[test]
    fn test_extract_year_and_fractional() {
        assert_eq!(extract_year("1895"), Some(1895));
        assert_eq!(extract_year("12.04.1895"), Some(1895));
        assert_eq!(extract_year("1895-04-12"), Some(1895));
        assert_eq!(extract_year("ABT 1895"), Some(1895));
        assert_eq!(extract_year("UNKNOWN"), None);

        let f = parse_date_fractional_year("1895-07-01");
        assert!(f.is_some());
        let val = f.unwrap();
        assert!(val > 1895.4 && val < 1895.6);
    }

    #[test]
    fn test_external_links_generation() {
        let links = generate_archive_links(
            Some("Johann"),
            Some("Müller"),
            Some(1850),
            Some("Münster"),
        );
        assert!(links.familysearch_url.is_some());
        let fs = links.familysearch_url.unwrap();
        assert!(fs.contains("Johann"));
        assert!(fs.contains("M%C3%BCller") || fs.contains("Müller") || fs.contains("M"));

        assert!(links.matricula_url.is_some());
        assert!(links.archion_url.is_some());
        assert!(links.meyers_url.is_some());
    }

    #[test]
    fn test_priority_score_calculation() {
        let (score1, label1) = calculate_priority_score("MISSING_PARENTS", true, true, 0);
        assert!(score1 >= 85);
        assert_eq!(label1, "urgent");

        let (score2, label2) = calculate_priority_score("MISSING_PLACE", false, false, 0);
        assert_eq!(score2, 40);
        assert_eq!(label2, "low");
    }

    #[test]
    fn test_analyze_gaps_in_memory() {
        let conn = init_in_memory_database().unwrap();
        let persons = vec![
            Person {
                id: "I1".to_string(),
                given_name: Some("Anton".to_string()),
                surname: Some("Froning".to_string()),
                sex: Some("M".to_string()),
                birth_date: Some("1820-05-10".to_string()),
                birth_place: Some("Münster".to_string()),
                death_date: None,
                death_place: None,
                father_id: None,
                mother_id: None,
                children_ids: vec!["I2".to_string(), "I3".to_string()],
                spouses: vec![],
                parent_ids: vec![],
                proband_data: HashMap::new(),
                gedcom_extra: serde_json::json!({}),
            },
            Person {
                id: "I2".to_string(),
                given_name: Some("Bernhard".to_string()),
                surname: Some("Froning".to_string()),
                sex: Some("M".to_string()),
                birth_date: Some("1850-01-01".to_string()),
                birth_place: None, // Missing place
                death_date: Some("1920-01-01".to_string()),
                death_place: Some("Münster".to_string()),
                father_id: Some("I1".to_string()),
                mother_id: None, // Missing mother
                children_ids: vec![],
                spouses: vec![],
                parent_ids: vec!["I1".to_string()],
                proband_data: HashMap::new(),
                gedcom_extra: serde_json::json!({}),
            },
            Person {
                id: "I3".to_string(),
                given_name: Some("Clara".to_string()),
                surname: Some("Froning".to_string()),
                sex: Some("F".to_string()),
                birth_date: Some("1856-06-01".to_string()), // Gap to I2 = 6.5 years (> 3.5)
                birth_place: Some("Münster".to_string()),
                death_date: Some("1930-01-01".to_string()),
                death_place: Some("Münster".to_string()),
                father_id: Some("I1".to_string()),
                mother_id: None,
                children_ids: vec![],
                spouses: vec![],
                parent_ids: vec!["I1".to_string()],
                proband_data: HashMap::new(),
                gedcom_extra: serde_json::json!({}),
            },
        ];

        let scope = ResearchScope {
            scope_type: "all".to_string(),
            proband_id: None,
            person_id: None,
        };
        let settings = ResearchSettings {
            max_age_years: Some(110),
            child_gap_years: Some(3.5),
        };

        let tasks = analyze_gaps(&conn, &persons, &scope, &settings).unwrap();
        assert!(!tasks.is_empty());

        let has_missing_parents = tasks.iter().any(|t| t.gap_type == "MISSING_PARENTS" && t.person_id == "I1");
        assert!(has_missing_parents);

        let has_missing_death = tasks.iter().any(|t| t.gap_type == "MISSING_DEATH" && t.person_id == "I1");
        assert!(has_missing_death);

        let has_missing_place = tasks.iter().any(|t| t.gap_type == "MISSING_PLACE" && t.person_id == "I2");
        assert!(has_missing_place);

        let has_child_gap = tasks.iter().any(|t| t.gap_type == "CHILD_GAP" && t.person_id == "I1");
        assert!(has_child_gap);

        let stats = calculate_statistics(&tasks);
        assert_eq!(stats.total_gaps, tasks.len());
        assert!(stats.open_count > 0);
    }

    #[test]
    fn test_scope_person_ancestors_and_descendants() {
        let conn = init_in_memory_database().unwrap();
        let persons = vec![
            Person {
                id: "I1".to_string(),
                given_name: Some("Anton".to_string()),
                surname: Some("Froning".to_string()),
                sex: Some("M".to_string()),
                birth_date: Some("1820-05-10".to_string()),
                birth_place: Some("Münster".to_string()),
                death_date: Some("1890-01-01".to_string()),
                death_place: Some("Münster".to_string()),
                father_id: None,
                mother_id: None,
                children_ids: vec!["I2".to_string()],
                spouses: vec![],
                parent_ids: vec![],
                proband_data: HashMap::new(),
                gedcom_extra: serde_json::json!({}),
            },
            Person {
                id: "I2".to_string(),
                given_name: Some("Bernhard".to_string()),
                surname: Some("Froning".to_string()),
                sex: Some("M".to_string()),
                birth_date: Some("1850-01-01".to_string()),
                birth_place: None,
                death_date: Some("1920-01-01".to_string()),
                death_place: Some("Münster".to_string()),
                father_id: Some("I1".to_string()),
                mother_id: None,
                children_ids: vec!["I3".to_string()],
                spouses: vec![],
                parent_ids: vec!["I1".to_string()],
                proband_data: HashMap::new(),
                gedcom_extra: serde_json::json!({}),
            },
            Person {
                id: "I3".to_string(),
                given_name: Some("Clara".to_string()),
                surname: Some("Froning".to_string()),
                sex: Some("F".to_string()),
                birth_date: Some("1880-01-01".to_string()),
                birth_place: Some("Münster".to_string()),
                death_date: None,
                death_place: None,
                father_id: Some("I2".to_string()),
                mother_id: None,
                children_ids: vec![],
                spouses: vec![],
                parent_ids: vec!["I2".to_string()],
                proband_data: HashMap::new(),
                gedcom_extra: serde_json::json!({}),
            },
        ];

        let settings = ResearchSettings::default();

        let scope_anc = ResearchScope {
            scope_type: "person_ancestors".to_string(),
            proband_id: None,
            person_id: Some("I3".to_string()),
        };
        let tasks_anc = analyze_gaps(&conn, &persons, &scope_anc, &settings).unwrap();
        assert!(tasks_anc.iter().any(|t| t.person_id == "I1"));
        assert!(tasks_anc.iter().any(|t| t.person_id == "I2"));

        let scope_desc = ResearchScope {
            scope_type: "person_descendants".to_string(),
            proband_id: None,
            person_id: Some("I1".to_string()),
        };
        let tasks_desc = analyze_gaps(&conn, &persons, &scope_desc, &settings).unwrap();
        assert!(tasks_desc.iter().any(|t| t.person_id == "I2"));
        assert!(tasks_desc.iter().any(|t| t.person_id == "I3"));
    }

    #[test]
    fn test_find_isolated_branches() {
        let persons = vec![
            // Main tree: I1 -> I2 -> I3
            Person {
                id: "I1".to_string(),
                given_name: Some("Anton".to_string()),
                surname: Some("Froning".to_string()),
                sex: Some("M".to_string()),
                birth_date: Some("1820-05-10".to_string()),
                birth_place: Some("Münster".to_string()),
                death_date: Some("1890-01-01".to_string()),
                death_place: Some("Münster".to_string()),
                father_id: None,
                mother_id: None,
                children_ids: vec!["I2".to_string()],
                spouses: vec![],
                parent_ids: vec![],
                proband_data: HashMap::new(),
                gedcom_extra: serde_json::json!({}),
            },
            Person {
                id: "I2".to_string(),
                given_name: Some("Bernhard".to_string()),
                surname: Some("Froning".to_string()),
                sex: Some("M".to_string()),
                birth_date: Some("1850-01-01".to_string()),
                birth_place: Some("Münster".to_string()),
                death_date: Some("1920-01-01".to_string()),
                death_place: Some("Münster".to_string()),
                father_id: Some("I1".to_string()),
                mother_id: None,
                children_ids: vec!["I3".to_string()],
                spouses: vec![],
                parent_ids: vec!["I1".to_string()],
                proband_data: HashMap::new(),
                gedcom_extra: serde_json::json!({}),
            },
            Person {
                id: "I3".to_string(),
                given_name: Some("Clara".to_string()),
                surname: Some("Froning".to_string()),
                sex: Some("F".to_string()),
                birth_date: Some("1880-01-01".to_string()),
                birth_place: Some("Münster".to_string()),
                death_date: None,
                death_place: None,
                father_id: Some("I2".to_string()),
                mother_id: None,
                children_ids: vec![],
                spouses: vec![],
                parent_ids: vec!["I2".to_string()],
                proband_data: HashMap::new(),
                gedcom_extra: serde_json::json!({}),
            },
            // Isolated branch: B1 -> B2 (2 persons, 2 generations)
            Person {
                id: "B1".to_string(),
                given_name: Some("Wilhelm".to_string()),
                surname: Some("Becker".to_string()),
                sex: Some("M".to_string()),
                birth_date: Some("1830-01-01".to_string()),
                birth_place: Some("Köln".to_string()),
                death_date: Some("1900-01-01".to_string()),
                death_place: Some("Köln".to_string()),
                father_id: None,
                mother_id: None,
                children_ids: vec!["B2".to_string()],
                spouses: vec![],
                parent_ids: vec![],
                proband_data: HashMap::new(),
                gedcom_extra: serde_json::json!({}),
            },
            Person {
                id: "B2".to_string(),
                given_name: Some("Heinrich".to_string()),
                surname: Some("Becker".to_string()),
                sex: Some("M".to_string()),
                birth_date: Some("1860-01-01".to_string()),
                birth_place: Some("Köln".to_string()),
                death_date: None,
                death_place: None,
                father_id: Some("B1".to_string()),
                mother_id: None,
                children_ids: vec![],
                spouses: vec![],
                parent_ids: vec!["B1".to_string()],
                proband_data: HashMap::new(),
                gedcom_extra: serde_json::json!({}),
            },
            // Isolated single person: S1 (Surname Froning, Place Münster -> connection hint!)
            Person {
                id: "S1".to_string(),
                given_name: Some("Franz".to_string()),
                surname: Some("Froning".to_string()),
                sex: Some("M".to_string()),
                birth_date: Some("1825-03-01".to_string()),
                birth_place: Some("Münster".to_string()),
                death_date: None,
                death_place: None,
                father_id: None,
                mother_id: None,
                children_ids: vec![],
                spouses: vec![],
                parent_ids: vec![],
                proband_data: HashMap::new(),
                gedcom_extra: serde_json::json!({}),
            },
        ];

        let result = find_isolated_branches(&persons, Some("I1")).unwrap();
        assert_eq!(result.total_persons, 6);
        assert_eq!(result.total_components, 3);
        assert_eq!(result.main_tree_person_count, 3);
        assert_eq!(result.isolated_branches_count, 1);
        assert_eq!(result.isolated_individuals_count, 1);
        assert_eq!(result.branches.len(), 2);

        // First branch should be Becker branch (2 persons)
        let b1 = &result.branches[0];
        assert_eq!(b1.person_count, 2);
        assert_eq!(b1.generation_depth, 2);
        assert_eq!(b1.name, "Zweig Becker");
        assert_eq!(b1.root_ancestors.len(), 1);
        assert_eq!(b1.root_ancestors[0].id, "B1");

        // Second branch should be single person S1
        let s1 = &result.branches[1];
        assert_eq!(s1.person_count, 1);
        assert_eq!(s1.generation_depth, 1);
        assert!(s1.name.contains("Franz Froning"));
        assert!(!s1.suggested_connections.is_empty());
        assert_eq!(s1.suggested_connections[0].isolated_person_id, "S1");
        assert!(s1.suggested_connections[0].confidence_score >= 65);
    }
}
