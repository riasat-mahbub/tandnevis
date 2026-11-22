import type { Operation, Preset } from './project';

export type CharacterWizardStep = 'starting-point' | 'identity' | 'details' | 'review';
export type CharacterWizardOrigin =
  | { kind: 'scene'; sceneId: string; sceneTitle?: string }
  | { kind: 'library' };

export interface CharacterWizardStockStartingPoint {
  kind: 'stock';
  templateId: string;
  title: string;
  icon: string;
  background: string;
  personality: string;
  voice: string;
}

export interface CharacterWizardBlankStartingPoint { kind: 'blank' }
export type CharacterWizardStartingPoint = CharacterWizardBlankStartingPoint | CharacterWizardStockStartingPoint;
export type CharacterWizardProfileField = 'background' | 'personality' | 'voice';
export type CharacterWizardDraftField = 'name' | CharacterWizardProfileField;
export type CharacterWizardDefaultGuidanceField = 'defaultToneId' | 'defaultEmotionId';

export interface CharacterWizardBrowserState {
  view: 'choices' | 'catalog';
  query: string;
  category: string;
  selectedId: string | null;
  scrollTop: number;
}

export interface CharacterWizardState {
  /** A draft belongs to this open Workspace session, not to the saved project model. */
  projectSessionId: string;
  origin: CharacterWizardOrigin;
  step: CharacterWizardStep;
  draft: {
    name: string;
    background: string;
    personality: string;
    voice: string;
    /** Preset identities are chosen explicitly; empty means None. */
    defaultToneId: string;
    defaultEmotionId: string;
    /** Empty means the registry's default person icon. */
    icon: string;
    /** Keeps an explicit writer choice when a different stock type is applied. */
    iconExplicitlyChosen: boolean;
  };
  appliedStartingPoint: CharacterWizardStartingPoint | null;
  /** A selected catalog result is only a preview until explicitly applied. */
  provisionalStartingPoint: CharacterWizardStartingPoint | null;
  startingPointConfirmation: {
    target: CharacterWizardStartingPoint;
    fields: CharacterWizardProfileField[];
  } | null;
  visitedSteps: CharacterWizardStep[];
  reviewReturnStep: 'identity' | 'details' | null;
  browser: CharacterWizardBrowserState;
  cancel: { status: 'none' | 'confirm' | 'discarded' };
  nameError: string | null;
  submission: {
    status: 'idle' | 'creating' | 'failed' | 'recovering' | 'conflict' | 'succeeded';
    error?: string;
    characterId?: string;
  };
}

export type CharacterWizardAction =
  | { type: 'OPEN_CATALOG' }
  | { type: 'SHOW_STARTING_CHOICES' }
  | { type: 'CHOOSE_BLANK' }
  | { type: 'PREVIEW_STARTING_POINT'; point: CharacterWizardStockStartingPoint }
  | { type: 'APPLY_PROVISIONAL_STARTING_POINT' }
  | { type: 'CONFIRM_STARTING_POINT_CHANGE'; confirmed: boolean }
  | { type: 'SET_BROWSER'; patch: Partial<CharacterWizardBrowserState> }
  | { type: 'SET_FIELD'; field: CharacterWizardDraftField; value: string }
  | { type: 'SET_DEFAULT_GUIDANCE'; field: CharacterWizardDefaultGuidanceField; value: string }
  | { type: 'SET_ICON'; icon: string }
  | { type: 'RESET_ICON' }
  | { type: 'GO_TO_STEP'; step: CharacterWizardStep }
  | { type: 'NEXT' }
  | { type: 'BACK' }
  | { type: 'REVIEW_NOW' }
  | { type: 'EDIT_REVIEW_SECTION'; section: 'identity' | 'details' }
  | { type: 'REQUEST_CANCEL' }
  | { type: 'KEEP_WORKING' }
  | { type: 'DISCARD_DRAFT' }
  | { type: 'SUBMISSION_STARTED' }
  | { type: 'SUBMISSION_FAILED'; error: string }
  | { type: 'RECOVERY_STARTED' }
  | { type: 'SUBMISSION_CONFLICT'; error?: string }
  | { type: 'SUBMISSION_RESET_AFTER_RECOVERY' }
  | { type: 'SUBMISSION_SUCCEEDED'; characterId: string };

