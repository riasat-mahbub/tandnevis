import '../test/dom';
import { afterEach, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { Editor, JSONContent } from '@tiptap/core';
import type { Preset } from '../services/project';
import { NodeSelection } from '@tiptap/pm/state';
import { Fragment, Slice } from '@tiptap/pm/model';
import { presetColorStyle } from '../services/preset-colors';
import BeatEditor, { CHARACTER_REFERENCE_MIME, PRESET_REFERENCE_MIME, INLINE_REFERENCE_MIME, characterTargets, insertCharacterReference, insertEmotionReference, insertInlineReference, insertToneReference, removeSelectedReference, updateCharacterReference } from './BeatEditor';
import { project } from '../test/fixtures';

afterEach(() => { cleanup(); document.body.innerHTML = ''; });

it('refreshes a referenced character icon without rewriting the inline document', async () => {
  const p = project(), onChange = vi.fn();
  const character = { ...p.characters[0], icon: 'coins' };
  const beat = { id: 'icon-beat', text: character.name, document: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'characterReference', attrs: { characterId: character.id, label: character.name, occurrenceId: 'icon-occurrence' } }] }] } };
  const props = { beat, index: 0, characters: [character], onChange, onFocus: vi.fn(), onSelection: vi.fn(), register: vi.fn() };
  const view = render(<BeatEditor {...props}/>);
  expect(await view.findByText(character.name)).toContainElement(view.container.querySelector('[data-character-icon="coins"]'));
  view.rerender(<BeatEditor {...props} characters={[{ ...character, icon: 'crown' }]}/>);
  await waitFor(() => expect(view.container.querySelector('[data-character-icon="crown"]')).not.toBeNull());
  expect(view.container.querySelector('[data-character-icon="coins"]')).toBeNull();
  expect(onChange).not.toHaveBeenCalled();
});

function dataTransfer() {
  const values = new Map<string, string>();
  return {
    get types() { return [...values.keys()]; },
    getData: (type: string) => values.get(type) ?? '',
    setData: (type: string, value: string) => { values.set(type, value); },
    clearData: () => { values.clear(); },
    setDragImage: vi.fn(), files: [], effectAllowed: 'all', dropEffect: 'none',
  } as unknown as DataTransfer;
}

function referenceTransfer(kind: 'tone' | 'emotion', id: string) {
  const transfer = dataTransfer();
  transfer.setData(PRESET_REFERENCE_MIME, JSON.stringify({ kind, id }));
  return transfer;
}

function drop(target: Element, transfer: DataTransfer, clientX: number, clientY: number, modifiers: { ctrlKey?: boolean; altKey?: boolean } = {}) {
  const event = new Event('drop', { bubbles: true, cancelable: true });
  Object.assign(event, { dataTransfer: transfer, clientX, clientY, ...modifiers });
  fireEvent(target, event);
}

function documentWith(content: JSONContent[]) {
  return { type: 'doc', content: [{ type: 'paragraph', content }] };
}

function inlineNodes(editor: Editor) {
  const paragraph = editor.state.doc.firstChild;
  return paragraph ? paragraph.content.content : [];
}

function renderCard(beat: ReturnType<typeof project>['scenes'][number]['beats'][number], options: { summary?: boolean; characters?: ReturnType<typeof project>['characters']; tones?: any[]; emotions?: any[] } = {}) {
  let editor!: Editor;
  const card = options.summary
    ? <section className="summary-note" data-reference-drop-board data-board-id={beat.id}><h2>Scene summary</h2><BeatEditor beat={beat} index={-1} scope="summary" ariaLabel="Scene summary" characters={options.characters ?? []} tones={options.tones ?? []} emotions={options.emotions ?? []} register={(_, value) => { if (value) editor = value; }} onChange={vi.fn()} onFocus={vi.fn()} onSelection={vi.fn()}/></section>
    : <article className="note-card"><div className="card-actions">Card actions</div><div className="beat-content" data-reference-drop-board data-board-id={beat.id}><span className="beat-label">Beat 1</span><BeatEditor beat={beat} index={0} characters={options.characters ?? []} tones={options.tones ?? []} emotions={options.emotions ?? []} register={(_, value) => { if (value) editor = value; }} onChange={vi.fn()} onFocus={vi.fn()} onSelection={vi.fn()}/></div></article>;
  return { ...render(card), get editor() { return editor; } };
}

