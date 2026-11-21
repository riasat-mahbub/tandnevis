import '../test/dom';
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { useReducer } from 'react';
import {
  characterWizardReducer,
  createCharacterWizard,
  type CharacterWizardState,
} from '../services/character-wizard';
import CharacterCreationWizard from './CharacterCreationWizard';

afterEach(cleanup);

function WizardHarness({ onCreate, onCancel, initialState }: {
  onCreate: (state: CharacterWizardState) => void;
  onCancel: () => void;
  initialState?: CharacterWizardState;
}) {
  const [state, dispatch] = useReducer(characterWizardReducer, initialState ?? createCharacterWizard({
    projectSessionId: 'session-1',
    origin: { kind: 'library' },
  }));
  return <CharacterCreationWizard state={state} dispatch={dispatch} onCreate={onCreate} onCancel={onCancel}/>;
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
  expect(screen.getByRole('alert')).toHaveTextContent('Your name, icon, and profile details will be lost.');
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
