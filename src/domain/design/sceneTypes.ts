import type { DesignBackgroundConfig, DesignCardConfig } from '../../types/design';

export type GrowthDirection = 'bottom_up' | 'top_down';
export type LineagePolicy = 'patrilinear' | 'matrilinear' | 'oldest_branch';
export type RoutingStyle = 'orthogonal_bus' | 'organic_bezier';
export type CardDensityProfile = 'detail' | 'standard' | 'compact_years' | 'narrow';
export type SubtreeDisplayMode = 'inline' | 'capsule';

export interface PersonDesignRule {
  personId: string;
  isHidden: boolean;
  customGroupKey?: string | null;
  levelOffset: number;
  implexActiveParentId?: string | null;
  splitChildrenByMarriage: boolean;
}

export interface GroupDesignRule {
  groupKey: string;
  anchorParentId?: string | null;
  maxColumnsPerRow: number | null;
  relativeDeltaX: number;
  dockTargetGroupKey?: string | null;
  customMemberIds?: string[] | null;
  levelOverride?: number | null;
}

export interface SubtreeMountRule {
  anchorPersonId: string;
  subDocumentId: string;
  displayMode: SubtreeDisplayMode;
  relativeDeltaX: number;
}

export interface EdgeWaypointRule {
  edgeKey: string;
  parentPersonId: string;
  laneOffsetDelta: number;
  verticalChannelDeltaX: number;
}

export interface MediaAssetMeta {
  id: string;
  fileName: string;
  mimeType: string;
  width: number;
  height: number;
  byteSize: number;
  createdAt: string;
}

export interface DesignDocumentModel {
  id: string;
  name: string;
  rootPersonId: string;
  documentKind: 'master' | 'subtree';
  growthDirection: GrowthDirection;
  lineagePolicy: LineagePolicy;
  routingStyle: RoutingStyle;
  enableLineBridges: boolean;
  cardDensityProfile: CardDensityProfile;
  cardConfig: DesignCardConfig;
  bgAssetId: string | null;
  bgConfig: DesignBackgroundConfig;
  createdAt: string;
  updatedAt: string;
  personRules: Record<string, PersonDesignRule>;
  groupRules: Record<string, GroupDesignRule>;
  subtreeMounts: Record<string, SubtreeMountRule>;
  edgeWaypoints: Record<string, EdgeWaypointRule>;
}

export interface DesignTreeBundle {
  masterRootPersonId?: string;
  rootDocument: DesignDocumentModel;
  subDocuments: Record<string, DesignDocumentModel>;
  mediaAssets: Record<string, string>; // assetId -> dataUrl
  mediaMetas: Record<string, MediaAssetMeta>;
}

// ============================================================================
// Resolved Genealogical Tree Model (Layer 2)
// ============================================================================

export interface SceneSpouseRow {
  partnerId: string;
  orderIndex: number; // 1-based marriage index
  fullName: string;
  henryCode?: string;
  marriageText?: string;
  divorceText?: string;
  birthText?: string;
  deathText?: string;
  implexTargetParentId?: string;
  implexTargetCode?: string;
  implexIsHere?: boolean;
}

export interface SceneImplexBadge {
  partnerId: string;
  partnerName: string;
  partnerCode: string;
  childCount: number;
  isBranchAttachedHere: boolean;
  /** Clicking sets `implexActiveParentId` on all children of this couple */
  affectedChildIds: string[];
  chosenParentIdIfClicked: string;
}

export interface ResolvedGroupNode {
  groupKey: string;
  ownerDocumentId: string;
  anchorParentId: string | null;
  marriageIndex?: number;
  marriageLabel?: string;
  baseGeneration: number;
  level: number;
  memberIds: string[];
  maxColumnsPerRow: number | null;
  relativeDeltaX: number;
  dockTargetGroupKey?: string | null;
  isSubtree: boolean;
  subDocumentId?: string;
  isSplit?: boolean;
  /** Nested inline Subtree mounted inside this group at one of its members */
  childGroups: ResolvedGroupNode[];
}

// ============================================================================
// Unified Scene-Graph (Layer 5 Single Source of Truth)
// ============================================================================

