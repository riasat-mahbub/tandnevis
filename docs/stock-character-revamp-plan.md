# Stock character library revamp

Implemented 21 November 2026, with an expanded visual browser and selectable character icons. The list below preserves the original research inventory; entry-level keep/defer decisions belong in the catalog research record. See the [progress ledger](implementation-progress.md) for test and packaged verification evidence.

The subsequent [character creation wizard proposal](character-creation-wizard-plan.md) supersedes this document's combined creation-page composition when implemented. Catalog evidence, editable starting text, icon persistence, and project-safety requirements continue to apply.

## Purpose and scope

Give a writer recognizable, reference-backed stock types from which to create an individual character. Replace the invented six-profile catalog with established names, concise explanations, and useful editable starting text. Retain the blank-character path and the existing Characters library and Scene-sidebar entry points.

The previous catalog in [stock-characters.ts](../src/content/stock-characters.ts) contained the guarded medic, proud rival, observant friend, charming liar, tired mentor, and anxious planner. These authored personality sketches have been replaced by 53 supported types; the [research record](stock-character-catalog-research.md) documents the six deferrals. Characters already created from earlier catalogs keep their names, fields, IDs, references, history, and archived state.

This tranche covers catalog research/content, template discovery, draft application, character icons, and relevant verification. The catalog itself needs no project schema change; durable character icons use schema 7's compatibility gate and extension metadata. Templates remain bundled application content and create ordinary project characters only through the existing Create action. Browsing works offline and does not require a new character relationship model.

The user explicitly rejected a dropdown-only chooser. Use icon-led category buttons and browsable results with a substantial preview. A shared icon picker also supports blank custom characters and existing saved profiles; icons appear consistently in the library, Scene shelf, and inline character blocks. Icon-only edits participate in history and Save without changing generation instructions, fingerprints, inline documents, or prose. Older projects receive a default person icon. Source-file migrations happen only during explicit Save.

## Reference policy

Use a recognizable recurring type as the inclusion test. A useful personality description alone does not establish a stock character. Keep historical/literary standing separate from browsing category: a fairy-tale type may be old, and a comic type may also belong to commedia.

