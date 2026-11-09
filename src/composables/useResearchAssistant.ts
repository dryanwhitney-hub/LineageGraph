import { ref, computed, watch } from 'vue';
import { invoke } from '@tauri-apps/api/core';
import type {
  ResearchTaskDto,
  ResearchStatsDto,
  ResearchSettings,
  ResearchScope,
  ScopeType,
  TaskStatus,
  IsolatedBranchesResultDto,
} from '../types/research';

const STORAGE_KEY_SETTINGS = 'lineagegraph_research_settings';

export function useResearchAssistant(activeProbandId: () => string | null, selectedPersonId: () => string | null) {
  const tasks = ref<ResearchTaskDto[]>([]);
  const isLoading = ref<boolean>(false);
  const error = ref<string | null>(null);

  // Isolated Branches state
  const isolatedBranchesData = ref<IsolatedBranchesResultDto | null>(null);
  const isLoadingBranches = ref<boolean>(false);
  const errorBranches = ref<string | null>(null);

  // Filter & Scope state
  const scopeType = ref<ScopeType>('all');
  const selectedGapType = ref<string>('all');
  const selectedStatus = ref<string>('all');
  const searchQuery = ref<string>('');
  const sortBy = ref<'priority' | 'name' | 'generation'>('priority');

  // Load persistent settings or fallback to sensible defaults
  const settings = ref<ResearchSettings>({
    max_age_years: 110,
    child_gap_years: 3.5,
  });

  try {
    const raw = localStorage.getItem(STORAGE_KEY_SETTINGS);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (typeof parsed.max_age_years === 'number') settings.value.max_age_years = parsed.max_age_years;
      if (typeof parsed.child_gap_years === 'number') settings.value.child_gap_years = parsed.child_gap_years;
    }
  } catch (e) {
    console.warn('Could not parse stored research settings:', e);
  }

  const saveSettings = (newSettings: ResearchSettings) => {
    settings.value = { ...settings.value, ...newSettings };
    try {
      localStorage.setItem(STORAGE_KEY_SETTINGS, JSON.stringify(settings.value));
    } catch (e) {
      console.warn('Could not persist research settings:', e);
    }
    loadTasks();
  };

  const loadTasks = async () => {
    isLoading.value = true;
    error.value = null;

    try {
      const scope: ResearchScope = {
        scope_type: scopeType.value,
        proband_id: activeProbandId(),
        person_id: selectedPersonId(),
      };

      const result = await invoke<ResearchTaskDto[]>('analyze_research_gaps', {
        scope,
        settings: settings.value,
      });

      tasks.value = result;
    } catch (err: any) {
      console.error('Failed to analyze research gaps:', err);
      error.value = err?.toString() || 'Fehler beim Ermitteln der Recherche-Lücken';
    } finally {
      isLoading.value = false;
    }
  };

  const updateTask = async (
    task: ResearchTaskDto,
    newStatus: TaskStatus,
    newNotes?: string | null
  ) => {
    try {
      const notesToSave = newNotes !== undefined ? newNotes : task.notes;

      await invoke('update_research_task_status', {
        taskId: task.id,
        personId: task.person_id,
        gapType: task.gap_type,
        contextJson: task.context_json,
        status: newStatus,
        notes: notesToSave,
        priorityScore: task.priority_score,
      });

      task.status = newStatus;
      if (newNotes !== undefined) {
        task.notes = newNotes;
      }
      task.updated_at = new Date().toISOString();
    } catch (err: any) {
      console.error('Failed to update task status:', err);
      error.value = err?.toString() || 'Fehler beim Aktualisieren der Aufgabe';
    }
  };

  const stats = computed<ResearchStatsDto>(() => {
    const list = tasks.value;
    let openCount = 0;
    let inProgressCount = 0;
    let completedCount = 0;
    let ignoredCount = 0;
    let missingParentsCount = 0;
    let missingDeathCount = 0;
    let missingPlaceCount = 0;
    let childGapCount = 0;

    for (const t of list) {
      if (t.status === 'open') openCount++;
      else if (t.status === 'in_progress') inProgressCount++;
      else if (t.status === 'completed') completedCount++;
      else if (t.status === 'ignored') ignoredCount++;

      if (t.gap_type === 'MISSING_PARENTS') missingParentsCount++;
      else if (t.gap_type === 'MISSING_DEATH') missingDeathCount++;
      else if (t.gap_type === 'MISSING_PLACE') missingPlaceCount++;
      else if (t.gap_type === 'CHILD_GAP') childGapCount++;
    }

    return {
      total_gaps: list.length,
      open_count: openCount,
      in_progress_count: inProgressCount,
      completed_count: completedCount,
      ignored_count: ignoredCount,
      missing_parents_count: missingParentsCount,
      missing_death_count: missingDeathCount,
      missing_place_count: missingPlaceCount,
      child_gap_count: childGapCount,
    };
  });

  const filteredTasks = computed(() => {
    let list = tasks.value;

    // Filter Gap Type
    if (selectedGapType.value !== 'all') {
      list = list.filter((t) => t.gap_type === selectedGapType.value);
    }

    // Filter Status
    if (selectedStatus.value !== 'all') {
      list = list.filter((t) => t.status === selectedStatus.value);
    }

    // Filter Search Query
    if (searchQuery.value.trim()) {
      const q = searchQuery.value.trim().toLowerCase();
      list = list.filter(
        (t) =>
          t.person_name.toLowerCase().includes(q) ||
          t.title.toLowerCase().includes(q) ||
          t.description.toLowerCase().includes(q) ||
          (t.proband_code && t.proband_code.toLowerCase().includes(q)) ||
          (t.notes && t.notes.toLowerCase().includes(q)) ||
          (t.person_birth_place && t.person_birth_place.toLowerCase().includes(q)) ||
          (t.person_death_place && t.person_death_place.toLowerCase().includes(q))
      );
    }

    // Sorting
    return [...list].sort((a, b) => {
      if (sortBy.value === 'priority') {
        // First sort by status urgency (in_progress, open, completed, ignored)
        const statusOrder: Record<string, number> = { in_progress: 0, open: 1, completed: 2, ignored: 3 };
        const orderDiff = (statusOrder[a.status] ?? 4) - (statusOrder[b.status] ?? 4);
        if (orderDiff !== 0) return orderDiff;
        return b.priority_score - a.priority_score;
      } else if (sortBy.value === 'name') {
        return a.person_name.localeCompare(b.person_name);
      } else if (sortBy.value === 'generation') {
        return (a.generation ?? 999) - (b.generation ?? 999);
      }
      return 0;
    });
  });

  const loadIsolatedBranches = async () => {
    isLoadingBranches.value = true;
    errorBranches.value = null;
    try {
      const result = await invoke<IsolatedBranchesResultDto>('get_isolated_branches', {
        activeProbandId: activeProbandId() || null,
      });
      isolatedBranchesData.value = result;
    } catch (err: any) {
      console.error('Failed to get isolated branches:', err);
      errorBranches.value = err?.toString() || 'Fehler beim Laden der isolierten Zweige';
    } finally {
      isLoadingBranches.value = false;
    }
  };

  // Watch scope type or active proband / person changes to auto-reload
  watch([scopeType, activeProbandId, selectedPersonId], () => {
    loadTasks();
  });

  watch(activeProbandId, () => {
    loadIsolatedBranches();
  });

  return {
    tasks,
    stats,
    isLoading,
    error,
    scopeType,
    selectedGapType,
    selectedStatus,
    searchQuery,
    sortBy,
    settings,
    saveSettings,
    filteredTasks,
    loadTasks,
    updateTask,
    isolatedBranchesData,
    isLoadingBranches,
    errorBranches,
    loadIsolatedBranches,
  };
}
