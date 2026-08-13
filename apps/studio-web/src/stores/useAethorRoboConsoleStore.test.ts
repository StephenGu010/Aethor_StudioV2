import { beforeEach, describe, expect, it, vi } from 'vitest';
import { aethorRoboProfile } from '../profile/aethorRoboProfile';
import {
  flushAethorTwinTelemetryForTest,
  ingestAethorTwinMotorFrame,
  resetAethorTwinTelemetryRuntime
} from '../integrations/aethorTwinTelemetryRuntime';
import { useAethorRoboConsoleStore } from './useAethorRoboConsoleStore';

describe('Aethor_robo console target isolation', () => {
  beforeEach(() => {
    resetAethorTwinTelemetryRuntime();
    useAethorRoboConsoleStore.getState().resetPreview();
  });

  it('owns fourteen local-preview targets split into two seven-axis groups', () => {
    expect(useAethorRoboConsoleStore.getState().targetPositionsDeg).toHaveLength(14);
    expect(aethorRoboProfile.jointGroups?.map((group) => group.jointIds.length)).toEqual([7, 7]);
  });

  it('clamps preview edits without creating hardware feedback', () => {
    useAethorRoboConsoleStore.getState().setJointTarget(8, 999);
    expect(useAethorRoboConsoleStore.getState().targetPositionsDeg[8]).toBe(360);
    expect(useAethorRoboConsoleStore.getState().motorSnapshots).toEqual({});
  });

  it('merges independently ordered motor-id frames from both arms', () => {
    ingestAethorTwinMotorFrame(frame('left-arm', 'arm-01', [
      { motorId: 4, positionDeg: 44, feedbackAgeMs: 2, valid: true },
      { motorId: 1, positionDeg: 11, feedbackAgeMs: 2, valid: true }
    ]));
    ingestAethorTwinMotorFrame(frame('right-arm', 'arm-02', [
      { motorId: 7, positionDeg: 177, feedbackAgeMs: 2, valid: true },
      { motorId: 2, positionDeg: 122, feedbackAgeMs: 2, valid: true }
    ]));
    // The production seam is rate limited; deterministic store tests flush it explicitly.
    flushAethorTwinTelemetryForTest();

    const next = useAethorRoboConsoleStore.getState();
    expect(next.actualPositionsDeg[0]).toBe(11);
    expect(next.actualPositionsDeg[3]).toBe(44);
    expect(next.actualPositionsDeg[8]).toBe(122);
    expect(next.actualPositionsDeg[13]).toBe(177);
    expect(Object.keys(next.motorSnapshots)).toEqual(['left-arm', 'right-arm']);
  });

  it('clears feedback, diagnostics, and pose together on session reset', () => {
    useAethorRoboConsoleStore.getState().applyMotorFrames([frame('left-arm', 'arm-01', [
      { motorId: 1, positionDeg: 25, feedbackAgeMs: 2, valid: true }
    ])], useAethorRoboConsoleStore.getState().telemetryMetrics, 1_000);
    useAethorRoboConsoleStore.getState().clearMotorTelemetry();

    expect(useAethorRoboConsoleStore.getState().actualPositionsDeg).toEqual(
      aethorRoboProfile.model.showcasePoseDeg
    );
    expect(useAethorRoboConsoleStore.getState().motorSnapshots).toEqual({});
    expect(useAethorRoboConsoleStore.getState().telemetryMetrics.receivedFrameCount).toBe(0);
  });

  it('commits both arm frames in one store notification without overwriting target drafts', () => {
    const targetBefore = useAethorRoboConsoleStore.getState().targetPositionsDeg;
    const listener = vi.fn();
    const unsubscribe = useAethorRoboConsoleStore.subscribe(listener);
    const committedAtMs = 4_000;

    useAethorRoboConsoleStore.getState().applyMotorFrames([
      frame('left-arm', 'arm-01', [{ motorId: 1, positionDeg: 15, feedbackAgeMs: 2, valid: true }]),
      frame('right-arm', 'arm-02', [{ motorId: 1, positionDeg: 115, feedbackAgeMs: 2, valid: true }])
    ], {
      receivedFrameCount: 2,
      appliedFrameCount: 2,
      coalescedFrameCount: 0,
      rejectedFrameCount: 0,
      renderCommitCount: 1,
      ingressRateHz: 2,
      modelUpdateRateHz: 1,
      lastIngressAtMs: committedAtMs,
      lastCommitAtMs: committedAtMs
    }, committedAtMs);

    expect(listener).toHaveBeenCalledTimes(1);
    expect(useAethorRoboConsoleStore.getState().actualPositionsDeg[0]).toBe(15);
    expect(useAethorRoboConsoleStore.getState().actualPositionsDeg[7]).toBe(115);
    expect(useAethorRoboConsoleStore.getState().targetPositionsDeg).toBe(targetBefore);
    unsubscribe();
  });

  it('retains the last pose but makes all observed joints stale after ingress stops', () => {
    useAethorRoboConsoleStore.getState().applyMotorFrames([
      frame('left-arm', 'arm-01', Array.from({ length: 7 }, (_, index) => ({
        motorId: index + 1,
        positionDeg: index + 10,
        feedbackAgeMs: 2,
        valid: true
      })))
    ], useAethorRoboConsoleStore.getState().telemetryMetrics, 10_000);

    useAethorRoboConsoleStore.getState().expireMotorTelemetry(10_251, 250);
    const next = useAethorRoboConsoleStore.getState();
    expect(next.actualPositionsDeg.slice(0, 7)).toEqual([10, 11, 12, 13, 14, 15, 16]);
    expect(next.motorSnapshots['left-arm']?.joints.every((joint) => joint.availability === 'stale')).toBe(true);
    expect(next.motorSnapshots['left-arm']?.degradedJointIds).toHaveLength(7);
  });
});

function frame(jointGroupId: 'left-arm' | 'right-arm', armId: string, motors: Array<{
  motorId: number;
  positionDeg: number;
  feedbackAgeMs: number;
  valid: boolean;
}>) {
  return {
    contractVersion: '1.0' as const,
    profileId: 'aethor-robo-dual-7dof' as const,
    jointGroupId,
    controllerId: `aethor-controller-${armId.slice(-2)}`,
    bootId: `${armId}-boot-1`,
    armId,
    frameSeq: 1,
    receivedAtUtc: '2026-08-12T12:00:00.000Z',
    snapshotComplete: true,
    motors
  };
}
