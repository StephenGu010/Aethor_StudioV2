import type { AethorArmMotorFrameV1 } from '@aethor/contracts';
import { describe, expect, it, vi } from 'vitest';
import { AethorTwinFrameCoordinator, type AethorTwinFrameScheduler } from './AethorTwinFrameCoordinator';

describe('Aethor twin frame coordinator', () => {
  it('coalesces a 100-frame arm burst into one latest-frame model commit', () => {
    const sink = vi.fn();
    const scheduler = new ManualFrameScheduler();
    let nowMs = 1_000;
    const coordinator = new AethorTwinFrameCoordinator(sink, scheduler, () => nowMs);

    for (let sequence = 1; sequence <= 100; sequence += 1) {
      expect(coordinator.ingest(frame('left-arm', sequence))).toBe(true);
    }

    expect(scheduler.pendingCount).toBe(1);
    expect(sink).not.toHaveBeenCalled();
    nowMs = 1_016;
    scheduler.flush();

    expect(sink).toHaveBeenCalledTimes(1);
    expect(sink.mock.calls[0]?.[0]).toMatchObject([{ jointGroupId: 'left-arm', frameSeq: 100 }]);
    expect(sink.mock.calls[0]?.[1]).toMatchObject({
      receivedFrameCount: 100,
      appliedFrameCount: 1,
      coalescedFrameCount: 99,
      renderCommitCount: 1,
      ingressRateHz: 100,
      modelUpdateRateHz: 1
    });
  });

  it('commits the newest left and right arm frames atomically', () => {
    const sink = vi.fn();
    const scheduler = new ManualFrameScheduler();
    const coordinator = new AethorTwinFrameCoordinator(sink, scheduler, () => 2_000);

    coordinator.ingest(frame('right-arm', 8));
    coordinator.ingest(frame('left-arm', 11));
    scheduler.flush();

    expect(sink.mock.calls[0]?.[0]).toMatchObject([
      { jointGroupId: 'left-arm', frameSeq: 11 },
      { jointGroupId: 'right-arm', frameSeq: 8 }
    ]);
    expect(sink.mock.calls[0]?.[1]).toMatchObject({ appliedFrameCount: 2, renderCommitCount: 1 });
  });

  it('rejects old sequence values and retired boot frames before React state', () => {
    const sink = vi.fn();
    const scheduler = new ManualFrameScheduler();
    const coordinator = new AethorTwinFrameCoordinator(sink, scheduler, () => 3_000);

    expect(coordinator.ingest(frame('left-arm', 10, 'boot-a'))).toBe(true);
    expect(coordinator.ingest(frame('left-arm', 9, 'boot-a'))).toBe(false);
    expect(coordinator.ingest(frame('left-arm', 1, 'boot-b'))).toBe(true);
    expect(coordinator.ingest(frame('left-arm', 11, 'boot-a'))).toBe(false);
    scheduler.flush();

    expect(sink.mock.calls[0]?.[0]).toMatchObject([{ bootId: 'boot-b', frameSeq: 1 }]);
    expect(sink.mock.calls[0]?.[1]).toMatchObject({
      receivedFrameCount: 4,
      appliedFrameCount: 1,
      coalescedFrameCount: 1,
      rejectedFrameCount: 2
    });
  });

  it('rejects a different controller identity until the session is reset', () => {
    const sink = vi.fn();
    const metricsSink = vi.fn();
    const scheduler = new ManualFrameScheduler();
    const coordinator = new AethorTwinFrameCoordinator(sink, scheduler, () => 3_500, metricsSink);

    expect(coordinator.ingest(frame('left-arm', 1))).toBe(true);
    expect(coordinator.ingest({
      ...frame('left-arm', 2),
      controllerId: 'controller-2',
      armId: 'replacement-arm'
    })).toBe(false);
    expect(metricsSink).toHaveBeenLastCalledWith(expect.objectContaining({ rejectedFrameCount: 1 }));
    scheduler.flush();

    expect(sink.mock.calls[0]?.[0]).toMatchObject([{ controllerId: 'controller-1', frameSeq: 1 }]);
    coordinator.reset();
    expect(coordinator.ingest({ ...frame('left-arm', 1), controllerId: 'controller-2' })).toBe(true);
  });

  it('rejects malformed motor samples and projected diagnostic ids at ingress', () => {
    const sink = vi.fn();
    const scheduler = new ManualFrameScheduler();
    const coordinator = new AethorTwinFrameCoordinator(sink, scheduler, () => 3_750);

    expect(coordinator.ingest({
      ...frame('left-arm', 1),
      motors: [{ motorId: 1, positionDeg: Number.NaN, feedbackAgeMs: 2, valid: true }]
    })).toBe(false);
    expect(coordinator.ingest({
      ...frame('left-arm', 2),
      unexpectedMotorIds: [7]
    })).toBe(false);
    expect(coordinator.ingest({
      ...frame('left-arm', 3),
      unexpectedMotorIds: [8, 8]
    })).toBe(false);

    scheduler.flush();
    expect(sink).not.toHaveBeenCalled();
    expect(coordinator.getMetrics()).toMatchObject({ receivedFrameCount: 3, rejectedFrameCount: 3 });
  });

  it('cancels an uncommitted frame and sequence history on session reset', () => {
    const sink = vi.fn();
    const scheduler = new ManualFrameScheduler();
    const coordinator = new AethorTwinFrameCoordinator(sink, scheduler, () => 4_000);
    coordinator.ingest(frame('left-arm', 20));

    coordinator.reset();
    scheduler.flush();
    expect(sink).not.toHaveBeenCalled();
    expect(coordinator.getMetrics()).toMatchObject({ receivedFrameCount: 0, renderCommitCount: 0 });
    expect(coordinator.ingest(frame('left-arm', 1))).toBe(true);
  });
});

class ManualFrameScheduler implements AethorTwinFrameScheduler {
  private callback: (() => void) | null = null;
  get pendingCount() { return this.callback ? 1 : 0; }
  request(callback: () => void) {
    this.callback = callback;
    return 1;
  }
  cancel() { this.callback = null; }
  flush() {
    const callback = this.callback;
    this.callback = null;
    callback?.();
  }
}

function frame(
  jointGroupId: 'left-arm' | 'right-arm',
  frameSeq: number,
  bootId = 'boot-1'
): AethorArmMotorFrameV1 {
  return {
    contractVersion: '1.0',
    profileId: 'aethor-robo-dual-7dof',
    jointGroupId,
    controllerId: 'controller-1',
    armId: jointGroupId,
    bootId,
    frameSeq,
    receivedAtUtc: '2026-08-13T08:00:00.000Z',
    snapshotComplete: true,
    motors: [{ motorId: 1, positionDeg: frameSeq, feedbackAgeMs: 2, valid: true }]
  };
}
