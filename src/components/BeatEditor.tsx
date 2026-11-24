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
import { effectiveColor, presetColorStyle } from '../services/preset-colors';
import CharacterIcon from './CharacterIcon';
import './StoryBlocks.css';

export const CHARACTER_REFERENCE_MIME = 'application/x-shorthand-character-id';
export const PRESET_REFERENCE_MIME = 'application/x-shorthand-preset';
export const INLINE_REFERENCE_MIME = 'application/x-shorthand-inline-reference';
const newOccurrenceId = () => crypto.randomUUID();
type BoardScope = 'summary' | 'beat';
export type ReferenceKind = 'character' | 'emotion' | 'tone';
interface InlineDrag { token: string; source: EditorView; node: PMNode; pos: number; document: PMNode }
let inlineDrag: InlineDrag | null = null;
let activeDropSurface: Element | null = null;

/** Use the nearest text edge when a drop lands on a card label or padding. */
function dropPosition(view: EditorView, event: Pick<DragEvent, 'clientX' | 'clientY'>): number {
  const size = view.state.doc.content.size;
  let position: number | undefined;
  try { position = view.posAtCoords({ left: event.clientX, top: event.clientY })?.pos; }
  catch { /* Fall back to the nearest edge below. */ }
  if (position === undefined) {
    const rect = view.dom.getBoundingClientRect();
    position = event.clientY < rect.top || (event.clientY >= rect.top && event.clientY < (rect.top + rect.bottom) / 2) ? 0 : size;
  }
  const clamped = Math.max(0, Math.min(position, size));
  return TextSelection.near(view.state.doc.resolve(clamped), clamped === 0 ? 1 : -1).from;
}

function clearDropFeedback(view: EditorView, surface?: Element) {
  view.dom.classList.remove('board-drop-active');
  surface?.classList.remove('board-drop-active');
  activeDropSurface?.classList.remove('board-drop-active');
  activeDropSurface = null;
}

function dropSurfaceFor(view: EditorView): Element {
  return view.dom.closest('.note-card')
    ?? view.dom.closest('[data-reference-drop-board]')
    ?? view.dom.closest('.summary-note')
    ?? view.dom;
}

function removeDraggedSource(drag: InlineDrag) {
  if (drag.source.isDestroyed || !drag.source.editable || !drag.source.state.doc.eq(drag.document)) return false;
  drag.source.dispatch(closeHistory(drag.source.state.tr.delete(drag.pos, drag.pos + drag.node.nodeSize)));
  return true;
}

function createReferenceNode(view: EditorView, kind: ReferenceKind, definition: Character | Preset): PMNode {
  if (kind === 'character') {
    const character = definition as Character;
    return view.state.schema.nodes.characterReference.create({ occurrenceId: newOccurrenceId(), characterId: character.id, label: character.name, emotion: '', delivery: '' });
  }
  const preset = definition as Preset;
  return kind === 'emotion'
    ? view.state.schema.nodes.emotionReference.create({ emotionId: preset.id, label: preset.name })
    : view.state.schema.nodes.toneReference.create({ toneId: preset.id, label: preset.name });
}

function insertNodeAt(view: EditorView, tr: EditorView['state']['tr'], position: number, node: PMNode): boolean {
  let safePosition = Math.max(0, Math.min(position, tr.doc.content.size));
  let $position = tr.doc.resolve(safePosition);
  if (!$position.parent.inlineContent) {
    safePosition = TextSelection.near($position, -1).from;
    $position = tr.doc.resolve(safePosition);
  }
  if (!$position.parent.inlineContent) return false;
  const before = $position.nodeBefore, after = $position.nodeAfter;
  const beforeText = before?.isText ? before.text ?? '' : '';
  const afterText = after?.isText ? after.text ?? '' : '';
  const leading = !!before && !/\s$/.test(beforeText) && !/[([{“‘]$/.test(beforeText);
  const trailing = !after || (!/^\s/.test(afterText) && !/^[,.;:!?)}\]]/.test(afterText));
  const content = Fragment.fromArray([...(leading ? [view.state.schema.text(' ')] : []), node, ...(trailing ? [view.state.schema.text(' ')] : [])]);
  tr.insert(safePosition, content);
  tr.setSelection(TextSelection.near(tr.doc.resolve(safePosition + content.size), 1));
  return true;
}

