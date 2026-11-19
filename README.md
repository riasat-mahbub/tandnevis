# Shorthand Writer

A proposed local desktop writing application: each scene sits on a timeline and contains a scene idea/summary plus ordered beat cards. Beats are freeform text with optional reusable character, emotion, tone, and voice blocks, and can contain zero, one, or many characters. An optional stage provides physical placement. AI composes prose from that direction and the story's established context.

**Status:** development plan only; implementation has not started.

**Implementation target:** Tauri 2 desktop, React/TypeScript frontend, and Rust backend. Markdown/manifests remain the local story source; cloud AI is optional during ordinary authoring.

[Read the development plan](docs/development-plan.md).

[Read the detailed Tauri implementation plan](docs/tauri-implementation-plan.md): architecture, entities and storage, native command contracts, editor/drag-and-drop implementation, AI jobs, recovery, packaging, and milestone acceptance gates.

[Read the next interface plan](docs/interface-plan.md): playful skew/asymmetry, complete editing controls, library management, and recoverable removal.

## Agreed direction

- A separate software repository from the story vault.
- A Tauri full-stack desktop app with a React/TypeScript UI and Rust application backend.
- Two views at two zoom levels: a whole-story overview with a vertical timeline of draggable scene blocks, and an individual scene writer retaining its accepted design.
- Open any scene to edit it; return to the overview while preserving its independent edits and timeline position.
- A main scene idea/summary box above each scene's beat cards.
- A matching vertical timeline of freeform beat cards inside each scene, alternating left/right when space allows, with no required cast size or actor fields.
- Drag-and-drop reordering for both scenes and beats, with keyboard equivalents and before/after drop targets.
- Directly visible Duplicate/Delete quick actions on scene and beat blocks, with Trash/Undo recovery.
- Separate reusable, draggable character, emotion, tone, and voice/delivery blocks mixed with regular text.
- Optional stages; writing and generation work without a physical layout.
- Story-level narration defaults, with optional scene overrides.
- Human-authored shorthand, tags, scene direction, and character changes.
- AI primarily generates and revises prose.
- Open an existing local story project; preserve its editable Markdown sources.

The first compatibility target is the existing shorthand framework. Proposed technology, scope, and schema extensions are documented in the plan and remain subject to revision.

[Explore the scene writer design](outputs/scene-writer-studio.html). This is an interactive local prototype; application implementation has not started.

[Try the playful interface preview](outputs/scene-writer-playful.html): asymmetric scene blocks, skewed backings, Calm appearance, scene/beat actions, Trash/Undo, and basic character profiles.

## Repository boundary

This repository will contain application code, documentation, and synthetic test fixtures. Story manuscripts, canon, API credentials, generated story drafts, and project-specific history belong outside the application repository.

No hosted service or GitHub remote is configured by this planning scaffold.