it('drops characters, emotions, and tones anywhere in a summary board', async () => {
  const p = project();
  const tone = { id: 'tender', name: 'Tender', meaning: '', guidance: '', example: '', archived: false, revision: 0 };
  const emotion = { id: 'awe', name: 'Awe', meaning: '', guidance: '', example: '', archived: false, revision: 0 };
  const beat = { id: 'summary', text: '', document: { type: 'doc', content: [{ type: 'paragraph' }] } };
  const view = renderCard(beat, { summary: true, characters: p.characters, tones: [tone], emotions: [emotion] });
  const board = screen.getByRole('textbox', { name: 'Scene summary' }).closest('[data-reference-drop-board]')!;
  vi.spyOn(view.editor.view, 'posAtCoords').mockReturnValue(null);
  vi.spyOn(view.editor.view.dom, 'getBoundingClientRect').mockReturnValue({ top: 60, bottom: 120 } as DOMRect);

  const character = dataTransfer(); character.setData(CHARACTER_REFERENCE_MIME, 'character-1');
  fireEvent.dragOver(board, { dataTransfer: character, clientX: 20, clientY: 80 });
  expect(board).toHaveClass('board-drop-active');
  fireEvent.drop(board, { dataTransfer: character, clientX: 20, clientY: 80 });
  fireEvent.drop(board, { dataTransfer: referenceTransfer('emotion', 'awe'), clientX: 30, clientY: 100 });
  fireEvent.drop(board, { dataTransfer: referenceTransfer('tone', 'tender'), clientX: 40, clientY: 110 });

  await waitFor(() => expect(inlineNodes(view.editor).filter(node => ['characterReference', 'emotionReference', 'toneReference'].includes(node.type.name))).toHaveLength(3));
  expect(inlineNodes(view.editor).map(node => node.type.name).filter(name => name !== 'text')).toEqual(['characterReference', 'emotionReference', 'toneReference']);
  expect(board).not.toHaveClass('board-drop-active');
});

it('uses real drops on the full card, placing heading drops at the start and lower padding drops at the end', async () => {
  const p = project(), beat = p.scenes[0].beats[0];
  beat.document = documentWith([{ type: 'text', text: 'middle' }]);
  const view = renderCard(beat, { characters: p.characters, emotions: [{ id: 'awe', name: 'Awe', meaning: '', guidance: '', example: '', archived: false, revision: 0 }], tones: [{ id: 'tender', name: 'Tender', meaning: '', guidance: '', example: '', archived: false, revision: 0 }] });
  const card = view.container.querySelector('.note-card')!;
  vi.spyOn(view.editor.view, 'posAtCoords').mockReturnValue(null);
  vi.spyOn(view.editor.view.dom, 'getBoundingClientRect').mockReturnValue({ top: 100, bottom: 180 } as DOMRect);

  const emotion = referenceTransfer('emotion', 'awe');
  fireEvent.dragOver(card.querySelector('.beat-label')!, { dataTransfer: emotion, clientX: 20, clientY: 60 });
  expect(card).toHaveClass('board-drop-active');
  drop(card.querySelector('.beat-label')!, emotion, 20, 60);
  drop(card, referenceTransfer('tone', 'tender'), 40, 240);

  await waitFor(() => expect(inlineNodes(view.editor).filter(node => ['emotionReference', 'toneReference'].includes(node.type.name))).toHaveLength(2));
  const nodes = inlineNodes(view.editor);
  expect(nodes.map(node => node.type.name)).toEqual(['emotionReference', 'text', 'toneReference', 'text']);
  expect(nodes.findIndex(node => node.type.name === 'toneReference')).toBeGreaterThan(nodes.findIndex(node => node.type.name === 'text'));
  expect(nodes.filter(node => node.isText).map(node => node.text).join('')).toContain('middle');
  expect(card).not.toHaveClass('board-drop-active');
});

