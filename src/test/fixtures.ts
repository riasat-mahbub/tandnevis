import { vi } from 'vitest';
import type { ProjectGateway, ProjectSnapshot, ProjectSession } from '../services/project';

export function project(): ProjectSnapshot {
  return {
    projectId: 'project-1', title: 'A quiet story', revision: 0,
    chapters: [{ id: 'chapter-1', title: 'The beginning', sceneIds: ['scene-1', 'scene-2'] }],
    scenes: [
      { id: 'scene-1', chapterId: 'chapter-1', title: 'Arrival', summary: 'Someone comes home.', tone: '', prose: '', narration: { pointOfView: '', tense: '', instructions: '' }, beats: [{ id: 'beat-1', document: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'The door opens.' }] }] }, text: 'The door opens.' }] },
      { id: 'scene-2', chapterId: 'chapter-1', title: 'The letter', summary: 'A secret is revealed.', tone: '', prose: '', narration: { pointOfView: '', tense: '', instructions: '' }, beats: [] },
    ],
    characters: [{ id: 'character-1', name: 'Maya', background: '', personality: '', voice: '', archived: false }], trash: [], importSources: [], canUndo: false, canRedo: false,
  };
}
export function session(p = project()): ProjectSession { return { sessionId: 'session-1', project: p }; }
export function gateway(p = project()): ProjectGateway {
  return { desktop: false,
    chooseCreate: vi.fn(async () => '/story.shorthand'), chooseOpen: vi.fn(async () => '/story.shorthand'),
    create: vi.fn(async () => session(p)), open: vi.fn(async () => session(p)), read: vi.fn(async () => p),
    save: vi.fn(async () => p), hasUnsavedChanges: vi.fn(async () => false),
    apply: vi.fn(async () => { throw new Error('Unexpected test write'); }),
    importMarkdown: vi.fn(async () => { throw new Error('Unexpected import'); }), exportMarkdown: vi.fn(async () => '# Story'),
    chooseMarkdown: vi.fn(async () => '/story.md'), importMarkdownFile: vi.fn(async () => p), exportMarkdownFile: vi.fn(async () => {}),
  };
}
export function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
