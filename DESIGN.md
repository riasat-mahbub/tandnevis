# Shorthand Writer — two-view design

The current revision includes 18 tones and 24 emotions automatically, with meaning, guidance, and examples. Back sits before Project at the far left. The Scene sidebar shows one Characters, Emotions, or Tones tab at a time, with category search, one matching Manage link, New character in Characters, and a desktop collapse control. Manual Save remains in force.

The current scene composition is defined by [Scene board and generation revision](docs/scene-board-and-generation.md), which supersedes the standalone scene-tone row and plain summary field below. Top-left Generate scene/Generate prose actions precede the title; the title is followed directly by a rich summary board, then the freeform beat timeline. Summary and beats accept optional Character, Emotion, and Tone references anywhere on the board. Drop is the primary insertion path; clicking a sidebar block inserts at the last focused editor caret. References do not require a cast, selection, or target dialog. Context preview belongs after the beats.

The two writing zoom levels retain full **Characters, Tones, and Emotions** library screens. New character opens one editable draft form with a blank option or a static archetype template. Templates use archetype titles without personal names; the name, background, personality, and voice stay editable, and the project receives a character only after Create. Static templates can be reused and are not saved as project definitions. Characters already created from the former stock list remain ordinary project characters. Characters use sage backgrounds, Emotions lilac, and Tones apricot, consistently across insertion and editing. New projects include editable starter emotions and tones. Save stays in the app header; New/Open, Markdown import/export, and Trash move to a labeled Project menu. [Global blocks and usable navigation](docs/global-blocks-and-navigation-plan.md) remains a historical reference for the library destinations and app shell; the current [Scene board and generation revision](docs/scene-board-and-generation.md) governs block placement, target behavior, and tone handling. The reference in `outputs/review/` guides the block-use workflow; the current Platinum/Harvest Orange visual system and alternating timelines remain authoritative.

The accepted scene-writer workflow remains: two views at two conceptual zoom levels, scene summaries, and freeform beat cards. The next visual iteration adds a playful touch with selective skew and asymmetry, together with clearer editing controls. Functional requirements remain in [the development plan](docs/development-plan.md); the detailed next-step brief is [the interface plan](docs/interface-plan.md). The [interactive design reference](outputs/scene-writer-studio.html) shows the current functional baseline. The new visual treatment and additional controls are planned, not implemented in that prototype.

## Composition

Planned next revision: [Character creation wizard](docs/character-creation-wizard-plan.md) separates Starting point, Name and icon, Profile details, and Review into focused steps. It replaces the combined creation page described below when implemented, while retaining the catalog, icon system, and ordinary profile editing. The wizard is planning-only.

The [stock character library revamp](docs/stock-character-revamp-plan.md) replaces the six invented templates with 53 reference-backed types. New character provides category buttons, grouped search, icons, source details, and a preview before explicit application. The form keeps the name and icon controls above the browser, then editable profile fields. A 32-icon picker supports custom and existing characters; icons appear in the library, shelf, and inline references. Icons are visual metadata and never enter generation context. Existing creation entry points and the visual system remain in place.

The next screens are described concretely in [Global blocks: UI design brief](docs/global-blocks-ui-design.md): persistent project/navigation/save groups, a Scene block shelf and local inspector, full master/detail library editors, explicit drop feedback, and responsive behavior. It extends this visual system without changing the accepted writing workflow.

**Story view (zoomed out)** is a vertical scene timeline, grouped by chapter. Scene blocks show their title and summary excerpt. Opening a block switches into that individual scene's editor. Drag scenes vertically, with explicit before/after insertion feedback; visible move controls offer the same action without dragging. The timeline stays vertical at every size.

**Scene view (zoomed in)** has an editable title directly above a freeform rich summary board and ordered beat cards. Every board can contain text and zero or more Character, Emotion, and Tone blocks. A tone in the summary supplies scene guidance without a separate selector. Back to story returns to the overview; Story/Scene controls switch zoom levels. A chapter/scene breadcrumb preserves orientation.

The latest planned extension arranges those beats on a matching vertical timeline: alternate left/right around numbered nodes, preserve freeform editing, and keep the scene summary above the timeline. This remains part of Scene view, with no third zoom level. Collapse to one column when the editor cannot provide comfortable alternating-card widths.

Preserve the accepted scene layout: reusable blocks on the left, writing in the center, and contextual details/optional staging on the right. Physical staging and narration are collapsed until needed. The whole-story timeline does not occupy a permanent sidebar beside the scene writer.

## Visual system