function insertReferenceAt(view: EditorView, kind: ReferenceKind, definition: Character | Preset, position: number): boolean {
  const tr = view.state.tr;
  if (!insertNodeAt(view, tr, position, createReferenceNode(view, kind, definition))) return false;
  view.dispatch(closeHistory(tr).scrollIntoView());
  return true;
}

function handleInlineReferenceDrop(view: EditorView, event: DragEvent, notify: (message: string) => void): boolean {
  const token = event.dataTransfer?.getData(INLINE_REFERENCE_MIME);
  if (!token) return false;
  event.preventDefault(); event.stopPropagation();
  const drag = inlineDrag;
  const finish = () => {
    if (inlineDrag?.token === token) inlineDrag = null;
    if (drag && !drag.source.isDestroyed) clearDropFeedback(drag.source, dropSurfaceFor(drag.source));
  };
  if (!view.editable || !drag || drag.token !== token || drag.source.isDestroyed || !drag.source.state.doc.eq(drag.document)) {
    notify('This block changed while dragging. Drag it again from its current position.'); finish(); return true;
  }
  const copy = event.ctrlKey || event.altKey;
  let position = dropPosition(view, event);
  const tr = view.state.tr;
  if (!copy && drag.source === view) {
    if (position >= drag.pos && position <= drag.pos + drag.node.nodeSize) { finish(); return true; }
    tr.delete(drag.pos, drag.pos + drag.node.nodeSize);
    position = TextSelection.near(tr.doc.resolve(tr.mapping.map(position)), -1).from;
  }
  const attrs = drag.node.type.name === 'characterReference' && (copy || drag.source !== view)
    ? { ...drag.node.attrs, occurrenceId: newOccurrenceId() }
    : drag.node.attrs;
  const targetType = view.state.schema.nodes[drag.node.type.name];
  if (!targetType || !insertNodeAt(view, tr, position, targetType.create(attrs, drag.node.content, drag.node.marks))) { finish(); return true; }
  view.dispatch(closeHistory(tr).scrollIntoView());
  if (!copy && drag.source !== view && !removeDraggedSource(drag)) notify('The block was copied because its source changed while dragging.');
  finish();
  view.focus(); return true;
}

function isReferenceDrag(event: DragEvent): boolean {
  const types = Array.from(event.dataTransfer?.types ?? []);
  return types.some(type => type === CHARACTER_REFERENCE_MIME || type === PRESET_REFERENCE_MIME || type === INLINE_REFERENCE_MIME);
}

