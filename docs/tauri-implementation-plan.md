# Tauri desktop implementation plan

Status: implementation proposal. No application scaffold is present yet. This document turns the [product/development plan](development-plan.md), [interface requirements](interface-plan.md), and [design record](../DESIGN.md) into buildable work. It supersedes the earlier Electron architecture.

## 1. Deliverable and architectural decisions

Build an installed, local-first desktop application with a React/TypeScript frontend and a Tauri 2/Rust backend. “Full stack” means the UI, domain operations, persistence, background work, AI integration, and desktop packaging are implemented together. The first release does not require a hosted application server, account system, or cloud database.

| Area | Implementation direction | Boundary |
|---|---|---|
| Desktop | Tauri 2; Windows first, proposed initial target Windows 11 x64 | macOS/Linux follow separate packaging and verification gates |
| UI | React, TypeScript, Vite; preserve the two-view product design | Production loads bundled frontend assets; Vite is a development tool |
| Desktop backend | Rust command handlers and application services | Own workspace access, writes, credentials, provider requests, jobs, and exports |
| Rich text | Proposed Tiptap editor with custom inline nodes | Validate the Markdown codec and clipboard behavior before committing to its schema |
| Drag/drop | Proposed current dnd-kit React integration | Separate structural dragging from inline-node placement and native OS file drops |
| Data | Markdown/manifests plus documented portable authoring metadata | No second editable story database |
| Indexes | Disposable local cache; add SQLite search/index storage only when measured need justifies it | Never store the only copy of prose, beat text, or character definitions in the cache |
| Existing engine | Compatibility adapter, initially a packaged Python sidecar if the engine spike validates reuse | Rust remains the only workspace writer; no system Python requirement |
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
| React views | Display, selection, text editing, drag previews, menus, focus, accessibility | Arbitrary file paths, shell execution, canonical disk writes |
| Typed frontend gateway | Invoke Rust commands, decode results, subscribe/unsubscribe to job streams, map domain errors | A second persistence implementation |
| Rust command boundary | Validate payloads, caller/session, schema versions, and operation permissions | Business logic duplicated across individual handlers |
| Rust domain services | Workspace sessions, authoring mutations, library revisions, Trash/Undo, generation lifecycle, review, exports | Presentation state such as hovered cards |
| Rust repository/transaction layer | Path confinement, reads, lossless patches, expected revisions, journal/recovery, file watching | Literary/canon inference |
| Engine adapter | Parse/replay/context derivation with provenance and coverage limits | Unreviewed file changes or model-suggested canon promotion |
| Provider adapters | Authenticated generation, stream parsing, usage, retry classification, cancellation | Workspace authority or automatic manuscript replacement |

Use asynchronous I/O and background execution for blocking or CPU-heavy work. Do not hold the workspace mutation lock while waiting on provider tokens or a long engine calculation. Jobs read immutable, revision-tagged snapshots; later results are checked against current revisions before application.

The frontend receives an opaque workspace session ID after opening a directory. Later authoring commands address entity IDs under that session, rather than passing arbitrary absolute paths. Closing/switching workspaces revokes the session, flushes or preserves pending buffers, and cancels or detaches its jobs deliberately.

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
    workspace/             sessions, repositories, transactions, watchers
    engine/                adapter contract, worker lifecycle, replay cache
    generation/            request assembly, jobs, provider adapters
    secrets/               native credential-store interface
    recovery/              buffers, journal replay, undo/redo, Trash
    export/                reading-edition assembly and export jobs
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
| Project | Project ID, format version, source layout, story defaults | One selected workspace; no private story copied into the app repository |
| Chapter | ID, title, ordered scene IDs | Manifest order is authoritative; deletion resolves children |
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

Target emotion/delivery instructions to an explicit character occurrence or character within a named beat/range. Do not use fragile display positions as identities. Editing a range must update its anchors or surface an unresolved scope; it must not silently apply the instruction to another character.

Keep personality, baseline voice, temporary emotion, relationship direction, and established knowledge distinct. Missing knowledge coverage remains unmodelled rather than being treated as ignorance. Planned outcomes never feed established replay.

## 6. Storage and format work

### Source-of-truth policy

Preserve Markdown and existing manifests as the editable story source. The editor works on a normalized document in memory; that projection is not a second authoritative database. Library entries are readable versioned project files. Derived context, usage indexes, and search caches are rebuildable.

