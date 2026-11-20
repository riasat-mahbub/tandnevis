# Implementation progress

Updated 20 November 2026. This ledger separates approved direction from implemented features. Check a box only after the change exists and its relevant verification is recorded. Commit-sized steps are ordered below; dependent steps can be prepared concurrently, while review and commits remain sequential.

## Approved decisions

- [x] Tauri 2 desktop, React/TypeScript frontend, Rust backend.
- [x] A local SQLite project database is canonical, with Rust-only domain/repository access. The frontend receives typed results and never runs SQL.
- [x] Native projects store stories, chapters, scenes, freeform beats, reusable profiles/presets, revisions, and recoverable Trash.
- [x] Markdown is deliberate import/export interchange. No live two-way Obsidian sync or competing editable Markdown authority.
- [x] Preserve separate Story/Scene views, both alternating timelines, drag handles, visible Duplicate/Delete, local/global scope, and optional stages.

## First build tranche

1. **Document the native architecture** — `docs: adopt SQLite native project architecture`.
   - [x] Reconcile README, product plan, implementation plan, interface plan, and design record with approved storage authority.
   - [x] Record the delivery sequence and later milestones here.
   - [x] Review and commit this documentation step.
2. **Scaffold the application** — `chore: scaffold Tauri React desktop application`.
   - [x] Add React/TypeScript/Vite, Tauri 2/Rust configuration, dependency lockfiles, and a narrow native permission boundary. The typed authoring gateway lands with step 4.
   - [x] Add developer commands and separate the desktop app from historical HTML mockups. Isolated-toolchain convenience wrappers follow in step 5.
   - [x] Scaffold agent verified frontend typecheck/build and zero dependency-audit findings. Native backend compilation/tests follow in step 3.
3. **Implement durable SQLite authoring** — `feat: add transactional SQLite project backend`.
   - [x] Add versioned SQLite schema, async connection/session commands, chapters/scenes/beats, shared character profiles, local reference attributes, revisions, and Trash. Separate reusable preset entities remain later work.
   - [x] Implement typed Rust operations for create/read/edit/duplicate/reorder/archive/trash/restore with reference validation and transaction rollback.
   - [x] Implement explicit plain Markdown file/text import/export, retain exact imported sources, and leave original imports unchanged. Rich metadata interchange remains outside this codec.
   - [x] Verify reopen persistence, fresh duplicate IDs, ordering, scoped references, archive, Trash/restore, persistent undo/redo, stale revisions, foreign/newer database rejection, and injected SQLite failure rollback: 14 Rust tests pass.
   - [x] Review backend and pass Rust formatting plus Clippy with warnings denied before committing this step.
4. **Connect the writing interface** — `feat: connect story and scene authoring workflows`.
   - [x] Connect separate Story/Scene views, independent title/summary/freeform beat edits, matching responsive alternating timelines, and project controls to Rust.
   - [x] Add visible drag handles/Duplicate/Delete, insertion/movement equivalents, useful focus/empty states, and actual persistence feedback.
   - [x] Connect reusable character profile editing/duplication, explicit local reference emotion/delivery, usage/archive behavior, and project Trash/Restore. Separate reusable direction presets remain later work.
   - [x] Add optional scene narration, playful backings, Calm appearance, and dark/reduced-motion treatments. Story narration inheritance and physical stage controls remain later work; the editor requires neither.
   - [x] Pass frontend behavior regressions, typecheck/production build, and native authoring interaction smoke before committing this step. Native pointer/selection defects were corrected in a separate follow-up commit with regression coverage.
5. **Verify and document the tranche** — `test: verify native authoring and document build status`.
   - [x] Run appropriate frontend typecheck/build/behavior checks and Rust format/lint/domain tests.
   - [x] Run native build and available interaction/runtime checks. Record exact commands and outcomes below; renderer checks alone do not prove native persistence or installed-app startup.
   - [x] Document setup, supported interchange, durability/undo limits, and remaining gaps. Update this ledger to match delivered evidence.

## Verification record

