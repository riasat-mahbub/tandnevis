# Global blocks and usable navigation

Status: proposed implementation plan, 20 November 2026. Documentation only. This supersedes the contextual character-manager navigation and preset interaction details in older interface documents. Story and Scene remain the two writing zoom levels; Characters, Tones, and Emotions become full project screens.

## 1. What the current interface gets wrong

The existing project toolbar mixes destinations (Characters, Trash, Markdown), commands (Save, Undo, Redo), and state. The character panel is inserted above the writing surface, and no profile details appear until a second selection. The scene library offers character insertion, while tone and emotion mostly live in text fields. Creating reusable blocks therefore has no complete path to using them.

These observations come from `src/App.tsx`, `ProjectPanel.tsx`, `SceneView.tsx`, and the current native captures. They do not establish that every reported control is broken: the plan includes verifying actual results, cancellation, focus, and feedback for each command.

### Reference that governs block behavior

Use `outputs/review/desktop-scene.png` and `mobile-scene.png`, plus the interactions in `outputs/scene-writer-studio.html`, as behavioral references:

- A Story library contains separate Characters, Emotions, and Scene tones groups.
- Character blocks are inserted among ordinary beat text.
- Emotion blocks remain separate visible chips, attached to an explicit character target.
- A tone block applies to the scene through a scene-tone target.
- Beats can have no characters, one character, or many characters.
- Scene and beat changes stay local; shared character definitions are reusable.

`outputs/review/verification.json` records prototype checks, including explicit local emotion targeting; it is not native-app verification. Retain the current Platinum/Harvest Orange palette and alternating timelines rather than reverting to the prototype's earlier colors or straight card stack. Delivery, Extras, and physical Stages shown there remain later scope; their absence must not block these three block types.

## 2. Navigation: screens and commands have distinct homes

The persistent app header contains the project menu/name, five text-labeled destinations, project save state/Save, and Settings. At desktop widths they share one aligned header; at 800px the destinations occupy a separate horizontal row containing only navigation. Remove the current mixed project-toolbar row.

| Destination | What fills the main workspace | What it remembers |
|---|---|---|
| Story | Existing chapter/scene timeline | Scroll, expanded chapters, selected scene |
| Scene | Existing scene summary, tone target, beat timeline, draft/prose | Selected scene, scroll, focused beat, insertion bookmark, reference selection |
| Characters | Full character library and profile editor | Search/filter, selected profile, editor scroll |
| Tones | Full reusable tone library and editor | Search/filter, selected tone |
| Emotions | Full reusable emotion library and editor | Search/filter, selected emotion |

Use real route/view state with one active destination. Visiting a library must not clear the selected scene or silently select another one. Scene returns to the last opened scene; before one is selected it explains "Open a scene from Story." An explicit Return to scene action in a library returns to that exact writer. No project: show the project welcome screen, with Settings available and project destinations unavailable with a readable reason.

The app header owns these commands in every project screen:

- **Save** / Ctrl+S saves the entire project working copy, including all three libraries. Status distinguishes Unsaved changes, Saving, Saved locally, and failure. Saving must not flash-disable the writing surface. Navigation inside a project never commits or discards work by itself.
- **Project menu:** New project…, Open project…, Import Markdown…, Export outline as Markdown…, and Trash…. Labels state actual operations rather than opening an unexplained "Markdown" panel. Import appends direction and retains source; export keeps its existing outline/beat-text contract. Do not imply that current export includes all accepted prose or is a lossless project backup.
- **Undo / Redo:** compact commands beside Save, with descriptive accessible labels and an unavailable reason. Preserve native text undo inside text editors; project undo applies outside them.
- **Settings:** full app screen for connection, appearance, Calm, and Autosave. Return restores the prior destination, not always Story.

Trash opens a dedicated project recovery screen from the Project menu, with its own heading, item type, original location, Restore, and clear empty state. It is a secondary destination, not a writing tab or a panel pushed above the manuscript. No permanent-purge control in this tranche.

Closing or changing project retains Save / Discard / Cancel. Switching between Story, Scene, and the three libraries needs no such interruption: all changes remain in the same working copy. No inert placeholder commands; an unavailable command explains why, and a successful command shows its result. Cancelling a native chooser leaves the current screen and edits intact.

## 3. Global means one definition, many local uses

For this tranche, global means **project-wide**, available in every scene of the current `.shorthand` project. It does not mean a shared database across unrelated projects. Cross-project library import/export can be added later without coupling manuscripts.