| Reference | Evidence checked for this plan | Use and limit |
|---|---|---|
| Chris Baldick, *The Oxford Dictionary of Literary Terms*, stock character entry | The [Oxford Reference entry](https://www.oxfordreference.com/display/10.1093/oi/authority.20110803100533855) returned HTTP 403. | Definition reference supplied by the user; publisher text was not independently retrieved. Record edition/entry details before claiming direct verification. Do not attribute a whole roster to this definition. |
| *Encyclopedia of Identity*, Stock Character | [Publisher entry and visible opening](https://sk.sagepub.com/ency/edvol/embed/identity/chpt/stock-character), DOI `10.4135/9781412979306.n254`. | Supports audience recognition through familiar behavior and presentation, and the usefulness of familiar figures. Its visible examples include the ingénue and damsel in distress; it does not validate all proposed entries. |
| Jennifer Meagher, Commedia dell'arte, Metropolitan Museum of Art, 2007 | [Essay retrieved](https://www.metmuseum.org/essays/commedia-dellarte). | Historical character names and relationships; distinguish original names from English role descriptions. |
| Wikipedia, List of stock characters | [Catalog retrieved](https://en.wikipedia.org/wiki/List_of_stock_characters); spot checks included Holmesian detective, red herring character, schoolmaster, and black widow. | Discovery index and named-type cross-check. Review linked references and exact wording per entry; list membership is not proof that all descriptions or examples are sound. |
| TV Tropes | No retrieval attempted for this plan. | Optional later discovery source. No entry receives a TV Tropes attribution without checking it. |

For each proposed entry, record a source URL, title, relevant entry/section, what it supports, and verification state. The source must support the label or explicitly identified historical equivalent, rather than merely mentioning the broad topic. Prefer publisher, museum, scholarly, or other specialist references when available. Write original summaries and draft text; do not import source paragraphs or example characters' biographies.

Only verified entries ship. A missing reference narrows that entry's claim or leaves it pending; it must not acquire an invented label just to fill a category. Keep unverified candidates in the planning inventory. Broader cultural traditions can be added later through the same research process; this initial selection is predominantly European and Anglo-American.

## Candidate inventory

Retain all 59 supplied rows for editorial review. Counts below describe candidates before alias and overlap decisions. The six groups are navigation aids, not claims about when a type originated. Titles omit the repeated article here for readability.

| Browsing group | Candidates | Proposed coverage from the user's list |
|---|---:|---|
| Classical and traditional | 10 | Miser; Braggart Soldier; Clever Servant; Foolish Old Man; Young Lovers; Pedant; Trickster Servant; Innocent Fool; Coquettish Maid; Jealous Guardian |
| Social and personality | 12 | Dandy; Fop; Rake; Ingénue; Byronic Hero; Girl Next Door; Boy Next Door; Pollyanna; Lovable Loser; Annoying Neighbor; Town Drunk; Spinster |
| Crime and mystery | 11 | Holmesian Detective; Hardboiled Detective; Police Inspector; Red Herring Character; Femme Fatale; Black Widow; Gentleman Thief; Con Artist; Corrupt Cop; Impostor; Forger |
| School and coming of age | 8 | Bully; Jock; Nerd; Mean Girl / Queen Bee; Preppy; Tomboy; Schoolmaster; Headmaster / Headmistress |
| Fantasy, adventure, and fairy tale | 11 | Wise Old Man; Enchantress; Dark Lord; Necromancer; Prince Charming; Damsel in Distress; Wicked Stepmother; Black Knight; Knight-Errant; Elderly Martial Arts Master; Fallen Hero |
| Eccentric and comic | 7 | Absent-Minded Professor; Mad Scientist; Lovable Rogue; Oddball / Misfit; Jester; Foolish Braggart; Harlequin |

The supplied characterizations are editorial inputs. Complete entry-level verification and write distinct profiles before fixing the shipped count.

## Editorial decisions

1. **Historical equivalents need qualification.** Pantalone can inform the Miser, Il Capitano the Braggart Soldier, and Il Dottore the Pedant. Present these as historical connections, not interchangeable definitions covering every tradition. Keep original names searchable. Do not call every related name a synonym.
2. **Resolve overlap through behavior.** Review Clever Servant, Trickster Servant, and Harlequin together. Preserve separate entries only when their documented characterization and draft guidance differ. The Met describes Harlequin's physical comedy and susceptibility to deception; a uniformly calculating mastermind would misrepresent that account. Similarly compare Braggart Soldier/Foolish Braggart and distinguish Dandy/Fop, Con Artist/Impostor, and Jester/Innocent Fool.
3. **Merge true aliases only.** Use one ID for supported alternative names or spellings, including Arlecchino/Harlequin. Mean Girl/Queen Bee and Oddball/Misfit require review before being treated as equivalent. Related types can share tags without disappearing into one generic profile.
4. **Separate occupation from dramatic convention.** Police Inspector, Forger, Schoolmaster, and Headmaster need a specific recurring characterization and supporting reference. An occupation with no characteristic behavior is insufficient. Enchantress and Necromancer also need more than a list of abilities.
5. **Handle narrative function explicitly.** Red Herring Character describes a role in a mystery. Do not give every such character the same personality or secretly assert their innocence in the generated profile. Young Lovers describes a pair: applying it drafts one lover, leaves the partner unspecified, and never creates a second record or relationship automatically. Explain that single-character adaptation in its preview.
6. **Keep historical labels intelligible.** Retain sourced terms such as Spinster, Ingénue, Tomboy, and Damsel in Distress, accompanied by a short contextual note where social or gender assumptions matter. Describe a fictional convention, not a fact about a real social group. Distinguish historical characterization from the writer's editable adaptation. Names, gender, appearance, accent, and personal history remain the writer's choices.
7. **Treat voice as an authored suggestion.** Most references establish a type, not a mandatory dialogue style. Mark background/personality/voice draft fields as application-authored starting points. Avoid making accent, education, age, or disability a substitute for characterization.
8. **Keep templates flexible.** Provide a useful desire, pressure point, or contradiction in the draft text without inventing a named setting, canonical family, compulsory trauma, or fixed relationship. Do not automatically attach tone or emotion defaults. A stock type should support adaptation and subversion.

## Content model

Extend the static template interface with catalog metadata; extend the saved Character model only with an optional icon ID. Catalog fields:

| Field | Purpose |
|---|---|
| `id`, `title` | Stable ASCII identifier and established display name; IDs do not depend on display capitalization or accents. |
| `icon` | A stable ID from the shared Lucide icon registry; copied to the editable draft and saved character as visual metadata. |
| `category`, `tags` | One primary browsing group plus optional cross-genre/tradition tags. |
| `standing` | `historical-literary` or `genre-convention`; based on evidence, independently of category. |
| `aliases`, `historicalConnections` | Separate supported alternate labels from related historical figures/types. |
| `summary` | One short explanation of the recognizable convention. |
| `contextNote` | Optional qualification about historical usage, social assumptions, a pair, or narrative function. |
| `sources` | Bundled citations with URL, title, locator, supported claim, and verification state. Never fetched to populate the chooser. |
| `background`, `personality`, `voice` | Original suggested draft text copied into the existing three editable fields. |

Keep candidate research states in the planning inventory or a separate research file. The exported runtime catalog contains only entries whose supporting claims have passed review. Do not persist a template ID, classification, bibliography, or historical label into a saved character unless a later feature explicitly needs provenance. A created profile is a snapshot of the writer's current field values.

Example of the intended separation, using the Miser:

- **Reference-backed convention:** possession and reluctance to spend dominate the character's choices; include the qualified Pantalone connection in the source details.
- **Suggested background:** "Has built a reserve of resources and arranged daily life around keeping it intact."
- **Suggested personality:** "Treats concessions as losses and keeps close account of favors. Wants security, yet risks alienating the people who could provide it."
- **Suggested baseline voice:** "Returns to costs, terms, and obligations. May offer elaborate reasons for refusing a small request."

The three suggestions are original editorial choices for this application, not claims about wording or prescribed speech in the reference.

## Template discovery and draft behavior

The surface serves a writer who wants to create one usable character and return to their scene. Follow the existing app's compact library layout, sage character identity, typography, focus behavior, and light/dark themes. This is an Operate surface; descriptive labels and clear actions take priority over decorative catalog cards.

1. New character opens the existing draft form, initially blank, with the name field ready for entry. Keep Blank character and a visible Stock character templates section.
2. Provide a labeled search field, category filter with All categories, and grouped results. Search title, supported aliases, tags, and summary; normalize case and diacritics so `ingenue` finds `Ingénue`. Use alphabetical order within groups and stable category order.
3. Selecting a result previews its summary, standing, optional context note, and proposed fields. Source details are expandable and work offline as readable bibliographic text, with links for optional external reading. Previewing and filtering never modify the draft.
4. **Use template** copies the previewed background, personality, and voice into the draft, preserving the typed name. If any of those three fields already contains text, show a local confirmation explaining that those fields will be replaced. Declining leaves every field intact. Using the same template is repeatable; no saved character is changed.
5. Editing those fields remains unrestricted. Category/search changes retain edits. An explicit **Clear profile fields** action clears the three fields with the same replacement protection and preserves the name. Merely browsing back to the blank option does not silently erase a draft.
6. **Create character** dispatches the existing single create operation with the final name and field values. Preserve current name validation, duplicate behavior, error feedback, pending-state protection, Undo/Redo, and manual Save rules. Cancel discards the draft and restores focus; leaving to inspect an existing profile preserves the pending draft as it does today.

Cover roughly 50-60 entries without turning the Scene shelf into a second template library. Both entry points open the same creation workflow. Keep the name and compact icon chooser above the browser, then editable profile fields. Show results beside the preview at desktop and 800px; below 650px, stack them in reading order. Keep actions reachable and prevent horizontal overflow. Use native labeled controls and ordinary list buttons with visible focus, rather than an unneeded custom ARIA combobox. Show a clear no-results state with Reset filters and Blank character still available. Browsing requires no network or AI connection. A failed creation retains the draft and gives a retry path; successful recovery selects the created record rather than enabling a duplicate submission.

## Delivery sequence and acceptance

The catalog, browser, and icon persistence are implemented. The sequence below remains the delivery and acceptance contract; the progress ledger records verification against the rebuilt desktop artifact.

1. **Verify and author the catalog.** Audit the 59 candidates, record keep/merge/defer decisions with supporting references, finalize original text, then replace [stock-characters.ts](../src/content/stock-characters.ts). Add focused catalog validation for unique IDs, known categories, resolvable citations, and complete draft fields. Review overlap and distinctiveness editorially; field completeness alone cannot establish quality.
2. **Implement discovery and safe application.** Update [LibraryView.tsx](../src/components/LibraryView.tsx) and its styles, extracting a small picker component if useful. Preserve both current creation entry points. Verify search/alias/diacritic matching, category and empty states, preview nonmutation, replacement accept/cancel, name preservation, repeat use, draft retention, keyboard navigation, and creation failures in the relevant component tests.
3. **Verify project safety and generation.** Update [LibraryView.test.tsx](../src/components/LibraryView.test.tsx), [App.test.tsx](../src/App.test.tsx), and [native-smoke.cjs](../tools/native-smoke.cjs), which currently select the old template IDs. Exercise one character created from a traditional type and one from a genre type. Confirm one atomic creation, Undo/Redo, Save/reopen, old-profile preservation, and referenced-only generation using the accepted edited fields. Source metadata and unused templates must not enter generation context.
4. **Review and document delivery.** Run typecheck, frontend suite, and production build. Run native smoke against the rebuilt executable for draft nonmutation, creation, Undo/Redo, and Save/reopen. Inspect one batched set of 1440px and 800px captures in light and dark themes; address defects together and confirm once. Run Rust tests if native behavior/contracts change. Update this plan's status, starter-content documentation, and the progress ledger with actual evidence; rebuild the portable artifact only as part of the implementation release.

Acceptance requires every shipped entry to have a supported established label or clearly qualified equivalent, distinct useful draft text, accessible discovery, and safe reuse. Existing project characters must remain byte-for-byte equivalent in their saved fields when merely browsing the new catalog. No character is added until Create, and the catalog itself never seeds project records.

The editorial audit finalized 53 shipped types and six deferred candidates. Deferred types remain in the research record for future evidence review.