it('moves an inline character across boards by itself and preserves legacy emotion data without orphan cleanup', async () => {
  const p = project(), sourceBeat = p.scenes[0].beats[0];
  sourceBeat.document = documentWith([
    { type: 'characterReference', attrs: { characterId: 'character-1', occurrenceId: 'old-maya', label: 'Maya', emotion: '', delivery: '' } },
    { type: 'text', text: ' waits. ' },
    { type: 'emotionReference', attrs: { emotionId: 'awe', label: 'Awe', targetOccurrenceId: 'old-maya' } },
  ]);
  const targetBeat = { ...p.scenes[0].beats[1], document: documentWith([{ type: 'text', text: 'Door opens.' }]) };
  const tone = { id: 'tender', name: 'Tender', meaning: '', guidance: '', example: '', archived: false, revision: 0 };
  const editors = new Map<string, Editor>();
  const register = (id: string, value: Editor | null) => { if (value) editors.set(id, value); };
  const view = render(<><article className="note-card"><div data-reference-drop-board><BeatEditor beat={sourceBeat} index={0} characters={p.characters} register={register} onChange={vi.fn()} onFocus={vi.fn()} onSelection={vi.fn()}/></div></article><article className="note-card"><div data-reference-drop-board><BeatEditor beat={targetBeat} index={1} characters={p.characters} tones={[tone]} register={register} onChange={vi.fn()} onFocus={vi.fn()} onSelection={vi.fn()}/></div></article></>);
  await waitFor(() => expect(editors.size).toBe(2));
  const source = editors.get(sourceBeat.id)!, target = editors.get(targetBeat.id)!;
  const chip = source.view.dom.querySelector('[data-occurrence-id]')!;
  const transfer = dataTransfer();
  vi.spyOn(source.view, 'posAtCoords').mockReturnValue(null);
  vi.spyOn(target.view, 'posAtCoords').mockReturnValue(null);
  fireEvent.mouseDown(chip, { button: 0 });
  fireEvent.dragStart(chip, { dataTransfer: transfer });
  expect(transfer.getData(INLINE_REFERENCE_MIME)).not.toBe('');
  const targetCard = view.container.querySelectorAll('.note-card')[1];
  fireEvent.drop(targetCard, { dataTransfer: transfer, clientX: 30, clientY: 80 });

  expect(characterTargets(source)).toHaveLength(0);
  const moved = characterTargets(target);
  expect(moved).toHaveLength(1);
  expect(moved[0].occurrenceId).not.toBe('old-maya');
  const legacyEmotion = inlineNodes(source).find(node => node.type.name === 'emotionReference');
  expect(legacyEmotion?.attrs).toMatchObject({ emotionId: 'awe', targetOccurrenceId: 'old-maya' });
  expect(view.container.querySelector('.block-emotion')).toHaveTextContent('Emotion: Awe');

  const nextShelfDrag = referenceTransfer('tone', 'tender');
  fireEvent.dragOver(view.container.querySelectorAll('.note-card')[1], { dataTransfer: nextShelfDrag });
  expect(nextShelfDrag.dropEffect).toBe('copy');
  drop(view.container.querySelectorAll('.note-card')[1], nextShelfDrag, 40, 100);
  expect(inlineNodes(target).filter(node => node.type.name === 'toneReference')).toHaveLength(1);

  act(() => { source.commands.undo(); });
  expect(characterTargets(source)).toHaveLength(1);
  expect(inlineNodes(source).find(node => node.type.name === 'emotionReference')?.attrs.targetOccurrenceId).toBe('old-maya');
  act(() => { target.commands.undo(); target.commands.undo(); });
  expect(characterTargets(target)).toHaveLength(0);
  fireEvent.dragEnd(document, { dataTransfer: transfer });
});