- Current palette: Harvest Orange `#FF7700` and Platinum `#E5EBEA` are the primary brand colors, supported by Iron Grey `#435058`, deep ink `#20282D`, and derived neutrals for contrast. Fresh installs default to the light Platinum theme regardless of system preference. This supersedes the moss/rose/ochre colors in the existing implementation and historical previews.
- Enabled primary and Save actions use dark Harvest Orange `#B94F00` with white labels and icons; hover uses `#A64700` and pressed uses `#933F00`. Disabled actions use readable neutral surfaces. The brighter `#FF7700` remains the brand accent for decorative and selected-state details.
- Preserve Georgia for writing content and the platform sans for controls/navigation.
- Keep Harvest Orange and Platinum visibly primary: dark orange for enabled actions, brighter orange for selected accents, and Platinum for the default page and writing surfaces. Use Iron Grey/deep ink for readable text and supporting structure, not as a black-looking brand color. Characters retain sage. Emotion and Tone presets share seven color families—Connection rose, Positive energy gold, Conflict coral, Unease violet, Vulnerability blue, Discovery teal, and Focus slate—with headings in the scene shelf and readable text in light and dark themes. A preset color is visual only and never changes its writing guidance. Custom colors appear in a final Custom colors group. Type labels and icons preserve meaning independently of color.
- One-pixel boundaries, small consistent radii, compact control groups, and generous space between writing sections. No decorative shadows or dashboard statistics.
- Clear selected, hover, focus, disabled, empty, and drop states in light and dark appearances. Motion only communicates state and respects reduced-motion preferences.

## Planned playful refinement

Alternate scenes to the left and right of a central vertical timeline, staggered from top to bottom, with numbered nodes and clear connectors. Slightly unequal card widths provide asymmetry while same-side cards stay separated. Side follows reading order after reordering; subtle backing angles remain tied to scene identity. Collapse to a single column with a left spine on narrow screens. Put gentle skew/rotation on backings and tabs; keep editable text and controls horizontal. Apply the Harvest Orange palette while retaining writing typography, scene summary, and editor/library hierarchy.

Asymmetry should emphasize the writing area through unequal useful proportions, not obscure order or scatter tools. Calm appearance removes decorative transforms and normalizes offsets. Narrow layouts reduce the effect before sacrificing readable width. No looping wobble or bouncing; reduced motion remains an independent preference.

## Planned editing controls

Add clear New/Add actions, and expose drag handles, Duplicate, and Delete directly on every scene block and beat card. Keep less frequent commands in More/Actions menus. Scenes and beats both support drag-and-drop reordering, before/after insertion markers, and keyboard equivalents; editing text does not initiate structural dragging. Renumber and alternate sides after moves while retaining stable identities and evidence links. Add character/profile and preset/template editing, usage inspection, and archive/delete rules to the library. Scene/chapter Trash and beat Undo make everyday removal reversible. Local removal never deletes a global definition; duplicates receive new identities and retain explicit shared references. See the interface plan for the object-by-object inventory and acceptance gates. These latest timeline/quick-action requirements are planning-only additions to the existing previews.

## Interaction contract

- The next tranche adds a global Settings page for one ChatGPT connection and appearance settings. It returns to the selected writing view and does not add a third writing zoom level.
- Generate scene proposes editable beats from the summary board; Generate prose writes narration and dialogue from the summary and ordered beats. Both review results before acceptance. Inline blocks encode model instructions. Both actions stay grey/disabled until the Settings connection/model test succeeds, with an explanation and Open Settings link.

- Title and summary edits update the corresponding timeline block. Switching scenes preserves separate title, summary, beat, prose, and optional stage state.
- Scene and beat identities survive movement. Ordering is reading order, not proportional elapsed time.
- Character references point to shared profiles. Emotion and tone references are independent inline guidance cues. Old occurrence-target attributes stay readable, but new references do not infer a character target.
- Dragging works at any point in the summary or beat board, including blank space. Clicking a sidebar block inserts it at the last focused editor caret; writing itself never requires a selected block or an existing character.
- No stage, cast, recipient, or viewpoint form is required to write a scene or beat.
- On narrow windows, scene tools reflow around the editor. The two views remain distinct and the overview stays vertical.

## Implementation boundaries

The prototype demonstrates scene selection, independent editing, scene/beat creation and reordering, inline blocks, local scope, optional placement, and prose review layout. Cloud generation, workspace persistence/recovery, continuity replay, and transaction-safe saves belong to the application milestones. The prototype's illustrative prose preview never calls an AI provider.

The desktop implementation targets Tauri 2 with React/TypeScript and a Rust backend. A local SQLite project database is the canonical authoring store; only Rust domain commands access it. Markdown import/export is explicit interchange, without live two-way Obsidian sync. Database-backed projects keep stories, chapters, scenes, freeform beats, reusable profiles/presets, revisions, and Trash together. [The implementation plan](docs/tauri-implementation-plan.md) defines native boundaries and delivery gates; [implementation progress](docs/implementation-progress.md) records actual completion. This architecture preserves the two views, both alternating timelines, drag handles, visible Duplicate/Delete, local/global scope, optional stages, and the accepted visual direction.
