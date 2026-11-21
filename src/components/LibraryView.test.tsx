import '../test/dom';
import { afterEach, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useState, useSyncExternalStore } from 'react';
import { Workspace } from '../services/workspace';
import { stockCharacterTemplates } from '../content/stock-characters';
import type { LibraryKind } from './LibraryView';
import LibraryView from './LibraryView';
import { gateway, project, session } from '../test/fixtures';

afterEach(cleanup);

function LibraryHarness({ workspace, kind = 'characters', createRequest = 0 }: { workspace: Workspace; kind?: LibraryKind; createRequest?: number }) {
  const state = useSyncExternalStore(workspace.subscribe, workspace.getSnapshot, workspace.getSnapshot);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  if (!state.project) return null;
  return <LibraryView kind={kind} project={state.project} workspace={workspace} locked={false} selectedId={selectedId} onSelect={setSelectedId} createRequest={createRequest} onOpenUsage={vi.fn()} onOpenCharacter={vi.fn()} notify={vi.fn()} run={action => { void action().catch(() => {}); }}/>;
}

it('keeps an archetype editable as a draft and creates a fresh character only on submit', async () => {
  const template = stockCharacterTemplates[0];
  const initial = project(), native = gateway(initial), workspace = new Workspace(native);
  workspace.attach(session(initial));
  let nextId = 0;
  let current = structuredClone(initial);
  vi.mocked(native.apply).mockImplementation(async (_session, _revision, operation) => {
    if (operation.type !== 'createCharacter') throw new Error('Unexpected write');
    current = structuredClone(current); current.revision++;
    current.characters.push({ id: `draft-${++nextId}`, name: operation.name, background: operation.background ?? '', personality: operation.personality ?? '', voice: operation.voice ?? '', icon: operation.icon, archived: false, defaultToneId: operation.defaultToneId ?? '', defaultEmotionId: operation.defaultEmotionId ?? '' });
    return structuredClone(current);
  });
  render(<LibraryHarness workspace={workspace} createRequest={1}/>);

  await screen.findByRole('button', { name: `Preview ${template.title}` });
  expect(screen.getByRole('textbox', { name: 'Character name' })).toHaveFocus();
  fireEvent.click(screen.getByRole('button', { name: `Preview ${template.title}` }));
  expect(document.querySelector('.character-template-preview .character-template-summary')).toHaveTextContent(template.summary);
  expect(screen.getByRole('textbox', { name: 'Character name' })).toHaveValue('');
  expect(screen.getByRole('textbox', { name: 'Background' })).toHaveValue('');
  expect(screen.getByRole('textbox', { name: 'Personality' })).toHaveValue('');
  expect(screen.getByRole('textbox', { name: 'Baseline voice' })).toHaveValue('');
  expect(document.querySelector('.definition-detail .library-create-character')).not.toBeNull();
  expect(document.querySelector('.definition-list .library-create-character')).toBeNull();
  expect(native.apply).not.toHaveBeenCalled();

  fireEvent.click(screen.getByRole('button', { name: 'Use template' }));
  expect(screen.getByRole('textbox', { name: 'Background' })).toHaveValue(template.background);
  expect(screen.getByRole('textbox', { name: 'Personality' })).toHaveValue(template.personality);
  expect(screen.getByRole('textbox', { name: 'Baseline voice' })).toHaveValue(template.voice);
  expect(document.querySelector(`.library-create-character [data-character-icon="${template.icon}"]`)).not.toBeNull();
  expect(native.apply).not.toHaveBeenCalled();

  fireEvent.change(screen.getByRole('textbox', { name: 'Character name' }), { target: { value: 'Rae' } });
  fireEvent.change(screen.getByRole('textbox', { name: 'Background' }), { target: { value: 'An EMT who left the city.' } });
  fireEvent.change(screen.getByRole('textbox', { name: 'Personality' }), { target: { value: 'Dry humor and strong boundaries.' } });
  fireEvent.change(screen.getByRole('textbox', { name: 'Baseline voice' }), { target: { value: 'Short sentences, warmth in the details.' } });
  fireEvent.click(screen.getByRole('button', { name: 'Create character' }));

  await waitFor(() => expect(native.apply).toHaveBeenCalledTimes(1));
  expect(native.apply).toHaveBeenNthCalledWith(1, 'session-1', 0, {
    type: 'createCharacter', name: 'Rae', background: 'An EMT who left the city.', personality: 'Dry humor and strong boundaries.', voice: 'Short sentences, warmth in the details.', icon: template.icon,
  });
  expect(await screen.findByRole('textbox', { name: 'Character name' })).toHaveValue('Rae');
  expect(workspace.getSnapshot().project?.characters.at(-1)?.id).toBe('draft-1');
  expect(native.save).not.toHaveBeenCalled();

  fireEvent.click(screen.getByRole('button', { name: 'New character' }));
  fireEvent.click(screen.getByRole('button', { name: `Preview ${template.title}` }));
  fireEvent.click(screen.getByRole('button', { name: 'Use template' }));
  fireEvent.change(screen.getByRole('textbox', { name: 'Character name' }), { target: { value: 'Maren' } });
  fireEvent.click(screen.getByRole('button', { name: 'Create character' }));
  await waitFor(() => expect(native.apply).toHaveBeenCalledTimes(2));
  expect(native.apply).toHaveBeenNthCalledWith(2, 'session-1', 1, expect.objectContaining({ type: 'createCharacter', name: 'Maren' }));
  expect(workspace.getSnapshot().project?.characters.slice(-2).map(character => character.id)).toEqual(['draft-1', 'draft-2']);
});

