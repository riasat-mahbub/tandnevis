import { describe, expect, it } from 'vitest';
import type { ProjectSnapshot, Scene } from './project';
import { compileManuscript, defaultCompileOptions, type CompileOptions } from './compile';

function scene(id: string, chapterId: string, prose: string, overrides: Partial<Scene> = {}): Scene {
  return {
    id, chapterId, title: id, summary: `Summary for ${id}`, tone: 'direction that must not export', toneId: '', prose,
    narration: { pointOfView: 'First person', tense: 'Past', instructions: 'private instructions' },
    beats: [{ id: `beat-${id}`, document: { type: 'doc' }, text: 'unaccepted draft text' }],
    ...overrides,
  };
}

function project(chapters: ProjectSnapshot['chapters'], scenes: Scene[]): ProjectSnapshot {
  return {
    projectId: 'project-1', title: 'Story title', revision: 1, chapters, scenes,
    characters: [{
      id: 'character-1', name: 'Library character', background: 'private profile data', voice: '', personality: '',
      archived: false, defaultToneId: '', defaultEmotionId: '',
    }],
    tones: [], emotions: [], starterTypes: [],
    trash: [{ id: 'trash-1', kind: 'scene', title: 'Deleted scene', deletedAtRevision: 0, payload: 'deleted prose' }],
    importSources: [{ id: 'source-1', markdown: 'imported outline content', importedAtRevision: 0 }],
    canUndo: false, canRedo: false,
  };
}

function options(overrides: Partial<CompileOptions> = {}): CompileOptions {
  return {
    scope: 'story', chapterId: 'chapter-b', sceneId: 'scene-b-2', format: 'md', titlePage: false,
    contents: false, sceneTitles: false, separator: 'ornament', empty: 'skip', ...overrides,
  };
}

