import '../test/dom';
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { useReducer } from 'react';
import { stockCharacterTemplates } from '../content/stock-characters';
import {
  characterWizardReducer,
  createCharacterWizard,
  type CharacterWizardState,
} from '../services/character-wizard';
import CharacterCreationWizard from './CharacterCreationWizard';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function WizardHarness({ initialState }: { initialState: CharacterWizardState }) {
  const [state, dispatch] = useReducer(characterWizardReducer, initialState);
  return <CharacterCreationWizard state={state} dispatch={dispatch} onCreate={vi.fn()} onCancel={vi.fn()}/>;
}

function catalogState() {
  return characterWizardReducer(createCharacterWizard({ projectSessionId: 'session-1', origin: { kind: 'library' } }), { type: 'OPEN_CATALOG' });
}

it('keeps preview provisional and applies a stock type only through Use this type and continue', () => {
  const template = stockCharacterTemplates.find(item => item.title === 'The Miser')!;
  render(<WizardHarness initialState={catalogState()}/>);

  fireEvent.click(screen.getByRole('button', { name: `Preview ${template.title}` }));
  expect(screen.getByTestId('character-creation-wizard')).toHaveAttribute('data-wizard-step', 'starting-point');
  expect(screen.queryByRole('textbox', { name: 'Character name' })).not.toBeInTheDocument();
  expect(within(screen.getByRole('region', { name: 'Stock type preview' })).getByText(template.summary)).toBeVisible();
  expect(screen.getByRole('button', { name: 'Use this type and continue' })).toBeVisible();
  expect(screen.queryByRole('button', { name: /Next:/ })).not.toBeInTheDocument();
  expect(screen.getByText(template.background)).not.toBeVisible();

  fireEvent.click(screen.getByRole('button', { name: 'Use this type and continue' }));
  expect(screen.getByTestId('character-creation-wizard')).toHaveAttribute('data-wizard-step', 'identity');
  fireEvent.change(screen.getByRole('textbox', { name: 'Character name' }), { target: { value: 'Avery' } });
  fireEvent.click(screen.getByRole('button', { name: 'Next: Profile details' }));
  expect(screen.getByRole('textbox', { name: 'Background' })).toHaveValue(template.background);
  expect(screen.getByRole('textbox', { name: 'Personality' })).toHaveValue(template.personality);
  expect(screen.getByRole('textbox', { name: 'Baseline voice' })).toHaveValue(template.voice);
});

it('keeps the suggested profile and source details behind named disclosures', () => {
  const template = stockCharacterTemplates.find(item => item.contextNote)!;
  render(<WizardHarness initialState={catalogState()}/>);
  fireEvent.click(screen.getByRole('button', { name: `Preview ${template.title}` }));

  const suggestions = screen.getByText('Suggested profile');
  const about = screen.getByText('About this type');
  expect(suggestions.closest('details')).not.toHaveAttribute('open');
  expect(about.closest('details')).not.toHaveAttribute('open');
  expect(screen.getByText(template.contextNote!)).toBeVisible();

  fireEvent.click(suggestions);
  expect(screen.getByText(template.background)).toBeVisible();
  fireEvent.click(about);
  expect(screen.getByText('Historical connections:')).toBeVisible();
  expect(screen.getByRole('link', { name: template.sources[0].title })).toBeVisible();
});

it('stacks results and selected detail at the supported narrow width while retaining browse state', () => {
  vi.spyOn(window, 'matchMedia').mockReturnValue({
    matches: true, media: '(max-width: 900px)', onchange: null,
    addEventListener: vi.fn(), removeEventListener: vi.fn(), addListener: vi.fn(), removeListener: vi.fn(), dispatchEvent: vi.fn(),
  } as unknown as MediaQueryList);
  const initial = createCharacterWizard({ projectSessionId: 'session-1', origin: { kind: 'library' } });
  render(<WizardHarness initialState={initial}/>);

  fireEvent.click(screen.getByRole('button', { name: 'Choose a stock type' }));
  const browser = screen.getByTestId('character-wizard-stock-browser');
  expect(browser).toHaveAttribute('data-detail-open', 'false');
  const search = screen.getByRole('searchbox', { name: 'Search stock types' });
  fireEvent.change(search, { target: { value: 'Pantalone' } });
  fireEvent.click(screen.getByRole('button', { name: 'Classical and traditional' }));
  const result = screen.getByRole('button', { name: 'Preview The Miser' });
  fireEvent.click(result);

  expect(browser).toHaveAttribute('data-detail-open', 'true');
  expect(screen.getByRole('button', { name: 'Back to stock type results' })).toBeVisible();
  fireEvent.click(screen.getByRole('button', { name: 'Back to stock type results' }));

  expect(browser).toHaveAttribute('data-detail-open', 'false');
  expect(screen.getByRole('searchbox', { name: 'Search stock types' })).toHaveValue('Pantalone');
  expect(screen.getByRole('button', { name: 'Classical and traditional' })).toHaveAttribute('aria-pressed', 'true');
  expect(screen.getByRole('button', { name: 'Preview The Miser' })).toHaveAttribute('aria-pressed', 'true');
});

it('asks before replacing changed profile fields and restores the applied selection on decline', () => {
  const first = stockCharacterTemplates.find(item => item.title === 'The Miser')!;
  const second = stockCharacterTemplates.find(item => item.id !== first.id)!;
  let initial = characterWizardReducer(createCharacterWizard({ projectSessionId: 'session-1', origin: { kind: 'library' } }), { type: 'PREVIEW_STARTING_POINT', point: {
    kind: 'stock', templateId: first.id, title: first.title, icon: first.icon, background: first.background, personality: first.personality, voice: first.voice,
  } });
  initial = characterWizardReducer(initial, { type: 'APPLY_PROVISIONAL_STARTING_POINT' });
  initial = characterWizardReducer(initial, { type: 'SET_FIELD', field: 'background', value: 'A writer edited this background.' });
  initial = characterWizardReducer(initial, { type: 'OPEN_CATALOG' });
  render(<WizardHarness initialState={initial}/>);

  fireEvent.click(screen.getByRole('button', { name: `Preview ${second.title}` }));
  fireEvent.click(screen.getByRole('button', { name: 'Use this type and continue' }));
  expect(screen.getByRole('alert')).toHaveTextContent('Replace background, personality, baseline voice?');
  expect(screen.getByRole('alert')).toHaveTextContent('Your name stays.');
  fireEvent.click(screen.getByRole('button', { name: 'Keep current fields' }));

  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: `Preview ${first.title}` })).toHaveAttribute('aria-pressed', 'true');
  expect(screen.getByRole('button', { name: `Preview ${second.title}` })).toHaveAttribute('aria-pressed', 'false');
});
