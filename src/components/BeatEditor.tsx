import { createContext, useContext, useEffect, useRef } from 'react';
import { Node, mergeAttributes } from '@tiptap/core';
import type { Editor } from '@tiptap/core';
import { useEditor, EditorContent, NodeViewWrapper, ReactNodeViewRenderer } from '@tiptap/react';
import type { NodeViewProps } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import { NodeSelection } from '@tiptap/pm/state';
import type { Beat, Character } from '../services/project';

export function updateCharacterReference(editor: Editor, attributes: { emotion?: string; delivery?: string }) {
  const selection = editor.state.selection;
  if (!(selection instanceof NodeSelection) || selection.node.type.name !== 'characterReference') return false;
  return editor.chain().command(({ tr }) => {
    tr.setNodeMarkup(selection.from, undefined, { ...selection.node.attrs, ...attributes });
    // Replacing an atom's markup otherwise maps its NodeSelection to text.
    // Retain the explicit local target while the inspector input keeps focus.
    tr.setSelection(NodeSelection.create(tr.doc, selection.from));
    return true;
  }).run();
}

const CharacterNames = createContext<Character[]>([]);
function CharacterChip({ node }: NodeViewProps) {
  const characters = useContext(CharacterNames);
  const label = characters.find(c => c.id === node.attrs.characterId)?.name ?? node.attrs.label;
  return <NodeViewWrapper as="span" className="character-chip" contentEditable={false} title="Select this character reference to edit local direction">{[label, node.attrs.emotion && `Emotion: ${node.attrs.emotion}`, node.attrs.delivery && `Delivery: ${node.attrs.delivery}`].filter(Boolean).join(' · ')}</NodeViewWrapper>;
}
export const CharacterReference = Node.create({
  name: 'characterReference', group: 'inline', inline: true, atom: true, selectable: true,
  addAttributes() { return { characterId: { default: '' }, label: { default: '' }, emotion: { default: '' }, delivery: { default: '' } }; },
  parseHTML() { return [{ tag: 'span[data-character-reference]' }]; },
  renderHTML({ node, HTMLAttributes }) {
    const { label, emotion, delivery } = node.attrs;
    return ['span', mergeAttributes(HTMLAttributes, { 'data-character-reference': '', class: 'character-chip', title: 'Select character reference to edit local direction' }), [label, emotion && `Emotion: ${emotion}`, delivery && `Delivery: ${delivery}`].filter(Boolean).join(' · ')];
  },
  renderText({ node }) { return node.attrs.label || 'Character'; },
  addNodeView() { return ReactNodeViewRenderer(CharacterChip); },
});

interface Props {
  beat: Beat; index: number; characters: Character[];
  onChange: (document: Beat['document'], text: string) => void;
  onFocus: (editor: Editor) => void;
  onSelection: (editor: Editor) => void;
  register: (id: string, editor: Editor | null) => void;
  editable?: boolean;
}
export default function BeatEditor({ beat, index, characters, onChange, onFocus, onSelection, register, editable = true }: Props) {
  const callbacks = useRef({ onChange, onFocus, onSelection });
  callbacks.current = { onChange, onFocus, onSelection };
  const editor = useEditor({
    extensions: [StarterKit, CharacterReference],
    content: beat.document,
    editable,
    editorProps: {
      attributes: { role: 'textbox', 'aria-label': `Freeform text for beat ${index + 1}`, 'aria-multiline': 'true', 'data-placeholder': 'Write anything that happens here…', spellcheck: 'true' },
      handleClickOn(view, pos, node) {
        if (node.type.name !== 'characterReference') return false;
        view.dispatch(view.state.tr.setSelection(NodeSelection.create(view.state.doc, pos)));
        return true;
      },
    },
    onUpdate({ editor }) { callbacks.current.onChange(editor.getJSON(), editor.getText({ blockSeparator: '\n\n' })); },
    onFocus({ editor }) { callbacks.current.onFocus(editor); callbacks.current.onSelection(editor); },
    onSelectionUpdate({ editor }) { callbacks.current.onSelection(editor); },
  });
  useEffect(() => { if (editor) register(beat.id, editor); return () => register(beat.id, null); }, [editor, beat.id, register]);
  useEffect(() => {
    if (!editor) return;
    // Rust's JSON object key order differs from Tiptap's. Compare document
    // structure so a save acknowledgement never replaces equivalent content
    // and resets the writer's caret or selected character reference.
    const incoming = editor.schema.nodeFromJSON(beat.document);
    if (!editor.state.doc.eq(incoming)) editor.commands.setContent(beat.document, { emitUpdate: false });
  }, [beat.document, editor]);
  useEffect(() => {
    editor?.setEditable(editable, false);
  }, [editable, editor]);
  return <CharacterNames.Provider value={characters}><EditorContent editor={editor} className="beat-prose" /></CharacterNames.Provider>;
}
