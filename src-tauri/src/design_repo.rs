use aes_gcm::{
    aead::{Aead, KeyInit},
    Aes256Gcm, Nonce,
};
use base64::{engine::general_purpose::STANDARD as B64, Engine as _};
use hmac::Hmac;
use pbkdf2::pbkdf2;
use rand::RngCore;
use rusqlite::{params, Connection, Transaction};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::{HashMap, HashSet, VecDeque};
use std::fs;
use std::path::Path;

const LGPROJ_MAGIC: &[u8; 8] = b"LGPROJ01";
const PBKDF2_ITERS: u32 = 100_000;

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct MediaAssetMetaDto {
    pub id: String,
    pub file_name: String,
    pub mime_type: String,
    pub width: i32,
    pub height: i32,
    pub byte_size: i64,
    pub created_at: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct PersonDesignRuleDto {
    pub person_id: String,
    pub is_hidden: bool,
    pub custom_group_key: Option<String>,
    pub level_offset: i32,
    pub implex_active_parent_id: Option<String>,
    pub split_children_by_marriage: bool,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct GroupDesignRuleDto {
    pub group_key: String,
    pub anchor_parent_id: Option<String>,
    pub max_columns_per_row: Option<i32>,
    pub relative_delta_x: f64,
    pub dock_target_group_key: Option<String>,
    pub custom_member_ids: Option<Vec<String>>,
    pub level_override: Option<i32>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct SubtreeMountRuleDto {
    pub anchor_person_id: String,
    pub sub_document_id: String,
    pub display_mode: String, // "inline" | "capsule"
    pub relative_delta_x: f64,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct EdgeWaypointRuleDto {
    pub edge_key: String,
    pub parent_person_id: String,
    pub lane_offset_delta: f64,
    pub vertical_channel_delta_x: f64,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct DesignDocumentDto {
    pub id: String,
    pub name: String,
    pub root_person_id: String,
    pub document_kind: String,    // "master" | "subtree"
    pub growth_direction: String, // "bottom_up" | "top_down"
    pub lineage_policy: String,   // "patrilinear" | "matrilinear" | "oldest_branch"
    pub routing_style: String,    // "orthogonal_bus" | "organic_bezier"
    pub enable_line_bridges: bool,
    pub card_density_profile: String, // "detail" | "standard" | "compact_years" | "narrow"
    pub card_config_json: String,
    pub bg_asset_id: Option<String>,
    pub bg_config_json: Option<String>,
    pub created_at: String,
    pub updated_at: String,
    pub person_rules: Vec<PersonDesignRuleDto>,
    pub group_rules: Vec<GroupDesignRuleDto>,
    pub subtree_mounts: Vec<SubtreeMountRuleDto>,
    pub edge_waypoints: Vec<EdgeWaypointRuleDto>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct DesignDocumentSummaryDto {
    pub id: String,
    pub name: String,
    pub root_person_id: String,
    pub document_kind: String,
    pub growth_direction: String,
    pub lineage_policy: String,
    pub card_density_profile: String,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct DesignTreeBundleDto {
    pub root_document: DesignDocumentDto,
    pub sub_documents: HashMap<String, DesignDocumentDto>,
    pub media_assets: HashMap<String, String>,
    pub media_metas: HashMap<String, MediaAssetMetaDto>,
}

fn sha256_hex(data: &[u8]) -> String {
    let mut hasher = Sha256::new();
    hasher.update(data);
    let digest = hasher.finalize();
    let mut hex = String::with_capacity(digest.len() * 2);
    for b in digest {
        use std::fmt::Write;
        let _ = write!(&mut hex, "{:02x}", b);
    }
    hex
}

pub fn store_media_asset_bytes(
    conn: &Connection,
    file_name: &str,
    mime_type: &str,
    width: i32,
    height: i32,
    data: &[u8],
) -> Result<MediaAssetMetaDto, String> {
    if data.is_empty() {
        return Err("Bilddatei ist leer.".to_string());
    }
    let hash_id = sha256_hex(data);
    let now = chrono::Utc::now().to_rfc3339();
    let byte_size = data.len() as i64;

    conn.execute(
        "INSERT OR IGNORE INTO media_assets (id, file_name, mime_type, width, height, byte_size, data, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
        params![hash_id, file_name, mime_type, width, height, byte_size, data, now],
    )
    .map_err(|e| e.to_string())?;

    conn.query_row(
        "SELECT id, file_name, mime_type, width, height, byte_size, created_at FROM media_assets WHERE id = ?1",
        [&hash_id],
        |r| {
            Ok(MediaAssetMetaDto {
                id: r.get(0)?,
                file_name: r.get(1)?,
                mime_type: r.get(2)?,
                width: r.get(3)?,
                height: r.get(4)?,
                byte_size: r.get(5)?,
                created_at: r.get(6)?,
            })
        },
    )
    .map_err(|e| e.to_string())
}

pub fn store_media_asset_from_data_url(
    conn: &Connection,
    file_name: &str,
    data_url: &str,
    width: i32,
    height: i32,
) -> Result<MediaAssetMetaDto, String> {
    let trimmed = data_url.trim();
    if !trimmed.starts_with("data:") {
        return Err("Ungültige Data-URL für Media-Asset.".to_string());
    }
    let comma_idx = trimmed
        .find(',')
        .ok_or_else(|| "Fehlendes Komma in Data-URL.".to_string())?;
    let header = &trimmed[5..comma_idx];
    let payload_str = &trimmed[comma_idx + 1..];

    let mime_type = header
        .split(';')
        .next()
        .filter(|s| !s.is_empty())
        .unwrap_or("application/octet-stream");

    let bytes = if header.contains(";base64") {
        B64.decode(payload_str)
            .map_err(|e| format!("Base64-Dekodierung fehlgeschlagen: {}", e))?
    } else {
        payload_str.as_bytes().to_vec()
    };

    store_media_asset_bytes(conn, file_name, mime_type, width, height, &bytes)
}

pub fn get_media_asset_data_url(
    conn: &Connection,
    asset_id: &str,
) -> Result<Option<(MediaAssetMetaDto, String)>, String> {
    let row = conn.query_row(
        "SELECT id, file_name, mime_type, width, height, byte_size, data, created_at FROM media_assets WHERE id = ?1",
        [asset_id],
        |r| {
            let meta = MediaAssetMetaDto {
                id: r.get(0)?,
                file_name: r.get(1)?,
                mime_type: r.get(2)?,
                width: r.get(3)?,
                height: r.get(4)?,
                byte_size: r.get(5)?,
                created_at: r.get(7)?,
            };
            let blob: Vec<u8> = r.get(6)?;
            Ok((meta, blob))
        },
    );

    match row {
        Ok((meta, blob)) => {
            let encoded = B64.encode(&blob);
            let data_url = format!("data:{};base64,{}", meta.mime_type, encoded);
            Ok(Some((meta, data_url)))
        }
        Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
        Err(e) => Err(e.to_string()),
    }
}

pub fn list_design_documents(
    conn: &Connection,
    root_person_id: Option<&str>,
    document_kind: Option<&str>,
) -> Result<Vec<DesignDocumentSummaryDto>, String> {
    let mut sql = String::from(
        "SELECT id, name, root_person_id, document_kind, growth_direction, lineage_policy, card_density_profile, created_at, updated_at
         FROM design_documents WHERE 1=1",
    );
    let mut param_vals: Vec<String> = Vec::new();
    if let Some(rid) = root_person_id.filter(|s| !s.trim().is_empty()) {
        param_vals.push(rid.trim().to_string());
        sql.push_str(&format!(" AND root_person_id = ?{}", param_vals.len()));
    }
    if let Some(kind) = document_kind.filter(|s| !s.trim().is_empty()) {
        param_vals.push(kind.trim().to_string());
        sql.push_str(&format!(" AND document_kind = ?{}", param_vals.len()));
    }
    sql.push_str(" ORDER BY updated_at DESC, created_at DESC");

    let mut stmt = conn.prepare(&sql).map_err(|e| e.to_string())?;
    let rows = match param_vals.len() {
        0 => stmt.query_map([], map_summary_row),
        1 => stmt.query_map([&param_vals[0]], map_summary_row),
        _ => stmt.query_map([&param_vals[0], &param_vals[1]], map_summary_row),
    }
    .map_err(|e| e.to_string())?;

    rows.collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())
}

fn map_summary_row(r: &rusqlite::Row<'_>) -> rusqlite::Result<DesignDocumentSummaryDto> {
    Ok(DesignDocumentSummaryDto {
        id: r.get(0)?,
        name: r.get(1)?,
        root_person_id: r.get(2)?,
        document_kind: r.get(3)?,
        growth_direction: r.get(4)?,
        lineage_policy: r.get(5)?,
        card_density_profile: r.get(6)?,
        created_at: r.get(7)?,
        updated_at: r.get(8)?,
    })
}

pub fn load_design_document(conn: &Connection, document_id: &str) -> Result<DesignDocumentDto, String> {
    let mut doc = conn
        .query_row(
            "SELECT id, name, root_person_id, document_kind, growth_direction, lineage_policy,
                    routing_style, enable_line_bridges, card_density_profile, card_config_json,
                    bg_asset_id, bg_config_json, created_at, updated_at
             FROM design_documents WHERE id = ?1",
            [document_id],
            |r| {
                Ok(DesignDocumentDto {
                    id: r.get(0)?,
                    name: r.get(1)?,
                    root_person_id: r.get(2)?,
                    document_kind: r.get(3)?,
                    growth_direction: r.get(4)?,
                    lineage_policy: r.get(5)?,
                    routing_style: r.get(6)?,
                    enable_line_bridges: r.get::<_, i32>(7)? != 0,
                    card_density_profile: r.get(8)?,
                    card_config_json: r.get(9)?,
                    bg_asset_id: r.get(10)?,
                    bg_config_json: r.get(11)?,
                    created_at: r.get(12)?,
                    updated_at: r.get(13)?,
                    person_rules: Vec::new(),
                    group_rules: Vec::new(),
                    subtree_mounts: Vec::new(),
                    edge_waypoints: Vec::new(),
                })
            },
        )
        .map_err(|e| format!("Design-Dokument '{}' nicht gefunden: {}", document_id, e))?;

    {
        let mut stmt = conn
            .prepare(
                "SELECT person_id, is_hidden, custom_group_key, level_offset, implex_active_parent_id, split_children_by_marriage
                 FROM design_person_rules WHERE document_id = ?1",
            )
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map([document_id], |r| {
                Ok(PersonDesignRuleDto {
                    person_id: r.get(0)?,
                    is_hidden: r.get::<_, i32>(1)? != 0,
                    custom_group_key: r.get(2)?,
                    level_offset: r.get(3)?,
                    implex_active_parent_id: r.get(4)?,
                    split_children_by_marriage: r.get::<_, i32>(5)? != 0,
                })
            })
            .map_err(|e| e.to_string())?;
        doc.person_rules = rows.collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())?;
    }

    {
        let mut stmt = conn
            .prepare(
                "SELECT group_key, anchor_parent_id, max_columns_per_row, relative_delta_x,
                        dock_target_group_key, custom_member_ids_json, level_override
                 FROM design_group_rules WHERE document_id = ?1",
            )
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map([document_id], |r| {
                let members_json: Option<String> = r.get(5)?;
                let custom_member_ids = members_json
                    .as_deref()
                    .and_then(|s| serde_json::from_str::<Vec<String>>(s).ok());
                Ok(GroupDesignRuleDto {
                    group_key: r.get(0)?,
                    anchor_parent_id: r.get(1)?,
                    max_columns_per_row: r.get(2)?,
                    relative_delta_x: r.get(3)?,
                    dock_target_group_key: r.get(4)?,
                    custom_member_ids,
                    level_override: r.get(6)?,
                })
            })
            .map_err(|e| e.to_string())?;
        doc.group_rules = rows.collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())?;
    }

    {
        let mut stmt = conn
            .prepare(
                "SELECT anchor_person_id, sub_document_id, display_mode, relative_delta_x
                 FROM design_subtree_mounts WHERE parent_document_id = ?1",
            )
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map([document_id], |r| {
                Ok(SubtreeMountRuleDto {
                    anchor_person_id: r.get(0)?,
                    sub_document_id: r.get(1)?,
                    display_mode: r.get(2)?,
                    relative_delta_x: r.get(3)?,
                })
            })
            .map_err(|e| e.to_string())?;
        doc.subtree_mounts = rows.collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())?;
    }

    {
        let mut stmt = conn
            .prepare(
                "SELECT edge_key, parent_person_id, lane_offset_delta, vertical_channel_delta_x
                 FROM design_edge_waypoints WHERE document_id = ?1",
            )
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map([document_id], |r| {
                Ok(EdgeWaypointRuleDto {
                    edge_key: r.get(0)?,
                    parent_person_id: r.get(1)?,
                    lane_offset_delta: r.get(2)?,
                    vertical_channel_delta_x: r.get(3)?,
                })
            })
            .map_err(|e| e.to_string())?;
        doc.edge_waypoints = rows.collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())?;
    }

    Ok(doc)
}

pub fn load_design_tree_bundle(
    conn: &Connection,
    document_id: &str,
) -> Result<DesignTreeBundleDto, String> {
    let root_document = load_design_document(conn, document_id)?;
    let mut sub_documents: HashMap<String, DesignDocumentDto> = HashMap::new();
    let mut media_assets: HashMap<String, String> = HashMap::new();
    let mut media_metas: HashMap<String, MediaAssetMetaDto> = HashMap::new();

    let mut visited: HashSet<String> = HashSet::new();
    visited.insert(root_document.id.clone());

    let mut asset_ids_to_load: HashSet<String> = HashSet::new();
    if let Some(ref aid) = root_document.bg_asset_id {
        asset_ids_to_load.insert(aid.clone());
    }

    let mut queue: VecDeque<String> = VecDeque::new();
    for m in &root_document.subtree_mounts {
        if !visited.contains(&m.sub_document_id) {
            queue.push_back(m.sub_document_id.clone());
        }
    }

    while let Some(sub_id) = queue.pop_front() {
        if visited.contains(&sub_id) {
            continue;
        }
        visited.insert(sub_id.clone());
        if let Ok(sub_doc) = load_design_document(conn, &sub_id) {
            if let Some(ref aid) = sub_doc.bg_asset_id {
                asset_ids_to_load.insert(aid.clone());
            }
            for m in &sub_doc.subtree_mounts {
                if !visited.contains(&m.sub_document_id) {
                    queue.push_back(m.sub_document_id.clone());
                }
            }
            sub_documents.insert(sub_id, sub_doc);
        }
    }

    for aid in asset_ids_to_load {
        if let Ok(Some((meta, data_url))) = get_media_asset_data_url(conn, &aid) {
            media_assets.insert(aid.clone(), data_url);
            media_metas.insert(aid, meta);
        }
    }

    Ok(DesignTreeBundleDto {
        root_document,
        sub_documents,
        media_assets,
        media_metas,
    })
}

fn check_subtree_mount_cycle(
    conn: &Connection,
    doc_id: &str,
    direct_children: &[SubtreeMountRuleDto],
) -> Result<(), String> {
    let mut visited: HashSet<String> = HashSet::new();
    let mut queue: VecDeque<String> = VecDeque::new();
    for m in direct_children {
        if m.sub_document_id == doc_id {
            return Err("Zyklische Sub-Baum-Einbindung erkannt (Selbstreferenz).".to_string());
        }
        queue.push_back(m.sub_document_id.clone());
    }

    while let Some(cur) = queue.pop_front() {
        if !visited.insert(cur.clone()) {
            continue;
        }
        let mut stmt = conn
            .prepare("SELECT sub_document_id FROM design_subtree_mounts WHERE parent_document_id = ?1")
            .map_err(|e| e.to_string())?;
        let children: Vec<String> = stmt
            .query_map([&cur], |r| r.get::<_, String>(0))
            .map_err(|e| e.to_string())?
            .filter_map(Result::ok)
            .collect();
        for child_id in children {
            if child_id == doc_id {
                return Err("Zyklische Sub-Baum-Einbindung verhindert: Ziel-Sub-Baum bindet diesen Baum bereits ein.".to_string());
            }
            if !visited.contains(&child_id) {
                queue.push_back(child_id);
            }
        }
    }
    Ok(())
}

pub fn save_design_document(
    conn: &mut Connection,
    doc: DesignDocumentDto,
    overwrite_same_name: bool,
) -> Result<DesignDocumentSummaryDto, String> {
    save_design_document_checked(conn, doc, overwrite_same_name, None, true)
}

/// Saves a design document inside an IMMEDIATE transaction with optional optimistic locking
/// against `expected_updated_at` to prevent blind overwrites across concurrent clients.
pub fn save_design_document_checked(
    conn: &mut Connection,
    mut doc: DesignDocumentDto,
    overwrite_same_name: bool,
    expected_updated_at: Option<&str>,
    force_overwrite: bool,
) -> Result<DesignDocumentSummaryDto, String> {
    let trimmed_name = doc.name.trim().to_string();
    if trimmed_name.is_empty() {
        return Err("Design-Name darf nicht leer sein.".to_string());
    }
    doc.name = trimmed_name;

    let person_exists: bool = conn
        .query_row(
            "SELECT count(*) FROM individuals WHERE id = ?1",
            [&doc.root_person_id],
            |r| r.get::<_, i64>(0),
        )
        .map_err(|e| e.to_string())?
        > 0;
    if !person_exists {
        return Err(format!(
            "Spitzenahn / Ankerperson '{}' existiert nicht in der Datenbank.",
            doc.root_person_id
        ));
    }

    let now = chrono::Utc::now().to_rfc3339();
    if doc.created_at.trim().is_empty() {
        doc.created_at = now.clone();
    }
    doc.updated_at = now;

    if doc.id.trim().is_empty() {
        if overwrite_same_name {
            let existing: Option<String> = conn
                .query_row(
                    "SELECT id FROM design_documents WHERE root_person_id = ?1 AND name = ?2 AND document_kind = ?3 LIMIT 1",
                    params![doc.root_person_id, doc.name, doc.document_kind],
                    |r| r.get(0),
                )
                .ok();
            doc.id = existing.unwrap_or_else(|| uuid::Uuid::new_v4().to_string());
        } else {
            doc.id = uuid::Uuid::new_v4().to_string();
        }
    }

    check_subtree_mount_cycle(conn, &doc.id, &doc.subtree_mounts)?;

    let tx = crate::db::begin_write_tx(conn).map_err(|e| e.to_string())?;

    if !force_overwrite {
        if let Some(exp) = expected_updated_at.map(str::trim).filter(|s| !s.is_empty()) {
            let current_db_updated: Option<String> = tx
                .query_row(
                    "SELECT updated_at FROM design_documents WHERE id = ?1",
                    [&doc.id],
                    |r| r.get(0),
                )
                .ok();
            if let Some(ref db_ts) = current_db_updated {
                if db_ts != exp {
                    return Err(format!("DESIGN_CONFLICT:{}", db_ts));
                }
            }
        }
    }

    tx.execute(
        "INSERT INTO design_documents (
            id, name, root_person_id, document_kind, growth_direction, lineage_policy,
            routing_style, enable_line_bridges, card_density_profile, card_config_json,
            bg_asset_id, bg_config_json, created_at, updated_at
        ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14)
        ON CONFLICT(id) DO UPDATE SET
            name = excluded.name,
            root_person_id = excluded.root_person_id,
            document_kind = excluded.document_kind,
            growth_direction = excluded.growth_direction,
            lineage_policy = excluded.lineage_policy,
            routing_style = excluded.routing_style,
            enable_line_bridges = excluded.enable_line_bridges,
            card_density_profile = excluded.card_density_profile,
            card_config_json = excluded.card_config_json,
            bg_asset_id = excluded.bg_asset_id,
            bg_config_json = excluded.bg_config_json,
            updated_at = excluded.updated_at",
        params![
            doc.id,
            doc.name,
            doc.root_person_id,
            doc.document_kind,
            doc.growth_direction,
            doc.lineage_policy,
            doc.routing_style,
            if doc.enable_line_bridges { 1 } else { 0 },
            doc.card_density_profile,
            doc.card_config_json,
            doc.bg_asset_id,
            doc.bg_config_json,
            doc.created_at,
            doc.updated_at
        ],
    )
    .map_err(|e| e.to_string())?;

    tx.execute("DELETE FROM design_person_rules WHERE document_id = ?1", [&doc.id])
        .map_err(|e| e.to_string())?;
    for pr in &doc.person_rules {
        let p_ok: bool = tx
            .query_row("SELECT count(*) FROM individuals WHERE id = ?1", [&pr.person_id], |r| r.get::<_, i64>(0))
            .unwrap_or(0)
            > 0;
        if !p_ok {
            continue;
        }
        let imp_parent = pr.implex_active_parent_id.as_ref().filter(|pid| {
            tx.query_row("SELECT count(*) FROM individuals WHERE id = ?1", [pid], |r| r.get::<_, i64>(0))
                .unwrap_or(0)
                > 0
        });
        tx.execute(
            "INSERT INTO design_person_rules (
                document_id, person_id, is_hidden, custom_group_key, level_offset,
                implex_active_parent_id, split_children_by_marriage
            ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
            params![
                doc.id,
                pr.person_id,
                if pr.is_hidden { 1 } else { 0 },
                pr.custom_group_key,
                pr.level_offset,
                imp_parent,
                if pr.split_children_by_marriage { 1 } else { 0 }
            ],
        )
        .map_err(|e| e.to_string())?;
    }

    tx.execute("DELETE FROM design_group_rules WHERE document_id = ?1", [&doc.id])
        .map_err(|e| e.to_string())?;
    for gr in &doc.group_rules {
        let anchor_parent = gr.anchor_parent_id.as_ref().filter(|pid| {
            tx.query_row("SELECT count(*) FROM individuals WHERE id = ?1", [pid], |r| r.get::<_, i64>(0))
                .unwrap_or(0)
                > 0
        });
        let members_json = gr
            .custom_member_ids
            .as_ref()
            .and_then(|v| serde_json::to_string(v).ok());
        tx.execute(
            "INSERT INTO design_group_rules (
                document_id, group_key, anchor_parent_id, max_columns_per_row,
                relative_delta_x, dock_target_group_key, custom_member_ids_json, level_override
            ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
            params![
                doc.id,
                gr.group_key,
                anchor_parent,
                gr.max_columns_per_row,
                gr.relative_delta_x,
                gr.dock_target_group_key,
                members_json,
                gr.level_override
            ],
        )
        .map_err(|e| e.to_string())?;
    }

    tx.execute("DELETE FROM design_subtree_mounts WHERE parent_document_id = ?1", [&doc.id])
        .map_err(|e| e.to_string())?;
    for m in &doc.subtree_mounts {
        let anchor_ok: bool = tx
            .query_row("SELECT count(*) FROM individuals WHERE id = ?1", [&m.anchor_person_id], |r| r.get::<_, i64>(0))
            .unwrap_or(0)
            > 0;
        let sub_ok: bool = tx
            .query_row("SELECT count(*) FROM design_documents WHERE id = ?1", [&m.sub_document_id], |r| r.get::<_, i64>(0))
            .unwrap_or(0)
            > 0;
        if !anchor_ok || !sub_ok {
            continue;
        }
        tx.execute(
            "INSERT INTO design_subtree_mounts (
                parent_document_id, anchor_person_id, sub_document_id, display_mode, relative_delta_x
            ) VALUES (?1, ?2, ?3, ?4, ?5)",
            params![
                doc.id,
                m.anchor_person_id,
                m.sub_document_id,
                m.display_mode,
                m.relative_delta_x
            ],
        )
        .map_err(|e| e.to_string())?;
    }

    tx.execute("DELETE FROM design_edge_waypoints WHERE document_id = ?1", [&doc.id])
        .map_err(|e| e.to_string())?;
    for wp in &doc.edge_waypoints {
        let p_ok: bool = tx
            .query_row("SELECT count(*) FROM individuals WHERE id = ?1", [&wp.parent_person_id], |r| r.get::<_, i64>(0))
            .unwrap_or(0)
            > 0;
        if !p_ok {
            continue;
        }
        tx.execute(
            "INSERT INTO design_edge_waypoints (
                document_id, edge_key, parent_person_id, lane_offset_delta, vertical_channel_delta_x
            ) VALUES (?1, ?2, ?3, ?4, ?5)",
            params![
                doc.id,
                wp.edge_key,
                wp.parent_person_id,
                wp.lane_offset_delta,
                wp.vertical_channel_delta_x
            ],
        )
        .map_err(|e| e.to_string())?;
    }

    tx.commit().map_err(|e| e.to_string())?;

    Ok(DesignDocumentSummaryDto {
        id: doc.id,
        name: doc.name,
        root_person_id: doc.root_person_id,
        document_kind: doc.document_kind,
        growth_direction: doc.growth_direction,
        lineage_policy: doc.lineage_policy,
        card_density_profile: doc.card_density_profile,
        created_at: doc.created_at,
        updated_at: doc.updated_at,
    })
}