it('keeps a pending character draft when viewing an existing profile and clears it only on Cancel', async () => {
  const template = stockCharacterTemplates[0];
  const snapshot = project(), native = gateway(snapshot), workspace = new Workspace(native);
  workspace.attach(session(snapshot));
  render(<LibraryHarness workspace={workspace} createRequest={1}/>);

  await screen.findByRole('button', { name: `Preview ${template.title}` });
  fireEvent.click(screen.getByRole('button', { name: `Preview ${template.title}` }));
  fireEvent.click(screen.getByRole('button', { name: 'Use template' }));
  fireEvent.change(screen.getByRole('textbox', { name: 'Character name' }), { target: { value: 'Juniper' } });
  fireEvent.click(screen.getByRole('button', { name: /Maya/ }));
  expect(screen.getByRole('textbox', { name: 'Character name' })).toHaveValue('Maya');
  expect(screen.queryByRole('button', { name: 'Create character' })).toBeNull();
  expect(native.apply).not.toHaveBeenCalled();

  fireEvent.click(screen.getByRole('button', { name: 'New character' }));
  expect(screen.getByRole('textbox', { name: 'Character name' })).toHaveValue('Juniper');
  expect(screen.getByRole('textbox', { name: 'Background' })).toHaveValue(template.background);
  fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
  fireEvent.click(screen.getByRole('button', { name: 'New character' }));
  expect(screen.getByRole('textbox', { name: 'Character name' })).toHaveValue('');
  expect(screen.getByRole('button', { name: 'Preview Blank character' })).toHaveAttribute('aria-pressed', 'true');
  expect(native.apply).not.toHaveBeenCalled();
});

it('searches aliases without accents and shows an explicit no-results recovery', async () => {
  const ingenue = stockCharacterTemplates.find(template => template.id === 'ingenue')!;
  const snapshot = project(), native = gateway(snapshot), workspace = new Workspace(native);
  workspace.attach(session(snapshot));
  render(<LibraryHarness workspace={workspace} createRequest={1}/>);

  const search = await screen.findByRole('searchbox', { name: 'Search character templates' });
  fireEvent.change(search, { target: { value: 'ingenue' } });
  expect(screen.getByRole('button', { name: `Preview ${ingenue.title}` })).toBeVisible();
  expect(screen.getByRole('button', { name: 'Preview Blank character' })).toBeVisible();
  fireEvent.click(screen.getByRole('button', { name: 'Social and personality' }));
  expect(screen.getByRole('button', { name: `Preview ${ingenue.title}` })).toBeVisible();
  expect(screen.getByRole('textbox', { name: 'Background' })).toHaveValue('');
  expect(native.apply).not.toHaveBeenCalled();

  fireEvent.change(search, { target: { value: 'no template has this phrase' } });
  expect(screen.getByText('No templates match these filters.')).toBeVisible();
  fireEvent.click(screen.getByRole('button', { name: 'Reset filters' }));
  expect(screen.getByRole('button', { name: `Preview ${ingenue.title}` })).toBeVisible();
  expect(screen.getByRole('button', { name: 'All categories' })).toHaveAttribute('aria-pressed', 'true');
  fireEvent.change(search, { target: { value: 'Pantalone' } });
  expect(screen.getByRole('button', { name: 'Preview The Miser' })).toBeVisible();
});

