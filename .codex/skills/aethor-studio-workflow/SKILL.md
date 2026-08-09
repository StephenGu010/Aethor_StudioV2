---
name: aethor-studio-workflow
description: Use for planning, implementing, verifying, handing off, committing, or pushing any Aethor Studio V2 phase. Enforces the single D-drive workspace, authoritative engineering documents, hardware safety gates, phase acceptance, truthful handoffs, and guarded Git commit/push delivery for completed phases.
---

# Aethor Studio Workflow

Use this workflow for every numbered phase and for governance changes that affect how future phases are executed.

## Establish the workspace

1. Work only in `D:\Aethor_robot\Aethor_StudioV2`.
2. Keep all project-owned source, configuration, documentation, models, tests, and automation inside that root.
3. Treat `D:\Aethor_robot\Aethor_Studio` and external repositories as read-only references. Never copy their product assumptions into V2 without evidence.
4. Run `git status --short --branch` before editing. Preserve unrelated user changes and generated assets.
5. Do not open COM4 or send hardware commands unless the active phase explicitly permits it and the user is supervising.

## Load authoritative context

Read these files before planning:

1. `AGENTS.md`
2. `docs/README.md`
3. `docs/roadmap.md`
4. `docs/prompts/00-common-context.md`
5. The previous phase handoff and current phase prompt
6. Relevant files in `docs/product-boundaries.md`, `docs/architecture.md`, `docs/protocols/`, `shared/contracts/`, and `docs/decisions/`

Resolve conflicts in that order. If a referenced repository or hardware fact cannot be inspected, record the limitation and do not infer its behavior.

## Execute a phase

1. Confirm the phase status, exact deliverables, exclusions, dependencies, safety class, and exit gates.
2. Create a short working plan with one active step. Keep work inside the current phase.
3. Trace each material change through:

   ```text
   requirement/risk -> contract -> owner -> implementation -> verification -> handoff
   ```

4. Define failure, offline, loading, cancellation, stale-data, and cleanup behavior before the happy path when relevant.
5. Keep state and resource ownership explicit. Do not let UI components own serial, HTTP, SignalR, process, or WebGL lifetimes that belong to adapters or services.
6. Run focused checks while working, then every exit-gate command listed for the phase.
7. Never mark planned or simulated behavior as implemented, connected, enabled, accepted, or safe.

## Synchronize documentation

Before committing:

- Update only the authoritative document for each changed public behavior, contract, directory, run command, safety rule, or lifecycle.
- Add a concise entry to `docs/CHANGELOG.md`.
- Update `docs/roadmap.md` only when evidence supports the new status.
- Create or update `docs/handoffs/phase-NN.md` from `docs/handoffs/template.md`.
- Record exact verification commands and results, hardware access, known limitations, recovery conditions, and the next start point.
- Record the starting SHA and intended final commit subject. Do not embed the final commit's own SHA in the same commit; report it after committing.

## Finish with guarded Git delivery

After all exit gates pass:

1. Inspect `git status --short` and `git diff`.
2. Stage only phase-owned files with explicit paths. Never stage dependencies, build output, logs, reports, credentials, local port preferences, or unrelated user changes.
3. Run `git diff --cached --check` and review `git diff --cached --stat` plus the staged diff.
4. Commit locally with `phase(NN): <verified outcome>`.
5. Run `git status --short --branch` and `git log -1 --oneline`.
6. Run `git fetch origin --prune`; verify `origin` is the approved project remote and the upstream is not ahead or diverged. Never rewrite remote history to resolve a mismatch.
7. Push the completed phase commit with a normal `git push` to the corresponding `origin` branch. If the branch has no upstream, create it only for the current completed phase branch with `git push -u origin HEAD`; never force-push, push tags, or create a PR unless separately requested.
8. Verify the local branch and upstream resolve to the same commit, then report the SHA, remote ref, verification evidence, handoff path, and remaining risk.

If gates fail, keep the phase `IN PROGRESS` or `BLOCKED`, update the handoff with evidence, and do not create or push a misleading completion commit. Create or push a checkpoint only when the user explicitly requests that exact checkpoint. If fetch, authentication, branch protection, or remote divergence blocks delivery, preserve the verified local commit, report the exact remote state, and do not retry with force or history rewriting.

## Governing document

Use `docs/engineering-workflow.md` for the complete repository conventions and command examples. Keep this skill procedural and keep changing product facts in their owning documents.
