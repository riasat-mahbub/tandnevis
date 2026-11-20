import { createContext, useContext, useEffect, useRef } from 'react';
import { Extension, Node, mergeAttributes } from '@tiptap/core';
import type { Editor } from '@tiptap/core';
import { useEditor, EditorContent, NodeViewWrapper, ReactNodeViewRenderer } from '@tiptap/react';
import type { NodeViewProps } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import { NodeSelection, Plugin, TextSelection } from '@tiptap/pm/state';
import { closeHistory } from '@tiptap/pm/history';
import { Fragment, Slice } from '@tiptap/pm/model';
import type { Node as PMNode } from '@tiptap/pm/model';
import type { EditorView } from '@tiptap/pm/view';
import type { Beat, Character, Preset } from '../services/project';
import './StoryBlocks.css';

export const CHARACTER_REFERENCE_MIME = 'application/x-shorthand-character-id';
export const PRESET_REFERENCE_MIME = 'application/x-shorthand-preset';
const newOccurrenceId = () => crypto.randomUUID();
export interface CharacterTarget { pos: number; occurrenceId: string; characterId: string; label: string; excerpt: string }
export function characterTargets(editor: Editor): CharacterTarget[] {
  const result: CharacterTarget[] = [];
  editor.state.doc.descendants((node, pos) => {
    if (node.type.name === 'characterReference') result.push({ pos, occurrenceId: node.attrs.occurrenceId ?? '', characterId: node.attrs.characterId, label: node.attrs.label, excerpt: editor.state.doc.textBetween(Math.max(0, pos - 24), Math.min(editor.state.doc.content.size, pos + 48), ' ') });
  });
  return result;
}
function insertCharacterAt(view: EditorView, character: Character, position: number): boolean {
  const $position = view.state.doc.resolve(position);
  if (!$position.parent.inlineContent) return false;
  const before = $position.nodeBefore, after = $position.nodeAfter;
  const leading = !!before && !(before.isText && /\s/.test(before.text?.slice(-1) ?? ''));
  const trailing = !(after?.isText && /\s/.test(after.text?.slice(0, 1) ?? ''));
  const reference = view.state.schema.nodes.characterReference.create({ occurrenceId: newOccurrenceId(), characterId: character.id, label: character.name, emotion: '', delivery: '' });
  const content = Fragment.fromArray([...(leading ? [view.state.schema.text(' ')] : []), reference, ...(trailing ? [view.state.schema.text(' ')] : [])]);
  const tr = view.state.tr.insert(position, content);
  tr.setSelection(TextSelection.near(tr.doc.resolve(position + content.size), 1));
  view.dispatch(closeHistory(tr).scrollIntoView()); return true;
}
export function insertCharacterReference(editor: Editor, character: Character) {
  return !editor.isDestroyed && editor.isEditable && insertCharacterAt(editor.view, character, editor.state.selection.from);
}
/** Consume app drags even when their definition or target disappeared. */
export function handleCharacterReferenceDrop(view: EditorView, event: DragEvent, characters: Character[]): boolean {
  let id = '';
  try { id = event.dataTransfer?.getData(CHARACTER_REFERENCE_MIME) ?? ''; } catch { return false; }
  if (!id) return false;
  event.preventDefault(); event.stopPropagation();
  const character = characters.find(candidate => candidate.id === id && !candidate.archived);
  const point = view.posAtCoords({ left: event.clientX, top: event.clientY });
  if (character && point && view.editable) insertCharacterAt(view, character, TextSelection.near(view.state.doc.resolve(point.pos)).from);
  return true;
}
function applyEmotion(view: EditorView, emotion: Preset, target: Pick<CharacterTarget, 'pos' | 'occurrenceId'>) {
  let position = target.pos;
  if (target.occurrenceId) view.state.doc.descendants((node, pos) => { if (node.type.name === 'characterReference' && node.attrs.occurrenceId === target.occurrenceId) position = pos; });
  const character = view.state.doc.nodeAt(position);
  if (character?.type.name !== 'characterReference') return false;
  const id = character.attrs.occurrenceId || newOccurrenceId();
  const tr = view.state.tr, removals: Array<[number, number]> = [];
  tr.doc.descendants((node, pos) => { if (node.type.name === 'emotionReference' && node.attrs.targetOccurrenceId === id) removals.push([pos, node.nodeSize]); });
  for (const [pos, size] of removals.reverse()) tr.delete(pos, pos + size);
  position = tr.mapping.map(position);
  tr.setNodeMarkup(position, undefined, { ...character.attrs, occurrenceId: id, emotion: '' });
  const insertAt = position + character.nodeSize;
  tr.insert(insertAt, view.state.schema.nodes.emotionReference.create({ emotionId: emotion.id, label: emotion.name, targetOccurrenceId: id }));
  tr.setSelection(NodeSelection.create(tr.doc, insertAt));
  view.dispatch(closeHistory(tr).scrollIntoView()); return true;
}
export function insertEmotionReference(editor: Editor, emotion: Preset, target: Pick<CharacterTarget, 'pos' | 'occurrenceId'>) {
  return !editor.isDestroyed && editor.isEditable && applyEmotion(editor.view, emotion, target);
}
function applyTone(view: EditorView, tone: Preset, position: number) {
  const existing: Array<[number, number]> = [];
  view.state.doc.descendants((node, pos) => { if (node.type.name === 'toneReference') existing.push([pos, node.nodeSize]); });
  const tr = view.state.tr;
  if (existing.length === 1) {
    const pos = existing[0][0];
    tr.setNodeMarkup(pos, undefined, { toneId: tone.id, label: tone.name }); tr.setSelection(NodeSelection.create(tr.doc, pos));
  } else {
    for (const [pos, size] of existing.reverse()) tr.delete(pos, pos + size);
    const pos = TextSelection.near(tr.doc.resolve(tr.mapping.map(position))).from;
    if (!tr.doc.resolve(pos).parent.inlineContent) return false;
    tr.insert(pos, view.state.schema.nodes.toneReference.create({ toneId: tone.id, label: tone.name })); tr.setSelection(NodeSelection.create(tr.doc, pos));
  }
  view.dispatch(closeHistory(tr).scrollIntoView()); return true;
}
export function insertToneReference(editor: Editor, tone: Preset) {
  return !editor.isDestroyed && editor.isEditable && applyTone(editor.view, tone, editor.state.selection.from);
}
export function removeSelectedReference(editor: Editor) {
  const selection = editor.state.selection;
  if (!(selection instanceof NodeSelection)) return false;
  return editor.commands.command(({ tr }) => { closeHistory(tr).delete(selection.from, selection.to); return true; });
}
export function updateCharacterReference(editor: Editor, attributes: { emotion?: string; delivery?: string }) {
  const selection = editor.state.selection;
  if (!(selection instanceof NodeSelection) || selection.node.type.name !== 'characterReference') return false;
  return editor.chain().command(({ tr }) => {
    tr.setNodeMarkup(selection.from, undefined, { ...selection.node.attrs, ...attributes });
    tr.setSelection(NodeSelection.create(tr.doc, selection.from)); return true;
  }).run();
}