const blankStartingPoint: CharacterWizardBlankStartingPoint = { kind: 'blank' };

export function createCharacterWizard(input: { projectSessionId: string; origin: CharacterWizardOrigin }): CharacterWizardState {
  return {
    projectSessionId: input.projectSessionId,
    origin: input.origin,
    step: 'starting-point',
    draft: { name: '', background: '', personality: '', voice: '', defaultToneId: '', defaultEmotionId: '', icon: '', iconExplicitlyChosen: false },
    appliedStartingPoint: null,
    provisionalStartingPoint: null,
    startingPointConfirmation: null,
    visitedSteps: ['starting-point'],
    reviewReturnStep: null,
    browser: { view: 'choices', query: '', category: 'all', selectedId: null, scrollTop: 0 },
    cancel: { status: 'none' },
    nameError: null,
    submission: { status: 'idle' },
  };
}

/** Mirrors the native title rule. Duplicate names remain allowed, as they are in project creation. */
export function validateCharacterWizardName(name: string): string | null {
  if (!name.trim()) return 'Enter a character name.';
  if (/[\r\n\0]/.test(name)) return 'Use a single line for the character name.';
  if (new TextEncoder().encode(name).length > 1000) return 'The character name is too long.';
  return null;
}

const pointFields = (point: CharacterWizardStartingPoint | null) => point?.kind === 'stock'
  ? { background: point.background, personality: point.personality, voice: point.voice }
  : { background: '', personality: '', voice: '' };

export function characterWizardHasPersonalEdits(state: CharacterWizardState): boolean {
  if (state.draft.name.trim() || state.draft.iconExplicitlyChosen || state.draft.defaultToneId || state.draft.defaultEmotionId) return true;
  const baseline = pointFields(state.appliedStartingPoint);
  return (['background', 'personality', 'voice'] as const).some(field =>
    !!state.draft[field].trim() && state.draft[field] !== baseline[field]);
}

export function characterWizardCanVisit(state: CharacterWizardState, step: CharacterWizardStep): boolean {
  return state.visitedSteps.includes(step);
}

function visit(state: CharacterWizardState, step: CharacterWizardStep): CharacterWizardState {
  return {
    ...state,
    step,
    visitedSteps: state.visitedSteps.includes(step) ? state.visitedSteps : [...state.visitedSteps, step],
  };
}

function hasSubmissionLock(state: CharacterWizardState) {
  return state.submission.status === 'creating' || state.submission.status === 'failed' || state.submission.status === 'recovering' || state.submission.status === 'conflict' || state.submission.status === 'succeeded';
}

function applyStartingPoint(state: CharacterWizardState, target: CharacterWizardStartingPoint): CharacterWizardState {
  const fields = pointFields(target);
  return {
    ...visit(state, 'identity'),
    draft: {
      ...state.draft,
      ...fields,
      icon: state.draft.iconExplicitlyChosen ? state.draft.icon : target.kind === 'stock' ? target.icon : '',
    },
    appliedStartingPoint: target,
    provisionalStartingPoint: null,
    startingPointConfirmation: null,
    reviewReturnStep: null,
  };
}

function applyProvisional(state: CharacterWizardState): CharacterWizardState {
  const target = state.provisionalStartingPoint;
  if (!target || hasSubmissionLock(state)) return state;
  const nextFields = pointFields(target);
  // A currently nonempty field is protected even if it originated in the last template.
  const affectedFields = (['background', 'personality', 'voice'] as const).filter(field =>
    !!state.draft[field].trim() && state.draft[field] !== nextFields[field]);
  if (affectedFields.length) {
    return { ...state, startingPointConfirmation: { target, fields: affectedFields } };
  }
  return applyStartingPoint(state, target);
}

