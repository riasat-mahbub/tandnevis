import '../test/dom';
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { useReducer } from 'react';
import {
  characterWizardReducer,
  createCharacterWizard,
  type CharacterWizardState,
} from '../services/character-wizard';
import type { Preset } from '../services/project';
import CharacterCreationWizard from './CharacterCreationWizard';

afterEach(cleanup);

function WizardHarness({ onCreate, onCancel, initialState, tones = [], emotions = [], creationReady = true }: {
  onCreate: (state: CharacterWizardState) => void;
  onCancel: () => void;
  initialState?: CharacterWizardState;
  tones?: Preset[];
  emotions?: Preset[];
  creationReady?: boolean;
}) {
  const [state, dispatch] = useReducer(characterWizardReducer, initialState ?? createCharacterWizard({
    projectSessionId: 'session-1',
    origin: { kind: 'library' },
  }));
  return <CharacterCreationWizard state={state} tones={tones} emotions={emotions} creationReady={creationReady} dispatch={dispatch} onCreate={onCreate} onCancel={onCancel}/>;
}

it('starts with two choices and keeps the stock branch inside Starting point', () => {
  const onCreate = vi.fn(), onCancel = vi.fn();
  render(<WizardHarness onCreate={onCreate} onCancel={onCancel}/>);

  expect(screen.getByTestId('character-creation-wizard')).toHaveAttribute('data-wizard-step', 'starting-point');
  expect(screen.getByRole('navigation', { name: 'Character creation steps' })).toBeVisible();
  expect(screen.getByRole('button', { name: 'Name and icon' })).toBeDisabled();
  expect(screen.getByRole('button', { name: 'Profile details' })).toBeDisabled();
  expect(screen.getByRole('button', { name: 'Review' })).toBeDisabled();
  expect(screen.getByRole('button', { name: 'Start blank' })).toBeVisible();
  expect(screen.getByRole('button', { name: 'Choose a stock type' })).toBeVisible();

  fireEvent.click(screen.getByRole('button', { name: 'Choose a stock type' }));
  expect(screen.getByTestId('character-creation-wizard')).toHaveAttribute('data-browser-view', 'catalog');
  expect(screen.getByTestId('character-wizard-stock-browser')).toHaveTextContent('Stock character types');
  expect(screen.getByRole('searchbox', { name: 'Search stock types' })).toBeVisible();
  fireEvent.click(screen.getByRole('button', { name: 'Back to starting choices' }));
  expect(screen.getByTestId('character-creation-wizard')).toHaveAttribute('data-browser-view', 'choices');
  expect(onCreate).not.toHaveBeenCalled();
  expect(onCancel).not.toHaveBeenCalled();
});

it('keeps each phase focused and emits creation only from Review', () => {
  const onCreate = vi.fn(), onCancel = vi.fn();
  render(<WizardHarness onCreate={onCreate} onCancel={onCancel}/>);

  fireEvent.click(screen.getByRole('button', { name: 'Start blank' }));
  expect(screen.getByTestId('character-creation-wizard')).toHaveAttribute('data-wizard-step', 'identity');
  const name = screen.getByRole('textbox', { name: 'Character name' });
  expect(name).toHaveFocus();
  expect(screen.queryByRole('textbox', { name: 'Background' })).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Create character' })).not.toBeInTheDocument();
  expect(screen.queryByRole('group', { name: 'Character icon choices' })).not.toBeInTheDocument();

  fireEvent.click(screen.getByRole('button', { name: 'Next: Profile details' }));
  expect(screen.getByRole('alert')).toHaveTextContent('Enter a character name.');
  expect(name).toHaveFocus();
  fireEvent.change(name, { target: { value: 'Mara' } });
  fireEvent.click(screen.getByRole('button', { name: 'Choose character icon' }));
  expect(screen.getByRole('group', { name: 'Character icon choices' })).toBeVisible();
  fireEvent.click(screen.getByRole('button', { name: 'Crown icon' }));
  expect(document.querySelector('[data-character-icon="crown"]')).not.toBeNull();

  fireEvent.click(screen.getByRole('button', { name: 'Next: Profile details' }));
  expect(screen.getByTestId('character-creation-wizard')).toHaveAttribute('data-wizard-step', 'details');
  expect(screen.getByRole('heading', { name: 'Profile details' })).toHaveFocus();
  expect(screen.queryByRole('textbox', { name: 'Character name' })).not.toBeInTheDocument();
  fireEvent.change(screen.getByRole('textbox', { name: 'Background' }), { target: { value: 'A mapmaker who returned home.' } });
  fireEvent.change(screen.getByRole('textbox', { name: 'Personality' }), { target: { value: 'Patient, with a stubborn streak.' } });
  fireEvent.click(screen.getByRole('button', { name: 'Next: Review' }));

  expect(screen.getByTestId('character-creation-wizard')).toHaveAttribute('data-wizard-step', 'review');
  expect(screen.getByRole('heading', { name: 'Mara' })).toBeVisible();
  expect(screen.getByText('A mapmaker who returned home.')).toBeVisible();
  expect(screen.getByText('Patient, with a stubborn streak.')).toBeVisible();
  expect(screen.getByText('Not added')).toBeVisible();
  expect(screen.queryByRole('textbox', { name: 'Personality' })).not.toBeInTheDocument();
  expect(onCreate).not.toHaveBeenCalled();

  fireEvent.click(screen.getByRole('button', { name: 'Edit personality' }));
  expect(screen.getByTestId('character-creation-wizard')).toHaveAttribute('data-wizard-step', 'details');
  expect(screen.getByRole('textbox', { name: 'Personality' })).toHaveValue('Patient, with a stubborn streak.');
  fireEvent.click(screen.getByRole('button', { name: 'Next: Review' }));
  fireEvent.click(screen.getByRole('button', { name: 'Edit name and icon' }));
  expect(screen.getByRole('textbox', { name: 'Character name' })).toHaveValue('Mara');
  fireEvent.click(screen.getByRole('button', { name: 'Review now' }));
  expect(screen.getByTestId('character-creation-wizard')).toHaveAttribute('data-wizard-step', 'review');

  fireEvent.click(screen.getByRole('button', { name: 'Create character' }));
  expect(onCreate).toHaveBeenCalledTimes(1);
  expect(onCreate).toHaveBeenCalledWith(expect.objectContaining({ step: 'review', draft: expect.objectContaining({ name: 'Mara', icon: 'crown' }) }));
});

