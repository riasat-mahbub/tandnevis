# Tauri desktop implementation plan

Status: approved architecture, implementation starting. This document turns the [product/development plan](development-plan.md), [interface requirements](interface-plan.md), and [design record](../DESIGN.md) into buildable work. It supersedes the earlier Electron and Markdown-first architectures. [Implementation progress](implementation-progress.md) records actual delivery and verification; requirements here are not claims of completed features.

## 1. Deliverable and architectural decisions

Build an installed, local-first desktop application with a React/TypeScript frontend and a Tauri 2/Rust backend. “Full stack” means the UI, domain operations, persistence, background work, AI integration, and desktop packaging are implemented together. The first release does not require a hosted application server, account system, or cloud database.

| Area | Implementation direction | Boundary |
|---|---|---|
| Desktop | Tauri 2; Windows first, proposed initial target Windows 11 x64 | macOS/Linux follow separate packaging and verification gates |
| UI | React, TypeScript, Vite; preserve the two-view product design | Production loads bundled frontend assets; Vite is a development tool |
| Desktop backend | Rust command handlers and application services | Own workspace access, writes, credentials, provider requests, jobs, and exports |
| Rich text | Versioned freeform beat documents, with richer inline nodes added incrementally | Plain text and multiple paragraphs must work before adding editor-specific complexity |
| Drag/drop | Proposed current dnd-kit React integration | Separate structural dragging from inline-node placement and native OS file drops |
| Data | Local SQLite project database is canonical | Rust domain/repository code alone reads and writes the database; no frontend SQL plugin |
| Markdown | Explicit import/export interchange | No live two-way filesystem or Obsidian synchronization; imported originals remain untouched |
| Existing engine | Later compatibility adapter, after inspection and parity fixtures | Native authoring does not depend on Python or an unavailable external engine |
| AI | One provider adapter in Rust; provider choice remains open | No provider key or network request is required for ordinary authoring |
| Tests | Rust/domain tests, frontend behavior tests, browser interaction checks, and installed Tauri/WebView tests | A browser-only mockup does not verify native IPC, persistence, or packaging |

