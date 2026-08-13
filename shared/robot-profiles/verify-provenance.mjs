import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const builtInRoot = fileURLToPath(new URL('./BuiltIn/', import.meta.url));
const sha256Pattern = /^[A-F0-9]{64}$/u;

function fail(profileId, message) {
  throw new Error(`[${profileId}] ${message}`);
}

function requireString(profileId, value, field) {
  if (typeof value !== 'string' || value.length === 0) {
    fail(profileId, `${field} must be a non-empty string.`);
  }
  return value;
}

function requireSha256(profileId, value, field) {
  const hash = requireString(profileId, value, field);
  if (!sha256Pattern.test(hash)) {
    fail(profileId, `${field} must be an uppercase SHA-256 value.`);
  }
  return hash;
}

function requireSourcePath(profileId, value, field, packagePath, sourceField) {
  const archivePath = requireString(profileId, value, field).replaceAll('\\', '/');
  const segments = archivePath.split('/');
  if (
    archivePath.startsWith('/')
    || /^[A-Za-z]:/u.test(archivePath)
    || segments.some((segment) => segment === '' || segment === '.' || segment === '..')
    || !archivePath.startsWith(`${packagePath}/`)
  ) {
    fail(profileId, `${field} must remain inside ${sourceField}.packagePath.`);
  }
  return archivePath;
}

function resolveProfilePath(profileId, profileRoot, value, field) {
  const relativePath = requireString(profileId, value, field).replaceAll('\\', '/');
  if (relativePath.startsWith('/') || /^[A-Za-z]:/u.test(relativePath)) {
    fail(profileId, `${field} must be profile-relative.`);
  }

  const resolved = path.resolve(profileRoot, ...relativePath.split('/'));
  const relation = path.relative(profileRoot, resolved);
  if (relation === '' || relation === '..' || relation.startsWith(`..${path.sep}`) || path.isAbsolute(relation)) {
    fail(profileId, `${field} escapes the profile root.`);
  }
  return { relativePath, resolved };
}

async function sha256(filePath) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(filePath)) {
    hash.update(chunk);
  }
  return hash.digest('hex').toUpperCase();
}

async function parseJson(profileId, filePath, label) {
  try {
    return JSON.parse(await readFile(filePath, 'utf8'));
  } catch (error) {
    throw new Error(`[${profileId}] Cannot read ${label}: ${error instanceof Error ? error.message : String(error)}`, {
      cause: error
    });
  }
}

function urdfMeshPaths(profileId, profileRoot, urdfPath, urdfText) {
  const paths = new Set();
  const meshPattern = /<mesh\b[^>]*\bfilename\s*=\s*["']([^"']+)["']/giu;

  for (const match of urdfText.matchAll(meshPattern)) {
    const reference = match[1];
    if (!reference || /^[A-Za-z][A-Za-z0-9+.-]*:/u.test(reference)) {
      fail(profileId, `URDF mesh reference is missing or external: ${reference ?? '<missing>'}.`);
    }

    const resolved = path.resolve(path.dirname(urdfPath), ...reference.replaceAll('\\', '/').split('/'));
    const relation = path.relative(profileRoot, resolved);
    if (relation === '..' || relation.startsWith(`..${path.sep}`) || path.isAbsolute(relation)) {
      fail(profileId, `URDF mesh reference escapes the profile root: ${reference}.`);
    }
    paths.add(relation.replaceAll(path.sep, '/'));
  }

  if (paths.size === 0) {
    fail(profileId, 'URDF does not reference any meshes.');
  }
  return paths;
}

