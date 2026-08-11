import { createHash } from 'node:crypto';
import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const SPDX_VERSION = 'SPDX-2.3';
const SUMMARY_SCHEMA = 'aethor.third-party-inventory-summary.v2';
const CURATED_LICENSE_SCHEMA = 'aethor.third-party-license-sources.v1';
const MODEL_REDISTRIBUTION_SCHEMA = 'aethor.model-redistribution-status.v1';
const REQUIRED_MODEL_PROFILE_IDS = ['aethor-robo-dual-7dof', 'dummy-6dof'];
const LICENSE_FILE_PATTERN = /^(?:licen[cs]e|unlicense|copying|copyright)(?:$|[._ -])/i;
const LEGAL_FILE_PATTERN = /^(?:(?:licen[cs]e|unlicense|copying|copyright|notice)(?:$|[._ -])|third[._ -]?party[._ -]?notices?(?:$|[._ -]))/i;

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8').replace(/^\uFEFF/, ''));
}

function writeJson(path, value) {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function stableUnique(values) {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right, 'en'));
}

function safeSlug(value) {
  const slug = String(value)
    .replace(/^@/, '')
    .replace(/[^A-Za-z0-9.-]+/g, '-')
    .replace(/^[.-]+|[.-]+$/g, '');
  return slug || 'component';
}

function markdownCell(value) {
  return String(value ?? '').replace(/\|/g, '\\|').replace(/[\r\n]+/g, ' ');
}

function normalizeAuthor(author) {
  if (!author) return undefined;
  if (typeof author === 'string') return author;
  if (typeof author.name === 'string') return author.name;
  return undefined;
}

function normalizeUrl(value) {
  if (typeof value !== 'string' || value.length === 0) return undefined;
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.href : undefined;
  } catch {
    return undefined;
  }
}

function assertObject(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
  return value;
}

function assertExactKeys(value, expected, label) {
  const actual = Object.keys(value).sort((left, right) => left.localeCompare(right, 'en'));
  const required = [...expected].sort((left, right) => left.localeCompare(right, 'en'));
  if (actual.length !== required.length || actual.some((key, index) => key !== required[index])) {
    throw new Error(`${label} has unsupported or missing fields: ${actual.join(', ')}`);
  }
}

function requiredString(value, label) {
  if (typeof value !== 'string' || value.trim().length === 0) throw new Error(`${label} must be a non-empty string`);
  return value;
}

function requireHttpsUrl(value, label) {
  const normalized = normalizeUrl(requiredString(value, label));
  if (!normalized || new URL(normalized).protocol !== 'https:') throw new Error(`${label} must be an HTTPS URL`);
  return normalized;
}

function isPathInside(root, candidate) {
  const child = relative(root, candidate);
  return child.length > 0 && child !== '..' && !child.startsWith(`..${sep}`) && !isAbsolute(child);
}

function resolveVerifiedTextFile(root, relativePath, expectedSha256, label) {
  const pathValue = requiredString(relativePath, `${label}.path`);
  if (isAbsolute(pathValue)) throw new Error(`${label}.path must be relative`);
  const rootReal = realpathSync(root);
  const candidate = resolve(root, pathValue);
  if (!isPathInside(root, candidate) || !existsSync(candidate) || !statSync(candidate).isFile()) {
    throw new Error(`${label}.path is missing or escapes its manifest directory: ${pathValue}`);
  }
  const candidateReal = realpathSync(candidate);
  if (!isPathInside(rootReal, candidateReal)) throw new Error(`${label}.path resolves outside its manifest directory`);
  const bytes = readFileSync(candidateReal);
  if (bytes.length === 0 || bytes.length > 256 * 1024) throw new Error(`${label}.path has an invalid text length`);
  const content = bytes.toString('utf8');
  if (!Buffer.from(content, 'utf8').equals(bytes)) throw new Error(`${label}.path must be valid UTF-8`);
  const actualSha256 = sha256(bytes);
  if (!/^[a-f0-9]{64}$/.test(expectedSha256) || actualSha256 !== expectedSha256) {
    throw new Error(`${label}.sha256 does not match ${pathValue}`);
  }
  return { sourcePath: candidateReal, content, sha256: actualSha256 };
}

