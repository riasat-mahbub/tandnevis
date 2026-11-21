# Global blocks: UI design brief

Scene layout update: [Scene board and generation revision](scene-board-and-generation.md) replaces the standalone Scene tone control with a Tone block on the rich summary board. It puts title and summary together above the beats, with Generate scene and Generate prose at the top left. The global library screens and shared color system remain unchanged.

Status: implemented design direction, 20 November 2026. Read alongside [the behavior and delivery plan](global-blocks-and-navigation-plan.md) and [implementation progress](implementation-progress.md). This brief records the intended interface; the progress ledger records verified behavior and remaining limits.

## Design intent

A quiet, light writing workspace with a useful block library always within reach. Writers should understand three things immediately: where they are, whether they are editing shared guidance or a local use, and where to place a block. The main writing area gets the most space; the application frame stays stable while content changes.

The current desktop app supplies the Platinum/orange identity, freeform editing, and alternating timelines. `outputs/review/desktop-scene.png` supplies the behavioral reference for the shelf, separate character/emotion blocks, and scene-tone target. Its mobile capture exposes a layout to improve: stacking the entire library before the manuscript makes the writer scroll past tools before reaching the scene.

## The app frame

At a typical desktop width, the top bar reads from left to right:

**Project ▾ · Maya & Damian** — **Story · Scene · Characters · Tones · Emotions** — **Undo / Redo · Unsaved changes · Save · Settings**

These are logical groups with generous separation. Navigation items are flat text tabs with an orange underline on the active destination and a readable Iron Grey label. They do not look like independent primary-action buttons. Project opens a conventional labeled menu. Save is the orange action when changes are waiting; Saved locally is a quiet, stable-width status. When there is nothing to save, Save is inactive with an accessible explanation. Settings is a labeled utility action.

There is no second strip of Characters, Trash, Markdown, and Save. The project name has a readable truncation point; its full name is accessible. At intermediate widths, the five navigation labels move intact onto a row below the project utilities. They do not turn into unlabeled icons or a scroll-dependent collection of controls.

Opening Project shows New project…, Open project…, a separation, Import Markdown…, Export outline as Markdown…, and Trash…. Descriptions clarify the import/export scope in the relevant flow. No generic Markdown button that first opens an unrelated panel. The Settings screen returns to the destination the writer came from.

## Story: arrange the shape

The first focal point is the story title and **New scene**. Chapters and the alternating scene timeline occupy a centered workspace with room on both sides. Scene titles, short summaries, tone chips, and beat counts provide enough context to choose a scene. The central timeline and reading order remain straight and obvious.

Scene cards keep visible drag handles, Duplicate, and Delete. Small move controls provide a keyboard alternative. A light backing can have a restrained angle; the text, tools, and connectors stay aligned. Chapter commands sit with the chapter they affect. The library is not permanently pinned beside the Story timeline.

Opening a scene changes the active destination to Scene. Returning to Story restores the prior timeline position. Empty Story shows one Create your first scene action and a short explanation; it does not ask for character or emotion setup first.

## Scene: compose with blocks

At 1440px, use three unequal regions: an approximately 210–230px block shelf, a flexible writing area, and an approximately 240px inspector. These are starting proportions, not rigid widths. The writing area gets any extra space; it must not be squeezed to preserve empty supporting columns.

### Left: Story blocks

The heading is **Story blocks**, followed by one search field. Below it are Characters, Emotions, and Tones, each with a small Manage link. Real blocks appear as compact, wrapping chips. All three group labels remain visible; changing library category must not require leaving the writer.

Chips use a consistent shape, a small type icon, and a readable name. Backgrounds distinguish their types: sage for Characters, lilac for Emotions, and apricot for Tones. Type is also announced as Character, Emotion, or Tone. A quiet grip indicates dragging; pressing the chip performs its documented click-insertion action. Manage is a distinct text link, so clicking Maya never unexpectedly opens her global profile instead of inserting her.

An empty group offers New character…, New emotion…, or New tone…. This opens the corresponding full library screen in create mode. A Return to Stitches action takes the writer back to the saved caret/target. The newly created block is available immediately in the working session; project Save remains separate.

### Center: the manuscript direction

