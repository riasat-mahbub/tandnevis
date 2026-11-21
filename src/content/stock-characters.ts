/**
 * Reference-backed starting points for a character draft. These templates are
 * bundled content only: using one never creates or updates a project record.
 */
export type StockCharacterCategory = 'classical' | 'social' | 'crime' | 'school' | 'fantasy' | 'comic';

export type StockCharacterStanding = 'historical-literary' | 'genre-convention';

export interface StockCharacterSource {
  title: string;
  url: string;
  locator: string;
  claim: string;
  verified: boolean;
}

export interface StockCharacterTemplate {
  id: string;
  title: string;
  category: StockCharacterCategory;
  tags: string[];
  standing: StockCharacterStanding;
  aliases: string[];
  historicalConnections: string[];
  summary: string;
  contextNote?: string;
  sources: StockCharacterSource[];
  background: string;
  personality: string;
  voice: string;
  icon: string;
}

export const stockCharacterCategories: Array<{
  id: StockCharacterCategory;
  label: string;
  icon: string;
}> = [
  { id: 'classical', label: 'Classical and traditional', icon: 'crown' },
  { id: 'social', label: 'Social and personality', icon: 'heart' },
  { id: 'crime', label: 'Crime and mystery', icon: 'search' },
  { id: 'school', label: 'School and coming of age', icon: 'graduation-cap' },
  { id: 'fantasy', label: 'Fantasy, adventure, and fairy tale', icon: 'wand-sparkles' },
  { id: 'comic', label: 'Eccentric and comic', icon: 'theater' },
];

const STOCK_CHARACTER_LIST_URL = 'https://en.wikipedia.org/wiki/List_of_stock_characters';
const COMMEDIA_URL = 'https://www.metmuseum.org/essays/commedia-dellarte';
const SAGE_STOCK_URL = 'https://sk.sagepub.com/ency/edvol/embed/identity/chpt/stock-character';
const ALLOPROF_URL = 'https://www.alloprof.qc.ca/en/students/vl/english/characters-in-literature-e0190';

function source(title: string, url: string, locator: string, claim: string): StockCharacterSource {
  return { title, url, locator, claim, verified: true };
}

function stockListEvidence(locator: string, claim: string): StockCharacterSource {
  return source('List of stock characters', STOCK_CHARACTER_LIST_URL, locator, claim);
}

function metEvidence(locator: string, claim: string): StockCharacterSource {
  return source('Commedia dell’arte — The Metropolitan Museum of Art', COMMEDIA_URL, locator, claim);
}

function encyclopediaEvidence(locator: string, claim: string): StockCharacterSource {
  return source('Stock Character — Encyclopedia of Identity', SAGE_STOCK_URL, locator, claim);
}

function alloprofEvidence(locator: string, claim: string): StockCharacterSource {
  return source('Characters in Literature — Alloprof', ALLOPROF_URL, locator, claim);
}

function makeTemplate(
  id: string,
  title: string,
  category: StockCharacterCategory,
  standing: StockCharacterStanding,
  summary: string,
  background: string,
  personality: string,
  voice: string,
  icon: string,
  evidence: StockCharacterSource[],
  options: {
    aliases?: string[];
    historicalConnections?: string[];
    tags?: string[];
    contextNote?: string;
  } = {},
): StockCharacterTemplate {
  return {
    id,
    title,
    category,
    standing,
    summary,
    background,
    personality,
    voice,
    icon,
    sources: evidence,
    aliases: options.aliases ?? [],
    historicalConnections: options.historicalConnections ?? [],
    tags: options.tags ?? [],
    ...(options.contextNote ? { contextNote: options.contextNote } : {}),
  };
}

