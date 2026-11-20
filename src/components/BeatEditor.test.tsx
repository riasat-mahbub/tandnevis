import '../test/dom';
import { afterEach, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import type { Editor, JSONContent } from '@tiptap/core';
import BeatEditor, { CHARACTER_REFERENCE_MIME, handleCharacterReferenceDrop, updateCharacterReference, characterTargets, insertEmotionReference, insertToneReference, removeSelectedReference } from './BeatEditor';
import { project } from '../test/fixtures';

afterEach(cleanup);
it('targets one repeated character occurrence with a separate emotion and removes linked blocks undoably', async () => {
  const p = project(), beat = p.scenes[0].beats[0];
  beat.document = { type: 'doc', content: [{ type: 'paragraph', content: [
    { type: 'characterReference', attrs: { characterId: 'character-1', occurrenceId: 'one', label: 'Maya' } },
    { type: 'text', text: ' then ' },
    { type: 'characterReference', attrs: { characterId: 'character-1', occurrenceId: 'two', label: 'Maya' } },
  ] }] };
  const emotion = { id: 'awe', name: 'Awe', meaning: '', guidance: 'Admiration', example: '', archived: false, revision: 1 };
  let editor!: Editor;
  render(<BeatEditor beat={beat} index={0} characters={p.characters} emotions={[emotion]} register={(_, value) => { if (value) editor = value; }} onChange={vi.fn()} onFocus={vi.fn()} onSelection={vi.fn()}/>);
  await waitFor(() => expect(editor).toBeDefined());
  act(() => { expect(insertEmotionReference(editor, emotion, characterTargets(editor)[1])).toBe(true); });
  await waitFor(() => expect(document.querySelector('.block-emotion')).toHaveTextContent('Emotion: Awe'));
  const content = (editor.getJSON() as JSONContent).content![0].content!;
  expect(content.filter(n => n.type === 'emotionReference')).toHaveLength(1);
  expect(content.find(n => n.type === 'emotionReference')!.attrs!.targetOccurrenceId).toBe('two');
  act(() => { editor.commands.setNodeSelection(characterTargets(editor)[1].pos); removeSelectedReference(editor); });
  expect((editor.getJSON() as JSONContent).content![0].content!.some(n => n.type === 'emotionReference')).toBe(false);
  act(() => { editor.commands.undo(); });
  expect((editor.getJSON() as JSONContent).content![0].content!.find(n => n.type === 'emotionReference')!.attrs!.targetOccurrenceId).toBe('two');
});
it('adds and replaces a whole-beat tone in a character-free beat', async () => {
  const p = project(), preset = { id: 'tense', name: 'Tense', meaning: '', guidance: 'Pressure.', example: '', archived: false, revision: 0 };
  let editor!: Editor;
  render(<BeatEditor beat={p.scenes[0].beats[0]} index={0} characters={[]} tones={[preset]} register={(_, value) => { if (value) editor = value; }} onChange={vi.fn()} onFocus={vi.fn()} onSelection={vi.fn()}/>);
  await waitFor(() => expect(editor).toBeDefined());
  act(() => { insertToneReference(editor, preset); insertToneReference(editor, { ...preset, id: 'tender', name: 'Tender' }); });
  const nodes = (editor.getJSON() as JSONContent).content![0].content!;
  expect(nodes.filter(n => n.type === 'toneReference')).toHaveLength(1);
  expect(nodes.find(n => n.type === 'toneReference')!.attrs!.toneId).toBe('tender');
  expect(editor.getText()).toContain('The door opens.');
});
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

it('drops a character profile at the pointer position and keeps direction local to the new reference', async () => {
  const p = project(), beat = p.scenes[0].beats[0];
  beat.document = { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Hello world' }] }] };
  let editor: Editor | null = null;
  const register = (_id: string, value: Editor | null) => { editor = value; };
  const props = { beat, index: 0, characters: p.characters, onChange: vi.fn(), onFocus: vi.fn(), onSelection: vi.fn(), register };
  render(<BeatEditor {...props}/>);
  await waitFor(() => expect(editor).not.toBeNull());

  vi.spyOn(editor!.view, 'posAtCoords').mockReturnValue({ pos: 7, inside: 1 });
  const dataTransfer = { getData: (format: string) => format === CHARACTER_REFERENCE_MIME ? 'character-1' : '' } as DataTransfer;
  const event = { dataTransfer, clientX: 50, clientY: 40, preventDefault: vi.fn(), stopPropagation: vi.fn() } as unknown as DragEvent;
  act(() => { expect(handleCharacterReferenceDrop(editor!.view, event, p.characters)).toBe(true); });

  expect(event.preventDefault).toHaveBeenCalledOnce();
  expect(event.stopPropagation).toHaveBeenCalledOnce();
  expect(editor!.getText()).toBe('Hello Maya world');
  const inserted = (editor!.getJSON() as JSONContent).content![0].content!.find(node => node.type === 'characterReference');
  expect(inserted?.attrs).toMatchObject({ characterId: 'character-1', label: 'Maya', emotion: '', delivery: '' });
});

it('drops a profile into an empty beat and consumes stale Shorthand drags without inserting text', async () => {
  const p = project(), beat = p.scenes[0].beats[0];
  beat.document = { type: 'doc', content: [{ type: 'paragraph' }] };
  let editor: Editor | null = null;
  const register = (_id: string, value: Editor | null) => { editor = value; };
  const props = { beat, index: 0, characters: p.characters, onChange: vi.fn(), onFocus: vi.fn(), onSelection: vi.fn(), register };
  render(<BeatEditor {...props}/>);
  await waitFor(() => expect(editor).not.toBeNull());
  vi.spyOn(editor!.view, 'posAtCoords').mockReturnValue({ pos: 1, inside: 1 });

  const eventFor = (id: string) => ({
    dataTransfer: { getData: (format: string) => format === CHARACTER_REFERENCE_MIME ? id : '' } as DataTransfer,
    clientX: 20, clientY: 20, preventDefault: vi.fn(), stopPropagation: vi.fn(),
  } as unknown as DragEvent);
  const firstDrop = eventFor('character-1');
  act(() => { expect(handleCharacterReferenceDrop(editor!.view, firstDrop, p.characters)).toBe(true); });
  expect((editor!.getJSON() as JSONContent).content![0].content![0].attrs).toMatchObject({ characterId: 'character-1', emotion: '', delivery: '' });

  const staleDrop = eventFor('deleted-character');
  const before = editor!.getJSON();
  act(() => { expect(handleCharacterReferenceDrop(editor!.view, staleDrop, p.characters)).toBe(true); });
  expect(staleDrop.preventDefault).toHaveBeenCalledOnce();
  expect(editor!.getJSON()).toEqual(before);
});