async function verifyProfile(profileRoot, directoryName) {
  const provenancePath = path.join(profileRoot, 'provenance.json');
  const manifestPath = path.join(profileRoot, 'manifest.json');
  const provenance = await parseJson(directoryName, provenancePath, 'provenance.json');
  const manifest = await parseJson(directoryName, manifestPath, 'manifest.json');
  const profileId = requireString(directoryName, provenance.profileId, 'profileId');

  if (provenance.schemaVersion !== '1.0' && provenance.schemaVersion !== '1.1') {
    fail(profileId, `Unsupported provenance schemaVersion: ${String(provenance.schemaVersion)}.`);
  }
  if (profileId !== directoryName || manifest.profileId !== profileId) {
    fail(profileId, 'Directory, provenance, and manifest profile IDs must match.');
  }
  const sourceField = provenance.schemaVersion === '1.1' ? 'sourceArtifact' : 'sourceArchive';
  const sourceArtifact = provenance[sourceField];
  if (provenance.schemaVersion === '1.1') {
    if (sourceArtifact?.kind !== 'directory-snapshot') {
      fail(profileId, 'sourceArtifact.kind must be directory-snapshot.');
    }
    requireString(profileId, sourceArtifact?.name, 'sourceArtifact.name');
    requireString(profileId, sourceArtifact?.hashMethod, 'sourceArtifact.hashMethod');
    if (!Number.isInteger(sourceArtifact?.fileCount) || sourceArtifact.fileCount <= 0) {
      fail(profileId, 'sourceArtifact.fileCount must be a positive integer.');
    }
    if (!Number.isInteger(sourceArtifact?.totalBytes) || sourceArtifact.totalBytes <= 0) {
      fail(profileId, 'sourceArtifact.totalBytes must be a positive integer.');
    }
  } else {
    requireString(profileId, sourceArtifact?.fileName, 'sourceArchive.fileName');
  }
  requireSha256(profileId, sourceArtifact?.sha256, `${sourceField}.sha256`);
  requireString(profileId, sourceArtifact?.licenseDeclaration, `${sourceField}.licenseDeclaration`);
  const packagePath = requireString(profileId, sourceArtifact?.packagePath, `${sourceField}.packagePath`);
  const licenseAvailable = sourceArtifact?.completeLicenseTermsAvailable;
  if (typeof licenseAvailable !== 'boolean') {
    fail(profileId, `${sourceField}.completeLicenseTermsAvailable must be a boolean.`);
  }
  if (!licenseAvailable && !/(declared|unverified)/iu.test(String(manifest.source?.license))) {
    fail(profileId, 'An incomplete source license must remain explicit in manifest.source.license.');
  }
  if (licenseAvailable) {
    const license = resolveProfilePath(profileId, profileRoot, sourceArtifact?.licensePath, `${sourceField}.licensePath`);
    const expectedLicenseHash = requireSha256(profileId, sourceArtifact?.licenseSha256, `${sourceField}.licenseSha256`);
    if (await sha256(license.resolved) !== expectedLicenseHash) {
      fail(profileId, `${license.relativePath} does not match ${sourceField}.licenseSha256.`);
    }
  }

  const sourceUrdfHash = requireSha256(profileId, provenance.urdf?.sourceSha256, 'urdf.sourceSha256');
  requireSourcePath(profileId, provenance.urdf?.sourcePath, 'urdf.sourcePath', packagePath, sourceField);
  if (manifest.source?.urdfSha256 !== sourceUrdfHash) {
    fail(profileId, 'manifest.source.urdfSha256 does not match the recorded source URDF hash.');
  }

  const urdf = resolveProfilePath(profileId, profileRoot, provenance.urdf?.normalizedPath, 'urdf.normalizedPath');
  if (manifest.model?.urdfPath !== urdf.relativePath) {
    fail(profileId, 'manifest.model.urdfPath does not match provenance.urdf.normalizedPath.');
  }
  const expectedUrdfHash = requireSha256(profileId, provenance.urdf?.normalizedSha256, 'urdf.normalizedSha256');
  const actualUrdfHash = await sha256(urdf.resolved);
  if (actualUrdfHash !== expectedUrdfHash) {
    fail(profileId, `Normalized URDF hash mismatch: expected ${expectedUrdfHash}, received ${actualUrdfHash}.`);
  }

  if (!Array.isArray(provenance.meshMappings) || provenance.meshMappings.length === 0) {
    fail(profileId, 'meshMappings must contain every normalized STL asset.');
  }

  const normalizedPaths = new Set();
  const sourcePaths = new Set();
  for (const [index, mapping] of provenance.meshMappings.entries()) {
    const prefix = `meshMappings[${index}]`;
    const sourcePath = requireSourcePath(profileId, mapping.sourcePath, `${prefix}.sourcePath`, packagePath, sourceField);
    const normalized = resolveProfilePath(profileId, profileRoot, mapping.normalizedPath, `${prefix}.normalizedPath`);
    const sourceHash = requireSha256(profileId, mapping.sourceSha256, `${prefix}.sourceSha256`);
    const normalizedHash = requireSha256(profileId, mapping.normalizedSha256, `${prefix}.normalizedSha256`);

    if (sourcePaths.has(sourcePath) || normalizedPaths.has(normalized.relativePath)) {
      fail(profileId, `${prefix} duplicates a source or normalized asset path.`);
    }
    sourcePaths.add(sourcePath);
    normalizedPaths.add(normalized.relativePath);

    if (mapping.byteIdentical !== true || sourceHash !== normalizedHash) {
      fail(profileId, `${prefix} must record a byte-identical source-to-normalized STL migration.`);
    }

    const actualHash = await sha256(normalized.resolved);
    if (actualHash !== normalizedHash) {
      fail(profileId, `${normalized.relativePath} hash mismatch: expected ${normalizedHash}, received ${actualHash}.`);
    }
  }

  const urdfText = await readFile(urdf.resolved, 'utf8');
  const referencedMeshes = urdfMeshPaths(profileId, profileRoot, urdf.resolved, urdfText);
  const diskMeshes = new Set(
    (await readdir(path.join(profileRoot, 'meshes'), { withFileTypes: true }))
      .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith('.stl'))
      .map((entry) => `meshes/${entry.name}`)
  );

  for (const expectedPath of new Set([...normalizedPaths, ...referencedMeshes, ...diskMeshes])) {
    if (!normalizedPaths.has(expectedPath) || !referencedMeshes.has(expectedPath) || !diskMeshes.has(expectedPath)) {
      fail(profileId, `Mesh coverage differs between provenance, URDF, and disk: ${expectedPath}.`);
    }
  }

  return `${profileId}: 1 URDF and ${normalizedPaths.size} byte-identical STL mappings`;
}

const directories = (await readdir(builtInRoot, { withFileTypes: true }))
  .filter((entry) => entry.isDirectory())
  .sort((left, right) => left.name.localeCompare(right.name));
const verified = [];

for (const directory of directories) {
  const profileRoot = path.join(builtInRoot, directory.name);
  const files = await readdir(profileRoot);
  if (files.includes('provenance.json')) {
    verified.push(await verifyProfile(profileRoot, directory.name));
  }
}

if (verified.length === 0) {
  throw new Error('No built-in profile provenance records were found.');
}

console.log(`Profile provenance verified (${verified.join('; ')}).`);
