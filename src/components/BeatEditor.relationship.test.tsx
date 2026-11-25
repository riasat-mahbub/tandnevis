import '../test/dom';
import { afterEach, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { Editor, JSONContent } from '@tiptap/core';
import { NodeSelection } from '@tiptap/pm/state';
import { Fragment, Slice } from '@tiptap/pm/model';
import type { RelationshipChange } from '../services/relationships';
import { relationshipChangeText } from '../services/relationships';
import BeatEditor, { focusRelationshipChange } from './BeatEditor';
import { project } from '../test/fixtures';

afterEach(() => { cleanup(); document.body.innerHTML = ''; });

const change: RelationshipChange = {
  id: 'relation-change-1', sceneId: 'scene-1', sourceId: 'character-1', targetId: 'character-2',
  kind: 'attitude', mutual: false, phase: 'after', description: 'Trust grows slowly.', status: 'planned',
};

function documentWithRelationship(changeId = change.id): JSONContent {
  return { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'relationshipChange', attrs: { changeId } }] }] };
}

function setup(scope: 'summary' | 'beat' = 'summary', relationshipChanges = [change]) {
  const p = project();
  const beat = { id: scope === 'summary' ? 'summary-1' : 'beat-1', text: '', document: documentWithRelationship() };
  let editor!: Editor;
  const onChange = vi.fn(), onSelectRelationshipChange = vi.fn(), notify = vi.fn();
  const view = render(<BeatEditor
    beat={beat}
    index={-1}
    scope={scope}
    sceneId="scene-1"
    relationshipChanges={relationshipChanges}
    onSelectRelationshipChange={onSelectRelationshipChange}
    characters={p.characters}
    register={(_, value) => { if (value) editor = value; }}
    onChange={onChange}
    onFocus={vi.fn()}
    onSelection={vi.fn()}
    notify={notify}
  />);
  return { ...view, beat, characters: p.characters, onChange, onSelectRelationshipChange, notify, get editor() { return editor; } };
}

it('renders a live relationship label and signals the graph editor on click and keyboard activation', async () => {
  const view = setup();
  const label = relationshipChangeText({ characters: view.characters }, change);
  const chip = await screen.findByRole('button', { name: label.slice(1, -1) });
  const originalDocument = view.editor.getJSON();

  fireEvent.click(chip);
  expect(view.editor.state.selection).toBeInstanceOf(NodeSelection);
  expect(view.onSelectRelationshipChange).toHaveBeenCalledExactlyOnceWith(change.id);

  view.onSelectRelationshipChange.mockClear();
  chip.focus();
  fireEvent.keyDown(chip, { key: 'Enter' });
  expect(view.editor.state.selection).toBeInstanceOf(NodeSelection);
  expect(view.onSelectRelationshipChange).toHaveBeenCalledExactlyOnceWith(change.id);
  act(() => {
    view.editor.commands.insertContentAt(view.editor.state.doc.content.size - 1, ' temporary note');
    view.editor.commands.undo();
    focusRelationshipChange(view.editor, change.id);
  });
  expect(view.editor.can().redo()).toBe(true);

  const updated = { ...change, description: 'They begin to trust one another.' };
  view.onChange.mockClear();
  view.rerender(<BeatEditor
    beat={view.beat}
    index={-1}
    scope="summary"
    sceneId="scene-1"
    relationshipChanges={[updated]}
    characters={view.characters}
    register={vi.fn()}
    onChange={view.onChange}
    onFocus={vi.fn()}
    onSelection={vi.fn()}
  />);
  expect(await screen.findByRole('button', { name: relationshipChangeText({ characters: view.characters }, updated).slice(1, -1) })).toBeInTheDocument();
  expect(view.editor.getJSON()).toEqual(originalDocument);
  expect(view.editor.state.selection).toBeInstanceOf(NodeSelection);
  expect(view.editor.can().redo()).toBe(true);
  expect(view.onChange).not.toHaveBeenCalled();
});

