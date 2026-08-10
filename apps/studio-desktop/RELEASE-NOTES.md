# Aethor Studio V2 0.1.0 — Phase 8A developer package

This portable Windows package validates the offline desktop-shell and packaged
gateway lifecycle. It is not a production installer or a signed release.

- The desktop shell is single-instance and serves the packaged frontend through
  a WebView2 virtual host. Browser window controls remain unavailable.
- `Current profile` switches the complete workspace between the Dummy six-axis
  manipulator and the model-only Aethor_robo spacecraft. Aethor_robo then uses
  its own left/right seven-axis arm selector; no Dummy runtime state is reused.
- The shell creates an ephemeral session token and a random loopback gateway
  port. The token is never written to the package, URL, local storage, or logs.
- Phase 8A launches the gateway with hardware commands disabled and never opens
  a serial port automatically. Offline UI remains available if the gateway is
  missing or fails to start.
- A controlled close is rejected while a connected device is not confirmed
  disabled. Software shutdown cannot replace the physical emergency stop.
- The Microsoft Edge WebView2 Stable Evergreen Runtime is required on the target
  PC. It is probed before the gateway starts; missing or non-stable channels
  show a native prerequisite panel and never trigger an automatic download.
- Gateway failure blocks the WebView and never reconnects automatically. A
  one-way, concurrency-safe policy accepts one explicit offline restart only
  after the failure has been observed and the previous session exits.
- Managed `.aethor-robot` preview is resource-bounded and never installs or
  persists a Profile. A future C# installer must independently revalidate it.
- The 100% DPI window and the explicit offline-restart button after a gateway
  failure have been verified. Code signing, installer/upgrade/uninstall
  rehearsal, 125/150/200% and real multi-monitor visual evidence, and
  supervised COM4 regression remain Phase 8B work.
- Dummy model provenance and its declared-but-incomplete license record are
  included under `Legal/dummy-6dof-NOTICE.md`.
- Aethor_robo source, normalization, capability limitations, incomplete license
  terms and machine-readable asset hashes are included under
  `Legal/aethor-robo-dual-7dof-NOTICE.md` and
  `Legal/aethor-robo-dual-7dof-provenance.json`.
- Neither model notice is a substitute for complete redistribution terms. A
  public release remains blocked until those terms are verified.
- `Legal/THIRD-PARTY-INVENTORY.spdx.json` and
  `Legal/THIRD-PARTY-SUMMARY.json` record 93 production components from the
  installed pnpm graph and the exact published .NET dependency manifests.
  Package-root npm texts and restored NuGet/runtime legal files are bundled
  below `Legal/ThirdParty/`.
- Six components currently lack a package-local license text: SignalR,
  React Three Fiber, react-remove-scroll-bar, tr46, urdf-loader, and
  System.IO.Ports. The development smoke reports this truthfully; the release
  candidate verifier rejects the package until every gap has an authoritative
  text or approved legal disposition.