The center starts with Back to story and the chapter path, then the scene title. Directly below is the **Scene tone** slot. Empty: “Choose or drop a tone.” Applied: an apricot Tone: Tender chip with Change and Remove. This supplies the default tone for beats that have no local tone block.

The scene summary follows in a roomy pale surface. Its label stays present while typing. Next is The beats and the existing alternating beat timeline. Each card remains a freeform paragraph editor with visible editing/reordering actions; no required cast fields or line-by-line form.

Blocks remain inline with ordinary words. The infirmary example reads naturally:

**[Character: Maya] [Emotion: Serious]** stitches **[Character: Damian]**’s wounds while he complains.

The bracketed labels here describe the block anatomy; the interface uses compact chips, not literal pipe syntax. Emotion is visibly its own chip. When its linked character is selected or hovered, a subtle shared outline makes the relationship apparent without permanent connector lines through the prose.

Freeform beats also accept tone blocks. Insert an apricot **Beat tone: Tense** chip at the caret among the text, or drag it into the beat. Its explicit label means it applies to that entire beat, even when the beat contains no characters. The inspector reads “Beat 3 only · Overrides scene tone: Tender.” The next beat still inherits Tender. Removing the chip restores inheritance; replacing it is one Undo action. The chip's position is not an implicit start/end boundary for part of a sentence.

Below the beats, Scene draft contains Generate, connection/setup feedback, streaming text, and review actions. Scene prose remains a separate editable section. Generation does not become another global navigation destination.

### Right: selection details

Before selection, the inspector gives one short instruction: “Select a block to see its guidance.” It does not fill the column with an unrelated form.

Selecting Maya shows her resolved defaults and “Character reference · Beat 2.” Selecting Awe shows **Emotion: Awe**, **For Damian**, **This occurrence only**, and the resolved guidance. Local controls affect that use; **Edit shared emotion** explicitly navigates to the global definition. The local/global distinction is placed above the editable fields, not hidden in a tooltip.

An emotion drag highlights only eligible character occurrences. Hovering Damian previews “Awe for Damian in Beat 3”; dropping creates the adjacent linked chip. For click insertion without a selected occurrence, a target picker lists the actual character occurrences and a short text excerpt to distinguish repeated names. No target means no silent change. With no characters, writing still works and the hint explains how to select/add a target.

Tone dragging highlights both the scene-tone slot and eligible beat editors. A scene drop previews “Tender for this scene”; a beat drop previews “Tense for Beat 3 only” and shows the insertion caret. Clicking a shelf tone opens a compact Apply to chooser with This scene and the selected beat; the beat's own Insert tone control already specifies its target. Unsupported drops leave the text unchanged and name the valid destinations. One beat tone replaces another; tone blocks do not accumulate conflicting directions in one beat.

## Characters: build the cast

This is a full screen headed **Characters**, with “Shared across every scene in this project” beneath it and **New character** at the upper right. Within the page, a roughly 260–300px master list sits to the left of a large editor. It is a library editor, not a wall of profile cards.

The list has Search characters and Active / Archived filters. Each row shows a name and a short voice/personality excerpt if one exists. Maya’s selected row has a pale orange fill and clear selection marker; unselected rows remain quiet. The initial visit selects the first active character; future visits restore the previous selection.

The detail editor leads with Maya’s name, her Character block preview, and the shared scope label. Fields follow the writer’s likely questions:

1. **Background** — who she is and what shaped her.
2. **Personality** — how she tends to respond.
3. **Voice** — how she sounds; for example, short and dry rather than a required voice taxonomy.
4. **Defaults** — optional linked tone and emotion selectors, with None available and a compact preview of the resolved guidance.

Field labels stay visible and textareas grow comfortably for real profile text. Only the name is required. Avoid a giant empty avatar or portrait-upload task; character identity is carried by the name and writing.

Duplicate and Archive are visible beside the profile heading. Used in appears below the profile, with links such as “Stitches · Beat 2.” Opening a usage selects the actual occurrence in its scene. Changes stay in the working copy; there is no competing Save character button. The global Save button handles every project screen.

## Tones: reusable writing treatment

The Tones screen uses the same list/detail layout, with **New tone**, Search tones, Active / Archived, and a selected definition. Reusing this structure makes navigation familiar while leaving room for different content.

