import { describe, expect, it } from 'vitest';
import type { CompileOptions, CompiledChapter, CompiledScene, Manuscript } from './compile';
import { serializeManuscript } from './compile-serializers';

function scene(id: string, title: string, prose: string, unfinished = false): CompiledScene {
  return { id, title, prose, unfinished };
}

function chapter(id: string, title: string, number: number, scenes: CompiledScene[]): CompiledChapter {
  return { id, title, number, scenes };
}

type ManuscriptOverrides = Omit<Partial<Manuscript>, 'options' | 'stats'> & {
  options?: Partial<CompileOptions>;
  stats?: Partial<Manuscript['stats']>;
};

function manuscript(overrides: ManuscriptOverrides = {}): Manuscript {
  const chapters = overrides.chapters ?? [chapter('chapter-a', 'First Chapter', 7, [scene('scene-a', 'First Scene', 'Opening prose.')])];
  const included = chapters.reduce((total, item) => total + item.scenes.length, 0);
  const defaults: Manuscript = {
    title: 'A Small Story',
    scope: 'story',
    chapters,
    options: {
      scope: 'story', chapterId: 'chapter-a', sceneId: 'scene-a', format: 'md',
      titlePage: false, contents: false, sceneTitles: false, separator: 'ornament', empty: 'skip',
    },
    stats: { selected: included, included, missing: 0, words: 2 },
    error: null,
    canExport: included > 0,
  };

  const options: CompileOptions = {
    ...defaults.options,
    ...overrides.options,
    scope: overrides.options?.scope ?? overrides.scope ?? defaults.scope,
  };
  return {
    ...defaults,
    ...overrides,
    chapters,
    options,
    stats: { ...defaults.stats, ...overrides.stats },
  };
}

