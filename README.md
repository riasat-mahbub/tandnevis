# Shorthand Writer

A local desktop writing application: each scene sits on a timeline and contains a scene idea/summary plus ordered beat cards. Beats are freeform text with optional character references and local emotion/delivery, and can contain zero, one, or many characters. The full plan adds reusable direction blocks, optional physical stages, and AI prose generation.

**Status:** the first desktop authoring tranche is implemented: native SQLite projects, Story/Scene timelines, freeform beat editing, character references, recoverable editing controls, and Markdown interchange. [Implementation progress](docs/implementation-progress.md) records verification and remaining features, including AI generation and physical stages.

**Implementation target:** Tauri 2 desktop, React/TypeScript frontend, and Rust backend. A local SQLite project database is the canonical store, accessed only through Rust domain commands. Markdown is explicit import/export interchange; there is no live two-way Obsidian sync. Ordinary authoring works offline.

[Read the development plan](docs/development-plan.md).

## Run the desktop app

With Node 22.12+, Rust 1.90+, and the [Windows desktop prerequisites](docs/development-setup.md) installed:

```powershell
npm ci
npm run desktop:dev
```

Use `npm run desktop:build` to build the Windows executable and installer. `npm run dev` opens only the renderer; native project access requires Tauri. See [development setup](docs/development-setup.md) for the local toolchain, checks, native smoke runner, and Markdown interchange limits.

[Read the detailed Tauri implementation plan](docs/tauri-implementation-plan.md): architecture, entities and storage, native command contracts, editor/drag-and-drop implementation, AI jobs, recovery, packaging, and milestone acceptance gates.

[Read the next interface plan](docs/interface-plan.md): playful skew/asymmetry, complete editing controls, library management, and recoverable removal.

[Read the installation and connected AI plan](docs/install-and-ai-plan.md): Windows install/setup scripts, subscription-aware sign-in, the Scene Generate workflow, and commit-sized implementation steps.

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
- Create/open a native local SQLite project containing stories, chapters, scenes, freeform beats, profiles, presets, revisions, and recoverable Trash.
- Import/export Markdown deliberately, preserving imported source material and reporting compatibility limits; external Markdown edits never silently overwrite the native project.

The first compatibility target is the existing shorthand framework. Native authoring comes first; legacy parser/replay parity, advanced AI, and production signing remain later milestones with their own acceptance gates.

[Explore the scene writer design](outputs/scene-writer-studio.html). This is an interactive local prototype, separate from the desktop implementation.

[Try the playful interface preview](outputs/scene-writer-playful.html): asymmetric scene blocks, skewed backings, Calm appearance, scene/beat actions, Trash/Undo, and basic character profiles.

## Repository boundary

This repository will contain application code, documentation, and synthetic test fixtures. Story manuscripts, canon, API credentials, generated story drafts, and project-specific history belong outside the application repository.

No hosted service or GitHub remote is configured by this planning scaffold.