const Definitions = createContext<{ characters: Character[]; tones: Preset[]; emotions: Preset[] }>({ characters: [], tones: [], emotions: [] });
function CharacterChip({ node, selected }: NodeViewProps) {
  const { characters } = useContext(Definitions);
  const label = characters.find(c => c.id === node.attrs.characterId)?.name ?? node.attrs.label;
  return <NodeViewWrapper as="span" className={`character-chip story-block block-character ${selected ? 'block-selected' : ''}`} data-occurrence-id={node.attrs.occurrenceId} contentEditable={false} title="Character · select to inspect this occurrence">{[label, node.attrs.emotion && `Emotion: ${node.attrs.emotion}`, node.attrs.delivery && `Delivery: ${node.attrs.delivery}`].filter(Boolean).join(' · ')}</NodeViewWrapper>;
}
function EmotionChip({ node, editor, selected }: NodeViewProps) {
  const { emotions, characters } = useContext(Definitions);
  const definition = emotions.find(p => p.id === node.attrs.emotionId);
  let target = '';
  editor.state.doc.descendants(candidate => { if (candidate.type.name === 'characterReference' && candidate.attrs.occurrenceId === node.attrs.targetOccurrenceId) target = characters.find(c => c.id === candidate.attrs.characterId)?.name ?? candidate.attrs.label; });
  return <NodeViewWrapper as="span" className={`story-block block-emotion ${selected ? 'block-selected' : ''}`} contentEditable={false} title={`Emotion for ${target || 'unresolved target'} · this occurrence only`}>Emotion: {definition?.name ?? node.attrs.label}</NodeViewWrapper>;
}
function ToneChip({ node, selected }: NodeViewProps) {
  const { tones } = useContext(Definitions);
  return <NodeViewWrapper as="span" className={`story-block block-tone ${selected ? 'block-selected' : ''}`} contentEditable={false} title="Tone for this beat only">Beat tone: {tones.find(p => p.id === node.attrs.toneId)?.name ?? node.attrs.label}</NodeViewWrapper>;
}
export const CharacterReference = Node.create({
  name: 'characterReference', group: 'inline', inline: true, atom: true, selectable: true,
  addAttributes() { return { occurrenceId: { default: '' }, characterId: { default: '' }, label: { default: '' }, emotion: { default: '' }, delivery: { default: '' } }; },
  parseHTML() { return [{ tag: 'span[data-character-reference]' }]; },
  renderHTML({ node, HTMLAttributes }) { return ['span', mergeAttributes(HTMLAttributes, { 'data-character-reference': '', class: 'character-chip story-block block-character' }), [node.attrs.label, node.attrs.emotion && `Emotion: ${node.attrs.emotion}`, node.attrs.delivery && `Delivery: ${node.attrs.delivery}`].filter(Boolean).join(' · ')]; },
  renderText({ node }) { return node.attrs.label || 'Character'; }, addNodeView() { return ReactNodeViewRenderer(CharacterChip); },
});
export const EmotionReference = Node.create({
  name: 'emotionReference', group: 'inline', inline: true, atom: true, selectable: true,
  addAttributes() { return { emotionId: { default: '' }, label: { default: '' }, targetOccurrenceId: { default: '' } }; },
  parseHTML() { return [{ tag: 'span[data-emotion-reference]' }]; },
  renderHTML({ node, HTMLAttributes }) { return ['span', mergeAttributes(HTMLAttributes, { 'data-emotion-reference': '', class: 'story-block block-emotion' }), `Emotion: ${node.attrs.label}`]; },
  renderText({ node }) { return `[Emotion: ${node.attrs.label}]`; }, addNodeView() { return ReactNodeViewRenderer(EmotionChip); },
});
export const ToneReference = Node.create({
  name: 'toneReference', group: 'inline', inline: true, atom: true, selectable: true,
  addAttributes() { return { toneId: { default: '' }, label: { default: '' } }; },
  parseHTML() { return [{ tag: 'span[data-tone-reference]' }]; },
  renderHTML({ node, HTMLAttributes }) { return ['span', mergeAttributes(HTMLAttributes, { 'data-tone-reference': '', class: 'story-block block-tone' }), `Beat tone: ${node.attrs.label}`]; },
  renderText({ node }) { return `[Beat tone: ${node.attrs.label}]`; }, addNodeView() { return ReactNodeViewRenderer(ToneChip); },
});
const BlockIntegrity = Extension.create({
  name: 'blockIntegrity',
  addOptions() { return { notify: (_message: string) => {} }; },
  addProseMirrorPlugins() {
    const notify = this.options.notify;
    return [new Plugin({
      filterTransaction(transaction) {
        if (!transaction.docChanged) return true;
        let tones = 0;
        transaction.doc.descendants(node => { if (node.type.name === 'toneReference') tones++; });
        if (tones > 1) { notify('A beat can have one tone block. Choose a tone from the shelf to replace it.'); return false; }
        return true;
      },
      appendTransaction(transactions, _oldState, state) {
        if (!transactions.some(t => t.docChanged)) return null;
        const ids = new Set<string>(); state.doc.descendants(node => { if (node.type.name === 'characterReference' && node.attrs.occurrenceId) ids.add(node.attrs.occurrenceId); });
        const tr = state.tr, removals: Array<[number, number]> = [];
        state.doc.descendants((node, pos) => { if (node.type.name === 'emotionReference' && !ids.has(node.attrs.targetOccurrenceId)) removals.push([pos, node.nodeSize]); });
        for (const [pos, size] of removals.reverse()) tr.delete(pos, pos + size);
        return removals.length ? tr : null;
      },
      props: {
        transformPasted(slice) {
          const ids = new Map<string, string>(); slice.content.descendants(node => { if (node.type.name === 'characterReference') ids.set(node.attrs.occurrenceId, newOccurrenceId()); });
          const transform = (fragment: Fragment): Fragment => {
            const nodes: PMNode[] = [];
            fragment.forEach(node => {
              if (node.type.name === 'emotionReference' && !ids.has(node.attrs.targetOccurrenceId)) return;
              const attrs = node.type.name === 'characterReference' ? { ...node.attrs, occurrenceId: ids.get(node.attrs.occurrenceId) ?? newOccurrenceId() } : node.type.name === 'emotionReference' ? { ...node.attrs, targetOccurrenceId: ids.get(node.attrs.targetOccurrenceId) } : node.attrs;
              nodes.push(node.isText ? node : node.type.create(attrs, node.content.size ? transform(node.content) : undefined, node.marks));
            }); return Fragment.fromArray(nodes);
          }; return new Slice(transform(slice.content), slice.openStart, slice.openEnd);
        },
      },
    })];
  },
});