it('confirms replacing edited fields and protects a custom icon and name', async () => {
  const [first, second] = stockCharacterTemplates;
  const snapshot = project(), native = gateway(snapshot), workspace = new Workspace(native);
  workspace.attach(session(snapshot));
  render(<LibraryHarness workspace={workspace} createRequest={1}/>);

  await screen.findByRole('button', { name: `Preview ${first.title}` });
  fireEvent.click(screen.getByRole('button', { name: `Preview ${first.title}` }));
  fireEvent.click(screen.getByRole('button', { name: 'Use template' }));
  fireEvent.change(screen.getByRole('textbox', { name: 'Character name' }), { target: { value: 'Ada' } });
  fireEvent.change(screen.getByRole('textbox', { name: 'Background' }), { target: { value: 'My own background detail.' } });
  fireEvent.click(screen.getByRole('button', { name: 'Choose character icon' }));
  fireEvent.click(screen.getByRole('button', { name: 'Crown icon' }));

  fireEvent.click(screen.getByRole('button', { name: `Preview ${second.title}` }));
  fireEvent.click(screen.getByRole('button', { name: 'Use template' }));
  expect(screen.getByRole('alert')).toHaveTextContent('replaces background, personality, and baseline voice');
  fireEvent.click(screen.getByRole('button', { name: 'Keep current fields' }));
  expect(screen.getByRole('textbox', { name: 'Character name' })).toHaveValue('Ada');
  expect(screen.getByRole('textbox', { name: 'Background' })).toHaveValue('My own background detail.');
  expect(document.querySelector('.library-create-character [data-character-icon="crown"]')).not.toBeNull();

  fireEvent.click(screen.getByRole('button', { name: 'Use template' }));
  fireEvent.click(screen.getByRole('button', { name: 'Replace profile fields' }));
  expect(screen.getByRole('textbox', { name: 'Character name' })).toHaveValue('Ada');
  expect(screen.getByRole('textbox', { name: 'Background' })).toHaveValue(second.background);
  expect(screen.getByRole('textbox', { name: 'Personality' })).toHaveValue(second.personality);
  expect(screen.getByRole('textbox', { name: 'Baseline voice' })).toHaveValue(second.voice);
  expect(document.querySelector(`.library-create-character [data-character-icon="${second.icon}"]`)).not.toBeNull();

  fireEvent.click(screen.getByRole('button', { name: 'Clear profile fields' }));
  expect(screen.getByRole('alert')).toHaveTextContent('Your name and icon will stay.');
  fireEvent.click(screen.getByRole('button', { name: 'Clear profile fields' }));
  expect(screen.getByRole('textbox', { name: 'Character name' })).toHaveValue('Ada');
  expect(screen.getByRole('textbox', { name: 'Background' })).toHaveValue('');
  expect(screen.getByRole('textbox', { name: 'Personality' })).toHaveValue('');
  expect(screen.getByRole('textbox', { name: 'Baseline voice' })).toHaveValue('');
  expect(document.querySelector(`.library-create-character [data-character-icon="${second.icon}"]`)).not.toBeNull();
  expect(native.apply).not.toHaveBeenCalled();
});

