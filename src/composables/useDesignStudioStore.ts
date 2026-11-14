import { computed, ref, toRaw, watch, type Ref } from 'vue';
import { invoke } from '@tauri-apps/api/core';
import { open, save } from '@tauri-apps/plugin-dialog';
import { FALLBACK_LOCALE, resolveLocale } from '../locales/registry';
import type { Person, RootAncestorConfig } from './usePersons';
import {
  DEFAULT_BACKGROUND_CONFIG,
  DEFAULT_CARD_CONFIG,
  type DesignBackgroundConfig,
  type DesignCardConfig,
} from '../types/design';
import { buildDesignSceneGraph } from '../domain/design/sceneGraphBuilder';
import { BRANCH_GAP_X, DOCKED_GROUP_GAP_X } from '../domain/design/contourLayoutEngine';
import { resolveGenealogyTree } from '../domain/design/lineageResolver';
import type {
  CardDensityProfile,
  DesignDocumentModel,
  DesignSceneGraph,
  DesignTreeBundle,
  EdgeWaypointRule,
  GroupDesignRule,
  GrowthDirection,
  LineagePolicy,
  MediaAssetMeta,
  PersonDesignRule,
  RoutingStyle,
  SubtreeDisplayMode,
  SubtreeMountRule,
} from '../domain/design/sceneTypes';

// ============================================================================
// Rust IPC DTO Interfaces (snake_case matching design_repo.rs)
// ============================================================================

interface MediaAssetMetaDto {
  id: string;
  file_name: string;
  mime_type: string;
  width: number;
  height: number;
  byte_size: number;
  created_at: string;
}

interface PersonDesignRuleDto {
  person_id: string;
  is_hidden: boolean;
  custom_group_key: string | null;
  level_offset: number;
  implex_active_parent_id: string | null;
  split_children_by_marriage: boolean;
}

interface GroupDesignRuleDto {
  group_key: string;
  anchor_parent_id: string | null;
  max_columns_per_row: number | null;
  relative_delta_x: number;
  dock_target_group_key: string | null;
  custom_member_ids: string[] | null;
  level_override: number | null;
}

interface SubtreeMountRuleDto {
  anchor_person_id: string;
  sub_document_id: string;
  display_mode: string;
  relative_delta_x: number;
}

interface EdgeWaypointRuleDto {
  edge_key: string;
  parent_person_id: string;
  lane_offset_delta: number;
  vertical_channel_delta_x: number;
}

export interface DesignDocumentDto {
  id: string;
  name: string;
  root_person_id: string;
  document_kind: string;
  growth_direction: string;
  lineage_policy: string;
  routing_style: string;
  enable_line_bridges: boolean;
  card_density_profile: string;
  card_config_json: string;
  bg_asset_id: string | null;
  bg_config_json: string | null;
  created_at: string;
  updated_at: string;
  person_rules: PersonDesignRuleDto[];
  group_rules: GroupDesignRuleDto[];
  subtree_mounts: SubtreeMountRuleDto[];
  edge_waypoints: EdgeWaypointRuleDto[];
}

export interface DesignDocumentSummaryDto {
  id: string;
  name: string;
  root_person_id: string;
  document_kind: 'master' | 'subtree';
  growth_direction: GrowthDirection;
  lineage_policy: LineagePolicy;
  card_density_profile: CardDensityProfile;
  created_at: string;
  updated_at: string;
}

export interface DesignTreeBundleDto {
  root_document: DesignDocumentDto;
  sub_documents: Record<string, DesignDocumentDto>;
  media_assets: Record<string, string>;
  media_metas: Record<string, MediaAssetMetaDto>;
}

export interface BreadcrumbItem {
  documentId: string;
  name: string;
  rootPersonId: string;
  documentKind: 'master' | 'subtree';
}

export function dtoToModel(dto: DesignDocumentDto): DesignDocumentModel {
  let parsedCardCfg: Partial<DesignCardConfig> = {};
  try {
    parsedCardCfg = JSON.parse(dto.card_config_json || '{}');
  } catch {}
  let parsedBgCfg: Partial<DesignBackgroundConfig> = {};
  try {
    if (dto.bg_config_json) parsedBgCfg = JSON.parse(dto.bg_config_json);
  } catch {}

  const personRules: Record<string, PersonDesignRule> = {};
  for (const r of dto.person_rules || []) {
    personRules[r.person_id] = {
      personId: r.person_id,
      isHidden: r.is_hidden,
      customGroupKey: r.custom_group_key,
      levelOffset: r.level_offset || 0,
      implexActiveParentId: r.implex_active_parent_id,
      splitChildrenByMarriage: r.split_children_by_marriage,
    };
  }

  const groupRules: Record<string, GroupDesignRule> = {};
  for (const g of dto.group_rules || []) {
    groupRules[g.group_key] = {
      groupKey: g.group_key,
      anchorParentId: g.anchor_parent_id,
      maxColumnsPerRow: g.max_columns_per_row,
      relativeDeltaX: g.relative_delta_x || 0,
      dockTargetGroupKey: g.dock_target_group_key,
      customMemberIds: g.custom_member_ids,
      levelOverride: g.level_override,
    };
  }

  const subtreeMounts: Record<string, SubtreeMountRule> = {};
  for (const m of dto.subtree_mounts || []) {
    subtreeMounts[m.anchor_person_id] = {
      anchorPersonId: m.anchor_person_id,
      subDocumentId: m.sub_document_id,
      displayMode: m.display_mode === 'capsule' ? 'capsule' : 'inline',
      relativeDeltaX: m.relative_delta_x || 0,
    };
  }

  const edgeWaypoints: Record<string, EdgeWaypointRule> = {};
  for (const w of dto.edge_waypoints || []) {
    edgeWaypoints[w.edge_key] = {
      edgeKey: w.edge_key,
      parentPersonId: w.parent_person_id,
      laneOffsetDelta: w.lane_offset_delta || 0,
      verticalChannelDeltaX: w.vertical_channel_delta_x || 0,
    };
  }

  return {
    id: dto.id,
    name: dto.name,
    rootPersonId: dto.root_person_id,
    documentKind: dto.document_kind === 'subtree' ? 'subtree' : 'master',
    growthDirection: dto.growth_direction === 'top_down' ? 'top_down' : 'bottom_up',
    lineagePolicy:
      dto.lineage_policy === 'matrilinear'
        ? 'matrilinear'
        : dto.lineage_policy === 'oldest_branch'
        ? 'oldest_branch'
        : 'patrilinear',
    routingStyle: dto.routing_style === 'organic_bezier' ? 'organic_bezier' : 'orthogonal_bus',
    enableLineBridges: dto.enable_line_bridges !== false,
    cardDensityProfile: (['detail', 'standard', 'compact_years', 'narrow'].includes(
      dto.card_density_profile
    )
      ? dto.card_density_profile
      : 'standard') as CardDensityProfile,
    cardConfig: { ...DEFAULT_CARD_CONFIG, ...parsedCardCfg },
    bgAssetId: dto.bg_asset_id || null,
    bgConfig: { ...DEFAULT_BACKGROUND_CONFIG, ...parsedBgCfg },
    createdAt: dto.created_at,
    updatedAt: dto.updated_at,
    personRules,
    groupRules,
    subtreeMounts,
    edgeWaypoints,
  };
}

function modelToDto(m: DesignDocumentModel): DesignDocumentDto {
  return {
    id: m.id,
    name: m.name,
    root_person_id: m.rootPersonId,
    document_kind: m.documentKind,
    growth_direction: m.growthDirection,
    lineage_policy: m.lineagePolicy,
    routing_style: m.routingStyle,
    enable_line_bridges: m.enableLineBridges,
    card_density_profile: m.cardDensityProfile,
    card_config_json: JSON.stringify(m.cardConfig),
    bg_asset_id: m.bgAssetId,
    bg_config_json: JSON.stringify(m.bgConfig),
    created_at: m.createdAt,
    updated_at: m.updatedAt,
    person_rules: Object.values(m.personRules).map(pr => ({
      person_id: pr.personId,
      is_hidden: pr.isHidden,
      custom_group_key: pr.customGroupKey ?? null,
      level_offset: pr.levelOffset || 0,
      implex_active_parent_id: pr.implexActiveParentId ?? null,
      split_children_by_marriage: pr.splitChildrenByMarriage,
    })),
    group_rules: Object.values(m.groupRules).map(gr => ({
      group_key: gr.groupKey,
      anchor_parent_id: gr.anchorParentId ?? null,
      max_columns_per_row: gr.maxColumnsPerRow ?? null,
      relative_delta_x: gr.relativeDeltaX || 0,
      dock_target_group_key: gr.dockTargetGroupKey ?? null,
      custom_member_ids: gr.customMemberIds ?? null,
      level_override: gr.levelOverride ?? null,
    })),
    subtree_mounts: Object.values(m.subtreeMounts).map(sm => ({
      anchor_person_id: sm.anchorPersonId,
      sub_document_id: sm.subDocumentId,
      display_mode: sm.displayMode,
      relative_delta_x: sm.relativeDeltaX || 0,
    })),
    edge_waypoints: Object.values(m.edgeWaypoints).map(ew => ({
      edge_key: ew.edgeKey,
      parent_person_id: ew.parentPersonId,
      lane_offset_delta: ew.laneOffsetDelta || 0,
      vertical_channel_delta_x: ew.verticalChannelDeltaX || 0,
    })),
  };
}

function createFreshDocument(
  rootPersonId: string,
  name: string,
  kind: 'master' | 'subtree',
  baseCardConfig?: Partial<DesignCardConfig>
): DesignDocumentModel {
  const now = new Date().toISOString();
  return {
    id: '',
    name,
    rootPersonId,
    documentKind: kind,
    growthDirection: 'bottom_up',
    lineagePolicy: 'patrilinear',
    routingStyle: 'orthogonal_bus',
    enableLineBridges: true,
    cardDensityProfile: 'standard',
    cardConfig: { ...DEFAULT_CARD_CONFIG, ...(baseCardConfig || {}) },
    bgAssetId: null,
    bgConfig: { ...DEFAULT_BACKGROUND_CONFIG },
    createdAt: now,
    updatedAt: now,
    personRules: {},
    groupRules: {},
    subtreeMounts: {},
    edgeWaypoints: {},
  };
}