function readCuratedLicenseSources(manifestPath) {
  if (!manifestPath) return new Map();
  const resolvedManifest = resolve(manifestPath);
  const document = assertObject(readJson(resolvedManifest), 'Curated license manifest');
  assertExactKeys(document, ['schemaVersion', 'sources'], 'Curated license manifest');
  if (document.schemaVersion !== CURATED_LICENSE_SCHEMA || !Array.isArray(document.sources)) {
    throw new Error(`Unsupported curated license manifest schema: ${document.schemaVersion ?? '<missing>'}`);
  }
  const manifestRoot = dirname(resolvedManifest);
  const sources = new Map();
  for (const [index, value] of document.sources.entries()) {
    const label = `Curated license source ${index}`;
    const source = assertObject(value, label);
    assertExactKeys(
      source,
      ['declaredLicense', 'ecosystem', 'licenseTextPath', 'licenseTextSha256', 'name', 'packageEvidence', 'upstream', 'version'],
      label,
    );
    if (!['npm', 'nuget'].includes(source.ecosystem)) throw new Error(`${label}.ecosystem is unsupported`);
    const name = requiredString(source.name, `${label}.name`);
    const version = requiredString(source.version, `${label}.version`);
    const key = `${source.ecosystem}:${name}@${version}`;
    if (sources.has(key)) throw new Error(`Duplicate curated license identity: ${key}`);
    const declaredLicense = requiredString(source.declaredLicense, `${label}.declaredLicense`);
    const textFile = resolveVerifiedTextFile(
      manifestRoot,
      source.licenseTextPath,
      requiredString(source.licenseTextSha256, `${label}.licenseTextSha256`),
      `${label}.licenseText`,
    );
    const upstream = assertObject(source.upstream, `${label}.upstream`);
    assertExactKeys(upstream, ['blobSha', 'contentSha256', 'path', 'relation', 'repositoryUrl', 'revision'], `${label}.upstream`);
    const revision = requiredString(upstream.revision, `${label}.upstream.revision`);
    const blobSha = requiredString(upstream.blobSha, `${label}.upstream.blobSha`);
    const contentSha256 = requiredString(upstream.contentSha256, `${label}.upstream.contentSha256`);
    if (!/^[a-f0-9]{40}$/.test(revision) || !/^[a-f0-9]{40}$/.test(blobSha)) {
      throw new Error(`${label}.upstream revision and blob SHA must be lowercase immutable Git hashes`);
    }
    if (!/^[a-f0-9]{64}$/.test(contentSha256)) throw new Error(`${label}.upstream.contentSha256 is invalid`);
    if (!['package-source-revision', 'repository-license-after-package-release', 'repository-license-on-release-branch'].includes(upstream.relation)) {
      throw new Error(`${label}.upstream.relation is unsupported`);
    }
    const upstreamPath = requiredString(upstream.path, `${label}.upstream.path`).replace(/\\/g, '/');
    if (upstreamPath.startsWith('/') || upstreamPath.split('/').includes('..')) {
      throw new Error(`${label}.upstream.path must be repository-relative`);
    }
    const packageEvidence = assertObject(source.packageEvidence, `${label}.packageEvidence`);
    assertExactKeys(packageEvidence, ['integrity', 'type', 'url'], `${label}.packageEvidence`);
    if (!['npm-dist-integrity', 'nuget-package-sha512'].includes(packageEvidence.type)) {
      throw new Error(`${label}.packageEvidence.type is unsupported`);
    }
    sources.set(key, {
      key,
      ecosystem: source.ecosystem,
      name,
      version,
      declaredLicense,
      textFile,
      upstream: {
        repositoryUrl: requireHttpsUrl(upstream.repositoryUrl, `${label}.upstream.repositoryUrl`),
        revision,
        relation: upstream.relation,
        path: upstreamPath,
        blobSha,
        contentSha256,
      },
      packageEvidence: {
        type: packageEvidence.type,
        url: requireHttpsUrl(packageEvidence.url, `${label}.packageEvidence.url`),
        integrity: requiredString(packageEvidence.integrity, `${label}.packageEvidence.integrity`),
      },
    });
  }
  return sources;
}

function applyCuratedLicenseSources(components, manifestPath) {
  const sources = readCuratedLicenseSources(manifestPath);
  const componentsByKey = new Map(components.map((component) => [component.key, component]));
  for (const source of sources.values()) {
    const component = componentsByKey.get(source.key);
    if (!component) throw new Error(`Curated license source does not match a packaged component: ${source.key}`);
    if (component.declaredLicense !== source.declaredLicense) {
      throw new Error(`Curated license declaration does not match package metadata: ${source.key}`);
    }
    if (component.licenseTextAvailable) {
      throw new Error(`Curated license source is stale because the package now contains license text: ${source.key}`);
    }
    component.legalFiles.push({
      name: basename(source.textFile.sourcePath),
      content: source.textFile.content,
      sha256: source.textFile.sha256,
      containsLicenseText: true,
      sourceKind: 'curated-upstream',
      sourcePath: source.textFile.sourcePath,
    });
    component.licenseTextAvailable = true;
    component.curatedLicense = {
      textSha256: source.textFile.sha256,
      upstream: source.upstream,
      packageEvidence: source.packageEvidence,
    };
  }
  return sources.size;
}

