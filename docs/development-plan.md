# Shorthand Writer — development plan

Status: approved product direction, implementation starting, 19 November 2026. This plan changes no story canon or source files. Actual delivery and verification are tracked in [implementation progress](implementation-progress.md).

**Implementation platform:** Tauri 2 desktop with a React/TypeScript frontend and Rust application backend. This replaces the earlier Electron proposal. The detailed build plan, module ownership, storage/IPC contracts, work tickets, and verification gates are in [the Tauri implementation plan](tauri-implementation-plan.md).

## 1. Product direction

Build a local desktop writing application around the existing scene-shorthand framework. Scenes sit on a vertical story timeline as draggable scene blocks. Selecting a block opens that individual scene in the scene writer. Each scene has a main idea/summary box and an ordered set of beat cards; each beat is a freeform text editor that can mix ordinary writing with reusable draggable blocks. A beat can contain zero, one, or any number of characters. AI develops that direction into a lived scene. The writer can edit prose directly, compare alternatives, and decide which draft becomes the current source.

**Confirmed requirements:** separate application repository; a Tauri desktop app with a complete local frontend/backend; a vertical timeline of draggable scene blocks; individual scene editing in the scene writer; the main scene idea/summary in a box; ordered beat cards with freeform text and no required cast size or actor/recipient fields; separate reusable character, emotion, tone, and voice/delivery blocks; optional stage references and a possible physical stage board; human-authored shorthand and tags; AI primarily for prose generation.

**Confirmed navigation:** use separate Story and Scene views as two conceptual zoom levels. Story shows the whole-story vertical timeline; opening a scene switches into its writer. Preserve the accepted scene-writer workflow and hierarchy, with a clear return to the overview.

**Confirmed timeline interactions:** Scene view also uses a vertical beat timeline, visually matching the alternating left/right scene timeline. Both scene blocks and beat cards support drag-and-drop reordering through clear handles and before/after insertion targets. Each block exposes quick actions, including a directly visible Delete control; common actions are not available only through a menu. These requirements are planning updates, not changes to the existing mockups.

**Next interface iteration:** add a playful touch through selective skew and asymmetry, plus discoverable create/edit/duplicate/delete controls. Keep writing surfaces comfortable and make removal recoverable. The concrete scope, control inventory, state rules, and acceptance checks are in [the playful interface and editing plan](interface-plan.md). These additions are planned; the current prototype remains the functional baseline.

**Approved storage and first tranche:** Windows first, one writer, one open native project, with SQLite as the canonical store and Rust-only domain/database access. Build the scaffold, durable authoring backend, connected Story/Scene timelines/editor/library/Trash, and verification/build in commit-sized steps. Markdown is explicit import/export interchange; there is no live two-way Obsidian sync. Integrated AI, legacy engine compatibility, and production signing follow as separate milestones. Local authoring works offline; cloud generation requires a connection. The next-tranche plan proposes direct ChatGPT plan access first after eligibility verification, with Gemini/OpenCode qualified separately.

The primary workflow is:

1. Select or create a scene in the outline.
2. Write the scene summary, then develop it in freeform beat cards, adding character, emotion, tone, or voice blocks where helpful. Attach a stage only when wanted.
3. Inspect the characters' accumulated state at this point when needed; this is not a required form-filling step before writing.
4. Record any intended outcomes separately from established changes; neither outcomes nor character metadata are required for every beat.
5. Generate a prose candidate from the approved project context and current direction.
6. Compare, edit, or regenerate the candidate.
7. Accept the prose and review which meaningful changes it actually establishes.
8. Refresh the packet's evidence, then rebuild the relevant continuity views.

Success means completing this loop without manually editing pipe-separated shorthand or assembling character context across many files.

## 2. Existing framework to preserve

The current project has 59 Part 0 packets, 141 Year One packets, and three independent earlier samples. Reading manifests determine order; filename sorting does not.

| Existing source | Application responsibility |
|---|---|
| `scenarios/parts/*.json` | Outline order, scene identity, source locations, and chapter groupings |
| `objective.md` | Purpose and limits of a scene |
| `scene.md` | Cast, beats, tone, relationships, voices, knowledge limits, and character diffs |
| `stage.md` | Physical anchors, evidence excerpts, open staging, and continuity reviews |
| Starting characters, voices, entry relationships | Beginning state for the selected period |
| Period-specific canon profiles | Established facts and character reference |
| Existing prose files | Current authored manuscript sources |
| `context/` | Derived inspection and prompt outputs |

