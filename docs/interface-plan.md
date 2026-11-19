# Playful interface and editing controls

Status: planned application work, with an [interactive playful preview](../outputs/scene-writer-playful.html). This brief extends the [development plan](development-plan.md) and [design record](../DESIGN.md). The preview demonstrates the visual treatment, core scene/beat actions, recoverable removal, Calm appearance, and basic character-profile editing. It does not implement the full control inventory, installed-app persistence, or real AI generation.

## 1. Goal and boundaries

Give a writer a welcoming place to arrange a story and develop scenes without turning writing into form filling. Add a playful touch through selective skew and asymmetry, while making creation, editing, duplication, removal, and recovery easy to find.

Retain two writing views:

- **Story:** the whole-story vertical timeline, with draggable scene blocks grouped by chapter. Open a scene to zoom in.
- **Scene:** the accepted scene writer, with a scene idea/summary, scene tone, ordered freeform beat cards, reusable blocks, and optional staging. Back to story zooms out.

Beat cards can contain zero, one, or many characters. Stages and narration overrides remain optional. Preserve the existing hierarchy, navigation, and writing behavior while refining the visual treatment. Library management and Trash open as contextual panels within these views; they do not add another writing zoom level.

## 2. Visual direction

The interface should feel like arranging story notes on a writing desk. Warm paper, moss green, dusty rose, and ochre carry forward from the accepted design. Use color consistently to distinguish character, emotion, and tone/delivery blocks, with text labels for every category.

### Story view

- Keep the timeline spine straight and vertical. Reading order stays unambiguous.
- Alternate scene blocks on the **left and right of a central vertical timeline**: first left, next right, then left again. Stagger their vertical positions and slightly vary widths to create useful asymmetry. Number the timeline nodes so reading order remains clear. Long summaries grow downward; cards never overlap other cards on the same side.
- Add gentle skew or rotation to a scene block's outer backing or decorative edge, rather than its text and controls. Proposed starting limits are about one degree of rotation and one to two degrees of skew; tune by checking legibility, not by maximizing the effect.
- Side follows current reading order and updates after a scene move. Small backing angles remain deterministic from scene identity. Both sides connect to one straight spine; tab and screen-reader order match the top-to-bottom sequence.
- Show selection and before/after drop markers clearly. During dragging, the scene follows the pointer and the insertion marker remains straight.

### Scene view

- Keep the scene summary visually distinct, with a slightly offset backing or label tab. The editable summary remains horizontal.
- Keep beat text and editable surfaces flat. Put any playful treatment on small labels, card backings, or secondary chips, leaving the caret, selection, focus outline, and drop targets aligned to their controls.
- Use unequal column widths to emphasize the editor: a compact library, a generous writing column, and quieter contextual details. Asymmetry comes from useful proportions and spacing.
- Use occasional offset tabs or gently angled preset labels. Apply a small set of component variants consistently; do not tilt every control independently.
- Preserve Georgia for writing and the platform sans for controls in this iteration. Keep toolbars and menus aligned, with consistent control sizes and spacing.

### Comfort and accessibility

- Provide **Calm appearance** to remove decorative skew/rotation and normalize offsets while preserving order, hierarchy, and functionality. This preference does not change story content.
- Respect reduced-motion preferences independently of Calm appearance. No wobbling, bouncing, or looping decorations. Keep reorder/selection feedback brief, with content visible throughout.
- At narrow widths or high text zoom, collapse the alternating arrangement into one readable column with its spine on the left, and remove decorative transforms. Both zoom levels remain usable with a keyboard and the overview remains vertical.
- Hit areas, focus outlines, and drag destinations follow the actual interactive bounds. Screen-reader order matches reading order, regardless of visual offsets.
- Verify semantic colors and text contrast in both light and dark appearances. Do not use decoration or color as the only sign of selection, scope, or deletion.

## 3. Controls where writers need them

Keep a visible primary creation control in each context. Put less frequent actions in a labeled Actions menu; never depend on hover or right-click alone. Use familiar user-facing verbs rather than the technical label “CRUD.”

