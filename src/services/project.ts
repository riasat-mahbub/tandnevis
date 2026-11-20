import { invoke, isTauri } from '@tauri-apps/api/core';
import { open, save } from '@tauri-apps/plugin-dialog';
import type { JSONContent } from '@tiptap/core';

export interface Narration { pointOfView: string; tense: string; instructions: string }
export interface Beat { id: string; document: JSONContent; text: string }
export interface Scene { id: string; chapterId: string; title: string; summary: string; tone: string; prose: string; narration: Narration; beats: Beat[] }
export interface Chapter { id: string; title: string; sceneIds: string[] }
export interface Character { id: string; name: string; background: string; voice: string; personality: string; archived: boolean }
export interface TrashEntry { id: string; kind: string; title: string; deletedAtRevision: number; payload: unknown }
export interface ImportedSource { id: string; markdown: string; importedAtRevision: number }
export interface ProjectSnapshot { projectId: string; title: string; revision: number; chapters: Chapter[]; scenes: Scene[]; characters: Character[]; trash: TrashEntry[]; importSources: ImportedSource[]; canUndo: boolean; canRedo: boolean }
export interface ProjectSession { sessionId: string; project: ProjectSnapshot }
export type Operation =
  | { type: 'renameProject'; title: string }
  | { type: 'createChapter'; title: string }
  | { type: 'renameChapter'; chapterId: string; title: string }
  | { type: 'reorderChapters'; ids: string[] }
  | { type: 'deleteChapter'; chapterId: string }
  | { type: 'createScene'; chapterId: string; title: string }
  | ({ type: 'updateScene'; sceneId: string } & Partial<Pick<Scene, 'title' | 'summary' | 'tone' | 'prose' | 'narration'>>)
  | { type: 'duplicateScene' | 'deleteScene'; sceneId: string }
  | { type: 'reorderScenes'; chapterId: string; ids: string[] }
  | { type: 'createBeat'; sceneId: string; document: JSONContent; text: string }
  | { type: 'updateBeat'; beatId: string; document: JSONContent; text: string }
  | { type: 'duplicateBeat' | 'deleteBeat'; beatId: string }
  | { type: 'reorderBeats'; sceneId: string; ids: string[] }
  | { type: 'restoreTrash'; trashId: string }
  | { type: 'createCharacter'; name: string }
  | ({ type: 'updateCharacter'; characterId: string } & Partial<Omit<Character, 'id'>>)
  | { type: 'undo' | 'redo' };

export interface ProjectGateway {
  desktop: boolean;
  chooseCreate(): Promise<string | null>;
  chooseOpen(): Promise<string | null>;
  create(path: string, title: string): Promise<ProjectSession>;
  open(path: string): Promise<ProjectSession>;
  read(sessionId: string): Promise<ProjectSnapshot>;
  save(sessionId: string): Promise<ProjectSnapshot>;
  hasUnsavedChanges(sessionId: string): Promise<boolean>;
  apply(sessionId: string, expectedRevision: number, operation: Operation): Promise<ProjectSnapshot>;
  importMarkdown(sessionId: string, expectedRevision: number, markdown: string): Promise<ProjectSnapshot>;
  exportMarkdown(sessionId: string): Promise<string>;
  chooseMarkdown(mode: 'import' | 'export'): Promise<string | null>;
  importMarkdownFile(sessionId: string, expectedRevision: number, path: string): Promise<ProjectSnapshot>;
  exportMarkdownFile(sessionId: string, path: string): Promise<void>;
}
const projectFilter = [{ name: 'Shorthand project', extensions: ['shorthand'] }];
export const desktopGateway: ProjectGateway = {
  desktop: isTauri(),
  chooseCreate: () => save({ title: 'Create Shorthand project', defaultPath: 'Untitled story.shorthand', filters: projectFilter }),
  async chooseOpen() { const path = await open({ title: 'Open Shorthand project', multiple: false, filters: projectFilter }); return typeof path === 'string' ? path : null; },
  create: (path, title) => invoke('create_project', { path, title }),
  open: path => invoke('open_project', { path }),
  read: sessionId => invoke('read_project', { sessionId }),
  save: sessionId => invoke('save_project', { sessionId }),
  hasUnsavedChanges: sessionId => invoke('project_has_unsaved_changes', { sessionId }),
  apply: (sessionId, expectedRevision, operation) => invoke('apply_operation', { sessionId, expectedRevision, operation }),
  importMarkdown: (sessionId, expectedRevision, markdown) => invoke('import_markdown', { sessionId, expectedRevision, markdown }),
  exportMarkdown: sessionId => invoke('export_markdown', { sessionId }),
  async chooseMarkdown(mode) {
    const filters = [{ name: 'Markdown', extensions: ['md', 'markdown'] }];
    if (mode === 'export') return save({ title: 'Export Markdown', defaultPath: 'Story.md', filters });
    const path = await open({ title: 'Import Markdown', multiple: false, filters });
    return typeof path === 'string' ? path : null;
  },
  importMarkdownFile: (sessionId, expectedRevision, path) => invoke('import_markdown_file', { sessionId, expectedRevision, path }),
  exportMarkdownFile: (sessionId, path) => invoke('export_markdown_file', { sessionId, path }),
};
export const emptyDocument: JSONContent = { type: 'doc', content: [{ type: 'paragraph' }] };