function readModelRedistributionStatus(statusPath) {
  const resolvedStatusPath = resolve(statusPath);
  const document = assertObject(readJson(resolvedStatusPath), 'Model redistribution status');
  assertExactKeys(document, ['profiles', 'schemaVersion'], 'Model redistribution status');
  if (document.schemaVersion !== MODEL_REDISTRIBUTION_SCHEMA || !Array.isArray(document.profiles)) {
    throw new Error(`Unsupported model redistribution status schema: ${document.schemaVersion ?? '<missing>'}`);
  }
  const statusRoot = dirname(resolvedStatusPath);
  const profileIds = new Set();
  const profiles = document.profiles.map((value, index) => {
    const label = `Model redistribution profile ${index}`;
    const profile = assertObject(value, label);
    assertExactKeys(
      profile,
      ['declaredLicense', 'evidence', 'profileId', 'redistributionTermsComplete', 'unresolvedReason'],
      label,
    );
    const profileId = requiredString(profile.profileId, `${label}.profileId`);
    if (profileIds.has(profileId)) throw new Error(`Duplicate model redistribution profile: ${profileId}`);
    profileIds.add(profileId);
    if (typeof profile.redistributionTermsComplete !== 'boolean') {
      throw new Error(`${label}.redistributionTermsComplete must be boolean`);
    }
    if (!Array.isArray(profile.evidence) || profile.evidence.length === 0) throw new Error(`${label}.evidence is required`);
    const packagedPaths = new Set();
    const evidence = profile.evidence.map((evidenceValue, evidenceIndex) => {
      const evidenceLabel = `${label}.evidence[${evidenceIndex}]`;
      const item = assertObject(evidenceValue, evidenceLabel);
      assertExactKeys(item, ['packagedPath', 'sourcePath', 'sourceSha256'], evidenceLabel);
      const source = resolveVerifiedTextFile(
        statusRoot,
        item.sourcePath,
        requiredString(item.sourceSha256, `${evidenceLabel}.sourceSha256`),
        evidenceLabel,
      );
      const packagedPath = requiredString(item.packagedPath, `${evidenceLabel}.packagedPath`).replace(/\\/g, '/');
      if (!packagedPath.startsWith('Legal/') || packagedPath.split('/').includes('..') || packagedPaths.has(packagedPath)) {
        throw new Error(`${evidenceLabel}.packagedPath is unsafe or duplicated`);
      }
      packagedPaths.add(packagedPath);
      return { packagedPath, sourceSha256: source.sha256 };
    });
    if (typeof profile.unresolvedReason !== 'string' || (!profile.redistributionTermsComplete && profile.unresolvedReason.trim().length === 0)) {
      throw new Error(`${label}.unresolvedReason is required while redistribution terms are incomplete`);
    }
    return {
      profileId,
      declaredLicense: requiredString(profile.declaredLicense, `${label}.declaredLicense`),
      redistributionTermsComplete: profile.redistributionTermsComplete,
      unresolvedReason: profile.unresolvedReason,
      evidence,
    };
  });
  const actualProfileIds = [...profileIds].sort((left, right) => left.localeCompare(right, 'en'));
  if (JSON.stringify(actualProfileIds) !== JSON.stringify(REQUIRED_MODEL_PROFILE_IDS)) {
    throw new Error(`Model redistribution status must cover exactly: ${REQUIRED_MODEL_PROFILE_IDS.join(', ')}`);
  }
  return { resolvedStatusPath, profiles: profiles.sort((left, right) => left.profileId.localeCompare(right.profileId, 'en')) };
}

function packageMetadata(packageRoot) {
  const packageJsonPath = join(packageRoot, 'package.json');
  if (!existsSync(packageJsonPath)) return undefined;
  return readJson(packageJsonPath);
}

function readLegalFiles(packageRoot) {
  if (!existsSync(packageRoot) || !statSync(packageRoot).isDirectory()) return [];
  return readdirSync(packageRoot, { withFileTypes: true })
    .filter((entry) => entry.isFile() && LEGAL_FILE_PATTERN.test(entry.name))
    .map((entry) => {
      const path = join(packageRoot, entry.name);
      const content = readFileSync(path, 'utf8').replace(/^\uFEFF/, '');
      return {
        name: entry.name,
        content,
        sha256: sha256(content),
        containsLicenseText: LICENSE_FILE_PATTERN.test(entry.name),
        sourceKind: 'package',
        sourcePath: path,
      };
    })
    .sort((left, right) => left.name.localeCompare(right.name, 'en'));
}

function selectNpmPackageRoot(paths, version) {
  const candidates = [];
  for (const path of paths ?? []) {
    try {
      const metadata = packageMetadata(path);
      if (metadata?.version === version) candidates.push(resolve(path));
    } catch {
      // A stale peer-variant path is ignored when another exact package root exists.
    }
  }
  return candidates.sort((left, right) => left.localeCompare(right, 'en'))[0];
}

