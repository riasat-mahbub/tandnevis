# Tandnevis — story-first writing studio

The story is the dominant surface. The authoring workflow is **Story → Chapter → Scene → Summary and Beats → Generated Prose**. Story, Chapter, and Scene are separate canvases in a genuine drill-down hierarchy. Keep the local SQLite project and established rich-text reference architecture. Libraries, creation wizards, optional narration, and generation support the manuscript.

## Writing views and navigation

**Story canvas** shows ordered chapter cards on the alternating vertical timeline. Opening a chapter enters its dedicated canvas. New chapter creates and opens a chapter; chapter ordering and recoverable deletion retain existing domain operations. Scene cards and scene editors do not appear inside the Story canvas.

**Chapter canvas** shows only the selected chapter's scenes, with its own editable title, New scene, scene actions, and independent scroll position. The alternating scene timeline can switch to a compact scene list using a single density control. Clicking a scene opens its writing canvas. Zoom out returns to Story and restores the chapter card's position and keyboard focus. This is a separate canvas, not collapsed siblings on the Story screen.

**Scene canvas** provides persistent Story / Chapter / Scene orientation above the editable title. Clicking the chapter or using Zoom out opens the immediate parent chapter canvas and restores its scene-card position. The current scene control opens a temporary searchable outline with nested scenes and the current selection; outline chapter entries open chapter canvases. Previous/Next follows chapter order and each chapter's scene order, crossing chapter boundaries and skipping empty chapters. End controls are disabled.

There are no writing destination tabs or segmented navigation controls. The app header contains a separate Library menu, always ordered Characters → Emotions → Tones, opening the existing library workflows. Library returns to its originating Story, Chapter, or Scene canvas. Chapter presentation, last-opened-object emphasis, and per-canvas scroll positions survive ordinary navigation. Opened chapter canvases and scene editors remain mounted within the current project session so pending writing, caret position, and local text undo survive switches. Deleted objects and project-session changes dispose their canvases. Hidden editors do not respond to focus requests.

## Scene composition

Desktop uses a 230px block shelf, a dominant flexible editor, and a collapsed 46px inspector rail. Either side can collapse independently. Opening Scene details reveals optional point of view, tense, and instructions; medium windows place expanded details beneath the editor. Narrow windows initially collapse the shelf into a small toolbar with category shortcuts, with details below the writing.

The centre contains scene context and title, a rich-text summary, an ordered beat timeline, Add beat, context preview and generation review, and Scene prose. Editable beat cards use one comfortable column, subtle numbered positions, a vertical connector, visible reordering alternatives, Duplicate/Delete, and insertion points. Alternation belongs to Story View, not extended beat editing. Writing surfaces use quiet neutrals with restrained one-pixel borders.

### Text and inline references

Summary and beats are freeform rich-text editors. Character, Emotion, and Tone blocks are optional inline references within continuous text, anywhere in a sentence or paragraph. Text may precede, separate, and follow any number of references. Never turn beats into forms or move references into separate metadata rows. No reference, cast, recipient, staging, or narration field is required to write.

Dragging a shelf reference inserts it at the drop position, including editor blank space. Clicking inserts at the last active summary or beat caret. References remain reusable project definitions; local insertion does not duplicate the definition. Character occurrence identity and existing document semantics remain intact. Icons are visual metadata, excluded from generation context. Reference drag/move/copy, cursor movement, text selection, and undo use the existing rich-text implementation.

### Block shelf

Use stacked, icon-labeled **Characters → Emotions → Tones** tabs with readable 14px labels, consistent hit targets, a filled active state, visible focus, and Up/Down as well as Left/Right/Home/End keyboard access. The collapsed rail provides named category shortcuts.

Below navigation, show only the active category's description: “Who is involved.”, “What they feel.”, or “How the writing sounds.” Then show category search, Manage/New controls, and an independently scrollable palette. Manage opens the existing full library; New opens the existing wizard or preset-creation workflow. The shelf is for inserting references, not editing definitions.

Characters retain sage backgrounds. Emotion/Tone presets share the effective-colour system and seven named families: Connection, Positive energy, Conflict, Unease, Vulnerability, Discovery, and Focus. Custom colours appear last. Preset colour is visual only. Icons, labels, and inline type names preserve meaning independently of colour.

## Creation and library workflows

Preserve the four-step character wizard: Starting point, Name and icon, Profile details, Review and creation. Starting point supports blank characters and the existing 58 stock types, grouped search, preview, and source disclosures. Preserve validation, the 32-icon picker, optional profile fields and guidance, stock replacement, draft resumption, project boundaries, and recovery handling. Only Review creates a project definition. Stock types remain templates, not project characters.

Default guidance IDs start empty. None remains distinct from Neutral; custom presets named None remain distinguishable as None (preset). Existing characters retain ordinary library editing. Libraries retain search, active/archive filters, master/detail editing, usage inspection, duplication, and archive/delete protections for definitions in use.

Creation from a scene remembers the originating editor. The character wizard and preset creation/cancellation return to it without automatic insertion or automatic project Save. Full library management remains available independently of scene composition.

## Generation and persistence

Generate scene sits beside the summary and proposes editable beats. Generate prose follows composition and produces narrative prose. Both keep the existing connection/model checks, context construction, streaming, recovery, review, acceptance, outdated-draft acknowledgement, copy, retry, and discard behavior. Neither replaces the source composition. Existing independent inline guidance and legacy summary-tone migration remain supported.

Manual Save remains the default in the app header. Navigation does not save the project. Preserve queued edits, local text undo, project Undo/Redo, save failures, conflict recovery, and unsaved-change protections on close and project changes. New/Open, Markdown interchange, and Trash remain in Project. Deleted scenes, chapters, and beats remain recoverable through existing mechanisms.

Tauri 2 with React/TypeScript and Rust remains the desktop architecture. Rust commands own SQLite persistence. Markdown import/export is explicit interchange, without live two-way sync. Do not rebuild persistence or generation for a layout change.

## Visual system and accessibility

- Platinum `#E5EBEA`, Harvest Orange `#FF7700`, primary-action orange `#B94F00`, Iron Grey `#435058`, and deep ink `#20282D` remain authoritative.
- Enabled primary actions use white text on `#B94F00`, hover `#A64700`, and pressed `#933F00`. Disabled actions use readable neutrals. Orange highlights selection and important feedback sparingly.
- Preserve light, dark, system, and Calm preferences; fresh installs default to light Platinum.
- Georgia is the manuscript/title face; platform sans is for navigation and controls. Comfortable reading width takes precedence over information density.
- Use restrained borders and consistent small radii. Preserve playful alternating scene cards in Story View while keeping composition surfaces quiet and horizontal.
- Every action needs an accessible name, visible focus, a keyboard path, and usable disabled/empty states. Temporary outline navigation uses native modal focus management and returns focus on dismissal. Dragging always has visible move alternatives.
- Respect reduced motion. No permanent second outline sidebar, analytics dashboard, AI chat interface, destination tabs, or mandatory metadata form. The dedicated Chapter canvas is for narrative structure and scene navigation, not a replacement for scene composition.

The UI uses Tandnevis as its studio name. Existing executable, package, project-format, and settings identifiers remain compatible.
