# Compile Book verification

Implemented the retained [compile reference](tandnevis-compile-studio.html) and [implementation plan](compile-implementation-plan.md) with six GPT-6 Luna subagents at maximum reasoning, coordinated by the root agent. Delivered Markdown, plain text, and standalone HTML. The existing outline Markdown interchange remains separate.

## Behavior

- The utility rail opens a modal compilation workspace with story/chapter/scene scope, formatting options, counts, unfinished-scene policies, and a content preview. Ctrl/Cmd+Shift+E is guarded against other dialogs.
- Preview and export share a cloned, ordered manuscript snapshot. Opening/refreshing waits for queued edits without implicitly saving the project file. Later changes require Refresh preview. Session/revision checks after the Save chooser prevent writing from a changed project.
- Only scene prose enters the manuscript. Summaries, beats, definitions, generation instructions, deleted writing, and unaccepted proposals are excluded. Literal markup is text; HTML and Markdown escaping are format-specific.
- The desktop Save gateway handles filenames/extensions, cancellation, errors, and success feedback. A scoped Rust command writes UTF-8 through a temporary file and safely replaces an existing destination on Windows. Failed writes retain the preview for retry.
- Closing compilation restores trigger focus and preserves the mounted writing editor. Formatting preferences last within the project session and reset across projects.

## Checks

- `npm test -- --maxWorkers=2`: 24 files, **199 tests passed**. The initial unrestricted run exposed new test timing/fixture assumptions and test timeouts under concurrent builds; those assumptions were corrected, and the final complete suite passed.
- `npm run test:rust`: **90 passed, 1 existing ignored**, no failures. Includes compiled-file overwrite at a Unicode path, failed replacement cleanup, and native path validation.
- `powershell -NoProfile -ExecutionPolicy Bypass -File scripts/package-portable.ps1`: passed. This runs the production frontend and optimized Tauri release builds and refreshes `out/latest`.
- `node tools/native-smoke.cjs --compile --exe <isolated copy of final portable executable>`: passed. The copy and portable marker used an isolated data directory beneath `.tools`; user `out/latest/data` was not used by the smoke test.
- Native smoke exercised current queued prose without Save, immutable/stale preview refresh, all scopes and unfinished-scene policies, definition/direction exclusions, Markdown overwrite, native TXT write failure and retry, silent chooser cancellation, HTML escaping, focus/editor restoration, manual Save, and normal native close.
- Native light/dark captures at 1440, 800, 780, and 390px found no horizontal document overflow; the dialog stays within the viewport and switches to stacked options/preview on narrow windows. Separate Chromium checks also verified 320px and trigger focus restoration. Desktop/narrow screenshots were reviewed.
- The Impeccable detector returned no findings for the changed application/dialog/preview files. `git diff --check` passed.

The build retains the existing large-JavaScript-chunk warning and two Rust unused-code warnings.

## Portable artifacts

- Application: `out/latest/Shorthand Writer.exe`
- Archive: `out/latest/Shorthand-Writer-latest-win-x64.zip`
- Checksum: `out/latest/Shorthand-Writer-latest-win-x64.zip.sha256`
- Executable SHA-256: `4c629a71ce38b2b65a17830345bb71c7ccfabe13dc08ecf9154b7d01f21596a7`
- Archive SHA-256: `798df9da78c29a0ab5015c8c59c135b5ec22889abbcb1abdca7d12666ad429c3`

Verified the packaged executable matches the release executable, the archive checksum matches its sidecar, and the ZIP contains only the executable, `portable.mode`, and README. The packaging script preserves existing portable data and separately saved projects.

## Evidence and limits

- [Native report](compile-review/native-report.json)
- [Desktop light](compile-review/compile-light-1440x960.png), [desktop dark](compile-review/compile-dark-1440x960.png)
- [Narrow light](compile-review/compile-light-390x844.png), [narrow dark](compile-review/compile-dark-390x844.png)
- [PDF feasibility](compile-pdf-feasibility.md)

The native export smoke substitutes deterministic chooser results to exercise cancellation, failure, retry, and overwrite; the real Rust writer and resulting files are tested. Windows OS Save dialog interaction itself was not automated. No live ChatGPT request was made. Native PDF completion/cancellation and manuscript PDF output remain unverified, so PDF is not exposed in this version. Exported HTML can be printed separately in a browser.
