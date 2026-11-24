# Studio UI implementation

Approved reference: `outputs/tandnevis-studio.html`. Adopt its layouts and interactions while preserving production writing, persistence, generation, libraries, and creation workflows.

1. Document scope and retain the reference.
2. Align visual foundations and theme tokens.
3. Refresh the studio header and save feedback.
4. Replace alternating chapter cards with numbered narrative rows.
5. Present chapter scenes in a connected single-column list.
6. Reorganize the scene toolbar, title, settings, and writing surfaces.
7. Group writing tools behind shared search and progressive disclosure.
8. Add a unified Story Library drawer backed by existing full editors.
9. Compare editable source and generated proposals side by side.
10. Verify workflows, responsive layouts, native integration, and documentation.

Each numbered step is a separate commit with relevant behavior-test updates. No SQLite migration, simulated save status, replacement rich-text engine, or replacement generation service. Use existing scene summaries for chapter excerpts. Preserve manual Save, undo/redo, Trash, theme preferences, pending editor state, and creation return paths.

Validation: focused tests during implementation; full Vitest suite and production build; fresh desktop build and native workspace smoke; desktop/narrow and light/dark visual inspection; one mechanical design scan.
