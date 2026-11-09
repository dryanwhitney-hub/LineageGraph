export interface ExternalArchiveLinks {
  matricula_url: string | null;
  archion_url: string | null;
  familysearch_url: string | null;
  meyers_url: string | null;
}

export type GapType = 'MISSING_PARENTS' | 'MISSING_DEATH' | 'MISSING_PLACE' | 'CHILD_GAP';
export type TaskStatus = 'open' | 'in_progress' | 'completed' | 'ignored';
export type PriorityLabel = 'urgent' | 'high' | 'medium' | 'low';
export type ScopeType =
  | 'all'
  | 'proband_ancestors'
  | 'proband_descendants'
  | 'single_person'
  | 'person_ancestors'
  | 'person_descendants';

export type PortalAccessType = 'free' | 'free_registration' | 'subscription' | 'freemium';

export interface ResearchPortalConfig {
  id: string;
  name: string;
  category: string;
  description_de: string;
  description_en: string;
  access_type: PortalAccessType;
  enabled: boolean;
  url_template: string;
  icon?: string;
}

export interface ResearchSettings {
  max_age_years?: number;
  child_gap_years?: number;
  portals?: ResearchPortalConfig[];
}

export interface ResearchTaskDto {
  id: string;
  person_id: string;
  person_name: string;
  person_birth_date: string | null;
  person_birth_place: string | null;
  person_death_date: string | null;
  person_death_place: string | null;
  person_sex: string | null;
  proband_code: string | null;
  generation: number | null;
  gap_type: GapType | string;
  title: string;
  description: string;
  advice: string;
  archive_hint: string | null;
  links: ExternalArchiveLinks;
  priority_score: number;
  priority_label: PriorityLabel | string;
  status: TaskStatus | string;
  notes: string | null;
  context_json: string;
  created_at: string;
  updated_at: string;
}

export interface ResearchStatsDto {
  total_gaps: number;
  open_count: number;
  in_progress_count: number;
  completed_count: number;
  ignored_count: number;
  missing_parents_count: number;
  missing_death_count: number;
  missing_place_count: number;
  child_gap_count: number;
}


export interface ResearchScope {
  scope_type: ScopeType;
  proband_id?: string | null;
  person_id?: string | null;
}

export interface BranchPersonSummary {
  id: string;
  name: string;
  birth_date: string | null;
  death_date: string | null;
  birth_place: string | null;
  death_place: string | null;
  sex: string | null;
}

export interface SuggestedConnection {
  isolated_person_id: string;
  isolated_person_name: string;
  main_person_id: string;
  main_person_name: string;
  match_reason: string;
  confidence_score: number;
}

export interface IsolatedBranchDto {
  id: number;
  name: string;
  person_count: number;
  generation_depth: number;
  root_ancestors: BranchPersonSummary[];
  persons: BranchPersonSummary[];
  earliest_year: number | null;
  latest_year: number | null;
  top_places: string[];
  top_surnames: string[];
  suggested_connections: SuggestedConnection[];
}

export interface IsolatedBranchesResultDto {
  total_persons: number;
  total_components: number;
  main_tree_person_count: number;
  isolated_branches_count: number;
  isolated_individuals_count: number;
  branches: IsolatedBranchDto[];
}