| Object | Create and inspect | Edit and organize | Duplicate and remove |
|---|---|---|---|
| Chapter | New chapter in Story view; expand/collapse its scenes | Rename; move within the outline | Delete an empty chapter; for a populated chapter, explicitly move its scenes elsewhere or move the chapter and contents to Trash |
| Scene | New scene; insert before/after a timeline block; open to inspect | Edit title, summary, tone, beats, and optional settings; drag or move up/down | Duplicate direction; Move to Trash; restore from Trash |
| Beat | Add beat at the end or insert above/below; select its card | Freeform text and inline blocks; move up/down; drag; collapse long beats | Duplicate; delete with Undo; resolve existing evidence references when necessary |
| Character profile | New character from the library; inspect by selecting its reference | Edit name, background, personality, baseline voice, and other optional profile fields; inspect usages | Duplicate as a new identity; archive when in use; delete unused profiles |
| Emotion, tone, voice/delivery preset | New preset within its category; inspect its meaning and usages | Rename and edit guidance; edit a local instance independently | Duplicate; archive used presets; delete unused presets |
| Stage template | New stage; inspect saved description and optional layout | Edit anchors, fixed objects, and description; show usages | Duplicate the template; archive when used; delete when unused |
| Scene-local participant, prop, or extra | Add through text, library, or an attached stage | Edit local direction/condition; move a stage token; promote an extra to a reusable character when wanted | Remove the local occurrence; duplicate ordinary props/extras as new instances where appropriate |
| Draft candidate | Generated in the AI milestone; inspect or compare a saved candidate | Rename its label; revise/edit its text; accept deliberately | Remove an unaccepted candidate with recovery; retain the recoverable manuscript revision after acceptance |

### Story controls

New scene is always visible. Each scene block has Open and an Actions menu containing Rename, Duplicate, Insert before, Insert after, Move up/down, and Move to Trash. The normal title/summary editing remains in Scene view. Chapters provide New chapter and a compact chapter Actions menu. Trash and Restore are available from the overview.

Returning from a scene preserves its selection and the overview position. Removing the open scene returns to the overview and focuses a sensible neighboring scene, or New scene when none remain. An empty story explains how to create the first scene.

### Beat controls

Each card has a clear drag handle and an Actions menu for Insert above/below, Duplicate, Move up/down, Collapse/expand, and Delete. Keep Add beat visible below the list. Do not surround every beat with a row of equally prominent buttons.

New or duplicated beats receive focus in their text editor. After a move, focus follows the moved beat. After deletion, focus goes to the next beat, previous beat, or Add beat. Deleting the final beat leaves a valid scene with its summary and an inviting empty state.

### Library controls

Each category has Add and each item has Inspect/Edit, Duplicate, Show usages, Archive, and Delete when allowed. Creating a character requires only a name; profile detail can grow while writing. Basic author-created profile editing belongs in the first authoring release. Editing protected imported canon uses its existing source-linked review workflow.

An inspector explicitly distinguishes **This scene/beat** from **Reusable profile/preset**. Removing a local character chip or stage token never deletes the global character. Removing a token also does not silently remove that character's dialogue or other references from the scene.

## 4. Editing and recovery rules

### Duplication

- Duplicating a scene creates a new scene identity and new beat identities, copies its summary/direction/local settings, and references the same global characters and versioned presets. Insert it immediately after its source, then let the writer move it.
- The duplicate starts as direction only. Accepted prose, candidate history, continuity approval, source fingerprints, and evidence/state updates are not silently copied. Recalculate entering context at its new position.
- Duplicating a beat copies text and local block instances with a new beat identity. It does not duplicate recorded continuity changes or their evidence links automatically.
- Duplicating a library entry creates a new reusable identity without changing existing references. A character copy does not inherit another character's accumulated relationships or scene knowledge.
- A stage has one opening-position token per named character. Placing Maya again moves her existing token rather than creating a second Maya. Separate anonymous extras and ordinary props may have multiple local instances.

