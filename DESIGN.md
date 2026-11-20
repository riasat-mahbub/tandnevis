# Shorthand Writer — two-view design

The accepted scene-writer workflow remains: two views at two conceptual zoom levels, scene summaries, and freeform beat cards. The next visual iteration adds a playful touch with selective skew and asymmetry, together with clearer editing controls. Functional requirements remain in [the development plan](docs/development-plan.md); the detailed next-step brief is [the interface plan](docs/interface-plan.md). The [interactive design reference](outputs/scene-writer-studio.html) shows the current functional baseline. The new visual treatment and additional controls are planned, not implemented in that prototype.

## Composition

**Story view (zoomed out)** is a vertical scene timeline, grouped by chapter. Scene blocks show their title and summary excerpt. Opening a block switches into that individual scene's editor. Drag scenes vertically, with explicit before/after insertion feedback; visible move controls offer the same action without dragging. The timeline stays vertical at every size.

**Scene view (zoomed in)** retains the accepted scene writer: editable title, scene tone, a distinct scene idea/summary field, and ordered freeform beat cards. A beat can contain any text and zero or more character references. Back to story returns to the overview; Story/Scene controls switch zoom levels. A chapter/scene breadcrumb preserves orientation.

The latest planned extension arranges those beats on a matching vertical timeline: alternate left/right around numbered nodes, preserve freeform editing, and keep the scene summary above the timeline. This remains part of Scene view, with no third zoom level. Collapse to one column when the editor cannot provide comfortable alternating-card widths.

Preserve the accepted scene layout: reusable blocks on the left, writing in the center, and contextual details/optional staging on the right. Physical staging and narration are collapsed until needed. The whole-story timeline does not occupy a permanent sidebar beside the scene writer.

## Visual system

- Next implementation palette: Harvest Orange `#FF7700`, Platinum `#E5EBEA`, and Iron Grey `#435058`, with deep ink `#20282D` and derived neutrals for contrast. This supersedes the moss/rose/ochre colors in the existing implementation and historical previews; recoloring is planned work.
- Preserve Georgia for writing content and the platform sans for controls/navigation.
- Use orange for primary actions and restrained emphasis, platinum for light surfaces, and grey/ink for readable content and controls. Character, emotion, and delivery labels preserve meaning independently of color. Orange on platinum is unsuitable for normal small text; orange buttons use darker ink labels. Update light/dark tokens together.
- One-pixel boundaries, small consistent radii, compact control groups, and generous space between writing sections. No decorative shadows or dashboard statistics.
- Clear selected, hover, focus, disabled, empty, and drop states in light and dark appearances. Motion only communicates state and respects reduced-motion preferences.

## Planned playful refinement

Alternate scenes to the left and right of a central vertical timeline, staggered from top to bottom, with numbered nodes and clear connectors. Slightly unequal card widths provide asymmetry while same-side cards stay separated. Side follows reading order after reordering; subtle backing angles remain tied to scene identity. Collapse to a single column with a left spine on narrow screens. Put gentle skew/rotation on backings and tabs; keep editable text and controls horizontal. Apply the Harvest Orange palette while retaining writing typography, scene summary, and editor/library hierarchy.

Asymmetry should emphasize the writing area through unequal useful proportions, not obscure order or scatter tools. Calm appearance removes decorative transforms and normalizes offsets. Narrow layouts reduce the effect before sacrificing readable width. No looping wobble or bouncing; reduced motion remains an independent preference.

## Planned editing controls

Add clear New/Add actions, and expose drag handles, Duplicate, and Delete directly on every scene block and beat card. Keep less frequent commands in More/Actions menus. Scenes and beats both support drag-and-drop reordering, before/after insertion markers, and keyboard equivalents; editing text does not initiate structural dragging. Renumber and alternate sides after moves while retaining stable identities and evidence links. Add character/profile and preset/template editing, usage inspection, and archive/delete rules to the library. Scene/chapter Trash and beat Undo make everyday removal reversible. Local removal never deletes a global definition; duplicates receive new identities and retain explicit shared references. See the interface plan for the object-by-object inventory and acceptance gates. These latest timeline/quick-action requirements are planning-only additions to the existing previews.

## Interaction contract

- The next tranche adds a global Settings page for one ChatGPT connection and appearance settings. It returns to the selected writing view and does not add a third writing zoom level.
- Generate one selected scene from its ordered beats and resolved character-reference data. Inline blocks encode model instructions, not physical simulation. Generate stays grey/disabled until the Settings connection/model test succeeds, with an adjacent explanation and Open Settings link. See the [scoped plan](docs/install-and-ai-plan.md).

- Title and summary edits update the corresponding timeline block. Switching scenes preserves separate title, summary, beat, prose, and optional stage state.
- Scene and beat identities survive movement. Ordering is reading order, not proportional elapsed time.
- Character blocks refer to shared profiles. Beat emotion and delivery changes affect their explicit local target; multi-character beats do not silently apply them to everyone.
- Dragging is optional: library blocks can be inserted by clicking, and movement has native-button equivalents.
- No stage, cast, recipient, or viewpoint form is required to write a scene or beat.
- On narrow windows, scene tools reflow around the editor. The two views remain distinct and the overview stays vertical.

## Implementation boundaries

The prototype demonstrates scene selection, independent editing, scene/beat creation and reordering, inline blocks, local scope, optional placement, and prose review layout. Cloud generation, workspace persistence/recovery, continuity replay, and transaction-safe saves belong to the application milestones. The prototype's illustrative prose preview never calls an AI provider.

The desktop implementation targets Tauri 2 with React/TypeScript and a Rust backend. A local SQLite project database is the canonical authoring store; only Rust domain commands access it. Markdown import/export is explicit interchange, without live two-way Obsidian sync. Database-backed projects keep stories, chapters, scenes, freeform beats, reusable profiles/presets, revisions, and Trash together. [The implementation plan](docs/tauri-implementation-plan.md) defines native boundaries and delivery gates; [implementation progress](docs/implementation-progress.md) records actual completion. This architecture preserves the two views, both alternating timelines, drag handles, visible Duplicate/Delete, local/global scope, optional stages, and the accepted visual direction.