pub fn delete_design_document(conn: &Connection, document_id: &str) -> Result<(), String> {
    conn.execute("DELETE FROM design_documents WHERE id = ?1", [document_id])
        .map_err(|e| e.to_string())?;
    Ok(())
}

/// Migriert verlustfrei etwaige Altdaten aus `design_layouts` in das neue relationale Design-Schema.
pub fn migrate_legacy_design_layouts(conn: &Connection) -> Result<(), String> {
    let mut stmt = match conn.prepare(
        "SELECT id, proband_id, name, created_at, layout_data, COALESCE(layout_type, 'master'), anchor_person_id
         FROM design_layouts
         WHERE id NOT IN (SELECT id FROM design_documents)",
    ) {
        Ok(s) => s,
        Err(_) => return Ok(()),
    };

    let legacy_rows: Vec<(String, String, String, String, String, String, Option<String>)> = stmt
        .query_map([], |r| {
            Ok((
                r.get(0)?,
                r.get(1)?,
                r.get(2)?,
                r.get(3)?,
                r.get(4)?,
                r.get(5)?,
                r.get(6)?,
            ))
        })
        .map_err(|e| e.to_string())?
        .filter_map(Result::ok)
        .collect();

    if legacy_rows.is_empty() {
        return Ok(());
    }

    struct PendingMount {
        parent_doc_id: String,
        anchor_person_id: String,
        sub_doc_id: String,
    }
    let mut pending_mounts: Vec<PendingMount> = Vec::new();

    for (id, proband_id, name, created_at, layout_data, layout_type, anchor_person_id) in legacy_rows {
        let doc_kind = if layout_type == "subtree" { "subtree" } else { "master" };
        let root_id = if doc_kind == "subtree" {
            anchor_person_id.clone().unwrap_or_else(|| proband_id.clone())
        } else {
            proband_id.clone()
        };

        let root_exists: bool = conn
            .query_row("SELECT count(*) FROM individuals WHERE id = ?1", [&root_id], |r| r.get::<_, i64>(0))
            .unwrap_or(0)
            > 0;
        if !root_exists {
            continue;
        }

        let parsed: serde_json::Value = serde_json::from_str(&layout_data).unwrap_or_else(|_| serde_json::json!({}));

        let card_config_json = parsed
            .get("cardConfig")
            .map(|v| serde_json::to_string(v).unwrap_or_else(|_| "{}".to_string()))
            .unwrap_or_else(|| "{}".to_string());

        let mut bg_asset_id: Option<String> = None;
        let bg_config_val = parsed.get("backgroundConfig").cloned();
        let bg_config_json = bg_config_val
            .as_ref()
            .and_then(|v| serde_json::to_string(v).ok());

        if let Some(bg_data_url) = parsed.get("backgroundImageData").and_then(|v| v.as_str()) {
            if !bg_data_url.trim().is_empty() {
                let fname = bg_config_val
                    .as_ref()
                    .and_then(|v| v.get("fileName"))
                    .and_then(|v| v.as_str())
                    .unwrap_or("background.png");
                let w = bg_config_val
                    .as_ref()
                    .and_then(|v| v.get("naturalWidth"))
                    .and_then(|v| v.as_i64())
                    .unwrap_or(0) as i32;
                let h = bg_config_val
                    .as_ref()
                    .and_then(|v| v.get("naturalHeight"))
                    .and_then(|v| v.as_i64())
                    .unwrap_or(0) as i32;
                if let Ok(meta) = store_media_asset_from_data_url(conn, fname, bg_data_url, w, h) {
                    bg_asset_id = Some(meta.id);
                }
            }
        }

        let _ = conn.execute(
            "INSERT OR IGNORE INTO design_documents (
                id, name, root_person_id, document_kind, growth_direction, lineage_policy,
                routing_style, enable_line_bridges, card_density_profile, card_config_json,
                bg_asset_id, bg_config_json, created_at, updated_at
            ) VALUES (?1, ?2, ?3, ?4, 'bottom_up', 'patrilinear', 'orthogonal_bus', 1, 'standard', ?5, ?6, ?7, ?8, ?8)",
            params![id, name, root_id, doc_kind, card_config_json, bg_asset_id, bg_config_json, created_at],
        );

        if let Some(groups) = parsed.get("siblingGroups").and_then(|v| v.as_array()) {
            for g in groups {
                let g_id = g.get("id").and_then(|v| v.as_str()).unwrap_or("");
                if g_id.is_empty() {
                    continue;
                }
                let is_hidden = g.get("isHidden").and_then(|v| v.as_bool()).unwrap_or(false);
                let parent_id = g.get("parentId").and_then(|v| v.as_str()).map(|s| s.to_string());
                let level = g.get("level").and_then(|v| v.as_i64()).map(|n| n as i32);
                let members: Vec<String> = g
                    .get("memberIds")
                    .and_then(|v| v.as_array())
                    .map(|arr| {
                        arr.iter()
                            .filter_map(|x| x.as_str().map(|s| s.to_string()))
                            .collect()
                    })
                    .unwrap_or_default();

                if is_hidden {
                    for mid in &members {
                        let p_ok = conn
                            .query_row("SELECT count(*) FROM individuals WHERE id = ?1", [mid], |r| r.get::<_, i64>(0))
                            .unwrap_or(0)
                            > 0;
                        if p_ok {
                            let _ = conn.execute(
                                "INSERT OR IGNORE INTO design_person_rules (document_id, person_id, is_hidden, custom_group_key, level_offset, split_children_by_marriage)
                                 VALUES (?1, ?2, 1, ?3, 0, 0)",
                                params![id, mid, g_id],
                            );
                        }
                    }
                }

                let rel_dx = g
                    .get("manualDeltaX")
                    .and_then(|v| v.as_f64())
                    .unwrap_or(0.0);
                let valid_parent = parent_id.filter(|pid| {
                    conn.query_row("SELECT count(*) FROM individuals WHERE id = ?1", [pid], |r| r.get::<_, i64>(0))
                        .unwrap_or(0)
                        > 0
                });
                let members_json = serde_json::to_string(&members).ok();
                let _ = conn.execute(
                    "INSERT OR IGNORE INTO design_group_rules (document_id, group_key, anchor_parent_id, max_columns_per_row, relative_delta_x, custom_member_ids_json, level_override)
                     VALUES (?1, ?2, ?3, NULL, ?4, ?5, ?6)",
                    params![id, g_id, valid_parent, rel_dx, members_json, level],
                );
            }
        }

        if let Some(refs) = parsed.get("subLayoutReferences").and_then(|v| v.as_array()) {
            for r in refs {
                if let (Some(sub_id), Some(anchor)) = (
                    r.get("layoutId").and_then(|v| v.as_str()),
                    r.get("anchorPersonId").and_then(|v| v.as_str()),
                ) {
                    pending_mounts.push(PendingMount {
                        parent_doc_id: id.clone(),
                        anchor_person_id: anchor.to_string(),
                        sub_doc_id: sub_id.to_string(),
                    });
                }
            }
        }
    }

    for pm in pending_mounts {
        let sub_exists = conn
            .query_row("SELECT count(*) FROM design_documents WHERE id = ?1", [&pm.sub_doc_id], |r| r.get::<_, i64>(0))
            .unwrap_or(0)
            > 0;
        let anchor_exists = conn
            .query_row("SELECT count(*) FROM individuals WHERE id = ?1", [&pm.anchor_person_id], |r| r.get::<_, i64>(0))
            .unwrap_or(0)
            > 0;
        if sub_exists && anchor_exists && pm.parent_doc_id != pm.sub_doc_id {
            let _ = conn.execute(
                "INSERT OR IGNORE INTO design_subtree_mounts (parent_document_id, anchor_person_id, sub_document_id, display_mode, relative_delta_x)
                 VALUES (?1, ?2, ?3, 'inline', 0.0)",
                params![pm.parent_doc_id, pm.anchor_person_id, pm.sub_doc_id],
            );
        }
    }

    Ok(())
}