it('allows reviewing an identity directly without opening Profile details', () => {
  const onCreate = vi.fn(), onCancel = vi.fn();
  render(<WizardHarness onCreate={onCreate} onCancel={onCancel}/>);

  fireEvent.click(screen.getByRole('button', { name: 'Start blank' }));
  fireEvent.change(screen.getByRole('textbox', { name: 'Character name' }), { target: { value: 'Rowan' } });
  fireEvent.click(screen.getByRole('button', { name: 'Review now' }));

  expect(screen.getByTestId('character-creation-wizard')).toHaveAttribute('data-wizard-step', 'review');
  expect(screen.getByRole('button', { name: 'Profile details' })).toBeDisabled();
  expect(screen.getAllByText('Not added')).toHaveLength(3);
  expect(onCreate).not.toHaveBeenCalled();
});

it('offers current project presets as optional guidance and carries selected IDs through Review', () => {
  const onCreate = vi.fn(), onCancel = vi.fn();
  const tones: Preset[] = [
    { id: 'tone-neutral-id', name: 'Neutral', meaning: 'Measured and plain', guidance: 'Use restrained, even phrasing.', example: '', archived: false, revision: 0 },
    { id: 'tone-wry-id', name: 'Wry', meaning: 'Dry humor at a little distance', guidance: 'Let the narrator notice an absurd detail.', example: '', archived: false, revision: 0 },
  ];
  const emotions: Preset[] = [
    { id: 'emotion-tender-id', name: 'Tender', meaning: 'Gentle care or affection', guidance: 'Keep attention close to small gestures.', example: '', archived: false, revision: 0 },
  ];
  const { rerender } = render(<WizardHarness onCreate={onCreate} onCancel={onCancel} tones={tones} emotions={emotions}/>);

  fireEvent.click(screen.getByRole('button', { name: 'Start blank' }));
  fireEvent.change(screen.getByRole('textbox', { name: 'Character name' }), { target: { value: 'Mara' } });
  fireEvent.click(screen.getByRole('button', { name: 'Next: Profile details' }));
  const disclosure = screen.getByTestId('character-wizard-default-guidance');
  expect(disclosure).not.toHaveAttribute('open');
  fireEvent.click(screen.getByText('Optional default guidance'));

  const tone = screen.getByRole('combobox', { name: 'Default tone' });
  const emotion = screen.getByRole('combobox', { name: 'Default emotion' });
  expect(tone).toHaveValue('');
  expect(within(tone).getByRole('option', { name: 'None' })).toBeInTheDocument();
  expect(within(tone).getByRole('option', { name: 'Neutral' })).toBeInTheDocument();
  expect(within(emotion).getByRole('option', { name: 'Tender' })).toBeInTheDocument();
  expect(screen.getByTestId('character-wizard-default-tone-preview')).toHaveTextContent('None leaves this unset. Neutral is a separate tone preset.');

  fireEvent.change(tone, { target: { value: 'tone-neutral-id' } });
  fireEvent.change(emotion, { target: { value: 'emotion-tender-id' } });
  expect(screen.getByTestId('character-wizard-default-tone-preview')).toHaveTextContent('Measured and plain');
  expect(screen.getByTestId('character-wizard-default-tone-preview')).toHaveTextContent('Use restrained, even phrasing.');
  expect(screen.getByTestId('character-wizard-default-emotion-preview')).toHaveTextContent('Gentle care or affection');
  const renamedArchivedTone = { ...tones[0], name: 'Measured', meaning: 'Updated meaning', guidance: 'Updated guidance.', archived: true };
  rerender(<WizardHarness onCreate={onCreate} onCancel={onCancel} tones={[renamedArchivedTone, tones[1]]} emotions={emotions}/>);
  expect(screen.getByRole('combobox', { name: 'Default tone' })).toHaveValue('tone-neutral-id');
  expect(within(screen.getByRole('combobox', { name: 'Default tone' })).getByRole('option', { name: 'Measured (archived)' })).toBeInTheDocument();
  expect(screen.getByTestId('character-wizard-default-tone-preview')).toHaveTextContent('Updated meaning');
  fireEvent.click(screen.getByRole('button', { name: 'Next: Review' }));
  expect(screen.getByTestId('character-wizard-review-default-tone')).toHaveTextContent('Measured (archived)');
  expect(screen.getByTestId('character-wizard-review-default-emotion')).toHaveTextContent('Tender');

  fireEvent.click(screen.getByRole('button', { name: 'Edit default guidance' }));
  expect(screen.getByTestId('character-wizard-default-guidance')).toHaveAttribute('open');
  expect(screen.getByRole('combobox', { name: 'Default tone' })).toHaveValue('tone-neutral-id');
  expect(screen.getByRole('combobox', { name: 'Default tone' })).toHaveFocus();
  expect(within(screen.getByRole('combobox', { name: 'Default tone' })).getByRole('option', { name: 'Measured (archived)' })).toBeInTheDocument();
  expect(screen.getByRole('combobox', { name: 'Default emotion' })).toHaveValue('emotion-tender-id');
  fireEvent.click(screen.getByRole('button', { name: 'Next: Review' }));
  fireEvent.click(screen.getByRole('button', { name: 'Create character' }));
  expect(onCreate).toHaveBeenCalledWith(expect.objectContaining({
    step: 'review',
    draft: expect.objectContaining({ defaultToneId: 'tone-neutral-id', defaultEmotionId: 'emotion-tender-id' }),
  }));
});