Use a reserved project-owned metadata directory, proposed `.shorthand-writer/`, for format/configuration, operation journals, revision backups, and portable Trash. Specify every path and schema before writing it. Application-local preferences, recent roots, machine-specific state, and crash buffers belong in the app-data directory. API keys never belong in either story content or portable metadata.

### Mixed-text codec decision gate

The existing parser/serializer source is outside this repository. Do not claim compatibility or invent a migration against uninspected packets. Milestone 1 must settle the exact representation with synthetic fixtures and a disposable compatibility corpus.

Proposed approach:

1. Parse imported semantic fields and beat content into a normalized AST while retaining unknown source regions and byte-level patch boundaries.
2. Store new freeform beats in a versioned Markdown authoring section with stable beat markers. Use readable, explicitly parsed reference links/markers for inline atoms and a small metadata region for IDs/scope/provenance. Beat text has one editable source; physical section order determines beat order.
3. Keep the editor-specific document JSON in memory/recovery buffers, not as a competing canonical copy of the same Markdown text.
4. Derive any legacy table-shaped engine input in memory. Do not write a second independently editable beat table beside the new freeform representation.
5. Unchanged legacy packets remain byte-identical. If an edit exceeds their representational capacity, offer a scene-specific migration preview and recoverable backup; do not rewrite an entire imported project on open.
6. Preserve imported unknown sections, Unicode, line endings, comments, and links. Define literal escaping and pasted-text behavior; a typed literal resembling an inline token is not automatically a global object.
7. Either extend the compatible parser/CLI to read the new section, or provide an explicit legacy export to a separate destination. Verify which operations can round-trip before enabling writes on those imported scenes.

The format ADR must include sample files, authority for each field, version negotiation, unsupported-node handling, upgrades, downgrade/export limits, and golden round-trip fixtures. This gate blocks writable import until it passes.

### Transactions and recovery

All authoring writes go through Rust's single workspace writer. Serialize conflicting mutations; reads use revisioned snapshots. Each mutation checks its workspace/entity revision and relevant file fingerprints, then prepares bounded patches and inverse data.

For multi-file operations: validate paths and content, prepare temporary replacements/backups, persist a journal intent, apply replacements with platform-appropriate durability/replacement handling, mark completion, then acknowledge the new revision. A journal provides recoverability; do not claim that renaming several files is globally atomic.

On restart, inspect incomplete transactions and current hashes before completing or rolling back. If another editor changed a target, preserve both versions and enter conflict recovery instead of replaying blindly. Use file-watch notifications as invalidation hints, verify hashes, and avoid mistaking an application's own transaction for an unrelated change. Account for Windows sharing violations, case-only renames, antivirus delays, disk-full errors, and linked/junction paths.

Autosave uses revision-aware debounced operations, plus crash-buffer checkpoints. Structural operations flush the relevant dirty editor state before moving/deleting it. Close/workspace-switch waits for acknowledged saves or keeps recoverable buffers and an explicit failed-save state. “Saved” is shown only after backend acknowledgement.

Text editing uses the editor's transaction history; structural undo/redo uses domain operations. Define routing so text shortcuts are not intercepted while typing. An inverse operation must validate current state; external changes can require conflict resolution rather than a destructive rollback. Trash restoration and process-crash recovery remain available independently of the current session's undo stack.

## 7. Rust commands, events, and jobs

Use a versioned request envelope with `requestId`, `workspaceSessionId`, and an expected revision where applicable. Mutations also carry an `operationId` so a timed-out UI retry cannot duplicate a scene or candidate. Return a typed result containing the acknowledged revision and changed entity IDs, or a structured domain error.

Use distinct order/content revisions where appropriate. For example, a proposed `MoveBeat` payload contains `sceneId`, `beatId`, `beforeBeatId` (null for the end), and `expectedOrderRevision`; a `SaveBeat` carries the document/codec version and `expectedContentRevision`. A `DeleteScene` always addresses a stable scene ID and recoverable Trash mode. Persist operation receipts with a payload fingerprint; reusing an operation ID with a different payload is an error.

Initial command inventory (names are proposed contracts):