export interface SceneLevelBand {
  level: number;
  label: string;
  topY: number;
  bottomY: number;
  height: number;
  contentTopY: number;
  contentHeight: number;
}

export interface SceneBackgroundLayer {
  id: string;
  scope: 'master' | 'subtree';
  ownerDocumentId: string;
  title?: string;
  dataUrl: string;
  x: number;
  y: number;
  width: number;
  height: number;
  opacity: number;
}

export interface SceneSubtreeFrame {
  subDocumentId: string;
  subDocumentName: string;
  anchorPersonId: string;
  parentDocumentId: string;
  displayMode: SubtreeDisplayMode;
  levelMin: number;
  levelMax: number;
  x: number;
  y: number;
  width: number;
  height: number;
  personCount: number;
  generationSpan: number;
  depth: number;
}

export interface SceneSiblingGroup {
  groupKey: string;
  ownerDocumentId: string;
  anchorParentId: string | null;
  marriageIndex?: number;
  marriageLabel?: string;
  level: number;
  x: number;
  y: number;
  width: number;
  height: number;
  maxColumnsPerRow: number | null;
  rowCount: number;
  columnCount: number;
  colCentersX: number[];
  channelCentersX: number[];
  rowTopsY: number[];
  rowHeights: number[];
  isSubtree: boolean;
  subDocumentId?: string;
  relativeDeltaX: number;
  dockTargetGroupKey?: string | null;
  dockClusterKey?: string;
  isDocked?: boolean;
  isSplit?: boolean;
  memberIds: string[];
}

export interface ScenePersonCard {
  personId: string;
  ownerDocumentId: string;
  groupKey: string;
  level: number;
  rowIndex: number;
  colIndex: number;
  x: number;
  y: number;
  width: number;
  height: number;
  densityProfile: CardDensityProfile;
  cardConfig: DesignCardConfig;
  henryCode: string;
  generation: number;
  givenName: string;
  surname: string;
  fullName: string;
  sex: string;
  lifeLines: string[];
  occupationText?: string;
  spouses: SceneSpouseRow[];
  implexBadges: SceneImplexBadge[];
  hasChildrenInTree: boolean;
  isSubtreeMember: boolean;
  subDocumentId?: string;
  isCapsule: boolean;
  capsuleMeta?: {
    subDocumentId: string;
    name: string;
    personCount: number;
    generationSpan: number;
    anchorPersonId: string;
  };
}

export interface SceneBridgeArc {
  cx: number;
  cy: number;
  radius: number;
  orientation: 'horizontal' | 'vertical';
  sweepUp: boolean;
}

export interface SceneConnectorEdge {
  edgeKey: string;
  ownerDocumentId: string;
  parentPersonId: string;
  targetGroupKey: string;
  parentLevel: number;
  childLevel: number;
  marriageIndex?: number;
  marriageBadgeText?: string;
  marriageBadgePos?: { x: number; y: number };
  svgPath: string;
  trunkPath: string;
  branchPath: string;
  bridgeArcs: SceneBridgeArc[];
  trunkX1: number;
  trunkX2: number;
  trunkY: number;
  parentPortX: number;
  parentPortY: number;
  parentAnchor: {
    x: number;
    y: number;
    d: string;
  };
  childArrows: {
    x: number;
    y: number;
    points: string;
  }[];
  groupCenterX: number;
  busY: number;
  isSubtreeEdge: boolean;
  isFeedThrough: boolean;
}

export interface DesignSceneGraph {
  documentId: string;
  documentName: string;
  rootPersonId: string;
  growthDirection: GrowthDirection;
  lineagePolicy: LineagePolicy;
  routingStyle: RoutingStyle;
  enableLineBridges: boolean;
  levels: SceneLevelBand[];
  backgrounds: SceneBackgroundLayer[];
  subtreeFrames: SceneSubtreeFrame[];
  groups: SceneSiblingGroup[];
  cards: ScenePersonCard[];
  edges: SceneConnectorEdge[];
  bounds: {
    minX: number;
    minY: number;
    maxX: number;
    maxY: number;
    width: number;
    height: number;
  };
}