interface Props {
  beat: Beat; index: number; characters: Character[]; tones?: Preset[]; emotions?: Preset[];
  onChange: (document: Beat['document'], text: string) => void; onFocus: (editor: Editor) => void; onSelection: (editor: Editor) => void;
  register: (id: string, editor: Editor | null) => void; editable?: boolean; notify?: (message: string) => void;
}
export default function BeatEditor({ beat, index, characters, tones = [], emotions = [], onChange, onFocus, onSelection, register, editable = true, notify }: Props) {
  const callbacks = useRef({ onChange, onFocus, onSelection, notify, characters, tones, emotions }); callbacks.current = { onChange, onFocus, onSelection, notify, characters, tones, emotions };
  const editor = useEditor({
    extensions: [StarterKit, CharacterReference, EmotionReference, ToneReference, BlockIntegrity.configure({ notify: (message: string) => callbacks.current.notify?.(message) })], content: beat.document, editable,
    editorProps: {
      attributes: { role: 'textbox', 'aria-label': `Freeform text for beat ${index + 1}`, 'aria-multiline': 'true', 'data-placeholder': 'Write anything that happens here…', spellcheck: 'true' },
      handleDOMEvents: {
        dragover(view, event) {
          const drag = event as DragEvent;
          if (!view.editable || !drag.dataTransfer?.types.some(t => t === CHARACTER_REFERENCE_MIME || t === PRESET_REFERENCE_MIME)) return false;
          event.preventDefault(); const target = (event.target as Element | null)?.closest?.('[data-occurrence-id]');
          view.dom.querySelectorAll('.block-drop-target').forEach(item => item.classList.remove('block-drop-target')); target?.classList.add('block-drop-target'); return true;
        },
        dragleave(view) { view.dom.querySelectorAll('.block-drop-target').forEach(item => item.classList.remove('block-drop-target')); return false; },
      },
      handleDrop(view, event) {
        view.dom.querySelectorAll('.block-drop-target').forEach(item => item.classList.remove('block-drop-target'));
        if (handleCharacterReferenceDrop(view, event, callbacks.current.characters)) return true;
        const payload = event.dataTransfer?.getData(PRESET_REFERENCE_MIME); if (!payload) return false;
        event.preventDefault(); event.stopPropagation(); if (!view.editable) return true;
        try {
          const value = JSON.parse(payload) as { kind?: string; id?: string };
          if (value.kind === 'tone') {
            const preset = callbacks.current.tones.find(p => p.id === value.id && !p.archived), point = view.posAtCoords({ left: event.clientX, top: event.clientY });
            if (preset && point && applyTone(view, preset, point.pos)) callbacks.current.notify?.(`${preset.name} applies to this beat only.`);
          } else if (value.kind === 'emotion') {
            const preset = callbacks.current.emotions.find(p => p.id === value.id && !p.archived), target = (event.target as Element | null)?.closest?.('[data-occurrence-id]'), id = target?.getAttribute('data-occurrence-id');
            let pos = -1; view.state.doc.descendants((node, at) => { if (node.type.name === 'characterReference' && id && node.attrs.occurrenceId === id) pos = at; });
            if (preset && pos >= 0) { applyEmotion(view, preset, { pos, occurrenceId: id! }); callbacks.current.notify?.(`${preset.name} applies to this character occurrence only.`); }
            else callbacks.current.notify?.('Drop an emotion directly onto the character block it should affect.');
          }
        } catch { callbacks.current.notify?.('This block could not be inserted. Choose a block from Story blocks.'); } return true;
      },
      handleClickOn(view, pos, node) {
        if (!['characterReference', 'emotionReference', 'toneReference'].includes(node.type.name)) return false;
        view.dispatch(view.state.tr.setSelection(NodeSelection.create(view.state.doc, pos))); return true;
      },
    },
    onUpdate({ editor }) { callbacks.current.onChange(editor.getJSON(), editor.getText({ blockSeparator: '\n\n' })); },
    onFocus({ editor }) { callbacks.current.onFocus(editor); callbacks.current.onSelection(editor); }, onSelectionUpdate({ editor }) { callbacks.current.onSelection(editor); },
  });
  useEffect(() => { if (editor) register(beat.id, editor); return () => register(beat.id, null); }, [editor, beat.id, register]);
  useEffect(() => { if (!editor) return; const incoming = editor.schema.nodeFromJSON(beat.document); if (!editor.state.doc.eq(incoming)) editor.commands.setContent(beat.document, { emitUpdate: false }); }, [beat.document, editor]);
  useEffect(() => { editor?.setEditable(editable, false); }, [editable, editor]);
  return <Definitions.Provider value={{ characters, tones, emotions }}><EditorContent editor={editor} className="beat-prose" /></Definitions.Provider>;
}
