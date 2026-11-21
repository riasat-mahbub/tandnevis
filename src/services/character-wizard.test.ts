import { describe, expect, it } from 'vitest';
import {
  characterWizardCanVisit,
  characterWizardCreateOperation,
  characterWizardHasPersonalEdits,
  characterWizardReducer,
  createCharacterWizard,
  validateCharacterWizardName,
} from './character-wizard';
import type { CharacterWizardState, CharacterWizardStockStartingPoint } from './character-wizard';

const stock = (overrides: Partial<CharacterWizardStockStartingPoint> = {}): CharacterWizardStockStartingPoint => ({
  kind: 'stock', templateId: 'mentor', title: 'The Mentor', icon: 'book-open',
  background: 'Once trained a hero.', personality: 'Patient and observant.', voice: 'Offers brief, precise advice.',
  ...overrides,
});

function reduce(state: CharacterWizardState, ...actions: Parameters<typeof characterWizardReducer>[1][]) {
  return actions.reduce(characterWizardReducer, state);
}

function reviewState(name = ' Rae '): CharacterWizardState {
  const state = createCharacterWizard({ projectSessionId: 'session-1', origin: { kind: 'library' } });
  return reduce(state,
    { type: 'CHOOSE_BLANK' },
    { type: 'SET_FIELD', field: 'name', value: name },
    { type: 'REVIEW_NOW' },
  );
}