export function collectNpmComponents(pnpmLicenseDocument) {
  const components = new Map();
  for (const [licenseGroup, records] of Object.entries(pnpmLicenseDocument)) {
    if (!Array.isArray(records)) continue;
    for (const record of records) {
      for (const version of stableUnique(record.versions ?? [])) {
        const packageRoot = selectNpmPackageRoot(record.paths, version);
        if (!packageRoot) {
          throw new Error(`Unable to resolve installed npm package root: ${record.name}@${version}`);
        }
        const metadata = packageMetadata(packageRoot) ?? {};
        const key = `npm:${record.name}@${version}`;
        const legalFiles = readLegalFiles(packageRoot);
        const component = {
          key,
          ecosystem: 'npm',
          name: record.name,
          version,
          declaredLicense: record.license || licenseGroup || metadata.license || 'NOASSERTION',
          homepage: normalizeUrl(record.homepage || metadata.homepage),
          author: normalizeAuthor(record.author || metadata.author),
          description: record.description || metadata.description,
          packageRoot,
          legalFiles,
          licenseTextAvailable: legalFiles.some((file) => file.containsLicenseText),
          usedBy: ['web'],
        };
        const existing = components.get(key);
        if (existing) {
          existing.usedBy = stableUnique([...existing.usedBy, ...component.usedBy]);
        } else {
          components.set(key, component);
        }
      }
    }
  }
  return [...components.values()].sort((left, right) => left.key.localeCompare(right.key, 'en'));
}

function decodeXml(value) {
  return String(value ?? '')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
}