Tauri supports frontend calls into Rust commands and streaming through channels. Use those mechanisms as the application boundary. [Calling Rust](https://v2.tauri.app/develop/calling-rust/), [calling the frontend](https://v2.tauri.app/develop/calling-frontend/).

Do not pin guessed dependency versions in this proposal. The scaffold milestone records a compatible Rust toolchain, Node version, package versions, and committed lockfiles. Use npm initially unless the repository establishes another package manager.

## 2. Product requirements carried into implementation

### Story view

- A whole-story vertical timeline, grouped by chapter/part. Scenes alternate left/right around numbered nodes on a central spine, with staggered placement and readable asymmetry.
- Each scene shows its title, summary excerpt, tone, and a compact relevant state. Opening it switches to Scene view; this is a conceptual zoom, not a third pane squeezed beside the editor.
- New chapter/scene, insert before/after, rename, duplicate, move, Delete, Trash, and Restore. Scene/beat Duplicate and Delete are visible quick actions, not menu-only commands.
- Drag scenes by a dedicated handle. Show before/after insertion targets, assist scrolling, allow cancellation, and provide keyboard/button equivalents. Begin with movement within a chapter.

### Scene view

- Editable title, scene idea/summary, scene tone, and a matching vertical beat timeline. Beat cards alternate left/right when the actual editor width permits comfortable text; otherwise use a single-column timeline.
- Every beat is freeform rich text and may contain zero, one, or many character references. Multiple paragraphs and multiple actions need no actor/recipient form.
- Inline character, emotion, delivery, and tone blocks; visible Duplicate/Delete; insertion between beats; collapse/expand; drag and keyboard reordering.
- A reusable library and contextual inspector. Scope controls distinguish the local occurrence from its reusable definition. Optional narration settings inherit story defaults.
- Back to story preserves selection, overview position, and independent scene buffers. Editing a beat does not introduce another zoom level.

### Visual treatment

Retain the warm neutral palette and existing writing hierarchy. Apply skew to backings/tabs rather than the editable text. Scene/beat side follows order; subtle backing angles follow stable identity. Support light/dark, Calm appearance, reduced motion, keyboard navigation, and high text zoom. Decorative placement must not affect hit testing or screen-reader order.

The optional stage can provide a reusable location and a simple scene-local placement board. Writing, generation, and the first complete authoring loop must work without it. Advanced spatial simulation is excluded.

## 3. Application layers and ownership

| Layer | Responsibilities | Must not own |
|---|---|---|
| React views | Display, selection, text editing, drag previews, menus, focus, accessibility | Database connections/SQL, arbitrary file paths, shell execution, canonical disk writes |
| Typed frontend gateway | Invoke Rust commands, decode results, subscribe/unsubscribe to job streams, map domain errors | A second persistence implementation |
| Rust command boundary | Validate payloads, caller/session, schema versions, and operation permissions | Business logic duplicated across individual handlers |
| Rust domain services | Workspace sessions, authoring mutations, library revisions, Trash/Undo, generation lifecycle, review, exports | Presentation state such as hovered cards |
| Rust repository/transaction layer | SQLite connections, migrations, foreign keys, transactions, expected revisions, backups, import/export path confinement | Literary/canon inference |
| Engine adapter | Parse/replay/context derivation with provenance and coverage limits | Unreviewed file changes or model-suggested canon promotion |
| Provider adapters | Authenticated generation, stream parsing, usage, retry classification, cancellation | Workspace authority or automatic manuscript replacement |

Use asynchronous I/O and background execution for blocking or CPU-heavy work. Do not hold the workspace mutation lock while waiting on provider tokens or a long engine calculation. Jobs read immutable, revision-tagged snapshots; later results are checked against current revisions before application.

The frontend receives an opaque project session ID after Rust opens or creates the native database. Later authoring commands address entity IDs under that session, rather than passing SQL or arbitrary absolute paths. Closing/switching projects revokes the session, flushes or preserves pending buffers, and cancels or detaches its jobs deliberately. The command inventory below uses workspace as a project-session term, not a Markdown vault authority.

## 4. Proposed repository structure

```text
src/
  app/                     application shell, Story/Scene navigation
  features/
    workspace/             open/create, recent projects, conflicts/recovery
    story/                 chapter/scene overview and actions
    scene/                 summary, beat timeline, narration, local state
    editor/                rich-text schema, inline nodes, clipboard/codec
    library/               characters, presets, usages, archive
    stage/                 optional location/placement controls
    generation/            request preview, streaming candidates, comparison
    continuity/            provenance, entering state, review
    trash/                 restoration and removal history
  components/              timeline, quick actions, menus, forms, primitives
  services/                typed Tauri gateway, job subscriptions
  state/                   UI state and acknowledged workspace projections
  styles/                  tokens, themes, responsive and Calm appearance
src-tauri/
  src/
    commands/              narrow invoke entry points
    domain/                IDs, operations, revisions, invariants
    workspace/             database sessions, repositories, migrations, transactions
    engine/                adapter contract, worker lifecycle, replay cache
    generation/            request assembly, jobs, provider adapters
    secrets/               native credential-store interface
    recovery/              buffers, revision recovery, undo/redo, Trash
    interchange/           explicit Markdown import/export and source provenance
    export/                later reading-edition assembly and export jobs
  capabilities/            explicit main-window permissions
  permissions/             application-command permission definitions
  binaries/                build-produced engine sidecars, if used
engine/                    adapted Python engine source, not private story data
contracts/                 IPC schema fixtures and generated TypeScript types
tests/fixtures/            synthetic small projects and malformed cases
tests/e2e/                 packaged-app workflows
docs/                      requirements, ADRs, schemas, operations/runbooks
outputs/                   earlier design references, excluded from production assets
```

Keep framework-independent domain logic testable without booting a Tauri window. Share identifiers/contracts between Rust and TypeScript through a generated or mechanically verified schema; choose the generator during the scaffold spike instead of maintaining unchecked parallel interfaces.

## 5. Domain model and invariants

Use stable opaque IDs, separate from display names, filenames, ordinal numbers, and visual side. Proposed entities:

| Entity | Required identity/content | Important invariants |
|---|---|---|
| Project/story | Project/story IDs, database schema version, title, story defaults | One selected local database; no private story copied into the app repository |
| Chapter | ID, story ID, title, explicit order | Database order is authoritative; deletion resolves children |
| Scene | ID, title, summary, ordered beat IDs, local settings | Can exist with no prose, stage, cast, or beats |
| Beat | ID and freeform document | Zero or more characters; ordering does not change identity |
| Character profile revision | Character ID, revision, name, optional profile fields/period | Rename never search-and-replaces authored prose; historical context uses the appropriate revision/period |
| Preset revision | ID, kind, revision, guidance | Local instances remain tied to an explicit source revision |
| Inline instance | Instance ID, entity reference, local attributes/scope | A reference occurrence is distinct from a global definition |
| Stage template/instance | Template ID/revision; optional local conditions and placements | One opening-position token per named character; anonymous extras may repeat |
| Candidate | ID, scene ID, snapshot fingerprint, status, text/usage | Separate from current manuscript; partial and outdated results remain identifiable |
| Review record | Scene ID, exact source/packet revisions and evidence links | Approval applies only to the bytes inspected; no automatic canon promotion |
| Trash record | Original entity IDs, parent/order, saved content and references | Restore retains identities; no permanent purge in the first release |
| Operation record | Operation ID, preconditions, forward/inverse change, revision | Retry is idempotent; a move or duplicate is one logical undo step |
| Content revision | Entity ID, immutable revision content, operation/time metadata | Recovery does not depend on Markdown copies or the current UI undo stack |
| Import provenance | Source path/format/hash and preserved source content | Describes an explicit import; never establishes a live synchronization relationship |

Target emotion/delivery instructions to an explicit character occurrence or character within a named beat/range. Do not use fragile display positions as identities. Editing a range must update its anchors or surface an unresolved scope; it must not silently apply the instruction to another character.

Keep personality, baseline voice, temporary emotion, relationship direction, and established knowledge distinct. Missing knowledge coverage remains unmodelled rather than being treated as ignorance. Planned outcomes never feed established replay.

## 6. Canonical SQLite storage and Markdown interchange

### Source-of-truth policy

Each native project is a local SQLite database. It stores stories, chapters, scene and beat order, scene summaries/settings/prose, freeform beat content, character profiles, emotion/tone/voice presets, local references/scope, revisions, operations, and Trash. Optional stages and later candidates/review records extend the versioned schema. The database is the sole authoring authority; frontend state is an acknowledged projection plus clearly identified unsaved buffers. Derived search/context indexes remain rebuildable.

Rust owns connection lifecycle, schema migrations, parameterized queries, foreign-key enforcement, and domain transactions. Use stable opaque IDs, explicit sibling order, revision preconditions, and valid parent/reference constraints. Record schema versions and refuse unsupported newer databases. Back up before destructive migrations using a consistent SQLite backup procedure. If WAL is used, configure and test it deliberately: copying a live main database file alone is not a backup. Application-local preferences, recent projects, and crash buffers belong in app data. API keys belong in the native credential store, outside the project.

### Explicit Markdown import/export

Import reads a chosen Markdown source or supported bundle into new native entities through Rust. Export writes a chosen scope to a deliberate destination. Neither action creates a watched editable mirror; editing an export in Obsidian changes that file only. Re-import is an explicit reviewed operation, with conflict/duplication behavior documented before merging into existing entities is enabled.

Interchange contract:

1. Define a versioned native beat-document format; plain freeform text is valid. Inline references use stable identities and explicit local scope rather than inferring meaning from typed names.
2. Define readable Markdown export with chapter/scene/beat boundaries, source IDs where supported, reusable-definition metadata, escaping, and documented limits for rich nodes and optional stage data.
3. Validate supported native export/import round-trips with synthetic Unicode, multiple-paragraph, zero/one/many-character, and unknown-section fixtures. Preserve unrecognized source material as provenance; never silently discard it or execute embedded content.
4. Leave original imported files unchanged. Exports never overwrite a source or unrelated destination without an explicit conflict policy. Import errors leave the database transaction unchanged.
5. Treat legacy shorthand manifests/packets as a later separate adapter. The parser/serializer is outside this repository; do not claim compatibility with uninspected packets. Existing framework parity requires inspection, a disposable corpus, and golden outputs.
6. Derive any legacy table-shaped engine input from an immutable database snapshot. No adapter owns a competing editable copy of authoring content.

The format specification must include sample files, version negotiation, unsupported-content handling, downgrade/export limits, and round-trip fixtures. A minimal native Markdown interchange can ship before full legacy compatibility; clearly label the supported format in the UI and documentation.

### Transactions and recovery

All authoring reads and writes go through Rust domain services and its SQLite repository. Serialize conflicting mutations; reads use consistent snapshots. Each mutation validates parent/reference invariants and expected entity/order revisions, then commits content, sibling order, revision/inverse data, and operation receipt in one SQLite transaction. Return success only after commit. Failed validation or SQL errors roll back the whole mutation.

Create/duplicate/move/trash/restore operations are database transactions, not multi-file rename journals. Scene duplication copies direction with fresh scene/beat identities while retaining shared library references; accepted prose and review approval are excluded. Trash persists original identity, content, parent, and order. Restore uses the prior valid location or an explicit fallback destination. Used profiles/presets archive rather than leaving dangling references.

Test reopen after interrupted transactions, database locks, invalid schema versions, disk-full/write failures, and migration interruption. Keep a clear error and recovery path; never replace a corrupt project with an empty one. Native project databases are not intended for simultaneous direct editing by another process. Detect unexpected database replacement and reject stale revisions rather than silently overwriting. Markdown file watching and live external-edit reconciliation are outside scope.

Autosave uses revision-aware debounced operations, plus crash-buffer checkpoints. Structural operations flush the relevant dirty editor state before moving/deleting it. Close/workspace-switch waits for acknowledged saves or keeps recoverable buffers and an explicit failed-save state. “Saved” is shown only after backend acknowledgement.

Text editing uses the editor's transaction history; structural undo/redo uses validated domain operations. Define routing so text shortcuts are not intercepted while typing. An inverse validates current revisions rather than blindly overwriting newer edits. Persisted revisions and Trash remain available independently of the current session's undo stack. Report any initially unsupported undo commands honestly; never label an action undoable without a working inverse.

## 7. Rust commands, events, and jobs

Use a versioned request envelope with `requestId`, `workspaceSessionId`, and an expected revision where applicable. Mutations also carry an `operationId` so a timed-out UI retry cannot duplicate a scene or candidate. Return a typed result containing the acknowledged revision and changed entity IDs, or a structured domain error.

Use distinct order/content revisions where appropriate. For example, a proposed `MoveBeat` payload contains `sceneId`, `beatId`, `beforeBeatId` (null for the end), and `expectedOrderRevision`; a `SaveBeat` carries the document/codec version and `expectedContentRevision`. A `DeleteScene` always addresses a stable scene ID and recoverable Trash mode. Persist operation receipts with a payload fingerprint; reusing an operation ID with a different payload is an error.

Initial command inventory (names are proposed contracts):

| Group | Commands | Notes |
|---|---|---|
| Workspace | `open_workspace`, `create_workspace`, `close_workspace`, `read_workspace_summary` | Open/create SQLite projects through native selection and validated backend sessions |
| Read | `read_scene`, `read_library_entry`, `find_usages`, `search_story` | Return normalized content, revisions, diagnostics, and coverage |
| Authoring | `apply_story_operation` | Typed operation union for chapter/scene/beat create/edit/duplicate/move/delete/restore |
| Library | `apply_library_operation` | Create/revise/rename/duplicate/archive/remove with usage-aware preconditions |
| Local stage | `apply_stage_operation` | Optional placement; does not mutate the global template implicitly |
| History/recovery | `undo_operation`, `redo_operation`, `list_trash`, `inspect_recovery`, `resolve_conflict` | Reference checks and expected revisions apply here too |
| Generation | `preview_generation_context`, `start_generation`, `cancel_job`, `read_candidate`, `accept_candidate` | Request snapshots are immutable; acceptance is a recoverable mutation |
| Review | `read_character_state`, `preview_review_changes`, `complete_packet_review` | Bind evidence review to exact source/packet revisions |
| Settings | `read_settings`, `update_settings`, `set_provider_secret`, `remove_provider_secret` | Return secret-present status, never a stored key |
| Interchange | `import_markdown`, `export_markdown` | Explicit source/destination/scope; no live two-way sync; report supported format limits |
| Later edition export | `start_export`, `read_job_status` | Explicit destination and output scope; no implicit edition rebuild on save |

Do not expose generic write-file, arbitrary process-launch, SQL-execution, or fetch-any-URL commands to the frontend.

Use Tauri channels for token/progress streams; reserve low-volume events for workspace invalidation and job-state notifications. Every streamed envelope includes workspace session, job/candidate ID, sequence number, snapshot fingerprint, and a typed payload such as started/text/usage/completed/cancelled/failed. Unsubscribe on view teardown, but store the candidate in the backend so navigation does not lose it. Channels are Tauri's documented streaming mechanism. [Commands and channels](https://v2.tauri.app/develop/calling-rust/).

Maintain a bounded job registry with cancellation tokens. Begin with one active generation per workspace; authoring stays responsive. Distinguish cancellation requested from cancellation completed, and keep partial output. A worker/provider failure cannot kill the editor or mark a partial result as complete.

Errors include validation, stale revision, missing/archived reference, unsupported format, conflict, permission denied, disk full, worker unavailable, provider authentication/rate limit/network failure, and cancellation. Send actionable messages and field/entity context to the UI without leaking credentials or manuscript text into logs.

## 8. Frontend implementation details

### Navigation and state

Use Story and Scene as the two authoring routes. Keep app settings, library details, Trash, and recovery as contextual panels/dialogs rather than additional writing zoom levels. Maintain selected scene/beat IDs, scroll positions, collapsed panels, and local editor buffers separately from backend-acknowledged domain state.

Use one typed gateway for all native calls. A lightweight UI store can hold view state; avoid placing unacknowledged editor content and canonical backend content into indistinguishable global objects. Reject late responses from a closed workspace or superseded entity revision. Apply optimistic structural changes only with a clear pending state and rollback/conflict path.

### Editor and inline blocks

Begin with a durable freeform text editor; add custom inline nodes for character references and scoped instructions after their versioned database representation is verified. Keep each beat's editor document independent of its ordinal position. Preserve IME composition, multiple paragraphs, selection/caret behavior, plain-text paste, and native text undo. If Tiptap is adopted, its custom node views are distinct from serialized output; database documents and interchange codecs remain our responsibility. [Node views](https://tiptap.dev/docs/editor/extensions/custom-extensions/node-views).

Mount editors for actively edited/visible beats and render inactive content cheaply. Save before unloading an editor and restore selection by stable anchors. Do not add aggressive list virtualization until measured content sizes justify it; naïve virtualization can break focus and drag targets.

### Shared timeline component

Build a common timeline primitive parameterized by ordered IDs, card rendering, quick actions, drop slots, and selection. Use it for scenes and beats so numbered nodes, connectors, left/right alternation, focus, and responsive rules stay consistent.

Calculate structural insertion by logical before/after slots, not nearest horizontal center. Two staggered columns are one ordered sequence. Use a drag overlay so the active editor DOM is not repeatedly reparented. Commit a domain move only on drop; cancellation preserves order. Inline-node drags and OS file drops have distinct payloads and destinations.

Proposed drag library is the current `@dnd-kit/react` family; prove pointer, touch, keyboard, scroll, and alternate-column collision handling in the spike. Do not mix examples from its legacy API into the selected integration. [React quickstart](https://dndkit.com/react/quickstart/).

Each card exposes a drag handle, Duplicate, and Delete directly. More contains less frequent commands. Controls have object-specific accessible names and sufficient hit areas. Ordinary recoverable deletion does not require a generic confirmation; evidence-linked deletion uses the existing explicit resolution flow.

## 9. Existing Python engine integration

This is a later compatibility milestone, independent of the first native authoring tranche. No current scaffold or SQLite work claims legacy replay parity.

The current repository contains no Python engine source. Identify the external framework version and license/attribution requirements before adapting it. Use synthetic fixtures and a disposable vault copy; never bundle the private manuscript as an application resource.

Preferred transition: retain verified parsing/replay algorithms behind an `EngineAdapter`, and package a worker executable only if the spike demonstrates clean boundaries and reproducible builds. Tauri supports bundled sidecar executables, including packaged Python programs, with target-specific naming. [Embedding external binaries](https://v2.tauri.app/develop/sidecar/).

Worker protocol: versioned newline-delimited messages, request ID, operation, bounded payload, progress, result/error, and cancellation. Reserve stdout for protocol data and stderr for redacted diagnostics. Add startup handshake, heartbeat/timeout, output limits, controlled restart, and shutdown on workspace/application close.

Rust reads authorized database/import snapshots and supplies content/configuration to the adapter. The worker returns parsed/replayed results or proposed domain changes; Rust validates and applies database mutations. The worker never opens the project database directly. Never execute a script found inside an opened project. The adapter cannot receive provider keys or initiate arbitrary network access.

Build the worker with its interpreter if used; end users install neither Python nor Node. Test packaged resource lookup, missing/failed worker recovery, and version compatibility. A later Rust engine replacement must pass the same corpus and golden outputs before switching. If clean sidecar reuse fails, record the measured blocker and estimate a Rust port before committing the schedule; do not hide the extra work.

## 10. AI generation and context

Advanced AI and the integrated provider loop are later milestones; ordinary native authoring must work first. Candidate/review controls remain requirements until implemented and verified.

Define a provider trait for credential validation, supported model/settings, request construction, streaming, usage, cancellation, and classified errors. Select one provider for the first integrated release. Avoid a generic “compatible API” claim until an adapter is tested.

Before starting, flush the selected scene's dirty authoring state and create an immutable request snapshot containing summary, beat order/text, local scope, stage if present, narration, intended outcomes, style guidance, and relevant entering state. Include provenance, unmodelled coverage, source hashes, provider/model/settings, and prompt-template version.

Do not include author-only comments, future-period profiles, withheld revelations, or another character's private knowledge as available viewpoint knowledge. Make truncation explicit and preserve hard knowledge/revelation constraints. Preview the assembled context and what will leave the machine.

Rust retrieves the stored key and owns the HTTP request. Stream into a separate candidate and checkpoint partial output; UI streams are a view of that durable job. Mark a result outdated when its direction, context, or scene order has changed. Keep provider retry distinct from an idempotent local command retry so a lost response cannot cause invisible duplicate billable requests.

Candidate actions: label, inspect, compare, edit, revise, recoverable remove, and deliberate acceptance. Acceptance validates current source revision, stores the prior manuscript revision, updates the current prose transactionally, and marks evidence review pending. It never accepts suggested character diffs, refreshes reviewed fingerprints, clears continuity concerns, or establishes canon automatically.

## 11. Native boundaries and credentials

Keep production content local and bundle scripts/fonts/assets. Configure a restrictive CSP and sanitize imported/generated Markdown; do not execute embedded HTML or load remote manuscript scripts. Tauri is not an Electron environment: no Node integration or preload bridge is part of this design.

Use an explicit main-window capability set and application-command permissions. Tauri's docs note that registered application commands are available by default unless restricted with `AppManifest::commands`; configure and test that restriction rather than assuming plugin permissions secure every custom command. Capability overlap is additive, so review the effective combined scope. [Capabilities](https://v2.tauri.app/security/capabilities/).

The webview has no broad filesystem/shell access. Validate canonical workspace paths, ancestry, Windows case/path behavior, symlinks/junctions, and export destinations in Rust. Asset access must also be scoped. Limit sidecar execution to the bundled binary and fixed protocol; no arbitrary executable names or free-form shell strings.

Implement a Rust `SecretStore` with an OS-backed Windows credential backend; evaluate the keyring ecosystem's Windows native store in the spike. Keep the store behind an interface for later platforms. The frontend may submit a newly typed key once, then clears its input; retrieving a stored key is backend-only. Never fall back to plaintext project files, browser storage, or debug logs if the native store is unavailable. Ordinary authoring still works. [Windows native keyring store](https://docs.rs/windows-native-keyring-store/latest/windows_native_keyring_store/).

Logs use operation/job IDs, timings, and error codes. Manuscript text, request bodies, credentials, and personal paths are excluded by default. Exporting diagnostics is an explicit local action with a reviewable payload.

## 12. Desktop build and release

1. Establish Windows Rust/MSVC, C++ build tools, Node tooling, and WebView2 prerequisites. Record tested versions in developer setup. [Tauri prerequisites](https://v2.tauri.app/start/prerequisites/).
2. Verify frontend and native debug/release builds during the first tranche. Installer production and clean-machine verification are separate gates; do not describe a successful renderer build as an installed-app test.
3. Proposed initial installer is NSIS through the Tauri bundler; add MSI only when needed. Specify install scope, WebView2 installation/offline policy, minimum supported OS/runtime, app-data location, and uninstall behavior. [Windows installer](https://v2.tauri.app/distribute/windows-installer/).
4. Verify install/upgrade/reinstall preserve user workspaces and app recovery data appropriately. Uninstall must not delete user-selected story folders. Test startup without developer runtimes and authoring with the network disconnected.
5. Keep application format migrations separate from installer updates. Back up before a migration and refuse writes to unsupported newer project formats.
6. Begin with deliberate manual installation of releases. Add automatic updates only after release hosting and signing-key ownership are decided. Tauri updater signatures and Windows installer code signing are separate concerns; an updater build must verify signed artifacts, and its signing cannot be disabled. [Updater](https://v2.tauri.app/plugin/updater/).
7. Build macOS/Linux separately later, including native credentials, file watchers, paths, fonts, installer/update behavior, and engine sidecars for each target. Do not describe a Windows-tested build as cross-platform verified.

No deployment, publishing account, signing key, installer certificate, or release host is assumed to exist in this repository.

## 13. Implementation milestones and tickets

These are dependency gates, not calendar promises. Check [implementation progress](implementation-progress.md) for completed commits and actual evidence. The first tranche is M0–M3; later requirements stay pending until delivered.

| Milestone | Concrete work | Exit evidence |
|---|---|---|
| M0: Application scaffold | React/TypeScript/Vite + Tauri 2/Rust; locked dependencies; typed gateway; restricted native command boundary; developer commands | Frontend typecheck/build and native compile launch a minimal application, with any environmental blockers recorded |
| M1: Durable SQLite authoring | Versioned schema/migrations; project open/create; stories/chapters/scenes/beats; profile/preset revisions; transactional ordering; revisions; Trash/restore; explicit Markdown interchange | Rust tests create/edit/duplicate/move/delete/restore and reopen a synthetic project; rollback/reference checks and supported Markdown round-trips pass |
| M2: Connected Story/Scene UI | Separate views and matching alternating timelines; title/summary/freeform beats; visible Duplicate/Delete; drag handles and keyboard movement; library/local scope; Trash; responsive/Calm styling | UI invokes Rust domain commands, reloads persisted content, preserves independent edits/identity, and completes library/recovery flows without browser-storage authority |
| M3: Verification and build | Frontend behavior/interaction checks, Rust format/lint/domain tests, command-contract checks, frontend/native builds; document remaining gaps | Record exact commands/results; clearly distinguish browser checks, native compilation, and actual Tauri runtime/installer verification |
| M4: Rich interchange and legacy compatibility | Inspect external framework; richer inline nodes/codecs; compatibility corpus; unknown-source retention; engine adapter/packaging decision | Supported nodes round-trip; legacy replay/parsing parity proven before claiming compatibility or enabling adapter writes |
| M5: Context and AI loop | Entering-state snapshots; context preview; one provider; native key storage; streaming/cancel/recovery; candidate comparison/editing/acceptance | Generate/revise/accept with recoverable prior prose; cancelled/outdated jobs remain correctly labeled; no automatic evidence or canon promotion |
| M6: Review and edition export | Exact-revision evidence review; intended vs established changes; stale context; history; compiled Markdown edition/PDF pipeline decision | Review binds to actual inspected revisions; compatible CLI outputs pass; exports target a chosen scope/destination and preserve artwork |
| M7: Optional stage increment | Saved location references; scene-local conditions; simple placement tokens; local extras/props; no simulation | Stage remains removable/optional and does not alter global profiles or block the complete authoring loop |
| M8: Release hardening | Installed-app E2E; keyboard/screen-reader pass; database/crash corpus; performance; installer upgrades; production signing/release policy | Full workflow passes on clean Windows without developer runtimes; native projects and deliberate exports remain recoverable |

M0–M3 deliver the first native authoring tranche. M4–M6 and M8 extend it toward the authoring/generation release; M7 remains optional. More elaborate project wizards, collaboration/sync, multiple providers, autonomous chapter generation, permanent purge, and advanced stage simulation remain later work. Production signing/publishing is not implied by local build verification.

The first vertical implementation slice should be small: open a synthetic workspace, show its scene overview, open a scene, edit its summary and one beat, save in Rust, close, and reopen from disk. Add drag/drop and library features after that disk-backed slice works.

## 14. Verification and performance gates

| Scope | Required checks |
|---|---|
| Domain | Stable IDs; duplicate semantics; archive/usages; scoped instructions; exact review revisions; invalid operations rejected |
| Persistence | SQLite migrations/foreign keys; expected revisions; atomic rollback; reopen durability; lock/write failures; consistent backups; Trash restoration; supported explicit Markdown round-trips |
| Editor | Text/IME/clipboard; atomic references; multiple paragraphs; local scope anchors; native text undo; save before structural operations |
| Timelines | Left/right numbering; no same-side overlap; before/after drop slots; edge scrolling; Escape cancellation; pointer/touch/keyboard; quick actions never initiate dragging |
| Jobs | Token ordering; channel disconnect; cancellation races; partial checkpoints; model errors; stale input; duplicate command retries; detached scene navigation |
| Context | No future-state leakage; unmodelled knowledge labeled; private thoughts and narration limits; author-only text excluded; truncation visible |
| Native | Denied unapproved commands/paths; malicious/unsupported Markdown; worker exit/restart; credentials unavailable; close/reopen; native save/open dialogs |
| Installed app | Clean install; no developer runtimes; offline authoring; Unicode/space-containing roots; upgrade/recovery; uninstall leaves story folders alone |

Use frontend tests for behavior and browser tests for renderer interactions, but also run real Tauri/WebView end-to-end tests. Evaluate WebdriverIO's Tauri service in M0; current Tauri documentation covers embedded and native-driver options. Any test-only driver/backend-access plugins must be absent from production builds. [Tauri WebDriver guidance](https://v2.tauri.app/develop/tests/webdriver/).

Proposed measurable budgets, to validate on a recorded reference machine rather than present as achieved claims:

- Local typing and drag feedback remain responsive within a frame where practical; backend autosave never blocks input.
- Switching to an already indexed scene should target under 200 ms; show cancellable progress for slower cold parsing/replay.
- Synthetic stress fixtures include 500 scenes, a scene with 100 beats, long multiple-paragraph beats, and repeated references. Establish memory/startup baselines in M0/M3 and measure before adding virtualization or extra indexes.
- Inspect both views in light/dark/Calm, reduced motion, 200% text zoom, and narrow editor widths. The two-column treatment must fall back before text or menus clip.

Proposed CI gates after scaffold: frontend typecheck/lint/behavior tests/build; Rust format/clippy/tests; contract generation drift; codec and engine parity fixtures; Windows debug and release packaging; selected installed-app E2E. Keep secrets and private vault data out of CI fixtures. Run real-provider literary evaluation separately from deterministic mocked-provider tests.

## 15. Decisions to close and implementation handoff

| Decision | Proposed position | Deadline |
|---|---|---|
| Initial desktop support | Windows first; Windows 11 x64 proposed baseline | M0 native build; M8 clean-machine packaging |
| UI/editor/drag versions | React/TypeScript/Vite; freeform text first; richer editor/drag dependencies follow interaction evidence | M0–M2; rich nodes in M4 |
| Canonical storage (decided) | Local SQLite project database; Rust-only domain/repository access | M1 schema and durability tests |
| Markdown authority (decided) | Explicit import/export only; no live two-way Obsidian sync | M1 supported interchange specification |
| Python sidecar vs Rust engine | Decide after external source inspection, parity, and packaging evidence | Later M4 compatibility gate |
| Exact beat document format | Versioned database document; freeform text first, scoped inline nodes incrementally | M1/M4 schema/codec evidence |
| Native credentials | OS-backed Windows store, no plaintext fallback | Before M5 |
| Provider and authentication | One tested direct API adapter; no subscription/API assumption | Before M5 |
| Passage-level prose revision | Whole-scene loop first; selected-passage revision follows context-safe editing | M5 scope review |
| PDF export backend | Reuse a verified existing pipeline if possible; otherwise specify a packaged exporter | M6; do not claim PDF until implemented |
| Optional physical placement | Separate increment with no core-loop dependency | M7 |
| Signing/update hosting | Manual installer first; keys/accounts/hosting are not yet configured | Before public distribution |

Proceed in the commit-sized order recorded in [implementation progress](implementation-progress.md). Storage authority and the Rust-only command boundary are decided here; refine their schema/contracts alongside implementation and tests. Legacy engine packaging is a later decision and does not block native authoring. Keep requirements, completed work, and measured verification separate; never modify the story vault or the accepted mockups as a side effect of implementation.
