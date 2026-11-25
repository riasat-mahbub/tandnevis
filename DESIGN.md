# Tandnevis — story-first writing studio

The story is the dominant surface. The authoring workflow is **Story → Chapter → Scene → Summary and Beats → Generated Prose**. Story, Chapter, and Scene are separate canvases in a genuine drill-down hierarchy. Keep the local SQLite project and established rich-text reference architecture. Libraries, creation wizards, optional narration, and generation support the manuscript.

## Writing views and navigation

**Story canvas** shows numbered chapter rows with a narrative excerpt and up to three scene titles. Derive excerpts from existing scene summaries: chapters have no persisted description field. Opening a chapter enters its dedicated canvas. New chapter creates and opens a chapter; chapter ordering and recoverable deletion retain existing domain operations. Scene cards and scene editors do not appear inside the Story canvas.

**Chapter canvas** shows only the selected chapter's scenes in a connected, single-column list, with its own editable title, New scene, scene actions, and independent scroll position. A density control offers a compact version. Clicking a scene opens its writing canvas. Zoom out returns to Story and restores the chapter row's position and keyboard focus.

**Scene canvas** provides persistent Story / Chapter / Scene orientation above the editable title. Clicking the chapter or using Zoom out opens the immediate parent chapter canvas and restores its scene-card position. The current scene control opens a temporary searchable outline with nested scenes and the current selection; outline chapter entries open chapter canvases. Previous/Next follows chapter order and each chapter's scene order, crossing chapter boundaries and skipping empty chapters. End controls are disabled.

There are no writing destination tabs or segmented navigation controls. A narrow left utility rail provides Story overview at the top and Story Library at the bottom. Below 781px it becomes a bottom bar, with reserved space beneath the content. The library drawer opens from the left beside the rail, with grouped search in Characters → Emotions → Tones order and access to the existing full editors; narrow windows use the full width above the bottom bar. Dismissal restores the originating canvas and trigger focus. Chapter presentation, last-opened-object emphasis, and per-canvas scroll positions survive ordinary navigation. Opened chapter canvases and scene editors remain mounted within the current project session so pending writing, caret position, and local text undo survive switches. Deleted objects and project-session changes dispose their canvases. Hidden editors do not respond to focus requests.

## Scene composition

Desktop uses a collapsible 260px writing-tools shelf and a dominant flexible editor. Optional Scene details (point of view, tense, instructions) live in a shelf disclosure. Narrow windows initially collapse the shelf to a small toolbar. Breadcrumbs and generation actions occupy a sticky scene toolbar; Previous/Next sit beside the editable title.

The centre contains scene context and title, a rich-text summary, an ordered beat timeline, Add beat, context preview and generation review, and Scene prose. Editable beat cards use one comfortable column, subtle numbered positions, a vertical connector, visible reordering alternatives, Duplicate/Delete, and insertion points. Writing surfaces use quiet neutrals with restrained one-pixel borders. Draft review puts the editable source beside the proposal and stacks on narrow windows; closing review retains the draft.

### Text and inline references

Summary and beats are freeform rich-text editors. Character, Emotion, and Tone blocks are optional inline references within continuous text, anywhere in a sentence or paragraph. Text may precede, separate, and follow any number of references. Never turn beats into forms or move references into separate metadata rows. No reference, cast, recipient, staging, or narration field is required to write.

Dragging a shelf reference inserts it at the drop position, including editor blank space. Clicking inserts at the last active summary or beat caret. References remain reusable project definitions; local insertion does not duplicate the definition. Character occurrence identity and existing document semantics remain intact. Icons are visual metadata, excluded from generation context. Reference drag/move/copy, cursor movement, text selection, and undo use the existing rich-text implementation.

### Block shelf

Show stacked, icon-labeled **Characters → Emotions → Tones** groups with one shared search and New/Manage controls for each category. Initially show a bounded selection with Show all/Show fewer controls; searches reveal all matches. The collapsed rail provides search and expand controls.

Keep group meaning and preset color families readable. Manage opens the existing full library; New opens the existing wizard or preset-creation workflow. The shelf is for inserting references, not editing definitions. Its content scrolls independently of the manuscript.

Characters retain sage backgrounds. Emotion/Tone presets share the effective-colour system and seven named families: Connection, Positive energy, Conflict, Unease, Vulnerability, Discovery, and Focus. Custom colours appear last. Preset colour is visual only. Icons, labels, and inline type names preserve meaning independently of colour.

## Creation and library workflows

Preserve the four-step character wizard: Starting point, Name and icon, Profile details, Review and creation. Starting point supports blank characters and the existing 58 stock types, grouped search, preview, and source disclosures. Preserve validation, the 32-icon picker, optional profile fields and guidance, stock replacement, draft resumption, project boundaries, and recovery handling. Only Review creates a project definition. Stock types remain templates, not project characters.

Default guidance IDs start empty. None remains distinct from Neutral; custom presets named None remain distinguishable as None (preset). Existing characters retain ordinary library editing. Libraries retain search, active/archive filters, master/detail editing, usage inspection, duplication, and archive/delete protections for definitions in use.

Creation from a scene remembers the originating editor. The character wizard and preset creation/cancellation return to it without automatic insertion or automatic project Save. Full library management remains available independently of scene composition.

## Generation and persistence

### Relationship continuity

