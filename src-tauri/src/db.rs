use rusqlite::{Connection, Result};
use std::path::Path;

pub fn init_database(db_path: &Path) -> Result<Connection> {
    let conn = Connection::open(db_path)?;

    conn.execute_batch("
        PRAGMA journal_mode = WAL;
        PRAGMA synchronous = NORMAL;
        PRAGMA foreign_keys = ON;
    ")?;

    setup_schema(conn)
}

pub fn init_in_memory_database() -> Result<Connection> {
    let conn = Connection::open_in_memory()?;
    conn.execute_batch("PRAGMA foreign_keys = ON;")?;
    setup_schema(conn)
}

fn setup_schema(conn: Connection) -> Result<Connection> {
    conn.execute_batch("
        CREATE TABLE IF NOT EXISTS individuals (
            id TEXT PRIMARY KEY,
            xref_id TEXT NOT NULL,
            given_name TEXT,
            surname TEXT,
            sex TEXT,
            henry_code TEXT, /* Legacy, wird nicht mehr primär für die Probanden-Logik genutzt */
            generation INTEGER DEFAULT 0,
            json_data TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS families (
            id TEXT PRIMARY KEY,
            xref_id TEXT NOT NULL,
            husband_id TEXT,
            wife_id TEXT,
            marriage_date TEXT,
            divorce_date TEXT,
            is_divorced BOOLEAN DEFAULT 0, /* NEU: Expliziter Status für Scheidung */
            json_data TEXT NOT NULL,
            FOREIGN KEY (husband_id) REFERENCES individuals(id) ON DELETE SET NULL,
            FOREIGN KEY (wife_id) REFERENCES individuals(id) ON DELETE SET NULL
        );

        CREATE TABLE IF NOT EXISTS parent_child (
            family_id TEXT NOT NULL,
            child_id TEXT NOT NULL,
            PRIMARY KEY (family_id, child_id),
            FOREIGN KEY (family_id) REFERENCES families(id) ON DELETE CASCADE,
            FOREIGN KEY (child_id) REFERENCES individuals(id) ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS events (
            id TEXT PRIMARY KEY,
            owner_id TEXT NOT NULL,
            owner_type TEXT NOT NULL,
            tag TEXT NOT NULL,
            date_str TEXT,
            place TEXT,
            json_data TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS root_ancestors (
            person_id TEXT PRIMARY KEY,
            starting_code TEXT NOT NULL,
            FOREIGN KEY(person_id) REFERENCES individuals(id) ON DELETE CASCADE
        );

        -- Speichert den Henry Code pro Person und Proband getrennt (n:m Beziehung)
        CREATE TABLE IF NOT EXISTS proband_henry_codes (
            proband_id TEXT NOT NULL,
            person_id TEXT NOT NULL,
            henry_code TEXT NOT NULL,
            generation INTEGER NOT NULL,
            PRIMARY KEY (proband_id, person_id),
            FOREIGN KEY(proband_id) REFERENCES root_ancestors(person_id) ON DELETE CASCADE,
            FOREIGN KEY(person_id) REFERENCES individuals(id) ON DELETE CASCADE
        );

        CREATE INDEX IF NOT EXISTS idx_individuals_henry ON individuals(henry_code);

        CREATE TABLE IF NOT EXISTS design_layouts (
            id TEXT PRIMARY KEY,
            proband_id TEXT NOT NULL,
            name TEXT NOT NULL,
            created_at TEXT NOT NULL,
            layout_data TEXT NOT NULL,
            layout_type TEXT DEFAULT 'master',
            anchor_person_id TEXT
        );
        CREATE INDEX IF NOT EXISTS idx_design_layouts_proband ON design_layouts(proband_id);

        CREATE TABLE IF NOT EXISTS latex_export_templates (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            created_at TEXT NOT NULL,
            config_data TEXT NOT NULL
        );
    ")?;

    // Migration für Individuals-Tabelle (Lebensdaten)
    let columns: Vec<String> = {
        let mut stmt = conn.prepare("PRAGMA table_info(individuals)")?;
        let rows = stmt.query_map([], |row| row.get::<_, String>(1))?;
        rows.filter_map(Result::ok).collect()
    };

    if !columns.contains(&"birth_date".to_string()) {
        conn.execute("ALTER TABLE individuals ADD COLUMN birth_date TEXT", [])?;
    }
    if !columns.contains(&"birth_place".to_string()) {
        conn.execute("ALTER TABLE individuals ADD COLUMN birth_place TEXT", [])?;
    }
    if !columns.contains(&"death_date".to_string()) {
        conn.execute("ALTER TABLE individuals ADD COLUMN death_date TEXT", [])?;
    }
    if !columns.contains(&"death_place".to_string()) {
        conn.execute("ALTER TABLE individuals ADD COLUMN death_place TEXT", [])?;
    }

    // Migration für Families-Tabelle (Ehe- und Scheidungsdaten)
    let fam_columns: Vec<String> = {
        let mut stmt = conn.prepare("PRAGMA table_info(families)")?;
        let rows = stmt.query_map([], |row| row.get::<_, String>(1))?;
        rows.filter_map(Result::ok).collect()
    };

    if !fam_columns.contains(&"marriage_date".to_string()) {
        conn.execute("ALTER TABLE families ADD COLUMN marriage_date TEXT", [])?;
    }
    if !fam_columns.contains(&"divorce_date".to_string()) {
        conn.execute("ALTER TABLE families ADD COLUMN divorce_date TEXT", [])?;
    }
    // NEU: Migration für das Scheidungs-Flag
    if !fam_columns.contains(&"is_divorced".to_string()) {
        conn.execute("ALTER TABLE families ADD COLUMN is_divorced BOOLEAN DEFAULT 0", [])?;
    }

    // Migration für design_layouts (layout_type, anchor_person_id)
    let dsg_columns: Vec<String> = {
        let mut stmt = conn.prepare("PRAGMA table_info(design_layouts)")?;
        let rows = stmt.query_map([], |row| row.get::<_, String>(1))?;
        rows.filter_map(Result::ok).collect()
    };
    if !dsg_columns.contains(&"layout_type".to_string()) {
        conn.execute("ALTER TABLE design_layouts ADD COLUMN layout_type TEXT DEFAULT 'master'", [])?;
    }
    if !dsg_columns.contains(&"anchor_person_id".to_string()) {
        conn.execute("ALTER TABLE design_layouts ADD COLUMN anchor_person_id TEXT", [])?;
    }

    Ok(conn)
}

/// Generiert den nächsten Henry-Code ohne Punkt (z.B. 1, 11, 1A)
pub fn generate_next_henry_code(parent_code: &str, child_index: usize) -> String {
    let suffix = match child_index {
        1..=9 => child_index.to_string(),
        10 => "A".to_string(),
        11 => "B".to_string(),
        12 => "C".to_string(),
        13 => "D".to_string(),
        14 => "E".to_string(),
        15 => "F".to_string(),
        16 => "G".to_string(),
        17 => "H".to_string(),
        18 => "I".to_string(),
        19 => "J".to_string(),
        20 => "K".to_string(),
        _ => format!("X{}", child_index),
    };

    if parent_code.is_empty() {
        suffix
    } else {
        format!("{}{}", parent_code, suffix)
    }
}

/// Ermittelt die nächste freie/inkrementelle XREF-ID für eine Person basierend auf dem höchsten vorhandenen Wert
pub fn get_next_individual_id(conn: &Connection) -> Result<String, String> {
    let mut stmt = conn
        .prepare("SELECT id FROM individuals")
        .map_err(|e| e.to_string())?;
    let ids: Vec<String> = stmt
        .query_map([], |r| r.get::<_, String>(0))
        .map_err(|e| e.to_string())?
        .filter_map(Result::ok)
        .collect();

    let mut max_num: Option<u64> = None;
    let mut best_prefix = "I".to_string();

    for id in &ids {
        let trimmed = id.trim().trim_matches('@');
        if let Some(digit_start) = trimmed.find(|c: char| c.is_ascii_digit()) {
            let (prefix, rest) = trimmed.split_at(digit_start);
            if rest.chars().all(|c| c.is_ascii_digit()) {
                if let Ok(num) = rest.parse::<u64>() {
                    match max_num {
                        None => {
                            max_num = Some(num);
                            best_prefix = prefix.to_string();
                        }
                        Some(curr_max) if num > curr_max => {
                            max_num = Some(num);
                            best_prefix = prefix.to_string();
                        }
                        _ => {}
                    }
                }
            }
        }
    }

    match max_num {
        Some(max) => Ok(format!("{}{}", best_prefix, max + 1)),
        None => Ok("I1".to_string()),
    }
}