function extractXmlElement(xml, name) {
  const match = xml.match(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${name}>`, 'i'));
  return match ? decodeXml(match[1].trim()) : undefined;
}

function extractXmlAttribute(fragment, name) {
  const match = fragment.match(new RegExp(`\\b${name}\\s*=\\s*["']([^"']*)["']`, 'i'));
  return match ? decodeXml(match[1]) : undefined;
}

function readNuspec(packageRoot) {
  const nuspecName = readdirSync(packageRoot)
    .filter((name) => name.toLowerCase().endsWith('.nuspec'))
    .sort((left, right) => left.localeCompare(right, 'en'))[0];
  if (!nuspecName) throw new Error(`NuGet package has no .nuspec metadata: ${packageRoot}`);
  const xml = readFileSync(join(packageRoot, nuspecName), 'utf8');
  const licenseMatch = xml.match(/<license(?:\s[^>]*)?>([\s\S]*?)<\/license>/i);
  const licenseOpeningTag = licenseMatch?.[0].match(/^<license[^>]*>/i)?.[0] ?? '';
  const repositoryTag = xml.match(/<repository(?:\s[^>]*)?\/?\s*>/i)?.[0] ?? '';
  return {
    id: extractXmlElement(xml, 'id'),
    version: extractXmlElement(xml, 'version'),
    licenseType: extractXmlAttribute(licenseOpeningTag, 'type'),
    licenseValue: licenseMatch ? decodeXml(licenseMatch[1].trim()) : undefined,
    projectUrl: normalizeUrl(extractXmlElement(xml, 'projectUrl')),
    repositoryUrl: normalizeUrl(extractXmlAttribute(repositoryTag, 'url')),
  };
}

function splitLibraryIdentity(identity) {
  const separator = identity.lastIndexOf('/');
  if (separator <= 0 || separator === identity.length - 1) {
    throw new Error(`Invalid .NET dependency identity: ${identity}`);
  }
  return { name: identity.slice(0, separator), version: identity.slice(separator + 1) };
}

function normalizeNugetPackageName(libraryName, libraryType) {
  if (libraryType === 'runtimepack' && libraryName.startsWith('runtimepack.')) {
    return libraryName.slice('runtimepack.'.length);
  }
  return libraryName;
}

function licenseRefFor(name, version) {
  return `LicenseRef-${safeSlug(name)}-${safeSlug(version)}`;
}

export function collectDotnetComponents(dependencyDocuments, nugetRoot) {
  const components = new Map();
  for (const source of dependencyDocuments) {
    for (const [identity, library] of Object.entries(source.document.libraries ?? {})) {
      if (!['package', 'runtimepack'].includes(library.type)) continue;
      const parsed = splitLibraryIdentity(identity);
      const name = normalizeNugetPackageName(parsed.name, library.type);
      const key = `nuget:${name}@${parsed.version}`;
      const packageRoot = join(nugetRoot, name.toLowerCase(), parsed.version.toLowerCase());
      if (!existsSync(packageRoot) || !statSync(packageRoot).isDirectory()) {
        throw new Error(`Published .NET dependency is absent from the NuGet cache: ${name}@${parsed.version}`);
      }
      const metadata = readNuspec(packageRoot);
      const legalFiles = readLegalFiles(packageRoot);
      const isFileLicense = metadata.licenseType?.toLowerCase() === 'file';
      const licenseFile = isFileLicense
        ? legalFiles.find((file) => file.name.toLowerCase() === metadata.licenseValue?.toLowerCase())
        : undefined;
      const declaredLicense = isFileLicense
        ? licenseRefFor(name, parsed.version)
        : metadata.licenseValue || 'NOASSERTION';
      const component = {
        key,
        ecosystem: 'nuget',
        name,
        version: parsed.version,
        declaredLicense,
        homepage: metadata.projectUrl || metadata.repositoryUrl,
        packageRoot,
        legalFiles,
        licenseTextAvailable: isFileLicense
          ? Boolean(licenseFile)
          : legalFiles.some((file) => file.containsLicenseText),
        extractedLicense: licenseFile
          ? {
              licenseId: declaredLicense,
              name: `${name} package license`,
              extractedText: licenseFile.content,
            }
          : undefined,
        usedBy: [source.name],
      };
      const existing = components.get(key);
      if (existing) {
        existing.usedBy = stableUnique([...existing.usedBy, ...component.usedBy]);
      } else {
        components.set(key, component);
      }
    }
  }
  return [...components.values()].sort((left, right) => left.key.localeCompare(right.key, 'en'));
}

function npmPurl(name, version) {
  if (name.startsWith('@')) {
    const [scope, packageName] = name.split('/');
    return `pkg:npm/${encodeURIComponent(scope)}/${encodeURIComponent(packageName)}@${encodeURIComponent(version)}`;
  }
  return `pkg:npm/${encodeURIComponent(name)}@${encodeURIComponent(version)}`;
}

function nugetPurl(name, version) {
  return `pkg:nuget/${encodeURIComponent(name)}@${encodeURIComponent(version)}`;
}

function spdxIdFor(component) {
  return `SPDXRef-${component.ecosystem}-${safeSlug(component.name)}-${safeSlug(component.version)}-${sha256(component.key).slice(0, 10)}`;
}

function toSpdxPackage(component) {
  const result = {
    name: component.name,
    SPDXID: spdxIdFor(component),
    versionInfo: component.version,
    downloadLocation: 'NOASSERTION',
    filesAnalyzed: false,
    licenseConcluded: 'NOASSERTION',
    licenseDeclared: component.declaredLicense,
    copyrightText: 'NOASSERTION',
    externalRefs: [
      {
        referenceCategory: 'PACKAGE-MANAGER',
        referenceType: 'purl',
        referenceLocator:
          component.ecosystem === 'npm'
            ? npmPurl(component.name, component.version)
            : nugetPurl(component.name, component.version),
      },
    ],
    comment: `Used by: ${component.usedBy.join(', ')}. License text bundled: ${component.licenseTextAvailable ? 'yes' : 'no'}. Text source: ${component.curatedLicense ? 'repository-curated pinned upstream record' : 'installed package'}.`,
  };
  if (component.homepage) result.homepage = component.homepage;
  if (component.description) result.summary = component.description;
  return result;
}

function buildNpmLicenseBundle(components) {
  const sections = [
    '# npm production dependency license texts',
    '',
    'Generated from the installed production dependency graph. Package-root text is reproduced from the installed package; curated text is a hash-verified UTF-8 copy bound to the exact component version and an immutable upstream revision.',
    '',
  ];
  for (const component of components.filter((item) => item.ecosystem === 'npm')) {
    sections.push(`## ${component.name} ${component.version}`, '');
    if (component.legalFiles.length === 0) {
      sections.push('_No package-root legal text was present in the installed package._', '');
      continue;
    }
    for (const file of component.legalFiles) {
      sections.push(`### ${file.name}`, '');
      if (file.sourceKind === 'curated-upstream') {
        sections.push(
          `Source: pinned upstream license record at \`${component.curatedLicense.upstream.revision}\` (${component.curatedLicense.upstream.path}); local SHA-256 \`${file.sha256}\`.`,
          '',
        );
      }
      sections.push('~~~~text', file.content.replace(/\s+$/u, ''), '~~~~', '');
    }
  }
  return `${sections.join('\n').replace(/\n{3,}/g, '\n\n')}\n`;
}

function copyDotnetLegalFiles(components, thirdPartyOutput) {
  const artifacts = [];
  const usedNames = new Set();
  for (const component of components.filter((item) => item.ecosystem === 'nuget')) {
    for (const file of component.legalFiles.filter((item) => item.sourceKind !== 'curated-upstream')) {
      const legalName = safeSlug(file.name).replace(/\.txt$/i, '');
      const baseName = `nuget-${safeSlug(component.name)}-${safeSlug(component.version)}-${legalName}.txt`;
      let outputName = baseName;
      let suffix = 2;
      while (usedNames.has(outputName.toLowerCase())) {
        outputName = `${baseName.slice(0, -4)}-${suffix}.txt`;
        suffix += 1;
      }
      usedNames.add(outputName.toLowerCase());
      cpSync(file.sourcePath, join(thirdPartyOutput, outputName));
      artifacts.push(`Legal/ThirdParty/${outputName}`);
    }
  }
  return artifacts.sort((left, right) => left.localeCompare(right, 'en'));
}