The framework already distinguishes directed relationships, local delivery, persistent voice changes, individual knowledge, and temporary versus continuing mood. Preserve these distinctions in controls, prompts, and replay.

Additional knowledge/expertise/mood diffs currently cover the first eighteen Year One scenes and two later pilots. Intervening relationship and voice updates are replayed, but this is a sparse knowledge model. A missing entry means **unmodelled**, not necessarily ignorant. Full equivalent simulation coverage for Part 0 is a later extension; opening its packets should still work.

Canon, provisional staging, editorial interpretation, and unresolved questions remain distinct. Cooperation does not automatically mean friendship; physical presence does not mean someone heard or understood a remark. A successful build does not certify literary quality.

## 3. Two views at two zoom levels: story overview and scene writer

Use two distinct views, at two conceptual zoom levels. **Story view** is the whole-story overview with a vertical timeline of draggable scene blocks. Opening a block switches to **Scene view**, the dedicated scene writer for that scene. Back to story returns to the overview; Story/Scene controls switch between the two levels. The timeline does not occupy a permanent sidebar in Scene view. A chapter/scene breadcrumb preserves orientation. Preserve the accepted scene summary, reorderable freeform beat cards, and library/inspector arrangement while adding the playful visual treatment described below. Structured details support the editor rather than replacing it.

### Two useful scales

- **Story scale:** a vertical timeline of draggable scene blocks grouped by chapter/part, read from top to bottom. Each block shows its title, summary excerpt, and a compact review indicator when relevant. Select a block to edit that scene; drag a block up or down to reorder scenes, with a clear insertion marker. Provide keyboard movement and visible move actions as equivalents. New scenes can begin with only an idea.
- **Scene scale:** switch into the selected scene's writer, with its title, main idea/summary box, scene tone, and a vertical beat timeline. Beat cards alternate left/right around a numbered spine, with staggered placement matching the story overview. Each card is a freeform text editor with optional inline character, emotion, tone, and voice/delivery blocks. A beat can describe atmosphere without characters, one character's thoughts, a conversation among several characters, or a longer passage with several actions. There is no one-character-per-beat or one-utterance-per-beat rule. Keep the summary above the timeline. Editing a beat stays within Scene view; it does not create a third zoom level. Use a simple sequence initially; permit an explicit overlap group when the direction needs simultaneous contributions. A graph or automatic time simulation is unnecessary for the first release.

The timeline initially represents **reading order**. Period labels can appear on it, but proportional spacing must not imply exact elapsed time. Chronological grouping or lanes are a later view over explicit time data; unknown dates and overlapping viewpoints remain visible.

### Workspace areas

| Area | Primary content and actions |
|---|---|
| Story view (zoomed out) | Vertical timeline of draggable scene blocks, chapter groups, summary excerpts, and scene creation/reordering actions; opening a scene switches to its writer |
| Scene view (zoomed in) | Individually editable scene title and summary, scene tone, an alternating vertical timeline of freeform beat cards, and generation/revision actions; Back to story returns to the overview |
| Scene library and contextual details | Preserve the accepted editor layout: reusable blocks in the library, freeform writing in the center, and local scope/character details in the inspector |
| Prose drawer or split view | Generated candidates, comparisons, direct prose edits, and acceptance |
| Optional physical stage | A scene-local board for placing characters, extras, and props over a reusable location layout; writing works without it |

Keep the main idea above the beats while composing. Preserve the selected scene and overview scroll position when moving between views. Collapse the library and inspector for prose review. Support keyboard navigation, visible focus, adjustable text size, and text labels alongside status colours. Every drag action also has an Add action and keyboard movement equivalent.

### Scene selection, editing, and visual direction

