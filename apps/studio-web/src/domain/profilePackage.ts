import { strFromU8, unzip, type UnzipFileInfo, type Unzipped } from 'fflate';
import type { RobotProfileManifestV1 } from '@aethor/contracts';
import { parseRobotProfile } from './robotProfile';

export interface ProfilePackageValidation {
  valid: boolean;
  profile: RobotProfileManifestV1 | null;
  errors: string[];
  fileCount: number;
  unpackedBytes: number;
}

export const PROFILE_PACKAGE_LIMITS = Object.freeze({
  archiveBytes: 250 * 1024 * 1024,
  unpackedBytes: 250 * 1024 * 1024,
  manifestBytes: 1 * 1024 * 1024,
  urdfBytes: 8 * 1024 * 1024,
  fileCount: 2_048,
  pathCharacters: 512,
  reportedErrors: 64
});

interface ArchiveEntry {
  rawPath: string;
  path: string;
  compressedBytes: number;
  unpackedBytes: number;
}

const allowedExtensions = new Set(['.json', '.urdf', '.stl', '.md', '.txt']);
const windowsReservedName = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$/i;

export async function validateProfilePackage(
  file: File,
  signal?: AbortSignal
): Promise<ProfilePackageValidation> {
  throwIfAborted(signal);
  if (file.size > PROFILE_PACKAGE_LIMITS.archiveBytes) {
    return invalidResult(['压缩包超过 250 MiB 上限']);
  }

  let archiveBytes: Uint8Array;
  try {
    archiveBytes = new Uint8Array(await file.arrayBuffer());
    throwIfAborted(signal);
  } catch (error) {
    if (isAbortError(error)) throw error;
    return invalidResult(['无法读取配置包']);
  }
  if (archiveBytes.byteLength > PROFILE_PACKAGE_LIMITS.archiveBytes) {
    return invalidResult(['压缩包实际内容超过 250 MiB 上限']);
  }

  const errorCollector = createErrorCollector();
  const { report: reportError, snapshot: validationErrors } = errorCollector;
  const archiveEntries = new Map<string, ArchiveEntry>();
  const caseInsensitivePaths = new Set<string>();
  let fileCount = 0;
  let unpackedBytes = 0;
  let hardLimitExceeded = false;
  let entryLimitReported = false;
  let unpackedLimitReported = false;

  let manifestFiles: Unzipped;
  try {
    manifestFiles = await extractSelectedEntries(archiveBytes, (entry) => {
      if (entry.name.endsWith('/')) return false;
      fileCount += 1;
      if (fileCount > PROFILE_PACKAGE_LIMITS.fileCount) {
        hardLimitExceeded = true;
        if (!entryLimitReported) {
          reportError(`文件数量超过 ${PROFILE_PACKAGE_LIMITS.fileCount} 项上限`);
          entryLimitReported = true;
        }
        return false;
      }

      const path = normalizeArchivePath(entry.name);
      if (!path) {
        reportError(`非法包内路径：${printablePath(entry.name)}`);
        return false;
      }
      if (!allowedExtensions.has(extensionOf(path))) reportError(`不支持的文件类型：${path}`);

      const caseInsensitivePath = path.toLowerCase();
      if (caseInsensitivePaths.has(caseInsensitivePath)) {
        reportError(`重复包内路径（Windows 大小写不敏感）：${path}`);
        return false;
      }
      caseInsensitivePaths.add(caseInsensitivePath);

      if (!Number.isSafeInteger(entry.size) || entry.size < 0
        || !Number.isSafeInteger(entry.originalSize) || entry.originalSize < 0) {
        hardLimitExceeded = true;
        reportError(`ZIP 条目尺寸非法：${path}`);
        return false;
      }
      unpackedBytes += entry.originalSize;
      if (!Number.isSafeInteger(unpackedBytes) || unpackedBytes > PROFILE_PACKAGE_LIMITS.unpackedBytes) {
        hardLimitExceeded = true;
        if (!unpackedLimitReported) {
          reportError('解包后文件超过 250 MiB 上限');
          unpackedLimitReported = true;
        }
      }

      archiveEntries.set(path, {
        rawPath: entry.name,
        path,
        compressedBytes: entry.size,
        unpackedBytes: entry.originalSize
      });
      if (path !== 'manifest.json') return false;
      if (entry.originalSize > PROFILE_PACKAGE_LIMITS.manifestBytes) {
        hardLimitExceeded = true;
        reportError('manifest.json 超过 1 MiB 上限');
        return false;
      }
      return true;
    }, signal);
  } catch (error) {
    if (isAbortError(error)) throw error;
    return invalidResult(['文件不是有效的 ZIP 配置包'], fileCount, unpackedBytes);
  }

  const manifestEntry = archiveEntries.get('manifest.json');
  if (!manifestEntry) {
    reportError('包根目录缺少 manifest.json');
    return invalidResult(validationErrors(), fileCount, unpackedBytes);
  }
  const manifestBytes = manifestFiles[manifestEntry.rawPath];
  if (!manifestBytes) {
    if (!validationErrors().some((error) => error.includes('manifest.json'))) reportError('manifest.json 无法安全解压');
    return invalidResult(validationErrors(), fileCount, unpackedBytes);
  }
  if (manifestBytes.byteLength > PROFILE_PACKAGE_LIMITS.manifestBytes) {
    reportError('manifest.json 实际内容超过 1 MiB 上限');
    return invalidResult(validationErrors(), fileCount, unpackedBytes);
  }

  let profile: RobotProfileManifestV1 | null = null;
  try {
    profile = parseRobotProfile(JSON.parse(strFromU8(manifestBytes)));
  } catch (error) {
    reportError(error instanceof Error ? `manifest 校验失败：${error.message}` : 'manifest 校验失败');
  }
  if (!profile || hardLimitExceeded) {
    return { valid: false, profile, errors: validationErrors(), fileCount, unpackedBytes };
  }

  const urdfEntry = archiveEntries.get(profile.model.urdfPath);
  if (!urdfEntry) {
    reportError(`缺少 URDF：${profile.model.urdfPath}`);
    return { valid: false, profile, errors: validationErrors(), fileCount, unpackedBytes };
  }
  if (urdfEntry.unpackedBytes > PROFILE_PACKAGE_LIMITS.urdfBytes) {
    reportError('URDF 超过 8 MiB 上限');
    return { valid: false, profile, errors: validationErrors(), fileCount, unpackedBytes };
  }

  let urdfFiles: Unzipped;
  try {
    urdfFiles = await extractSelectedEntries(
      archiveBytes,
      (entry) => normalizeArchivePath(entry.name) === profile!.model.urdfPath,
      signal
    );
  } catch (error) {
    if (isAbortError(error)) throw error;
    reportError('URDF 无法安全解压');
    return { valid: false, profile, errors: validationErrors(), fileCount, unpackedBytes };
  }

  const urdfBytes = urdfFiles[urdfEntry.rawPath];
  if (!urdfBytes) {
    reportError(`缺少 URDF：${profile.model.urdfPath}`);
  } else if (urdfBytes.byteLength > PROFILE_PACKAGE_LIMITS.urdfBytes) {
    reportError('URDF 实际内容超过 8 MiB 上限');
  } else {
    validateUrdf(strFromU8(urdfBytes), profile, archiveEntries, reportError);
  }

  const errors = validationErrors();
  return { valid: errors.length === 0, profile, errors, fileCount, unpackedBytes };
}