function copyCuratedLicenseFiles(components, thirdPartyOutput) {
  const artifacts = [];
  const usedNames = new Set();
  for (const component of components.filter((item) => item.curatedLicense)) {
    const file = component.legalFiles.find((item) => item.sourceKind === 'curated-upstream');
    if (!file) throw new Error(`Curated license text is missing after validation: ${component.key}`);
    const baseName = `curated-${component.ecosystem}-${safeSlug(component.name)}-${safeSlug(component.version)}-LICENSE.txt`;
    let outputName = baseName;
    let suffix = 2;
    while (usedNames.has(outputName.toLowerCase())) {
      outputName = `${baseName.slice(0, -4)}-${suffix}.txt`;
      suffix += 1;
    }
    usedNames.add(outputName.toLowerCase());
    cpSync(file.sourcePath, join(thirdPartyOutput, outputName));
    const artifact = `Legal/ThirdParty/${outputName}`;
    component.curatedLicense.artifact = artifact;
    artifacts.push(artifact);
  }
  return artifacts.sort((left, right) => left.localeCompare(right, 'en'));
}

function packageModelRedistributionStatus(modelStatus, legalOutput) {
  const artifacts = new Set(['Legal/MODEL-REDISTRIBUTION-STATUS.json']);
  for (const profile of modelStatus.profiles) {
    for (const evidence of profile.evidence) {
      const relativeToLegal = evidence.packagedPath.slice('Legal/'.length);
      const packagedEvidence = resolve(legalOutput, relativeToLegal);
      if (!isPathInside(legalOutput, packagedEvidence) || !existsSync(packagedEvidence) || !statSync(packagedEvidence).isFile()) {
        throw new Error(`Model redistribution evidence is absent from the package: ${evidence.packagedPath}`);
      }
      const actualSha256 = sha256(readFileSync(packagedEvidence));
      if (actualSha256 !== evidence.sourceSha256) {
        throw new Error(`Model redistribution evidence hash changed during packaging: ${evidence.packagedPath}`);
      }
      artifacts.add(evidence.packagedPath);
    }
  }
  cpSync(modelStatus.resolvedStatusPath, join(legalOutput, 'MODEL-REDISTRIBUTION-STATUS.json'));
  return [...artifacts].sort((left, right) => left.localeCompare(right, 'en'));
}

function createSpdxDocument({ components, productVersion, sourceCommit, createdAt }) {
  const inventoryFingerprint = sha256(
    JSON.stringify(
      components.map((component) => ({
        key: component.key,
        declaredLicense: component.declaredLicense,
        legalFiles: component.legalFiles.map((file) => ({
          name: file.name,
          sha256: file.sha256,
          sourceKind: file.sourceKind,
        })),
        curatedLicense: component.curatedLicense
          ? {
              upstream: component.curatedLicense.upstream,
              packageEvidence: component.curatedLicense.packageEvidence,
            }
          : undefined,
      })),
    ),
  );
  const dependencyPackages = components.map(toSpdxPackage);
  const rootId = 'SPDXRef-AethorStudioV2';
  const documentFingerprint = sha256(
    JSON.stringify({ inventoryFingerprint, productVersion, sourceCommit, createdAt: new Date(createdAt).toISOString() }),
  );
  const extractedLicenses = components
    .map((component) => component.extractedLicense)
    .filter(Boolean)
    .sort((left, right) => left.licenseId.localeCompare(right.licenseId, 'en'));
  const document = {
    spdxVersion: SPDX_VERSION,
    dataLicense: 'CC0-1.0',
    SPDXID: 'SPDXRef-DOCUMENT',
    name: `Aethor Studio V2 ${productVersion} third-party inventory`,
    documentNamespace: `https://aethor.studio/spdx/aethor-studio-v2/${encodeURIComponent(productVersion)}/${documentFingerprint}`,
    creationInfo: {
      created: new Date(createdAt).toISOString(),
      creators: ['Tool: Aethor Studio V2 third-party inventory generator'],
      comment: `Generated from source commit ${sourceCommit || 'NOASSERTION'} and exact production publish inputs.`,
    },
    documentDescribes: [rootId],
    packages: [
      {
        name: 'Aethor Studio V2',
        SPDXID: rootId,
        versionInfo: productVersion,
        downloadLocation: 'NOASSERTION',
        filesAnalyzed: false,
        licenseConcluded: 'NOASSERTION',
        licenseDeclared: 'NOASSERTION',
        copyrightText: 'NOASSERTION',
      },
      ...dependencyPackages,
    ],
    relationships: dependencyPackages.map((dependency) => ({
      spdxElementId: rootId,
      relationshipType: 'DEPENDS_ON',
      relatedSpdxElement: dependency.SPDXID,
    })),
  };
  if (extractedLicenses.length > 0) document.hasExtractedLicensingInfos = extractedLicenses;
  return { document, inventoryFingerprint };
}