it('Ctrl-drag copies an inline reference and gives the copy a fresh character occurrence ID', async () => {
  const p = project(), beat = p.scenes[0].beats[0];
  beat.document = documentWith([{ type: 'characterReference', attrs: { characterId: 'character-1', occurrenceId: 'original', label: 'Maya' } }, { type: 'text', text: ' waits.' }]);
  const view = renderCard(beat, { characters: p.characters });
  await waitFor(() => expect(view.editor).toBeDefined());
  const chip = view.editor.view.dom.querySelector('[data-occurrence-id]')!;
  const transfer = dataTransfer();
  vi.spyOn(view.editor.view, 'posAtCoords').mockReturnValue(null);
  fireEvent.mouseDown(chip, { button: 0 });
  fireEvent.dragStart(chip, { dataTransfer: transfer });
  const copyDrop = new Event('drop', { bubbles: true, cancelable: true });
  Object.assign(copyDrop, { dataTransfer: transfer, ctrlKey: true, clientX: 60, clientY: 140 });
  fireEvent(view.container.querySelector('.note-card')!, copyDrop);
  const targets = characterTargets(view.editor);
  expect(targets).toHaveLength(2);
  expect(targets[0].occurrenceId).toBe('original');
  expect(targets[1].occurrenceId).not.toBe('original');
  fireEvent.dragEnd(document, { dataTransfer: transfer });
});

it('inserts unbound emotions at the caret, allows multiples, and keeps legacy targets after character removal', async () => {
  const p = project(), beat = p.scenes[0].beats[0];
  beat.document = documentWith([
    { type: 'characterReference', attrs: { characterId: 'character-1', occurrenceId: 'target', label: 'Maya' } },
    { type: 'emotionReference', attrs: { emotionId: 'legacy', label: 'Legacy', targetOccurrenceId: 'target' } },
  ]);
  const emotion = { id: 'awe', name: 'Awe', meaning: '', guidance: '', example: '', archived: false, revision: 0 };
  let editor!: Editor;
  render(<BeatEditor beat={beat} index={0} characters={p.characters} emotions={[emotion]} register={(_, value) => { if (value) editor = value; }} onChange={vi.fn()} onFocus={vi.fn()} onSelection={vi.fn()}/>);
  await waitFor(() => expect(editor).toBeDefined());

  act(() => { expect(insertEmotionReference(editor, emotion)).toBe(true); expect(insertInlineReference(editor, 'emotion', emotion)).toBe(true); });
  expect(inlineNodes(editor).filter(node => node.type.name === 'emotionReference')).toHaveLength(3);
  const unboundEmotions = inlineNodes(editor).filter(node => node.type.name === 'emotionReference' && node.attrs.emotionId === 'awe');
  expect(unboundEmotions).toHaveLength(2);
  expect(unboundEmotions.every(node => !node.attrs.targetOccurrenceId)).toBe(true);
  act(() => { editor.commands.setNodeSelection(characterTargets(editor)[0].pos); expect(removeSelectedReference(editor)).toBe(true); });
  expect(characterTargets(editor)).toHaveLength(0);
  expect(inlineNodes(editor).filter(node => node.type.name === 'emotionReference')).toHaveLength(3);
  expect(inlineNodes(editor).find(node => node.attrs.emotionId === 'legacy')?.attrs.targetOccurrenceId).toBe('target');
});

it('keeps multiple tone references in order instead of replacing earlier tones', async () => {
  const p = project(), beat = p.scenes[0].beats[0];
  const first = { id: 'tense', name: 'Tense', meaning: '', guidance: 'Pressure.', example: '', archived: false, revision: 0 };
  const second = { id: 'tender', name: 'Tender', meaning: '', guidance: 'Care.', example: '', archived: false, revision: 0 };
  let editor!: Editor;
  render(<BeatEditor beat={beat} index={0} characters={[]} tones={[first, second]} register={(_, value) => { if (value) editor = value; }} onChange={vi.fn()} onFocus={vi.fn()} onSelection={vi.fn()}/>);
  await waitFor(() => expect(editor).toBeDefined());
  act(() => { expect(insertToneReference(editor, first)).toBe(true); expect(insertToneReference(editor, second)).toBe(true); });
  expect(inlineNodes(editor).filter(node => node.type.name === 'toneReference').map(node => node.attrs.toneId)).toEqual(['tense', 'tender']);
  act(() => { editor.commands.undo(); });
  expect(inlineNodes(editor).filter(node => node.type.name === 'toneReference').map(node => node.attrs.toneId)).toEqual(['tense']);
});