describe('manuscript compilation', () => {
  it('defaults to the current valid canvas and provides stable formatting defaults', () => {
    const input = project(
      [{ id: 'chapter-a', title: 'First chapter', sceneIds: ['scene-a'] }],
      [scene('scene-a', 'chapter-a', 'Written prose')],
    );

    expect(defaultCompileOptions(input, { scope: 'scene', chapterId: 'chapter-a', sceneId: 'scene-a' })).toEqual({
      scope: 'scene', chapterId: 'chapter-a', sceneId: 'scene-a', format: 'md', titlePage: false,
      contents: false, sceneTitles: false, separator: 'ornament', empty: 'skip',
    });
    expect(defaultCompileOptions(input, { scope: 'scene', chapterId: 'missing', sceneId: 'gone' }).scope).toBe('story');
    expect(defaultCompileOptions(input).scope).toBe('story');
  });

  it('uses chapter and scene ID order rather than scene storage order and keeps original chapter numbers', () => {
    const input = project(
      [
        { id: 'chapter-b', title: 'Second chapter', sceneIds: ['scene-b-2', 'scene-b-1'] },
        { id: 'empty-chapter', title: 'An empty chapter', sceneIds: ['scene-empty'] },
        { id: 'chapter-with-no-scenes', title: 'No scenes', sceneIds: [] },
        { id: 'chapter-c', title: 'Third chapter', sceneIds: ['scene-c'] },
      ],
      [
        scene('scene-c', 'chapter-c', 'third'),
        scene('scene-b-1', 'chapter-b', 'first in chapter'),
        scene('scene-empty', 'empty-chapter', ' \n\t '),
        scene('scene-b-2', 'chapter-b', 'second in chapter'),
      ],
    );

    const manuscript = compileManuscript(input, options());

    expect(manuscript.chapters.map(chapter => [chapter.id, chapter.number])).toEqual([
      ['chapter-b', 1], ['chapter-c', 4],
    ]);
    expect(manuscript.chapters[0].scenes.map(item => item.id)).toEqual(['scene-b-2', 'scene-b-1']);
    expect(manuscript.stats).toEqual({ selected: 4, included: 3, missing: 1, words: 7 });
    expect(manuscript.canExport).toBe(true);
  });

  it('compiles chapter and single-scene scopes and rejects stale IDs without throwing', () => {
    const input = project(
      [{ id: 'chapter-a', title: 'A chapter', sceneIds: ['scene-a', 'scene-b'] }],
      [scene('scene-a', 'chapter-a', 'alpha prose'), scene('scene-b', 'chapter-a', 'beta prose')],
    );

    const chapter = compileManuscript(input, options({ scope: 'chapter', chapterId: 'chapter-a' }));
    expect(chapter.title).toBe('A chapter');
    expect(chapter.stats.selected).toBe(2);

    const oneScene = compileManuscript(input, options({ scope: 'scene', chapterId: 'chapter-a', sceneId: 'scene-b' }));
    expect(oneScene.title).toBe('scene-b');
    expect(oneScene.stats).toEqual({ selected: 1, included: 1, missing: 0, words: 2 });
    expect(oneScene.chapters[0].scenes.map(item => item.id)).toEqual(['scene-b']);

    const invalidChapter = compileManuscript(input, options({ scope: 'chapter', chapterId: 'stale' }));
    const invalidScene = compileManuscript(input, options({ scope: 'scene', sceneId: 'scene-b', chapterId: 'stale' }));
    expect(invalidChapter).toMatchObject({ error: expect.any(String), canExport: false, chapters: [] });
    expect(invalidScene).toMatchObject({ error: expect.any(String), canExport: false, chapters: [] });
  });

  it('skips whitespace-only prose, marks placeholder scenes without counting them, and enforces require', () => {
    const input = project(
      [{ id: 'chapter-a', title: 'A chapter', sceneIds: ['scene-written', 'scene-empty'] }],
      [scene('scene-written', 'chapter-a', 'One two'), scene('scene-empty', 'chapter-a', ' \n\t ')],
    );

    const skipped = compileManuscript(input, options());
    expect(skipped.chapters[0].scenes.map(item => item.id)).toEqual(['scene-written']);
    expect(skipped.stats).toEqual({ selected: 2, included: 1, missing: 1, words: 2 });
    expect(skipped.canExport).toBe(true);

    const placeholder = compileManuscript(input, options({ empty: 'placeholder' }));
    expect(placeholder.chapters[0].scenes[1]).toEqual({
      id: 'scene-empty', title: 'scene-empty', prose: '', unfinished: true,
    });
    expect(placeholder.stats).toEqual({ selected: 2, included: 2, missing: 1, words: 2 });
    expect(placeholder.canExport).toBe(true);

    const required = compileManuscript(input, options({ empty: 'require' }));
    expect(required.chapters[0].scenes.map(item => item.id)).toEqual(['scene-written']);
    expect(required.stats).toEqual({ selected: 2, included: 1, missing: 1, words: 2 });
    expect(required.error).toMatch(/every selected scene/i);
    expect(required.canExport).toBe(false);

    const onlyEmpty = project(
      [{ id: 'chapter-empty', title: 'Empty', sceneIds: ['blank'] }],
      [scene('blank', 'chapter-empty', '\n　\t', { title: 'Blank scene title' })],
    );
    const noOutput = compileManuscript(onlyEmpty, options({ scope: 'scene', chapterId: 'chapter-empty', sceneId: 'blank' }));
    expect(noOutput.title).toBe('Blank scene title');
    expect(noOutput.stats).toEqual({ selected: 1, included: 0, missing: 1, words: 0 });
    expect(noOutput.canExport).toBe(false);

    const placeholderOnly = compileManuscript(onlyEmpty, options({
      scope: 'chapter', chapterId: 'chapter-empty', empty: 'placeholder',
    }));
    expect(placeholderOnly.title).toBe('Empty');
    expect(placeholderOnly.chapters[0].scenes).toEqual([{
      id: 'blank', title: 'Blank scene title', prose: '', unfinished: true,
    }]);
    expect(placeholderOnly.stats).toEqual({ selected: 1, included: 1, missing: 1, words: 0 });
    expect(placeholderOnly.canExport).toBe(true);
  });

  it('preserves literal Unicode and paragraph text while normalizing CRLF and excluding non-prose data', () => {
    const input = project(
      [{ id: 'chapter-a', title: 'A chapter', sceneIds: ['scene-a'] }],
      [scene('scene-a', 'chapter-a', ' <script> & café 🌧\r\n\nSecond\tline ', { summary: 'summary secret' })],
    );

    const manuscript = compileManuscript(input, options());
    const compiled = manuscript.chapters[0].scenes[0];

    expect(compiled.prose).toBe(' <script> & café 🌧\n\nSecond\tline ');
    expect(manuscript.stats.words).toBe(6);
    const serialized = JSON.stringify(manuscript);
    expect(serialized).toContain('<script> & café 🌧');
    expect(serialized).not.toContain('summary secret');
    expect(serialized).not.toContain('direction that must not export');
    expect(serialized).not.toContain('unaccepted draft text');
    expect(serialized).not.toContain('private profile data');
    expect(serialized).not.toContain('deleted prose');
    expect(serialized).not.toContain('imported outline content');
  });
});