describe('manuscript serializers', () => {
  it('escapes Markdown prose while preserving literal markup, punctuation, Unicode and line breaks', () => {
    const prose = '# Heading *bold* &copy; <script>alert("x")</script>\nsecond line\n\n[link](https://example.invalid) _italic_ 😀';
    const output = serializeManuscript(manuscript({ chapters: [chapter('chapter-a', 'First Chapter', 7, [scene('scene-a', 'First Scene', prose)])] }));

    expect(output).toContain('\\# Heading \\*bold\\* &amp;copy\\; &lt;script&gt;alert\\(\\"x\\"\\)&lt;\\/script&gt;  \nsecond line  \n\n');
    expect(output).toContain('\\[link\\]\\(https\\:\\/\\/example\\.invalid\\) \\_italic\\_ 😀');
    expect(output).not.toContain('<script>');
  });

  it('writes plain text in selected order with original chapter numbers and contents for included scenes only', () => {
    const selected = manuscript({
      title: 'A & B',
      chapters: [
        chapter('chapter-a', 'Harbor', 4, [scene('scene-a', 'Arrival', 'Salt air.\r\nCold hands.'), scene('scene-b', 'Departure', 'The ferry leaves.')]),
        chapter('chapter-c', 'Return', 9, [scene('scene-c', 'Home', 'Lights in the window.')]),
      ],
      options: { format: 'txt', titlePage: true, contents: true, sceneTitles: true },
      stats: { selected: 4, included: 3, missing: 1, words: 10 },
    });
    const output = serializeManuscript(selected);

    expect(output.startsWith('A & B\n\n\nContents\n--------')).toBe(true);
    expect(output).toContain('- Chapter 4: Harbor\n  - Arrival\n  - Departure');
    expect(output).toContain('- Chapter 9: Return\n  - Home');
    expect(output).toContain('Chapter 4: Harbor\n\nArrival\n\nSalt air.\nCold hands.');
    expect(output).toContain('Chapter 9: Return');
    expect(output).not.toContain('Skipped empty scene');
  });

  it('lists scenes in chapter contents even when chapter scene headings are disabled', () => {
    const output = serializeManuscript(manuscript({
      scope: 'chapter',
      chapters: [chapter('chapter-a', 'Harbor', 6, [scene('scene-a', 'Arrival', 'The bell rang.')])],
      options: { scope: 'chapter', format: 'txt', contents: true, sceneTitles: false },
    }));

    expect(output).toContain('- Chapter 6: Harbor\n  - Arrival');
    expect(output).not.toContain('\n\nArrival\n\nThe bell rang.');
    expect(output).toContain('The bell rang.');
  });

  it('uses the scene title exactly once as the body heading for a single-scene compilation', () => {
    const output = serializeManuscript(manuscript({
      title: 'Solo Scene',
      scope: 'scene',
      chapters: [chapter('chapter-a', 'Harbor', 6, [scene('scene-a', 'Solo Scene', 'One quiet sentence.')])],
      options: { scope: 'scene', titlePage: true, sceneTitles: false, format: 'md' },
    }));

    expect(output).toContain('# Solo Scene\n\n## Solo Scene');
    expect(output.match(/^## Solo Scene$/gm)).toHaveLength(1);
    expect(output).not.toContain('Chapter 6: Harbor');
  });

  it('serializes empty placeholder scenes without changing their prose and leaves other empty prose blank', () => {
    const output = serializeManuscript(manuscript({
      chapters: [chapter('chapter-a', 'Drafts', 1, [
        scene('scene-a', 'A blank page', '', true),
        scene('scene-b', 'Another page', '', false),
      ])],
      options: { empty: 'placeholder', separator: 'none', format: 'txt' },
      stats: { selected: 2, included: 2, missing: 2, words: 0 },
    }));

    expect(output).toContain('[Unfinished: A blank page]');
    expect(output).not.toContain('[Unfinished: Another page]');
    expect(output).not.toContain('Another page\n\n[Unfinished');
  });

  it('respects ornament, extra-space and no scene separator choices in text output', () => {
    const chapters = [chapter('chapter-a', 'Short', 1, [scene('scene-a', 'One', 'First.'), scene('scene-b', 'Two', 'Second.')])];
    const render = (separator: CompileOptions['separator']) => serializeManuscript(manuscript({
      chapters,
      options: { format: 'txt', separator },
    }));

    expect(render('ornament')).toContain('First.\n\n* * *\n\nSecond.');
    expect(render('space')).toContain('First.\n\n\nSecond.');
    expect(render('none')).toContain('First.\n\nSecond.');
    expect(render('none')).not.toContain('* * *');
  });

  it('produces standalone safe HTML with escaped text, semantic paragraphs, line breaks and local styles', () => {
    const output = serializeManuscript(manuscript({
      title: 'Story <One> & "Two"',
      scope: 'scene',
      chapters: [chapter('chapter-a', 'Ignored wrapper', 2, [scene(
        'scene-a',
        'Scene <script>alert(1)</script>',
        '<script>alert("x")</script> &copy;\r\nNext line.\n\nLiteral <b>markup</b> 😀',
      )])],
      options: { scope: 'scene', format: 'html', titlePage: true },
    }));

    expect(output).toContain('<!doctype html>');
    expect(output).toContain('<meta charset="utf-8">');
    expect(output).toContain('<style>');
    expect(output).toContain('<header class="title-page"><h1>Story &lt;One&gt; &amp; &quot;Two&quot;</h1></header>');
    expect(output).toContain('<h2>Scene &lt;script&gt;alert(1)&lt;/script&gt;</h2>');
    expect(output).toContain('<p>&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt; &amp;copy;<br>Next line.</p>');
    expect(output).toContain('<p>Literal &lt;b&gt;markup&lt;/b&gt; 😀</p>');
    expect(output).not.toMatch(/<script(?:\s|>)/i);
    expect(output).not.toMatch(/<a\s/i);
    expect(output).not.toContain('https://');
  });

  it('rejects invalid, inconsistent and empty manuscripts with useful errors', () => {
    const empty = manuscript({ chapters: [], stats: { selected: 1, included: 0, missing: 1, words: 0 }, canExport: false });
    expect(() => serializeManuscript(empty)).toThrow(/no included scenes/i);

    const required = manuscript({
      options: { empty: 'require' },
      stats: { selected: 1, included: 1, missing: 1, words: 0 },
    });
    expect(() => serializeManuscript(required)).toThrow(/every selected scene must contain prose/i);

    const inconsistent = manuscript({ stats: { included: 3 } });
    expect(() => serializeManuscript(inconsistent)).toThrow(/included scene count/i);

    const failed = manuscript({ error: 'Choose a valid chapter.', canExport: false });
    expect(() => serializeManuscript(failed)).toThrow(/Choose a valid chapter/);
  });
});