it('remaps legacy character targets on pasted paired references and preserves unpaired legacy data', async () => {
  const p = project(), beat = p.scenes[0].beats[0];
  let editor!: Editor;
  render(<BeatEditor beat={beat} index={0} characters={p.characters} register={(_, value) => { if (value) editor = value; }} onChange={vi.fn()} onFocus={vi.fn()} onSelection={vi.fn()}/>);
  await waitFor(() => expect(editor).toBeDefined());
  const paragraph = editor.schema.nodes.paragraph.create(null, [
    editor.schema.nodes.characterReference.create({ characterId: 'character-1', occurrenceId: 'paste-id', label: 'Maya' }),
    editor.schema.nodes.emotionReference.create({ emotionId: 'legacy', label: 'Legacy', targetOccurrenceId: 'paste-id' }),
    editor.schema.nodes.emotionReference.create({ emotionId: 'alone', label: 'Alone', targetOccurrenceId: 'missing-id' }),
    editor.schema.nodes.emotionReference.create({ emotionId: 'unbound', label: 'Unbound', targetOccurrenceId: '' }),
  ]);
  const transform = editor.view.someProp('transformPasted', handler => handler(new Slice(Fragment.from(paragraph), 0, 0), editor.view, false)) as Slice | undefined;
  expect(transform).toBeInstanceOf(Slice);
  const pasted = transform!.content.firstChild!.content.content;
  const newOccurrenceId = pasted.find(node => node.type.name === 'characterReference')!.attrs.occurrenceId;
  expect(newOccurrenceId).not.toBe('paste-id');
  expect(pasted.find(node => node.attrs.emotionId === 'legacy')?.attrs.targetOccurrenceId).toBe(newOccurrenceId);
  expect(pasted.find(node => node.attrs.emotionId === 'alone')?.attrs.targetOccurrenceId).toBe('missing-id');
  expect(pasted.find(node => node.attrs.emotionId === 'unbound')?.attrs.targetOccurrenceId).toBe('');
});

it('preserves character-local legacy guidance and blocks only while the project is switching', async () => {
  const p = project(), beat = p.scenes[0].beats[0];
  beat.document = documentWith([
    { type: 'characterReference', attrs: { characterId: 'character-1', label: 'Maya', emotion: '', delivery: '' } },
    { type: 'text', text: ' and ' },
    { type: 'characterReference', attrs: { characterId: 'character-1', label: 'Maya', emotion: '', delivery: '' } },
  ]);
  let editor: Editor | null = null;
  const props = { beat, index: 0, characters: p.characters, onChange: vi.fn(), onFocus: vi.fn(), onSelection: vi.fn(), register: (_id: string, value: Editor | null) => { editor = value; } };
  const view = render(<BeatEditor {...props}/>);
  await waitFor(() => expect(editor).not.toBeNull());
  act(() => { editor!.commands.setNodeSelection(1); updateCharacterReference(editor!, { emotion: 'Relieved' }); });
  const content = inlineNodes(editor!);
  expect(content[0].attrs.emotion).toBe('Relieved'); expect(content[2].attrs.emotion).toBe(''); expect(p.characters[0]).not.toHaveProperty('emotion');
  view.rerender(<BeatEditor {...props} editable={false}/>);
  expect(screen.getByRole('textbox', { name: 'Freeform text for beat 1' })).toHaveAttribute('contenteditable', 'false');
  view.rerender(<BeatEditor {...props} editable/>);
  expect(screen.getByRole('textbox', { name: 'Freeform text for beat 1' })).toHaveAttribute('contenteditable', 'true');
});

it('renders renamed profiles without rewriting references or creating a save', async () => {
  const p = project(), beat = p.scenes[0].beats[0];
  beat.document = documentWith([{ type: 'characterReference', attrs: { characterId: 'character-1', label: 'Old label', emotion: '', delivery: '' } }]);
  const onChange = vi.fn(), register = vi.fn();
  const props = { beat, index: 0, onChange, onFocus: vi.fn(), onSelection: vi.fn(), register };
  const view = render(<BeatEditor {...props} characters={p.characters}/>);
  await screen.findByText('Maya');
  expect(onChange).not.toHaveBeenCalled();
  const editor = register.mock.calls.find(c => c[1])![1] as Editor;
  act(() => { editor.commands.insertContentAt(editor.state.doc.content.size - 1, ' is here'); editor.commands.undo(); });
  expect(editor.can().redo()).toBe(true);
  onChange.mockClear();
  view.rerender(<BeatEditor {...props} characters={[{ ...p.characters[0], name: 'Mara' }]}/>);
  await screen.findByText('Mara');
  expect(onChange).not.toHaveBeenCalled(); expect(editor.can().redo()).toBe(true);
  expect(inlineNodes(editor)[0].attrs.label).toBe('Old label');
});

