import { createContext, useContext, useEffect, useRef } from 'react';
import type { KeyboardEvent as ReactKeyboardEvent } from 'react';
import { Extension, Node, mergeAttributes } from '@tiptap/core';
import type { Editor } from '@tiptap/core';
import { useEditor, EditorContent, NodeViewWrapper, ReactNodeViewRenderer } from '@tiptap/react';
import type { NodeViewProps } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import { NodeSelection, Plugin, PluginKey, TextSelection } from '@tiptap/pm/state';
import { closeHistory } from '@tiptap/pm/history';
import { Fragment, Slice } from '@tiptap/pm/model';
import type { Node as PMNode } from '@tiptap/pm/model';
import type { EditorView } from '@tiptap/pm/view';
import type { Beat, Character, Preset } from '../services/project';
import { relationshipChangeText, type RelationshipChange } from '../services/relationships';
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
/** Select and scroll to a relationship atom without moving keyboard focus away from its caller. */
export function focusRelationshipChange(editor: Editor, changeId: string) {
  if (editor.isDestroyed) return false;
  let position: number | undefined;
  editor.state.doc.descendants((node, pos) => {
    if (position === undefined && node.type.name === 'relationshipChange' && node.attrs.changeId === changeId) position = pos;
  });
  if (position === undefined) return false;
  editor.view.dispatch(editor.state.tr.setSelection(NodeSelection.create(editor.state.doc, position)).scrollIntoView());
  return true;
}

interface ReferenceDefinitions {
  characters: Character[];
  tones: Preset[];
  emotions: Preset[];
  relationshipChanges: RelationshipChange[];
  sceneId?: string;
  onSelectRelationshipChange?: (changeId: string) => void;
}
const Definitions = createContext<ReferenceDefinitions>({ characters: [], tones: [], emotions: [], relationshipChanges: [] });
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

function relationshipChangeLabel(change: RelationshipChange, characters: Character[]) {
  return relationshipChangeText({ characters }, change);
}

function relationshipChangeFor(context: Pick<ReferenceDefinitions, 'relationshipChanges' | 'sceneId'>, changeId: string) {
  if (!context.sceneId) return undefined;
  return context.relationshipChanges.find(change => change.id === changeId && change.sceneId === context.sceneId);
}