function transformPasted(editor: Editor, slice: Slice) {
  let transformed = slice;
  editor.view.someProp('transformPasted', handler => {
    transformed = handler(transformed, editor.view, false);
    return false;
  });
  return transformed;
}

function hasRelationshipReference(fragment: Fragment) {
  let found = false;
  fragment.descendants(node => { if (node.type.name === 'relationshipChange') found = true; });
  return found;
}

it('rejects relationship references in beats and references from another scene', async () => {
  const beatView = setup('beat');
  await waitFor(() => expect(beatView.editor.state.doc.textContent).toBe(''));
  expect(hasRelationshipReference(beatView.editor.state.doc.content)).toBe(false);

  const beatPaste = beatView.editor.schema.nodes.relationshipChange.create({ changeId: change.id });
  const beatSlice = new Slice(Fragment.from(beatView.editor.schema.nodes.paragraph.create(null, beatPaste)), 0, 0);
  expect(hasRelationshipReference(transformPasted(beatView.editor, beatSlice).content)).toBe(false);
  expect(beatView.notify).toHaveBeenCalledWith(expect.stringContaining('Relationship changes'));

  const validSummary = setup('summary');
  await waitFor(() => expect(validSummary.editor).toBeDefined());
  const foreign = { ...change, id: 'foreign-change', sceneId: 'scene-2' };
  const pasted = validSummary.editor.schema.nodes.relationshipChange.create({ changeId: foreign.id });
  const slice = new Slice(Fragment.from(validSummary.editor.schema.nodes.paragraph.create(null, pasted)), 0, 0);
  const transformed = transformPasted(validSummary.editor, slice);
  expect(hasRelationshipReference(transformed.content)).toBe(false);
  validSummary.notify.mockClear();
  const repeated = validSummary.editor.schema.nodes.relationshipChange.create({ changeId: change.id });
  const repeatedSlice = new Slice(Fragment.from(validSummary.editor.schema.nodes.paragraph.create(null, repeated)), 0, 0);
  expect(hasRelationshipReference(transformPasted(validSummary.editor, repeatedSlice).content)).toBe(false);
  expect(validSummary.notify).toHaveBeenCalledWith(expect.stringContaining('only once'));
  expect(focusRelationshipChange(validSummary.editor, change.id)).toBe(true);
  expect(validSummary.editor.state.selection).toBeInstanceOf(NodeSelection);
});

it('refreshes the relationship node view without focusing the editor from the focus helper', async () => {
  const view = setup();
  await screen.findByRole('button', { name: relationshipChangeText({ characters: view.characters }, change).slice(1, -1) });
  const focus = vi.spyOn(view.editor.view, 'focus');

  act(() => { expect(focusRelationshipChange(view.editor, change.id)).toBe(true); });

  expect(focus).not.toHaveBeenCalled();
  expect(view.editor.state.selection).toBeInstanceOf(NodeSelection);
});

it('accepts an external graph removal through incoming summary content without an extra editor write', async () => {
  const view = setup();
  await screen.findByRole('button', { name: relationshipChangeText({ characters: view.characters }, change).slice(1, -1) });
  view.onChange.mockClear();
  const nextBeat = { ...view.beat, document: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'The scene continues.' }] }] } };

  view.rerender(<BeatEditor
    beat={nextBeat}
    index={-1}
    scope="summary"
    sceneId="scene-1"
    relationshipChanges={[]}
    characters={view.characters}
    register={vi.fn()}
    onChange={view.onChange}
    onFocus={vi.fn()}
    onSelection={vi.fn()}
  />);

  await waitFor(() => expect(view.editor.state.doc.textContent).toBe('The scene continues.'));
  expect(hasRelationshipReference(view.editor.state.doc.content)).toBe(false);
  expect(view.onChange).not.toHaveBeenCalled();
});