/// Aktualisiert Design-Referenzen während eines 2-Phasen-ID-Tauschs (wenn PRAGMA foreign_keys = OFF aktiv ist).
pub fn rename_person_design_references(
    conn: &Connection,
    from_id: &str,
    to_id: &str,
) -> Result<(), String> {
    let queries = [
        "UPDATE design_documents SET root_person_id = ?1 WHERE root_person_id = ?2",
        "UPDATE design_person_rules SET person_id = ?1 WHERE person_id = ?2",
        "UPDATE design_person_rules SET implex_active_parent_id = ?1 WHERE implex_active_parent_id = ?2",
        "UPDATE design_group_rules SET anchor_parent_id = ?1 WHERE anchor_parent_id = ?2",
        "UPDATE design_subtree_mounts SET anchor_person_id = ?1 WHERE anchor_person_id = ?2",
        "UPDATE design_edge_waypoints SET parent_person_id = ?1 WHERE parent_person_id = ?2",
    ];
    for sql in queries {
        conn.execute(sql, params![to_id, from_id])
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// Überträgt Design-Regeln bei einer Personen-Zusammenführung (`merge_persons_internal`) von `source_id` auf `target_id`.
pub fn reconcile_design_on_person_merge(
    tx: &Transaction,
    target_id: &str,
    source_id: &str,
) -> Result<(), String> {
    tx.execute(
        "UPDATE design_documents SET root_person_id = ?1 WHERE root_person_id = ?2",
        params![target_id, source_id],
    )
    .map_err(|e| e.to_string())?;

    tx.execute(
        "UPDATE OR IGNORE design_person_rules SET person_id = ?1 WHERE person_id = ?2",
        params![target_id, source_id],
    )
    .map_err(|e| e.to_string())?;
    tx.execute("DELETE FROM design_person_rules WHERE person_id = ?1", [source_id])
        .map_err(|e| e.to_string())?;

    tx.execute(
        "UPDATE design_person_rules SET implex_active_parent_id = ?1 WHERE implex_active_parent_id = ?2",
        params![target_id, source_id],
    )
    .map_err(|e| e.to_string())?;

    tx.execute(
        "UPDATE design_group_rules SET anchor_parent_id = ?1 WHERE anchor_parent_id = ?2",
        params![target_id, source_id],
    )
    .map_err(|e| e.to_string())?;

    tx.execute(
        "UPDATE OR IGNORE design_subtree_mounts SET anchor_person_id = ?1 WHERE anchor_person_id = ?2",
        params![target_id, source_id],
    )
    .map_err(|e| e.to_string())?;
    tx.execute("DELETE FROM design_subtree_mounts WHERE anchor_person_id = ?1", [source_id])
        .map_err(|e| e.to_string())?;

    tx.execute(
        "UPDATE design_edge_waypoints SET parent_person_id = ?1 WHERE parent_person_id = ?2",
        params![target_id, source_id],
    )
    .map_err(|e| e.to_string())?;

    Ok(())
}

/// Exportiert die gesamte aktive SQLite-Datenbank (inkl. Personen, Design-Dokumente & Media-Assets)
/// als Passwort-verschlüsseltes AES-256-GCM Archiv (`.lgproj`).
pub fn export_encrypted_project(
    conn: &Connection,
    target_path: &Path,
    password: &str,
) -> Result<(), String> {
    if password.len() < 4 {
        return Err("Das Passwort muss mindestens 4 Zeichen lang sein.".to_string());
    }

    let temp_db = std::env::temp_dir().join(format!("lg_export_{}.db", uuid::Uuid::new_v4().simple()));
    if temp_db.exists() {
        let _ = fs::remove_file(&temp_db);
    }
    let temp_str = temp_db.to_string_lossy().to_string();

    conn.execute("VACUUM INTO ?1", [&temp_str])
        .map_err(|e| format!("Datenbank-Snapshot fehlgeschlagen: {}", e))?;

    let db_bytes = fs::read(&temp_db).map_err(|e| format!("Lesen des Snapshots fehlgeschlagen: {}", e))?;
    let _ = fs::remove_file(&temp_db);

    let mut salt = [0u8; 16];
    let mut nonce_bytes = [0u8; 12];
    rand::thread_rng().fill_bytes(&mut salt);
    rand::thread_rng().fill_bytes(&mut nonce_bytes);

    let mut key = [0u8; 32];
    pbkdf2::<Hmac<Sha256>>(password.as_bytes(), &salt, PBKDF2_ITERS, &mut key)
        .map_err(|e| format!("Schlüsselableitung fehlgeschlagen: {}", e))?;

    let cipher = Aes256Gcm::new_from_slice(&key)
        .map_err(|e| format!("AES-Init fehlgeschlagen: {}", e))?;
    let nonce = Nonce::from_slice(&nonce_bytes);
    let ciphertext = cipher
        .encrypt(nonce, db_bytes.as_ref())
        .map_err(|e| format!("Verschlüsselung fehlgeschlagen: {}", e))?;

    let mut out = Vec::with_capacity(8 + 16 + 12 + ciphertext.len());
    out.extend_from_slice(LGPROJ_MAGIC);
    out.extend_from_slice(&salt);
    out.extend_from_slice(&nonce_bytes);
    out.extend_from_slice(&ciphertext);

    fs::write(target_path, &out).map_err(|e| format!("Schreiben von '{}' fehlgeschlagen: {}", target_path.display(), e))?;
    Ok(())
}

/// Entschlüsselt eine `.lgproj`-Projektdatei, validiert die SQLite-Integrität und installiert sie als neuen Stammbaum.
pub fn decrypt_project_to_temp_db(source_path: &Path, password: &str) -> Result<Vec<u8>, String> {
    let raw = fs::read(source_path)
        .map_err(|e| format!("Lesen von '{}' fehlgeschlagen: {}", source_path.display(), e))?;

    if raw.len() < 8 + 16 + 12 + 16 || &raw[0..8] != LGPROJ_MAGIC {
        return Err("Ungültiges oder beschädigtes .lgproj-Projektformat.".to_string());
    }

    let salt = &raw[8..24];
    let nonce_bytes = &raw[24..36];
    let ciphertext = &raw[36..];

    let mut key = [0u8; 32];
    pbkdf2::<Hmac<Sha256>>(password.as_bytes(), salt, PBKDF2_ITERS, &mut key)
        .map_err(|e| format!("Schlüsselableitung fehlgeschlagen: {}", e))?;

    let cipher = Aes256Gcm::new_from_slice(&key)
        .map_err(|e| format!("AES-Init fehlgeschlagen: {}", e))?;
    let nonce = Nonce::from_slice(nonce_bytes);
    let plaintext = cipher
        .decrypt(nonce, ciphertext)
        .map_err(|_| "Entschlüsselung fehlgeschlagen: Falsches Passwort oder beschädigte Datei.".to_string())?;

    if plaintext.len() < 16 || &plaintext[0..16] != b"SQLite format 3\0" {
        return Err("Entschlüsselte Datei ist keine gültige SQLite-Datenbank.".to_string());
    }

    Ok(plaintext)
}