| Group | Commands | Notes |
|---|---|---|
| Workspace | `open_workspace`, `create_workspace`, `close_workspace`, `read_workspace_summary` | Select/register roots through native dialogs and validated backend sessions |
| Read | `read_scene`, `read_library_entry`, `find_usages`, `search_story` | Return normalized content, revisions, diagnostics, and coverage |
| Authoring | `apply_story_operation` | Typed operation union for chapter/scene/beat create/edit/duplicate/move/delete/restore |
| Library | `apply_library_operation` | Create/revise/rename/duplicate/archive/remove with usage-aware preconditions |
| Local stage | `apply_stage_operation` | Optional placement; does not mutate the global template implicitly |
| History/recovery | `undo_operation`, `redo_operation`, `list_trash`, `inspect_recovery`, `resolve_conflict` | Reference checks and expected revisions apply here too |
| Generation | `preview_generation_context`, `start_generation`, `cancel_job`, `read_candidate`, `accept_candidate` | Request snapshots are immutable; acceptance is a recoverable mutation |
| Review | `read_character_state`, `preview_review_changes`, `complete_packet_review` | Bind evidence review to exact source/packet revisions |
| Settings | `read_settings`, `update_settings`, `set_provider_secret`, `remove_provider_secret` | Return secret-present status, never a stored key |
| Export | `start_export`, `read_job_status` | Explicit destination and output scope; no implicit edition rebuild on save |

Do not expose generic write-file, arbitrary process-launch, SQL-execution, or fetch-any-URL commands to the frontend.

Use Tauri channels for token/progress streams; reserve low-volume events for workspace invalidation and job-state notifications. Every streamed envelope includes workspace session, job/candidate ID, sequence number, snapshot fingerprint, and a typed payload such as started/text/usage/completed/cancelled/failed. Unsubscribe on view teardown, but store the candidate in the backend so navigation does not lose it. Channels are Tauri's documented streaming mechanism. [Commands and channels](https://v2.tauri.app/develop/calling-rust/).

Maintain a bounded job registry with cancellation tokens. Begin with one active generation per workspace; authoring stays responsive. Distinguish cancellation requested from cancellation completed, and keep partial output. A worker/provider failure cannot kill the editor or mark a partial result as complete.

Errors include validation, stale revision, missing/archived reference, unsupported format, conflict, permission denied, disk full, worker unavailable, provider authentication/rate limit/network failure, and cancellation. Send actionable messages and field/entity context to the UI without leaking credentials or manuscript text into logs.

## 8. Frontend implementation details

### Navigation and state

Use Story and Scene as the two authoring routes. Keep app settings, library details, Trash, and recovery as contextual panels/dialogs rather than additional writing zoom levels. Maintain selected scene/beat IDs, scroll positions, collapsed panels, and local editor buffers separately from backend-acknowledged domain state.

Use one typed gateway for all native calls. A lightweight UI store can hold view state; avoid placing unacknowledged editor content and canonical backend content into indistinguishable global objects. Reject late responses from a closed workspace or superseded entity revision. Apply optimistic structural changes only with a clear pending state and rollback/conflict path.

### Editor and inline blocks

Prototype Tiptap custom nodes for character references and scoped instructions, with visible labels and inspect/edit behavior. Keep each beat's editor document independent of its ordinal position. Preserve IME composition, multi-paragraph text, selection/caret behavior, plain-text paste, internal copy/paste of references, and undo across inline atom insertion. Tiptap documents custom interactive node views separately from serialized output; the Markdown codec remains our responsibility. [Node views](https://tiptap.dev/docs/editor/extensions/custom-extensions/node-views).

Mount editors for actively edited/visible beats and render inactive content cheaply. Save before unloading an editor and restore selection by stable anchors. Do not add aggressive list virtualization until measured content sizes justify it; naïve virtualization can break focus and drag targets.

### Shared timeline component

Build a common timeline primitive parameterized by ordered IDs, card rendering, quick actions, drop slots, and selection. Use it for scenes and beats so numbered nodes, connectors, left/right alternation, focus, and responsive rules stay consistent.

Calculate structural insertion by logical before/after slots, not nearest horizontal center. Two staggered columns are one ordered sequence. Use a drag overlay so the active editor DOM is not repeatedly reparented. Commit a domain move only on drop; cancellation preserves order. Inline-node drags and OS file drops have distinct payloads and destinations.