function handleShelfReferenceDrop(view: EditorView, event: DragEvent, characters: Character[], tones: Preset[], emotions: Preset[], notify: (message: string) => void): boolean {
  let characterId = '', payload = '';
  try {
    characterId = event.dataTransfer?.getData(CHARACTER_REFERENCE_MIME) ?? '';
    payload = event.dataTransfer?.getData(PRESET_REFERENCE_MIME) ?? '';
  } catch { return false; }
  if (!characterId && !payload) return false;
  event.preventDefault(); event.stopPropagation();
  if (!view.editable) { inlineDrag = null; return true; }
  const character = characters.find(candidate => candidate.id === characterId && !candidate.archived);
  if (characterId) {
    if (character) insertReferenceAt(view, 'character', character, dropPosition(view, event));
    else notify('This character is unavailable. Choose an active character from Story blocks.');
    inlineDrag = null;
    return true;
  }
  try {
    const value = JSON.parse(payload) as { kind?: string; id?: string };
    const kind: ReferenceKind | undefined = value.kind === 'emotion' ? 'emotion' : value.kind === 'tone' ? 'tone' : undefined;
    const definitions = kind === 'emotion' ? emotions : tones;
    const definition = definitions.find(preset => preset.id === value.id && !preset.archived);
    if (kind && definition) insertReferenceAt(view, kind, definition, dropPosition(view, event));
    else notify('This block is unavailable. Choose an active block from Story blocks.');
  } catch { notify('This block could not be inserted. Choose a block from Story blocks.'); }
  inlineDrag = null;
  return true;
}
export interface CharacterTarget { pos: number; occurrenceId: string; characterId: string; label: string; excerpt: string }
export function characterTargets(editor: Editor): CharacterTarget[] {
  const result: CharacterTarget[] = [];
  editor.state.doc.descendants((node, pos) => {
    if (node.type.name === 'characterReference') result.push({ pos, occurrenceId: node.attrs.occurrenceId ?? '', characterId: node.attrs.characterId, label: node.attrs.label, excerpt: editor.state.doc.textBetween(Math.max(0, pos - 24), Math.min(editor.state.doc.content.size, pos + 48), ' ') });
  });
  return result;
}
/** Insert any library reference at the current caret; useful to keyboard users as well as click-to-insert. */
export function insertInlineReference(editor: Editor, kind: ReferenceKind, definition: Character | Preset) {
  return !editor.isDestroyed && editor.isEditable && insertReferenceAt(editor.view, kind, definition, editor.state.selection.from);
}
export function insertCharacterReference(editor: Editor, character: Character) {
  return insertInlineReference(editor, 'character', character);
}
/** Consume app drags even when their definition or target disappeared. */
export function handleCharacterReferenceDrop(view: EditorView, event: DragEvent, characters: Character[]): boolean {
  let id = '';
  try { id = event.dataTransfer?.getData(CHARACTER_REFERENCE_MIME) ?? ''; } catch { return false; }
  if (!id) return false;
  event.preventDefault(); event.stopPropagation();
  const character = characters.find(candidate => candidate.id === id && !candidate.archived);
  if (character && view.editable) insertReferenceAt(view, 'character', character, dropPosition(view, event));
  return true;
}
/** The optional target is accepted for older callers; emotion references are now free-standing. */
export function insertEmotionReference(editor: Editor, emotion: Preset, _target?: Pick<CharacterTarget, 'pos' | 'occurrenceId'>) {
  return insertInlineReference(editor, 'emotion', emotion);
}
export function insertToneReference(editor: Editor, tone: Preset) {
  return insertInlineReference(editor, 'tone', tone);
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
function CharacterChip({ node, selected, getPos }: NodeViewProps) {
  const { characters } = useContext(Definitions);
  const character = characters.find(c => c.id === node.attrs.characterId);
  const label = character?.name ?? node.attrs.label;
  return <NodeViewWrapper as="span" className={`character-chip story-block block-character ${selected ? 'block-selected' : ''}`} data-occurrence-id={node.attrs.occurrenceId} data-drag-handle data-story-reference data-reference-position={getPos()} draggable contentEditable={false} title="Character reference · drag to move, Ctrl-drag to copy"><CharacterIcon icon={character?.icon} size={13}/><span className="sr-only">Character: </span>{[label, node.attrs.emotion && `Emotion: ${node.attrs.emotion}`, node.attrs.delivery && `Delivery: ${node.attrs.delivery}`].filter(Boolean).join(' · ')}</NodeViewWrapper>;
}
function EmotionChip({ node, selected, getPos }: NodeViewProps) {
  const { emotions } = useContext(Definitions);
  const definition = emotions.find(p => p.id === node.attrs.emotionId);
  const color = effectiveColor('emotion', definition ?? { name: node.attrs.label });
  return <NodeViewWrapper as="span" className={`story-block block-emotion preset-colored ${selected ? 'block-selected' : ''}`} style={presetColorStyle(color)} data-drag-handle data-story-reference data-reference-position={getPos()} draggable contentEditable={false} title="Emotion · drag to move, Ctrl-drag to copy">Emotion: {definition?.name ?? node.attrs.label}</NodeViewWrapper>;
}
function ToneChip({ node, selected, getPos }: NodeViewProps) {
  const { tones } = useContext(Definitions);
  const definition = tones.find(p => p.id === node.attrs.toneId);
  const color = effectiveColor('tone', definition ?? { name: node.attrs.label });
  return <NodeViewWrapper as="span" className={`story-block block-tone preset-colored ${selected ? 'block-selected' : ''}`} style={presetColorStyle(color)} data-drag-handle data-story-reference data-reference-position={getPos()} draggable contentEditable={false} title="Tone · drag to move, Ctrl-drag to copy">Tone: {definition?.name ?? node.attrs.label}</NodeViewWrapper>;
}
export const CharacterReference = Node.create({
  name: 'characterReference', group: 'inline', inline: true, atom: true, selectable: true, draggable: true,
  addAttributes() { return { occurrenceId: { default: '' }, characterId: { default: '' }, label: { default: '' }, emotion: { default: '' }, delivery: { default: '' } }; },
  parseHTML() { return [{ tag: 'span[data-character-reference]' }]; },
  renderHTML({ node, HTMLAttributes }) { return ['span', mergeAttributes(HTMLAttributes, { 'data-character-reference': '', class: 'character-chip story-block block-character' }), [node.attrs.label, node.attrs.emotion && `Emotion: ${node.attrs.emotion}`, node.attrs.delivery && `Delivery: ${node.attrs.delivery}`].filter(Boolean).join(' · ')]; },
  renderText({ node }) { return node.attrs.label || 'Character'; }, addNodeView() { return ReactNodeViewRenderer(CharacterChip); },
});
export const EmotionReference = Node.create({
  name: 'emotionReference', group: 'inline', inline: true, atom: true, selectable: true, draggable: true,
  // Keep targetOccurrenceId readable for documents written by older versions.
  addAttributes() { return { emotionId: { default: '' }, label: { default: '' }, targetOccurrenceId: { default: '' } }; },
  parseHTML() { return [{ tag: 'span[data-emotion-reference]' }]; },
  renderHTML({ node, HTMLAttributes }) { return ['span', mergeAttributes(HTMLAttributes, { 'data-emotion-reference': '', class: 'story-block block-emotion' }), `Emotion: ${node.attrs.label}`]; },
  renderText({ node }) { return `[Emotion: ${node.attrs.label}]`; }, addNodeView() { return ReactNodeViewRenderer(EmotionChip); },
});
export const ToneReference = Node.create({
  name: 'toneReference', group: 'inline', inline: true, atom: true, selectable: true, draggable: true,
  addAttributes() { return { toneId: { default: '' }, label: { default: '' } }; },
  parseHTML() { return [{ tag: 'span[data-tone-reference]' }]; },
  renderHTML({ node, HTMLAttributes }) { return ['span', mergeAttributes(HTMLAttributes, { 'data-tone-reference': '', class: 'story-block block-tone' }), `Tone: ${node.attrs.label}`]; },
  renderText({ node }) { return `[Tone: ${node.attrs.label}]`; }, addNodeView() { return ReactNodeViewRenderer(ToneChip); },
});
const ReferenceIdentity = Extension.create({
  name: 'referenceIdentity',
  addProseMirrorPlugins() {
    return [new Plugin({
      props: {
        transformPasted(slice) {
          const ids = new Map<string, string>();
          slice.content.descendants(node => {
            if (node.type.name === 'characterReference' && node.attrs.occurrenceId) ids.set(node.attrs.occurrenceId, newOccurrenceId());
          });
          const transform = (fragment: Fragment): Fragment => {
            const nodes: PMNode[] = [];
            fragment.forEach(node => {
              const attrs = node.type.name === 'characterReference'
                ? { ...node.attrs, occurrenceId: node.attrs.occurrenceId ? ids.get(node.attrs.occurrenceId) ?? newOccurrenceId() : newOccurrenceId() }
                : node.type.name === 'emotionReference' && node.attrs.targetOccurrenceId && ids.has(node.attrs.targetOccurrenceId)
                  ? { ...node.attrs, targetOccurrenceId: ids.get(node.attrs.targetOccurrenceId) }
                  : node.attrs;
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
  ariaLabel?: string; placeholder?: string; scope?: BoardScope; wrapperClassName?: string;
}
export default function BeatEditor({ beat, index, characters, tones = [], emotions = [], onChange, onFocus, onSelection, register, editable = true, notify, ariaLabel, placeholder, scope = 'beat', wrapperClassName }: Props) {
  const callbacks = useRef({ onChange, onFocus, onSelection, notify, characters, tones, emotions, scope }); callbacks.current = { onChange, onFocus, onSelection, notify, characters, tones, emotions, scope };
  const handleBoardDrop = (view: EditorView, event: DragEvent) => {
    clearDropFeedback(view, dropSurfaceFor(view));
    if (handleInlineReferenceDrop(view, event, message => callbacks.current.notify?.(message))) return true;
    const handled = handleShelfReferenceDrop(view, event, callbacks.current.characters, callbacks.current.tones, callbacks.current.emotions, message => callbacks.current.notify?.(message));
    if (handled) inlineDrag = null;
    return handled;
  };
  const editor = useEditor({
    extensions: [StarterKit, CharacterReference, EmotionReference, ToneReference, ReferenceIdentity], content: beat.document, editable,
    editorProps: {
      attributes: { role: 'textbox', 'aria-label': ariaLabel ?? `Freeform text for beat ${index + 1}`, 'aria-multiline': 'true', 'data-placeholder': placeholder ?? 'Write anything that happens here…', spellcheck: 'true', 'data-board-scope': scope },
      handleDOMEvents: {
        dragstart(view, event) {
          const drag = event as DragEvent, target = (event.target as Element | null)?.closest?.('[data-story-reference]');
          if (!view.editable || !target || !drag.dataTransfer) return false;
          // A node can shift after typing before it without rerendering its
          // React view. Resolve its current DOM position instead of a stale attr.
          let position: number;
          try { position = view.posAtDOM(target, 0); }
          catch { position = Number(target.getAttribute('data-reference-position')); }
          const node = view.state.doc.nodeAt(position);
          if (!node || !['characterReference', 'emotionReference', 'toneReference'].includes(node.type.name)) return false;
          const token = newOccurrenceId();
          inlineDrag = { token, source: view, node, pos: position, document: view.state.doc };
          drag.dataTransfer.setData(INLINE_REFERENCE_MIME, token);
          drag.dataTransfer.setData('text/plain', node.textContent || node.attrs.label || 'Story block');
          drag.dataTransfer.effectAllowed = 'copyMove';
          // Keep a coordinator so a reference can move between separate editors.
          return true;
        },
        drop(view, event) { return handleBoardDrop(view, event as DragEvent); },
      },
      handleClickOn(view, pos, node) {
        if (!['characterReference', 'emotionReference', 'toneReference'].includes(node.type.name)) return false;
        view.dispatch(view.state.tr.setSelection(NodeSelection.create(view.state.doc, pos))); return true;
      },
    },
    onUpdate({ editor }) { callbacks.current.onChange(editor.getJSON(), editor.getText({ blockSeparator: '\n\n' })); },
    onFocus({ editor }) { callbacks.current.onFocus(editor); callbacks.current.onSelection(editor); }, onSelectionUpdate({ editor }) { callbacks.current.onSelection(editor); },
  });
  useEffect(() => {
    if (!editor) return;
    const view = editor.view, surface = dropSurfaceFor(view);
    const onDragOver = (raw: Event) => {
      const event = raw as DragEvent;
      if (!view.editable || !isReferenceDrag(event)) return;
      event.preventDefault();
      if (event.dataTransfer) event.dataTransfer.dropEffect = Array.from(event.dataTransfer.types ?? []).includes(INLINE_REFERENCE_MIME) && inlineDrag && !event.ctrlKey && !event.altKey ? 'move' : 'copy';
      view.dom.classList.add('board-drop-active');
      if (activeDropSurface && activeDropSurface !== surface) activeDropSurface.classList.remove('board-drop-active');
      surface.classList.add('board-drop-active'); activeDropSurface = surface;
    };
    const onDragLeave = (raw: Event) => {
      const event = raw as DragEvent;
      if (!(event.relatedTarget instanceof globalThis.Node) || !surface.contains(event.relatedTarget)) clearDropFeedback(view, surface);
    };
    const onDrop = (raw: Event) => { handleBoardDrop(view, raw as DragEvent); };
    const onDragEnd = () => {
      if (inlineDrag) inlineDrag = null;
      clearDropFeedback(view, surface);
    };
    surface.addEventListener('dragover', onDragOver);
    surface.addEventListener('dragleave', onDragLeave);
    surface.addEventListener('drop', onDrop);
    document.addEventListener('dragend', onDragEnd);
    return () => {
      surface.removeEventListener('dragover', onDragOver);
      surface.removeEventListener('dragleave', onDragLeave);
      surface.removeEventListener('drop', onDrop);
      document.removeEventListener('dragend', onDragEnd);
      clearDropFeedback(view, surface);
    };
  }, [editor]);
  useEffect(() => { if (editor) register(beat.id, editor); return () => register(beat.id, null); }, [editor, beat.id, register]);
  useEffect(() => { if (!editor) return; const incoming = editor.schema.nodeFromJSON(beat.document); if (!editor.state.doc.eq(incoming)) editor.commands.setContent(beat.document, { emitUpdate: false }); }, [beat.document, editor]);
  useEffect(() => { editor?.setEditable(editable, false); }, [editable, editor]);
  return <Definitions.Provider value={{ characters, tones, emotions }}><EditorContent editor={editor} className={['beat-prose', wrapperClassName].filter(Boolean).join(' ')} /></Definitions.Provider>;
}
