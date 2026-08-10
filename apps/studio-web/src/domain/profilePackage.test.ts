import { strToU8, zipSync } from 'fflate';
import { describe, expect, it, vi } from 'vitest';
import { dummyProfile } from '../profile/dummyProfile';
import { PROFILE_PACKAGE_LIMITS, validateProfilePackage } from './profilePackage';

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

  it('rejects an oversized compressed package before reading its bytes', async () => {
    const arrayBuffer = vi.fn();
    const oversized = {
      name: 'oversized.aethor-robot',
      size: PROFILE_PACKAGE_LIMITS.archiveBytes + 1,
      arrayBuffer
    } as unknown as File;

    const result = await validateProfilePackage(oversized);

    expect(result.valid).toBe(false);
    expect(result.errors).toContain('压缩包超过 250 MiB 上限');
    expect(arrayBuffer).not.toHaveBeenCalled();
  });

  it('rejects declared ZIP expansion beyond the unpacked limit before extracting the mesh', async () => {
    const entries = validEntries();
    const bytes = zipBytes(entries);
    patchCentralDirectoryUnpackedSize(
      bytes,
      'meshes/base.stl',
      PROFILE_PACKAGE_LIMITS.unpackedBytes + 1
    );

    const result = await validateProfilePackage(new File([bytes], 'bomb.aethor-robot'));

    expect(result.valid).toBe(false);
    expect(result.profile?.profileId).toBe('dummy-6dof');
    expect(result.errors).toContain('解包后文件超过 250 MiB 上限');
  });

  it('rejects Windows case-insensitive path collisions', async () => {
    const result = await validateProfilePackage(zipFile({
      ...validEntries(),
      'meshes/BASE.stl': 'solid duplicate\nendsolid duplicate'
    }));

    expect(result.valid).toBe(false);
    expect(result.errors.join(' ')).toMatch(/Windows 大小写不敏感/);
  });

  it('bounds the number of entries and the reported error list', async () => {
    const entries = validEntries();
    for (let index = 0; index <= PROFILE_PACKAGE_LIMITS.fileCount; index += 1) {
      entries[`notes/${index}.txt`] = '';
    }

    const result = await validateProfilePackage(zipFile(entries));

    expect(result.valid).toBe(false);
    expect(result.fileCount).toBeGreaterThan(PROFILE_PACKAGE_LIMITS.fileCount);
    expect(result.errors).toContain(`文件数量超过 ${PROFILE_PACKAGE_LIMITS.fileCount} 项上限`);
    expect(result.errors.length).toBeLessThanOrEqual(PROFILE_PACKAGE_LIMITS.reportedErrors + 1);
  });

  it('bounds diagnostics produced by a hostile but size-valid URDF', async () => {
    const missingMeshes = Array.from({ length: 200 }, (_, index) => (
      `<link name="missing_${index}"><visual><geometry><mesh filename="../meshes/missing_${index}.stl"/></geometry></visual></link>`
    )).join('');
    const result = await validateProfilePackage(zipFile({
      ...validEntries(),
      'model/dummy.urdf': `${robotUrdf(dummyProfile.joints.map((joint) => joint.urdfJointName), '../meshes/base.stl').replace('</robot>', '')}${missingMeshes}</robot>`
    }));

    expect(result.valid).toBe(false);
    expect(result.errors.length).toBe(PROFILE_PACKAGE_LIMITS.reportedErrors + 1);
    expect(result.errors.at(-1)).toMatch(/项错误未展开/);
  });

  it('supports cancellation without returning a partial validation result', async () => {
    const controller = new AbortController();
    controller.abort();

    await expect(validateProfilePackage(zipFile(validEntries()), controller.signal)).rejects.toMatchObject({
      name: 'AbortError'
    });
  });
});

function zipFile(entries: Record<string, string>) {
  return new File([zipBytes(entries)], 'profile.aethor-robot', { type: 'application/zip' });
}

function zipBytes(entries: Record<string, string>) {
  return zipSync(Object.fromEntries(Object.entries(entries).map(([path, value]) => [path, strToU8(value)])));
}

function validEntries(): Record<string, string> {
  return {
    'manifest.json': JSON.stringify(dummyProfile),
    'model/dummy.urdf': robotUrdf(dummyProfile.joints.map((joint) => joint.urdfJointName), '../meshes/base.stl'),
    'meshes/base.stl': 'solid base\nendsolid base',
    'NOTICE.md': 'BSD-3-Clause'
  };
}

function patchCentralDirectoryUnpackedSize(bytes: Uint8Array, entryName: string, size: number) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const decoder = new TextDecoder();
  for (let offset = 0; offset <= bytes.byteLength - 46; offset += 1) {
    if (view.getUint32(offset, true) !== 0x02014b50) continue;
    const nameLength = view.getUint16(offset + 28, true);
    const extraLength = view.getUint16(offset + 30, true);
    const commentLength = view.getUint16(offset + 32, true);
    const name = decoder.decode(bytes.subarray(offset + 46, offset + 46 + nameLength));
    if (name === entryName) {
      view.setUint32(offset + 24, size, true);
      return;
    }
    offset += 45 + nameLength + extraLength + commentLength;
  }
  throw new Error(`Central directory entry not found: ${entryName}`);
}

function robotUrdf(joints: string[], mesh: string) {
  return `<robot name="dummy"><link name="base_link"><visual><geometry><mesh filename="${mesh}"/></geometry></visual></link>${joints.map((name, index) => `<joint name="${name}" type="revolute"><parent link="base_link"/><child link="link_${index + 1}"/></joint>`).join('')}</robot>`;
}
