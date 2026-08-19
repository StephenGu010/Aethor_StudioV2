import type { ActionProgramV1, ActionWaypointV1 } from '@aethor/contracts';
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import {
  cloneActionProgram,
  MAX_ACTION_PROGRAM_BYTES,
  MAX_ACTION_WAYPOINTS,
  validateActionProgramV1
} from '../domain/actionProgram';
import { dummyProfile } from '../profile/dummyProfile';

export const MAX_LOCAL_ACTION_PROGRAMS = 64;
export const MAX_LOCAL_ACTION_LIBRARY_BYTES = MAX_ACTION_PROGRAM_BYTES * 4;

export type ActionDraftOrigin = 'new' | 'saved' | 'imported' | 'duplicate' | 'showcaseExample';
export type SaveActionProgramResult =
  | { status: 'saved' | 'unchanged'; program: ActionProgramV1 }
  | { status: 'conflict'; existing: ActionProgramV1 }
  | { status: 'invalid'; errors: string[] }
  | { status: 'empty' };

interface ActionProgramStoreState {
  storageVersion: 1;
  programs: Record<string, ActionProgramV1>;
  storageWarnings: string[];
  draft: ActionProgramV1 | null;
  draftOrigin: ActionDraftOrigin | null;
  selectedWaypointId: string | null;
  previewedWaypointId: string | null;
  setDraft: (program: ActionProgramV1, origin: ActionDraftOrigin) => void;
  openSavedProgram: (programId: string) => boolean;
  updateDraftMeta: (patch: Partial<Pick<ActionProgramV1, 'name' | 'notes' | 'speedDegS' | 'loopEnabled'>>) => void;
  addWaypoint: (waypoint: ActionWaypointV1) => boolean;
  updateWaypoint: (waypointId: string, patch: Partial<Omit<ActionWaypointV1, 'waypointId'>>) => void;
  removeWaypoint: (waypointId: string) => void;
  moveWaypoint: (waypointId: string, direction: -1 | 1) => void;
  selectWaypoint: (waypointId: string | null) => void;
  markPreviewed: (waypointId: string | null) => void;
  saveDraft: (timestampUtc: string, overwriteConflict?: boolean) => SaveActionProgramResult;
  deleteSavedProgram: (programId: string) => void;
  discardDraft: () => void;
  resetActionPrograms: () => void;
}

const emptyState = () => ({
  storageVersion: 1 as const,
  programs: {} as Record<string, ActionProgramV1>,
  storageWarnings: [] as string[],
  draft: null,
  draftOrigin: null,
  selectedWaypointId: null,
  previewedWaypointId: null
});

export const useActionProgramStore = create<ActionProgramStoreState>()(
  persist(
    (set, get) => ({
      ...emptyState(),
      setDraft: (program, draftOrigin) => set({
        draft: cloneActionProgram(program),
        draftOrigin,
        selectedWaypointId: program.waypoints[0]?.waypointId ?? null,
        previewedWaypointId: null
      }),
      openSavedProgram: (programId) => {
        const program = get().programs[programId];
        if (!program) return false;
        set({
          draft: cloneActionProgram(program),
          draftOrigin: 'saved',
          selectedWaypointId: program.waypoints[0]?.waypointId ?? null,
          previewedWaypointId: null
        });
        return true;
      },
      updateDraftMeta: (patch) => set((state) => state.draft
        ? { draft: { ...state.draft, ...patch } }
        : {}),
      addWaypoint: (waypoint) => {
        const draft = get().draft;
        if (!draft || draft.waypoints.length >= MAX_ACTION_WAYPOINTS) return false;
        set({
          draft: { ...draft, waypoints: [...draft.waypoints, cloneWaypoint(waypoint)] },
          selectedWaypointId: waypoint.waypointId
        });
        return true;
      },
      updateWaypoint: (waypointId, patch) => set((state) => state.draft
        ? {
            draft: {
              ...state.draft,
              waypoints: state.draft.waypoints.map((waypoint) => waypoint.waypointId === waypointId
                ? cloneWaypoint({ ...waypoint, ...patch, waypointId })
                : waypoint)
            }
          }
        : {}),
      removeWaypoint: (waypointId) => set((state) => {
        if (!state.draft) return {};
        const removedIndex = state.draft.waypoints.findIndex((waypoint) => waypoint.waypointId === waypointId);
        if (removedIndex < 0) return {};
        const waypoints = state.draft.waypoints.filter((waypoint) => waypoint.waypointId !== waypointId);
        const nextSelection = state.selectedWaypointId === waypointId
          ? waypoints[Math.min(removedIndex, waypoints.length - 1)]?.waypointId ?? null
          : state.selectedWaypointId;
        return {
          draft: { ...state.draft, waypoints },
          selectedWaypointId: nextSelection,
          previewedWaypointId: state.previewedWaypointId === waypointId ? null : state.previewedWaypointId
        };
      }),
      moveWaypoint: (waypointId, direction) => set((state) => {
        if (!state.draft) return {};
        const currentIndex = state.draft.waypoints.findIndex((waypoint) => waypoint.waypointId === waypointId);
        const targetIndex = currentIndex + direction;
        if (currentIndex < 0 || targetIndex < 0 || targetIndex >= state.draft.waypoints.length) return {};
        const waypoints = [...state.draft.waypoints];
        [waypoints[currentIndex], waypoints[targetIndex]] = [waypoints[targetIndex]!, waypoints[currentIndex]!];
        return { draft: { ...state.draft, waypoints } };
      }),
      selectWaypoint: (selectedWaypointId) => set({ selectedWaypointId }),
      markPreviewed: (previewedWaypointId) => set({ previewedWaypointId }),
      saveDraft: (timestampUtc, overwriteConflict = false) => {
        const state = get();
        if (!state.draft) return { status: 'empty' };
        const validation = validateActionProgramV1(state.draft, dummyProfile);
        if (!validation.valid || !validation.program) {
          return { status: 'invalid', errors: validation.errors };
        }
        const existing = state.programs[state.draft.programId];
        if (state.draftOrigin === 'imported' && existing && !overwriteConflict) {
          return { status: 'conflict', existing: cloneActionProgram(existing) };
        }
        if (existing && !isActionProgramDirty(state.draft, existing)) {
          return { status: 'unchanged', program: cloneActionProgram(existing) };
        }
        const candidate: ActionProgramV1 = {
          ...validation.program,
          revision: existing ? existing.revision + 1 : validation.program.revision,
          updatedAtUtc: timestampUtc
        };
        const savedValidation = validateActionProgramV1(candidate, dummyProfile);
        if (!savedValidation.valid || !savedValidation.program) {
          return { status: 'invalid', errors: savedValidation.errors };
        }
        const saved = savedValidation.program;
        const programs = { ...state.programs, [saved.programId]: cloneActionProgram(saved) };
        const capacityError = localActionLibraryCapacityError(programs);
        if (capacityError) return { status: 'invalid', errors: [capacityError] };
        set({
          programs,
          draft: cloneActionProgram(saved),
          draftOrigin: 'saved'
        });
        return { status: 'saved', program: cloneActionProgram(saved) };
      },
      deleteSavedProgram: (programId) => set((state) => {
        if (!state.programs[programId]) return {};
        const programs = { ...state.programs };
        delete programs[programId];
        const closesDraft = state.draft?.programId === programId && !isActionProgramDirty(state.draft, state.programs[programId]);
        return {
          programs,
          ...(closesDraft
            ? { draft: null, draftOrigin: null, selectedWaypointId: null, previewedWaypointId: null }
            : {})
        };
      }),
      discardDraft: () => set({ draft: null, draftOrigin: null, selectedWaypointId: null, previewedWaypointId: null }),
      resetActionPrograms: () => set(emptyState())
    }),
    {
      name: 'aethor-studio-v2-action-programs',
      version: 1,
      partialize: (state) => ({ storageVersion: state.storageVersion, programs: state.programs }),
      merge: (persistedState, currentState) => ({
        ...currentState,
        ...restorePersistedActionPrograms(persistedState)
      })
    }
  )
);