function buildHumanNotice(summary, components) {
  const lines = [
    '# Aethor Studio V2 third-party notices',
    '',
    'This inventory is generated from the installed pnpm production graph and the exact `.deps.json` files emitted by the packaged Windows desktop and gateway. It is an engineering record, not legal advice and not a substitute for the upstream license terms.',
    '',
    '## Qualification',
    '',
    `- Components: ${summary.componentCount} (${summary.npmComponentCount} npm, ${summary.dotnetComponentCount} NuGet/runtime pack).`,
    `- Dependency license text gaps: ${summary.missingLicenseTextCount}.`,
    `- Curated, version-bound upstream texts: ${summary.curatedLicenseSourceCount}.`,
    `- Model redistribution gaps: ${summary.incompleteModelRedistributionCount}.`,
    `- Release legal gate: ${summary.releaseReady ? 'READY' : 'BLOCKED'}.`,
    '',
  ];
  if (!summary.releaseReady) {
    lines.push('A release candidate remains blocked until every dependency and model item below has authoritative terms or an approved legal disposition.', '');
    if (summary.missingLicenseTexts.length > 0) {
      lines.push(
        '### Dependency text gaps',
        '',
        ...summary.missingLicenseTexts.map(
          (item) => `- ${item.ecosystem}: \`${item.name}@${item.version}\` — declared \`${item.declaredLicense}\`.`,
        ),
        '',
      );
    }
    if (summary.incompleteModelRedistributions.length > 0) {
      lines.push(
        '### Model redistribution gaps',
        '',
        ...summary.incompleteModelRedistributions.map(
          (item) => `- \`${item.profileId}\` — declared \`${item.declaredLicense}\`; ${item.unresolvedReason}`,
        ),
        '',
      );
    }
  }
  lines.push(
    '## Inventory',
    '',
    '| Ecosystem | Component | Version | Declared license | Bundled text | Text source | Used by |',
    '| --- | --- | --- | --- | --- | --- | --- |',
  );
  for (const component of components) {
    lines.push(
      `| ${markdownCell(component.ecosystem)} | ${markdownCell(component.name)} | ${markdownCell(component.version)} | ${markdownCell(component.declaredLicense)} | ${component.licenseTextAvailable ? 'Yes' : 'No'} | ${component.curatedLicense ? 'Pinned upstream' : 'Installed package'} | ${markdownCell(component.usedBy.join(', '))} |`,
    );
  }
  lines.push(
    '',
    '## Bundled records',
    '',
    '- `THIRD-PARTY-INVENTORY.spdx.json`: SPDX 2.3 package inventory.',
    '- `THIRD-PARTY-SUMMARY.json`: machine-readable completeness gate.',
    '- `ThirdParty/NPM-LICENSE-TEXTS.md`: package-root npm legal texts.',
    '- `ThirdParty/nuget-*.txt`: exact legal files copied from the restored NuGet/runtime packages.',
    '- `ThirdParty/curated-*.txt`: version-bound, hash-verified upstream license texts for packages that omitted a root license file.',
    '- `MODEL-REDISTRIBUTION-STATUS.json`: machine-readable model redistribution completeness gate.',
    '',
  );
  return lines.join('\n');
}