Proposed drag library is the current `@dnd-kit/react` family; prove pointer, touch, keyboard, scroll, and alternate-column collision handling in the spike. Do not mix examples from its legacy API into the selected integration. [React quickstart](https://dndkit.com/react/quickstart/).

Each card exposes a drag handle, Duplicate, and Delete directly. More contains less frequent commands. Controls have object-specific accessible names and sufficient hit areas. Ordinary recoverable deletion does not require a generic confirmation; evidence-linked deletion uses the existing explicit resolution flow.

## 9. Existing Python engine integration

The current repository contains no Python engine source. Identify the external framework version and license/attribution requirements before adapting it. Use synthetic fixtures and a disposable vault copy; never bundle the private manuscript as an application resource.

Preferred transition: retain verified parsing/replay algorithms behind an `EngineAdapter`, and package a worker executable only if the spike demonstrates clean boundaries and reproducible builds. Tauri supports bundled sidecar executables, including packaged Python programs, with target-specific naming. [Embedding external binaries](https://v2.tauri.app/develop/sidecar/).

Worker protocol: versioned newline-delimited messages, request ID, operation, bounded payload, progress, result/error, and cancellation. Reserve stdout for protocol data and stderr for redacted diagnostics. Add startup handshake, heartbeat/timeout, output limits, controlled restart, and shutdown on workspace/application close.

Rust reads authorized source snapshots and supplies content/configuration to the adapter. The worker returns parsed/replayed results or proposed patches; Rust validates and applies all writes. Never execute a script found inside an opened project. The adapter cannot receive provider keys or initiate arbitrary network access.

Build the worker with its interpreter if used; end users install neither Python nor Node. Test packaged resource lookup, missing/failed worker recovery, and version compatibility. A later Rust engine replacement must pass the same corpus and golden outputs before switching. If clean sidecar reuse fails, record the measured blocker and estimate a Rust port before committing the schedule; do not hide the extra work.

## 10. AI generation and context

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
2. Produce a minimal installer in the first spike, including the worker if selected. Verify startup and resource lookup on a clean machine before building the full UI.
3. Proposed initial installer is NSIS through the Tauri bundler; add MSI only when needed. Specify install scope, WebView2 installation/offline policy, minimum supported OS/runtime, app-data location, and uninstall behavior. [Windows installer](https://v2.tauri.app/distribute/windows-installer/).
4. Verify install/upgrade/reinstall preserve user workspaces and app recovery data appropriately. Uninstall must not delete user-selected story folders. Test startup without developer runtimes and authoring with the network disconnected.
5. Keep application format migrations separate from installer updates. Back up before a migration and refuse writes to unsupported newer project formats.
6. Begin with deliberate manual installation of releases. Add automatic updates only after release hosting and signing-key ownership are decided. Tauri updater signatures and Windows installer code signing are separate concerns; an updater build must verify signed artifacts, and its signing cannot be disabled. [Updater](https://v2.tauri.app/plugin/updater/).
7. Build macOS/Linux separately later, including native credentials, file watchers, paths, fonts, installer/update behavior, and engine sidecars for each target. Do not describe a Windows-tested build as cross-platform verified.

No deployment, publishing account, signing key, installer certificate, or release host is assumed to exist in this repository.

## 13. Implementation milestones and tickets

All items are pending. These are dependency gates, not calendar promises; estimate effort after M0/M1.

| Milestone | Concrete work | Exit evidence |
|---|---|---|
| M0: Tauri feasibility | Scaffold React/TypeScript/Vite + Tauri/Rust; lock dependencies; define minimal command/channel; verify capabilities; create a Windows installer; evaluate credentials and worker packaging | Packaged app opens, exchanges a typed command and cancellable progress stream, and launches on a clean Windows machine |
| M1: Format and engine spike | Inspect external framework; build synthetic corpus; specify normalized entities, Markdown codec, migration rules, engine protocol, and ownership; test read-only imports and replay | Format ADR approved by evidence; untouched files round-trip byte-for-byte; representative replay parity; sidecar-or-port decision recorded |
| M2: Durable workspace slice | Open/minimally create a project; sessions/locks; journaled writes; revisions; watcher/conflicts; autosave buffers; Trash and undo operations | Create/edit/save/reopen a tiny story; interrupt a multi-file operation; recover without silently overwriting an external edit |
| M3: Story/beat timelines | Build both routes and shared alternating timeline; inline scene summary; scene/beat CRUD; visible Delete/Duplicate; drag handles/drop slots; keyboard/focus; empty states | A writer creates scenes and multi-paragraph beats, moves them at both levels, returns/reopens independently, deletes/restores, and undoes structural changes |
| M4: Inline editor and library | Implement codec-backed inline nodes; character/preset revisions; local scope; usage/archive; clipboard/IME; responsive/Calm styling | Zero/one/many-character beats survive save/reopen; named local emotions do not mutate profiles; used/archived entries remain resolvable |
| M5: Context and AI loop | Entering-state snapshots; context preview; one provider; native key storage; streaming/cancel/recovery; candidate comparison/editing/acceptance | Generate/revise/accept with recoverable prior prose; cancelled/outdated jobs remain correctly labeled; no automatic evidence or canon promotion |
| M6: Review and export | Exact-revision evidence review; intended vs established changes; stale context; history; explicit Markdown reading-edition export; PDF pipeline decision | Review binds to actual inspected bytes; compatible CLI outputs pass; exports target a chosen scope/destination and preserve artwork |
| M7: Optional stage increment | Saved location references; scene-local conditions; simple placement tokens; local extras/props; no simulation | Stage remains removable/optional and does not alter global profiles or block the complete authoring loop |
| M8: Release hardening | Installed-app E2E; keyboard/screen-reader pass; conflict/crash corpus; performance; installer upgrades; release docs/signing policy | Full workflow passes on clean Windows without Node/Python; user story files remain portable and recoverable |

M7 may be deferred without blocking the first complete release. M0–M6 and M8 cover the initial authoring/generation product. More elaborate project wizards, collaboration/sync, multiple providers, autonomous chapter generation, permanent purge, and advanced stage simulation remain later work.

The first vertical implementation slice should be small: open a synthetic workspace, show its scene overview, open a scene, edit its summary and one beat, save in Rust, close, and reopen from disk. Add drag/drop and library features after that disk-backed slice works.

## 14. Verification and performance gates

| Scope | Required checks |
|---|---|
| Domain | Stable IDs; duplicate semantics; archive/usages; scoped instructions; exact review revisions; invalid operations rejected |
| Persistence | Golden round-trips; unknown sections; Unicode/line endings; migrations; journal interruption at every write stage; disk-full/sharing violations; external conflicts; Trash restoration |
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
- Synthetic stress fixtures include 500 scenes, a scene with 100 beats, long multi-paragraph beats, and repeated references. Establish memory/startup baselines in M0/M3 and measure before adding virtualization or a database.
- Inspect both views in light/dark/Calm, reduced motion, 200% text zoom, and narrow editor widths. The two-column treatment must fall back before text or menus clip.

Proposed CI gates after scaffold: frontend typecheck/lint/behavior tests/build; Rust format/clippy/tests; contract generation drift; codec and engine parity fixtures; Windows debug and release packaging; selected installed-app E2E. Keep secrets and private vault data out of CI fixtures. Run real-provider literary evaluation separately from deterministic mocked-provider tests.

## 15. Decisions to close and implementation handoff

| Decision | Proposed position | Deadline |
|---|---|---|
| Initial desktop support | Windows first; Windows 11 x64 proposed baseline | M0 packaging spike |
| UI/editor/drag versions | React/TypeScript/Vite; Tiptap and current dnd-kit integration, subject to codec/interaction proof | M0–M1 |
| Python sidecar vs Rust engine | Reuse the existing engine behind a sidecar when parity and packaging are proven | M1; no writable import before format/engine decision |
| Exact authoring format | Single-source Markdown authoring section plus metadata; no dual editable beat bodies | M1 format ADR |
| Native credentials | OS-backed Windows store, no plaintext fallback | M0 |
| Provider and authentication | One tested direct API adapter; no subscription/API assumption | Before M5 |
| Passage-level prose revision | Whole-scene loop first; selected-passage revision follows context-safe editing | M5 scope review |
| PDF export backend | Reuse a verified existing pipeline if possible; otherwise specify a packaged exporter | M6; do not claim PDF until implemented |
| Optional physical placement | Separate increment with no core-loop dependency | M7 |
| Signing/update hosting | Manual installer first; keys/accounts/hosting are not yet configured | Before public distribution |

Before substantive feature implementation, produce ADRs for storage/codec authority, Tauri command/capability boundaries, and engine packaging. Then work milestone by milestone, attaching tests and a runnable build to each exit gate. This planning change does not scaffold code, install dependencies, modify the story vault, or update mockups.
