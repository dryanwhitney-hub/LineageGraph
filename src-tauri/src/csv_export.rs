use rusqlite::Connection;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::path::Path;

use crate::gedcom_export::{self, GedcomExportScope};
use crate::{get_all_persons_internal, Person};

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct CsvExportPreview {
    pub total_persons: usize,
    pub preview_text: String,
    pub full_content: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct CsvExportResult {
    pub total_persons: usize,
    pub file_path: String,
}

fn escape_csv_field(val: &str, delimiter: char) -> String {
    if val.contains(delimiter) || val.contains('"') || val.contains('\n') || val.contains('\r') {
        let escaped = val.replace('"', "\"\"");
        format!("\"{}\"", escaped)
    } else {
        val.to_string()
    }
}

pub fn generate_csv(
    conn: &Connection,
    scope: &GedcomExportScope,
    delimiter: char,
    include_bom: bool,
) -> Result<(String, usize), String> {
    let selected_ids = gedcom_export::resolve_scope_person_ids(conn, scope)?;
    let all_persons = get_all_persons_internal(conn)?;

    let name_map: HashMap<String, String> = all_persons
        .iter()
        .map(|p| {
            let sur = p.surname.as_deref().unwrap_or("N.N.");
            let giv = p.given_name.as_deref().unwrap_or("N.N.");
            (p.id.clone(), format!("{}, {}", sur, giv))
        })
        .collect();

    let filtered_persons: Vec<&Person> = all_persons
        .iter()
        .filter(|p| selected_ids.contains(&p.id))
        .collect();

    let total_persons = filtered_persons.len();

    let mut out = String::new();
    if include_bom {
        out.push('\u{FEFF}');
    }

    // Header-Zeile
    let headers = [
        "ID",
        "Nachname",
        "Vorname",
        "Geschlecht",
        "Geburtsdatum",
        "Geburtsort",
        "Sterbedatum",
        "Sterbeort",
        "Vater_ID",
        "Vater_Name",
        "Mutter_ID",
        "Mutter_Name",
        "Ehepartner",
        "Kinder",
        "Henry_Code",
        "Generation",
    ];

    let header_line = headers
        .iter()
        .map(|h| escape_csv_field(h, delimiter))
        .collect::<Vec<String>>()
        .join(&delimiter.to_string());

    out.push_str(&header_line);
    out.push('\n');

    for p in filtered_persons {
        let father_id = p.father_id.as_deref().unwrap_or("");
        let father_name = p
            .father_id
            .as_ref()
            .and_then(|id| name_map.get(id))
            .map(|s| s.as_str())
            .unwrap_or("");

        let mother_id = p.mother_id.as_deref().unwrap_or("");
        let mother_name = p
            .mother_id
            .as_ref()
            .and_then(|id| name_map.get(id))
            .map(|s| s.as_str())
            .unwrap_or("");

        // Ehepartner formatieren: Name (ID)
        let spouses_str = p
            .spouses
            .iter()
            .map(|sp| {
                let s_name = name_map.get(&sp.id).map(|s| s.as_str()).unwrap_or("N.N.");
                format!("{} ({})", s_name, sp.id)
            })
            .collect::<Vec<String>>()
            .join("; ");

        // Kinder formatieren: Name (ID)
        let children_str = p
            .children_ids
            .iter()
            .map(|cid| {
                let c_name = name_map.get(cid).map(|s| s.as_str()).unwrap_or("N.N.");
                format!("{} ({})", c_name, cid)
            })
            .collect::<Vec<String>>()
            .join("; ");

        // Henry Code & Generation
        let (henry, generation_str) = if let Some(first_proband) = p.proband_data.values().next() {
            (
                first_proband.henry_code.as_str(),
                first_proband.generation.to_string(),
            )
        } else {
            ("", "".to_string())
        };

        let row = [
            escape_csv_field(&p.id, delimiter),
            escape_csv_field(p.surname.as_deref().unwrap_or(""), delimiter),
            escape_csv_field(p.given_name.as_deref().unwrap_or(""), delimiter),
            escape_csv_field(p.sex.as_deref().unwrap_or(""), delimiter),
            escape_csv_field(p.birth_date.as_deref().unwrap_or(""), delimiter),
            escape_csv_field(p.birth_place.as_deref().unwrap_or(""), delimiter),
            escape_csv_field(p.death_date.as_deref().unwrap_or(""), delimiter),
            escape_csv_field(p.death_place.as_deref().unwrap_or(""), delimiter),
            escape_csv_field(father_id, delimiter),
            escape_csv_field(father_name, delimiter),
            escape_csv_field(mother_id, delimiter),
            escape_csv_field(mother_name, delimiter),
            escape_csv_field(&spouses_str, delimiter),
            escape_csv_field(&children_str, delimiter),
            escape_csv_field(henry, delimiter),
            escape_csv_field(&generation_str, delimiter),
        ];

        out.push_str(&row.join(&delimiter.to_string()));
        out.push('\n');
    }

    Ok((out, total_persons))
}

pub fn export_csv_to_file(
    conn: &Connection,
    file_path: &Path,
    scope: &GedcomExportScope,
    delimiter: char,
    include_bom: bool,
) -> Result<CsvExportResult, String> {
    let (content, total_persons) = generate_csv(conn, scope, delimiter, include_bom)?;
    fs::write(file_path, content.as_bytes())
        .map_err(|e| format!("Fehler beim Schreiben der CSV-Datei: {}", e))?;
    Ok(CsvExportResult {
        total_persons,
        file_path: file_path.to_string_lossy().to_string(),
    })
}