const stockCharacterTemplates: StockCharacterTemplate[] = [
  makeTemplate(
    'miser', 'The Miser', 'classical', 'historical-literary',
    'A person whose fear of loss turns keeping and counting wealth into a governing habit.',
    'Has accumulated resources and arranged daily life around keeping them intact.',
    'Treats concessions as losses and keeps close account of favors. Wants security, yet risks alienating the people who could provide it.',
    'Returns to costs, terms, and obligations. May offer elaborate reasons for refusing a small request.', 'coins',
    [
      metEvidence('The paragraph on the vecchi and Pantalone', 'Identifies Pantalone as a miserly Venetian; this supports the qualified historical connection, not a single universal version of the miser.'),
      stockListEvidence('“Miser / Scrooge” entry', 'Describes the recurring miser as a wealthy hoarder who refuses to spend, and names Harpagon and Scrooge as examples.'),
    ],
    { historicalConnections: ['Pantalone (a related commedia dell’arte figure)', 'Harpagon', 'Ebenezer Scrooge'], tags: ['money', 'security'] },
  ),
  makeTemplate(
    'braggart-soldier', 'The Braggart Soldier', 'classical', 'historical-literary',
    'A boastful military figure whose extravagant claims are tested by real danger.',
    'Has built a reputation on stories of victories, admirers, and impossible feats.',
    'Craves admiration and dodges situations that might expose the gap between reputation and ability. Can be vain without being wholly incapable.',
    'Turns ordinary events into heroic anecdotes, names imagined witnesses, and changes the subject when challenged to prove a claim.', 'swords',
    [
      metEvidence('The paragraph on Il Capitano', 'Describes the commedia captain as a bullying braggart who proclaims victories and reveals cowardice when challenged.'),
      source('The Braggart in Italian Renaissance Comedy — PMLA', 'https://www.cambridge.org/core/journals/pmla/article/abs/braggart-in-italian-renaissance-comedy/C95755108F332405ECB9CF714A869B45', 'Opening extract', 'Identifies the miles gloriosus as a conventional type and describes the alazon as a vainglorious boaster.'),
      stockListEvidence('Classical archetypes under “Braggart”', 'Connects the braggart soldier with Plautus’s Miles Gloriosus and Il Capitano.'),
    ],
    { aliases: ['Miles Gloriosus'], historicalConnections: ['Il Capitano', 'alazon'], tags: ['comedy', 'military'] },
  ),
  makeTemplate(
    'clever-servant', 'The Clever Servant', 'classical', 'historical-literary',
    'A resourceful attendant who advances the plot by reading people and arranging the next move.',
    'Has learned how to navigate a household where others hold formal power and resources.',
    'Observant, quick to improvise, and alert to leverage. May help a loved one, a patron, or themself, with motives that can change.',
    'Asks pointed questions, offers a plausible story at the useful moment, and leaves room to deny having planned anything.', 'key-round',
    [
      source('A Glossary of Literary Terms', 'https://munshipremchandm.ac.in/wp-content/uploads/2024/12/Abrams-Glossary-of-Literary-Terms-1-1.pdf', '“Stock characters” section, p. 377', 'Names the clever servant as a recurring stock figure in Elizabethan comedy and identifies Mosca in Volpone as an example.'),
      metEvidence('The paragraph on the zanni', 'Describes servant figures as subversive and says their cunning interventions help the lovers overcome obstacles.'),
    ],
    { historicalConnections: ['servus callidus (clever slave/servant in Roman comedy)', 'Mosca in Ben Jonson’s Volpone'], tags: ['comedy', 'strategy'] },
  ),
  makeTemplate(
    'young-lovers', 'The Young Lovers', 'classical', 'historical-literary',
    'One half of a romantic pair whose intended union meets a social or family obstacle.',
    'Has fallen in love and is trying to make a shared future possible despite an outside barrier.',
    'Hopeful and preoccupied with the beloved, but capable of impatience, pride, or poor judgment under pressure.',
    'Speaks in earnest promises, imagined futures, and urgent requests for help. The writer can choose a different register.', 'heart',
    [
      metEvidence('Opening paragraph on commedia plots and innamorati', 'Says plots commonly centered on young lovers whose union was hindered by elders; the pair is a historical convention.'),
      stockListEvidence('“Young lovers” entry', 'Identifies the pair as the innamorati of commedia dell’arte and describes their role at the center of the plot.'),
    ],
    {
      historicalConnections: ['innamorati (commedia dell’arte)', 'star-crossed lovers'],
      contextNote: 'This applies to one character only. It leaves the partner, names, genders, and relationship details for the writer to decide.',
      tags: ['romance', 'pair role'],
    },
  ),
  makeTemplate(
    'pedant', 'The Pedant', 'classical', 'historical-literary',
    'A status-conscious expert who displays learning even when it is irrelevant to the moment.',
    'Has spent years building expertise and expects that knowledge to command respect.',
    'Precise and self-assured, with a blind spot for how little a display of learning helps the people around them.',
    'Corrects terminology, cites authorities, and may answer a practical question with a lecture.', 'book-open',
    [
      metEvidence('The paragraph on Il Dottore', 'Describes the commedia figure as a wealthy old doctor who speaks in non sequiturs and quotes Latin inappropriately.'),
      source('Domenico Tiepolo: Drawings, Prints, and Paintings — The Metropolitan Museum of Art', 'https://resources.metmuseum.org/resources/metpublications/pdf/Domenico_Tiepolo_Drawings_Prints_and_Paintings_in_The_Metropolitan_Museum_of_Art_The_Metropolitan_Museum_of_Art_Bulletin_v_54_no_3_Winter_1996_1997.pdf', 'Discussion of commedia figures, p. 17', 'Calls Il Dottore an academic pedant of Bolognese origin.'),
    ],
    { historicalConnections: ['Il Dottore (commedia dell’arte)', 'learned crank / alazon'], tags: ['comedy', 'expertise'] },
  ),
  makeTemplate(
    'trickster-servant', 'The Trickster Servant', 'classical', 'historical-literary',
    'A low-status helper who uses misdirection and improvised schemes to upset a settled order.',
    'Works close to power without sharing it, learning where the rules are brittle and who can be persuaded.',
    'Clever, adaptable, and willing to exploit a powerful person’s assumptions. Their schemes can help others while serving their own interests.',
    'Uses a cover story, an unexpected question, or a sudden change of plan to make others reveal what they want.', 'feather',
    [
      metEvidence('Opening paragraph on zanni', 'Calls servant figures subversive and says their antics and intrigues shape the fate of lovers, elders, and one another.'),
      stockListEvidence('“Zanni” entry', 'Identifies commedia servants as a recurring group whose intervention helps the lovers overcome blocking elders.'),
    ],
    { historicalConnections: ['zanni (commedia dell’arte)', 'Brighella', 'Arlecchino / Harlequin'], tags: ['comedy', 'deception', 'servant'] },
  ),
  makeTemplate(
    'innocent-fool', 'The Innocent Fool', 'classical', 'historical-literary',
    'A seemingly simple character whose literal thinking or candor unsettles everyone else.',
    'Moves through the story with an incomplete grasp of its social games, but notices more than others expect.',
    'Open, unguarded, and often underestimated. Their mistakes may create trouble; their plain observations may expose it.',
    'Takes figures of speech literally, asks direct questions, or says the part others are carefully avoiding.', 'smile',
    [
      source('Unit 11.01.08 — Yale National Initiative', 'https://teachers.yale.edu/curriculum/units/2011/1/8/3', 'Discussion of stock characters and Shakespeare’s fool', 'Identifies the fool as a common stock character and describes comic wordplay and truth-telling within the role.'),
      stockListEvidence('“Fool” entry and simpleton-fool examples', 'Distinguishes simpleton fools from wise fools, supporting this as one branch of a broader fool convention.'),
    ],
    { historicalConnections: ['simpleton fool', 'wise fool (a related but distinct convention)'], tags: ['comedy', 'underdog'] },
  ),
  makeTemplate(
    'coquettish-maid', 'The Coquettish Maid', 'classical', 'historical-literary',
    'A quick-witted attendant who serves as a confidante and can quietly redirect a romance.',
    'Has a working position inside a household and sees the private tensions that its more powerful members miss.',
    'Streetwise, sociable, and comfortable improvising. Loyalty can coexist with a teasing streak and personal ambitions.',
    'Shares useful gossip, asks a tactful question, and lets a joke soften advice.', 'drama',
    [
      metEvidence('Paragraph on Arlecchino and Columbina', 'Describes Columbina as a clever and coquettish maidservant who serves the leading lady.'),
      source('A Guide to Commedia dell’Arte — Crossref-it.info', 'https://crossref-it.info/articles/515/commedia-dellarte', 'Types: soubrette / female servant', 'Describes the soubrette as a clever female servant and confidante who helps lovers and schemes against masters.'),
    ],
    { historicalConnections: ['Columbina / Colombina', 'soubrette'], tags: ['comedy', 'servant', 'confidante'] },
  ),
  makeTemplate(
    'jealous-guardian', 'The Jealous Guardian', 'classical', 'historical-literary',
    'An older authority who tries to control a younger person’s romantic choice.',
    'Believes that family duty, reputation, or security gives them the right to decide whom someone else may love.',
    'Protective in their own account and controlling in practice. Their fear of losing authority can make them easy to outmaneuver.',
    'Frames restrictions as sensible precautions and treats a request for freedom as proof that more supervision is needed.', 'shield',
    [
      metEvidence('Opening paragraph on commedia plots and vecchi', 'Names a jealous guardian as a possible elder blocking the union of young lovers.'),
      stockListEvidence('“Blocking parent” and related guardian entries', 'Supports the recurring dramatic role of an older authority who obstructs young lovers.'),
    ],
    { historicalConnections: ['vecchio (commedia elder)', 'blocking parent'], tags: ['family', 'romance', 'authority'] },
  ),

  makeTemplate(
    'dandy', 'The Dandy', 'social', 'historical-literary',
    'A person who treats dress, taste, and social presentation as a deliberate art.',
    'Has time and means to cultivate a public image and knows that people read clothes as a statement.',
    'Self-possessed, observant about fashion, and selective about company. May care more about style than conventionally useful work.',
    'Chooses exact words about texture, color, and taste; can make a small social distinction sound consequential.', 'hat-glasses',
    [stockListEvidence('“Dandy” entry', 'Identifies the dandy as a recurring figure in Regency and Victorian literature, associated with fashion and leisure.')],
    { historicalConnections: ['Beau Brummell', 'flâneur (related social figure)'], tags: ['fashion', 'status'] },
  ),
  makeTemplate(
    'fop', 'The Fop', 'social', 'historical-literary',
    'A comic figure who performs fashionable refinement but misjudges how well the performance lands.',
    'Has fashioned themself into a visible social presence and hopes style will secure admiration or advancement.',
    'Vain and eager to seem witty, with enough self-importance to miss the joke at their expense.',
    'Uses ornamental phrases, name-drops trends, and tries to turn ordinary conversation into a display.', 'crown',
    [stockListEvidence('“Fop” entry', 'Defines the fop as a recurring figure in English literature and comic drama who overdresses, aspires to wit, and puts on airs.')],
    { historicalConnections: ['Sir Fopling Flutter', 'Lord Foppington'], tags: ['comedy', 'fashion', 'status'] },
  ),
  makeTemplate(
    'rake', 'The Rake', 'social', 'historical-literary',
    'A charming pleasure-seeker whose appetite for novelty can leave real obligations in their wake.',
    'Has built a life around social access, romantic pursuit, and the freedom to leave before consequences arrive.',
    'Confident and persuasive, but inclined to treat other people’s feelings as temporary complications.',
    'Flirts with polished ease, makes bold promises, and jokes when a conversation turns to responsibility.', 'flame',
    [stockListEvidence('“Rake” entry', 'Describes a recurring seducer, gambler, and libertine whose charm sits beside moral risk.')],
    { historicalConnections: ['Restoration comedy rake', 'libertine'], tags: ['romance', 'comedy', 'risk'] },
  ),
  makeTemplate(
    'ingenue', 'The Ingénue', 'social', 'historical-literary',
    'A young, inexperienced character whose openness shapes how they interpret the world around them.',
    'Is encountering a larger and more complicated world than the one they have known so far.',
    'Sincere and curious, with assumptions that may be tested by people with more experience or less honest aims.',
    'Asks plain questions, takes promises seriously, and gradually finds language for what they want.', 'heart',
    [
      encyclopediaEvidence('Opening definition and examples', 'Names the ingénue as a stock character and describes audience recognition through familiar behavior and presentation.'),
      stockListEvidence('“Ingénue” entry', 'Describes the convention as youthful and inexperienced, while distinguishing it from a damsel-in-distress role.'),
    ],
    {
      historicalConnections: ['theatrical ingénue role'], tags: ['coming of age', 'romance'],
      contextNote: 'This is a historical stage and story convention, often gendered and associated with innocence. It does not prescribe a character’s age, sexuality, appearance, or competence.',
    },
  ),
  makeTemplate(
    'byronic-hero', 'The Byronic Hero', 'social', 'historical-literary',
    'A magnetic, alienated figure whose private grievance or contradiction resists easy judgment.',
    'Carries a past conflict or unresolved burden that has put distance between them and the community.',
    'Intense, proud, and capable of both tenderness and harm. Their self-sufficiency can conceal a need for connection.',
    'Speaks in controlled declarations, sharp observations, and rare admissions that reveal more than intended.', 'moon',
    [
      stockListEvidence('“Byronic hero” entry', 'Connects the literary type to Lord Byron and describes brooding, isolation, and conflict with community values.'),
      source('The Byronic Hero: Isn’t it Byronic? — PBS Digital Studios', 'https://www.youtube.com/watch?v=t4wNZDIH8d8', 'Description and historical overview', 'Describes the Byronic Hero as a recurring literary type that began in nineteenth-century literature.'),
    ],
    { historicalConnections: ['Lord Byron', 'Romantic hero'], tags: ['romance', 'conflict', 'outsider'] },
  ),
  makeTemplate(
    'girl-next-door', 'The Girl Next Door', 'social', 'genre-convention',
    'A familiar local person whose appeal comes from an established connection and unguarded ease.',
    'Has known the protagonist through an ordinary shared place, routine, or community for years.',
    'Comfortable and approachable, but not obligated to be innocent, plain, or romantically available.',
    'Talks with easy familiarity and can refer to shared history without explaining it to outsiders.', 'heart',
    [stockListEvidence('“Girl next door” entry', 'Describes a recurring romantic figure defined by local familiarity and contrast with a more glamorous outsider.')],
    {
      tags: ['romance', 'community'],
      contextNote: 'This gendered convention has often reduced women to a contrast with a glamorous rival. Use the familiar connection as a story device, not as a rule about real people.',
    },
  ),
  makeTemplate(
    'boy-next-door', 'The Boy Next Door', 'social', 'genre-convention',
    'A familiar, dependable person whose closeness can be mistaken for a lack of complexity.',
    'Shares a neighborhood, routine, or long history with the protagonist and is part of their everyday life.',
    'Steady and considerate, with private ambitions and flaws that can complicate the comfort others expect from them.',
    'Uses relaxed shorthand and shared memories; becomes more deliberate when the relationship changes.', 'user',
    [stockListEvidence('“Boy next door” entry', 'Describes a recurring romantic figure whose ordinary familiarity and modest manner distinguish him from a more dramatic rival.')],
    { tags: ['romance', 'community'], contextNote: 'The role is a romantic convention, not a claim that familiar or ordinary men share one personality.' },
  ),
  makeTemplate(
    'pollyanna', 'The Pollyanna', 'social', 'genre-convention',
    'An optimist whose hopeful outlook can encourage others and sometimes obscure real problems.',
    'Has learned to search for possibility even when circumstances are disappointing or uncertain.',
    'Warm and resilient, but may mistake hope for a plan or overlook when someone needs practical help.',
    'Notices small bright details, offers encouragement, and can struggle to hear bad news without immediately reframing it.', 'sparkles',
    [
      stockListEvidence('“Pollyanna” entry', 'Traces the label to Eleanor H. Porter’s cheerful protagonist and its later use for excessive optimism.'),
      source('Pollyanna: The Glad Book — Encyclopedia.com', 'https://www.encyclopedia.com/children/academic-and-educational-journals/pollyanna-glad-book', 'Opening paragraph', 'Describes the novel’s 1913 publication and how the character’s name became a term for blind optimism.'),
    ],
    { historicalConnections: ['Pollyanna (Eleanor H. Porter, 1913)'], tags: ['optimism', 'coming of age'] },
  ),
  makeTemplate(
    'lovable-loser', 'The Lovable Loser', 'social', 'genre-convention',
    'A sympathetic striver whose awkward habits and bad timing keep complicating an ordinary goal.',
    'Has a modest ambition that keeps being delayed by misfortune, self-doubt, or an imperfect plan.',
    'Well-meaning and self-deprecating, with enough persistence to keep trying after another setback.',
    'Overexplains a mishap, makes a rueful joke, and becomes unexpectedly earnest when someone else is in trouble.', 'smile',
    [
      alloprofEvidence('Stock characters: “The lovable loser”', 'Defines the character as likable but subject to bad luck and misadventures.'),
      stockListEvidence('“Lovable loser” entry', 'Describes a sympathetic, well-meaning underdog whose awkwardness and bad luck obstruct their aims.'),
    ],
    { historicalConnections: ['underdog', 'everyman'], tags: ['comedy', 'underdog'] },
  ),
  makeTemplate(
    'spinster', 'The Spinster', 'social', 'historical-literary',
    'A historically gendered role for an unmarried woman whom a story may portray as an outsider or observer.',
    'Has built a life outside the expected marriage plot and knows what the community assumes about that choice.',
    'May be sharp, sociable, private, content, lonely, or ambitious. The convention often says more about society’s judgment than her inner life.',
    'Can use dry observation and measured questions to expose the expectations other people treat as natural.', 'book-open',
    [stockListEvidence('“Spinster” entry', 'Records the recurring literary convention and its older stereotype, including a sometimes observant outsider underestimated by society.')],
    { tags: ['social outsider', 'historical convention'], contextNote: '“Spinster” has often been a dismissive label for unmarried women. Keep the character’s age, sexuality, and reasons for being unmarried open to the writer.' },
  ),

  makeTemplate(
    'holmesian-detective', 'The Holmesian Detective', 'crime', 'genre-convention',
    'A highly observant investigator who builds a solution from small details and explicit reasoning.',
    'Has trained themself to notice details others dismiss and to connect evidence across a case.',
    'Analytical and self-directed, sometimes impatient with routine or with people who do not share their focus.',
    'States observations precisely, tests a theory aloud, and may explain the chain of reasoning after a reveal.', 'search',
    [stockListEvidence('“Holmesian detective” entry', 'Describes the type as a perceptive, deductive investigator modeled on Sherlock Holmes.')],
    { aliases: ['Sherlockian detective'], historicalConnections: ['Sherlock Holmes', 'consulting detective'], tags: ['mystery', 'deduction'] },
  ),
  makeTemplate(
    'hardboiled-detective', 'The Hardboiled Detective', 'crime', 'genre-convention',
    'A cynical investigator who works through a corrupt or violent world without expecting it to be fair.',
    'Has seen institutions fail people and learned to work with limited trust and imperfect options.',
    'Wary, independent, and capable of compassion beneath a practiced defensive manner.',
    'Uses clipped observations and dry humor; gives trust slowly and calls out convenient lies.', 'fingerprint',
    [
      alloprofEvidence('Stock characters: “The hardboiled detective”', 'Defines the recurring investigator as tough, cynical, and willing to bend or break rules.'),
      stockListEvidence('“Hardboiled detective” entry', 'Describes the investigator as cynical after exposure to violence and corruption, often an antihero in pulp and noir fiction.'),
    ],
    { historicalConnections: ['hardboiled fiction', 'film noir'], tags: ['mystery', 'noir'] },
  ),
  makeTemplate(
    'police-inspector', 'The Police Inspector', 'crime', 'genre-convention',
    'An official investigator who must solve a case while working inside the procedures and limits of an institution.',
    'Has responsibility for a case, a team, and a record of decisions that can be scrutinized later.',
    'May follow procedure closely or bend it; the central tension is how judgment fits inside official authority.',
    'Asks for timelines and evidence, explains what can be established, and may disagree with a private investigator’s shortcuts.', 'shield',
    [
      stockListEvidence('“Police inspector / chief of police” entry', 'Places the role in detective fiction and police procedurals, describing investigative and leadership variants.'),
      source('“A nice old boy”: Characterizing the chief constable role in detective fiction c.1890–1960', 'https://pure.plymouth.ac.uk/ws/portalfiles/portal/39316319/7177%20LEADING%20THE%20POLICE%201st%20proofs.pdf', 'Chapter introduction', 'Describes police figures as recurring stock figures in late-Victorian detective tales, often used to contrast with private-detective brilliance.'),
    ],
    { historicalConnections: ['Inspector Lestrade', 'police procedural'], tags: ['mystery', 'authority', 'investigation'] },
  ),
  makeTemplate(
    'red-herring-character', 'The Red Herring Character', 'crime', 'genre-convention',
    'A suspect whose partial or misleading presentation draws attention away from the central explanation.',
    'Is known to the investigator through a few suspicious details, incomplete testimony, or an apparent motive.',
    'Choose freely: evasiveness may signal guilt in another matter, fear, privacy, or a misleading first impression.',
    'Leaves a gap in an account or answers a narrower question than the one asked. The writer decides why.', 'search',
    [stockListEvidence('“Red herring character” entry', 'Defines a mystery-fiction role that appears suspicious and temporarily draws attention away from the actual solution.')],
    { tags: ['mystery', 'narrative role'], contextNote: 'This is a narrative function, not a fixed personality or a claim of innocence. Applying the template drafts one suspect only.' },
  ),
  makeTemplate(
    'femme-fatale', 'The Femme Fatale', 'crime', 'historical-literary',
    'A noir convention in which an alluring figure becomes entangled with the investigator’s desires and risks.',
    'Has leverage, information, or goals that bring them into the investigator’s path.',
    'Strategic and hard to read, with motives that may include survival, money, protection, revenge, or something else.',
    'Controls what they reveal, tests an assumption, and may make a request sound like a bargain.', 'heart',
    [
      source('Du Maurier, Daphne (1907–1989) — Encyclopedia.com', 'https://www.encyclopedia.com/arts/culture-magazines/du-maurier-daphne-1907-1989', 'Discussion of the femme fatale and Rebecca', 'Summarizes critical accounts of the convention, its deception and threat framing, and its gendered assumptions.'),
      source('Film Noir — Encyclopedia.com', 'https://www.encyclopedia.com/literature-and-arts/performing-arts/film-and-television/film-noir', 'Discussion of women in film noir', 'Describes the femme fatale as a recurring noir figure whose agency is framed through manipulation and danger to the hero.'),
    ],
    { historicalConnections: ['film noir', 'vamp (related convention)'], tags: ['noir', 'mystery'], contextNote: 'This convention has often cast women’s independence as a threat and punished it. Keep the character’s goals, agency, and gender open to the writer.' },
  ),
  makeTemplate(
    'black-widow', 'The Black Widow', 'crime', 'genre-convention',
    'A mystery or thriller figure suspected of killing romantic partners for gain or escape.',
    'Has survived a series of relationships whose endings raise questions about motive and opportunity.',
    'Can be dangerous, falsely suspected, or more complicated than the label suggests; the writer decides what is true.',
    'Answers questions about the past with selective detail and notices which version of events the investigator believes.', 'skull',
    [
      stockListEvidence('“Black widow” entry', 'Defines a recurring crime-fiction figure as a woman suspected or shown to kill lovers, often with poison.'),
      source('Film Noir — Encyclopedia.com', 'https://www.encyclopedia.com/literature-and-arts/performing-arts/film-and-television/film-noir', 'Discussion of the femme fatale convention', 'Provides context for related noir conventions that frame women through sexual danger and suspicion.'),
    ],
    { tags: ['mystery', 'thriller'], contextNote: 'The name is a gendered thriller convention. Treat suspicion as a plot device rather than a claim about women or relationships generally.' },
  ),
  makeTemplate(
    'gentleman-thief', 'The Gentleman Thief', 'crime', 'genre-convention',
    'A polished thief who treats a theft as a contest of ingenuity, style, or selective justice.',
    'Has cultivated a public manner that gives them access to people, rooms, and objects others cannot reach.',
    'Courteous and daring, with a private code that may not satisfy the people harmed by the theft.',
    'Maintains formal manners under pressure and explains a risky plan as though it were an evening invitation.', 'key-round',
    [stockListEvidence('“Gentleman thief” entry', 'Describes a sophisticated thief who prefers deception and stealth, often avoids violence, and may choose wealthy or meaningful targets.')],
    { historicalConnections: ['A. J. Raffles', 'Arsène Lupin'], tags: ['mystery', 'heist', 'rogue'] },
  ),
  makeTemplate(
    'con-artist', 'The Con Artist', 'crime', 'genre-convention',
    'A swindler who studies what a target wants and shapes a convincing story around it.',
    'Has made a living by reading people quickly, inventing credentials, and building trust before asking for something.',
    'Adaptable and attentive, with an instinct for each person’s hopes and blind spots. Their confidence may conceal fear of exposure.',
    'Mirrors a listener’s language, offers details that sound verifiable, and redirects when the story is tested.', 'hat-glasses',
    [stockListEvidence('“Con artist” entry', 'Defines the recurring swindler through charisma, impersonation, gaining a target’s trust, and taking money or goods.')],
    { aliases: ['Confidence trickster'], historicalConnections: ['confidence game'], tags: ['crime', 'deception'] },
  ),
  makeTemplate(
    'corrupt-cop', 'The Corrupt Cop', 'crime', 'genre-convention',
    'An officer who uses the authority of the law for private gain or to protect a criminal interest.',
    'Has access to information and power through a law-enforcement role, then begins trading that access for personal benefit.',
    'Calculating and alert to risk. May hide corruption behind a respectable record or stop pretending to conceal it.',
    'Uses official language to discourage questions and knows which procedural details will sound reassuring.', 'shield',
    [stockListEvidence('“Corrupt cop / dirty cop” entry', 'Defines the character by betraying law-enforcement duties for personal gain and distinguishes the type from a rule-bending but principled officer.')],
    { aliases: ['Dirty cop'], tags: ['crime', 'institutional power'], contextNote: 'Keep the character’s wrongdoing specific to their choices; do not treat corruption as an inherent trait of real officers.' },
  ),
  makeTemplate(
    'impostor', 'The Impostor', 'crime', 'genre-convention',
    'A false claimant who borrows another person’s identity or achievements for attention, access, or profit.',
    'Has prepared a convincing account of who they are and what they have done, but parts of the story do not withstand scrutiny.',
    'Confident in performance and alert to anyone who knows the real person. May believe the role is owed to them.',
    'Repeats prepared details, claims familiarity they have not earned, and overreacts to small factual corrections.', 'drama',
    [
      stockListEvidence('“Imposter / false hero” entry', 'Defines a recurring plot type who impersonates a real hero for recognition or profit, or to entrap that hero.'),
      source('The Fraud and the Flatterer: Images of Actors on the Comic Stage — Cambridge University Press', 'https://www.cambridge.org/core/books/abs/performance-and-identity-in-the-classical-world/fraud-and-the-flatterer-images-of-actors-on-the-comic-stage/10DB927F04D1DFC5A20C9273815A98BF', 'Chapter abstract', 'Identifies the classical comic alazon as fraud, impostor, or braggart, while distinguishing it as a broader stage type.'),
    ],
    { historicalConnections: ['false hero', 'alazon (related classical type)'], tags: ['crime', 'identity', 'deception'] },
  ),

  makeTemplate(
    'bully', 'The Bully', 'school', 'genre-convention',
    'A character who uses social or physical pressure to control peers and test their boundaries.',
    'Has found that intimidation can win attention, compliance, or protection from being targeted themself.',
    'Dominating in public, with motives and vulnerabilities the writer can define without excusing the harm they cause.',
    'Uses challenges, put-downs, or loaded jokes to see whether someone will push back.', 'swords',
    [
      alloprofEvidence('Stock characters: “The bully”', 'Defines the type as a tormentor who uses intimidation tactics.'),
      stockListEvidence('“Bully” entry', 'Describes a recurring youth-story antagonist who torments a protagonist and may have followers reinforcing their authority.'),
    ],
    { tags: ['school', 'conflict'], contextNote: 'A history or vulnerability can add depth, but does not excuse coercion or require a single explanation for bullying.' },
  ),
  makeTemplate(
    'jock', 'The Jock', 'school', 'genre-convention',
    'A school-story athlete whose public identity and status are strongly tied to sport.',
    'Has invested time in athletics and is known by classmates for performance, team membership, or access to school status.',
    'May be competitive, disciplined, self-conscious, generous, or distracted by pressure. Athletic ability does not determine intelligence.',
    'Talks in the vocabulary of practice, teammates, and results; their voice can shift away from sports whenever the story calls for it.', 'trophy',
    [
      alloprofEvidence('Stock characters: “The jock”', 'Defines the character through popularity and athletic participation.'),
      stockListEvidence('“Jock” entry', 'Defines the type as a popular high-school or college athlete stereotype and describes common school-story conflicts.'),
    ],
    { tags: ['school', 'sports'], contextNote: 'This is a familiar US school-fiction convention, not a claim that athletes share one academic or social profile.' },
  ),
  makeTemplate(
    'nerd', 'The Nerd', 'school', 'genre-convention',
    'A school-story outsider whose intense interests and knowledge set them apart from the local status system.',
    'Has found belonging, purpose, or pleasure in interests that are not central to the school’s most visible social groups.',
    'Knowledgeable and focused, with a social life and strengths that need not match the old shy-genius stereotype.',
    'Gets animated around a subject they love and may be concise or uncertain elsewhere; neither trait is required.', 'glasses',
    [
      source('2.07 Stock Characters — Alabama State Department of Education', 'https://accesscms.asc.edu/AventaCourses/access_courses/theatre_ua_v18/02_unit/02-07/02-07_learn.htm', '“The Nerd Archetype” section', 'Identifies nerd as a modern character convention and describes traits and recurring high-school story roles.'),
      alloprofEvidence('Stock characters: “The nerd”', 'Defines the type through interest in knowledge and academic expertise, while noting its frequent social-awkwardness stereotype.'),
      stockListEvidence('“Nerd” entry', 'Describes the school-story convention as socially awkward, obsessive, or intellectual and notes its overlap with the related geek stereotype.'),
    ],
    { tags: ['school', 'outsider', 'interests'], contextNote: 'The familiar portrayal has relied on harmful assumptions about appearance, race, gender, and social ability. Do not infer these traits from a character’s interests.' },
  ),
  makeTemplate(
    'mean-girl', 'The Mean Girl', 'school', 'genre-convention',
    'A socially powerful student who uses popularity and exclusion to decide who belongs.',
    'Has a visible place in the school’s social hierarchy and understands how reputation travels through the group.',
    'Strategic, status-conscious, and capable of cruelty. The writer can give her ambitions and relationships beyond the rivalry.',
    'Uses compliments with a second meaning, speaks for the group, and keeps conflict deniable when adults are near.', 'crown',
    [stockListEvidence('“Mean girl” entry', 'Defines the recurring school-fiction type as a popular student who uses status to bully others.')],
    { aliases: ['Queen Bee', 'School Diva'], tags: ['school', 'social status'], contextNote: 'Popularity is a story convention, not an explanation for girls’ behavior generally. The writer can choose the character’s gender and social position.' },
  ),
  makeTemplate(
    'preppy', 'The Preppy', 'school', 'genre-convention',
    'A student whose polished style signals familiarity with an affluent school or social world.',
    'Has learned the dress codes, manners, and expectations of a privileged peer group.',
    'May be gracious, ambitious, entitled, or self-conscious about belonging. Money or clothes alone do not define their character.',
    'Uses polished manners and references to shared institutions; can drop the performance in private.', 'briefcase',
    [stockListEvidence('“Preppy” entry', 'Identifies the preppy as a recurring 1980s film and television figure associated with affluent students and upper-class presentation.')],
    { tags: ['school', 'class', 'status'], contextNote: 'The reference is a US media convention, especially associated with 1980s settings. Avoid treating class markers as personality.' },
  ),
  makeTemplate(
    'tomboy', 'The Tomboy', 'school', 'historical-literary',
    'A gendered coming-of-age convention for a girl who rejects activities and presentation expected of her.',
    'Has had to negotiate expectations about how a girl should dress, play, move, or speak.',
    'Independent and comfortable following her interests, while the story decides whether those interests challenge a local rule or simply fit her.',
    'Speaks plainly and can question a rule that others accept without discussion.', 'flame',
    [stockListEvidence('“Tomboy” entry', 'Describes the recurring coming-of-age convention and the historical gender expectations it can either resist or reproduce.')],
    { tags: ['school', 'coming of age'], contextNote: '“Tomboy” is a gendered historical label. It does not determine a character’s gender identity, sexuality, appearance, or eventual choices.' },
  ),
  makeTemplate(
    'schoolmaster', 'The Schoolmaster', 'school', 'genre-convention',
    'A teacher whose approach to discipline or mentorship shapes the tone of a school story.',
    'Is responsible for a class and has developed a recognizable way to hold students’ attention or authority.',
    'Can be strict, inspiring, indifferent, or unexpectedly playful; the writer chooses how teaching changes under pressure.',
    'Uses classroom questions, corrections, or brief instructions to guide a group without taking over the scene.', 'book-open',
    [stockListEvidence('“Schoolmaster” entry', 'Describes a recurring school-story figure with contrasting disciplinarian, respected mentor, and laid-back variants.')],
    { tags: ['school', 'authority', 'mentor'] },
  ),
  makeTemplate(
    'headmaster', 'The Headmaster / Headmistress', 'school', 'genre-convention',
    'The school’s chief authority, whose decisions can protect students or make institutional pressure visible.',
    'Has responsibility for a school’s reputation, rules, staff, and student welfare.',
    'May be supportive, rigid, political, or divided between competing duties. Authority does not require age, gender, or cruelty.',
    'Speaks in policies and consequences, but may become more personal in a private conversation.', 'graduation-cap',
    [stockListEvidence('“Headmaster / Headmistress” entry', 'Describes the recurring school-fiction authority as either a guide or a strict disciplinarian, including magical-school variants.')],
    { aliases: ['School principal'], tags: ['school', 'authority'], contextNote: 'The historical headmaster label and school conventions vary by region. The writer chooses title, gender, age, and leadership style.' },
  ),

  makeTemplate(
    'wise-old-man', 'The Wise Old Man', 'fantasy', 'historical-literary',
    'An experienced guide whose knowledge can help a protagonist see choices they could not yet see.',
    'Has lived through enough change to recognize patterns and consequences that younger characters have not encountered.',
    'Thoughtful and discerning, but not all-knowing. Their advice may reflect limits, regrets, or a particular point of view.',
    'Uses stories, questions, and carefully chosen silences rather than solving every problem for the protagonist.', 'book-open',
    [
      alloprofEvidence('Stock characters: “The old master / wise old man”', 'Defines the role as an experienced mentor or counselor.'),
      stockListEvidence('“Wise old man / wizard” entry', 'Describes the recurring mentor as an experienced guide who offers stories, judgment, and direction.'),
    ],
    { historicalConnections: ['sage / mentor', 'wizard (a related fantasy role)'], tags: ['fantasy', 'mentor'], contextNote: 'A familiar convention often ties wisdom to old age and masculinity. The role’s knowledge, age, and gender are choices, not requirements.' },
  ),
  makeTemplate(
    'enchantress', 'The Enchantress', 'fantasy', 'historical-literary',
    'A magical figure whose knowledge or gifts alter the protagonist’s options.',
    'Has learned to work with forces that other characters do not understand or can no longer control.',
    'Perceptive and self-directed, with reasons for helping that may not align neatly with the hero’s plans.',
    'Speaks in images, bargains, or precise warnings; may be more direct than the protagonist expects.', 'sparkles',
    [stockListEvidence('“Enchantress / priestess / sorceress” entry', 'Describes a recurring fantasy figure who advises a protagonist or provides a magical aid, and gives examples.')],
    { aliases: ['Sorceress'], historicalConnections: ['Lady of the Lake', 'Glinda'], tags: ['fantasy', 'magic'], contextNote: 'The source tradition often casts magical guides as women. The writer can choose any gender and any motive for the role.' },
  ),
  makeTemplate(
    'dark-lord', 'The Dark Lord', 'fantasy', 'genre-convention',
    'A distant antagonist whose desire for domination threatens a whole imagined world.',
    'Rules or seeks to rule from a territory shaped by their power and the fear it creates.',
    'Patient, commanding, and convinced that control is worth its cost. The story can complicate or overturn that certainty.',
    'Makes few words carry authority, speaks of order as justification, and treats resistance as a problem to be managed.', 'skull',
    [
      source('Quest fantasies — The Cambridge Companion to Fantasy Literature', 'https://www.cambridge.org/core/books/abs/cambridge-companion-to-fantasy-literature/quest-fantasies/3900A981D4385C2C6DF48BBBB3973DA0', 'Chapter summary', 'Describes the Dark Lord as a conventional quest-fantasy menace who seeks to enslave and dominate the world.'),
      stockListEvidence('“Dark lord” entry', 'Describes the conventional fantasy antagonist as a powerful ruler whose influence threatens the hero’s world.'),
    ],
    { tags: ['fantasy', 'antagonist', 'power'] },
  ),
  makeTemplate(
    'necromancer', 'The Necromancer', 'fantasy', 'genre-convention',
    'A magic-user whose work with death, memory, or the dead makes a story’s moral limits tangible.',
    'Has pursued knowledge or power that other characters regard as forbidden or dangerous.',
    'May be cruel, curious, grieving, pragmatic, or protective; the practice itself does not determine motive.',
    'Speaks precisely about what can be restored, what must remain lost, and who bears the cost.', 'ghost',
    [stockListEvidence('“Necromancer / sorcerer / black magician” entry', 'Describes the recurring fantasy role through forbidden magic, the dead, and ambitions that may make the figure a larger antagonist.')],
    { tags: ['fantasy', 'magic', 'death'], contextNote: 'The entry is a genre role, not a real-world spiritual tradition. The writer chooses the magic’s rules and moral meaning.' },
  ),
  makeTemplate(
    'prince-charming', 'Prince Charming', 'fantasy', 'historical-literary',
    'A fairy-tale romantic figure whose arrival appears to promise rescue, status, or a happy ending.',
    'Enters a story where a romantic union has been framed as a solution to danger or constraint.',
    'Can be genuinely brave and generous, or can reveal the limits of a role that rewards appearance over understanding.',
    'Uses gracious, assured language and may be surprised when the person he hopes to rescue has plans of their own.', 'crown',
    [
      encyclopediaEvidence('Opening definition and examples', 'Names the hero and damsel in distress as recognizable stock-character examples.'),
      stockListEvidence('“Prince Charming” entry', 'Describes the recurring fairy-tale romantic hero who rescues a damsel or undertakes a quest.')
    ],
    { historicalConnections: ['fairy-tale prince', 'Cinderella and Sleeping Beauty variants'], tags: ['fairy tale', 'romance'], contextNote: 'The role traditionally treats rescue and marriage as rewards. The writer can change the character’s gender, agency, or outcome.' },
  ),
  makeTemplate(
    'damsel-in-distress', 'The Damsel in Distress', 'fantasy', 'historical-literary',
    'A fairy-tale or adventure role in which a character’s peril creates a rescue quest.',
    'Faces a danger that brings other characters into action, while retaining plans and choices of their own.',
    'The story decides whether they are waiting for help, resisting capture, negotiating, or pursuing an escape.',
    'Can communicate urgency, strategy, or refusal; peril need not make the character passive.', 'heart',
    [
      encyclopediaEvidence('Opening definition and examples', 'Names the damsel in distress as a recognizable stock figure and explains its audience-familiar role.'),
      stockListEvidence('“Damsel in distress” entry', 'Defines the rescue convention and notes how its helplessness reflects historical social assumptions about women.')
    ],
    { historicalConnections: ['chivalric romance', 'fairy tale'], tags: ['fairy tale', 'narrative role'], contextNote: 'This convention has often reduced women to helplessness and made rescue the plot’s goal. It does not prescribe a character’s gender or agency.' },
  ),
  makeTemplate(
    'wicked-stepmother', 'The Wicked Stepmother', 'fantasy', 'historical-literary',
    'A fairy-tale antagonist who turns a household into a place of rivalry, exclusion, or control.',
    'Has formed a new family arrangement and believes security or status depends on controlling the household.',
    'Can be calculating, jealous, or cruel, while the writer decides what history and interests lie beyond that role.',
    'Uses rules and obligations to make unfair treatment sound ordinary, especially when other people are listening.', 'drama',
    [
      source('Lang, Andrew 1844–1912 — Encyclopedia.com', 'https://www.encyclopedia.com/children/academic-and-educational-journals/lang-andrew-1844-1912', 'Discussion of Cinderella and fairy-tale stepmothers', 'Discusses the domineering stepmother as a recurring fairy-tale figure and notes the gender assumptions in traditional portrayal.'),
      stockListEvidence('“Wicked stepmother” entry', 'Describes a recurring folklore and fairy-tale antagonist who mistreats a spouse’s children from an earlier marriage.')
    ],
    { historicalConnections: ['Cinderella tales', 'fairy-tale foster parent'], tags: ['fairy tale', 'family'], contextNote: 'This type rests on a gendered fairy-tale convention. It is not a claim about stepfamilies or stepmothers in real life.' },
  ),
  makeTemplate(
    'black-knight', 'The Black Knight', 'fantasy', 'historical-literary',
    'A masked or unnamed armored opponent whose identity and allegiance intensify a trial of courage.',
    'Appears in armor that conceals their identity and signals allegiance to a rival power or private code.',
    'Formidable and guarded; the story can reveal a loyal defender, a mistaken opponent, or a true antagonist beneath the disguise.',
    'Speaks little before a challenge and may reveal status through formal vows or a refusal to name themself.', 'shield',
    [stockListEvidence('“Black knight” entry', 'Describes the recurring masked warrior as an antagonist who conceals identity and challenges a knight-errant.')],
    { historicalConnections: ['knight-errant', 'medieval romance'], tags: ['fantasy', 'adventure', 'mystery'] },
  ),
  makeTemplate(
    'knight-errant', 'The Knight-Errant', 'fantasy', 'historical-literary',
    'A wandering knight who takes on quests in pursuit of honor, justice, or an idealized beloved.',
    'Has left a settled place to pursue a vow, a difficult task, or a cause that tests their ideals.',
    'Brave and purposeful, though an ideal can make them naïve about the people and costs their quest touches.',
    'Frames choices as vows and duties, and must decide when a promise should yield to a person’s needs.', 'swords',
    [stockListEvidence('“Knight-errant” entry', 'Describes the wandering knight’s quest and courtly devotion within medieval story conventions.')],
    { historicalConnections: ['Arthurian romance', 'quest romance'], tags: ['fantasy', 'adventure', 'quest'] },
  ),
  makeTemplate(
    'fallen-hero', 'The Fallen Hero', 'fantasy', 'genre-convention',
    'A former champion whose past failure or turn to harm becomes a test for a new protagonist.',
    'Was once trusted with a purpose or power but now lives with the consequences of a decisive change.',
    'May be remorseful, self-justifying, or still convinced that a harmful choice was necessary.',
    'Avoids talking about the turning point until a present-day choice forces the old reasoning into the open.', 'flame',
    [stockListEvidence('“Fallen hero” entry', 'Defines the recurring fantasy and wuxia antagonist as a former pupil or predecessor who turned against the hero’s cause.')],
    { historicalConnections: ['wuxia fiction', 'former chosen one'], tags: ['fantasy', 'redemption', 'antagonist'] },
  ),

  makeTemplate(
    'absent-minded-professor', 'The Absent-Minded Professor', 'comic', 'genre-convention',
    'An expert whose intense focus makes everyday details easy to overlook.',
    'Has devoted sustained effort to a demanding subject and is often pulled back into it by a new question.',
    'Curious and bright, with practical habits that may be uneven but need not imply incompetence.',
    'Wanders into an explanation, forgets a minor errand, and becomes exact when discussing their work.', 'flask-conical',
    [
      alloprofEvidence('Stock characters: “The absent-minded professor”', 'Defines the character as brilliant in a field but forgetful or inadequate in other areas.'),
      stockListEvidence('“Absent-minded professor / boffin” entry', 'Describes the recurring scientific genius whose work focus creates shortfalls in other areas of life.'),
    ],
    { aliases: ['Boffin'], historicalConnections: ['mad scientist (a darker related convention)'], tags: ['comedy', 'science'] },
  ),
  makeTemplate(
    'mad-scientist', 'The Mad Scientist', 'comic', 'genre-convention',
    'A speculative-fiction figure whose experiment crosses ethical or practical limits.',
    'Has devoted time, resources, and identity to an experiment that other people fear or do not understand.',
    'Brilliant or merely convinced of brilliance; the key tension is what they are willing to risk for a result.',
    'Describes the next experiment as inevitable and treats objections as evidence that others lack vision.', 'flask-conical',
    [
      stockListEvidence('“Mad scientist” entry', 'Defines the recurring scientist as eccentric or obsessive, often amoral or driven past sound judgment by experiments.'),
      alloprofEvidence('Stock characters: “The mad scientist”', 'Defines the type through scientific brilliance and experiments that may disregard moral or ethical limits.'),
      source('The Irelands that we dreamed of: Irish science fiction from the 1850s to the present', 'https://www.academia.edu/91712265/The_Irelands_that_we_dreamed_of_Irish_science_fiction_from_the_1850s_to_the_present', 'Discussion of the Romantic-era mad scientist', 'Places the mad scientist within a literary history of speculative fiction and describes its Faustian and Promethean inheritance.'),
    ],
    { historicalConnections: ['Frankenstein’s scientist', 'Faustian figure'], tags: ['science fiction', 'horror', 'ethics'], contextNote: 'Mental illness is not the cause of unethical science. Treat the label as an old genre convention, not a diagnosis.' },
  ),
  makeTemplate(
    'lovable-rogue', 'The Lovable Rogue', 'comic', 'genre-convention',
    'A rule-breaker whose charm or loyalty keeps an audience invested despite their selfish choices.',
    'Has learned to survive through improvisation, minor schemes, or a willingness to bend rules.',
    'Self-interested and resourceful, with moments of care that complicate the harm they can cause.',
    'Uses wit to avoid embarrassment and becomes unexpectedly sincere when someone else is at risk.', 'key-round',
    [
      alloprofEvidence('Stock characters: “The lovable rogue”', 'Defines the character as a charming lawbreaker and gives Robin Hood as an example.'),
      source('Lovable rogue', 'https://en.wikipedia.org/wiki/Lovable_rogue', 'Opening definition', 'Defines the lovable rogue as a recurring fictional character who defies conventions but remains sympathetic.'),
      stockListEvidence('“Lovable rogue” cross-references', 'Uses the type for characters such as the Artful Dodger and notes its relationship to rogues and antiheroes.')
    ],
    { historicalConnections: ['picaro (related picaresque figure)', 'antihero'], tags: ['comedy', 'adventure', 'rogue'] },
  ),
  makeTemplate(
    'jester', 'The Jester', 'comic', 'historical-literary',
    'A comic performer who can say what others cannot by presenting truth as entertainment.',
    'Has a recognized place near a powerful household or audience and knows how to hold their attention.',
    'Playful and observant, using performance both to entertain and to test how much truth the room can tolerate.',
    'Uses riddles, wordplay, songs, or mock praise to make a serious point easier to hear.', 'smile',
    [
      stockListEvidence('“Fool” entry on court jesters', 'Describes the court jester’s comic performance and the latitude to criticize powerful people through wit.'),
      source('One type of stock character often used by Shakespeare is the fool — Yale National Initiative', 'https://teachers.yale.edu/curriculum/units/2011/1/8/3', 'Discussion of fool characters', 'Describes the fool as a recurring stage figure whose songs, riddles, and wordplay provide humor and can expose truth.')
    ],
    { historicalConnections: ['court fool', 'Shakespearean fool'], tags: ['comedy', 'theater', 'power'] },
  ),
  makeTemplate(
    'foolish-braggart', 'The Foolish Braggart', 'comic', 'historical-literary',
    'A self-important boaster who claims qualities, expertise, or status their actions do not support.',
    'Has built an identity around being admired and tells stories that make their importance difficult to question.',
    'Self-deceiving as often as deliberately dishonest; their need to impress can make them ridiculous and occasionally pitiable.',
    'Inflates modest successes, borrows technical language, and becomes vague when asked for a concrete example.', 'drama',
    [
      source('New Comedic Alazoneia — Oxford Scholarship Online', 'https://academic.oup.com/book/27076/chapter-abstract/196411396', 'Chapter abstract', 'Explains the alazon as a broad comic boaster or impostor who pretends to qualities they do not possess.'),
      source('The Fraud and the Flatterer: Images of Actors on the Comic Stage — Cambridge University Press', 'https://www.cambridge.org/core/books/abs/performance-and-identity-in-the-classical-world/fraud-and-the-flatterer-images-of-actors-on-the-comic-stage/10DB927F04D1DFC5A20C9273815A98BF', 'Chapter abstract', 'Identifies the alazon as the fraud, impostor, or braggart and distinguishes this broad comic type.'),
    ],
    { historicalConnections: ['alazon (Greek Old Comedy)', 'eiron (contrasting underplayer)'], tags: ['comedy', 'vanity', 'deception'] },
  ),
  makeTemplate(
    'harlequin', 'Harlequin', 'comic', 'historical-literary',
    'A nimble commedia servant whose physical skill and appetite can make cleverness collide with gullibility.',
    'Has little wealth or status and depends on speed, performance, and opportunism to get by.',
    'Acrobatic, hungry, and impulsive. Their ingenuity coexists with gullibility and practical blind spots.',
    'Moves quickly between jokes, complaints, and sudden physical business; may misunderstand a plan they helped start.', 'theater',
    [
      metEvidence('Paragraph on Arlecchino / Harlequin', 'Describes Harlequin as poor, acrobatic, gluttonous, illiterate, and gullible; it also identifies the historical spelling Arlecchino.'),
      stockListEvidence('“Harlequin” entry', 'Identifies the comic servant and lists its costume, physical comedy, and relationship with Columbina.')
    ],
    { aliases: ['Arlecchino'], historicalConnections: ['commedia dell’arte', 'Columbina / Colombina'], tags: ['comedy', 'commedia', 'servant'] },
  ),
];

export { stockCharacterTemplates };