it('edits an existing character icon and resets it to the default', async () => {
  const snapshot = project(), native = gateway(snapshot), workspace = new Workspace(native);
  workspace.attach(session(snapshot));
  let current = structuredClone(snapshot);
  vi.mocked(native.apply).mockImplementation(async (_session, _revision, operation) => {
    if (operation.type !== 'updateCharacter') throw new Error('Unexpected write');
    current = structuredClone(current);
    current.revision++;
    current.characters = current.characters.map(character => character.id === operation.characterId ? { ...character, ...operation } : character);
    return structuredClone(current);
  });
  render(<LibraryHarness workspace={workspace}/>);

  await screen.findByRole('button', { name: 'Choose character icon' });
  fireEvent.click(screen.getByRole('button', { name: 'Choose character icon' }));
  fireEvent.click(screen.getByRole('button', { name: 'Crown icon' }));
  await waitFor(() => expect(native.apply).toHaveBeenCalledWith('session-1', 0, { type: 'updateCharacter', characterId: 'character-1', icon: 'crown' }));
  expect(document.querySelector('.definition-rows [data-character-icon="crown"]')).not.toBeNull();

  fireEvent.click(screen.getByRole('button', { name: 'Use default icon' }));
  await waitFor(() => expect(native.apply).toHaveBeenCalledWith('session-1', 1, { type: 'updateCharacter', characterId: 'character-1', icon: '' }));
  expect(document.querySelector('.definition-rows [data-character-icon="user"]')).not.toBeNull();
});

it('retains a custom character draft after a failed creation and supports retry', async () => {
  const snapshot = project(), native = gateway(snapshot), workspace = new Workspace(native);
  workspace.attach(session(snapshot));
  vi.mocked(native.apply).mockRejectedValueOnce(new Error('The project could not be updated.'));
  render(<LibraryHarness workspace={workspace} createRequest={1}/>);
  fireEvent.change(await screen.findByRole('textbox', { name: 'Character name' }), { target: { value: 'Rowan' } });
  fireEvent.change(screen.getByRole('textbox', { name: 'Background' }), { target: { value: 'A traveler who keeps maps of unfamiliar places.' } });
  fireEvent.click(screen.getByRole('button', { name: 'Choose character icon' }));
  fireEvent.click(screen.getByRole('button', { name: 'Bird icon' }));
  fireEvent.click(screen.getByRole('button', { name: 'Create character' }));
  await waitFor(() => expect(native.apply).toHaveBeenCalledTimes(1));
  await waitFor(() => expect(screen.getByRole('button', { name: 'Create character' })).toBeEnabled());
  expect(screen.getByRole('textbox', { name: 'Character name' })).toHaveValue('Rowan');
  expect(screen.getByRole('textbox', { name: 'Background' })).toHaveValue('A traveler who keeps maps of unfamiliar places.');
  expect(document.querySelector('.library-create-character [data-character-icon="bird"]')).not.toBeNull();
  expect(workspace.getSnapshot().project).toEqual(snapshot);
  const created = structuredClone(snapshot);
  created.revision++;
  created.characters.push({ id: 'retry-character', name: 'Rowan', background: 'A traveler who keeps maps of unfamiliar places.', personality: '', voice: '', icon: 'bird', archived: false, defaultToneId: '', defaultEmotionId: '' });
  vi.mocked(native.apply).mockResolvedValueOnce(created);
  await act(async () => { await workspace.retry(); });
  await waitFor(() => expect(native.apply).toHaveBeenCalledTimes(2));
  expect(workspace.getSnapshot().project?.characters.at(-1)).toMatchObject({ id: 'retry-character', name: 'Rowan', icon: 'bird' });
  expect(screen.queryByRole('button', { name: 'Create character' })).toBeNull();
  expect(native.save).not.toHaveBeenCalled();
});

it('keeps Enter in template search from submitting a named draft', async () => {
  const snapshot = project(), native = gateway(snapshot), workspace = new Workspace(native);
  workspace.attach(session(snapshot));
  render(<LibraryHarness workspace={workspace} createRequest={1}/>);
  fireEvent.change(await screen.findByRole('textbox', { name: 'Character name' }), { target: { value: 'Rowan' } });
  const search = screen.getByRole('searchbox', { name: 'Search character templates' });
  expect(fireEvent.keyDown(search, { key: 'Enter', code: 'Enter' })).toBe(false);
  expect(native.apply).not.toHaveBeenCalled();
  expect(screen.getByRole('textbox', { name: 'Character name' })).toHaveValue('Rowan');
});

