import '../test/dom';
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useState, useSyncExternalStore } from 'react';
import { Workspace } from '../services/workspace';
import type { LibraryKind } from './LibraryView';
import LibraryView from './LibraryView';
import { gateway, project, session } from '../test/fixtures';

afterEach(cleanup);

function LibraryHarness({
  workspace,
  kind = 'characters',
  onCreateCharacter = vi.fn(),
  hasCharacterDraft = false,
  onResumeCharacterDraft = vi.fn(),
}: {
  workspace: Workspace;
  kind?: LibraryKind;
  onCreateCharacter?: () => void;
  hasCharacterDraft?: boolean;
  onResumeCharacterDraft?: () => void;
}) {
  const state = useSyncExternalStore(workspace.subscribe, workspace.getSnapshot, workspace.getSnapshot);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  if (!state.project) return null;
  return <LibraryView kind={kind} project={state.project} workspace={workspace} locked={false} selectedId={selectedId} onSelect={setSelectedId}
    onCreateCharacter={onCreateCharacter} hasCharacterDraft={hasCharacterDraft} onResumeCharacterDraft={onResumeCharacterDraft}
    onOpenUsage={vi.fn()} onOpenCharacter={vi.fn()} notify={vi.fn()} run={action => { void action().catch(() => {}); }}/>;
}

it('routes character creation and resume to the host wizard without project writes', () => {
  const snapshot = project(), native = gateway(snapshot), workspace = new Workspace(native);
  workspace.attach(session(snapshot));
  const start = vi.fn(), resume = vi.fn();
  render(<LibraryHarness workspace={workspace} onCreateCharacter={start} hasCharacterDraft onResumeCharacterDraft={resume}/>);

  fireEvent.click(screen.getByRole('button', { name: 'New character' }));
  fireEvent.click(screen.getByRole('button', { name: 'Resume character draft' }));

  expect(start).toHaveBeenCalledOnce();
  expect(resume).toHaveBeenCalledOnce();
  expect(document.querySelector('.library-create-character')).toBeNull();
  expect(native.apply).not.toHaveBeenCalled();
  expect(native.save).not.toHaveBeenCalled();
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
  render(<LibraryHarness workspace={workspace} kind="emotions"/>);

  fireEvent.click(screen.getAllByRole('button', { name: 'New emotion' })[0]);
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
