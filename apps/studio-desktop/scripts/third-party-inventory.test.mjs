import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { copyFileSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { generateThirdPartyInventory } from './third-party-inventory.mjs';

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function writeJson(path, value) {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function createNpmPackage(root, name, version, legalFiles = {}) {
  mkdirSync(root, { recursive: true });
  writeJson(join(root, 'package.json'), { name, version, license: 'MIT' });
  for (const [fileName, content] of Object.entries(legalFiles)) writeFileSync(join(root, fileName), content, 'utf8');
}

function createNugetPackage(root, name, version, licenseType, licenseValue, legalFiles = {}) {
  const packageRoot = join(root, name.toLowerCase(), version.toLowerCase());
  mkdirSync(packageRoot, { recursive: true });
  writeFileSync(
    join(packageRoot, `${name}.nuspec`),
    `<package><metadata><id>${name}</id><version>${version}</version><license type="${licenseType}">${licenseValue}</license><projectUrl>https://example.test/${name}</projectUrl></metadata></package>`,
    'utf8',
  );
  for (const [fileName, content] of Object.entries(legalFiles)) writeFileSync(join(packageRoot, fileName), content, 'utf8');
}

function curatedSource({ ecosystem, name, version, declaredLicense, textPath, text }) {
  return {
    ecosystem,
    name,
    version,
    declaredLicense,
    licenseTextPath: textPath,
    licenseTextSha256: sha256(text),
    upstream: {
      repositoryUrl: 'https://github.com/aethor-studio/license-fixture',
      revision: 'a'.repeat(40),
      relation: 'package-source-revision',
      path: 'LICENSE',
      blobSha: 'b'.repeat(40),
      contentSha256: 'c'.repeat(64),
    },
    packageEvidence: {
      type: ecosystem === 'npm' ? 'npm-dist-integrity' : 'nuget-package-sha512',
      url: ecosystem === 'npm' ? `https://registry.npmjs.org/${name}/${version}` : `https://www.nuget.org/packages/${name}/${version}`,
      integrity: 'sha512-fixture',
    },
  };
}

function createModelStatus(root, outputDirectories, complete) {
  const modelRoot = join(root, 'model-status');
  mkdirSync(modelRoot, { recursive: true });
  const dummyNotice = '# Dummy fixture notice\n';
  const aethorNotice = '# Aethor fixture notice\n';
  const aethorProvenance = '{"fixture":true}\n';
  writeFileSync(join(modelRoot, 'dummy.md'), dummyNotice, 'utf8');
  writeFileSync(join(modelRoot, 'aethor.md'), aethorNotice, 'utf8');
  writeFileSync(join(modelRoot, 'aethor.json'), aethorProvenance, 'utf8');
  const mappings = [
    ['dummy.md', 'Legal/dummy-6dof-NOTICE.md'],
    ['aethor.md', 'Legal/aethor-robo-dual-7dof-NOTICE.md'],
    ['aethor.json', 'Legal/aethor-robo-dual-7dof-provenance.json'],
  ];
  for (const outputDirectory of outputDirectories) {
    mkdirSync(outputDirectory, { recursive: true });
    for (const [source, packaged] of mappings) copyFileSync(join(modelRoot, source), join(outputDirectory, packaged.slice('Legal/'.length)));
  }
  const statusPath = join(modelRoot, 'status.json');
  writeJson(statusPath, {
    schemaVersion: 'aethor.model-redistribution-status.v1',
    profiles: [
      {
        profileId: 'dummy-6dof',
        declaredLicense: 'BSD-3-Clause',
        redistributionTermsComplete: complete,
        unresolvedReason: complete ? '' : 'Fixture Dummy terms are incomplete.',
        evidence: [
          { sourcePath: 'dummy.md', sourceSha256: sha256(dummyNotice), packagedPath: 'Legal/dummy-6dof-NOTICE.md' },
        ],
      },
      {
        profileId: 'aethor-robo-dual-7dof',
        declaredLicense: 'BSD (unverified)',
        redistributionTermsComplete: complete,
        unresolvedReason: complete ? '' : 'Fixture Aethor terms are incomplete.',
        evidence: [
          { sourcePath: 'aethor.md', sourceSha256: sha256(aethorNotice), packagedPath: 'Legal/aethor-robo-dual-7dof-NOTICE.md' },
          { sourcePath: 'aethor.json', sourceSha256: sha256(aethorProvenance), packagedPath: 'Legal/aethor-robo-dual-7dof-provenance.json' },
        ],
      },
    ],
  });
  return statusPath;
}

function createFixture(root, outputDirectories, modelTermsComplete = false) {
  const alpha = join(root, 'npm-alpha');
  const beta = join(root, 'npm-beta');
  createNpmPackage(alpha, '@fixture/alpha', '1.0.0', { 'LICENSE-MIT.txt': 'alpha license' });
  createNpmPackage(beta, 'beta', '2.0.0');

  const pnpmLicensePath = join(root, 'pnpm.json');
  writeJson(pnpmLicensePath, {
    MIT: [
      { name: '@fixture/alpha', versions: ['1.0.0'], paths: [alpha], license: 'MIT' },
      { name: 'beta', versions: ['2.0.0'], paths: [beta], license: 'MIT' },
    ],
  });

  const nugetRoot = join(root, 'nuget');
  createNugetPackage(
    nugetRoot,
    'Microsoft.NETCore.App.Runtime.win-x64',
    '10.0.10',
    'expression',
    'MIT',
    { 'LICENSE.TXT': 'runtime license', 'THIRD-PARTY-NOTICES.TXT': 'runtime notices' },
  );
  createNugetPackage(
    nugetRoot,
    'Microsoft.Web.WebView2',
    '1.2.3',
    'file',
    'LICENSE.txt',
    { 'LICENSE.txt': 'webview file license', 'NOTICE.txt': 'webview notice' },
  );
  createNugetPackage(
    nugetRoot,
    'System.IO.Ports',
    '10.0.0',
    'expression',
    'MIT',
    { 'THIRD-PARTY-NOTICES.TXT': 'ports notices only' },
  );

  const desktopDepsPath = join(root, 'desktop.deps.json');
  const gatewayDepsPath = join(root, 'gateway.deps.json');
  writeJson(desktopDepsPath, {
    libraries: {
      'AethorStudioV2.Desktop/0.1.0': { type: 'project' },
      'runtimepack.Microsoft.NETCore.App.Runtime.win-x64/10.0.10': { type: 'runtimepack' },
      'Microsoft.Web.WebView2/1.2.3': { type: 'package' },
      'Microsoft.Web.WebView2.Core/1.2.3': { type: 'reference' },
    },
  });
  writeJson(gatewayDepsPath, {
    libraries: {
      'AethorStudioV2.Api/0.1.0': { type: 'project' },
      'runtimepack.Microsoft.NETCore.App.Runtime.win-x64/10.0.10': { type: 'runtimepack' },
      'System.IO.Ports/10.0.0': { type: 'package' },
    },
  });

  const legalRoot = join(root, 'curated');
  mkdirSync(legalRoot, { recursive: true });
  const betaText = 'beta curated license\n';
  const portsText = 'ports curated license\n';
  writeFileSync(join(legalRoot, 'beta.txt'), betaText, 'utf8');
  writeFileSync(join(legalRoot, 'ports.txt'), portsText, 'utf8');
  const curatedLicenseManifestPath = join(legalRoot, 'manifest.json');
  writeJson(curatedLicenseManifestPath, {
    schemaVersion: 'aethor.third-party-license-sources.v1',
    sources: [
      curatedSource({ ecosystem: 'npm', name: 'beta', version: '2.0.0', declaredLicense: 'MIT', textPath: 'beta.txt', text: betaText }),
      curatedSource({ ecosystem: 'nuget', name: 'System.IO.Ports', version: '10.0.0', declaredLicense: 'MIT', textPath: 'ports.txt', text: portsText }),
    ],
  });

  return {
    common: {
      pnpmLicensePath,
      desktopDepsPath,
      gatewayDepsPath,
      nugetRoot,
      curatedLicenseManifestPath,
      modelRedistributionStatusPath: createModelStatus(root, outputDirectories, modelTermsComplete),
      productVersion: '0.1.0',
      sourceCommit: '0123456789abcdef',
      createdAt: '2026-08-10T00:00:00.000Z',
    },
    curatedLicenseManifestPath,
  };
}

test('binds curated texts to exact components while model terms keep the release gate closed', () => {
  const root = mkdtempSync(join(tmpdir(), 'aethor-legal-test-'));
  try {
    const firstOutput = join(root, 'legal-1');
    const secondOutput = join(root, 'legal-2');
    const thirdOutput = join(root, 'legal-3');
    const { common } = createFixture(root, [firstOutput, secondOutput, thirdOutput]);
    const first = generateThirdPartyInventory({ ...common, outputDirectory: firstOutput });
    const second = generateThirdPartyInventory({ ...common, outputDirectory: secondOutput });
    const third = generateThirdPartyInventory({
      ...common,
      outputDirectory: thirdOutput,
      createdAt: '2026-08-10T00:00:01.000Z',
    });

    assert.equal(first.summary.schemaVersion, 'aethor.third-party-inventory-summary.v2');
    assert.equal(first.summary.componentCount, 5);
    assert.equal(first.summary.npmComponentCount, 2);
    assert.equal(first.summary.dotnetComponentCount, 3);
    assert.equal(first.summary.curatedLicenseSourceCount, 2);
    assert.equal(first.summary.missingLicenseTextCount, 0);
    assert.equal(first.summary.dependencyLicenseTextReady, true);
    assert.equal(first.summary.incompleteModelRedistributionCount, 2);
    assert.equal(first.summary.modelRedistributionReady, false);
    assert.equal(first.summary.releaseReady, false);
    assert.equal(first.summary.curatedLicenseSources.every((item) => item.artifact.startsWith('Legal/ThirdParty/curated-')), true);
    assert.equal(first.summary.modelLegalArtifacts.includes('Legal/MODEL-REDISTRIBUTION-STATUS.json'), true);
    assert.equal(first.document.packages.length, 6);
    assert.equal(first.document.relationships.length, 5);
    assert.equal(first.document.hasExtractedLicensingInfos.length, 1);
    assert.match(first.document.hasExtractedLicensingInfos[0].licenseId, /^LicenseRef-Microsoft.Web.WebView2/);
    assert.match(first.document.packages.find((item) => item.name === 'beta').comment, /repository-curated pinned upstream record/);
    assert.equal(
      readFileSync(join(firstOutput, 'THIRD-PARTY-INVENTORY.spdx.json'), 'utf8'),
      readFileSync(join(secondOutput, 'THIRD-PARTY-INVENTORY.spdx.json'), 'utf8'),
    );
    assert.equal(
      readFileSync(join(firstOutput, 'THIRD-PARTY-SUMMARY.json'), 'utf8'),
      readFileSync(join(secondOutput, 'THIRD-PARTY-SUMMARY.json'), 'utf8'),
    );
    const serialized = readFileSync(join(firstOutput, 'THIRD-PARTY-SUMMARY.json'), 'utf8');
    assert.equal(serialized.includes(root), false, 'host paths must not leak into packaged legal records');
    assert.equal(second.summary.componentFingerprintSha256, first.summary.componentFingerprintSha256);
    assert.equal(third.summary.componentFingerprintSha256, first.summary.componentFingerprintSha256);
    assert.notEqual(third.document.documentNamespace, first.document.documentNamespace);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('opens the legal readiness gate only when dependencies and both model terms are complete', () => {
  const root = mkdtempSync(join(tmpdir(), 'aethor-legal-ready-test-'));
  try {
    const output = join(root, 'legal');
    const { common } = createFixture(root, [output], true);
    const result = generateThirdPartyInventory({ ...common, outputDirectory: output });
    assert.equal(result.summary.dependencyLicenseTextReady, true);
    assert.equal(result.summary.modelRedistributionReady, true);
    assert.equal(result.summary.releaseReady, true);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

for (const scenario of [
  {
    name: 'rejects a curated source whose exact version is not packaged',
    mutate(document) { document.sources[0].version = '2.0.1'; },
    expected: /does not match a packaged component/,
  },
  {
    name: 'rejects duplicate curated component identities',
    mutate(document) { document.sources.push(structuredClone(document.sources[0])); },
    expected: /Duplicate curated license identity/,
  },
  {
    name: 'rejects a changed curated license text hash',
    mutate(document) { document.sources[0].licenseTextSha256 = '0'.repeat(64); },
    expected: /sha256 does not match/,
  },
  {
    name: 'rejects a curated license path that escapes the manifest directory',
    mutate(document, root) {
      const outsideText = 'outside\n';
      writeFileSync(join(root, 'outside.txt'), outsideText, 'utf8');
      document.sources[0].licenseTextPath = '../outside.txt';
      document.sources[0].licenseTextSha256 = sha256(outsideText);
    },
    expected: /missing or escapes/,
  },
]) {
  test(scenario.name, () => {
    const root = mkdtempSync(join(tmpdir(), 'aethor-legal-failure-test-'));
    try {
      const output = join(root, 'legal-output');
      const fixture = createFixture(root, [output]);
      const manifest = JSON.parse(readFileSync(fixture.curatedLicenseManifestPath, 'utf8'));
      scenario.mutate(manifest, root);
      writeJson(fixture.curatedLicenseManifestPath, manifest);
      assert.throws(
        () => generateThirdPartyInventory({ ...fixture.common, outputDirectory: output }),
        scenario.expected,
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
}