- A scene block and its editor refer to one stable scene identity. Editing the title or summary updates the timeline block; switching scenes preserves unfinished title, summary, beat, and prose buffers.
- Moving a scene changes its timeline position and dependent context, while its summary, beats, candidates, and prose remain attached to the same scene. Provide undo for movement and clear feedback about affected continuity views.
- Preserve the accepted scene-writer hierarchy and behavior. Add gentle skew to card backings or tabs and bounded asymmetric offsets to overview scene blocks; keep editable text, controls, focus outlines, and timeline/drop markers aligned and readable.
- Keep the established warm neutral surfaces and restrained character/emotion/tone colors. Selection, focus, hover, and drop targets must be legible in light and dark modes. Avoid permanent forms or repeated metadata around every beat.
- On smaller windows, reflow scene tools around the editor; Story and Scene remain separate views. The overview timeline stays vertical at every size.
- The revised design reference is [the scene writer prototype](../outputs/scene-writer-studio.html). It illustrates the intended interaction and visual hierarchy; it is a local prototype, not the installed application or a connected AI generator.

### Planned playful treatment and complete editing controls

Follow [the interface plan](interface-plan.md) for the next iteration. In the story overview, scene blocks alternate left/right around a numbered central vertical spine, with staggered positions and slightly varied widths. Reading order determines side after reordering; subtle backing angles remain tied to identity. Freeform beat text remains horizontal. Calm appearance removes decorative transforms without changing reading order; reduced motion is respected independently. Narrow layouts use one readable column and a left spine.

Use the same alternating timeline language for beats inside the scene writer. Keep both timelines numbered in reading order, with horizontal text and no overlapping same-side cards. Alternate only when the writing area provides comfortable card widths; collapse supporting panels or use a single-column timeline before squeezing editable text.

Add visible creation actions and a compact quick-action strip on every scene block and beat card: drag handle, Duplicate, Delete, and a More menu for secondary commands. Add/insert controls are also available between blocks. Delete is directly visible and available without opening More or hovering. Scene Delete moves the scene to project Trash; beat Delete remains undoable and respects evidence references. Labeled contextual menus cover additional chapter/scene/beat commands. Expand the reusable library with basic author-created character profiles, preset/template editing, usage inspection, archiving, and deletion of unused entries. Keep imported canon changes on their source-linked review path.

Duplicated scenes/beats receive new identities while keeping references to the same reusable characters/presets. A scene duplicate starts as direction only; it does not inherit accepted prose, evidence assertions, or continuity approval. Used library entries can be archived without breaking existing scenes. Removing a local chip or token never deletes its global definition.

Scene/chapter removal uses project Trash and supports restoration; beat deletion supports Undo and resolves any evidence references. Define Trash persistence, restore ordering, reference handling, and undo transaction boundaries during the schema spike. Destructive purge, extensive bulk operations, and a general project-management wizard are later work.

### Reusable blocks and ordinary text

| Block | Reuse behaviour | Scene-specific controls |
|---|---|---|
| Main scene idea | One editable main idea box per scene | Purpose, central action/pressure, and what should matter to the reader |
| Character | Reference the same period-specific character across scenes | Participation, actor/recipient role, viewpoint where appropriate, and local direction |
| Emotion | Save a reusable emotion label or guidance preset independently of a character | Attach to a specified character within a beat or selected passage; do not change their baseline voice or persistent state |
| Tone | Save a named tone or tone progression as a reusable preset | Apply to the whole scene or an explicitly selected beat/group |
| Voice | Reuse established baseline guidance or an author-created voice preset | Choose the character and scope; distinguish current delivery from a proposed persistent change |
| Stage (optional) | Reuse a location's established anchors or a provisional stage template | Scene-local conditions and optional opening positions; a written location is sufficient without a board |
| Extra/group | Optionally reuse lightweight role templates such as nurse or students | A scene-local participant or crowd with optional description, action, dialogue, and position; no full profile required |
| Beat | Reorder or reuse a freeform direction passage | Ordinary editable text with optional inline blocks; zero or more characters; no mandatory actor, recipient, or delivery fields |
| Regular text | Write notes and direction without converting each sentence to a block | Mark as generation direction or author-only comment; default to generation direction |

Drop targets communicate meaning. Dropping a character into a beat inserts a shared character reference at that point in the freeform text; a beat can contain any number of references. Dropping a character on a scene header adds them to the cast, and dropping one on an attached physical stage places their scene instance. Structured actor/recipient slots are optional inspector details. Dropping an emotion onto a character reference applies it to that character within the beat or an explicitly selected passage; a multi-character beat must never silently apply the emotion to everyone. Tone and voice blocks display their scope. A stage block dropped on a scene sets its optional stage reference; a beat-level stage note affects that beat. Merely placing two character blocks beside each other never creates a relationship or shared knowledge.