For **Tender**, the detail editor shows a Tone: Tender block preview, **Meaning** (“warm, attentive, restrained”), **Writing guidance** (“Let care show through small actions; keep the banter dry”), and an optional **Example**. The example is author-entered guidance, not an automatically generated result or a promise of the model’s behavior.

Below the preview, a small instruction says “Use this block for a whole scene or an individual beat.” Used in links to scene references, exact beat overrides, and any explicit character defaults. The whole definition is editable; its name alone must not be the only information sent to generation.

When this screen was opened from a scene, Return to Stitches is visible near the heading. It does not apply the tone automatically. Application happens through the scene’s shelf or tone chooser, where the destination is clear.

## Emotions: reusable character direction

The Emotions screen again uses the shared list/detail layout. For **Awe**, show an Emotion: Awe block preview, **Meaning**, **Expression guidance**, and optional **Example**. Guidance might describe attention catching, complaints trailing off, or a softened response. It should help the writer encode intent without prescribing the prose sentence.

The explanatory line is concrete: “Drop this block onto a character in a beat.” Used in links include the character and occurrence: “Stitches · Beat 3 · Damian.” Emotion targets a character occurrence; a tone targets a scene or a whole beat.

Duplicate makes a separate definition. Archive hides it from new insertion while preserving existing uses. Delete is available only for an unused definition and moves it to recoverable Trash. These labels and consequences remain consistent across all three libraries.

## Ready-to-use starter blocks

New projects begin with **Serious, Awe, Angry, and Embarrassed** in Emotions and **Tender, Tense, and Playful** in Tones. Each is a real global definition with editable guidance, not a decorative example. The initial lists are useful immediately without requiring setup or imposing characters on the writer.

Existing projects can explicitly Add starter blocks. Existing custom definitions are preserved, and reopening or upgrading never respawns removed starter entries. These additions use manual Save like any library edit. The exact guidance and initialization rules are recorded in the behavior plan.

## Visual rhythm and comfort

Platinum is the dominant ground. Editing surfaces are slightly lighter, and Iron Grey carries readable text. Orange identifies the active destination, a primary creation action, a changed Save action, and meaningful selection/drop feedback. It does not flood the whole header or make every chip a competing orange button.

Block backgrounds have their own consistent semantic palette: Character sage `#DCEBDD` with `#274B35` text, Emotion lilac `#EADFF4` with `#543769` text, and Tone apricot `#FFE0B8` with `#6A3A12` text. Apply the same type colors to shelf chips, inline blocks, pickers, and definition previews. Dark mode uses darker matching fills and light text, as specified in the behavior plan. Selection/focus uses an additional contrasting outline; it preserves the block's type color. Type names/icons remain available for accessibility, and Calm retains these colors.

Use a 4px-based spacing scale: tight 8–12px groups for related controls, 16px between neighboring fields, and 24–32px between distinct tasks. Writing text uses Georgia; navigation, labels, chips, and forms use the existing platform sans. Headings are descriptive—Characters, Tones, Emotions—not promotional slogans.

Playfulness stays in restrained backing angles, staggered timelines, and unequal useful column widths. Lists, editor fields, navigation tabs, and drop targets remain horizontal. Calm removes decorative transforms. No page-load choreography or looping animation; brief transitions explain selections and drops.

At the 800px minimum window or high text zoom, the library screens show a full-width list, then a full-width editor with Back to list. In Scene, **Insert blocks** opens the searchable shelf in a drawer and preserves the current caret/target. **Block details** opens the selected inspector on demand. These utilities yield space before the writing column becomes cramped. The timeline becomes one readable column when needed.

## First-use and feedback

The shortest useful journey is: create a scene, write freely, insert a character, attach an emotion, and optionally choose a scene tone. Defining every library entry is never a prerequisite for drafting.

An empty library teaches its role with one sentence and one creation action. A failed search offers Clear search. A missing reference stays visible as unresolved, with a repair action; it is not silently replaced. A failed Save preserves work and offers Retry. Ordinary field edits do not trigger toasts; insertion, replacement, archive, restore, and destructive actions provide concise feedback where they happen.

Success is behavioral: the writer can create a reusable definition, return to the same scene, insert it into its proper target, see what it affects, and save the project without navigating through a mixed toolbar or losing their place.
