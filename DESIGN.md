# Shorthand Writer — two-view design

The latest user instruction preserves the accepted scene-writer design and separates the whole story and each scene into two distinct views at two conceptual zoom levels. Functional requirements remain in [the development plan](docs/development-plan.md). The [interactive design reference](outputs/scene-writer-studio.html) is a prototype with illustrative story content, not the installed application or a connected AI generator.

## Composition

**Story view (zoomed out)** is a vertical scene timeline, grouped by chapter. Scene blocks show their title and summary excerpt. Opening a block switches into that individual scene's editor. Drag scenes vertically, with explicit before/after insertion feedback; visible move controls offer the same action without dragging. The timeline stays vertical at every size.

**Scene view (zoomed in)** retains the accepted scene writer: editable title, scene tone, a distinct scene idea/summary field, and ordered freeform beat cards. A beat can contain any text and zero or more character references. Back to story returns to the overview; Story/Scene controls switch zoom levels. A chapter/scene breadcrumb preserves orientation.

Preserve the accepted scene layout: reusable blocks on the left, writing in the center, and contextual details/optional staging on the right. Physical staging and narration are collapsed until needed. The whole-story timeline does not occupy a permanent sidebar beside the scene writer.

## Visual system

- Preserve warm paper and neutral secondary surfaces.
- Preserve Georgia for writing content and the platform sans for controls/navigation.
- Restrained green character blocks, rose emotion blocks, and ochre tone/delivery blocks. Labels identify each meaning independently of color.
- One-pixel boundaries, small consistent radii, compact control groups, and generous space between writing sections. No decorative shadows or dashboard statistics.
- Clear selected, hover, focus, disabled, empty, and drop states in light and dark appearances. Motion only communicates state and respects reduced-motion preferences.

## Interaction contract

- Title and summary edits update the corresponding timeline block. Switching scenes preserves separate title, summary, beat, prose, and optional stage state.
- Scene and beat identities survive movement. Ordering is reading order, not proportional elapsed time.
- Character blocks refer to shared profiles. Beat emotion and delivery changes affect their explicit local target; multi-character beats do not silently apply them to everyone.
- Dragging is optional: library blocks can be inserted by clicking, and movement has native-button equivalents.
- No stage, cast, recipient, or viewpoint form is required to write a scene or beat.
- On narrow windows, scene tools reflow around the editor. The two views remain distinct and the overview stays vertical.

## Implementation boundaries

The prototype demonstrates scene selection, independent editing, scene/beat creation and reordering, inline blocks, local scope, optional placement, and prose review layout. Cloud generation, workspace persistence/recovery, continuity replay, and transaction-safe saves belong to the application milestones. The prototype's illustrative prose preview never calls an AI provider.