A physical stage, if included in the first release, begins as a simple 2D layout with draggable labeled objects and character tokens. Opening positions are local to the scene. Do not imply automatic movement or visibility/hearing simulation. Defer animation, pathfinding, and spatial simulation. A scene remains fully writable and generatable with no stage or character blocks at all.

Library entries can be created, named, searched, duplicated, and reused by the writer. Begin with characters, baseline voices, and stage references already supported by the project; new templates remain provisional authoring material. A character reference uses the appropriate story period, not a later profile.

To protect earlier scenes, dropping a tone/voice/stage preset inserts an editable scene snapshot with a reference to its source version. Editing that instance affects only the scene. Editing the reusable preset creates a new library version; offer an explicit preview before applying it to existing instances. Character identity remains a shared reference, while its calculated state remains scene-specific. Do not maintain a second relationship database inside the block library.

### Structured details behind the blocks

- Preserve title, period, location, viewpoint, cast, purpose, and optional tags in native entities. Explicit import maps supported legacy fields with provenance; native edits do not update the original manifests.
- Keep narration settings optional and inherit the story's defaults. Grammatical person (first/third person) is separate from whose thoughts the narrator can reveal (limited/omniscient/external). Do not require a character viewpoint selection to create a scene.
- Support `@self`, `@room`, and `?` recipients, named characters, groups, generic roles, and offstage correspondents. Unknown recipients stay unknown.
- Keep scene tone progression, per-beat delivery, and persistent default changes separate. Tone presets are guidance, not global character mutations.
- Separate intended outcomes from recorded relationship, voice, knowledge, expertise, and mood changes. Select the evidence beat where required.
- Preserve continuity check kinds and the existing `check`, `needs-revision`, and `reviewed` statuses.

Tags filter and describe content; they do not establish facts. Beat cards provide visual structure around freeform text: no mandatory beat per utterance, no cast-size constraint, and no requirement to prescribe every movement. The scene summary gives the overall intent; beats develop that intent without replacing it.

### Timeline editing and Markdown compatibility

Scenes and beats are both draggable structural objects. Drag scenes within the current chapter and beats within the open scene in the initial implementation; existing impact-reviewed cross-chapter scene movement follows later. A dedicated handle starts dragging so selecting text, moving the caret, or clicking an inline character/emotion block never reorders the containing card. Show before/after insertion markers and support drops before the first item, between items, and after the last item, including scroll assistance for long timelines. Commit one reorder on drop; cancellation leaves order unchanged. Provide native-button and keyboard movement equivalents, with focus following the moved item.

Move scenes within a chapter first, then support cross-chapter moves with an impact preview. A move transaction updates database order/parent metadata, invalidates dependent views, and preserves scene identity, content, and source provenance. Export derives manifest/order representations when that interchange format supports them.

Reordering beats also remaps character-diff evidence references. Deleting a referenced beat requires reassignment or removal of that reference. Give blocks stable internal identities so a display renumber does not break references.

After either kind of move, update ordinal numbers, alternating sides, and connectors from the new order. Preserve identities, freeform text, local block scope, draft/prose associations, and evidence links. Record the reorder as one undoable transaction and invalidate affected generation/continuity context. Deleting through a quick action follows the same Trash/Undo/reference-resolution path as deleting through a menu.

The native SQLite schema stores freeform beat documents, reusable profile/preset revisions, local block instances/scope, order, and optional stage metadata. Define a versioned Markdown interchange representation with readable scene/beat boundaries and explicit supported-format limits. Preserve imported originals and unknown content as provenance rather than establishing a second editable authority. Re-import is deliberate; no watched Markdown mirror or automatic reconciliation is planned.

## 4. Make the framework support shorthand-first authoring

The current extraction tooling assumes prose already exists: it requires matching source hashes and rejects an entire part when a packet is stale. An authoring app must also support a new scene with no prose, incomplete direction, and revised prose awaiting packet review.

Introduce these capabilities without weakening the existing strict build checks:

