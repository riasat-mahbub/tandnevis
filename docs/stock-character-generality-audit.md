# Stock character generality audit

Audited 21 November 2026. This is an editorial review of all 53 shipped templates in [stock-characters.ts](../src/content/stock-characters.ts). It makes no catalog, UI, or runtime changes.

## Findings

The catalog has 31 Keep, 21 Tweak, and 1 Restructure. “Generic enough” should mean adaptable around a recognizable type, not stripped of the type’s defining feature. A Braggart Soldier can still be a military braggart; a Black Widow can still carry the partner-danger plot convention. The review flags only details that add a particular motive, life history, setting, relationship duration, gendered pronoun, or fixed tactic beyond that convention.

The research record already distinguishes sourced type labels from the app-authored background, personality, and voice suggestions. Applying a template copies those three draft fields and its icon; the summary, context note, aliases, and sources are preview/catalog information, not copied into the character profile ([browser mapping](../src/components/CharacterTemplateBrowser.tsx#L47)). So a caveat in a context note does not neutralize a more prescriptive copied field.

## Entry-by-entry review

| ID / title | Result | Finding or suggested edit |
|---|---|---|
| miser — The Miser | Tweak | The summary makes fear of loss the motive and the background assumes accumulated wealth. Keep miserliness; make motive and resources open: “Guards possessions or resources closely. Fear, greed, principle, or scarcity may explain why; the writer chooses.” |
| braggart-soldier — The Braggart Soldier | Keep | Military status, boastful claims, and pressure exposing the boast are the named convention. No specific war, rank, or personal history is fixed. |
| clever-servant — The Clever Servant | Tweak | “Household” fixes a domestic setting beyond the subordinate-helper role. Replace with: “Works near people with more formal power or resources; the role and institution are the writer’s choice.” |
| young-lovers — The Young Lovers | Keep | Romance and an obstacle are the convention. The context note correctly says this applies to one character and leaves the partner, names, genders, and relationship details open. |
| pedant — The Pedant | Tweak | “Spent years building expertise” and expecting respect add a credential path and motive. Use: “Has expertise they expect others to value; the field, path to it, and reason for displaying it are open.” |
| trickster-servant — The Trickster Servant | Keep | The subordinate-helper position and use of schemes are defining. The template already allows the schemes to serve others or the character. |
| innocent-fool — The Innocent Fool | Keep | Candor, literal interpretation, or unexpected insight distinguish this branch of the fool; no diagnosis or fixed biography is added. |
| coquettish-maid — The Coquettish Maid | Keep | The attendant/confidante role and teasing, observant presentation are the historical type. The suggested gossip or joke is a voice example, not a required personal history. |
| jealous-guardian — The Jealous Guardian | Tweak | The type is a controlling authority over a younger person’s romantic choice; “fear of losing authority” is one motive. Use: “May act from protection, reputation, possessiveness, or another motive; the source of authority and family relationship are the writer’s choice.” |
| dandy — The Dandy | Tweak | “Has time and means” makes privilege a prerequisite. Keep deliberate dress and presentation; use: “Treats dress or public presentation as an intentional art; resources, setting, and reasons are open.” |
| fop — The Fop | Keep | Comic performance of fashionable refinement and misplaced confidence distinguish the fop from the dandy. |
| rake — The Rake | Keep | Libertinism and pleasure-seeking are the type’s core. The template does not require a named partner, setting, or biography. |
| ingenue — The Ingénue | Tweak | The summary says “young,” while the context note says age is not prescribed. Keep inexperience/open outlook and qualify the summary: “A character whose inexperience and openness shape how they read the world; the historical stage role often signals youth, but exact age is the writer’s choice.” |
| byronic-hero — The Byronic Hero | Keep | Alienation, intensity, and private grievance are the recognizable convention; no specific traumatic event or relationship is supplied. |
| girl-next-door — The Girl Next Door | Tweak | Familiarity with the protagonist is core, but “for years” fixes its duration and history. Use: “Shares a familiar place, routine, or community with the protagonist; the duration and relationship are open.” |
| boy-next-door — The Boy Next Door | Keep | Familiar proximity and the romantic contrast are the convention. The draft explicitly leaves room for private ambitions and flaws. |
| pollyanna — The Pollyanna | Tweak | “Has learned” assigns an origin to the optimism. Use: “Looks for possibility when circumstances disappoint; whether this is temperament, a learned practice, or a coping strategy is open.” |
| lovable-loser — The Lovable Loser | Keep | Sympathetic effort, ordinary setbacks, and persistence are the convention; no fixed cause of the setbacks or relationship is prescribed. |
| spinster — The Spinster | Keep | The historically dismissive label is inherent to this named type. Its note and personality field leave age, sexuality, reasons, and inner life open; do not rename it as a generic unmarried person. |
| holmesian-detective — The Holmesian Detective | Tweak | “Has trained themself” prescribes a self-directed training history. Use: “Notices small details and connects evidence; training, profession, and route to the skill are the writer’s choice.” |
| hardboiled-detective — The Hardboiled Detective | Tweak | The cynical type is core; personally witnessing institutional failure is not required. Use: “Works in a harsh or unjust environment and expects limited help from institutions; the source and extent of that distrust are open.” |
| police-inspector — The Police Inspector | Tweak | Official investigation and procedure are core, but the voice assumes a private-investigator counterpart. Replace that clause with: “Asks about timelines and evidence, and explains what the applicable procedure can establish.” |
| red-herring-character — The Red Herring Character | Restructure | This is a plot function, not a personality type. Keep it available for mystery writing, but label it as a narrative role and keep the writer-defined motive/personality separate. Suggested concise description: “A suspect whose presentation briefly points attention away from the central explanation. Their actual personality, motive, and guilt are up to the writer.” |
| femme-fatale — The Femme Fatale | Keep | This is an intentionally gendered noir convention; its context note already warns about that framing and leaves goals, agency, and gender open. Preserve the named type rather than flattening it to “strategic character.” |
| black-widow — The Black Widow | Keep | The relationship-danger premise is the defining thriller convention. The context note treats suspicion as a plot device, not a claim about women or relationships generally. |
| gentleman-thief — The Gentleman Thief | Keep | Polished theft and a private code distinguish the type; no specific wealth source, partner, or setting is imposed. |
| con-artist — The Con Artist | Keep | Reading a target and building a deceptive story are defining behaviors. Fear of exposure is already phrased as optional (“may conceal”). |
| corrupt-cop — The Corrupt Cop | Tweak | Misuse of official access for gain is core, but “then begins trading” prescribes a turn from honest service. Use: “Uses law-enforcement access for private gain or to protect a criminal interest; when this began and why are the writer’s choices.” |
| impostor — The Impostor | Keep | False identity/claims and the risk of scrutiny are the type; the draft leaves the impostor’s self-understanding open. |
| bully — The Bully | Tweak | Intimidation is core; the background narrows its cause to attention, compliance, or self-protection. Use: “Uses social or physical pressure to control peers; the reason, history, and vulnerability behind the behavior are the writer’s choice.” |
| jock — The Jock | Keep | Athletic identity and school status are the media convention. The draft explicitly says athletic ability does not determine intelligence and lets the voice shift away from sports. |
| nerd — The Nerd | Keep | The school-status outsider convention is present, while the context note and personality field explicitly reject appearance, identity, and shy-genius stereotypes. |
| mean-girl — The Mean Girl | Tweak | The personality field uses “her” despite the context note saying the writer may choose the character’s gender; the voice also assumes adults are nearby. Use gender-neutral language and make the adult audience situational: “May use status or exclusion to shape who belongs; the character’s gender, tactics, and audience are the writer’s choices.” |
| preppy — The Preppy | Keep | The affluent US school/media convention is intentionally specific, and the note cautions that class markers are not personality. Preserve this named convention. |
| tomboy — The Tomboy | Tweak | The label is historically gendered, but the copied background says the character “has had to negotiate” those expectations. Use: “The convention reflects expectations historically applied to girls; whether the character encounters, resists, or ignores them is the writer’s choice.” |
| schoolmaster — The Schoolmaster | Keep | Teacher role and classroom setting define this type; personality options already range from strict to playful and indifferent. |
| headmaster — The Headmaster / Headmistress | Keep | Chief school authority is the named role. Its context note leaves title, gender, age, region, and leadership style open. |
| wise-old-man — The Wise Old Man | Tweak | The context note makes age and gender optional, but the copied background ties knowledge to having lived through enough change. Keep the experienced-guide quality without requiring age: “Has substantial experience that helps the protagonist recognize patterns; how it was gained, the character’s age, and gender are the writer’s choices.” |
| enchantress — The Enchantress | Keep | Magic and altered options define the type. The context note explicitly makes gender and motive choices rather than requirements. |
| dark-lord — The Dark Lord | Keep | Domination, large-scale power, and an imagined realm are the defining convention, not unnecessary specificity. |
| necromancer — The Necromancer | Tweak | The type is magic involving death/the dead, but the background assumes other characters regard the practice as forbidden or dangerous. Use: “Works with death, memory, or the dead; the magic’s rules and how others judge it are the writer’s choices.” |
| prince-charming — Prince Charming | Tweak | The context note permits a different gender, but the copied voice says “he.” Use: “Speaks with gracious assurance; gender, agency, and any rescue or romantic relationship are the writer’s choices.” |
| damsel-in-distress — The Damsel in Distress | Keep | Peril that prompts rescue or escape is the narrative convention. The draft preserves agency and the context note makes gender optional. |
| wicked-stepmother — The Wicked Stepmother | Tweak | The antagonistic stepparent role is essential; “believes security or status depends on controlling the household” adds one motive and family history. Use: “Treats a spouse’s child as a rival or target in this fairy-tale convention; motive, family history, and tactics are the writer’s choices.” |
| black-knight — The Black Knight | Keep | Concealed identity and a formidable challenge are the named romance/adventure convention; allegiance is left flexible. |
| knight-errant — The Knight-Errant | Keep | Wandering, vows, and quests are essential. The type does not require one named order, beloved, or setting. |
| fallen-hero — The Fallen Hero | Tweak | A past turn or failure is core, but “avoids talking about the turning point until forced” prescribes a coping style. Use: “May name the turning point, avoid it, or defend it; present choices can reveal what the past means to them.” |
| absent-minded-professor — The Absent-Minded Professor | Keep | Expert focus and overlooked ordinary details define the type; the profile explicitly avoids equating this with incompetence. |
| mad-scientist — The Mad Scientist | Keep | Risky experimentation/ethical overreach are the speculative-fiction convention. The profile does not use mental illness as the cause; retain the note clarifying the old genre label. |
| lovable-rogue — The Lovable Rogue | Tweak | Rule-bending is core, but “has learned to survive” implies hardship as its origin. Use: “Uses improvisation or rule-bending to get by or gain an advantage; the reason and history are open.” |
| jester — The Jester | Keep | Performance, humor, and truth-telling near an audience or power are defining. The speech examples are optional voice guidance. |
| foolish-braggart — The Foolish Braggart | Keep | Ungrounded self-importance and boasting distinguish this type from the soldier variant; the profile permits either self-deception or deliberate dishonesty. |
| harlequin — Harlequin | Keep | This named commedia figure is specifically physical, hungry, opportunistic, and sometimes gullible. Keep those defining contradictions rather than making the character a generic trickster. |

## Ensemble-role gap

The 53 entries are named literary, social, mystery, school, fantasy, and comic conventions. They do not form a general group-dynamics menu. Some are adjacent—Police Inspector has team authority; Prince Charming and Knight-Errant are specific hero types; Nerd, Pedant, professors, and detectives have narrower expertise; Jock is a school athlete; Wise Old Man and Enchantress are specific guides; next-door types are romance/proximity conventions—but none is a general ensemble role.

The Five-Man Band is useful as an optional lens, not a universal taxonomy. Kathryn Burt’s 2026 Digital Rhetoric Collaborative essay presents Leader, Lancer, Heart, Brain, and Powerhouse as a teaching framework and discusses how role labels can constrain people when treated rigidly ([essay](https://www.digitalrhetoriccollaborative.org/2026/05/05/scooby-doo-who-are-you-scaffolding-collaboration-through-narrative-tropes/)). The descriptions below adapt those labels for flexible writing; they are not definitions from the essay. If coverage is added, offer individually reusable starting points for:

- **Leader:** sets or negotiates direction; need not hold formal authority or be the protagonist.
- **Lancer / Foil:** challenges or contrasts with another character; need not be a rival or a total opposite.
- **Brains:** gathers, tests, or interprets information; does not require one “smartest” person.
- **Powerhouse:** brings decisive action or force; fiction often renders this as physical strength, but its source and expression are the writer’s choices.
- **Heart:** attends to trust and connection; does not make someone the group’s caretaker or mediator.

These functions should be optional, relational, and allowed to overlap or shift. Keep them distinct from sourced stock types and from wider story relations such as protagonist, antagonist, partner, or foil. Do not impose exactly five characters, assign names/genders/personality/emotions, or add a mandatory wizard step. The article does not establish a definitive or universally agreed version of this framework.

## Tone and emotion defaults

The stock-template type has no tone or emotion fields. The chooser copies icon, background, personality, and voice only; new profiles start with empty default-tone and default-emotion IDs ([template mapping](../src/components/CharacterTemplateBrowser.tsx#L47), [empty defaults on creation](../src-tauri/src/backend/domain.rs#L1227)). The Library’s character settings offer each as an optional reference, with **None** as the empty choice ([LibraryView.tsx](../src/components/LibraryView.tsx#L170)).

Keep stock-derived defaults at **None**. **None** is not the same as the actual **Neutral** tone preset, which adds measured, plain narration guidance ([starter presets](../src/content/starter-presets.json#L20)). Do not map a character type to an automatic emotion: emotion is scene-dependent. For example, a Miser might suit Wry or Tense in different scenes; a Byronic Hero might suit Reflective or Bittersweet; Young Lovers might suit Tender or Hopeful. These are scene choices, not type mappings.

There is still a mood influence from copied personality and voice text even with empty preset IDs. During generation, a referenced character’s background, personality, baseline voice, and any selected default tone/emotion are all placed in the context; referenced preset definitions are included too ([generation context](../src/services/generation-context.ts#L170), [preset collection](../src/services/generation-context.ts#L279)). The prompt says to honor scene and character defaults and explicit character directions but does not define which takes precedence ([generation prompt](../src-tauri/src/backend/generation.rs#L883)). Do not describe a local cue as a guaranteed override of a default. Keep personality/voice suggestions as optional starting points and let a writer choose any project-specific default; no stock-template-to-preset mapping is warranted.
