import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { generateThirdPartyInventory } from './third-party-inventory.mjs';

function writeJson(path, value) {
  writeFileSync(path, JSON.stringify(value), 'utf8');
}

function createNpmPackage(root, name, version, legalFiles = {}) {
  mkdirSync(root, { recursive: true });
  writeJson(join(root, 'package.json'), { name, version, license: 'MIT' });
  for (const [fileName, content] of Object.entries(legalFiles)) {
    writeFileSync(join(root, fileName), content, 'utf8');
  }
}

function createNugetPackage(root, name, version, licenseType, licenseValue, legalFiles = {}) {
  const packageRoot = join(root, name.toLowerCase(), version.toLowerCase());
  mkdirSync(packageRoot, { recursive: true });
  writeFileSync(
    join(packageRoot, `${name}.nuspec`),
    `<package><metadata><id>${name}</id><version>${version}</version><license type="${licenseType}">${licenseValue}</license><projectUrl>https://example.test/${name}</projectUrl></metadata></package>`,
    'utf8',
  );
  for (const [fileName, content] of Object.entries(legalFiles)) {
    writeFileSync(join(packageRoot, fileName), content, 'utf8');
  }
}

test('generates a deterministic SPDX inventory and reports exact package-local text gaps', () => {
  const root = mkdtempSync(join(tmpdir(), 'aethor-legal-test-'));
  try {
    const alpha = join(root, 'npm-alpha');
    const beta = join(root, 'npm-beta');
    createNpmPackage(alpha, '@fixture/alpha', '1.0.0', { 'LICENSE-MIT.txt': 'alpha license' });
    createNpmPackage(beta, 'beta', '2.0.0');

    const pnpmPath = join(root, 'pnpm.json');
    writeJson(pnpmPath, {
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

    const common = {
      pnpmLicensePath: pnpmPath,
      desktopDepsPath,
      gatewayDepsPath,
      nugetRoot,
      productVersion: '0.1.0',
      sourceCommit: '0123456789abcdef',
      createdAt: '2026-08-10T00:00:00.000Z',
    };
    const firstOutput = join(root, 'legal-1');
    const secondOutput = join(root, 'legal-2');
    const thirdOutput = join(root, 'legal-3');
    const first = generateThirdPartyInventory({ ...common, outputDirectory: firstOutput });
    const second = generateThirdPartyInventory({ ...common, outputDirectory: secondOutput });
    const third = generateThirdPartyInventory({
      ...common,
      outputDirectory: thirdOutput,
      createdAt: '2026-08-10T00:00:01.000Z',
    });

    assert.equal(first.summary.componentCount, 5);
    assert.equal(first.summary.npmComponentCount, 2);
    assert.equal(first.summary.dotnetComponentCount, 3);
    assert.equal(first.summary.missingLicenseTextCount, 2);
    assert.equal(first.summary.releaseReady, false);
    assert.deepEqual(
      first.summary.missingLicenseTexts.map((item) => `${item.ecosystem}:${item.name}@${item.version}`),
      ['npm:beta@2.0.0', 'nuget:System.IO.Ports@10.0.0'],
    );
    assert.equal(first.document.packages.length, 6);
    assert.equal(first.document.relationships.length, 5);
    assert.equal(first.document.hasExtractedLicensingInfos.length, 1);
    assert.match(first.document.hasExtractedLicensingInfos[0].licenseId, /^LicenseRef-Microsoft.Web.WebView2/);
    assert.equal(
      readFileSync(join(firstOutput, 'THIRD-PARTY-INVENTORY.spdx.json'), 'utf8'),
      readFileSync(join(secondOutput, 'THIRD-PARTY-INVENTORY.spdx.json'), 'utf8'),
    );
    assert.equal(
      readFileSync(join(firstOutput, 'THIRD-PARTY-SUMMARY.json'), 'utf8'),
      readFileSync(join(secondOutput, 'THIRD-PARTY-SUMMARY.json'), 'utf8'),
    );
    const serializedOutput = readFileSync(join(firstOutput, 'THIRD-PARTY-INVENTORY.spdx.json'), 'utf8');
    assert.equal(serializedOutput.includes(root), false, 'host paths must not leak into the package inventory');
    assert.equal(second.summary.componentFingerprintSha256, first.summary.componentFingerprintSha256);
    assert.equal(third.summary.componentFingerprintSha256, first.summary.componentFingerprintSha256);
    assert.notEqual(third.document.documentNamespace, first.document.documentNamespace);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