1. Separate document parsing, format validation, source-freshness checks, and replay. The editor can open an incomplete packet and report useful field-level diagnostics; strict export still rejects invalid inputs.
2. Add an explicit lifecycle for new scenes: direction only, candidate available, current prose awaiting review, and packet reviewed against the current source. Imported scenes retain their existing provenance; a matching hash alone does not confer editorial approval.
3. Store intended outcomes separately from established changes in the native schema; define their explicit Markdown representation when the compatibility adapter is implemented. Planned updates may have a preview, but do not feed established replay. Imported `relationships`, `voices`, and `character-diff` blocks retain their meaning as authored draft assertions.
4. Keep current-source and packet-reviewed fingerprints separate. Accepting a candidate makes its prose current; only a subsequent packet review can refresh the reviewed source hash. Bind review completion to the exact bytes reviewed.
5. Keep draft evidence distinct from canon approval. No lifecycle action promotes a draft assertion to canon.

Proposed legacy mappings must be documented and tested before claiming compatibility. Import never rewrites original packets. Retain unknown source sections in provenance, expose unsupported content, and document what can be re-exported without loss. Full legacy parsing/replay is later work and does not block native SQLite authoring.

When an upstream packet is stale or invalid, keep the editor usable and label downstream calculations accordingly. Do not quietly omit the problem scene or present its dependent state as current. A last valid snapshot may be shown with its source revision clearly identified.

## 5. AI prose generation is a core feature

The eventual authoring/generation release includes one integrated generation path. This follows the first native authoring tranche. Provider selection and credentials are settings, not story content. Keep the provider interface small enough to add another backend later. The [installation and connected AI plan](install-and-ai-plan.md) now defines the proposed next tranche: Windows install/setup scripts, a Scene Generate button, supported subscription sign-in, model/account selection, and recoverable streamed candidates. Direct ChatGPT plan access is the proposed first connection after eligibility testing; Gemini and OpenCode are staged and individually qualified. API access remains a separately selected route.

### Context assembly

Build an inspectable generation request from:

- The selected scene's main idea, ordered text/beat flow, scoped tone/voice/stage instances, intended outcomes, and explicit limits. Exclude author-only comments.
- Period-appropriate canon references and the project's prose style guide.
- The selected characters' entering state, directed attitudes, and relevant prior developments, each with provenance and coverage limits.
- Relevant adjacent prose and continuity details, selected deliberately rather than the full manuscript.
- A distinction between author knowledge, viewpoint knowledge, other characters' knowledge, and facts to withhold from the reader.

The existing context builder extracts approved canon capsules; it does not yet assemble this full scene request. Add a separate assembler that reuses those sources and replay logic. Make truncation visible, and never silently drop knowledge or revelation limits to fit a request.

Do not import later scenes or a later-period profile into an earlier scene's entering state. For overlapping viewpoints, preserve established dependencies and flag uncertain chronology rather than inventing an exact timeline.

### Generation and revision

Provide Generate, Stop, Compare, Revise with instruction, and Accept candidate. Stream text without blocking editing. Capture the exact direction/context revision, model settings, and outcome with each candidate. If inputs change while generation runs, retain the result but mark it as based on earlier direction.

Store candidates separately from current manuscript revisions in the native database. Candidates are never included in reading editions automatically. Support rejecting a candidate without losing the existing draft, recovering partial output, and comparing alternatives without overwriting them. Explicit exports choose which manuscript scope to include.

Acceptance is a deliberate replacement of the current prose with a recoverable previous version. It does not accept model-suggested character diffs, invent canon, clear continuity concerns, or refresh the packet hash. The writer reviews those consequences separately, with the prose and relevant packet fields side by side.

AI may optionally suggest missing evidence or continuity concerns after drafting; those are suggestions until the writer records them. Preserve creative room: a compressed beat can expand into multiple exchanges, and incidental compatible detail remains provisional staging.