it('updates inline emotion and tone colors from definitions without changing the document or creating a save', async () => {
  const p = project(), beat = p.scenes[0].beats[0];
  beat.document = documentWith([
    { type: 'emotionReference', attrs: { emotionId: 'awe', label: 'Awe' } },
    { type: 'text', text: ' then ' },
    { type: 'toneReference', attrs: { toneId: 'tender', label: 'Tender' } },
  ]);
  const emotion = { id: 'awe', name: 'Awe', meaning: '', guidance: '', example: '', archived: false, revision: 0 } as Preset;
  const tone = { id: 'tender', name: 'Tender', meaning: '', guidance: '', example: '', archived: false, revision: 0 } as Preset;
  const onChange = vi.fn(), register = vi.fn();
  const props = { beat, index: 0, characters: [], onChange, onFocus: vi.fn(), onSelection: vi.fn(), register };
  const view = render(<BeatEditor {...props} emotions={[emotion]} tones={[tone]}/>);
  await screen.findByText('Emotion: Awe');
  const editor = register.mock.calls.find(call => call[1])![1] as Editor;
  act(() => {
    editor.commands.insertContentAt(editor.state.doc.content.size - 1, ' draft');
    editor.commands.undo();
    editor.commands.setNodeSelection(1);
  });
  expect(editor.state.selection).toBeInstanceOf(NodeSelection);
  expect(editor.can().redo()).toBe(true);
  const originalDocument = editor.getJSON();
  onChange.mockClear();

  view.rerender(<BeatEditor {...props} emotions={[{ ...emotion, color: '#000000' }]} tones={[{ ...tone, color: '#FF00AA' }]}/>);

  await waitFor(() => {
    const emotionChip = view.container.querySelector('.block-emotion') as HTMLElement;
    const toneChip = view.container.querySelector('.block-tone') as HTMLElement;
    expect(emotionChip.style.getPropertyValue('--preset-bg-light')).toBe((presetColorStyle('#000000') as Record<string, string>)['--preset-bg-light']);
    expect(toneChip.style.getPropertyValue('--preset-bg-light')).toBe((presetColorStyle('#FF00AA') as Record<string, string>)['--preset-bg-light']);
    expect(emotionChip.style.getPropertyValue('--preset-bg-dark')).not.toBe(toneChip.style.getPropertyValue('--preset-bg-dark'));
  });
  expect(editor.getJSON()).toEqual(originalDocument);
  expect(editor.state.selection).toBeInstanceOf(NodeSelection);
  expect(editor.state.selection.from).toBe(1);
  expect(editor.can().redo()).toBe(true);
  expect(onChange).not.toHaveBeenCalled();
});

it('keeps keyboard click-to-insert available and consumes stale shelf drops', async () => {
  const p = project(), beat = p.scenes[0].beats[0];
  beat.document = { type: 'doc', content: [{ type: 'paragraph' }] };
  let editor!: Editor;
  render(<BeatEditor beat={beat} index={0} characters={p.characters} register={(_, value) => { if (value) editor = value; }} onChange={vi.fn()} onFocus={vi.fn()} onSelection={vi.fn()}/>);
  await waitFor(() => expect(editor).toBeDefined());
  act(() => { expect(insertCharacterReference(editor, p.characters[0])).toBe(true); });
  expect(characterTargets(editor)).toHaveLength(1);
  const stale = dataTransfer(); stale.setData(CHARACTER_REFERENCE_MIME, 'deleted-character');
  const event = new Event('drop', { bubbles: true, cancelable: true });
  Object.assign(event, { dataTransfer: stale, clientX: 20, clientY: 20 });
  fireEvent(editor.view.dom, event);
  expect(event.defaultPrevented).toBe(true);
  expect(characterTargets(editor)).toHaveLength(1);
});