function RelationshipChangeChip({ node, selected, editor }: NodeViewProps) {
  const { characters, relationshipChanges, sceneId, onSelectRelationshipChange } = useContext(Definitions);
  const change = relationshipChangeFor({ relationshipChanges, sceneId }, node.attrs.changeId);
  const label = change ? relationshipChangeLabel(change, characters) : '[Unavailable relationship change]';
  const activate = () => {
    if (!change) return;
    focusRelationshipChange(editor, node.attrs.changeId);
    onSelectRelationshipChange?.(node.attrs.changeId);
  };
  return <NodeViewWrapper
    as="span"
    className={`story-block block-relationship-change ${change?.status === 'planned' ? 'relationship-planned' : ''} ${selected ? 'block-selected' : ''} ${change ? '' : 'relationship-unavailable'}`}
    data-relationship-change=""
    data-relationship-change-id={node.attrs.changeId}
    role="button"
    tabIndex={change ? 0 : -1}
    aria-label={label.slice(1, -1)}
    aria-disabled={!change}
    aria-pressed={selected}
    contentEditable={false}
    title={change ? `${label.slice(1, -1)} · Select to edit this change` : label.slice(1, -1)}
    onClick={activate}
    onKeyDown={(event: ReactKeyboardEvent<HTMLSpanElement>) => {
      if (!change || (event.key !== 'Enter' && event.key !== ' ')) return;
      event.preventDefault();
      event.stopPropagation();
      activate();
    }}
  >
    {change ? <>
      <span className="relationship-change-route">{characters.find(character => character.id === change.sourceId)?.name ?? 'Unknown character'} {change.mutual ? '↔' : '→'} {characters.find(character => character.id === change.targetId)?.name ?? 'Unknown character'}</span>
      <span className="relationship-change-phase">{change.phase === 'before' ? 'At scene entry' : 'By scene end'}</span>
      <span className="relationship-change-kind">{change.kind}</span>
      <span className="relationship-change-description">{change.description.trim() || 'End relationship'}</span>
      <span className={`relationship-change-status relationship-status-${change.status}`}>{change.status === 'planned' ? 'Planned' : 'Established'}</span>
    </> : <span>Unavailable relationship change</span>}
  </NodeViewWrapper>;
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
export const RelationshipChangeReference = Node.create({
  name: 'relationshipChange', group: 'inline', inline: true, atom: true, selectable: true, draggable: false,
  addAttributes() { return { changeId: { default: '' } }; },
  parseHTML() { return [{ tag: 'span[data-relationship-change]' }]; },
  renderHTML({ node, HTMLAttributes }) {
    return ['span', mergeAttributes(HTMLAttributes, { 'data-relationship-change': '', 'data-relationship-change-id': node.attrs.changeId, class: 'story-block block-relationship-change' }), `[Relationship change: ${node.attrs.changeId || 'Unavailable'}]`];
  },
  renderText() { return '[Relationship change]'; },
  addNodeView() { return ReactNodeViewRenderer(RelationshipChangeChip); },
});

interface RelationshipPolicyContext {
  scope: BoardScope;
  sceneId?: string;
  relationshipChanges: RelationshipChange[];
  notify?: (message: string) => void;
}

function allowedRelationshipChange(context: RelationshipPolicyContext, changeId: string) {
  return context.scope === 'summary' && !!relationshipChangeFor(context, changeId);
}

function filterRelationshipReferences(fragment: Fragment, context: RelationshipPolicyContext, existingIds = new Set<string>()) {
  let removed = false, unavailable = false, duplicate = false;
  const seen = new Set(existingIds);
  const transform = (part: Fragment): Fragment => {
    const nodes: PMNode[] = [];
    part.forEach(node => {
      if (node.type.name === 'relationshipChange') {
        if (!allowedRelationshipChange(context, node.attrs.changeId)) {
          removed = true; unavailable = true; return;
        }
        if (seen.has(node.attrs.changeId)) {
          removed = true; duplicate = true; return;
        }
        seen.add(node.attrs.changeId);
      }
      const content = node.content.size ? transform(node.content) : node.content;
      nodes.push(node.isText ? node : node.type.create(node.attrs, content, node.marks));
    });
    return Fragment.fromArray(nodes);
  };
  return { content: transform(fragment), removed, unavailable, duplicate };
}

const relationshipPolicyKey = new PluginKey('relationshipReferencePolicy');

const ReferenceIdentity = Extension.create<{ getContext: () => RelationshipPolicyContext }>({
  name: 'referenceIdentity',
  addOptions() { return { getContext: () => ({ scope: 'beat' as BoardScope, relationshipChanges: [] }) }; },
  addProseMirrorPlugins() {
    const getContext = this.options.getContext;
    return [new Plugin({
      props: {
        transformPasted(slice, view) {
          const context = getContext();
          const existingIds = new Set<string>();
          const selection = view.state.selection;
          view.state.doc.descendants((node, pos) => {
            if (node.type.name === 'relationshipChange' && !(pos >= selection.from && pos < selection.to)) existingIds.add(node.attrs.changeId);
          });
          const filtered = filterRelationshipReferences(slice.content, context, existingIds);
          if (filtered.unavailable) context.notify?.('Relationship changes can only be pasted into their original scene summary.');
          else if (filtered.duplicate) context.notify?.('A relationship change can appear only once in its scene summary.');
          const content = filtered.content;
          const ids = new Map<string, string>();
          content.descendants(node => {
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
          }; return new Slice(transform(content), slice.openStart, slice.openEnd);
        },
      },
    })];
  },
});

const RelationshipReferencePolicy = Extension.create<{ getContext: () => RelationshipPolicyContext }>({
  name: 'relationshipReferencePolicy',
  addOptions() { return { getContext: () => ({ scope: 'beat' as BoardScope, relationshipChanges: [] }) }; },
  addProseMirrorPlugins() {
    const getContext = this.options.getContext;
    return [new Plugin({
      key: relationshipPolicyKey,
      appendTransaction(transactions, _oldState, newState) {
        if (!transactions.some(transaction => transaction.docChanged || transaction.getMeta(relationshipPolicyKey))) return null;
        const preventUpdate = transactions.some(transaction => transaction.getMeta('preventUpdate') || transaction.getMeta(relationshipPolicyKey));
        const context = getContext();
        const invalidPositions: number[] = [];
        const seen = new Set<string>();
        newState.doc.descendants((node, pos) => {
          if (node.type.name === 'relationshipChange') {
            if (!allowedRelationshipChange(context, node.attrs.changeId) || seen.has(node.attrs.changeId)) invalidPositions.push(pos);
            else seen.add(node.attrs.changeId);
          }
        });
        if (!invalidPositions.length) return null;
        const tr = newState.tr;
        for (const pos of invalidPositions.reverse()) tr.delete(pos, pos + 1);
        tr.setMeta('addToHistory', false);
        if (preventUpdate) tr.setMeta('preventUpdate', true);
        return tr;
      },
    })];
  },
});

interface Props {
  beat: Beat; index: number; characters: Character[]; tones?: Preset[]; emotions?: Preset[];
  relationshipChanges?: RelationshipChange[]; sceneId?: string; onSelectRelationshipChange?: (changeId: string) => void;
  onChange: (document: Beat['document'], text: string) => void; onFocus: (editor: Editor) => void; onSelection: (editor: Editor) => void;
  register: (id: string, editor: Editor | null) => void; editable?: boolean; notify?: (message: string) => void;
  ariaLabel?: string; placeholder?: string; scope?: BoardScope; wrapperClassName?: string;
}
export default function BeatEditor({ beat, index, characters, tones = [], emotions = [], relationshipChanges = [], sceneId, onSelectRelationshipChange, onChange, onFocus, onSelection, register, editable = true, notify, ariaLabel, placeholder, scope = 'beat', wrapperClassName }: Props) {
  const callbacks = useRef({ onChange, onFocus, onSelection, notify, characters, tones, emotions, relationshipChanges, sceneId, onSelectRelationshipChange, scope }); callbacks.current = { onChange, onFocus, onSelection, notify, characters, tones, emotions, relationshipChanges, sceneId, onSelectRelationshipChange, scope };
  const handleBoardDrop = (view: EditorView, event: DragEvent) => {
    clearDropFeedback(view, dropSurfaceFor(view));
    if (handleInlineReferenceDrop(view, event, message => callbacks.current.notify?.(message))) return true;
    const handled = handleShelfReferenceDrop(view, event, callbacks.current.characters, callbacks.current.tones, callbacks.current.emotions, message => callbacks.current.notify?.(message));
    if (handled) inlineDrag = null;
    return handled;
  };
  const editor = useEditor({
    extensions: [StarterKit, CharacterReference, EmotionReference, ToneReference, RelationshipChangeReference, ReferenceIdentity.configure({ getContext: () => callbacks.current }), RelationshipReferencePolicy.configure({ getContext: () => callbacks.current })], content: beat.document, editable,
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
        if (node.type.name === 'relationshipChange') {
          const context = callbacks.current;
          if (!allowedRelationshipChange(context, node.attrs.changeId)) {
            context.notify?.('This relationship change is unavailable in this scene summary.');
            return true;
          }
          view.dispatch(view.state.tr.setSelection(NodeSelection.create(view.state.doc, pos)));
          context.onSelectRelationshipChange?.(node.attrs.changeId);
          return true;
        }
        if (!['characterReference', 'emotionReference', 'toneReference'].includes(node.type.name)) return false;
        view.dispatch(view.state.tr.setSelection(NodeSelection.create(view.state.doc, pos))); return true;
      },
    },
    onUpdate({ editor }) {
      callbacks.current.onChange(editor.getJSON(), editor.getText({
        blockSeparator: '\n\n',
        textSerializers: {
          relationshipChange: node => {
            const context = callbacks.current;
            const change = relationshipChangeFor(context, node.node.attrs.changeId);
            return change ? relationshipChangeLabel(change, context.characters) : '[Unavailable relationship change]';
          },
        },
      }));
    },
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
  const relationshipReferenceSignature = JSON.stringify([scope, sceneId, relationshipChanges.map(change => [change.id, change.sceneId]).sort(([leftId, leftScene], [rightId, rightScene]) => `${leftId}:${leftScene}`.localeCompare(`${rightId}:${rightScene}`))]);
  useEffect(() => {
    if (editor) editor.view.dispatch(editor.state.tr.setMeta(relationshipPolicyKey, true));
  }, [editor, relationshipReferenceSignature]);
  useEffect(() => { editor?.setEditable(editable, false); }, [editable, editor]);
  return <Definitions.Provider value={{ characters, tones, emotions, relationshipChanges, sceneId, onSelectRelationshipChange }}><EditorContent editor={editor} className={['beat-prose', wrapperClassName].filter(Boolean).join(' ')} /></Definitions.Provider>;
}