Show which content will be sent to the selected provider and usage/cost information where available. Keep keys outside Git using an OS-backed credential store behind a Rust `SecretStore`, with no plaintext fallback. Stored keys are retrieved only by the backend; the UI receives key-present status. Verify the chosen Windows credential backend in the Tauri spike. [Windows native keyring store](https://docs.rs/windows-native-keyring-store/latest/windows_native_keyring_store/).

## 6. Tauri full-stack desktop architecture

Use Tauri 2 for the desktop shell, React/TypeScript/Vite for the frontend, and Rust for the application backend. Full stack includes workspace services, durable local storage, domain operations, credentials, AI/provider requests, jobs, and exports; a hosted server/database is not required. The installed application loads bundled frontend assets and does not require Node. See [the detailed implementation plan](tauri-implementation-plan.md) for module boundaries, proposed packages, entities, commands, schemas, and delivery slices.

| Layer | Ownership |
|---|---|
| React frontend | Two writing views, rich-text beat editors, timeline drag previews, quick actions, library, review, focus/accessibility |
| Typed Tauri command/channel boundary | Validated requests, acknowledged revisions, structured errors, cancellable progress/token streams |
| Rust backend | Project sessions, exclusive domain/database access, migrations, transactions/recovery, revisions, Trash, interchange, later jobs/provider requests/credentials |
| Engine adapter | Later existing parsing/replay adapter after source inspection, parity fixtures, and sidecar-or-port decision |
| Local project | Canonical SQLite database: stories/chapters/scenes/freeform beats/profiles/presets/revisions/Trash; derived indexes remain disposable |

Rust alone accesses the canonical SQLite database and owns native integration and provider/network work. The frontend calls narrow domain commands; it has no SQL plugin, database connection, arbitrary filesystem operations, or shell access. Restrict application-command permissions as well as plugin capabilities, validate project sessions/paths and message revisions, and render Markdown without executable content. [Tauri commands](https://v2.tauri.app/develop/calling-rust/), [Tauri capabilities](https://v2.tauri.app/security/capabilities/).

Use Tauri channels for generation/progress streams and low-volume events for invalidation. If the engine worker is retained, Rust controls its versioned standard-input/output protocol and supplies authorized snapshots; the worker returns derived results or proposed patches rather than writing story files. No localhost web server is required in the installed app. Include request/operation IDs, cancellation, structured errors, progress, and controlled worker recovery.

### Keep software and story repositories independent

The application creates/opens a chosen local native project database; it never assumes a story is beneath its installation or application repository. Markdown import/export uses explicit chosen sources/destinations. If a reusable engine is later shipped, never execute arbitrary scripts found in an opened project.

The referenced `build_scene_maps.py` and `build_character_pilot.py` sources are not in this repository. Later, inspect the external framework and adapt verified logic behind an engine interface, preserving attribution and behavioural parity. Generalise fixed roots/period selections through explicit project configuration. Compare a bundled Python worker with a Rust port using evidence; neither is a dependency for the native authoring tranche. Original vault files and command-line workflows stay independent; compatibility claims require an explicit codec/parser gate.

Proposed application layout:

```text
src/                     React/TypeScript app, features, editors, services, and styles
src-tauri/               Rust commands, domain/workspace services, jobs, security, and packaging
engine/                  Adapted Python engine source/protocol, if sidecar reuse is validated
contracts/               Versioned IPC/schema fixtures and generated frontend types
tests/fixtures/          Synthetic miniature story projects
tests/e2e/               Installed Tauri/WebView workflows
docs/                    Product, format, and development documentation
```

Do not copy the private story vault into the application repository. Use the real vault as an external compatibility target, with intentional testing on a disposable copy. Commit synthetic fixtures that exercise the same shapes and edge cases.

### Persistence and recovery

SQLite is the source of truth. Rust owns a versioned schema with foreign keys, stable opaque entity IDs, explicit sibling order, revision preconditions, content revisions, operations, and persistent Trash. Use parameterized queries and a transaction for each domain mutation, including related order/reference/history updates. A failed mutation rolls back as a unit. Native content permits freeform multiple-paragraph beats without legacy pipe-table restrictions.

The frontend never opens the database directly. Rust serializes conflicting mutations and acknowledges saves only after commit. Test project reopen, rollback, stale revisions, lock/write failures, and migration refusal for newer schemas. Back up consistently before destructive migrations; if WAL is used, copying a live main database file alone is insufficient. Never replace an unreadable project with an empty database silently.

Autosave authoring buffers independently of packet review, showing saving/saved/failed based on backend acknowledgement. Store UI preferences and crash buffers in application data; project content, revision history, and Trash remain in the database. Optional caches contain no sole authoritative relationships or entering-state records. Flush dirty text before structural operations and project switching, or preserve explicit recoverable buffers.

Markdown is an explicit interchange boundary. Import retains provenance and unknown source material without modifying originals; export chooses scope/destination and documents loss limits. External edits to Markdown are not synchronized into the project; re-import requires a deliberate supported operation. Validate import/export paths including resolved link/junction escapes. Git integration and cloud sync can wait.

## 7. Delivery milestones and acceptance gates

These are dependency-ordered milestones, not calendar commitments. The detailed M0–M8 breakdown is in [the Tauri implementation plan](tauri-implementation-plan.md#13-implementation-milestones-and-tickets). The immediate commit sequence and honest completion checklist are in [implementation progress](implementation-progress.md). Native authoring comes before advanced AI and legacy framework integration.

| Milestone | Deliverable | Acceptance gate |
|---|---|---|
| 1. Scaffold and durable native backend | React/TypeScript + Tauri 2/Rust scaffold; SQLite schema/migrations; project sessions; transactional chapter/scene/beat and library operations; revisions; Trash; explicit Markdown interchange | Build/typecheck and meaningful Rust tests demonstrate create/edit/duplicate/move/delete/restore, rollback, supported interchange, and persistence after reopen |
| 2. Connected two-view authoring and verification | Separate Story/Scene views; matching alternating timelines; summary/freeform beats; visible quick actions/drag handles/keyboard movement; reusable profiles/presets; local/global scope; Trash; playful/Calm styling | UI reads/writes through Rust; complete documented authoring flows, preserve identities/independent edits, and record frontend/native build and interaction results with remaining gaps |
| 3. Legacy compatibility and richer editing | Inspected external parser/replay adapter; synthetic/disposable corpus; supported rich inline nodes; source preservation and interchange limits | Legacy parity and supported export/import round-trips proven before claiming framework compatibility |
| 4. AI prose loop | Scene context assembler, one provider, streaming, candidate labels/editing/comparison/recoverable removal, and deliberate acceptance | Generate from structured shorthand, revise, remove an unaccepted candidate without affecting the manuscript, accept prose, and recover the previous source; no automatic canon/state/hash updates occur |
| 5. State and continuity review | Entering/exiting inspector, source-linked histories, intended-outcome handling, packet review, and derived views | Intended knowledge never enters actual replay; stale inputs stay visible; review refreshes evidence only for the prose actually inspected |
| 6. Desktop release | Search/filter refinement, full keyboard/accessibility flows, installer, compiled exports, clean-machine tests, production signing policy | Complete the full workflow on a disposable project, inspect deliberate Markdown exports in Obsidian, and install on clean Windows; make no live-sync claim |

For the first tranche, use only synthetic projects covering empty/multiple scenes, freeform beats, shared and local library scope, durable ordering, revisions, and Trash restoration. Legacy parity fixtures later cover directed relationships, local/continuing moods, received testimony, and stale sources. Verify native builds early; installed-app and production signing evidence remain separate gates.

If selected, package the Python engine with its interpreter as a target-specific sidecar. Build the Windows installer through the Tauri bundler, initially proposing NSIS. Verify WebView2/runtime installation policy and native-resource lookup on a clean machine; manual installation comes before any automatic-update service. [Tauri sidecars](https://v2.tauri.app/develop/sidecar/), [Windows installers](https://v2.tauri.app/distribute/windows-installer/).

## 8. Validation strategy

- **Interchange and later compatibility:** verify the supported native Markdown export/import contract with synthetic fixtures and retained unknown content/provenance. Later add golden inputs/outputs for inspected legacy parsing/replay and strict builds. Import leaves original packets byte-identical; native authoring never writes them implicitly.
- **Story semantics:** directed attitudes stay directed; events do not overwrite standing relationships; local moods do not persist; reader revelations do not become character knowledge; periods reset appropriately; uncertain chronology is visible.
- **Authoring lifecycle:** a scene with no prose remains editable; intended updates cannot affect replay; source changes require renewed evidence review; beat moves preserve references; scene moves preserve identity.
- **Timeline and reuse:** scenes appear in a vertical timeline; drag and keyboard scene moves retain scene/summary/beat identities and invalidate affected context; switching scenes preserves independent edits and unfinished buffers; title and summary edits update the matching timeline block; freeform beat text/block order survives save/reopen; beats with no characters, one character, and multiple characters all remain editable and generate successfully; multiple actions or paragraphs need no extra mandatory fields; character-specific emotions never spread to other characters in a beat; optional stages and inherited narration settings never block writing; preset edits do not change past instances without an explicit update; keyboard controls can perform every drag operation; author-only comments stay out of generation requests.
- **Two-view navigation:** the overview and scene writer are distinct screens; opening/returning preserves selected scene, independent editing buffers, and overview scroll position. The overview stays vertical at all widths, and the accepted scene editor retains its summary and freeform beat cards.
- **Matching timelines and quick actions:** Story view has a scene timeline and Scene view has a matching beat timeline, both alternating left/right when space allows. Exercise drag-and-drop before/between/after items, long-list scrolling, cancellation, and keyboard movement at both levels. Text selection and inline-block editing never initiate structural dragging. Renumbering/repositioning preserves identities and evidence links, and Undo restores a complete move. Every scene/beat exposes Duplicate and Delete without hover or a menu; quick deletion is recoverable and leaves focus on a useful neighboring target.
- **Editing controls and recovery:** create/edit/duplicate/move/delete/undo/restore chapters, scenes, and beats; duplicates receive fresh identities and no copied continuity approval; used library entries archive without breaking references; deleting a local occurrence never deletes a global profile; evidence-linked beat deletion requires explicit resolution.
- **Playful appearance:** deterministic offsets and decorative skew preserve reading order and interactive bounds; editable text/carets remain aligned; verify Calm appearance, reduced motion, light/dark themes, keyboard flow, high text zoom, narrow windows, and long content using the interface plan's acceptance checks.
- **Durability:** SQLite transaction rollback, stale revisions, lock/write failures, migration refusal/backup, interrupted operations, project reopen, and persistent revision/Trash recovery preserve work. Direct external database replacement is an error, not a silent new project. Later worker failures cannot invalidate authoring content.
- **AI behaviour:** mock the provider for repeatable streaming, stop, timeout, rate-limit, partial-output, and changed-input tests. Inspect assembled requests for missing constraints and future-state leakage. Use a small real generation evaluation separately; prose quality needs editorial judgement.
- **Desktop:** bounded end-to-end checks for project opening, authoring, generation, review, keyboard operation, and installer startup. Verify packaged operation without developer runtimes.

After engine inputs change in a compatibility workspace, preserve the existing checks: scene maps and `--check`, character pilot in both normal and `--draft-run` modes with their `--check` variants, and `python -m unittest discover -s tests`. Canon changes additionally require the existing context/relationship rebuilds. Planning or prose edits never trigger a reading-edition rebuild implicitly.

Normal saves rebuild lightweight derived views as needed. Exporting a compiled Markdown/PDF reading edition is a separate writer action. Preview the target part and destination, preserve existing artwork, and do not equate successful export with finished prose.

## 9. Deliberate later work

Defer multiplayer collaboration, cloud sync, mobile clients, automatic canon promotion, broad historical knowledge extraction, advanced spatial stage editing/simulation, and large-scale autonomous chapter generation. A simple optional placement board can be prototyped without making it a first-release dependency. A generic project-creation wizard and additional AI/local-model providers can follow proven compatibility with the initial framework.

Basic creation and editing of author-created characters belongs in the first authoring release. Imported canon editing retains source-linked review; full retcon workflows require a reviewed domain change set and decision record. Defer permanent purge and extensive bulk editing. Retain the repository's distinction between canon, suggestions, and open questions throughout.

## 10. Open product decisions

1. Which AI provider and authentication method should the first integrated generator support? Do not assume an existing chat subscription supplies application API access.
2. How much revision should the first release support: whole scene plus selected passage, or whole scene only? Proposed default: whole scene first, followed by passage revision that includes surrounding context.
3. Should descriptive tags have a shared vocabulary across scenes? Proposed default: freeform tags with suggestions from the current project; constrained values only where the framework defines semantics.
4. Should this become a general writing product? Proposed default: a reusable app proven against the current framework, with project-specific rules loaded from the workspace rather than hardcoded into the interface.

These are software design questions, not unresolved story canon. Implementation starts with the native SQLite tranche and synthetic fixtures; a disposable vault copy is needed only for later legacy compatibility work.
