# Implementation progress

Updated 19 November 2026. This ledger separates approved direction from implemented features. Check a box only after the change exists and its relevant verification is recorded. Commit-sized steps are ordered below; dependent steps can be prepared concurrently, while review and commits remain sequential.

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
   - [x] Pass 16 frontend behavior regressions, typecheck/production build, and native authoring interaction smoke before committing this step. Final theme confirmation belongs to step 5.
5. **Verify and document the tranche** — `test: verify native authoring and document build status`.
   - [ ] Run appropriate frontend typecheck/build/behavior checks and Rust format/lint/domain tests.
   - [ ] Run native build and available interaction/runtime checks. Record exact commands and outcomes below; renderer checks alone do not prove native persistence or installed-app startup.
   - [ ] Document setup, supported interchange, durability/undo limits, and remaining gaps. Update this ledger to match delivered evidence.

## Verification record

- Documentation architecture committed as `90fc58e`; runnable scaffold committed as `7358773`; transactional backend committed as `5c34a4d`.
- Scaffold agent: frontend typecheck and production build passed; dependency audit reported zero findings.
- Backend agent: `cargo fmt --manifest-path src-tauri/Cargo.toml -- --check`, `cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings`, and `cargo test --manifest-path src-tauri/Cargo.toml --lib backend::tests` passed with the repository-local Rust toolchain; 14 tests passed.
- Connected frontend production build and `npm run desktop:build -- --debug --no-bundle` pass. The debug executable embeds the renderer and does not require a development server.
- Frontend: `npm test` passes 16 tests covering rapid saves, queued structural edits, failure/retry/conflict recovery, project switching, title/summary editing, navigation, reordering, Trash, local reference scope, and rename-safe text history.
- Native behavioral smoke passes real IPC authoring, revision/session rejection, Markdown files, UI summary and keyboard beat edits, Duplicate/Move/Delete/Restore, and UI reopen persistence. Visual review found and fixed mixed light/dark root colors; final theme confirmation remains in step 5.
- Installer generation, clean-machine installation, native operating-system dialog interaction, and pointer drag verification remain unverified.
- Current backend history retains full before/after snapshots per operation; history compaction/performance hardening, separate reusable presets, and explicit user-owned backup tooling remain later work.

## Later milestones

- [ ] Rich inline reference editing, clipboard/IME and range-scope hardening beyond the initial freeform document support; full structural undo/redo wherever not delivered in the first tranche.
- [ ] Inspect the external legacy parser/replay engine, preserve licensing, establish a disposable compatibility corpus, and decide sidecar versus Rust port using parity/build evidence. No legacy compatibility is claimed yet.
- [ ] Context assembly, entering-state/continuity evidence review, integrated AI provider/credentials, streaming/cancellation, candidate comparison/revision/acceptance, and recovery. No real generation is claimed yet.
- [ ] Optional stage placement board and advanced library/template workflows without blocking writing.
- [ ] Separate draggable emotion/tone/delivery presets, drag-to-caret character insertion, story narration defaults/inheritance, cross-chapter scene moves, and broader timeline insertion feedback. Initial character insertion uses a click at the selected beat caret; local direction uses the reference inspector.
- [ ] Compiled reading editions/PDF, broader accessibility/performance/crash testing, installed-app clean-machine verification, installer upgrades, production signing, and release hosting. No production signing or publishing is claimed yet.

The [implementation plan](tauri-implementation-plan.md) supplies architecture and later acceptance gates; the [interface plan](interface-plan.md) remains the full UI contract even where individual controls are pending.
