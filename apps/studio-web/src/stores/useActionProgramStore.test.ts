import type { ActionProgramV1 } from '@aethor/contracts';
import { beforeEach, describe, expect, it } from 'vitest';
import { createActionProgramV1, createActionWaypointV1 } from '../domain/actionProgram';
import {
  isActionProgramDirty,
  localActionLibraryCapacityError,
  MAX_LOCAL_ACTION_PROGRAMS,
  restorePersistedActionPrograms,
  useActionProgramStore
} from './useActionProgramStore';

const timestampUtc = '2026-08-09T00:00:00.000Z';

describe('action program store', () => {
  beforeEach(() => {
    localStorage.clear();
    useActionProgramStore.getState().resetActionPrograms();
  });

  it('persists only an explicitly saved valid document and increments revisions on later saves', () => {
    const program = actionProgram();
    useActionProgramStore.getState().setDraft(program, 'new');
    useActionProgramStore.getState().updateDraftMeta({ name: 'Inspection cycle', notes: '' });

    expect(isActionProgramDirty(
      useActionProgramStore.getState().draft,
      useActionProgramStore.getState().programs[program.programId]
    )).toBe(true);
    expect(localStorage.getItem('aethor-studio-v2-action-programs')).not.toContain('Inspection cycle');

    expect(useActionProgramStore.getState().saveDraft('2026-08-09T00:01:00.000Z')).toMatchObject({
      status: 'saved', program: { revision: 1, name: 'Inspection cycle' }
    });
    expect(localStorage.getItem('aethor-studio-v2-action-programs')).toContain('Inspection cycle');

    useActionProgramStore.getState().updateDraftMeta({ name: 'Inspection cycle v2', notes: '' });
    expect(useActionProgramStore.getState().saveDraft('2026-08-09T00:02:00.000Z')).toMatchObject({
      status: 'saved', program: { revision: 2, name: 'Inspection cycle v2' }
    });
  });

  it('does not overwrite an existing stable ID when an import conflicts without confirmation', () => {
    const program = actionProgram();
    useActionProgramStore.getState().setDraft(program, 'new');
    useActionProgramStore.getState().saveDraft('2026-08-09T00:01:00.000Z');
    useActionProgramStore.getState().setDraft({ ...program, name: 'Imported replacement' }, 'imported');

    expect(useActionProgramStore.getState().saveDraft('2026-08-09T00:02:00.000Z')).toMatchObject({
      status: 'conflict', existing: { name: 'Inspection cycle' }
    });
    expect(useActionProgramStore.getState().programs[program.programId]?.name).toBe('Inspection cycle');

    expect(useActionProgramStore.getState().saveDraft('2026-08-09T00:02:00.000Z', true)).toMatchObject({
      status: 'saved', program: { name: 'Imported replacement', revision: 2 }
    });
  });

  it('adds, reorders, edits, and removes isolated waypoint copies', () => {
    const program = actionProgram();
    const second = createActionWaypointV1({
      waypointId: '9ef34ad8-50e0-4ad0-b754-272e83df0002', sequence: 2,
      positionsDeg: [1, 2, 3, 4, 5, 6], source: 'manual', timestampUtc
    });
    useActionProgramStore.getState().setDraft(program, 'new');
    expect(useActionProgramStore.getState().addWaypoint(second)).toBe(true);
    useActionProgramStore.getState().moveWaypoint(second.waypointId, -1);
    useActionProgramStore.getState().updateWaypoint(second.waypointId, { name: 'Approach' });

    expect(useActionProgramStore.getState().draft?.waypoints.map((waypoint) => waypoint.name)).toEqual([
      'Approach', '点位 01'
    ]);
    expect(second.name).toBe('点位 02');

    useActionProgramStore.getState().removeWaypoint(second.waypointId);
    expect(useActionProgramStore.getState().draft?.waypoints).toHaveLength(1);
  });

  it('refuses to save invalid edits instead of persisting a partial document', () => {
    const program = actionProgram();
    useActionProgramStore.getState().setDraft({ ...program, name: '   ' }, 'new');

    expect(useActionProgramStore.getState().saveDraft('2026-08-09T00:01:00.000Z')).toMatchObject({
      status: 'invalid'
    });
    expect(useActionProgramStore.getState().programs).toEqual({});

    useActionProgramStore.getState().setDraft(program, 'new');
    expect(useActionProgramStore.getState().saveDraft('not-a-timestamp')).toMatchObject({ status: 'invalid' });
    expect(useActionProgramStore.getState().programs).toEqual({});
  });

  it('restores only schema-valid records whose storage key matches the stable program ID', () => {
    const valid = actionProgram();
    const restored = restorePersistedActionPrograms({
      storageVersion: 1,
      programs: {
        [valid.programId]: valid,
        'wrong-storage-key': { ...valid, programId: '8c51d413-64a3-4f0c-b67e-e239ab84c504' },
        'invalid-record': { schemaVersion: '2.0' }
      }
    });

    expect(Object.keys(restored.programs)).toEqual([valid.programId]);
    expect(restored.storageWarnings).toEqual([expect.stringContaining('2 条')]);
  });

  it('fails closed when the persisted library envelope is incompatible', () => {
    expect(restorePersistedActionPrograms({ storageVersion: 2, programs: {} })).toEqual({
      storageVersion: 1,
      programs: {},
      storageWarnings: [expect.stringContaining('格式不兼容')]
    });
  });

  it('bounds the local library by document count and serialized size', () => {
    const programs = Object.fromEntries(Array.from({ length: MAX_LOCAL_ACTION_PROGRAMS + 1 }, (_, index) => {
      const programId = `${index.toString(16).padStart(8, '0')}-0000-4000-8000-000000000001`;
      return [programId, { ...actionProgram(), programId }];
    }));
    expect(localActionLibraryCapacityError(programs)).toContain('最多保存');

    const oversized = actionProgram();
    expect(localActionLibraryCapacityError({
      [oversized.programId]: { ...oversized, notes: 'x'.repeat(4 * 1024 * 1024) }
    })).toContain('4 MiB');
  });
});

function actionProgram(): ActionProgramV1 {
  return createActionProgramV1({
    programId: '6c899952-10e8-4a4f-97a1-13de0cd00a01',
    name: 'Inspection cycle',
    timestampUtc,
    waypoints: [createActionWaypointV1({
      waypointId: '9ef34ad8-50e0-4ad0-b754-272e83df0001', sequence: 1,
      positionsDeg: [0, 0, 0, 0, 0, 0], source: 'manual', timestampUtc
    })]
  });
}