export function characterWizardReducer(state: CharacterWizardState, action: CharacterWizardAction): CharacterWizardState {
  const submissionActions: CharacterWizardAction['type'][] = ['SUBMISSION_FAILED', 'RECOVERY_STARTED', 'SUBMISSION_CONFLICT', 'SUBMISSION_RESET_AFTER_RECOVERY', 'SUBMISSION_SUCCEEDED'];
  if (hasSubmissionLock(state) && !submissionActions.includes(action.type)) return state;
  switch (action.type) {
    case 'OPEN_CATALOG':
      return { ...state, ...visit(state, 'starting-point'), browser: { ...state.browser, view: 'catalog' } };
    case 'SHOW_STARTING_CHOICES':
      return { ...state, ...visit(state, 'starting-point'), browser: { ...state.browser, view: 'choices' }, provisionalStartingPoint: null, startingPointConfirmation: null };
    case 'CHOOSE_BLANK':
      return applyProvisional({ ...state, provisionalStartingPoint: blankStartingPoint, startingPointConfirmation: null });
    case 'PREVIEW_STARTING_POINT':
      return {
        ...state,
        provisionalStartingPoint: action.point,
        startingPointConfirmation: null,
        browser: { ...state.browser, view: 'catalog', selectedId: action.point.templateId },
      };
    case 'APPLY_PROVISIONAL_STARTING_POINT':
      return applyProvisional(state);
    case 'CONFIRM_STARTING_POINT_CHANGE': {
      const confirmation = state.startingPointConfirmation;
      if (!confirmation) return state;
      return action.confirmed
        ? applyStartingPoint(state, confirmation.target)
        : { ...state, provisionalStartingPoint: null, startingPointConfirmation: null };
    }
    case 'SET_BROWSER':
      return { ...state, browser: { ...state.browser, ...action.patch } };
    case 'SET_FIELD': {
      const draft = { ...state.draft, [action.field]: action.value };
      return { ...state, draft, nameError: action.field === 'name' ? validateCharacterWizardName(action.value) : state.nameError };
    }
    case 'SET_DEFAULT_GUIDANCE':
      return { ...state, draft: { ...state.draft, [action.field]: action.value } };
    case 'SET_ICON':
      return { ...state, draft: { ...state.draft, icon: action.icon, iconExplicitlyChosen: true } };
    case 'RESET_ICON':
      return { ...state, draft: { ...state.draft, icon: '', iconExplicitlyChosen: true } };
    case 'GO_TO_STEP': {
      if (!characterWizardCanVisit(state, action.step)) return state;
      const isReviewEdit = state.step === 'review' || state.reviewReturnStep !== null;
      const reviewReturnStep = isReviewEdit && (action.step === 'identity' || action.step === 'details') ? action.step : null;
      return { ...visit(state, action.step), reviewReturnStep };
    }
    case 'NEXT': {
      if (state.step === 'identity') {
        const error = validateCharacterWizardName(state.draft.name);
        if (error) return { ...state, nameError: error };
        if (state.reviewReturnStep === 'identity') return { ...visit(state, 'review'), reviewReturnStep: 'identity', nameError: null };
        return { ...visit(state, 'details'), nameError: null };
      }
      if (state.step === 'details') return { ...visit(state, 'review'), reviewReturnStep: 'details' };
      return state;
    }
    case 'BACK': {
      if (state.step === 'identity') return { ...visit(state, 'starting-point'), reviewReturnStep: null };
      if (state.step === 'details') return { ...visit(state, 'identity'), reviewReturnStep: null };
      if (state.step === 'review') {
        const previous: CharacterWizardStep = state.reviewReturnStep ?? (state.visitedSteps.includes('details') ? 'details' : 'identity');
        return { ...visit(state, previous), reviewReturnStep: null };
      }
      return state;
    }
    case 'REVIEW_NOW': {
      if (state.step !== 'identity') return state;
      const error = validateCharacterWizardName(state.draft.name);
      if (error) return { ...state, nameError: error };
      return { ...visit(state, 'review'), reviewReturnStep: 'identity', nameError: null };
    }
    case 'EDIT_REVIEW_SECTION':
      if (state.step !== 'review') return state;
      return { ...visit(state, action.section), reviewReturnStep: action.section };
    case 'REQUEST_CANCEL':
      return { ...state, cancel: { status: characterWizardHasPersonalEdits(state) ? 'confirm' : 'discarded' } };
    case 'KEEP_WORKING':
      return { ...state, cancel: { status: 'none' } };
    case 'DISCARD_DRAFT':
      return { ...state, cancel: { status: 'discarded' } };
    case 'SUBMISSION_STARTED': {
      if (state.step !== 'review' || state.submission.status !== 'idle') return state;
      const error = validateCharacterWizardName(state.draft.name);
      return error ? { ...state, nameError: error } : { ...state, nameError: null, submission: { status: 'creating' } };
    }
    case 'SUBMISSION_FAILED':
      if (state.submission.status !== 'creating' && state.submission.status !== 'recovering') return state;
      return { ...state, submission: { status: 'failed', error: action.error } };
    case 'RECOVERY_STARTED':
      if (state.submission.status !== 'failed' && state.submission.status !== 'conflict') return state;
      return { ...state, submission: { status: 'recovering' } };
    case 'SUBMISSION_CONFLICT':
      if (state.submission.status !== 'creating' && state.submission.status !== 'recovering') return state;
      return { ...state, submission: { status: 'conflict', ...(action.error ? { error: action.error } : {}) } };
    case 'SUBMISSION_RESET_AFTER_RECOVERY':
      if (state.submission.status !== 'creating' && state.submission.status !== 'failed' && state.submission.status !== 'recovering' && state.submission.status !== 'conflict') return state;
      return { ...state, submission: { status: 'idle' }, nameError: null };
    case 'SUBMISSION_SUCCEEDED':
      if (state.submission.status !== 'creating' && state.submission.status !== 'recovering' && state.submission.status !== 'conflict') return state;
      return { ...state, submission: { status: 'succeeded', characterId: action.characterId } };
  }
}

