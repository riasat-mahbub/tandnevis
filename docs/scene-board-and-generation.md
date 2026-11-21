# Scene board and generation revision

This revision supersedes the separate Scene tone row and plain summary textarea in the earlier global-block design. The scene writer is an editing surface, not a context preview page.

## Writer layout

- A compact top-left action row contains **Generate scene** and **Generate prose**. Both explain their disabled state until ChatGPT is configured in Settings.
- The editable scene title is followed directly by the **Scene summary** board. No tone selector or generation preview separates them.
- The summary accepts ordinary freeform text and the same draggable Character, Emotion, and Tone blocks as a beat.
- The ordered beat timeline follows the summary. Beat count belongs beside the beats heading. Existing Duplicate/Delete, drag handles, and keyboard move controls remain.
- Context preview and draft/prose review sit after the beat timeline.
- The shelf and local inspector remain supporting tools. Characters, Tones, and Emotions continue as full global library destinations.

There is no separate Scene tone control. A Tone block on the summary board supplies scene guidance; a Tone block in a beat overrides it for that beat. An Emotion block targets a character occurrence within its own board. Every board can have zero, one, or many characters. Old plain summaries and custom tone guidance remain editable after migration.

## Generation actions

**Generate scene** uses the summary and existing scene direction to propose additional editable beats. The output must use the supported rich document schema and referenced global IDs. Review the proposals before choosing **Accept beats**. Acceptance appends new beats in one undoable transaction and leaves existing beats and prose intact. Invalid, unfinished, or interrupted output cannot be added as beats.

**Generate prose** writes connected narration and dialogue from the summary and ordered beats. It may start from a nonempty summary without beats. The prose draft remains separate until accepted into Scene prose. Existing streaming, Stop, Copy, Discard, recovery, and stale-direction review remain available. One request runs at a time across both modes.

Only globals referenced in the selected scene's summary or beats, plus referenced character defaults, enter the request. Plain text names do not automatically attach profiles. A stored request snapshot preserves what was sent; later global edits do not rewrite that request or existing prose.

## Drag behavior and persistence

Shelf blocks must begin a native browser drag without cancelling pointer-down. Entire editable boards, including blank space, accept supported drops with feedback. Inline blocks also have drag handles. Moving a character carries its linked emotion; copying creates fresh occurrence identities. Orphan emotions are never silently reassigned.

SQLite schema 4 stores rich summaries in the project extension data and refuses older writers that could discard them. Manual Save remains the default; optional autosave and Save/Discard/Cancel close behavior apply to the summary, all beats, libraries, history, and drafts together.

The Scene sidebar includes a persistent New character action and optional Stock characters buttons. The app automatically supplies 18 tones and 24 emotions, with full definitions available in the libraries and local inspector. Back is the far-left header control. See [starter content](starter-content-ideas.md) for the full catalog and stock profiles. Live model output still requires account verification; offline tests verify context construction, structured response acceptance, and data safety.