it('distinguishes an empty None value from a custom preset named None', () => {
  const onCreate = vi.fn(), onCancel = vi.fn();
  const nonePreset: Preset = { id: 'custom-none-id', name: 'None', meaning: 'A writer-defined tone', guidance: "Use this project's own guidance.", example: '', archived: false, revision: 0 };
  let initialState = createCharacterWizard({ projectSessionId: 'session-1', origin: { kind: 'library' } });
  initialState = characterWizardReducer(initialState, { type: 'CHOOSE_BLANK' });
  initialState = characterWizardReducer(initialState, { type: 'SET_FIELD', field: 'name', value: 'Rae' });
  initialState = characterWizardReducer(initialState, { type: 'NEXT' });
  initialState = characterWizardReducer(initialState, { type: 'SET_DEFAULT_GUIDANCE', field: 'defaultToneId', value: nonePreset.id });
  render(<WizardHarness initialState={initialState} tones={[nonePreset]} onCreate={onCreate} onCancel={onCancel}/>);

  const tone = screen.getByRole('combobox', { name: 'Default tone' });
  expect(within(tone).getByRole('option', { name: 'None' })).toHaveValue('');
  expect(within(tone).getByRole('option', { name: 'None (preset)' })).toHaveValue('custom-none-id');
  expect(tone).toHaveValue('custom-none-id');
  fireEvent.click(screen.getByRole('button', { name: 'Next: Review' }));
  expect(screen.getByTestId('character-wizard-review-default-tone')).toHaveTextContent('None (preset)');
  expect(screen.getByTestId('character-wizard-review-default-emotion')).toHaveTextContent('None');
  fireEvent.click(screen.getByRole('button', { name: 'Create character' }));
  expect(onCreate).toHaveBeenCalledWith(expect.objectContaining({ draft: expect.objectContaining({ defaultToneId: 'custom-none-id', defaultEmotionId: '' }) }));
});