| Global definition | Minimum creation fields | Optional useful fields | Where used |
|---|---|---|---|
| Character | Name | Background, personality, default tone/attitude, baseline voice, default emotion | Character blocks in any beat |
| Tone | Name | Meaning, writing guidance, short example | Scene-tone block; character default tone where explicitly selected |
| Emotion | Name | Meaning, expression guidance, short example | Emotion block targeting a character occurrence; optional character default emotion |

An emotion describes what a character feels; a tone describes the attitude or treatment of the writing. Voice describes how the character habitually sounds. Examples: Awe is an emotion, Tender is a scene tone, and clipped sarcastic sentences describe a voice. Keep freeform guidance available; none of these definitions requires a prescribed vocabulary.

Each definition has a stable ID, revision, and archived flag. References resolve by ID; renaming never searches/replaces prose. Definitions are live variables: changing shared guidance affects future context in every scene that uses it. Show "Shared across this project" and actual usages in the editor. Local overrides do not edit the global definition.

Do not introduce a mandatory publish/apply-everywhere workflow for ordinary variable edits. The global editor makes the reach explicit. Existing generated text stays unchanged, and stored generation request snapshots remain immutable. A draft becomes outdated if the resolved guidance it actually used changes. Unrelated library edits must not mark every draft outdated.

## 4. Full library screens

Each library uses the entire workspace as a stable two-column layout: a searchable list on the left and a generous detail editor on the right. These are full destinations, not modal forms or overlays over Story. Do not force the user through a separate details drawer before they can write.

Shared structure:

1. A clear page heading, one sentence of purpose, and **New character / New tone / New emotion**.
2. Search by name and an Active / Archived filter. Use alphabetical order initially; preserve selection while filtering. Search does not modify data.
3. A list row with name, short guidance excerpt, and selected/archived state. Use actual project content, not dashboard statistics or fictional starter profiles.
4. A selected definition editor with Name first, then the small set of relevant fields. Only Name is required. A block preview shows exactly how it will appear in a scene, without creating an occurrence.
5. Visible Duplicate and Archive/Restore actions. A Used in section links to real scenes and beat occurrences or character defaults. Select the first active item on first entry, restore the last selection thereafter, and immediately select/focus a newly created item.

Characters use labeled multiline fields for background, personality, and baseline voice; default tone/emotion selectors link to their global definitions and allow None. A compact summary of default guidance stays visible while editing long background text. Do not put scene-only changes in this editor.

Tones and Emotions use Name, Meaning, Guidance, and an optional Example. Keep the screen comfortable with few items; do not fill unused space with fake analytics. Library empty states explain the block's use and provide the creation button. A filtered empty state says no matches and offers Clear search, without pretending the library is empty.

Used definitions are archived instead of deleted; archived definitions remain resolved in old scenes and are omitted from new-insertion lists. An unused definition can move to Trash, with Undo and identity-preserving Restore. Usage checks include active scenes, trashed scenes, and character defaults so restoring a scene never produces dangling references. Permanent deletion is deferred.

## 5. The missing destination: the scene block shelf

Full library screens are for defining blocks. **Scene keeps a compact, searchable Story library on the left for using those blocks while writing.** Show Characters, Emotions, and Tones as clearly labeled groups, following the review reference. For large libraries, search/filter limits results without hiding the category or its Manage link. A character chip is a reusable block, not an implicit navigation button.

Every block has a readable name, type label/icon, drag affordance, tooltip summary, and keyboard/click alternative. Manage characters / Manage tones / Manage emotions open the corresponding full screen and remember the scene return location. New… opens that same screen in create mode; returning makes the saved-in-session definition immediately available on the shelf, even before manual project Save.

### Character blocks

- Drag to a text caret in any beat, or focus the beat and click/keyboard-activate a character block. Preserve the insertion bookmark while using shelf controls.
- Create a new local occurrence ID for every insertion, even for the same character twice in one beat. Show only the readable character name in the text; the stable ID resolves the profile and defaults.
- Reject drops outside a beat; do not insert serialized payloads into the manuscript. If there is no selected beat for click insertion, explain "Select a beat to insert this character" rather than inserting somewhere arbitrary.

### Emotion blocks

- Drag an emotion **onto a specific character block in a beat**. Show the target's name and highlight that occurrence before drop. Insert a separate adjacent emotion chip linked to that occurrence ID, as in the review reference.
- For click/keyboard use, select the character occurrence first, then activate the emotion block. The inspector states e.g. "Awe → Damian · Beat 3 · this occurrence only."
- If a beat contains multiple character occurrences and none is selected, ask which occurrence in a compact target picker. Include surrounding text snippets when a character occurs twice. Do not target the first match, every character, or every occurrence with the same name.
- With no character target, explain how to add/select one. Character-free beats remain valid; an emotion target is never required to write or generate a scene. Do not infer a feeling for an environment or convert an emotion into a scene tone.
- An emotion changes this occurrence only. It does not persist into later beats, later appearances of the character, or the shared profile. Existing freeform local emotion notes remain supported alongside presets.

