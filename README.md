# Shorthand Writer

A proposed local desktop writing application: each scene sits on a timeline and contains a scene idea/summary plus ordered beat cards. Beats are freeform text with optional reusable character, emotion, tone, and voice blocks, and can contain zero, one, or many characters. An optional stage provides physical placement. AI composes prose from that direction and the story's established context.

**Status:** development plan only; implementation has not started.

[Read the development plan](docs/development-plan.md).

## Agreed direction

- A separate software repository from the story vault.
- An Electron-style desktop app with a web interface.
- A vertical timeline of draggable scene blocks, with individual scenes opening in the scene writer.
- A main scene idea/summary box above each scene's beat cards.
- Ordered beat cards containing freeform text, with no required cast size or actor fields.
- Separate reusable, draggable character, emotion, tone, and voice/delivery blocks mixed with regular text.
- Optional stages; writing and generation work without a physical layout.
- Story-level narration defaults, with optional scene overrides.
- Human-authored shorthand, tags, scene direction, and character changes.
- AI primarily generates and revises prose.
- Open an existing local story project; preserve its editable Markdown sources.

The first compatibility target is the existing shorthand framework. Proposed technology, scope, and schema extensions are documented in the plan and remain subject to revision.

[Explore the scene writer design](outputs/scene-writer-studio.html). This is an interactive local prototype; application implementation has not started.

## Repository boundary

This repository will contain application code, documentation, and synthetic test fixtures. Story manuscripts, canon, API credentials, generated story drafts, and project-specific history belong outside the application repository.

No hosted service or GitHub remote is configured by this planning scaffold.
