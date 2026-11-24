# Compile Book implementation plan

Reference: [tandnevis-compile-studio.html](tandnevis-compile-studio.html), retained from the supplied Downloads file. The reference is an interactive concept with sample data, not production export code.

## Delivered first: library placement

- Move Story Library from the header to a 78px left utility rail, with Story overview at the top and the library at the bottom.
- Open the existing drawer from the left beside the rail. Preserve the 800px maximum width so the existing definition editors have room.
- At 780px and below, use a bottom utility bar and a full-width drawer above it. Reserve content space and account for the bottom safe area.
- Keep the existing search, editors, creation workflows, modal focus behavior, scene caret, manual Save, and pending edits. Keep Project, Settings, Undo/Redo, and save feedback in the header.

Compile Book is planned below. Do not display a placeholder export button before the dialog and file-writing path work.

Library relocation verification: all 167 existing tests pass, including drawer search, caret/focus restoration and creation return paths; `npm run build` passes with the existing bundle-size warning. A Chromium preview with synthetic content confirms the rail and drawer fit at 1440, 800, 780, 390 and 320px, dismissal returns trigger focus, and Story navigation preserves the mounted scene editor. Light/dark desktop and narrow screenshots were inspected. The mechanical design scan returned no findings for the changed UI files. Native packaging and export behavior were not exercised in this layout-only change.

## User flow and options

Add **Compile Book** below Story Library in the utility rail once implemented. It opens a native modal dialog with options on the left, a manuscript preview on the right, and counts plus Export/Close in the footer. Narrow windows stack the options above the preview. Escape/Close returns to the originating canvas and trigger without remounting editors.

Default scope follows the current writing canvas: entire story, current chapter, or current scene. Opening from Settings, Trash, or a creation workflow defaults to the entire story. Store selected chapter/scene IDs, not array positions; changing chapters resets an invalid scene selection. Preserve formatting choices within the current project session and reset scope/IDs when switching projects.

| Option | Behavior |
| --- | --- |
| Scope | Entire story, one chapter, or one scene; chapter and scene selectors appear as needed. |
| Format | Markdown, plain text, HTML; PDF follows a native feasibility check. |
| Title page | Optional; initially off. Use the selected scope's title. No invented author field. |
| Contents | Optional; initially off. Available for story/chapter scopes; include only exported chapters/scenes. |
| Scene titles | Optional; initially off. Single-scene output already uses the scene title. |
| Scene separator | `* * *` by default, extra paragraph space, or none. Disabled for a single scene. |
| Empty prose | Skip by default; alternatively include a labeled placeholder or require every selected scene to have prose. Whitespace-only prose is empty. |

Use chapter array order and each chapter's `sceneIds` order, independent of scene storage order. Skip chapters with no included scenes. Preserve original chapter numbers when empty chapters are skipped. Show included versus selected scene counts, written-prose word count, and a clear warning for unfinished scenes. Placeholders do not count as written words. Disable export when nothing would be included, or when “require every scene” has missing prose. A selection containing only empty scenes may export only when placeholders are explicitly chosen.

## Content and state contract

Compile only the current `Scene.prose`, including manually written prose and accepted drafts. Summaries, beat direction, inline library definitions, generation instructions, Trash, and unaccepted or streaming proposals never enter the manuscript. Compilation does not call ChatGPT or accept drafts.

The production prose field is plain text (`src/services/project.ts` and `SceneProseEditor.tsx`). Do not copy the concept's HTML-to-text parser: literal text such as `<script>`, Markdown punctuation, ampersands, Unicode, and line breaks must survive compilation. Escape text only when serializing to HTML or Markdown; render previews with React text nodes. Preserve paragraph and within-paragraph line breaks, normalize CRLF/LF deliberately, and define word counts consistently as whitespace-delimited tokens.

Opening the dialog waits for `workspace.flush()` and then clones the acknowledged current project into an immutable compilation snapshot. This includes queued prose edits without implicitly saving the project to disk. A queue/recovery error prevents compilation and offers the existing recovery path. Preview, counts, and exported files all derive from that same snapshot. If project content changes while the dialog is open, show that the snapshot is older and offer **Refresh preview**; do not silently export different content from the preview. A refresh flushes again. Closing or switching the project clears the snapshot. A generation proposal that has not been accepted cannot affect it.

## Implementation sequence

1. **Pure manuscript assembly.** Add `src/services/compile.ts` with typed scope/options, ID validation, ordered chapter/scene selection, empty-scene policy, counts, and a structured manuscript model. No React, filesystem, generation dependency, or SQLite migration. Test shuffled scene storage, reordered chapters/scenes, missing selections, empty chapters, whitespace-only prose, placeholder-only output, Unicode and paragraph fidelity, and excluded non-prose content.
2. **Serializers and preview.** Add Markdown, TXT, and escaped standalone HTML serializers from that model. Use the same model for `ManuscriptPreview`; preview shows content rather than promising exact page breaks. Validate literal markup and Markdown escaping, contents consistency, scope headings, scene breaks, line endings, and agreement between selected/included counts and serialized output. Avoid raw HTML insertion.
3. **Desktop export gateway.** Add a separate compile gateway rather than changing the existing outline interchange. Use the existing Tauri Save dialog pattern with format filters and a sanitized default filename; append an extension if absent and reject mismatched extensions. Add an appropriately scoped Rust command/permission for writing the assembled UTF-8 document, using safe replacement for existing files. Canceling the chooser is silent; write failures leave the dialog and preview intact for retry. Success is reported only after the write finishes and includes the actual destination. Check the project session/snapshot again after the asynchronous chooser before writing. Test write failure, overwrite, cancellation, Unicode paths, and project switching.
4. **Compile dialog and rail entry.** Add `CompileDialog.tsx`, options, preview, counts, empty/loading/error states, and the working rail action. Keep authoring editors mounted. Give the modal a name, keyboard-accessible controls, native focus trapping and focus restoration. Add Ctrl/Cmd+Shift+E only with the working action, guarded against other dialogs. Verify latest queued prose is included without Save, changes require explicit refresh, and no generation or project-write side effects occur.
5. **PDF feasibility and delivery.** Spike a real PDF path in the packaged Windows Tauri/WebView2 app. The reference uses `window.print()` and a browser save-as-PDF dialog; confirm print availability, stylesheet isolation, completion/cancellation, multipage content, fonts/Unicode, and restoration of the compile dialog. If supported, label the action **Print / Save PDF** and do not claim a successful PDF save merely because printing was invoked. If unavailable, decide on a native PDF implementation before exposing PDF; Markdown/TXT/HTML can ship independently. Keep export styles separate from app chrome and dialog visibility.
6. **Verification and documentation.** Exercise compilation with native project data, real Save dialogs and file contents, all scopes/empty policies, cancellation, failed writes, recovery errors, and an accepted versus unaccepted draft. Check light/dark desktop and narrow layouts, large manuscripts, long titles, independent scrolling, focus return, pending edits, and normal Save/Undo. Run focused compiler/serializer/gateway/dialog tests, the full suite, production build, and native smoke after native changes. Document delivered formats and PDF limitations in README only when implemented.

Each step should be a reviewable commit with the relevant checks. Keep **Project → Export outline as Markdown...** unchanged: it exports outline/beat interchange; Compile Book assembles written manuscript prose. DOCX/EPUB, AI rewriting, live sync, typography presets, and automatic project Save are outside this first version.
