import { strFromU8, unzipSync } from 'fflate';
import type { RobotProfileManifestV1 } from '@aethor/contracts';
import { parseRobotProfile } from './robotProfile';

export interface ProfilePackageValidation {
  valid: boolean;
  profile: RobotProfileManifestV1 | null;
  errors: string[];
  fileCount: number;
  unpackedBytes: number;
}

const MAX_UNPACKED_BYTES = 250 * 1024 * 1024;
const allowedExtensions = new Set(['.json', '.urdf', '.stl', '.md', '.txt']);

function normalizedArchivePath(path: string): string {
  return path.replaceAll('\\', '/').replace(/^\.\//, '');
}

function extensionOf(path: string): string {
  const dot = path.lastIndexOf('.');
  return dot >= 0 ? path.slice(dot).toLowerCase() : '';
}

export async function validateProfilePackage(file: File): Promise<ProfilePackageValidation> {
  const errors: string[] = [];
  let archive: Record<string, Uint8Array>;
  try {
    archive = unzipSync(new Uint8Array(await file.arrayBuffer()));
  } catch {
    return { valid: false, profile: null, errors: ['文件不是有效的 ZIP 配置包'], fileCount: 0, unpackedBytes: 0 };
  }

  const entries = Object.entries(archive).filter(([path]) => !path.endsWith('/'));
  const unpackedBytes = entries.reduce((total, [, bytes]) => total + bytes.byteLength, 0);
  if (unpackedBytes > MAX_UNPACKED_BYTES) errors.push('解包后文件超过 250 MiB 上限');

  const normalized = new Map<string, Uint8Array>();
  entries.forEach(([rawPath, bytes]) => {
    const path = normalizedArchivePath(rawPath);
    if (!path || path.startsWith('/') || path.includes('../') || /^[a-zA-Z]:/.test(path)) {
      errors.push(`非法包内路径：${rawPath}`);
      return;
    }
    if (!allowedExtensions.has(extensionOf(path))) errors.push(`不支持的文件类型：${path}`);
    if (normalized.has(path)) errors.push(`重复包内路径：${path}`);
    normalized.set(path, bytes);
  });

  const manifestBytes = normalized.get('manifest.json');
  if (!manifestBytes) {
    errors.push('包根目录缺少 manifest.json');
    return { valid: false, profile: null, errors, fileCount: entries.length, unpackedBytes };
  }

  let profile: RobotProfileManifestV1 | null = null;
  try {
    profile = parseRobotProfile(JSON.parse(strFromU8(manifestBytes)));
  } catch (error) {
    errors.push(error instanceof Error ? `manifest 校验失败：${error.message}` : 'manifest 校验失败');
  }
  if (!profile) return { valid: false, profile: null, errors, fileCount: entries.length, unpackedBytes };

  const urdfBytes = normalized.get(profile.model.urdfPath);
  if (!urdfBytes) {
    errors.push(`缺少 URDF：${profile.model.urdfPath}`);
  } else {
    const urdfText = strFromU8(urdfBytes);
    const xml = new DOMParser().parseFromString(urdfText, 'application/xml');
    if (xml.querySelector('parsererror')) {
      errors.push('URDF XML 无法解析');
    } else {
      const urdfJointNames = new Set(Array.from(xml.querySelectorAll('joint')).map((node) => node.getAttribute('name')));
      profile.joints.forEach((joint) => {
        if (!urdfJointNames.has(joint.urdfJointName)) errors.push(`URDF 缺少关节：${joint.urdfJointName}`);
      });
      const urdfDirectory = profile.model.urdfPath.includes('/')
        ? profile.model.urdfPath.slice(0, profile.model.urdfPath.lastIndexOf('/') + 1)
        : '';
      Array.from(xml.querySelectorAll('mesh')).forEach((mesh) => {
        const reference = mesh.getAttribute('filename') ?? '';
        if (!reference || reference.includes('://') || reference.startsWith('/') || /^[a-zA-Z]:/.test(reference)) {
          errors.push(`非法 mesh 引用：${reference || '(empty)'}`);
          return;
        }
        const resolved = resolveRelativePath(urdfDirectory, reference);
        if (!resolved || !normalized.has(resolved)) errors.push(`缺少 mesh：${reference}`);
      });
    }
  }

  return { valid: errors.length === 0, profile, errors, fileCount: entries.length, unpackedBytes };
}

function resolveRelativePath(baseDirectory: string, relativePath: string): string | null {
  const stack = baseDirectory.split('/').filter(Boolean);
  for (const segment of relativePath.replaceAll('\\', '/').split('/')) {
    if (!segment || segment === '.') continue;
    if (segment === '..') {
      if (stack.length === 0) return null;
      stack.pop();
    } else {
      stack.push(segment);
    }
  }
  return stack.join('/');
}
