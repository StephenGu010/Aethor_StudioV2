import { createHash } from 'node:crypto';
import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const SPDX_VERSION = 'SPDX-2.3';
const SUMMARY_SCHEMA = 'aethor.third-party-inventory-summary.v1';
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
    comment: `Used by: ${component.usedBy.join(', ')}. License text bundled: ${component.licenseTextAvailable ? 'yes' : 'no'}.`,
  };
  if (component.homepage) result.homepage = component.homepage;
  if (component.description) result.summary = component.description;
  return result;
}

function buildNpmLicenseBundle(components) {
  const sections = [
    '# npm production dependency license texts',
    '',
    'Generated from the installed production dependency graph. Text is reproduced from package-root legal files without modification.',
    '',
  ];
  for (const component of components.filter((item) => item.ecosystem === 'npm')) {
    sections.push(`## ${component.name} ${component.version}`, '');
    if (component.legalFiles.length === 0) {
      sections.push('_No package-root legal text was present in the installed package._', '');
      continue;
    }
    for (const file of component.legalFiles) {
      sections.push(`### ${file.name}`, '', '~~~~text', file.content.replace(/\s+$/u, ''), '~~~~', '');
    }
  }
  return `${sections.join('\n').replace(/\n{3,}/g, '\n\n')}\n`;
}

function copyDotnetLegalFiles(components, thirdPartyOutput) {
  const artifacts = [];
  const usedNames = new Set();
  for (const component of components.filter((item) => item.ecosystem === 'nuget')) {
    for (const file of component.legalFiles) {
      const legalName = safeSlug(file.name).replace(/\.txt$/i, '');
      const baseName = `nuget-${safeSlug(component.name)}-${safeSlug(component.version)}-${legalName}.txt`;
      let outputName = baseName;
      let suffix = 2;
      while (usedNames.has(outputName.toLowerCase())) {
        outputName = `${baseName.slice(0, -4)}-${suffix}.txt`;
        suffix += 1;
      }
      usedNames.add(outputName.toLowerCase());
      cpSync(join(component.packageRoot, file.name), join(thirdPartyOutput, outputName));
      artifacts.push(`Legal/ThirdParty/${outputName}`);
    }
  }
  return artifacts.sort((left, right) => left.localeCompare(right, 'en'));
}

function createSpdxDocument({ components, productVersion, sourceCommit, createdAt }) {
  const inventoryFingerprint = sha256(
    JSON.stringify(
      components.map((component) => ({
        key: component.key,
        declaredLicense: component.declaredLicense,
        legalFiles: component.legalFiles.map((file) => ({ name: file.name, sha256: file.sha256 })),
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
    `- Package-local license text gaps: ${summary.missingLicenseTextCount}.`,
    `- Release legal gate: ${summary.releaseReady ? 'READY' : 'BLOCKED'}.`,
    '',
  ];
  if (!summary.releaseReady) {
    lines.push(
      'A release candidate remains blocked until every item below has an authoritative license text or an approved legal disposition. Declared SPDX expressions are recorded, but they do not replace missing package copyright/license notices.',
      '',
      ...summary.missingLicenseTexts.map(
        (item) => `- ${item.ecosystem}: \`${item.name}@${item.version}\` — declared \`${item.declaredLicense}\`.`,
      ),
      '',
    );
  }
  lines.push(
    '## Inventory',
    '',
    '| Ecosystem | Component | Version | Declared license | Bundled package text | Used by |',
    '| --- | --- | --- | --- | --- | --- |',
  );
  for (const component of components) {
    lines.push(
      `| ${markdownCell(component.ecosystem)} | ${markdownCell(component.name)} | ${markdownCell(component.version)} | ${markdownCell(component.declaredLicense)} | ${component.licenseTextAvailable ? 'Yes' : 'No'} | ${markdownCell(component.usedBy.join(', '))} |`,
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

  const legalOutput = resolve(outputDirectory);
  const thirdPartyOutput = join(legalOutput, 'ThirdParty');
  rmSync(thirdPartyOutput, { recursive: true, force: true });
  mkdirSync(thirdPartyOutput, { recursive: true });

  const npmBundlePath = join(thirdPartyOutput, 'NPM-LICENSE-TEXTS.md');
  writeFileSync(npmBundlePath, buildNpmLicenseBundle(components), 'utf8');
  const legalArtifacts = [
    'Legal/ThirdParty/NPM-LICENSE-TEXTS.md',
    ...copyDotnetLegalFiles(components, thirdPartyOutput),
  ];
  const missingLicenseTexts = components
    .filter((component) => !component.licenseTextAvailable)
    .map((component) => ({
      ecosystem: component.ecosystem,
      name: component.name,
      version: component.version,
      declaredLicense: component.declaredLicense,
    }));
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
    missingLicenseTextCount: missingLicenseTexts.length,
    missingLicenseTexts,
    releaseReady: missingLicenseTexts.length === 0,
    legalArtifacts,
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
