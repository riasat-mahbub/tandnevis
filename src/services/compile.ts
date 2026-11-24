import type { ProjectSnapshot } from './project';

export type CompileFormat = 'md' | 'txt' | 'html';
export type CompileScope = 'story' | 'chapter' | 'scene';

export type CompileOptions = {
  scope: CompileScope;
  chapterId: string;
  sceneId: string;
  format: CompileFormat;
  titlePage: boolean;
  contents: boolean;
  sceneTitles: boolean;
  separator: 'ornament' | 'space' | 'none';
  empty: 'skip' | 'placeholder' | 'require';
};

export type CompiledScene = { id: string; title: string; prose: string; unfinished: boolean };
export type CompiledChapter = { id: string; title: string; number: number; scenes: CompiledScene[] };
export type Manuscript = {
  title: string;
  scope: CompileScope;
  chapters: CompiledChapter[];
  options: CompileOptions;
  stats: { selected: number; included: number; missing: number; words: number };
  error: string | null;
  canExport: boolean;
};

type CompileContext = { scope?: CompileScope; chapterId?: string; sceneId?: string };

function isCompileScope(value: unknown): value is CompileScope {
  return value === 'story' || value === 'chapter' || value === 'scene';
}

function chapterScenes(project: ProjectSnapshot, chapterId: string) {
  const chapter = project.chapters.find(item => item.id === chapterId);
  if (!chapter) return [];

  const scenesById = new Map(project.scenes.map(scene => [scene.id, scene]));
  return chapter.sceneIds.flatMap(id => {
    const scene = scenesById.get(id);
    return scene && scene.chapterId === chapter.id ? [scene] : [];
  });
}

function firstValidChapter(project: ProjectSnapshot) {
  return project.chapters.find(chapter => chapter.sceneIds.some(id => {
    const scene = project.scenes.find(item => item.id === id);
    return scene?.chapterId === chapter.id;
  })) ?? project.chapters[0];
}

/**
 * Creates a fresh set of dialog options for the current writing canvas.
 * Invalid canvas context falls back to the whole story so opening the dialog
 * never starts with a stale chapter or scene selection.
 */
export function defaultCompileOptions(project: ProjectSnapshot, context?: CompileContext): CompileOptions {
  const preferredScene = context?.sceneId
    ? project.scenes.find(scene => scene.id === context.sceneId)
    : undefined;
  const preferredChapterId = context?.chapterId ?? preferredScene?.chapterId;
  const preferredChapter = preferredChapterId
    ? project.chapters.find(chapter => chapter.id === preferredChapterId)
    : undefined;
  const fallbackChapter = firstValidChapter(project);
  const chapter = preferredChapter ?? fallbackChapter;
  const chapterId = chapter?.id ?? '';
  const chapterSceneIds = chapter?.sceneIds ?? [];
  const preferredChapterScene = preferredScene
    && preferredScene.chapterId === chapterId
    && chapterSceneIds.includes(preferredScene.id)
    ? preferredScene
    : undefined;
  const firstScene = chapterScenes(project, chapterId)[0];
  const sceneId = preferredChapterScene?.id ?? firstScene?.id ?? '';

  let scope: CompileScope = 'story';
  if (context?.scope === 'chapter' && preferredChapter) scope = 'chapter';
  if (context?.scope === 'scene' && preferredChapterScene) scope = 'scene';
  if (context?.scope === 'story') scope = 'story';

  return {
    scope,
    chapterId,
    sceneId,
    format: 'md',
    titlePage: false,
    contents: false,
    sceneTitles: false,
    separator: 'ornament',
    empty: 'skip',
  };
}

function countWords(text: string): number {
  const trimmed = text.trim();
  return trimmed ? trimmed.split(/\s+/u).length : 0;
}

function emptyManuscript(project: ProjectSnapshot, options: CompileOptions, error: string): Manuscript {
  return {
    title: project.title,
    scope: isCompileScope(options.scope) ? options.scope : 'story',
    chapters: [],
    options,
    stats: { selected: 0, included: 0, missing: 0, words: 0 },
    error,
    canExport: false,
  };
}

