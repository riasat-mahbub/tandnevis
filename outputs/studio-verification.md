# Studio redesign verification

Implemented the approved layouts and interactions from `tandnevis-studio.html` in ten commits, retaining the React/Tiptap editors, native SQLite project format, and generation services.

## Checks

- `npm test`: 19 files, 167 tests passed, including shared block search, insertion, drawer search/dismissal/focus, creation return paths, generation review reopening, pending edits, and navigation restoration.
- `npm run build`: passed (also run by the desktop build).
- `npm run desktop:build -- --no-bundle`: passed; executable at `src-tauri/target/release/shorthand-writer.exe`.
- `npm run native:smoke -- --workspace`: passed against the final Windows executable. The isolated SQLite fixture exercises a real Chromium reference drag/drop, inline references, native beat movement, character-wizard cancellation, outline navigation, library return, manual Save, and native close.
- Native layout checks at 1440, 800, and 390 pixels found no document overflow; the drawer also passed its own overflow checks. Light and dark captures cover the writing surface and collapsed/expanded tools.
- A local React preview with a synthetic recovered prose draft confirms two review columns at 1440 pixels and stacked source/proposal at 390 pixels, with editable source and no horizontal overflow.
- The Impeccable mechanical scan reported four existing accent-border declarations in unrelated rules in `src/styles.css`; no new findings on the studio components or workspace stylesheet.
- `git diff --check`: passed.

## Visual evidence

- [Story chapter rows](studio-review/workspace-story-chapters.png)
- [Chapter scene list](studio-review/workspace-chapter-timeline.png)
- [Desktop writing](studio-review/workspace-scene-light-1440.png)
- [Narrow writing](studio-review/workspace-scene-light-390.png)
- [Dark writing](studio-review/workspace-scene-dark-1440.png)
- [Library drawer](studio-review/workspace-library-drawer-desktop.png)
- [Narrow library drawer](studio-review/workspace-library-drawer-narrow.png)
- [Side-by-side prose review](studio-review/prose-review-1440.png)
- [Stacked prose proposal](studio-review/prose-review-390.png)
- [Native smoke report](studio-review/native-report.json)

## Scope and limits

All visual evidence uses synthetic story content. No live ChatGPT request was made. Generation streaming, recovery, acceptance, outdated-draft acknowledgement, copy, retry, and discard are covered by the existing service/component tests. The native smoke substitutes a known path for the OS file chooser; manual chooser interaction is outside that check. No persistence migration or Rust service changes were required.

The build still emits its existing large-JavaScript-chunk warning and two Rust dead-code warnings.
