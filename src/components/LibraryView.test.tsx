import '../test/dom';
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useState, useSyncExternalStore } from 'react';
import { Workspace } from '../services/workspace';
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
  const initial = project(), native = gateway(initial), workspace = new Workspace(native);
  workspace.attach(session(initial));
  let nextId = 0;
  let current = structuredClone(initial);
  vi.mocked(native.apply).mockImplementation(async (_session, _revision, operation) => {
    if (operation.type !== 'createCharacter') throw new Error('Unexpected write');
    current = structuredClone(current); current.revision++;
    current.characters.push({ id: `draft-${++nextId}`, name: operation.name, background: operation.background ?? '', personality: operation.personality ?? '', voice: operation.voice ?? '', archived: false, defaultToneId: operation.defaultToneId ?? '', defaultEmotionId: operation.defaultEmotionId ?? '' });
    return structuredClone(current);
  });
  render(<LibraryHarness workspace={workspace} createRequest={1}/>);

  const template = await screen.findByRole('combobox', { name: 'Start from a template' });
  expect(screen.getByRole('textbox', { name: 'Character name' })).toHaveFocus();
  fireEvent.change(template, { target: { value: 'guarded-medic' } });
  expect(screen.getByRole('textbox', { name: 'Character name' })).toHaveValue('');
  expect(screen.getByRole('textbox', { name: 'Background' })).toHaveValue('Learned to care for others through necessity, often putting practical help before personal feelings.');
  expect(screen.getByRole('textbox', { name: 'Personality' })).toHaveValue('Competent, practical, and reluctant to admit concern.');
  expect(screen.getByRole('textbox', { name: 'Baseline voice' })).toHaveValue('Blunt, dry, and concise; care comes through instructions.');
  expect(document.querySelector('.definition-detail .library-create-character')).not.toBeNull();
  expect(document.querySelector('.definition-list .library-create-character')).toBeNull();
  expect(native.apply).not.toHaveBeenCalled();

  fireEvent.change(screen.getByRole('textbox', { name: 'Character name' }), { target: { value: 'Rae' } });
  fireEvent.change(screen.getByRole('textbox', { name: 'Background' }), { target: { value: 'An EMT who left the city.' } });
  fireEvent.change(screen.getByRole('textbox', { name: 'Personality' }), { target: { value: 'Dry humor and strong boundaries.' } });
  fireEvent.change(screen.getByRole('textbox', { name: 'Baseline voice' }), { target: { value: 'Short sentences, warmth in the details.' } });
  fireEvent.click(screen.getByRole('button', { name: 'Create character' }));

  await waitFor(() => expect(native.apply).toHaveBeenCalledTimes(1));
  expect(native.apply).toHaveBeenNthCalledWith(1, 'session-1', 0, {
    type: 'createCharacter', name: 'Rae', background: 'An EMT who left the city.', personality: 'Dry humor and strong boundaries.', voice: 'Short sentences, warmth in the details.',
  });
  expect(await screen.findByRole('textbox', { name: 'Character name' })).toHaveValue('Rae');
  expect(workspace.getSnapshot().project?.characters.at(-1)?.id).toBe('draft-1');
  expect(native.save).not.toHaveBeenCalled();

  fireEvent.click(screen.getByRole('button', { name: 'New character' }));
  fireEvent.change(screen.getByRole('combobox', { name: 'Start from a template' }), { target: { value: 'guarded-medic' } });
  fireEvent.change(screen.getByRole('textbox', { name: 'Character name' }), { target: { value: 'Maren' } });
  fireEvent.click(screen.getByRole('button', { name: 'Create character' }));
  await waitFor(() => expect(native.apply).toHaveBeenCalledTimes(2));
  expect(native.apply).toHaveBeenNthCalledWith(2, 'session-1', 1, expect.objectContaining({ type: 'createCharacter', name: 'Maren' }));
  expect(workspace.getSnapshot().project?.characters.slice(-2).map(character => character.id)).toEqual(['draft-1', 'draft-2']);
});

it('keeps a pending character draft when viewing an existing profile and clears it only on Cancel', async () => {
  const snapshot = project(), native = gateway(snapshot), workspace = new Workspace(native);
  workspace.attach(session(snapshot));
  render(<LibraryHarness workspace={workspace} createRequest={1}/>);

  fireEvent.change(await screen.findByRole('combobox', { name: 'Start from a template' }), { target: { value: 'observant-friend' } });
  fireEvent.change(screen.getByRole('textbox', { name: 'Character name' }), { target: { value: 'Juniper' } });
  fireEvent.click(screen.getByRole('button', { name: /Maya/ }));
  expect(screen.getByRole('textbox', { name: 'Character name' })).toHaveValue('Maya');
  expect(screen.queryByRole('button', { name: 'Create character' })).toBeNull();
  expect(native.apply).not.toHaveBeenCalled();

  fireEvent.click(screen.getByRole('button', { name: 'New character' }));
  expect(screen.getByRole('textbox', { name: 'Character name' })).toHaveValue('Juniper');
  expect(screen.getByRole('textbox', { name: 'Background' })).toHaveValue("Knows everyone's habits and keeps the group connected.");
  fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
  fireEvent.click(screen.getByRole('button', { name: 'New character' }));
  expect(screen.getByRole('textbox', { name: 'Character name' })).toHaveValue('');
  expect(screen.getByRole('combobox', { name: 'Start from a template' })).toHaveValue('');
  expect(native.apply).not.toHaveBeenCalled();
});