export function restorePersistedActionPrograms(persistedState: unknown): {
  storageVersion: 1;
  programs: Record<string, ActionProgramV1>;
  storageWarnings: string[];
} {
  const programs: Record<string, ActionProgramV1> = {};
  const storageWarnings: string[] = [];
  if (!isRecord(persistedState) || persistedState.storageVersion !== 1 || !isRecord(persistedState.programs)) {
    return {
      storageVersion: 1,
      programs,
      storageWarnings: ['本机动作库格式不兼容，已忽略持久化内容；可通过受支持的 ActionProgram V1 文件重新导入。']
    };
  }

  const candidates: ActionProgramV1[] = [];
  let invalidCount = 0;
  for (const [storageKey, candidate] of Object.entries(persistedState.programs)) {
    const validation = validateActionProgramV1(candidate, dummyProfile);
    if (!validation.valid || !validation.program || validation.program.programId !== storageKey) {
      invalidCount += 1;
      continue;
    }
    candidates.push(validation.program);
  }
  candidates.sort((left, right) => right.updatedAtUtc.localeCompare(left.updatedAtUtc));
  let overflowCount = 0;
  for (const candidate of candidates) {
    const nextPrograms = { ...programs, [candidate.programId]: candidate };
    if (localActionLibraryCapacityError(nextPrograms)) {
      overflowCount += 1;
      continue;
    }
    programs[candidate.programId] = candidate;
  }
  if (invalidCount > 0) storageWarnings.push(`已隔离 ${invalidCount} 条 Schema 或稳定 ID 无效的动作记录。`);
  if (overflowCount > 0) storageWarnings.push(`已忽略 ${overflowCount} 条超出本机动作库容量的较旧记录，请从导出文件恢复。`);
  return { storageVersion: 1, programs, storageWarnings };
}

export function localActionLibraryCapacityError(programs: Record<string, ActionProgramV1>) {
  if (Object.keys(programs).length > MAX_LOCAL_ACTION_PROGRAMS) {
    return `本机动作库最多保存 ${MAX_LOCAL_ACTION_PROGRAMS} 个文档；请先导出并删除不再使用的文档。`;
  }
  const sizeBytes = new TextEncoder().encode(JSON.stringify(programs)).byteLength;
  if (sizeBytes > MAX_LOCAL_ACTION_LIBRARY_BYTES) {
    return '本机动作库已达到 4 MiB 数据上限；请先导出并删除不再使用的文档。';
  }
  return null;
}

export function isActionProgramDirty(draft: ActionProgramV1 | null, saved: ActionProgramV1 | undefined) {
  if (!draft) return false;
  if (!saved) return true;
  return JSON.stringify(draft) !== JSON.stringify(saved);
}

function cloneWaypoint(waypoint: ActionWaypointV1): ActionWaypointV1 {
  return {
    ...waypoint,
    positionsDeg: [...waypoint.positionsDeg],
    postArrivalWait: { ...waypoint.postArrivalWait }
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