- Documentation architecture committed as `90fc58e`; runnable scaffold committed as `7358773`; transactional backend committed as `5c34a4d`.
- Connected writing interface committed as `65dfca6`; native drag-persistence and reference-selection corrections committed as `02f4d55`.
- Scaffold agent: frontend typecheck and production build passed; dependency audit reported zero findings.
- Backend agent: `cargo fmt --manifest-path src-tauri/Cargo.toml -- --check`, `cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings`, and `cargo test --manifest-path src-tauri/Cargo.toml --lib backend::tests` passed with the repository-local Rust toolchain; 14 tests passed.
- Connected frontend production build and `npm run desktop:build -- --debug --no-bundle` pass. The debug executable embeds the renderer and does not require a development server.
- Frontend: `npm test` passes 19 tests covering rapid saves, queued structural edits, failure/retry/conflict recovery, project switching, title/summary editing, navigation, reordering, Trash, local reference scope, rename-safe text history, transient drag targets, and selection-preserving save acknowledgements.
- `npm run test:rust` passes all 14 Rust tests through the new toolchain launcher. `node tools/desktop.mjs check` detects the repository-local Rust toolchain without persistent environment changes.
- `node tools/native-smoke.cjs --exe src-tauri/target/debug/shorthand-writer.exe` passes against the bundled native executable (also exposed as `npm run native:smoke -- --exe ...`). Evidence: `.tools/native-smoke/run-HYlJZd/report.json` and eight screenshots in that directory (local ignored build evidence).
- Native checks exercise real IPC authoring, revision/session rejection, Markdown files, UI summary and keyboard beat edits, Duplicate/Move/Delete/Restore, UI reopen persistence, actual scene and beat pointer drags with changed SQLite order, character insertion/selection, local emotion, and profile rename without extra editor saves.
- Visual confirmation covers Story/Scene in light/dark at 1440px and 800px with no horizontal page overflow. The mixed-theme bug, lost drag commits, and reference-selection resets found during native inspection are fixed and covered by regressions. Exact before/after drop-marker semantics remain later interaction hardening.
- Installer generation, clean-machine installation, and native operating-system dialog interaction remain unverified. The smoke runner replaces only the chooser response; project IPC remains native.
- Vite reports a nonblocking renderer chunk-size warning (about 822 kB before compression); editor loading/performance work remains a later milestone.
- Current backend history retains full before/after snapshots per operation; history compaction/performance hardening, separate reusable presets, and explicit user-owned backup tooling remain later work.

## Later milestones

The requested next tranche is specified in [Portable app and ChatGPT scene generation](install-and-ai-plan.md). This narrows and supersedes the earlier I/A/V multiple-provider/installer sequence. S1–S4 are committed. S5 packaging/runtime code is implemented with final packaged verification below. The real eligible-account sign-in/inference gate remains open. Tranche status:

- [x] S1: global Settings page, Light/Platinum first-run default, Harvest Orange `#FF7700` / Platinum `#E5EBEA` / Iron Grey `#435058` theme, appearance persistence, and disabled Generate with a Settings link.
- [ ] S2 completion: one native ChatGPT connection, account/model verification, protected credentials, refresh/disconnect, and readiness enforced in UI and Rust are implemented. The 47-test Rust suite passes, including JWT signature/claim checks and Responses streaming limits. A real eligible-account browser sign-in and live inference test are still required to verify account eligibility and provider behavior.
- [x] S3: drag/click character references encode profiles and occurrence-local direction into ordered scene-beat context; inspect the exact selected-scene context preview. The native request is assembled from the same SQLite data in S4.
- [x] S4 implementation: generate one scene at a time, with streaming/Stop, durable draft recovery, Accept/Copy/Discard, and undoable scene-prose acceptance. Committed as `16b7444`; deterministic verification is recorded below. Live provider inference remains an S2/S4 release gate.
- [x] S5 implementation and local verification: portable Windows ZIP, explicit writable data location, documented WebView2 prerequisite, Settings runtime details, and safe packaging. Clean-machine launch, upgrade preservation on another machine, and live account generation remain release gates.

Gemini/OpenCode, API-key setup, install/bootstrap/download/updater scripts, batch generation, and advanced comparison/staging are deferred from this tranche. Older milestone requirements below remain the longer-term backlog.

