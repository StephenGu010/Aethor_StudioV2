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
- The injected desktop gateway is authoritative over developer environment
  settings. Production bundles reject embedded development URLs or tokens.
- A desktop session with the Dummy child gateway starts on the Dummy profile,
  so its single coordinator performs one read-only catalog scan immediately;
  browser showcase sessions keep their own profile restoration behavior.
- Serial-port discovery is shared across the header and device workspace,
  coalesces concurrent scans, and emits correlated bounded diagnostics. It
  enumerates the Windows catalog without opening a port.
- Explicit connect and disconnect actions are also shared across both entry
  points. Duplicate intent is coalesced, conflicting intent fails closed, and
  one operation ID correlates the UI with the gateway terminal log.
- Dummy joint polling uses one serialized gateway owner: joint positions run on
  a fixed 25 ms host cadence, mode and enable queries are staggered, and queued
  commands take priority over new background polls. The terminal hides routine
  GETJPOS traffic by default without stopping feedback or deleting raw frames.
- Engineering joint moves use manual confirmation. A successful serial write
  returns `SENT · MANUAL CONFIRM` immediately; FIFO/final ACK lines are bounded
  observations only, while the single background reader keeps trying GETJPOS.
  No ACK, queue number, or measured arrival is required before the operator may
  submit the next target. Transport-written status never claims device receipt
  or physical arrival.
- Bounded frontend operation probes are captured from the WebView runtime only
  after strict field and terminal-state validation; ordinary console messages,
  expanded fields, and secret-bearing payloads are rejected.
- The 3D framebuffer now uses a canvas-area pixel budget instead of applying a
  fixed high DPR to large or high-DPI windows. A low-frequency, single-flight
  desktop probe records only a normalized workspace label, bounded JS heap,
  DOM/layout counters, visibility, host working set, aggregate WebView2 process
  memory, optional gateway memory, and their tracked total. The label is mapped
  from trusted packaged routes; full URLs, queries, fragments, PIDs, process
  paths/arguments, raw CDP payloads, and page/device content are discarded.
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
- `Legal/MODEL-REDISTRIBUTION-STATUS.json` records that model gate separately;
  dependency completeness and signing cannot override it.
- `Legal/THIRD-PARTY-INVENTORY.spdx.json` and
  `Legal/THIRD-PARTY-SUMMARY.json` record 92 production components from the
  installed pnpm graph and the exact published .NET dependency manifests.
  Package-root npm texts, restored NuGet/runtime legal files, and six
  exact-version/hash-bound upstream texts are bundled below
  `Legal/ThirdParty/`. Dependency text coverage is complete; the release
  candidate remains blocked by the two model redistribution records above.
