import { describe, expect, it } from 'vitest';
import { stockCharacterCategories, stockCharacterTemplates } from './stock-characters';

const allowedIcons = new Set([
  'user', 'crown', 'coins', 'swords', 'shield', 'book-open', 'feather', 'heart', 'sparkles',
  'wand-sparkles', 'skull', 'search', 'fingerprint', 'key-round', 'drama', 'glasses',
  'graduation-cap', 'trophy', 'flame', 'theater', 'flask-conical', 'compass', 'ghost',
  'smile', 'music', 'gem', 'star', 'moon', 'hat-glasses', 'hand-heart', 'briefcase', 'bird',
]);
const stableExistingIds = [
  'miser', 'braggart-soldier', 'clever-servant', 'young-lovers', 'pedant', 'trickster-servant',
  'innocent-fool', 'coquettish-maid', 'jealous-guardian', 'dandy', 'fop', 'rake', 'ingenue',
  'byronic-hero', 'girl-next-door', 'boy-next-door', 'pollyanna', 'lovable-loser', 'spinster',
  'holmesian-detective', 'hardboiled-detective', 'police-inspector', 'red-herring-character',
  'femme-fatale', 'black-widow', 'gentleman-thief', 'con-artist', 'corrupt-cop', 'impostor',
  'bully', 'jock', 'nerd', 'mean-girl', 'preppy', 'tomboy', 'schoolmaster', 'headmaster',
  'wise-old-man', 'enchantress', 'dark-lord', 'necromancer', 'prince-charming', 'damsel-in-distress',
  'wicked-stepmother', 'black-knight', 'knight-errant', 'fallen-hero', 'absent-minded-professor',
  'mad-scientist', 'lovable-rogue', 'jester', 'foolish-braggart', 'harlequin',
];
const ensembleRoleIds = ['leader', 'lancer', 'brains', 'powerhouse', 'heart'];

describe('stock character catalog', () => {
  it('contains a broad, stable set of uniquely identified templates', () => {
    const ids = stockCharacterTemplates.map(template => template.id);
    const titles = stockCharacterTemplates.map(template => template.title);

    expect(stockCharacterTemplates).toHaveLength(58);
    expect(ids).toEqual([...stableExistingIds, ...ensembleRoleIds]);
    expect(new Set(ids).size).toBe(ids.length);
    expect(new Set(titles).size).toBe(titles.length);
    expect(ids.every(id => /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(id))).toBe(true);
  });

  it('uses only declared categories, standings, and supported icon identifiers', () => {
    const categories = new Set(stockCharacterCategories.map(category => category.id));
    expect(stockCharacterCategories.map(category => category.id)).toEqual([
      'classical', 'social', 'crime', 'school', 'fantasy', 'comic', 'ensemble',
    ]);
    expect(new Set(stockCharacterCategories.map(category => category.label)).size).toBe(stockCharacterCategories.length);
    expect(stockCharacterCategories.every(category => allowedIcons.has(category.icon))).toBe(true);

    for (const template of stockCharacterTemplates) {
      expect(categories.has(template.category), template.id).toBe(true);
      expect(['historical-literary', 'genre-convention', 'ensemble-function']).toContain(template.standing);
      expect(allowedIcons.has(template.icon), template.id).toBe(true);
      expect(template.tags.every(tag => tag.trim().length > 0), template.id).toBe(true);
    }
  });

  it('provides usable draft text and verified, locatable source claims for every entry', () => {
    for (const template of stockCharacterTemplates) {
      expect(template.summary.trim().length, `${template.id} summary`).toBeGreaterThan(20);
      expect(template.background.trim().length, `${template.id} background`).toBeGreaterThan(20);
      expect(template.personality.trim().length, `${template.id} personality`).toBeGreaterThan(20);
      expect(template.voice.trim().length, `${template.id} voice`).toBeGreaterThan(20);
      expect(template.sources.length, `${template.id} sources`).toBeGreaterThan(0);
      expect(template.sources.every(item => item.verified), `${template.id} has an unverified source`).toBe(true);

      for (const citation of template.sources) {
        expect(citation.title.trim().length, `${template.id} source title`).toBeGreaterThan(0);
        expect(citation.locator.trim().length, `${template.id} source locator`).toBeGreaterThan(0);
        expect(citation.claim.trim().length, `${template.id} source claim`).toBeGreaterThan(20);
        expect(citation.url, `${template.id} source URL`).toMatch(/^https:\/\//);
      }
    }
  });

  it('keeps narrative roles and historical social conventions qualified', () => {
    const byId = new Map(stockCharacterTemplates.map(template => [template.id, template]));

    expect(byId.get('young-lovers')?.contextNote).toMatch(/one character only/i);
    expect(byId.get('red-herring-character')?.contextNote).toMatch(/narrative plot function/i);
    expect(byId.get('red-herring-character')?.personality).toMatch(/actual personality and motive are up to the writer/i);
    expect(byId.get('ingenue')?.contextNote).toMatch(/historical stage and story convention/i);
    expect(byId.get('spinster')?.contextNote).toMatch(/dismissive label/i);
    expect(byId.has('elderly-martial-arts-master')).toBe(false);
    expect(byId.has('town-drunk')).toBe(false);
    expect(byId.has('annoying-neighbor')).toBe(false);
    expect(byId.has('forger')).toBe(false);
  });

  it('keeps Five-Man Band roles as separately reusable, optional ensemble functions', () => {
    const byId = new Map(stockCharacterTemplates.map(template => [template.id, template]));
    const roles = stockCharacterTemplates.filter(template => template.category === 'ensemble');
    const matchesSearch = (query: string) => roles.filter(template => [template.title, ...template.aliases, ...template.tags, template.summary]
      .join(' ').toLocaleLowerCase().includes(query)).map(template => template.id);

    expect(roles.map(template => template.id)).toEqual(ensembleRoleIds);
    expect(roles.every(template => template.standing === 'ensemble-function')).toBe(true);
    expect(roles.every(template => template.aliases.includes('Five-Man Band role'))).toBe(true);
    expect(matchesSearch('five-man band')).toEqual(ensembleRoleIds);
    expect(matchesSearch('five man band')).toEqual(ensembleRoleIds);
    expect(matchesSearch('5 man band')).toEqual(ensembleRoleIds);
    expect(byId.get('powerhouse')?.summary).toMatch(/force, strength, or decisive action/i);
    expect(byId.get('powerhouse')?.contextNote).toMatch(/physical strength/i);
    expect(byId.get('heart')?.contextNote).toMatch(/caretaking, mediation, or emotional labor/i);
    expect(roles.every(template => /overlap|shift/i.test(template.contextNote ?? ''))).toBe(true);
    expect(stockCharacterTemplates.every(template => !(
      'toneId' in template || 'emotionId' in template || 'defaultToneId' in template || 'defaultEmotionId' in template
    ))).toBe(true);
  });
});
