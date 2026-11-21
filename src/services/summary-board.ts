import type { JSONContent } from '@tiptap/core';
import type { Beat, Preset, Scene } from './project';

export const summaryBoardId = (sceneId: string) => `${sceneId}:summary`;

/** Old plain summaries and scene tones remain editable on the same board. */
export function summaryBoard(scene: Scene, tones: Preset[] = []): Beat {
  const document: JSONContent = scene.summaryDocument ? structuredClone(scene.summaryDocument) : {
    type: 'doc',
    content: scene.summary.split('\n').map(text => ({ type: 'paragraph', ...(text ? { content: [{ type: 'text', text }] } : {}) })),
  };
  let hasTone = false;
  const findTone = (node: JSONContent) => { if (node.type === 'toneReference') hasTone = true; node.content?.forEach(findTone); };
  findTone(document);
  const legacyTone = tones.find(tone => tone.id === scene.toneId);
  if (!hasTone && legacyTone) {
    if (!document.content) document.content = [];
    if (document.content[0]?.type !== 'paragraph') document.content.unshift({ type: 'paragraph' });
    const paragraph = document.content![0];
    paragraph.content = [{ type: 'toneReference', attrs: { toneId: legacyTone.id, label: legacyTone.name } }, ...(paragraph.content ?? [])];
  }
  if (!scene.summaryDocument && !scene.toneId && scene.tone.trim()) {
    document.content!.push({ type: 'paragraph', content: [{ type: 'text', text: `Scene tone: ${scene.tone}` }] });
  }
  return { id: summaryBoardId(scene.id), document, text: scene.summary };
}