function validateUrdf(
  urdfText: string,
  profile: RobotProfileManifestV1,
  archiveEntries: Map<string, ArchiveEntry>,
  reportError: (message: string) => void
) {
  const xml = new DOMParser().parseFromString(urdfText, 'application/xml');
  if (xml.querySelector('parsererror')) {
    reportError('URDF XML 无法解析');
    return;
  }
  const urdfJointNames = new Set(Array.from(xml.querySelectorAll('joint')).map((node) => node.getAttribute('name')));
  profile.joints.forEach((joint) => {
    if (!urdfJointNames.has(joint.urdfJointName)) reportError(`URDF 缺少关节：${joint.urdfJointName}`);
  });
  const urdfDirectory = profile.model.urdfPath.includes('/')
    ? profile.model.urdfPath.slice(0, profile.model.urdfPath.lastIndexOf('/') + 1)
    : '';
  Array.from(xml.querySelectorAll('mesh')).forEach((mesh) => {
    const reference = mesh.getAttribute('filename') ?? '';
    if (!reference || reference.includes('://') || reference.startsWith('/') || /^[a-zA-Z]:/.test(reference)) {
      reportError(`非法 mesh 引用：${reference || '(empty)'}`);
      return;
    }
    const resolved = resolveRelativePath(urdfDirectory, reference);
    if (!resolved || !archiveEntries.has(resolved)) reportError(`缺少 mesh：${reference}`);
  });
}