/** Assemble only selected scene prose into a stable, ordered manuscript model. */
export function compileManuscript(project: ProjectSnapshot, options: CompileOptions): Manuscript {
  if (!isCompileScope(options.scope)) return emptyManuscript(project, options, 'Choose a valid compilation scope.');
  if (options.format !== 'md' && options.format !== 'txt' && options.format !== 'html') {
    return emptyManuscript(project, options, 'Choose a valid export format.');
  }
  if (!['ornament', 'space', 'none'].includes(options.separator)
    || !['skip', 'placeholder', 'require'].includes(options.empty)) {
    return emptyManuscript(project, options, 'Choose valid compilation options.');
  }

  const chapterIndex = new Map(project.chapters.map((chapter, index) => [chapter.id, index]));
  let selectedChapters: Array<{ chapter: ProjectSnapshot['chapters'][number]; index: number }>;
  let selectedSceneId: string | undefined;

  if (options.scope === 'story') {
    selectedChapters = project.chapters.map((chapter, index) => ({ chapter, index }));
  } else {
    const index = chapterIndex.get(options.chapterId);
    if (index === undefined) {
      return emptyManuscript(project, options, 'Choose a chapter that exists in this project.');
    }
    const chapter = project.chapters[index];
    if (options.scope === 'scene') {
      selectedSceneId = options.sceneId;
      const scene = project.scenes.find(item => item.id === selectedSceneId);
      if (!scene || scene.chapterId !== chapter.id || !chapter.sceneIds.includes(scene.id)) {
        return emptyManuscript(project, options, 'Choose a scene in the selected chapter.');
      }
    }
    selectedChapters = [{ chapter, index }];
  }

  const scenesById = new Map(project.scenes.map(scene => [scene.id, scene]));
  const compiledChapters: CompiledChapter[] = [];
  let selected = 0;
  let included = 0;
  let missing = 0;
  let words = 0;
  let hasDanglingScene = false;
  let selectedTitle = project.title;

  if (options.scope === 'chapter') selectedTitle = selectedChapters[0].chapter.title;
  if (options.scope === 'scene') {
    selectedTitle = scenesById.get(selectedSceneId as string)?.title ?? project.title;
  }

  for (const { chapter, index } of selectedChapters) {
    const sceneIds = selectedSceneId ? [selectedSceneId] : chapter.sceneIds;
    const compiledScenes: CompiledScene[] = [];

    for (const sceneId of sceneIds) {
      const scene = scenesById.get(sceneId);
      if (!scene || scene.chapterId !== chapter.id) {
        hasDanglingScene = true;
        continue;
      }

      selected += 1;
      const sourceProse = typeof scene.prose === 'string' ? scene.prose : '';
      const prose = sourceProse.replace(/\r\n/g, '\n');
      const isEmpty = prose.trim().length === 0;
      if (isEmpty) missing += 1;

      if (isEmpty && options.empty !== 'placeholder') continue;

      compiledScenes.push({
        id: scene.id,
        title: scene.title,
        prose: isEmpty ? '' : prose,
        unfinished: isEmpty,
      });
      included += 1;
      if (!isEmpty) words += countWords(prose);
    }

    if (compiledScenes.length > 0) {
      compiledChapters.push({
        id: chapter.id,
        title: chapter.title,
        number: index + 1,
        scenes: compiledScenes,
      });
    }
  }

  let error: string | null = null;
  if (hasDanglingScene) error = 'One or more selected scenes are unavailable in this project.';
  else if (options.empty === 'require' && missing > 0) error = 'Every selected scene must contain prose.';
  else if (included === 0) error = 'There is no prose to compile with the selected empty-scene policy.';

  return {
    title: selectedTitle,
    scope: options.scope,
    chapters: compiledChapters,
    options,
    stats: { selected, included, missing, words },
    error,
    canExport: error === null && included > 0,
  };
}
