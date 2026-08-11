# Windows package legal inputs

This directory contains repository-owned inputs for the deterministic Windows
legal inventory. It is an engineering record, not legal advice.

- `third-party-license-sources.json` binds an exact ecosystem/name/version to
  its locked package artifact evidence and a license file from an immutable
  upstream Git revision.
- `license-texts/` contains the UTF-8 text whose local SHA-256 is recorded in
  that manifest. The build never downloads or rewrites these files.
- `shared/robot-profiles/model-redistribution-status.json` is a separate gate
  for the two built-in model profiles. Dependency completeness cannot override
  missing model redistribution terms.

The inventory generator fails closed for an uninstalled version, duplicate
identity, changed declaration, stale entry whose package now includes its own
license, invalid hash, non-HTTPS provenance URL, mutable/non-Git revision,
path traversal, symlink escape, missing model profile, or changed model
evidence. Host paths are never emitted into the package.

When a dependency version changes, obtain the new locked package integrity and
license declaration first. Prefer the package source revision. If the exact
historical revision omitted a license file, record the relationship honestly
as `repository-license-after-package-release` or
`repository-license-on-release-branch`, pin the upstream commit and blob, and
retain both the upstream content SHA-256 and local text SHA-256. Do not invent
a release tag, copyright holder, license text, or legal approval.

Run:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File apps/studio-desktop/test-legal-inventory.ps1
```

The package is legally ready only when dependency license text and both model
redistribution gates are complete. Signing does not relax either condition.