it('chooses a palette color on a new preset before creating it', async () => {
  const initial = project(), native = gateway(initial), workspace = new Workspace(native);
  workspace.attach(session(initial));
  let current = structuredClone(initial);
  vi.mocked(native.apply).mockImplementation(async (_session, _revision, operation) => {
    if (operation.type !== 'createPreset') throw new Error('Unexpected write');
    current = structuredClone(current);
    current.revision++;
    current.emotions.push({ id: 'emotion-awe', name: operation.name, meaning: '', guidance: '', example: '', color: operation.color ?? '', archived: false, revision: 0 });
    return structuredClone(current);
  });
  render(<LibraryHarness workspace={workspace} kind="emotions" createRequest={1}/>);

  fireEvent.change(await screen.findByRole('textbox', { name: 'New emotion name' }), { target: { value: 'Awe' } });
  expect(screen.getByText('Automatic · Discovery')).toBeVisible();
  fireEvent.click(screen.getByRole('button', { name: 'Use Conflict color #C85343' }));
  expect(screen.getByText('Conflict color')).toBeVisible();
  fireEvent.click(screen.getByRole('button', { name: 'Create emotion' }));

  await waitFor(() => expect(native.apply).toHaveBeenCalledTimes(1));
  expect(native.apply).toHaveBeenCalledWith('session-1', 0, { type: 'createPreset', kind: 'emotion', name: 'Awe', color: '#C85343' });
  expect(workspace.getSnapshot().project?.emotions[0]).toMatchObject({ name: 'Awe', color: '#C85343' });
  expect(await screen.findByText('Conflict color')).toBeVisible();
});

it('edits a preset color, resets to its automatic family, and accepts a custom color', async () => {
  const initial = project(), native = gateway(initial), workspace = new Workspace(native);
  initial.tones.push({ id: 'tone-personal', name: 'Personal tone', meaning: '', guidance: '', example: '', color: '#FF00AA', archived: false, revision: 0 });
  workspace.attach(session(initial));
  let current = structuredClone(initial);
  vi.mocked(native.apply).mockImplementation(async (_session, _revision, operation) => {
    if (operation.type !== 'updatePreset') throw new Error('Unexpected write');
    current = structuredClone(current);
    current.revision++;
    current.tones = current.tones.map(preset => preset.id === operation.presetId ? { ...preset, ...operation } : preset);
    return structuredClone(current);
  });
  render(<LibraryHarness workspace={workspace} kind="tones"/>);

  expect(await screen.findByText('Custom color #FF00AA')).toBeVisible();
  fireEvent.click(screen.getByRole('button', { name: 'Reset to default' }));
  await waitFor(() => expect(native.apply).toHaveBeenCalledTimes(1));
  expect(native.apply).toHaveBeenNthCalledWith(1, 'session-1', 0, { type: 'updatePreset', kind: 'tone', presetId: 'tone-personal', color: '' });
  expect(await screen.findByText('Automatic · Focus')).toBeVisible();

  fireEvent.click(screen.getByRole('button', { name: 'Use Connection color #BE527A' }));
  await waitFor(() => expect(native.apply).toHaveBeenCalledTimes(2));
  expect(native.apply).toHaveBeenNthCalledWith(2, 'session-1', 1, { type: 'updatePreset', kind: 'tone', presetId: 'tone-personal', color: '#BE527A' });

  fireEvent.change(screen.getByLabelText('Custom color'), { target: { value: '#123ABC' } });
  await waitFor(() => expect(native.apply).toHaveBeenCalledTimes(3));
  expect(native.apply).toHaveBeenNthCalledWith(3, 'session-1', 2, { type: 'updatePreset', kind: 'tone', presetId: 'tone-personal', color: '#123ABC' });
  expect(await screen.findByText('Custom color #123ABC')).toBeVisible();
});