function extractSelectedEntries(
  archive: Uint8Array,
  filter: (entry: UnzipFileInfo) => boolean,
  signal?: AbortSignal
): Promise<Unzipped> {
  return new Promise((resolve, reject) => {
    throwIfAborted(signal);
    let settled = false;
    let terminate = () => {};
    const finish = (action: () => void) => {
      if (settled) return;
      settled = true;
      signal?.removeEventListener('abort', abort);
      action();
    };
    const abort = () => finish(() => {
      try {
        terminate();
      } finally {
        reject(createAbortError());
      }
    });
    signal?.addEventListener('abort', abort, { once: true });
    try {
      terminate = unzip(archive, { filter }, (error, data) => finish(() => {
        if (error) reject(error);
        else resolve(data);
      }));
    } catch (error) {
      finish(() => reject(error));
    }
  });
}

function normalizeArchivePath(rawPath: string): string | null {
  if (!rawPath || rawPath.length > PROFILE_PACKAGE_LIMITS.pathCharacters
    || rawPath.startsWith('/') || rawPath.startsWith('\\')
    || /^[a-zA-Z]:/.test(rawPath) || /[\u0000-\u001f\u007f]/.test(rawPath)) {
    return null;
  }
  const segments: string[] = [];
  for (const segment of rawPath.replaceAll('\\', '/').split('/')) {
    if (!segment || segment === '.') continue;
    if (segment === '..' || segment.includes(':') || segment.endsWith('.') || segment.endsWith(' ')
      || windowsReservedName.test(segment)) return null;
    segments.push(segment);
  }
  const normalized = segments.join('/');
  return normalized && normalized.length <= PROFILE_PACKAGE_LIMITS.pathCharacters ? normalized : null;
}

function extensionOf(path: string): string {
  const dot = path.lastIndexOf('.');
  return dot >= 0 ? path.slice(dot).toLowerCase() : '';
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

function invalidResult(errors: string[], fileCount = 0, unpackedBytes = 0): ProfilePackageValidation {
  return { valid: false, profile: null, errors, fileCount, unpackedBytes };
}

function printablePath(path: string) {
  return path.slice(0, PROFILE_PACKAGE_LIMITS.pathCharacters).replace(/[\u0000-\u001f\u007f]/g, '?');
}

function createErrorCollector() {
  const errors: string[] = [];
  let omitted = 0;
  return {
    report(message: string) {
      if (errors.length < PROFILE_PACKAGE_LIMITS.reportedErrors) errors.push(message);
      else omitted += 1;
    },
    snapshot() {
      return omitted > 0 ? [...errors, `另有 ${omitted} 项错误未展开`] : [...errors];
    }
  };
}

function createAbortError() {
  const error = new Error('Profile package validation cancelled');
  error.name = 'AbortError';
  return error;
}

function throwIfAborted(signal?: AbortSignal) {
  if (signal?.aborted) throw createAbortError();
}

function isAbortError(error: unknown) {
  return error instanceof Error && error.name === 'AbortError';
}