export function generateThirdPartyInventory(options) {
  const {
    pnpmLicensePath,
    desktopDepsPath,
    gatewayDepsPath,
    nugetRoot,
    curatedLicenseManifestPath,
    modelRedistributionStatusPath,
    outputDirectory,
    productVersion,
    sourceCommit = 'NOASSERTION',
    createdAt = new Date().toISOString(),
  } = options;
  const npmComponents = collectNpmComponents(readJson(pnpmLicensePath));
  const dotnetComponents = collectDotnetComponents(
    [
      { name: 'desktop', document: readJson(desktopDepsPath) },
      { name: 'gateway', document: readJson(gatewayDepsPath) },
    ],
    resolve(nugetRoot),
  );
  const components = [...npmComponents, ...dotnetComponents].sort((left, right) =>
    left.key.localeCompare(right.key, 'en'),
  );
  const duplicateKeys = components.filter((component, index) => components.findIndex((item) => item.key === component.key) !== index);
  if (duplicateKeys.length > 0) throw new Error(`Duplicate inventory component: ${duplicateKeys[0].key}`);
  const curatedLicenseSourceCount = applyCuratedLicenseSources(components, curatedLicenseManifestPath);
  const modelRedistributionStatus = readModelRedistributionStatus(modelRedistributionStatusPath);

  const legalOutput = resolve(outputDirectory);
  const thirdPartyOutput = join(legalOutput, 'ThirdParty');
  rmSync(thirdPartyOutput, { recursive: true, force: true });
  mkdirSync(thirdPartyOutput, { recursive: true });

  const npmBundlePath = join(thirdPartyOutput, 'NPM-LICENSE-TEXTS.md');
  writeFileSync(npmBundlePath, buildNpmLicenseBundle(components), 'utf8');
  const curatedArtifacts = copyCuratedLicenseFiles(components, thirdPartyOutput);
  const legalArtifacts = [
    'Legal/ThirdParty/NPM-LICENSE-TEXTS.md',
    ...copyDotnetLegalFiles(components, thirdPartyOutput),
    ...curatedArtifacts,
  ];
  const modelLegalArtifacts = packageModelRedistributionStatus(modelRedistributionStatus, legalOutput);
  const missingLicenseTexts = components
    .filter((component) => !component.licenseTextAvailable)
    .map((component) => ({
      ecosystem: component.ecosystem,
      name: component.name,
      version: component.version,
      declaredLicense: component.declaredLicense,
    }));
  const incompleteModelRedistributions = modelRedistributionStatus.profiles
    .filter((profile) => !profile.redistributionTermsComplete)
    .map((profile) => ({
      profileId: profile.profileId,
      declaredLicense: profile.declaredLicense,
      unresolvedReason: profile.unresolvedReason,
    }));
  const dependencyLicenseTextReady = missingLicenseTexts.length === 0;
  const modelRedistributionReady = incompleteModelRedistributions.length === 0;
  const { document, inventoryFingerprint } = createSpdxDocument({
    components,
    productVersion,
    sourceCommit,
    createdAt,
  });
  const summary = {
    schemaVersion: SUMMARY_SCHEMA,
    generatedAtUtc: new Date(createdAt).toISOString(),
    productVersion,
    sourceCommit,
    componentFingerprintSha256: inventoryFingerprint,
    componentCount: components.length,
    npmComponentCount: npmComponents.length,
    dotnetComponentCount: dotnetComponents.length,
    curatedLicenseSourceCount,
    curatedLicenseSources: components
      .filter((component) => component.curatedLicense)
      .map((component) => ({
        ecosystem: component.ecosystem,
        name: component.name,
        version: component.version,
        declaredLicense: component.declaredLicense,
        textSha256: component.curatedLicense.textSha256,
        artifact: component.curatedLicense.artifact,
        upstream: component.curatedLicense.upstream,
        packageEvidence: component.curatedLicense.packageEvidence,
      })),
    missingLicenseTextCount: missingLicenseTexts.length,
    missingLicenseTexts,
    dependencyLicenseTextReady,
    modelRedistributionStatuses: modelRedistributionStatus.profiles,
    incompleteModelRedistributionCount: incompleteModelRedistributions.length,
    incompleteModelRedistributions,
    modelRedistributionReady,
    releaseReady: dependencyLicenseTextReady && modelRedistributionReady,
    legalArtifacts,
    modelLegalArtifacts,
  };

  writeJson(join(legalOutput, 'THIRD-PARTY-INVENTORY.spdx.json'), document);
  writeJson(join(legalOutput, 'THIRD-PARTY-SUMMARY.json'), summary);
  writeFileSync(join(legalOutput, 'THIRD-PARTY-NOTICES.md'), `${buildHumanNotice(summary, components)}\n`, 'utf8');
  return { summary, document, components };
}

function parseArguments(argv) {
  const values = {};
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index];
    const value = argv[index + 1];
    if (!key?.startsWith('--') || value === undefined) throw new Error(`Invalid argument near: ${key ?? '<end>'}`);
    values[key.slice(2)] = value;
  }
  const required = [
    'pnpm-license-path',
    'desktop-deps-path',
    'gateway-deps-path',
    'nuget-root',
    'curated-license-manifest-path',
    'model-redistribution-status-path',
    'output-directory',
    'product-version',
    'source-commit',
    'created-at',
  ];
  for (const key of required) {
    if (!values[key]) throw new Error(`Missing required argument: --${key}`);
  }
  return {
    pnpmLicensePath: values['pnpm-license-path'],
    desktopDepsPath: values['desktop-deps-path'],
    gatewayDepsPath: values['gateway-deps-path'],
    nugetRoot: values['nuget-root'],
    curatedLicenseManifestPath: values['curated-license-manifest-path'],
    modelRedistributionStatusPath: values['model-redistribution-status-path'],
    outputDirectory: values['output-directory'],
    productVersion: values['product-version'],
    sourceCommit: values['source-commit'],
    createdAt: values['created-at'],
  };
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : undefined;
if (invokedPath === fileURLToPath(import.meta.url)) {
  try {
    const result = generateThirdPartyInventory(parseArguments(process.argv.slice(2)));
    process.stdout.write(
      `${JSON.stringify({
        succeeded: true,
        componentCount: result.summary.componentCount,
        missingLicenseTextCount: result.summary.missingLicenseTextCount,
        releaseReady: result.summary.releaseReady,
      })}\n`,
    );
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`);
    process.exitCode = 1;
  }
}