### Deletion, archiving, and Undo

- Move scenes and populated chapters to recoverable project Trash. Keep their summaries, beat identities, prose/candidates, source paths, and prior positions available for restoration. Use transaction-safe workspace operations; never recursively delete an opened story folder through this control.
- Ordinary reversible deletions show Undo without an unnecessary confirmation dialog. Support undo/redo for scene and beat creation, duplication, movement, and deletion, with history that restores the whole operation.
- A beat referenced by recorded evidence needs reassignment or explicit removal of the affected assertion before deletion completes. Explain the actual reference rather than showing a generic warning.
- Used global entries are archived by default. Archived entries remain resolvable in existing scenes but are hidden from normal insertion lists. Deleting an unused entry is recoverable; permanently purging content is later work.
- Trash restoration preserves identity and returns to the prior valid location when possible; otherwise ask for a destination. Rebuild or invalidate affected continuity views on removal/restoration.
- Deleting an unaccepted AI candidate does not delete the current manuscript. Acceptance and recovery retain the existing reviewed-source/canon boundaries.

### Scope and save behavior

- Keep title, summary, beats, candidates, narration overrides, and stage state independent for every scene. Normal authoring changes autosave, with visible saving/saved/failed feedback backed by actual persistence.
- Rename references by stable identity; do not search-and-replace authored prose automatically. Changes to baseline guidance create a profile/preset revision; applying a changed reusable definition to existing scenes requires a usage-aware preview.
- Replacing or removing a referenced item must resolve its usages. Never leave a silent dangling reference or substitute a different character automatically.
- Delete/Backspace within editable text edits text. Structural deletion acts only on an explicitly selected object or its menu action. Keyboard access must not hijack normal writing shortcuts.

## 5. Delivery slices

These are slices of the existing milestones, not a replacement schedule.

1. **Authoring controls:** after the engine/schema spike, implement chapter/scene/beat create, inspect, edit, duplicate, move, and recoverable delete. Keep stable identities, switching buffers, evidence references, and undo/redo correct before styling those controls.
2. **Reusable library:** basic character creation/profile editing, preset/template editing, usage inspection, local-vs-global scope, archive/delete, and restoration. Optional physical layout remains independent of the writing loop.
3. **Playful treatment:** apply restrained skew/backings, deterministic asymmetric offsets, improved spacing, and Calm appearance to the working two-view interface. Preserve the accepted content hierarchy.
4. **AI candidate controls:** extend the AI milestone with candidate labels, comparison, editing, recoverable removal, and deliberate acceptance.
5. **Verification:** complete the acceptance checks below, then the existing compatibility/durability/release gates.

## 6. Acceptance checks

- Create a chapter and two scenes, open/edit each independently, duplicate one, reorder them vertically, move one to Trash, and restore it with its contents and identity intact.
- Create beats containing no characters, one character, and several characters; edit multiple paragraphs; duplicate/reorder/delete/undo without requiring actor forms or breaking evidence references.
- Create a character with only a name, expand its profile, inspect where it is used, and confirm that local emotion edits do not change its baseline. Archive a used character and keep old references readable.
- Rename a reusable preset, review its usages, and verify that scene snapshots change only through an explicit update operation. Remove a local chip without deleting the reusable entry.
- Exercise empty story, empty chapter, empty scene, long titles/summaries, long beat text, repeated character references, and archived/missing entries. Controls remain discoverable and errors preserve work.
- Inspect both views in light/dark appearance, Calm appearance, reduced motion, high text zoom, and narrow windows. Skew/asymmetry never causes overlap, misaligned carets, clipped menus, or ambiguous reading order.
- Complete all editing/reordering/recovery actions by keyboard, with focus following the affected object. Screen-reader labels announce object names, local/global scope, and action results.
- Reopen the workspace and verify real autosave, undo/recovery policy, and external-edit handling. The prototype's in-memory navigation checks alone do not satisfy this persistence gate.