### Tone blocks

- Provide a labeled **Scene tone** drop target above the summary, with an empty-state hint and a small choose-block control.
- Drag a tone there or activate a tone on the shelf to apply it to the current scene. Replace the previous scene-tone reference in one undoable operation; show the applied name and Remove action. The inspector says "This scene."
- The first implementation follows the reference's scene-wide tone behavior. Dropping a tone into beat text is not a supported local-tone operation; show the scene-tone target instead of silently changing another scope. Beat-level tone ranges can be designed later.
- Selecting a tone as a character default is a separate, explicit action on the Characters screen. A scene tone influences narrative treatment; it does not erase character voice or automatically rewrite every character's attitude.

### Inspect, detach, move, and remove

Selecting a local block shows its resolved global guidance, explicit scope/target, and **Edit shared definition** link. That link opens the full library screen with the correct item selected and retains a return bookmark. The inspector's local fields never silently update the shared definition.

An emotion chip remains its own selectable block even when displayed next to its character. One emotion preset per character occurrence, with optional local guidance. Replacing it is one Undo operation; removing it restores the character default if present. Removing a character block removes its linked local emotion blocks in the same operation, preserves ordinary authored text, and is undoable. Never retarget an orphan to a neighboring character.

Moving/copying the character-and-emotion group preserves or rewrites the occurrence links as appropriate. Beat/scene duplication creates new local occurrence IDs and remaps their targets while keeping the shared definition IDs. A plain-text copy stays readable; structured copy within the app retains valid references. Unknown/malformed drops change nothing and produce a clear explanation.

## 6. Concrete infirmary workflow

1. Characters: define Maya's background, personality, default serious attitude and voice; define Damian's usual hostile/serious attitude. No scene-specific admiration is stored in his global profile.
2. Emotions: define Serious, Awe, Angry, Embarrassed. Tones: define Tender. These are editable reusable blocks, not hardcoded choices.
3. Open Stitches in Scene. Drop Tender onto Scene tone. Keep the summary above the freeform beats; optional School infirmary staging remains independent.
4. Beat 1 can describe the empty infirmary with no blocks.
5. Beat 2: insert Maya and Damian among the text. Attach Serious to Maya's occurrence if an explicit local override is wanted; it is optional when her baseline already supplies it.
6. Beat 3: attach Awe to Damian's occurrence and Angry to Maya's. Beat 4 can reuse Awe for a new Damian occurrence and Embarrassed for a new Maya occurrence. The two characters' emotions never bleed into one another.
7. Inspect context: only this scene, its ordered beats, its selected tone, referenced character profiles/defaults, and targeted emotion definitions are included. Generate one scene; Accept changes prose, leaving beat direction intact.
8. Save commits the scenes and shared definitions together. Switching to another scene offers the same blocks but none of the previous scene's local overrides.

## 7. Visual and accessibility direction

Preserve Platinum `#E5EBEA` as the default page, pale editing surfaces, Iron Grey `#435058` text, and Harvest Orange `#FF7700` for the active destination, focus-adjacent accents, and primary actions. Block type is identified by text/icon, not an unrelated three-color palette. Keep Georgia for prose and the platform sans for navigation/forms.

The library list is narrower than its editor; the Scene shelf is narrower than the writing column. This useful asymmetry is the composition. Restrained skew belongs on an optional heading backing or block preview, never the navigation, text caret, inputs, or drop target. Calm removes those transforms.

At 800px or high zoom, library list/detail becomes a full-width list with a full-width detail view and Back to list. Scene offers an explicit Insert blocks drawer so the shelf does not consume the writing width; keep the selected caret/target when it opens. Do not stack the entire global library above the manuscript as in the narrow prototype. No horizontal page overflow; long names wrap or expose a full accessible label.

Navigation, definition selection, insertion, targeting, duplication, archive/restore, and local removal all work without dragging. Dialogs/pickers manage focus and Escape. Returning from global editing restores the writer's caret when valid; if its beat was removed, focus the nearest surviving beat and explain. Save/status has a stable width, no autosave-induced control flashing, and restrained live announcements.

## 8. Native and generation contract