function cloneDocModel(doc: DesignDocumentModel): DesignDocumentModel {
  return JSON.parse(JSON.stringify(toRaw(doc))) as DesignDocumentModel;
}

export interface UseDesignStudioOptions {
  persons: Ref<Person[]>;
  rootAncestors: Ref<RootAncestorConfig[]>;
  activeProbandId: Ref<string | null>;
  initialCardConfig?: Ref<DesignCardConfig>;
  locale: Ref<string>;
}

const DRAFT_STORAGE_PREFIX = 'lineagegraph_design_v2_draft_';
const MAX_HISTORY = 50;

export function useDesignStudioStore(options: UseDesignStudioOptions) {
  const { persons, rootAncestors, activeProbandId, initialCardConfig, locale } = options;

  // Zentrale Dokumenten-Registry (alle im aktiven Bundle geladenen Master + Sub-Bäume)
  const documentsById = ref<Record<string, DesignDocumentModel>>({});
  const mediaAssets = ref<Record<string, string>>({});
  const mediaMetas = ref<Record<string, MediaAssetMeta>>({});

  // Navigations-Stack (Breadcrumbs für beliebig tiefe Schachtelung)
  const breadcrumbStack = ref<BreadcrumbItem[]>([]);
  const activeDocumentId = ref<string>('');

  // Datenbank-Kataloge (Sub-Bäume strikt auf Nachkommen des gewählten Stammahns gefiltert)
  const savedMasterList = ref<DesignDocumentSummaryDto[]>([]);
  const allSubtreeSummaries = ref<DesignDocumentSummaryDto[]>([]);

  // Selektion & UI-Status
  const selectedPersonId = ref<string>('');
  const selectedGroupKey = ref<string>('');
  const selectedEdgeKey = ref<string>('');
  const showLevelGrid = ref<boolean>(true);
  const isSplitToolActive = ref<boolean>(false);
  const statusToast = ref<string>('');
  const errorToast = ref<string>('');
  const isDirty = ref<boolean>(false);
  const isLoading = ref<boolean>(false);

  // Transientes 60fps Drag Preview
  const dragPreview = ref<{ kind: 'group' | 'edge'; key: string; dx: number; dy: number } | null>(null);

  // Undo / Redo Stack auf aktives Dokument
  const undoStack = ref<DesignDocumentModel[]>([]);
  const redoStack = ref<DesignDocumentModel[]>([]);
  const layoutRevision = ref<number>(0);

  const effectiveRootId = computed<string>(() => {
    if (activeProbandId.value) return activeProbandId.value;
    if (rootAncestors.value.length > 0) return rootAncestors.value[0].person_id;
    return persons.value[0]?.id || '';
  });

  const activeStammahnMemberIds = computed<Set<string>>(() => {
    const rootId = effectiveRootId.value;
    const result = new Set<string>();
    if (!rootId) return result;

    const childrenByParent = new Map<string, string[]>();
    for (const p of persons.value) {
      if (p.proband_data && p.proband_data[rootId]) {
        result.add(p.id);
      }
      for (const pid of p.parent_ids || []) {
        if (!childrenByParent.has(pid)) childrenByParent.set(pid, []);
        childrenByParent.get(pid)!.push(p.id);
      }
    }

    const queue: string[] = [rootId];
    if (!result.has(rootId)) result.add(rootId);
    while (queue.length > 0) {
      const cur = queue.shift()!;
      for (const cid of childrenByParent.get(cur) || []) {
        if (!result.has(cid)) {
          result.add(cid);
          queue.push(cid);
        }
      }
    }
    return result;
  });

  function henrySegmentRank(tok: string): number {
    if (!tok) return 0;
    const ch = tok[0];
    if (ch >= '1' && ch <= '9') return ch.charCodeAt(0) - 48;
    if (ch >= 'A' && ch <= 'K') return 10 + (ch.charCodeAt(0) - 65);
    if (ch === 'X') {
      const n = parseInt(tok.slice(1), 10);
      return Number.isFinite(n) ? 20 + n : 999;
    }
    return ch.charCodeAt(0) + 100;
  }

  function tokenizeHenryCode(code: string): string[] {
    const tokens: string[] = [];
    for (let i = 0; i < code.length; i++) {
      if (code[i] === 'X') {
        let j = i + 1;
        while (j < code.length && code[j] >= '0' && code[j] <= '9') j++;
        tokens.push(code.slice(i, j));
        i = j - 1;
      } else {
        tokens.push(code[i]);
      }
    }
    return tokens;
  }

  function compareHenryCodes(a: string, b: string): number {
    if (a === b) return 0;
    if (!a) return 1;
    if (!b) return -1;
    const ta = tokenizeHenryCode(a);
    const tb = tokenizeHenryCode(b);
    const len = Math.min(ta.length, tb.length);
    for (let i = 0; i < len; i++) {
      const diff = henrySegmentRank(ta[i]) - henrySegmentRank(tb[i]);
      if (diff !== 0) return diff;
    }
    return ta.length - tb.length;
  }

  const stammahnHenryMap = computed<Map<string, string>>(() => {
    const map = new Map<string, string>();
    const rootId = effectiveRootId.value;
    if (!rootId) return map;

    const rootDocId = breadcrumbStack.value[0]?.documentId;
    const baseMaster =
      (rootDocId && documentsById.value[rootDocId]) || activeDocument.value;
    const syntheticMaster =
      baseMaster && baseMaster.rootPersonId === rootId
        ? baseMaster
        : createFreshDocument(rootId, '', 'master');
    const resolved = resolveGenealogyTree(
      syntheticMaster,
      persons.value,
      resolveLocale(locale.value) ?? FALLBACK_LOCALE,
      rootId,
      activeDocument.value || syntheticMaster
    );
    for (const [pid, meta] of resolved.resolvedMeta.entries()) {
      map.set(pid, meta.henryCode);
    }
    return map;
  });

  function getPersonHenryCode(personId: string): string {
    if (!personId) return '';
    const card = sceneGraph.value?.cards.find(c => c.personId === personId);
    if (card?.henryCode) return card.henryCode;
    const resolvedCode = stammahnHenryMap.value.get(personId);
    if (resolvedCode) return resolvedCode;
    const rootId = effectiveRootId.value;
    const p = persons.value.find(x => x.id === personId);
    return (rootId && p?.proband_data?.[rootId]?.henry_code) || '';
  }

  const savedSubtreeList = computed<DesignDocumentSummaryDto[]>(() => {
    const rootId = effectiveRootId.value;
    if (!rootId) return [];
    const members = activeStammahnMemberIds.value;
    return allSubtreeSummaries.value
      .filter(s => members.has(s.root_person_id))
      .slice()
      .sort((a, b) =>
        compareHenryCodes(getPersonHenryCode(a.root_person_id), getPersonHenryCode(b.root_person_id))
      );
  });

  const activeDocument = computed<DesignDocumentModel | null>(() => {
    void layoutRevision.value;
    if (!activeDocumentId.value) return null;
    return documentsById.value[activeDocumentId.value] || null;
  });

  const currentBundle = computed<DesignTreeBundle | null>(() => {
    void layoutRevision.value;
    const doc = activeDocument.value;
    if (!doc || !doc.rootPersonId) return null;
    const subs: Record<string, DesignDocumentModel> = {};
    for (const [id, d] of Object.entries(documentsById.value)) {
      if (id !== doc.id) subs[id] = d;
    }
    return {
      masterRootPersonId: effectiveRootId.value || doc.rootPersonId,
      rootDocument: doc,
      subDocuments: subs,
      mediaAssets: mediaAssets.value,
      mediaMetas: mediaMetas.value,
    };
  });

  const sceneGraph = computed<DesignSceneGraph | null>(() => {
    void layoutRevision.value;
    const b = currentBundle.value;
    if (!b) return null;
    return buildDesignSceneGraph(b, persons.value, resolveLocale(locale.value) ?? FALLBACK_LOCALE);
  });

  const canUndo = computed(() => undoStack.value.length > 0);
  const canRedo = computed(() => redoStack.value.length > 0);
  const isInSubtreeMode = computed(() => breadcrumbStack.value.length > 1);

  function showStatus(msg: string) {
    errorToast.value = '';
    statusToast.value = msg;
    setTimeout(() => {
      if (statusToast.value === msg) statusToast.value = '';
    }, 4000);
  }

  function showError(msg: string) {
    errorToast.value = msg;
    setTimeout(() => {
      if (errorToast.value === msg) errorToast.value = '';
    }, 6000);
  }

  function pushUndoSnapshot() {
    const cur = activeDocument.value;
    if (!cur) return;
    undoStack.value.push(cloneDocModel(cur));
    if (undoStack.value.length > MAX_HISTORY) {
      undoStack.value.shift();
    }
    redoStack.value = [];
    isDirty.value = true;
  }

  function undo() {
    if (undoStack.value.length === 0 || !activeDocument.value) return;
    redoStack.value.push(cloneDocModel(activeDocument.value));
    const prev = undoStack.value.pop()!;
    documentsById.value[prev.id] = prev;
    isDirty.value = true;
    layoutRevision.value++;
    saveDraftToLocal();
  }

  function redo() {
    if (redoStack.value.length === 0 || !activeDocument.value) return;
    undoStack.value.push(cloneDocModel(activeDocument.value));
    const next = redoStack.value.pop()!;
    documentsById.value[next.id] = next;
    isDirty.value = true;
    layoutRevision.value++;
    saveDraftToLocal();
  }

  function saveDraftToLocal() {
    layoutRevision.value++;
    const rootDoc =
      breadcrumbStack.value[0]?.documentId
        ? documentsById.value[breadcrumbStack.value[0].documentId]
        : activeDocument.value;
    if (!rootDoc || !rootDoc.rootPersonId) return;
    try {
      const payload = {
        activeDocumentId: activeDocumentId.value,
        breadcrumbStack: breadcrumbStack.value,
        documentsById: documentsById.value,
      };
      localStorage.setItem(
        `${DRAFT_STORAGE_PREFIX}${rootDoc.rootPersonId}`,
        JSON.stringify(payload)
      );
    } catch {}
  }

  function clearDraftForRoot(rootPersonId: string) {
    try {
      localStorage.removeItem(`${DRAFT_STORAGE_PREFIX}${rootPersonId}`);
    } catch {}
  }

  // Einmalige Übernahme alter IndexedDB-Hintergrundbilder in SQLite media_assets
  async function migrateLegacyIndexedDbIfPresent() {
    if (typeof window === 'undefined' || !window.indexedDB) return;
    const flagKey = 'lineagegraph_idb_migrated_v2';
    if (localStorage.getItem(flagKey) === '1') return;

    try {
      const req = window.indexedDB.open('stammbaum_design_db', 1);
      req.onupgradeneeded = () => {
        // Store existierte noch nicht -> keine Migration nötig
      };
      req.onsuccess = async () => {
        const db = req.result;
        if (!db.objectStoreNames.contains('bg_images')) {
          db.close();
          localStorage.setItem(flagKey, '1');
          return;
        }
        const tx = db.transaction('bg_images', 'readonly');
        const store = tx.objectStore('bg_images');
        const getAllReq = store.getAll();
        getAllReq.onsuccess = async () => {
          const items = (getAllReq.result || []) as { id: string; dataUrl: string; fileName?: string }[];
          for (const item of items) {
            if (item?.dataUrl && item.dataUrl.startsWith('data:')) {
              try {
                await invoke('upload_design_media_asset', {
                  fileName: item.fileName || `${item.id}.png`,
                  dataUrl: item.dataUrl,
                  width: 600,
                  height: 600,
                });
              } catch {}
            }
          }
          db.close();
          localStorage.setItem(flagKey, '1');
        };
      };
    } catch {
      localStorage.setItem(flagKey, '1');
    }
  }

  async function refreshDocumentCatalogs() {
    try {
      const [masters, subtrees] = await Promise.all([
        invoke<DesignDocumentSummaryDto[]>('list_design_documents', {
          rootPersonId: effectiveRootId.value || null,
          documentKind: 'master',
        }),
        invoke<DesignDocumentSummaryDto[]>('list_design_documents', {
          rootPersonId: null,
          documentKind: 'subtree',
        }),
      ]);
      savedMasterList.value = masters || [];
      allSubtreeSummaries.value = subtrees || [];
    } catch (err) {
      console.error('Fehler beim Laden der Design-Kataloge:', err);
    }
  }

  function syncLineageRulesToDocs(
    sourceDoc: DesignDocumentModel,
    targetDocs: DesignDocumentModel[]
  ) {
    for (const target of targetDocs) {
      if (!target || target.id === sourceDoc.id) continue;
      target.lineagePolicy = sourceDoc.lineagePolicy;
      for (const [pid, srcRule] of Object.entries(sourceDoc.personRules || {})) {
        if (srcRule?.implexActiveParentId) {
          const dstRule = ensurePersonRule(target, pid);
          dstRule.implexActiveParentId = srcRule.implexActiveParentId;
        }
      }
    }
  }

  function hydrateBundle(bundleDto: DesignTreeBundleDto) {
    const rootModel = dtoToModel(bundleDto.root_document);
    const docs: Record<string, DesignDocumentModel> = {
      [rootModel.id]: rootModel,
    };
    const subModels: DesignDocumentModel[] = [];
    for (const [sid, sdto] of Object.entries(bundleDto.sub_documents || {})) {
      const subModel = dtoToModel(sdto);
      docs[sid] = subModel;
      subModels.push(subModel);
    }
    syncLineageRulesToDocs(rootModel, subModels);
    documentsById.value = docs;

    const assets: Record<string, string> = {};
    for (const [aid, dataUrl] of Object.entries(bundleDto.media_assets || {})) {
      assets[aid] = dataUrl;
    }
    mediaAssets.value = assets;

    const metas: Record<string, MediaAssetMeta> = {};
    for (const [aid, m] of Object.entries(bundleDto.media_metas || {})) {
      metas[aid] = {
        id: m.id,
        fileName: m.file_name,
        mimeType: m.mime_type,
        width: m.width,
        height: m.height,
        byteSize: m.byte_size,
        createdAt: m.created_at,
      };
    }
    mediaMetas.value = metas;

    activeDocumentId.value = rootModel.id;
    breadcrumbStack.value = [
      {
        documentId: rootModel.id,
        name: rootModel.name,
        rootPersonId: rootModel.rootPersonId,
        documentKind: rootModel.documentKind,
      },
    ];
    undoStack.value = [];
    redoStack.value = [];
    isDirty.value = false;
    selectedPersonId.value = '';
    selectedGroupKey.value = '';
    selectedEdgeKey.value = '';
  }

  async function initStudioForActiveRoot() {
    const rootId = effectiveRootId.value;
    if (!rootId) return;
    isLoading.value = true;
    try {
      await migrateLegacyIndexedDbIfPresent();
      await refreshDocumentCatalogs();

      // 1. Entwurf aus localStorage prüfen (falls Nutzer gerade zwischen App-Tabs gewechselt hat)
      const draftRaw = localStorage.getItem(`${DRAFT_STORAGE_PREFIX}${rootId}`);
      if (draftRaw) {
        try {
          const parsed = JSON.parse(draftRaw);
          if (parsed?.activeDocumentId && parsed?.documentsById?.[parsed.activeDocumentId]) {
            documentsById.value = parsed.documentsById;
            breadcrumbStack.value = parsed.breadcrumbStack || [];
            activeDocumentId.value = parsed.activeDocumentId;
            // Fehlende Media-Assets nachladen
            const assetIds = new Set<string>();
            for (const d of Object.values(documentsById.value)) {
              if (d.bgAssetId && !mediaAssets.value[d.bgAssetId]) assetIds.add(d.bgAssetId);
            }
            for (const aid of assetIds) {
              const res = await invoke<{ meta: MediaAssetMetaDto; data_url: string } | null>(
                'get_design_media_asset',
                { assetId: aid }
              );
              if (res) {
                mediaAssets.value[aid] = res.data_url;
                mediaMetas.value[aid] = {
                  id: res.meta.id,
                  fileName: res.meta.file_name,
                  mimeType: res.meta.mime_type,
                  width: res.meta.width,
                  height: res.meta.height,
                  byteSize: res.meta.byte_size,
                  createdAt: res.meta.created_at,
                };
              }
            }
            isLoading.value = false;
            return;
          }
        } catch {}
      }

      // 2. Zuletzt gespeichertes Master-Design für diesen Spitzenahn aus SQLite laden
      if (savedMasterList.value.length > 0) {
        await loadDocumentById(savedMasterList.value[0].id);
        return;
      }

      // 3. Frisches Standard-Design initialisieren
      const rootPerson = persons.value.find(p => p.id === rootId);
      const defaultName = rootPerson
        ? `Stammtafel ${rootPerson.surname || rootPerson.given_name || rootId}`
        : 'Neue Stammtafel';
      const fresh = createFreshDocument(
        rootId,
        defaultName,
        'master',
        initialCardConfig?.value
      );
      fresh.id = `draft_master_${rootId}`;
      documentsById.value = { [fresh.id]: fresh };
      activeDocumentId.value = fresh.id;
      breadcrumbStack.value = [
        {
          documentId: fresh.id,
          name: fresh.name,
          rootPersonId: fresh.rootPersonId,
          documentKind: 'master',
        },
      ];
      undoStack.value = [];
      redoStack.value = [];
      isDirty.value = false;
    } finally {
      isLoading.value = false;
    }
  }

  async function loadDocumentById(documentId: string) {
    isLoading.value = true;
    try {
      const bundle = await invoke<DesignTreeBundleDto>('load_design_tree_bundle', {
        documentId,
      });
      isSplitToolActive.value = false;
      hydrateBundle(bundle);
      saveDraftToLocal();
      showStatus(`Design "${bundle.root_document.name}" geladen.`);
    } catch (err) {
      showError(`Laden fehlgeschlagen: ${String(err)}`);
    } finally {
      isLoading.value = false;
    }
  }

  async function saveActiveDocument(asNewName?: string): Promise<DesignDocumentSummaryDto | null> {
    const doc = activeDocument.value;
    if (!doc) return null;
    try {
      const toSave = cloneDocModel(doc);
      const isNewDraft = toSave.id.startsWith('draft_');
      if (asNewName) {
        toSave.id = '';
        toSave.name = asNewName.trim();
        toSave.createdAt = new Date().toISOString();
      } else if (isNewDraft) {
        toSave.id = '';
      }

      const summary = await invoke<DesignDocumentSummaryDto>('save_design_document_v2', {
        document: modelToDto(toSave),
        overwriteSameName: !asNewName && isNewDraft,
      });

      const prevId = doc.id;
      toSave.id = summary.id;
      toSave.updatedAt = summary.updated_at;

      if (prevId !== summary.id) {
        delete documentsById.value[prevId];
        // Referenzen in Breadcrumbs & Parent-Mounts aktualisieren
        for (const bc of breadcrumbStack.value) {
          if (bc.documentId === prevId) {
            bc.documentId = summary.id;
            bc.name = summary.name;
          }
        }
        for (const otherDoc of Object.values(documentsById.value)) {
          for (const mount of Object.values(otherDoc.subtreeMounts)) {
            if (mount.subDocumentId === prevId) {
              mount.subDocumentId = summary.id;
            }
          }
        }
        activeDocumentId.value = summary.id;
      } else {
        const bc = breadcrumbStack.value.find(b => b.documentId === summary.id);
        if (bc) bc.name = summary.name;
      }

      documentsById.value[summary.id] = toSave;

      // Mitgeänderte Sub-Bäume des aktuellen Bundles beim Speichern ebenfalls in SQLite sichern
      if (!asNewName) {
        for (const [otherId, otherDoc] of Object.entries(documentsById.value)) {
          if (otherId === prevId || otherId === summary.id || otherId.startsWith('draft_')) continue;
          const otherSummary = await invoke<DesignDocumentSummaryDto>('save_design_document_v2', {
            document: modelToDto(cloneDocModel(otherDoc)),
            overwriteSameName: false,
          });
          otherDoc.updatedAt = otherSummary.updated_at;
        }
      }

      isDirty.value = false;
      saveDraftToLocal();
      await refreshDocumentCatalogs();
      showStatus(`Arbeitsstand "${summary.name}" gespeichert.`);
      return summary;
    } catch (err) {
      showError(`Speichern fehlgeschlagen: ${String(err)}`);
      return null;
    }
  }

  async function deleteSavedDocument(documentId: string) {
    try {
      await invoke('delete_design_document_v2', { documentId });
      await refreshDocumentCatalogs();
      showStatus('Gespeichertes Design gelöscht.');
      if (activeDocumentId.value === documentId) {
        clearDraftForRoot(effectiveRootId.value);
        await initStudioForActiveRoot();
      }
    } catch (err) {
      showError(`Löschen fehlgeschlagen: ${String(err)}`);
    }
  }

  function resetToDefaultLayout() {
    const doc = activeDocument.value;
    if (!doc) return;
    pushUndoSnapshot();
    doc.personRules = {};
    doc.groupRules = {};
    doc.edgeWaypoints = {};
    doc.growthDirection = 'bottom_up';
    doc.lineagePolicy = 'patrilinear';
    doc.routingStyle = 'orthogonal_bus';
    saveDraftToLocal();
    showStatus('Layout auf Standardregeln zurückgesetzt.');
  }

  // ============================================================================
  // Dokument-weite Strategien & Kachel-Einstellungen
  // ============================================================================

  function setGrowthDirection(dir: GrowthDirection) {
    const doc = activeDocument.value;
    if (!doc || doc.growthDirection === dir) return;
    pushUndoSnapshot();
    doc.growthDirection = dir;
    saveDraftToLocal();
  }

  function setLineagePolicy(policy: LineagePolicy) {
    const doc = activeDocument.value;
    if (!doc) return;
    const allDocs = Object.values(documentsById.value);
    if (doc.lineagePolicy === policy && allDocs.every(d => d.lineagePolicy === policy)) return;
    pushUndoSnapshot();
    doc.lineagePolicy = policy;
    for (const d of allDocs) {
      d.lineagePolicy = policy;
    }
    saveDraftToLocal();
  }

  function setRoutingStyle(style: RoutingStyle) {
    const doc = activeDocument.value;
    if (!doc || doc.routingStyle === style) return;
    pushUndoSnapshot();
    doc.routingStyle = style;
    saveDraftToLocal();
  }

  function setEnableLineBridges(enabled: boolean) {
    const doc = activeDocument.value;
    if (!doc || doc.enableLineBridges === enabled) return;
    pushUndoSnapshot();
    doc.enableLineBridges = enabled;
    saveDraftToLocal();
  }

  const PROFILE_DEFAULT_CARD_OVERRIDES: Record<CardDensityProfile, Partial<DesignCardConfig>> = {
    detail: {
      showOnlyYears: false,
      showBirthPlace: true,
      showDeathPlace: true,
      showOccupation: true,
      lifeDatesLayout: 'multi',
    },
    standard: {
      showOnlyYears: false,
      showBirthPlace: false,
      showDeathPlace: false,
      showOccupation: false,
      lifeDatesLayout: 'single',
    },
    compact_years: {
      showOnlyYears: true,
      showBirthPlace: false,
      showChrPlace: false,
      showDeathPlace: false,
      showSpouseBirthPlace: false,
      showSpouseDeathPlace: false,
      showOccupation: false,
      lifeDatesLayout: 'single',
    },
    narrow: {
      showOnlyYears: true,
      showBirthPlace: false,
      showChrPlace: false,
      showDeathPlace: false,
      showSpouseBirthPlace: false,
      showSpouseDeathPlace: false,
      showOccupation: false,
      lifeDatesLayout: 'single',
    },
  };

  function setCardDensityProfile(profile: CardDensityProfile) {
    const doc = activeDocument.value;
    if (!doc || doc.cardDensityProfile === profile) return;
    pushUndoSnapshot();
    const nextCfg: DesignCardConfig = {
      ...doc.cardConfig,
      ...PROFILE_DEFAULT_CARD_OVERRIDES[profile],
    };
    documentsById.value = {
      ...documentsById.value,
      [doc.id]: {
        ...doc,
        cardDensityProfile: profile,
        cardConfig: nextCfg,
      },
    };
    saveDraftToLocal();
  }

  function updateCardConfig(partial: Partial<DesignCardConfig>) {
    const doc = activeDocument.value;
    if (!doc) return;
    pushUndoSnapshot();
    const nextCfg: DesignCardConfig = { ...doc.cardConfig, ...partial };
    const nextDocs: Record<string, DesignDocumentModel> = { ...documentsById.value };
    nextDocs[doc.id] = { ...doc, cardConfig: nextCfg };
    // Bei Änderungen am Master-Baum auch geladene Sub-Dokumente synchronisieren,
    // sodass sichtbare Kacheln sofort reagieren.
    if (doc.documentKind === 'master') {
      for (const [id, other] of Object.entries(nextDocs)) {
        if (id !== doc.id) {
          nextDocs[id] = {
            ...other,
            cardConfig: { ...other.cardConfig, ...partial },
          };
        }
      }
    }
    documentsById.value = nextDocs;
    saveDraftToLocal();
  }

  // ============================================================================
  // Knoten-, Gruppen-, Wrapping-, Implex- & Wegpunkt-Manipulationen
  // ============================================================================

  function ensurePersonRule(doc: DesignDocumentModel, personId: string): PersonDesignRule {
    if (!doc.personRules[personId]) {
      doc.personRules[personId] = {
        personId,
        isHidden: false,
        customGroupKey: null,
        levelOffset: 0,
        implexActiveParentId: null,
        splitChildrenByMarriage: false,
      };
    }
    return doc.personRules[personId];
  }

  function ensureGroupRule(
    doc: DesignDocumentModel,
    groupKey: string,
    anchorParentId?: string | null
  ): GroupDesignRule {
    if (!doc.groupRules[groupKey]) {
      doc.groupRules[groupKey] = {
        groupKey,
        anchorParentId: anchorParentId ?? null,
        maxColumnsPerRow: null,
        relativeDeltaX: 0,
        dockTargetGroupKey: null,
        customMemberIds: null,
        levelOverride: null,
      };
    }
    return doc.groupRules[groupKey];
  }

  function setGroupMaxColumns(groupKey: string, maxCols: number | null, anchorParentId?: string | null) {
    const doc = activeDocument.value;
    if (!doc) return;
    pushUndoSnapshot();
    const rule = ensureGroupRule(doc, groupKey, anchorParentId);
    rule.maxColumnsPerRow = maxCols && maxCols > 0 ? maxCols : null;
    saveDraftToLocal();
  }

  function shiftGroupLevel(groupKey: string, memberIds: string[], deltaLevel: number) {
    const doc = activeDocument.value;
    if (!doc || memberIds.length === 0) return;
    pushUndoSnapshot();
    for (const mid of memberIds) {
      const pr = ensurePersonRule(doc, mid);
      pr.levelOffset = Math.max(0, (pr.levelOffset || 0) + deltaLevel);
    }
    const existingRule = doc.groupRules[groupKey];
    if (existingRule) {
      existingRule.levelOverride = null;
    }
    saveDraftToLocal();
  }

  function resolveEditableGroupTarget(
    groupKey: string,
    anchorParentId?: string | null
  ): { headKey: string; anchorParentId: string | null } {
    const groups = sceneGraph.value?.groups || [];
    const sceneGrp = groups.find(g => g.groupKey === groupKey);
    const headKey = sceneGrp?.dockClusterKey || groupKey;
    const headSceneGrp = groups.find(g => g.groupKey === headKey);
    return {
      headKey,
      anchorParentId: headSceneGrp?.anchorParentId ?? anchorParentId ?? null,
    };
  }

  function moveGroupRelativeX(groupKey: string, deltaX: number, anchorParentId?: string | null) {
    const doc = activeDocument.value;
    if (!doc || Math.abs(deltaX) < 0.5) return;
    pushUndoSnapshot();
    const target = resolveEditableGroupTarget(groupKey, anchorParentId);
    const rule = ensureGroupRule(doc, target.headKey, target.anchorParentId);
    rule.relativeDeltaX = Math.round(((rule.relativeDeltaX || 0) + deltaX) * 10) / 10;
    saveDraftToLocal();
  }

  function beginInteractiveDrag() {
    pushUndoSnapshot();
  }

  function finishInteractiveDrag() {
    saveDraftToLocal();
  }

  function getCardManualOffset(personId: string): { x: number; y: number } {
    const doc = activeDocument.value;
    if (!doc || !personId) return { x: 0, y: 0 };
    const rule = doc.groupRules[`__card_offset__::${personId}`];
    return {
      x: rule?.relativeDeltaX || 0,
      y: 0,
    };
  }

  function getGroupRelativeX(groupKey: string): number {
    const doc = activeDocument.value;
    if (!doc || !groupKey) return 0;
    const sceneGrp = sceneGraph.value?.groups.find(g => g.groupKey === groupKey);
    const headKey = sceneGrp?.dockClusterKey || groupKey;
    return doc.groupRules[headKey]?.relativeDeltaX || 0;
  }

  function setCardManualOffset(personId: string, offsetX: number, _offsetY: number) {
    const doc = activeDocument.value;
    if (!doc || !personId) return;
    const ruleKey = `__card_offset__::${personId}`;
    const rule = ensureGroupRule(doc, ruleKey, null);
    rule.relativeDeltaX = Math.round(offsetX);
    rule.levelOverride = null;
    isDirty.value = true;
    layoutRevision.value++;
  }

  function moveCardManualOffset(personId: string, stepDx: number, _stepDy: number) {
    const cur = getCardManualOffset(personId);
    setCardManualOffset(personId, cur.x + stepDx, 0);
  }

  function setGroupRelativeXLive(groupKey: string, targetDeltaX: number, anchorParentId?: string | null) {
    const doc = activeDocument.value;
    if (!doc || !groupKey) return;
    const target = resolveEditableGroupTarget(groupKey, anchorParentId);
    const rule = ensureGroupRule(doc, target.headKey, target.anchorParentId);
    rule.relativeDeltaX = Math.round(targetDeltaX * 10) / 10;
    isDirty.value = true;
    layoutRevision.value++;
  }

  function moveGroupRelativeXLive(groupKey: string, stepDx: number, anchorParentId?: string | null) {
    const doc = activeDocument.value;
    if (!doc || !groupKey) return;
    const target = resolveEditableGroupTarget(groupKey, anchorParentId);
    const rule = ensureGroupRule(doc, target.headKey, target.anchorParentId);
    rule.relativeDeltaX = Math.round(((rule.relativeDeltaX || 0) + stepDx) * 10) / 10;
    isDirty.value = true;
    layoutRevision.value++;
  }

  function dockGroupCluster(
    sourceGroupKey: string,
    targetGroupKey: string,
    preferredSide?: 'left' | 'right',
    skipUndo: boolean = false
  ) {
    const doc = activeDocument.value;
    const sg = sceneGraph.value;
    if (!doc || !sg) return;
    const srcGrp = sg.groups.find(g => g.groupKey === sourceGroupKey);
    const tgtGrp = sg.groups.find(g => g.groupKey === targetGroupKey);
    if (!srcGrp || !tgtGrp) return;
    if (srcGrp.ownerDocumentId !== doc.id || tgtGrp.ownerDocumentId !== doc.id) return;
    if (srcGrp.level !== tgtGrp.level) return;

    const srcClusterKey = srcGrp.dockClusterKey || srcGrp.groupKey;
    const tgtClusterKey = tgtGrp.dockClusterKey || tgtGrp.groupKey;
    if (srcClusterKey === tgtClusterKey) return;

    const sameLevelOwned = sg.groups.filter(
      g => g.ownerDocumentId === doc.id && g.level === srcGrp.level
    );
    const srcClusterGroups = sameLevelOwned
      .filter(g => (g.dockClusterKey || g.groupKey) === srcClusterKey)
      .sort((a, b) => a.x - b.x);
    const tgtClusterGroups = sameLevelOwned
      .filter(g => (g.dockClusterKey || g.groupKey) === tgtClusterKey)
      .sort((a, b) => a.x - b.x);

    if (srcClusterGroups.length === 0 || tgtClusterGroups.length === 0) return;

    const srcHead = srcClusterGroups[0];
    const srcTail = srcClusterGroups[srcClusterGroups.length - 1];
    const tgtHead = tgtClusterGroups[0];
    const tgtTail = tgtClusterGroups[tgtClusterGroups.length - 1];

    const side: 'left' | 'right' =
      preferredSide ?? (srcGrp.x + srcGrp.width / 2 >= tgtGrp.x + tgtGrp.width / 2 ? 'left' : 'right');

    if (!skipUndo) pushUndoSnapshot();

    if (side === 'left') {
      // Ziel-Cluster steht LINKS vom Quell-Cluster -> Quell-Kopf dockt ans rechte Ende des Ziel-Clusters an
      const srcHeadRule = ensureGroupRule(doc, srcHead.groupKey, srcHead.anchorParentId);
      srcHeadRule.dockTargetGroupKey = tgtTail.groupKey;
      srcHeadRule.relativeDeltaX = 0;
    } else {
      // Ziel-Cluster steht RECHTS vom Quell-Cluster -> Quell-Cluster rückt bündig an Ziel-Kopf, Ziel-Kopf folgt Quell-Ende
      const srcRightEdge = Math.max(...srcClusterGroups.map(g => g.x + g.width));
      const shiftRight = tgtHead.x - DOCKED_GROUP_GAP_X - srcRightEdge;
      const srcHeadRule = ensureGroupRule(doc, srcHead.groupKey, srcHead.anchorParentId);
      srcHeadRule.relativeDeltaX = Math.round(((srcHeadRule.relativeDeltaX || 0) + shiftRight) * 10) / 10;

      const tgtHeadRule = ensureGroupRule(doc, tgtHead.groupKey, tgtHead.anchorParentId);
      tgtHeadRule.dockTargetGroupKey = srcTail.groupKey;
      tgtHeadRule.relativeDeltaX = 0;
    }

    isDirty.value = true;
    layoutRevision.value++;
    saveDraftToLocal();
  }

  function dockClusterToNeighbor(groupKey: string, direction: 'left' | 'right'): boolean {
    const doc = activeDocument.value;
    const sg = sceneGraph.value;
    if (!doc || !sg) return false;
    const curGrp = sg.groups.find(g => g.groupKey === groupKey);
    if (!curGrp || curGrp.ownerDocumentId !== doc.id) return false;

    const curClusterKey = curGrp.dockClusterKey || curGrp.groupKey;
    const sameLevelOwned = sg.groups.filter(
      g => g.ownerDocumentId === doc.id && g.level === curGrp.level
    );
    const curClusterGroups = sameLevelOwned
      .filter(g => (g.dockClusterKey || g.groupKey) === curClusterKey)
      .sort((a, b) => a.x - b.x);
    if (curClusterGroups.length === 0) return false;

    const curMinX = curClusterGroups[0].x;
    const curMaxRight = Math.max(...curClusterGroups.map(g => g.x + g.width));

    const otherGroups = sameLevelOwned.filter(
      g => (g.dockClusterKey || g.groupKey) !== curClusterKey
    );

    if (direction === 'left') {
      const leftCandidates = otherGroups
        .filter(g => g.x + g.width <= curMinX + curGrp.width / 2)
        .sort((a, b) => b.x + b.width - (a.x + a.width));
      const neighbor = leftCandidates[0];
      if (!neighbor) return false;
      dockGroupCluster(groupKey, neighbor.groupKey, 'left');
      return true;
    } else {
      const rightCandidates = otherGroups
        .filter(g => g.x >= curMaxRight - curGrp.width / 2)
        .sort((a, b) => a.x - b.x);
      const neighbor = rightCandidates[0];
      if (!neighbor) return false;
      dockGroupCluster(groupKey, neighbor.groupKey, 'right');
      return true;
    }
  }

  function undockGroup(groupKey: string) {
    const doc = activeDocument.value;
    const sg = sceneGraph.value;
    if (!doc || !sg) return;
    const grp = sg.groups.find(g => g.groupKey === groupKey);
    if (!grp || grp.ownerDocumentId !== doc.id) return;

    const curTarget = doc.groupRules[groupKey]?.dockTargetGroupKey ?? grp.dockTargetGroupKey ?? null;
    const followers = Object.values(doc.groupRules).filter(r => r.dockTargetGroupKey === groupKey);
    if (!curTarget && followers.length === 0) return;

    pushUndoSnapshot();
    if (curTarget) {
      // Kette sauber schließen, falls andere Gruppen direkt an dieser Gruppe angedockt waren
      for (const f of followers) {
        f.dockTargetGroupKey = curTarget;
      }
      if (doc.groupRules[groupKey]) {
        doc.groupRules[groupKey].dockTargetGroupKey = null;
      }
    } else {
      // Cluster-Kopf löst seine direkten Nachfolger
      for (const f of followers) {
        f.dockTargetGroupKey = null;
      }
    }
    isDirty.value = true;
    layoutRevision.value++;
    saveDraftToLocal();
  }

  function detachCardFromSiblingGroup(personId: string) {
    const doc = activeDocument.value;
    const sg = sceneGraph.value;
    if (!doc || !sg) return;
    const card = sg.cards.find(c => c.personId === personId);
    if (!card || card.ownerDocumentId !== doc.id) return;
    const grp = sg.groups.find(g => g.groupKey === card.groupKey);
    if (!grp || grp.memberIds.length < 2) return;

    pushUndoSnapshot();
    const pr = ensurePersonRule(doc, personId);
    pr.customGroupKey = `${doc.id}::detached_${personId}`;
    saveDraftToLocal();
  }

  function reattachCardToSiblingGroup(personId: string) {
    const doc = activeDocument.value;
    const sg = sceneGraph.value;
    if (!doc || !sg) return;
    const card = sg.cards.find(c => c.personId === personId);
    if (!card || card.ownerDocumentId !== doc.id) return;
    const pr = doc.personRules[personId];
    if (!pr?.customGroupKey) return;

    pushUndoSnapshot();
    const oldDetachedKey = pr.customGroupKey;
    pr.customGroupKey = null;

    // Verwaiste Dock-Ketten von der aufgelösten Einzelgruppe bereinigen
    const detachedRule = doc.groupRules[oldDetachedKey];
    const oldTarget = detachedRule?.dockTargetGroupKey ?? null;
    for (const r of Object.values(doc.groupRules)) {
      if (r.dockTargetGroupKey === oldDetachedKey) {
        r.dockTargetGroupKey = oldTarget;
      }
    }
    delete doc.groupRules[oldDetachedKey];
    saveDraftToLocal();
  }

  function splitSiblingGroupAtIndex(groupKey: string, splitAfterIndex: number) {
    const doc = activeDocument.value;
    const sg = sceneGraph.value;
    if (!doc || !sg) return;
    const grp = sg.groups.find(g => g.groupKey === groupKey);
    if (!grp || grp.ownerDocumentId !== doc.id) return;
    if (grp.memberIds.length < 2 || splitAfterIndex < 0 || splitAfterIndex >= grp.memberIds.length - 1) {
      return;
    }

    pushUndoSnapshot();
    const leftMembers = grp.memberIds.slice(0, splitAfterIndex + 1);
    const rightMembers = grp.memberIds.slice(splitAfterIndex + 1);
    const basePrefix = grp.anchorParentId
      ? `${doc.id}::grp_${grp.anchorParentId}`
      : `${doc.id}::grp_root`;
    const rightGroupKey = `${basePrefix}::split_${rightMembers[0]}`;

    const leftAlreadyCustom = leftMembers.some(mid => Boolean(doc.personRules[mid]?.customGroupKey));
    if (leftAlreadyCustom || grp.groupKey !== basePrefix) {
      for (const mid of leftMembers) {
        ensurePersonRule(doc, mid).customGroupKey = grp.groupKey;
      }
    }
    for (const mid of rightMembers) {
      ensurePersonRule(doc, mid).customGroupKey = rightGroupKey;
    }

    const oldGroupRule = doc.groupRules[grp.groupKey];
    const rightRule = ensureGroupRule(doc, rightGroupKey, grp.anchorParentId);
    rightRule.maxColumnsPerRow = oldGroupRule?.maxColumnsPerRow ?? null;
    rightRule.levelOverride = oldGroupRule?.levelOverride ?? null;
    rightRule.dockTargetGroupKey = null;
    rightRule.relativeDeltaX = 0;

    // Rechts angedockte Nachbarn bleiben an der rechten Teilgruppe verankert
    for (const [k, r] of Object.entries(doc.groupRules)) {
      if (k !== rightGroupKey && r.dockTargetGroupKey === grp.groupKey) {
        r.dockTargetGroupKey = rightGroupKey;
      }
    }

    layoutRevision.value++;
    const updatedSg = sceneGraph.value;
    const newLeftGrp = updatedSg?.groups.find(g => g.groupKey === grp.groupKey);
    const newRightGrp = updatedSg?.groups.find(g => g.groupKey === rightGroupKey);
    if (newLeftGrp && newRightGrp) {
      const desiredRightX = newLeftGrp.x + newLeftGrp.width + BRANCH_GAP_X;
      rightRule.relativeDeltaX = Math.round((desiredRightX - newRightGrp.x) * 10) / 10;
      layoutRevision.value++;
    }

    isDirty.value = true;
    saveDraftToLocal();
    showStatus('Gruppe an der gewählten Stelle aufgetrennt.');
  }

  function splitDockedClusterAtGroup(rightGroupKey: string) {
    const doc = activeDocument.value;
    const sg = sceneGraph.value;
    if (!doc || !sg) return;
    const rightGrp = sg.groups.find(g => g.groupKey === rightGroupKey);
    if (!rightGrp || rightGrp.ownerDocumentId !== doc.id) return;

    const leftTargetKey =
      doc.groupRules[rightGroupKey]?.dockTargetGroupKey ?? rightGrp.dockTargetGroupKey ?? null;
    if (!leftTargetKey) return;

    pushUndoSnapshot();
    const rightRule = ensureGroupRule(doc, rightGroupKey, rightGrp.anchorParentId);
    rightRule.dockTargetGroupKey = null;
    rightRule.relativeDeltaX = 0;
    layoutRevision.value++;

    const updatedSg = sceneGraph.value;
    const newLeftGrp = updatedSg?.groups.find(g => g.groupKey === leftTargetKey);
    const newRightGrp = updatedSg?.groups.find(g => g.groupKey === rightGroupKey);
    if (newLeftGrp && newRightGrp) {
      const desiredX = newLeftGrp.x + newLeftGrp.width + BRANCH_GAP_X;
      rightRule.relativeDeltaX = Math.round((desiredX - newRightGrp.x) * 10) / 10;
      layoutRevision.value++;
    }

    isDirty.value = true;
    saveDraftToLocal();
    showStatus('Angedockter Gruppen-Verband an der Trennstelle gelöst.');
  }

  function mergeSplitSiblingGroups(groupKey: string) {
    const doc = activeDocument.value;
    const sg = sceneGraph.value;
    if (!doc || !sg) return;
    const grp = sg.groups.find(g => g.groupKey === groupKey);
    if (!grp || grp.ownerDocumentId !== doc.id) return;

    const siblingParts = sg.groups.filter(
      g =>
        g.ownerDocumentId === doc.id &&
        g.anchorParentId === grp.anchorParentId &&
        (g.marriageIndex ?? null) === (grp.marriageIndex ?? null)
    );
    const customKeysUsed = new Set<string>();
    for (const part of siblingParts) {
      for (const mid of part.memberIds) {
        const ck = doc.personRules[mid]?.customGroupKey;
        if (ck) customKeysUsed.add(ck);
      }
    }
    if (customKeysUsed.size === 0) return;

    pushUndoSnapshot();
    for (const part of siblingParts) {
      for (const mid of part.memberIds) {
        if (doc.personRules[mid]) {
          doc.personRules[mid].customGroupKey = null;
        }
      }
    }

    const basePrefix = grp.anchorParentId
      ? `${doc.id}::grp_${grp.anchorParentId}`
      : `${doc.id}::grp_root`;
    const naturalFallbackKey =
      siblingParts.find(p => !customKeysUsed.has(p.groupKey))?.groupKey || basePrefix;

    for (const r of Object.values(doc.groupRules)) {
      if (r.dockTargetGroupKey && customKeysUsed.has(r.dockTargetGroupKey)) {
        r.dockTargetGroupKey =
          r.groupKey === naturalFallbackKey ? null : naturalFallbackKey;
      }
    }
    for (const oldKey of customKeysUsed) {
      if (oldKey !== naturalFallbackKey) {
        delete doc.groupRules[oldKey];
      }
    }

    isDirty.value = true;
    layoutRevision.value++;
    saveDraftToLocal();
    showStatus('Getrennte Geschwister-Teilgruppen wieder zusammengeführt.');
  }

  function hasManualOffset(personId?: string | null, groupKey?: string | null): boolean {
    const doc = activeDocument.value;
    if (!doc) return false;
    if (personId) {
      const c = doc.groupRules[`__card_offset__::${personId}`];
      if (c && Math.abs(c.relativeDeltaX || 0) >= 0.5) {
        return true;
      }
    }
    if (groupKey) {
      const sceneGrp = sceneGraph.value?.groups.find(g => g.groupKey === groupKey);
      const headKey = sceneGrp?.dockClusterKey || groupKey;
      const g = doc.groupRules[headKey];
      if (g && Math.abs(g.relativeDeltaX || 0) >= 0.5) {
        return true;
      }
    }
    return false;
  }

  function resetManualOffset(personId?: string | null, groupKey?: string | null) {
    const doc = activeDocument.value;
    if (!doc) return;
    if (!hasManualOffset(personId, groupKey)) return;
    pushUndoSnapshot();
    if (personId) {
      const c = doc.groupRules[`__card_offset__::${personId}`];
      if (c) {
        c.relativeDeltaX = 0;
        c.levelOverride = null;
      }
    }
    if (groupKey) {
      const sceneGrp = sceneGraph.value?.groups.find(g => g.groupKey === groupKey);
      const headKey = sceneGrp?.dockClusterKey || groupKey;
      const g = doc.groupRules[headKey];
      if (g) {
        g.relativeDeltaX = 0;
      }
    }
    saveDraftToLocal();
  }

  function togglePersonHidden(personId: string) {
    const doc = activeDocument.value;
    if (!doc || personId === doc.rootPersonId) return;
    pushUndoSnapshot();
    const pr = ensurePersonRule(doc, personId);
    pr.isHidden = !pr.isHidden;
    saveDraftToLocal();
  }

  function unhideAllPersons() {
    const doc = activeDocument.value;
    if (!doc) return;
    pushUndoSnapshot();
    for (const pr of Object.values(doc.personRules)) {
      pr.isHidden = false;
    }
    saveDraftToLocal();
  }

  function toggleSplitChildrenByMarriage(personId: string) {
    const doc = activeDocument.value;
    if (!doc) return;
    pushUndoSnapshot();
    const pr = ensurePersonRule(doc, personId);
    pr.splitChildrenByMarriage = !pr.splitChildrenByMarriage;
    saveDraftToLocal();
  }

  function switchImplexBranchParent(affectedChildIds: string[], chosenParentId: string) {
    const doc = activeDocument.value;
    if (!doc || affectedChildIds.length === 0) return;
    pushUndoSnapshot();
    for (const d of Object.values(documentsById.value)) {
      for (const cid of affectedChildIds) {
        const pr = ensurePersonRule(d, cid);
        pr.implexActiveParentId = chosenParentId;
      }
    }
    saveDraftToLocal();
    showStatus('Implex-Kinderzweig zum gewählten Elternteil umgehängt.');
  }

  function updateEdgeWaypoint(
    edgeKey: string,
    parentPersonId: string,
    deltaLaneY: number,
    deltaChannelX: number = 0
  ) {
    const doc = activeDocument.value;
    if (!doc) return;
    pushUndoSnapshot();
    if (!doc.edgeWaypoints[edgeKey]) {
      doc.edgeWaypoints[edgeKey] = {
        edgeKey,
        parentPersonId,
        laneOffsetDelta: 0,
        verticalChannelDeltaX: 0,
      };
    }
    const wp = doc.edgeWaypoints[edgeKey];
    wp.laneOffsetDelta = Math.round((wp.laneOffsetDelta + deltaLaneY) * 10) / 10;
    wp.verticalChannelDeltaX = Math.round((wp.verticalChannelDeltaX + deltaChannelX) * 10) / 10;
    saveDraftToLocal();
  }

  function resetEdgeWaypoint(edgeKey: string) {
    const doc = activeDocument.value;
    if (!doc || !doc.edgeWaypoints[edgeKey]) return;
    pushUndoSnapshot();
    delete doc.edgeWaypoints[edgeKey];
    saveDraftToLocal();
  }

  // ============================================================================
  // Sub-Bäume (Beliebig schachtelbar, Dual-Modus Inline vs. Verweis-Kapsel)
  // ============================================================================

  async function createAndMountSubtree(anchorPersonId: string, customName?: string) {
    const doc = activeDocument.value;
    if (!doc || !anchorPersonId || anchorPersonId === doc.rootPersonId) return;

    if (!activeStammahnMemberIds.value.has(anchorPersonId)) {
      showError('Sub-Bäume können nur für Nachkommen des aktiven Stammahns angelegt werden.');
      return;
    }

    const p = persons.value.find(x => x.id === anchorPersonId);
    const pName = p ? `${p.given_name || ''} ${p.surname || ''}`.trim() : anchorPersonId;
    const henry = getPersonHenryCode(anchorPersonId);
    const defaultSubName = henry ? `[${henry}] Zweig ${pName}` : `Zweig ${pName}`;
    const subName = (customName || defaultSubName).trim();

    try {
      // Sofort ein echtes Sub-Dokument in SQLite anlegen, damit IDs & Foreign Keys konsistent sind
      const freshSub = createFreshDocument(anchorPersonId, subName, 'subtree', doc.cardConfig);
      freshSub.growthDirection = doc.growthDirection;
      freshSub.lineagePolicy = doc.lineagePolicy;
      freshSub.routingStyle = doc.routingStyle;
      freshSub.cardDensityProfile = doc.cardDensityProfile;

      // Bestehende Implex- & Level-Regeln von Personen unterhalb von anchorPersonId in den Sub-Baum mitnehmen
      const descLineage = resolveGenealogyTree(
        freshSub,
        persons.value,
        resolveLocale(locale.value) ?? FALLBACK_LOCALE,
        effectiveRootId.value,
        doc
      );
      syncLineageRulesToDocs(doc, [freshSub]);
      for (const pid of descLineage.resolvedMeta.keys()) {
        if (doc.personRules[pid]) {
          freshSub.personRules[pid] = {
            ...doc.personRules[pid],
            customGroupKey: null,
          };
        }
      }

      const summary = await invoke<DesignDocumentSummaryDto>('save_design_document_v2', {
        document: modelToDto(freshSub),
        overwriteSameName: false,
      });
      freshSub.id = summary.id;
      freshSub.updatedAt = summary.updated_at;

      pushUndoSnapshot();
      documentsById.value[freshSub.id] = freshSub;
      doc.subtreeMounts[anchorPersonId] = {
        anchorPersonId,
        subDocumentId: freshSub.id,
        displayMode: 'inline',
        relativeDeltaX: 0,
      };
      // Übergeordnetes Design mitspeichern oder zumindest Draft sichern
      saveDraftToLocal();
      await refreshDocumentCatalogs();
      showStatus(`Sub-Baum "${subName}" erstellt und an ${pName} eingebunden.`);
    } catch (err) {
      showError(`Sub-Baum konnte nicht erstellt werden: ${String(err)}`);
    }
  }

  async function mountExistingSubtree(anchorPersonId: string, subDocumentId: string) {
    const doc = activeDocument.value;
    if (!doc || !anchorPersonId) return;
    try {
      const bundle = await invoke<DesignTreeBundleDto>('load_design_tree_bundle', {
        documentId: subDocumentId,
      });
      const subRoot = dtoToModel(bundle.root_document);
      if (subRoot.id === doc.id) {
        showError('Selbstreferenz nicht möglich.');
        return;
      }
      if (!activeStammahnMemberIds.value.has(subRoot.rootPersonId || anchorPersonId)) {
        showError('Dieser Sub-Baum gehört nicht zum aktuell gewählten Stammahn.');
        return;
      }
      pushUndoSnapshot();
      const loadedSubs: DesignDocumentModel[] = [subRoot];
      documentsById.value[subRoot.id] = subRoot;
      for (const [sid, sdto] of Object.entries(bundle.sub_documents || {})) {
        const subModel = dtoToModel(sdto);
        documentsById.value[sid] = subModel;
        loadedSubs.push(subModel);
      }
      syncLineageRulesToDocs(doc, loadedSubs);
      for (const [aid, dataUrl] of Object.entries(bundle.media_assets || {})) {
        mediaAssets.value[aid] = dataUrl;
      }
      for (const [aid, m] of Object.entries(bundle.media_metas || {})) {
        mediaMetas.value[aid] = {
          id: m.id,
          fileName: m.file_name,
          mimeType: m.mime_type,
          width: m.width,
          height: m.height,
          byteSize: m.byte_size,
          createdAt: m.created_at,
        };
      }
      const targetAnchorId = subRoot.rootPersonId || anchorPersonId;
      doc.subtreeMounts[targetAnchorId] = {
        anchorPersonId: targetAnchorId,
        subDocumentId: subRoot.id,
        displayMode: 'inline',
        relativeDeltaX: 0,
      };
      saveDraftToLocal();
      showStatus(`Sub-Baum "${subRoot.name}" eingebunden.`);
    } catch (err) {
      showError(`Einbindung fehlgeschlagen: ${String(err)}`);
    }
  }

  async function openSubtreeFromCatalog(subDocumentId: string) {
    isLoading.value = true;
    try {
      const bundle = await invoke<DesignTreeBundleDto>('load_design_tree_bundle', {
        documentId: subDocumentId,
      });
      const subRoot = dtoToModel(bundle.root_document);
      if (!activeStammahnMemberIds.value.has(subRoot.rootPersonId)) {
        showError('Dieser Sub-Baum gehört nicht zum aktuell gewählten Stammahn.');
        return;
      }
      const henry = getPersonHenryCode(subRoot.rootPersonId);
      const currentMaster =
        (breadcrumbStack.value[0]?.documentId && documentsById.value[breadcrumbStack.value[0].documentId]) ||
        null;

      const loadedSubs: DesignDocumentModel[] = [subRoot];
      documentsById.value[subRoot.id] = subRoot;
      for (const [sid, sdto] of Object.entries(bundle.sub_documents || {})) {
        const subModel = dtoToModel(sdto);
        documentsById.value[sid] = subModel;
        loadedSubs.push(subModel);
      }
      const syncSource = currentMaster || activeDocument.value;
      if (syncSource) {
        syncLineageRulesToDocs(syncSource, loadedSubs);
      }
      for (const [aid, dataUrl] of Object.entries(bundle.media_assets || {})) {
        mediaAssets.value[aid] = dataUrl;
      }
      for (const [aid, m] of Object.entries(bundle.media_metas || {})) {
        mediaMetas.value[aid] = {
          id: m.id,
          fileName: m.file_name,
          mimeType: m.mime_type,
          width: m.width,
          height: m.height,
          byteSize: m.byte_size,
          createdAt: m.created_at,
        };
      }

      if (currentMaster && currentMaster.documentKind === 'master') {
        breadcrumbStack.value = [
          {
            documentId: currentMaster.id,
            name: currentMaster.name,
            rootPersonId: currentMaster.rootPersonId,
            documentKind: 'master',
          },
          {
            documentId: subRoot.id,
            name: subRoot.name,
            rootPersonId: subRoot.rootPersonId,
            documentKind: 'subtree',
          },
        ];
      } else {
        breadcrumbStack.value = [
          {
            documentId: subRoot.id,
            name: subRoot.name,
            rootPersonId: subRoot.rootPersonId,
            documentKind: 'subtree',
          },
        ];
      }

      activeDocumentId.value = subRoot.id;
      isSplitToolActive.value = false;
      undoStack.value = [];
      redoStack.value = [];
      isDirty.value = false;
      selectedPersonId.value = '';
      selectedGroupKey.value = '';
      selectedEdgeKey.value = '';
      saveDraftToLocal();
      showStatus(
        henry
          ? `Sub-Baum "${subRoot.name}" ([${henry}]) geöffnet.`
          : `Sub-Baum "${subRoot.name}" geöffnet.`
      );
    } catch (err) {
      showError(`Sub-Baum konnte nicht geladen werden: ${String(err)}`);
    } finally {
      isLoading.value = false;
    }
  }

  function unmountSubtree(anchorPersonId: string) {
    const doc = activeDocument.value;
    if (!doc || !doc.subtreeMounts[anchorPersonId]) return;
    pushUndoSnapshot();
    delete doc.subtreeMounts[anchorPersonId];
    saveDraftToLocal();
  }

  function setSubtreeDisplayMode(anchorPersonId: string, mode: SubtreeDisplayMode) {
    const doc = activeDocument.value;
    const mount = doc?.subtreeMounts[anchorPersonId];
    if (!doc || !mount || mount.displayMode === mode) return;
    pushUndoSnapshot();
    mount.displayMode = mode;
    saveDraftToLocal();
  }

  async function enterSubtree(subDocumentId: string) {
    if (!documentsById.value[subDocumentId]) {
      try {
        const bundle = await invoke<DesignTreeBundleDto>('load_design_tree_bundle', {
          documentId: subDocumentId,
        });
        const loadedRoot = dtoToModel(bundle.root_document);
        const loadedSubs: DesignDocumentModel[] = [loadedRoot];
        documentsById.value[subDocumentId] = loadedRoot;
        for (const [sid, sdto] of Object.entries(bundle.sub_documents || {})) {
          const subModel = dtoToModel(sdto);
          documentsById.value[sid] = subModel;
          loadedSubs.push(subModel);
        }
        if (activeDocument.value) {
          syncLineageRulesToDocs(activeDocument.value, loadedSubs);
        }
        for (const [aid, dataUrl] of Object.entries(bundle.media_assets || {})) {
          mediaAssets.value[aid] = dataUrl;
        }
      } catch (err) {
        showError(`Sub-Baum konnte nicht geöffnet werden: ${String(err)}`);
        return;
      }
    }

    const target = documentsById.value[subDocumentId];
    if (!target) return;

    // Verhindern, dass Breadcrumb denselben Eintrag doppelt pusht
    const existingIdx = breadcrumbStack.value.findIndex(b => b.documentId === subDocumentId);
    if (existingIdx !== -1) {
      breadcrumbStack.value = breadcrumbStack.value.slice(0, existingIdx + 1);
    } else {
      breadcrumbStack.value.push({
        documentId: target.id,
        name: target.name,
        rootPersonId: target.rootPersonId,
        documentKind: target.documentKind,
      });
    }
    activeDocumentId.value = target.id;
    isSplitToolActive.value = false;
    undoStack.value = [];
    redoStack.value = [];
    selectedPersonId.value = '';
    selectedGroupKey.value = '';
    saveDraftToLocal();
  }

  function navigateBreadcrumb(index: number) {
    if (index < 0 || index >= breadcrumbStack.value.length) return;
    const target = breadcrumbStack.value[index];
    breadcrumbStack.value = breadcrumbStack.value.slice(0, index + 1);
    activeDocumentId.value = target.documentId;
    isSplitToolActive.value = false;
    undoStack.value = [];
    redoStack.value = [];
    selectedPersonId.value = '';
    selectedGroupKey.value = '';
    saveDraftToLocal();
  }

  // ============================================================================
  // Hintergrundbild / Wappen (Direkt in SQLite media_assets mit SHA-256!)
  // ============================================================================

  async function uploadBackgroundAsset(file: File) {
    const doc = activeDocument.value;
    if (!doc) return;
    try {
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result));
        reader.onerror = () => reject(new Error('Datei konnte nicht gelesen werden.'));
        reader.readAsDataURL(file);
      });

      const dims = await new Promise<{ w: number; h: number }>(resolve => {
        const img = new Image();
        img.onload = () => resolve({ w: img.naturalWidth || 600, h: img.naturalHeight || 600 });
        img.onerror = () => resolve({ w: 600, h: 600 });
        img.src = dataUrl;
      });

      const meta = await invoke<MediaAssetMetaDto>('upload_design_media_asset', {
        fileName: file.name,
        dataUrl,
        width: dims.w,
        height: dims.h,
      });

      mediaAssets.value[meta.id] = dataUrl;
      mediaMetas.value[meta.id] = {
        id: meta.id,
        fileName: meta.file_name,
        mimeType: meta.mime_type,
        width: meta.width,
        height: meta.height,
        byteSize: meta.byte_size,
        createdAt: meta.created_at,
      };

      pushUndoSnapshot();
      doc.bgAssetId = meta.id;
      doc.bgConfig = {
        ...doc.bgConfig,
        visible: true,
        fileName: file.name,
        naturalWidth: dims.w,
        naturalHeight: dims.h,
        lockAspectRatio: true,
      };
      saveDraftToLocal();
      showStatus(`Bild "${file.name}" direkt in Projekt-Datenbank gespeichert.`);
    } catch (err) {
      showError(`Bild-Upload fehlgeschlagen: ${String(err)}`);
    }
  }

  function updateBackgroundConfig(partial: Partial<DesignBackgroundConfig>, recordUndo = false) {
    const doc = activeDocument.value;
    if (!doc) return;
    if (recordUndo) pushUndoSnapshot();
    doc.bgConfig = { ...doc.bgConfig, ...partial, lockAspectRatio: true };
    saveDraftToLocal();
  }

  function removeBackgroundAsset() {
    const doc = activeDocument.value;
    if (!doc) return;
    pushUndoSnapshot();
    doc.bgAssetId = null;
    doc.bgConfig = { ...DEFAULT_BACKGROUND_CONFIG };
    saveDraftToLocal();
  }

  // ============================================================================
  // Datei-Export/-Import (JSON Design & AES-256 Verschlüsseltes Projekt .lgproj)
  // ============================================================================

  async function exportDesignToJsonFile() {
    const b = currentBundle.value;
    if (!b) return;
    try {
      const cleanName = b.rootDocument.name.replace(/[^a-zA-Z0-9äöüÄÖÜß_-]+/g, '_');
      const filePath = await save({
        title: 'Design-Vorlage als JSON speichern',
        defaultPath: `${cleanName || 'stammbaum_design'}.json`,
        filters: [{ name: 'Design-Dokument (*.json)', extensions: ['json'] }],
      });
      if (!filePath || typeof filePath !== 'string') return;
      const payload = {
        format: 'lineagegraph-design-v2',
        rootDocument: modelToDto(b.rootDocument),
        subDocuments: Object.fromEntries(
          Object.entries(b.subDocuments).map(([k, v]) => [k, modelToDto(v)])
        ),
        mediaAssets: b.mediaAssets,
        mediaMetas: b.mediaMetas,
      };
      await invoke('save_design_file', {
        filePath,
        content: JSON.stringify(payload, null, 2),
      });
      showStatus(`Design nach ${filePath} exportiert.`);
    } catch (err) {
      showError(`JSON-Export fehlgeschlagen: ${String(err)}`);
    }
  }

  async function importDesignFromJsonFile() {
    try {
      const selected = await open({
        title: 'Design-JSON laden',
        multiple: false,
        filters: [{ name: 'Design-Dokument (*.json)', extensions: ['json'] }],
      });
      if (!selected || typeof selected !== 'string') return;
      const content = await invoke<string>('read_design_file', { filePath: selected });
      const parsed = JSON.parse(content);
      if (parsed?.format !== 'lineagegraph-design-v2' || !parsed?.rootDocument) {
        showError('Unbekanntes oder altes Design-JSON-Format.');
        return;
      }
      const rootModel = dtoToModel(parsed.rootDocument);
      const docs: Record<string, DesignDocumentModel> = { [rootModel.id]: rootModel };
      for (const [k, v] of Object.entries(parsed.subDocuments || {})) {
        docs[k] = dtoToModel(v as DesignDocumentDto);
      }
      documentsById.value = docs;
      mediaAssets.value = { ...mediaAssets.value, ...(parsed.mediaAssets || {}) };
      activeDocumentId.value = rootModel.id;
      breadcrumbStack.value = [
        {
          documentId: rootModel.id,
          name: rootModel.name,
          rootPersonId: rootModel.rootPersonId,
          documentKind: rootModel.documentKind,
        },
      ];
      isDirty.value = true;
      saveDraftToLocal();
      showStatus(`Design "${rootModel.name}" aus Datei geladen.`);
    } catch (err) {
      showError(`Import fehlgeschlagen: ${String(err)}`);
    }
  }

  async function exportEncryptedProjectPackage(password: string): Promise<boolean> {
    if (!password || password.length < 4) {
      showError('Bitte ein Passwort mit mindestens 4 Zeichen eingeben.');
      return false;
    }
    try {
      const baseName = (activeDocument.value?.name || 'lineagegraph_projekt').replace(
        /[^a-zA-Z0-9äöüÄÖÜß_-]+/g,
        '_'
      );
      const filePath = await save({
        title: 'Verschlüsseltes Projektpaket exportieren (.lgproj)',
        defaultPath: `${baseName}.lgproj`,
        filters: [{ name: 'Verschlüsseltes LineageGraph-Projekt (*.lgproj)', extensions: ['lgproj'] }],
      });
      if (!filePath || typeof filePath !== 'string') return false;
      const savedPath = await invoke<string>('export_encrypted_project', {
        filePath,
        password,
      });
      showStatus(`Verschlüsseltes Projekt exportiert: ${savedPath}`);
      return true;
    } catch (err) {
      showError(`Verschlüsselter Export fehlgeschlagen: ${String(err)}`);
      return false;
    }
  }

  async function importEncryptedProjectPackage(
    filePath: string,
    targetTreeName: string,
    password: string
  ): Promise<string | null> {
    try {
      const importedTreeName = await invoke<string>('import_encrypted_project', {
        filePath,
        targetTreeName,
        password,
      });
      showStatus(`Projekt "${importedTreeName}" entschlüsselt und geladen!`);
      return importedTreeName;
    } catch (err) {
      showError(String(err));
      return null;
    }
  }

  watch(effectiveRootId, (nextRoot, prevRoot) => {
    if (nextRoot && nextRoot !== prevRoot) {
      initStudioForActiveRoot();
    }
  });

  return {
    // State
    activeDocument,
    activeDocumentId,
    documentsById,
    mediaAssets,
    mediaMetas,
    breadcrumbStack,
    savedMasterList,
    savedSubtreeList,
    sceneGraph,
    selectedPersonId,
    selectedGroupKey,
    selectedEdgeKey,
    showLevelGrid,
    isSplitToolActive,
    dragPreview,
    statusToast,
    errorToast,
    isDirty,
    isLoading,
    canUndo,
    canRedo,
    isInSubtreeMode,
    effectiveRootId,

    // Lifecycle & Persistence
    initStudioForActiveRoot,
    refreshDocumentCatalogs,
    loadDocumentById,
    saveActiveDocument,
    deleteSavedDocument,
    resetToDefaultLayout,

    // History
    undo,
    redo,

    // Policies & Card Config
    setGrowthDirection,
    setLineagePolicy,
    setRoutingStyle,
    setEnableLineBridges,
    setCardDensityProfile,
    updateCardConfig,

    // Layout & Graph Editing
    setGroupMaxColumns,
    shiftGroupLevel,
    moveGroupRelativeX,
    beginInteractiveDrag,
    finishInteractiveDrag,
    getCardManualOffset,
    getGroupRelativeX,
    setCardManualOffset,
    moveCardManualOffset,
    setGroupRelativeXLive,
    moveGroupRelativeXLive,
    hasManualOffset,
    resetManualOffset,
    dockGroupCluster,
    dockClusterToNeighbor,
    undockGroup,
    detachCardFromSiblingGroup,
    reattachCardToSiblingGroup,
    splitSiblingGroupAtIndex,
    splitDockedClusterAtGroup,
    mergeSplitSiblingGroups,
    togglePersonHidden,
    unhideAllPersons,
    toggleSplitChildrenByMarriage,
    switchImplexBranchParent,
    updateEdgeWaypoint,
    resetEdgeWaypoint,

    // Subtrees & Henry Lookup
    getPersonHenryCode,
    createAndMountSubtree,
    mountExistingSubtree,
    openSubtreeFromCatalog,
    unmountSubtree,
    setSubtreeDisplayMode,
    enterSubtree,
    navigateBreadcrumb,

    // Assets & Encrypted Export
    uploadBackgroundAsset,
    updateBackgroundConfig,
    removeBackgroundAsset,
    exportDesignToJsonFile,
    importDesignFromJsonFile,
    exportEncryptedProjectPackage,
    importEncryptedProjectPackage,
    // UI visibility state
    setShowLevelGrid: (val: boolean) => {
      showLevelGrid.value = val;
    },
    setSplitToolActive: (val: boolean) => {
      isSplitToolActive.value = val;
    },
    toggleSplitTool: () => {
      isSplitToolActive.value = !isSplitToolActive.value;
    },
  };
}

export function bundleDtoToModel(bundleDto: DesignTreeBundleDto): DesignTreeBundle {
  const rootDocument = dtoToModel(bundleDto.root_document);
  const subDocuments: Record<string, DesignDocumentModel> = {};
  for (const [sid, sdto] of Object.entries(bundleDto.sub_documents || {})) {
    subDocuments[sid] = dtoToModel(sdto);
  }
  const mediaMetas: Record<string, MediaAssetMeta> = {};
  for (const [aid, m] of Object.entries(bundleDto.media_metas || {})) {
    mediaMetas[aid] = {
      id: m.id,
      fileName: m.file_name,
      mimeType: m.mime_type,
      width: m.width,
      height: m.height,
      byteSize: m.byte_size,
      createdAt: m.created_at,
    };
  }
  return {
    rootDocument,
    subDocuments,
    mediaAssets: bundleDto.media_assets || {},
    mediaMetas,
  };
}

export type DesignStudioStore = ReturnType<typeof useDesignStudioStore>;
