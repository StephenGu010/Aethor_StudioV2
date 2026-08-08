import { describe, expect, it } from 'vitest';
import { showcaseJointFrame } from '../fixtures/showcase';
import { StaticShowcaseSource } from './staticShowcaseSource';

describe('StaticShowcaseSource safety boundary', () => {
  it('never exposes a live connection or enabled motor', async () => {
    const source = new StaticShowcaseSource();
    await expect(source.getSession()).resolves.toMatchObject({ connectionState: 'offline', motorState: 'unknown', source: 'showcase' });
    expect(source.capabilities.hardwareCommands).toBe(false);
  });

  it('rejects every hardware command and keeps feedback detached from targets', async () => {
    const source = new StaticShowcaseSource();
    const before = [...showcaseJointFrame.positionsDeg];
    const result = await source.sendJointGroup({ commandId: 'c1', sessionId: 's1', profileId: 'dummy-6dof', positionsDeg: [0, 0, 0, 0, 0, 0] });
    expect(result.status).toBe('unsupported');
    expect(showcaseJointFrame.positionsDeg).toEqual(before);
    await expect(source.emergencyStop('e1')).resolves.toMatchObject({ status: 'unsupported' });
  });
});
