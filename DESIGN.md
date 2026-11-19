# Shorthand Writer — scene writer design

This records the refined interface direction for the accepted scene writer. The functional requirements remain in [the development plan](docs/development-plan.md). The [interactive design reference](outputs/scene-writer-studio.html) is a prototype with illustrative story content, not the installed application or a connected AI generator.

## Composition

The left rail is a **vertical scene timeline**, grouped by chapter. Scene blocks show their title and summary excerpt. The selected block opens one independently editable scene in the center. Drag scenes vertically, with explicit before/after insertion feedback; visible move controls offer the same action without dragging.

The center is the main working area: editable title, scene tone, a distinct scene idea/summary field, and ordered freeform beat cards. A beat can contain any text and zero or more character references. Small drag handles and secondary move controls keep manipulation available without competing with the prose.

The right library contains reusable characters, emotions, scene tones, delivery presets, extras, and optional stage templates. Selected-beat details remain contextual. Physical staging and narration are collapsed until needed. The library can be hidden to widen the editor.

## Visual system

- Warm paper for the editor; a quieter neutral for summary and tools; deep moss for story navigation.
- Literata for scene titles and writing content; DM Sans for controls and navigation. Georgia and the platform sans provide readable fallbacks.
- Restrained green character blocks, rose emotion blocks, and ochre tone/delivery blocks. Labels identify each meaning independently of color.
- One-pixel boundaries, small consistent radii, compact control groups, and generous space between writing sections. No decorative shadows or dashboard statistics.
- Clear selected, hover, focus, disabled, empty, and drop states in light and dark appearances. Motion only communicates state and respects reduced-motion preferences.

## Interaction contract

- Title and summary edits update the corresponding timeline block. Switching scenes preserves separate title, summary, beat, prose, and optional stage state.
- Scene and beat identities survive movement. Ordering is reading order, not proportional elapsed time.
- Character blocks refer to shared profiles. Beat emotion and delivery changes affect their explicit local target; multi-character beats do not silently apply them to everyone.
- Dragging is optional: library blocks can be inserted by clicking, and movement has native-button equivalents.
- No stage, cast, recipient, or viewpoint form is required to write a scene or beat.
- On narrow windows, labeled Scenes and Library controls reveal supporting panels. The scene list stays vertical at every size.

## Implementation boundaries

The prototype demonstrates scene selection, independent editing, scene/beat creation and reordering, inline blocks, local scope, optional placement, and prose review layout. Cloud generation, workspace persistence/recovery, continuity replay, and transaction-safe saves belong to the application milestones. The prototype's illustrative prose preview never calls an AI provider.