The Story canvas and each Scene canvas expose a visible Character graph button beside the title. It opens the graph, scrolls it into view, and focuses its heading. Story supports initial relationships and a scene-position selector; scene views use their own position. Drag connector handles between characters to create a relationship, then choose meaning and direction on the edge. Character boxes move independently of relationship semantics, with one project layout shared by Before/After. Keep a compact inspector only for the selected edge, plus search, zoom/pan and Fit. Keyboard connector activation provides an alternative to dragging. SVG export, the Add relationship button, permanent relationship lists, and manual label-position controls are removed.

Store sparse changes against stable character and scene IDs. A summary relationshipChange atom references its scene’s changeId; both graph and block edit that same record. Graph creation appends a block once, subsequent edits preserve its ID, and summary deletion removes that change atomically. Before derives from initial relationships and preceding scenes in chapter/scene order, then applies the scene’s entry corrections. After applies outcome edits. Empty descriptions explicitly end a relationship and retain a block; removing a change restores inheritance. Initial story relationships do not need scene blocks. Outcomes remain Planned until marked Established. Earlier changes and scene order affect downstream generation fingerprints without rewriting prose. Deleted scenes suspend their changes until restored; duplicated scene changes and blocks receive corresponding fresh IDs and Planned status. Relationships and explicitly selected context characters protect character deletion.

Frontend preview and native generation resolve shared relationship blocks to the same readable instructions, alongside Before/After context for relevant characters. At scene entry blocks correct entering state; By scene end blocks state intended lasting outcomes. Their summary position does not prescribe an exact moment of change; beats describe the transition. Relationship blocks are summary-only and must reference the same scene. Prose acceptance does not establish changes. Reading-order inheritance remains explicit; flashbacks require entry corrections and a correction when returning. Schema 9 adds shared blocks and saved graph layout, materializing old scene changes in the working copy without implicitly saving the source. Missing fields in old snapshots default empty. Manual Save, project Undo/Redo, recovery, and unsaved-change protections remain authoritative.

Generate beats and Generate prose sit in the scene toolbar. Both keep the existing connection/model checks, context construction, streaming, recovery, review, acceptance, outdated-draft acknowledgement, copy, retry, and discard behavior. Beat acceptance appends; prose acceptance replaces only the scene prose. Existing independent inline guidance and legacy summary-tone migration remain supported.

Manual Save remains the default in the app header. Navigation does not save the project. Preserve queued edits, local text undo, project Undo/Redo, save failures, conflict recovery, and unsaved-change protections on close and project changes. New/Open, Markdown interchange, and Trash remain in Project. Deleted scenes, chapters, and beats remain recoverable through existing mechanisms.

Tauri 2 with React/TypeScript and Rust remains the desktop architecture. Rust commands own SQLite persistence. Markdown import/export is explicit interchange, without live two-way sync. Do not rebuild persistence or generation for a layout change.

## Manuscript compilation

Compile Book sits below Story Library in the utility rail and opens a focused modal with options on the left, a readable manuscript preview on the right, and persistent counts and file actions beneath. Narrow windows stack options above the preview within one scrollable body. Preserve the mounted writing editors and restore trigger focus on dismissal. Ctrl/Cmd+Shift+E opens compilation when another dialog is not active.

Compile only scene prose in narrative chapter/scene order, including manual writing and accepted drafts. Story, chapter, and scene scopes use stable IDs. Title page, contents, scene headings, scene breaks, and unfinished-scene policies are explicit choices; default to Markdown and skipping empty prose. Counts distinguish selected, included, and unfinished scenes and count only written words. Plain text, Markdown, and standalone escaped HTML share the same manuscript model as the text-node preview. No summaries, beats, definitions, deleted material, generation instructions, or pending proposals enter the manuscript.

Opening and refreshing compilation flush queued edits without implicitly saving the project file. Preview and export share a cloned project snapshot. Changes require an explicit refresh, and the session/revision is checked again after the native Save dialog. Cancellation is silent; export failures retain the preview for retry. A scoped Rust command safely replaces UTF-8 manuscript files. Existing outline Markdown interchange stays in Project. Native PDF remains outside the format selector until print/PDF completion and cancellation are verified in the desktop app.

## Visual system and accessibility

- Platinum `#E5EBEA`, Harvest Orange `#FF7700`, primary-action orange `#B94F00`, Iron Grey `#435058`, and deep ink `#20282D` remain authoritative.
- Enabled primary actions use white text on `#B94F00`, hover `#A64700`, and pressed `#933F00`. Disabled actions use readable neutrals. Orange highlights selection and important feedback sparingly.
- Preserve light, dark, system, and Calm preferences; fresh installs default to light Platinum.
- Georgia is the manuscript/title face; platform sans is for navigation and controls. Comfortable reading width takes precedence over information density.
- Use restrained borders and consistent small radii. Story rows, chapter scenes, and beat editors follow a quiet vertical reading order.
- Every action needs an accessible name, visible focus, a keyboard path, and usable disabled/empty states. Temporary outline navigation uses native modal focus management and returns focus on dismissal. Dragging always has visible move alternatives.
- Respect reduced motion. No permanent second outline sidebar, analytics dashboard, AI chat interface, destination tabs, or mandatory metadata form. The dedicated Chapter canvas is for narrative structure and scene navigation, not a replacement for scene composition.

The UI uses Tandnevis as its studio name. Existing executable, package, project-format, and settings identifiers remain compatible.
