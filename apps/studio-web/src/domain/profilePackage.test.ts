import { strToU8, zipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import { dummyProfile } from '../profile/dummyProfile';
import { validateProfilePackage } from './profilePackage';

describe('.aethor-robot package validation', () => {
  it('accepts a self-contained managed package', async () => {
    const packageFile = zipFile({
      'manifest.json': JSON.stringify(dummyProfile),
      'model/dummy.urdf': robotUrdf(dummyProfile.joints.map((joint) => joint.urdfJointName), '../meshes/base.stl'),
      'meshes/base.stl': 'solid base\nendsolid base',
      'NOTICE.md': 'BSD-3-Clause'
    });
    const result = await validateProfilePackage(packageFile);
    expect(result.valid).toBe(true);
    expect(result.profile?.profileId).toBe('dummy-6dof');
  });

  it('rejects path traversal and missing meshes', async () => {
    const packageFile = zipFile({
      'manifest.json': JSON.stringify(dummyProfile),
      'model/dummy.urdf': robotUrdf(dummyProfile.joints.map((joint) => joint.urdfJointName), 'https://evil.invalid/base.stl'),
      '../escape.txt': 'unsafe'
    });
    const result = await validateProfilePackage(packageFile);
    expect(result.valid).toBe(false);
    expect(result.errors.join(' ')).toMatch(/路径|mesh/);
  });
});

function zipFile(entries: Record<string, string>) {
  const bytes = zipSync(Object.fromEntries(Object.entries(entries).map(([path, value]) => [path, strToU8(value)])));
  return new File([bytes], 'profile.aethor-robot', { type: 'application/zip' });
}

function robotUrdf(joints: string[], mesh: string) {
  return `<robot name="dummy"><link name="base_link"><visual><geometry><mesh filename="${mesh}"/></geometry></visual></link>${joints.map((name, index) => `<joint name="${name}" type="revolute"><parent link="base_link"/><child link="link_${index + 1}"/></joint>`).join('')}</robot>`;
}