describe('character creation wizard state', () => {
  it('keeps a blank starting choice local and advances with empty optional fields', () => {
    const initial = createCharacterWizard({ projectSessionId: 'session-1', origin: { kind: 'scene', sceneId: 'scene-1', sceneTitle: 'The Crossing' } });
    const state = characterWizardReducer(initial, { type: 'CHOOSE_BLANK' });

    expect(state.step).toBe('identity');
    expect(state.origin).toEqual({ kind: 'scene', sceneId: 'scene-1', sceneTitle: 'The Crossing' });
    expect(state.appliedStartingPoint).toEqual({ kind: 'blank' });
    expect(state.draft).toEqual({ name: '', background: '', personality: '', voice: '', icon: '', iconExplicitlyChosen: false });
    expect(state.visitedSteps).toEqual(['starting-point', 'identity']);
    expect(characterWizardHasPersonalEdits(state)).toBe(false);
  });

  it('keeps stock previews provisional until Use type applies the suggestions', () => {
    const initial = createCharacterWizard({ projectSessionId: 'session-1', origin: { kind: 'library' } });
    const preview = characterWizardReducer(initial, { type: 'PREVIEW_STARTING_POINT', point: stock() });
    expect(preview.step).toBe('starting-point');
    expect(preview.appliedStartingPoint).toBeNull();
    expect(preview.provisionalStartingPoint).toEqual(stock());
    expect(preview.draft).toMatchObject({ name: '', background: '', personality: '', voice: '', icon: '', iconExplicitlyChosen: false });
    expect(preview.browser.selectedId).toBe('mentor');

    const applied = characterWizardReducer(preview, { type: 'APPLY_PROVISIONAL_STARTING_POINT' });
    expect(applied.step).toBe('identity');
    expect(applied.appliedStartingPoint).toEqual(stock());
    expect(applied.provisionalStartingPoint).toBeNull();
    expect(applied.draft).toMatchObject({ name: '', background: stock().background, personality: stock().personality, voice: stock().voice, icon: 'book-open', iconExplicitlyChosen: false });
    expect(applied.visitedSteps).toEqual(['starting-point', 'identity']);
    expect(characterWizardHasPersonalEdits(applied)).toBe(false);
  });

  it('confirms profile replacement and preserves name and an explicitly chosen icon', () => {
    const first = stock();
    const other = stock({ templateId: 'detective', title: 'The Detective', icon: 'search', background: 'Studies a difficult case.', personality: 'Skeptical and exacting.', voice: 'Asks narrow questions.' });
    let state = createCharacterWizard({ projectSessionId: 'session-1', origin: { kind: 'library' } });
    state = reduce(state,
      { type: 'PREVIEW_STARTING_POINT', point: first },
      { type: 'APPLY_PROVISIONAL_STARTING_POINT' },
      { type: 'SET_FIELD', field: 'name', value: 'Rae' },
      { type: 'SET_FIELD', field: 'background', value: 'A private investigator who left the city.' },
      { type: 'SET_ICON', icon: 'bird' },
      { type: 'SHOW_STARTING_CHOICES' },
      { type: 'OPEN_CATALOG' },
      { type: 'PREVIEW_STARTING_POINT', point: other },
      { type: 'APPLY_PROVISIONAL_STARTING_POINT' },
    );

    expect(state.step).toBe('starting-point');
    expect(state.startingPointConfirmation).toEqual({ target: other, fields: ['background', 'personality', 'voice'] });
    expect(state.appliedStartingPoint).toEqual(first);
    expect(state.draft).toMatchObject({ name: 'Rae', background: 'A private investigator who left the city.', icon: 'bird', iconExplicitlyChosen: true });

    const kept = characterWizardReducer(state, { type: 'CONFIRM_STARTING_POINT_CHANGE', confirmed: false });
    expect(kept.startingPointConfirmation).toBeNull();
    expect(kept.provisionalStartingPoint).toBeNull();
    expect(kept.appliedStartingPoint).toEqual(first);
    expect(kept.draft).toEqual(state.draft);

    const confirmed = reduce(kept,
      { type: 'PREVIEW_STARTING_POINT', point: other },
      { type: 'APPLY_PROVISIONAL_STARTING_POINT' },
      { type: 'CONFIRM_STARTING_POINT_CHANGE', confirmed: true },
    );
    expect(confirmed.step).toBe('identity');
    expect(confirmed.appliedStartingPoint).toEqual(other);
    expect(confirmed.draft).toMatchObject({ name: 'Rae', background: other.background, personality: other.personality, voice: other.voice, icon: 'bird', iconExplicitlyChosen: true });
  });

  it('lets the writer reset an icon to the default person while retaining that explicit choice', () => {
    let state = createCharacterWizard({ projectSessionId: 'session-1', origin: { kind: 'library' } });
    state = reduce(state,
      { type: 'PREVIEW_STARTING_POINT', point: stock() },
      { type: 'APPLY_PROVISIONAL_STARTING_POINT' },
      { type: 'RESET_ICON' },
      { type: 'SHOW_STARTING_CHOICES' },
      { type: 'OPEN_CATALOG' },
      { type: 'PREVIEW_STARTING_POINT', point: stock({ templateId: 'detective', icon: 'search' }) },
      { type: 'APPLY_PROVISIONAL_STARTING_POINT' },
    );
    expect(state.draft.icon).toBe('');
    expect(state.draft.iconExplicitlyChosen).toBe(true);
  });

  it('lets an untouched suggested icon follow a newly applied stock type', () => {
    const second = stock({ templateId: 'detective', title: 'The Detective', icon: 'search' });
    let state = createCharacterWizard({ projectSessionId: 'session-1', origin: { kind: 'library' } });
    state = reduce(state,
      { type: 'PREVIEW_STARTING_POINT', point: stock() },
      { type: 'APPLY_PROVISIONAL_STARTING_POINT' },
      { type: 'SHOW_STARTING_CHOICES' },
      { type: 'OPEN_CATALOG' },
      { type: 'PREVIEW_STARTING_POINT', point: second },
      { type: 'APPLY_PROVISIONAL_STARTING_POINT' },
    );
    expect(state.startingPointConfirmation).toBeNull();
    expect(state.appliedStartingPoint).toEqual(second);
    expect(state.draft.icon).toBe('search');
    expect(state.draft.iconExplicitlyChosen).toBe(false);
  });

  it('returns from a Review edit to Review and skips details for Review now', () => {
    let state = reviewState(' Rae ');
    expect(state.step).toBe('review');
    expect(characterWizardCanVisit(state, 'review')).toBe(true);
    expect(characterWizardCanVisit(state, 'details')).toBe(false);

    state = characterWizardReducer(state, { type: 'EDIT_REVIEW_SECTION', section: 'identity' });
    expect(state.step).toBe('identity');
    expect(state.reviewReturnStep).toBe('identity');
    state = characterWizardReducer(state, { type: 'SET_FIELD', field: 'name', value: 'Rae Calder' });
    state = characterWizardReducer(state, { type: 'NEXT' });
    expect(state.step).toBe('review');
    expect(state.reviewReturnStep).toBe('identity');
    expect(state.draft.name).toBe('Rae Calder');

    state = characterWizardReducer(state, { type: 'BACK' });
    expect(state.step).toBe('identity');
  });

  it('backs from Review to the step used to reach it, even after optional details were visited', () => {
    let state = createCharacterWizard({ projectSessionId: 'session-1', origin: { kind: 'library' } });
    state = reduce(state,
      { type: 'CHOOSE_BLANK' },
      { type: 'SET_FIELD', field: 'name', value: 'Rae' },
      { type: 'NEXT' }, // details
      { type: 'BACK' }, // identity
      { type: 'REVIEW_NOW' },
    );
    expect(state.step).toBe('review');
    expect(state.reviewReturnStep).toBe('identity');
    state = characterWizardReducer(state, { type: 'BACK' });
    expect(state.step).toBe('identity');
  });

  it('lets the step indicator revisit completed steps and blocks future steps', () => {
    let state = createCharacterWizard({ projectSessionId: 'session-1', origin: { kind: 'library' } });
    expect(characterWizardReducer(state, { type: 'GO_TO_STEP', step: 'details' })).toBe(state);
    state = reduce(state,
      { type: 'CHOOSE_BLANK' },
      { type: 'SET_FIELD', field: 'name', value: 'Rae' },
      { type: 'NEXT' },
      { type: 'NEXT' },
    );
    expect(state.step).toBe('review');
    state = characterWizardReducer(state, { type: 'GO_TO_STEP', step: 'identity' });
    expect(state.step).toBe('identity');
    expect(state.reviewReturnStep).toBe('identity');
    state = characterWizardReducer(state, { type: 'NEXT' });
    expect(state.step).toBe('review');
    state = characterWizardReducer(state, { type: 'GO_TO_STEP', step: 'starting-point' });
    expect(state.step).toBe('starting-point');
    state = characterWizardReducer(state, { type: 'GO_TO_STEP', step: 'identity' });
    expect(state.step).toBe('identity');
    expect(state.reviewReturnStep).toBeNull();
  });

  it('preserves catalog search, category, selected item, and scroll through navigation', () => {
    const point = stock();
    let state = createCharacterWizard({ projectSessionId: 'session-1', origin: { kind: 'scene', sceneId: 'scene-2' } });
    state = reduce(state,
      { type: 'OPEN_CATALOG' },
      { type: 'SET_BROWSER', patch: { query: 'mentor', category: 'classical', scrollTop: 314 } },
      { type: 'PREVIEW_STARTING_POINT', point },
      { type: 'APPLY_PROVISIONAL_STARTING_POINT' },
      { type: 'SET_FIELD', field: 'name', value: 'Rae' },
      { type: 'NEXT' },
      { type: 'BACK' },
      { type: 'SHOW_STARTING_CHOICES' },
      { type: 'OPEN_CATALOG' },
    );
    expect(state.browser).toEqual({ view: 'catalog', query: 'mentor', category: 'classical', selectedId: 'mentor', scrollTop: 314 });
    expect(state.draft.name).toBe('Rae');
    expect(state.appliedStartingPoint).toEqual(point);
  });

  it('discards browsing-only state immediately and confirms when personal values would be lost', () => {
    let state = createCharacterWizard({ projectSessionId: 'session-1', origin: { kind: 'library' } });
    state = characterWizardReducer(state, { type: 'OPEN_CATALOG' });
    state = characterWizardReducer(state, { type: 'REQUEST_CANCEL' });
    expect(state.cancel.status).toBe('discarded');

    state = reviewState('Rae');
    state = characterWizardReducer(state, { type: 'REQUEST_CANCEL' });
    expect(state.cancel.status).toBe('confirm');
    state = characterWizardReducer(state, { type: 'KEEP_WORKING' });
    expect(state.cancel.status).toBe('none');
    state = characterWizardReducer(state, { type: 'REQUEST_CANCEL' });
    state = characterWizardReducer(state, { type: 'DISCARD_DRAFT' });
    expect(state.cancel.status).toBe('discarded');
  });

  it('requires one-line nonempty names, preserves duplicate-name behavior, and creates only from Review', () => {
    expect(validateCharacterWizardName('   ')).toBe('Enter a character name.');
    expect(validateCharacterWizardName('two\nlines')).toContain('single line');
    expect(validateCharacterWizardName('x'.repeat(1001))).toContain('too long');
    expect(validateCharacterWizardName('Maya')).toBeNull();

    let state = createCharacterWizard({ projectSessionId: 'session-1', origin: { kind: 'library' } });
    expect(() => characterWizardCreateOperation(state)).toThrow('Review');
    state = reduce(state,
      { type: 'CHOOSE_BLANK' },
      { type: 'SET_FIELD', field: 'name', value: ' Maya ' },
    );
    expect(characterWizardReducer(state, { type: 'NEXT' }).nameError).toBeNull();
    state = characterWizardReducer(state, { type: 'REVIEW_NOW' });
    expect(characterWizardCreateOperation(state)).toEqual({
      type: 'createCharacter', name: 'Maya', background: '', personality: '', voice: '',
    });
    // The service applies the existing backend behavior: it does not reject duplicate names.
    expect(validateCharacterWizardName('Maya')).toBeNull();
  });

  it('keeps Identity active when Review is requested with a whitespace-only name', () => {
    let state = createCharacterWizard({ projectSessionId: 'session-1', origin: { kind: 'library' } });
    state = characterWizardReducer(state, { type: 'CHOOSE_BLANK' });
    state = characterWizardReducer(state, { type: 'SET_FIELD', field: 'name', value: '   ' });
    state = characterWizardReducer(state, { type: 'NEXT' });
    expect(state.step).toBe('identity');
    expect(state.nameError).toBe('Enter a character name.');
    state = characterWizardReducer(state, { type: 'REVIEW_NOW' });
    expect(state.step).toBe('identity');
    expect(state.nameError).toBe('Enter a character name.');
  });

  it('starts a new session with an independent empty draft', () => {
    let first = createCharacterWizard({ projectSessionId: 'session-1', origin: { kind: 'library' } });
    first = reduce(first,
      { type: 'CHOOSE_BLANK' },
      { type: 'SET_FIELD', field: 'name', value: 'Rae' },
      { type: 'SET_FIELD', field: 'background', value: 'A new detective.' },
    );
    const second = createCharacterWizard({ projectSessionId: 'session-2', origin: { kind: 'library' } });
    expect(second.projectSessionId).toBe('session-2');
    expect(second).not.toBe(first);
    expect(second.step).toBe('starting-point');
    expect(second.draft).toMatchObject({ name: '', background: '', personality: '', voice: '', icon: '', iconExplicitlyChosen: false });
    expect(first.draft.name).toBe('Rae');
  });

  it('keeps a failed creation on Review and models recovery, conflict, and success without replaying it', () => {
    let state = reviewState(' Rae ');
    state = characterWizardReducer(state, { type: 'SUBMISSION_STARTED' });
    expect(state.submission.status).toBe('creating');
    expect(() => characterWizardCreateOperation(state)).toThrow('already being handled');

    state = characterWizardReducer(state, { type: 'SUBMISSION_FAILED', error: 'Connection interrupted.' });
    expect(state.step).toBe('review');
    expect(state.draft.name).toBe(' Rae ');
    expect(state.submission).toEqual({ status: 'failed', error: 'Connection interrupted.' });
    state = characterWizardReducer(state, { type: 'RECOVERY_STARTED' });
    expect(state.submission.status).toBe('recovering');
    state = characterWizardReducer(state, { type: 'SUBMISSION_CONFLICT', error: 'A newer revision exists.' });
    expect(state.submission).toEqual({ status: 'conflict', error: 'A newer revision exists.' });
    state = characterWizardReducer(state, { type: 'RECOVERY_STARTED' });
    state = characterWizardReducer(state, { type: 'SUBMISSION_SUCCEEDED', characterId: 'character-1' });
    expect(state.submission).toEqual({ status: 'succeeded', characterId: 'character-1' });
    expect(state.step).toBe('review');
    expect(state.draft.name).toBe(' Rae ');

    const resolvedWithoutCommit = reduce(reviewState('Rae'),
      { type: 'SUBMISSION_STARTED' },
      { type: 'SUBMISSION_FAILED', error: 'Connection interrupted.' },
      { type: 'RECOVERY_STARTED' },
      { type: 'SUBMISSION_CONFLICT', error: 'A newer revision exists.' },
      { type: 'SUBMISSION_RESET_AFTER_RECOVERY' },
    );
    expect(resolvedWithoutCommit.submission).toEqual({ status: 'idle' });
    expect(resolvedWithoutCommit.step).toBe('review');
    expect(resolvedWithoutCommit.draft.name).toBe('Rae');
    const preflightResolved = reduce(reviewState('Rae'),
      { type: 'SUBMISSION_STARTED' },
      { type: 'SUBMISSION_RESET_AFTER_RECOVERY' },
    );
    expect(preflightResolved.submission).toEqual({ status: 'idle' });
  });
});