S1 verification: `npm run typecheck`, `npm run build`, and `npm test -- --run src/App.test.tsx` pass. The original S1 commit passed 8 App tests; follow-up `f26208d` migrates existing installs to Platinum light once while retaining later explicit choices, with a regression committed in `6dbc86e`. The current App suite has 12 tests, including the S2 acknowledgement/model-test flow. The Settings page is global, preserves the hidden Story/Scene view and scroll position, persists Light/Platinum by default plus explicit appearance/Calm choices, and keeps Generate disabled with a separate Open Settings action.

S2 implementation: browser OAuth/PKCE and identity validation, Windows Credential Manager tokens, token refresh/disconnect, model discovery/selection, usage confirmation, connection test, and native readiness enforcement are in place. Renderer/native contract typecheck and frontend production build pass. `npm run test:rust` passes 47 tests. S4 now wires native generation; the current complete Rust suite passes 58 tests. No ChatGPT account was available for real sign-in or inference validation, and this app's distribution eligibility has not been established.

S3 verification: `npm test -- --run src/components/BeatEditor.test.tsx src/components/SceneView.test.tsx src/services/generation-context.test.ts` passes 11 tests. Drag/drop inserts stable character references at pointer positions; click insertion remains available. The preview preserves ordered freeform beats, local emotion/delivery directions, and only referenced profiles, excluding other scenes and unrelated project data. It includes archived profiles when a saved reference uses them.

- [ ] Rich inline reference editing, clipboard/IME and range-scope hardening beyond the initial freeform document support; full structural undo/redo wherever not delivered in the first tranche.
- [ ] Inspect the external legacy parser/replay engine, preserve licensing, establish a disposable compatibility corpus, and decide sidecar versus Rust port using parity/build evidence. No legacy compatibility is claimed yet.
- [ ] Entering-state/continuity review and advanced candidate comparison. Selected-scene context, ChatGPT credentials, streaming/cancellation, draft acceptance, and recovery are implemented; live inference remains unverified.
- [ ] Optional stage placement board and advanced library/template workflows without blocking writing.
- [ ] Separate draggable emotion/tone/delivery presets, drag-to-caret character insertion, story narration defaults/inheritance, cross-chapter scene moves, and broader timeline insertion feedback. Character insertion supports drag-to-caret and click; local direction uses the reference inspector.
- [ ] Compiled reading editions/PDF, broader accessibility/performance/crash testing, installed-app clean-machine verification, installer upgrades, production signing, and release hosting. No production signing or publishing is claimed yet.

S4 verification (20 November): `npm run typecheck`, `npm test -- --run` (50 tests), `npm run build`, and `npm run test:rust` (58 tests including portable path tests) pass. Tests cover SQLite v1-to-v2 migration, persistent job checkpoints, interrupted recovery without replay, selected-scene context, account/model binding, stale direction/prose acceptance checks, deliberate stopped-partial acceptance, and undoable prose acceptance. Frontend coverage includes Stop during startup, stale Stop responses, project switching, and draft review controls. No real account or live inference was used. Native builds retain two nonblocking unused-method/function warnings; Vite reports an approximately 859 kB renderer chunk warning.

Theme correction: `dea534a` resets installs carrying the previous default marker to Platinum once. Later explicit choices persist. The shared default surfaces use Platinum `#E5EBEA`, pale panels, Iron Grey text, and Harvest Orange accents.

S5 verification (20 November): `powershell -ExecutionPolicy Bypass -File .\scripts\package-portable.ps1 -OutputDirectory out\portable-final` built the optimized Windows executable and versioned ZIP/checksum. The checksum was verified and the ZIP extracted to a unique folder outside the checkout. `node tools/native-smoke.cjs --exe <extracted executable>` passed; evidence is `.tools/native-smoke/run-JoqRxa/report.json` with eight screenshots. Native checks verified the exact Platinum background, real SQLite authoring/reopen, scene prose persistence, character profile/local direction, scene/beat pointer reordering, disabled Generate before configuration, and Settings data-path/WebView2 details. Both explicit themes fit 1440px and 800px. The actual WebView2 profile was observed under the portable `data/EBWebView` directory. The ZIP contains only the executable, marker, and README. It requires no development server or toolchain at launch on this machine. This was a local Windows runtime check; clean-machine launch, real OS chooser interaction, live ChatGPT inference, signing, and production distribution remain unverified.

The [implementation plan](tauri-implementation-plan.md) supplies architecture and later acceptance gates; the [interface plan](interface-plan.md) remains the full UI contract even where individual controls are pending.