it('keeps empty projects usable and blocks a missing reference until it is cleared', () => {
  const onCreate = vi.fn(), onCancel = vi.fn();
  let initialState = createCharacterWizard({ projectSessionId: 'session-1', origin: { kind: 'library' } });
  initialState = characterWizardReducer(initialState, { type: 'CHOOSE_BLANK' });
  initialState = characterWizardReducer(initialState, { type: 'SET_FIELD', field: 'name', value: 'Rowan' });
  initialState = characterWizardReducer(initialState, { type: 'NEXT' });
  initialState = characterWizardReducer(initialState, { type: 'SET_DEFAULT_GUIDANCE', field: 'defaultToneId', value: 'removed-tone-id' });
  initialState = characterWizardReducer(initialState, { type: 'NEXT' });
  render(<WizardHarness initialState={initialState} onCreate={onCreate} onCancel={onCancel}/>);

  expect(screen.getByTestId('character-wizard-review-default-tone')).toHaveTextContent('Unavailable tone reference (removed-tone-id)');
  expect(screen.getByRole('alert')).toHaveTextContent('no longer in this project');
  expect(screen.getByRole('button', { name: 'Create character' })).toBeDisabled();
  fireEvent.click(screen.getByRole('button', { name: 'Edit default guidance' }));
  const tone = screen.getByRole('combobox', { name: 'Default tone' });
  expect(tone).toHaveValue('removed-tone-id');
  expect(within(tone).getByRole('option', { name: 'Unavailable saved reference (removed-tone-id)' })).toBeInTheDocument();
  expect(screen.getByTestId('character-wizard-no-emotion-options')).toHaveTextContent('None is still a valid choice');
  fireEvent.change(tone, { target: { value: '' } });
  expect(screen.getByTestId('character-wizard-no-tone-options')).toHaveTextContent('None is still a valid choice');
  fireEvent.click(screen.getByRole('button', { name: 'Next: Review' }));

  expect(screen.getByTestId('character-wizard-review-default-tone')).toHaveTextContent('None');
  expect(screen.getByTestId('character-wizard-review-default-emotion')).toHaveTextContent('None');
  expect(screen.getByRole('button', { name: 'Create character' })).toBeEnabled();
  fireEvent.click(screen.getByRole('button', { name: 'Create character' }));
  expect(onCreate).toHaveBeenCalledWith(expect.objectContaining({ draft: expect.objectContaining({ defaultToneId: '', defaultEmotionId: '' }) }));
});

it('cancels an untouched draft directly and asks before discarding personal edits', () => {
  const onCreate = vi.fn(), onCancel = vi.fn();
  render(<WizardHarness onCreate={onCreate} onCancel={onCancel}/>);

  fireEvent.click(screen.getByRole('button', { name: 'Cancel creation' }));
  expect(onCancel).toHaveBeenCalledTimes(1);
  expect(screen.queryByRole('alert', { name: 'Discard this character draft?' })).not.toBeInTheDocument();

  cleanup();
  const editedOnCancel = vi.fn();
  render(<WizardHarness onCreate={onCreate} onCancel={editedOnCancel}/>);
  fireEvent.click(screen.getByRole('button', { name: 'Start blank' }));
  fireEvent.change(screen.getByRole('textbox', { name: 'Character name' }), { target: { value: 'Juniper' } });
  fireEvent.click(screen.getByRole('button', { name: 'Cancel creation' }));
  expect(screen.getByRole('alert')).toHaveTextContent('Your name, icon, profile details, and default guidance will be lost.');
  expect(editedOnCancel).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Keep working' }));
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Cancel creation' }));
  fireEvent.click(screen.getByRole('button', { name: 'Discard draft' }));
  expect(editedOnCancel).toHaveBeenCalledTimes(1);
});

it('locks reviewed values until a failed or ambiguous submission is resolved', () => {
  let failed = createCharacterWizard({ projectSessionId: 'session-1', origin: { kind: 'library' } });
  failed = characterWizardReducer(failed, { type: 'CHOOSE_BLANK' });
  failed = characterWizardReducer(failed, { type: 'SET_FIELD', field: 'name', value: 'Avery' });
  failed = characterWizardReducer(failed, { type: 'REVIEW_NOW' });
  failed = characterWizardReducer(failed, { type: 'SUBMISSION_STARTED' });
  failed = characterWizardReducer(failed, { type: 'SUBMISSION_FAILED', error: 'The response was interrupted.' });
  const onCreate = vi.fn(), onCancel = vi.fn();
  render(<WizardHarness initialState={failed} onCreate={onCreate} onCancel={onCancel}/>);

  expect(screen.getByRole('button', { name: 'Edit name and icon' })).toBeDisabled();
  expect(screen.getByRole('button', { name: 'Edit background' })).toBeDisabled();
  expect(screen.getByRole('button', { name: 'Name and icon' })).toBeDisabled();
  expect(screen.getByRole('button', { name: 'Cancel creation' })).toBeDisabled();
  expect(screen.getByRole('button', { name: 'Retry character creation' })).toBeEnabled();

  fireEvent.click(screen.getByRole('button', { name: 'Retry character creation' }));
  expect(onCreate).toHaveBeenCalledWith(expect.objectContaining({ submission: { status: 'failed', error: 'The response was interrupted.' } }));
});
