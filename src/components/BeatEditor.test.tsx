import '../test/dom';
import { afterEach, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import type { Editor, JSONContent } from '@tiptap/core';
import BeatEditor, { updateCharacterReference } from './BeatEditor';
import { project } from '../test/fixtures';

afterEach(cleanup);
it('renders renamed character profiles without changing documents, saving, or consuming redo', async () => {
  const p = project(); const beat = p.scenes[0].beats[0];
  beat.document = { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'characterReference', attrs: { characterId: 'character-1', label: 'Old label', emotion: '', delivery: '' } }] }] };
  const onChange = vi.fn(), register = vi.fn();
  const props = { beat, index: 0, characters: p.characters, onChange, onFocus: vi.fn(), onSelection: vi.fn(), register };
  const view = render(<BeatEditor {...props}/>);
  await screen.findByText('Maya');
  expect(onChange).not.toHaveBeenCalled();
  const editor = register.mock.calls.find(c => c[1])![1] as Editor;
  act(() => { editor.commands.insertContentAt(editor.state.doc.content.size - 1, ' is here'); });
  act(() => { editor.commands.undo(); });
  expect(editor.can().redo()).toBe(true);
  onChange.mockClear();
  view.rerender(<BeatEditor {...props} characters={[{ ...p.characters[0], name: 'Mara' }]}/>);
  await screen.findByText('Mara');
  expect(onChange).not.toHaveBeenCalled(); expect(editor.can().redo()).toBe(true);
  expect((editor.getJSON() as JSONContent).content![0].content![0].attrs!.label).toBe('Old label');
});
it('keeps local direction on the selected reference and locks only during project switching', async () => {
  const p = project(), beat = p.scenes[0].beats[0];
  beat.document = { type: 'doc', content: [{ type: 'paragraph', content: [
    { type: 'characterReference', attrs: { characterId: 'character-1', label: 'Maya', emotion: '', delivery: '' } },
    { type: 'text', text: ' and ' },
    { type: 'characterReference', attrs: { characterId: 'character-1', label: 'Maya', emotion: '', delivery: '' } },
  ] }] };
  let editor: Editor | null = null;
  const register = (_id: string, value: Editor | null) => { editor = value; };
  const props = { beat, index: 0, characters: p.characters, onChange: vi.fn(), onFocus: vi.fn(), onSelection: vi.fn(), register };
  const view = render(<BeatEditor {...props}/>);
  await waitFor(() => expect(editor).not.toBeNull());
  act(() => { editor!.commands.setNodeSelection(1); updateCharacterReference(editor!, { emotion: 'Relieved' }); });
  const content = (editor!.getJSON() as JSONContent).content![0].content!;
  expect(content[0].attrs!.emotion).toBe('Relieved'); expect(content[2].attrs!.emotion).toBe(''); expect(p.characters[0]).not.toHaveProperty('emotion');
  view.rerender(<BeatEditor {...props} editable={false}/>);
  expect(screen.getByRole('textbox', { name: 'Freeform text for beat 1' })).toHaveAttribute('contenteditable', 'false');
  view.rerender(<BeatEditor {...props} editable/>);
  expect(screen.getByRole('textbox', { name: 'Freeform text for beat 1' })).toHaveAttribute('contenteditable', 'true');
});
it('preserves the selected character reference when a save acknowledgement changes only JSON key order', async () => {
  const p = project(), beat = p.scenes[0].beats[0];
  beat.document = { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'characterReference', attrs: { characterId: 'character-1', label: 'Maya', emotion: '', delivery: '' } }] }] };
  let editor: Editor | null = null;
  const register = (_id: string, value: Editor | null) => { editor = value; };
  const onChange = vi.fn();
  const props = { beat, index: 0, characters: p.characters, onChange, onFocus: vi.fn(), onSelection: vi.fn(), register };
  const view = render(<BeatEditor {...props}/>);
  await waitFor(() => expect(editor).not.toBeNull());
  act(() => { editor!.commands.setNodeSelection(1); updateCharacterReference(editor!, { emotion: 'Relieved' }); });
  const before = editor!.state.selection;
  const acknowledgement = { content: [{ content: [{ attrs: { delivery: '', emotion: 'Relieved', label: 'Maya', characterId: 'character-1' }, type: 'characterReference' }], type: 'paragraph' }], type: 'doc' };
  expect(JSON.stringify(acknowledgement)).not.toBe(JSON.stringify(editor!.getJSON()));
  onChange.mockClear();
  view.rerender(<BeatEditor {...props} beat={{ ...beat, document: acknowledgement }}/>);
  expect(editor!.state.selection.eq(before)).toBe(true);
  expect('node' in editor!.state.selection).toBe(true);
  expect(onChange).not.toHaveBeenCalled();
  act(() => { expect(updateCharacterReference(editor!, { delivery: 'Quietly' })).toBe(true); });
  expect((editor!.getJSON() as JSONContent).content![0].content![0].attrs).toMatchObject({ emotion: 'Relieved', delivery: 'Quietly' });
});