export function characterWizardMissingDefaultGuidance(
  state: CharacterWizardState,
  project: { tones: readonly Preset[]; emotions: readonly Preset[] },
): CharacterWizardDefaultGuidanceField[] {
  const missing: CharacterWizardDefaultGuidanceField[] = [];
  if (state.draft.defaultToneId && !project.tones.some(preset => preset.id === state.draft.defaultToneId)) missing.push('defaultToneId');
  if (state.draft.defaultEmotionId && !project.emotions.some(preset => preset.id === state.draft.defaultEmotionId)) missing.push('defaultEmotionId');
  return missing;
}

export function characterWizardCreateOperation(state: CharacterWizardState): Extract<Operation, { type: 'createCharacter' }> {
  if (state.step !== 'review') throw new Error('Character creation is available from Review.');
  if (state.submission.status !== 'idle') throw new Error('This character creation is already being handled.');
  const error = validateCharacterWizardName(state.draft.name);
  if (error) throw new Error(error);
  const { name, background, personality, voice, icon, defaultToneId, defaultEmotionId } = state.draft;
  return {
    type: 'createCharacter',
    name: name.trim(),
    background,
    personality,
    voice,
    ...(icon ? { icon } : {}),
    ...(defaultToneId ? { defaultToneId } : {}),
    ...(defaultEmotionId ? { defaultEmotionId } : {}),
  };
}