- Add SQLite tone and emotion definition entities, character default-reference fields, a scene-tone reference, and separate emotion rich-text nodes targeting stable character occurrence IDs. Domain operations own create/update/duplicate/archive/trash/restore and reference validation. Frontend does not run SQL.
- Migrate existing character references by assigning distinct occurrence IDs. Preserve existing emotion/delivery strings exactly as local guidance. Keep old scene-tone strings as custom tone guidance until the writer explicitly chooses a preset. Do not synthesize duplicate global definitions from repeated strings.
- Extend full manual save, optional autosave, history snapshots, Trash restoration, project validation, and rich-text clipboard handling for all new entities/nodes. Existing projects with no presets open unchanged. Existing manual/close behavior stays in force.
- Resolve presets and profiles in Rust from the current working database; build the same human-readable preview in TypeScript. Include only referenced definitions and distinguish scene tone, character defaults, and local overrides in the request.
- Defaults apply when the occurrence has no override for that dimension; an emotion override does not erase voice or tone. Existing narration instructions remain separate guidance. Do not claim an emotion is inferred canon or persistent state.
- Generation snapshots include the resolved definition values/revisions. The fingerprint changes when relevant guidance, targets, or order changes. Archived references still resolve; a missing target/definition is visibly unresolved and blocks sending incomplete context until repaired, without losing editable text.
- History migration must tolerate old undo entries without the new fields. Duplicating a preset creates a fresh global identity; duplicating scene/beat content creates fresh local identities. Schema/version limits and rollback remain enforced.

## 9. Commit-sized delivery

| Step | Commit intent | Reviewable result |
|---|---|---|
| G1 | `refactor: separate project navigation from commands` | Full destination routing, stable header/Save, labeled Project menu, Settings return, Trash recovery route; remove mixed toolbar and duplicate character-panel entrances |
| G2 | `feat: add shared tone and emotion definitions` | SQLite/domain migration, typed operations, defaults, history/Trash/full-save support, and backward-compatible references |
| G3 | `feat: add full character tone and emotion screens` | Real list/detail screens with search, creation, editing, previews, usages, duplication and archive/restore; selected definition and return navigation persist |
| G4 | `feat: insert reusable blocks with explicit scene targets` | All three shelf groups, scene-tone drop target, separate linked emotion blocks, caret insertion, keyboard/picker alternatives, local inspector and safe removal/duplication |
| G5 | `feat: resolve shared blocks in scene generation context` | Matching Rust/TypeScript context, default/override resolution, relevant fingerprints, immutable previous drafts, clear unresolved-state handling |
| G6 | `test: verify global block authoring and navigation` | Native complete workflow, keyboard/narrow/theme review, migration/reopen/Save checks, and updated docs; update only the single `out/latest` release |

G1 keeps the existing usable Characters implementation as a full screen while native presets land; release notes must distinguish that intermediate state. No placeholder Tones/Emotions buttons in a shipped build. Deliver the full creation-to-insertion path before calling the tranche complete. Tests target behavior and data safety; documentation planning alone runs no implementation tests or builds.

## 10. Acceptance

- From an open project, identify Story, Scene, Characters, Tones, Emotions, Save, project import/export, Trash, and Settings without opening unrelated panels.
- Create one of each global definition, use it in two scenes, rename it, and verify both references resolve without rewriting prose or local overrides. Switching screens preserves unsaved library and scene edits.
- Reproduce the infirmary example with zero-character and multi-character beats. Insert the same character twice in one beat and give only one occurrence Awe. Copy/duplicate/move/undo retains the intended targets.
- Character, emotion, and tone blocks each have a real insertion destination and a complete click/keyboard alternative. Unsupported drops do not insert JSON, change unrelated guidance, or silently succeed.
- Inspect an inline emotion as a separate block; edit/remove its occurrence without editing/removing the global Emotion definition. Removing a character and Undo restores all linked blocks correctly.
- Archive a used definition, restore a scene from Trash, and verify the references remain readable and generatable. Delete an unused definition and restore it with the original identity.
- Manual Save persists all libraries, defaults, occurrences, and scene tone; failed Save retains work. Autosave remains optional. Native close still supports Save / Discard / Cancel.
- Generate from one scene: include referenced globals once with correct local targets, omit unrelated definitions/other scenes, and mark only affected drafts outdated after global edits.
- Run each visible project command with realistic content, cancellation and error cases. Every action navigates, edits, opens a chooser, or reports a result; explain disabled states instead of leaving unexplained no-ops.
- Verify active navigation, long names, empty/filter/archived states, focus return, 800px minimum window and high zoom, both themes, Calm, and reduced motion. Preserve both alternating timelines.
