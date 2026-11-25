import React from 'react';
import ReactDOM from 'react-dom/client';
import App from '../../src/App';
import type { Beat, ProjectGateway, ProjectSession, ProjectSnapshot } from '../../src/services/project';
import { relationshipKey } from '../../src/services/relationships';
import { summaryBoard } from '../../src/services/summary-board';
import { projectEdits } from '../../src/services/workspace';

const beat = (id: string, text: string): Beat => ({
  id, text, document: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] },
});

const story: ProjectSnapshot = {
  projectId: 'readme-demo', title: 'The Academy of Small Wonders', revision: 1,
  chapters: [
    { id: 'gates', title: 'At the gates', sceneIds: ['first-encounter', 'question'] },
    { id: 'academy', title: 'Inside the academy', sceneIds: ['borrowed-names'] },
  ],
  scenes: [
    {
      id: 'first-encounter', chapterId: 'gates', title: 'The first encounter',
      summary: 'As the procession reaches the academy gates, two strangers recognize something familiar in each other. Neither is ready to say what.',
      tone: '', toneId: '',
      prose: 'By the time Murad reached the gates, the bells had stopped. The boy in the shade was still watching him.\n\n“Have you been here before?” the boy asked.\n\nMurad looked up at the unusual hinge on the gate. “I think my mother used to draw this place.”',
      narration: { pointOfView: '', tense: '', instructions: '' },
      beats: [
        beat('beat-1', 'Rudra asks whether Murad has been here before. The question sounds casual, but he watches carefully for the answer.'),
        beat('beat-2', 'The procession slows at the gates. Murad notices a stranger watching from the shade and decides to approach.'),
        beat('beat-3', 'A bell interrupts them. They follow the others inside, each privately resolving to learn more about the other.'),
      ],
    },
    {
      id: 'question', chapterId: 'gates', title: 'A question left unanswered', summary: 'The caretaker recognizes Murad’s family name and changes the subject.',
      tone: '', toneId: '', prose: '', narration: { pointOfView: '', tense: '', instructions: '' }, beats: [],
    },
    {
      id: 'borrowed-names', chapterId: 'academy', title: 'The room of borrowed names', summary: 'A quiet room hides a list of names that should not exist.',
      tone: '', toneId: '', prose: 'The list was pinned to the door with a bent brass nail. Two places from the bottom, in handwriting Murad knew by heart, was his own name.', narration: { pointOfView: '', tense: '', instructions: '' }, beats: [],
    },
  ],
  characters: [
    { id: 'murad', name: 'Murad', background: 'A new arrival at the academy.', personality: 'Careful with first impressions.', voice: 'Direct and observant.', archived: false, defaultToneId: '', defaultEmotionId: '' },
    { id: 'rudra', name: 'Rudra', background: 'A student who knows the old gates.', personality: 'Curious, but guarded.', voice: 'Lightly teasing.', archived: false, defaultToneId: '', defaultEmotionId: '' },
  ],
  tones: [{ id: 'playful', name: 'Playful', meaning: 'A light touch', guidance: 'Use quick wit and warmth.', example: '', archived: false, revision: 1 }],
  emotions: [{ id: 'awe', name: 'Awe', meaning: 'Wonder at the unfamiliar', guidance: 'Notice details that interrupt expectation.', example: '', archived: false, revision: 1 }],
  starterTypes: [], trash: [], importSources: [], canUndo: false, canRedo: false,
};

let current = structuredClone(story);
let savedRevision = current.revision;
const unsupported = async (): Promise<never> => { throw new Error('This operation is unavailable in the README demo.'); };
// Implement the demo's writes in memory. Each browser context loads a fresh story.
const gateway: ProjectGateway = {
  desktop: false,
  create: unsupported, open: unsupported, chooseCreate: unsupported, chooseOpen: unsupported,
  importMarkdown: unsupported, exportMarkdown: unsupported, chooseMarkdown: unsupported,
  importMarkdownFile: unsupported, exportMarkdownFile: unsupported,
  async read() { return structuredClone(current); },
  async save() {
    savedRevision = current.revision;
    return structuredClone(current);
  },
  async hasUnsavedChanges() { return current.revision !== savedRevision; },
  async apply(_sessionId, expectedRevision, operation) {
    if (expectedRevision !== current.revision) throw new Error('README demo revision changed.');
    const next = projectEdits(current, [operation]);
    switch (operation.type) {
      case 'reorderBeats':
      case 'updateScene':
        break;
      case 'createCharacter': {
        const { type: _, ...profile } = operation;
        next.characters.push({
          id: `demo-character-${next.revision}`, background: '', personality: '', voice: '',
          archived: false, defaultToneId: '', defaultEmotionId: '', ...profile,
        });
        break;
      }
      case 'setRelationship': {
        const { change } = operation;
        const changes = next.relationshipChanges ??= [];
        const existing = changes.find(entry => entry.sceneId === change.sceneId && entry.phase === change.phase && relationshipKey(entry) === relationshipKey(change));
        const id = existing?.id ?? `demo-relationship-${next.revision}`;
        if (existing) Object.assign(existing, change);
        else {
          changes.push({ ...change, id });
          const scene = next.scenes.find(item => item.id === change.sceneId);
          if (scene) {
            const { document } = summaryBoard(scene, next.tones);
            document.content?.push({ type: 'paragraph', content: [{ type: 'relationshipChange', attrs: { changeId: id } }] });
            scene.summaryDocument = document;
          }
        }
        break;
      }
      default:
        return unsupported();
    }
    next.revision += 1;
    current = next;
    return structuredClone(current);
  },
};
const session: ProjectSession = { sessionId: 'readme-demo-session', project: structuredClone(story) };

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App gateway={gateway} initialSession={session} />
  </React.StrictMode>,
);
