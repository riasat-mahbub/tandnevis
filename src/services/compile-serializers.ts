import type { CompileFormat, CompiledChapter, CompiledScene, Manuscript } from './compile';

const markdownPunctuation = new Set(Array.from("!\"#$%&'()*+,-./:;<=>?@[\\]^_`{|}~"));

function normalizeLineEndings(value: string): string {
  return value.replace(/\r\n?/g, '\n');
}

function headingText(value: string): string {
  return normalizeLineEndings(value).replace(/\n+/g, ' ').trim();
}

function markdownText(value: string): string {
  let output = '';
  for (const character of value) {
    if (character === '&') output += '&amp;';
    else if (character === '<') output += '&lt;';
    else if (character === '>') output += '&gt;';
    else if (character === '\\' || markdownPunctuation.has(character)) output += `\\${character}`;
    else output += character;
  }
  return output;
}

function markdownProse(value: string): string {
  const lines = normalizeLineEndings(value).split('\n');
  return lines.map((line, index) => {
    if (/^[ \t]*$/.test(line)) return '';

    const leadingWhitespace = /^[ \t]+/.exec(line)?.[0] ?? '';
    const leadingEntities = Array.from(leadingWhitespace, character => character === '\t' ? '&#9;' : '&#32;').join('');
    const escaped = leadingEntities + markdownText(line.slice(leadingWhitespace.length));
    // CommonMark treats an unadorned newline as a soft break. Two trailing spaces
    // keep a hand-authored line break visible without allowing prose markup.
    return index < lines.length - 1 ? `${escaped}  ` : escaped;
  }).join('\n');
}

function htmlText(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function chapterLabel(chapter: CompiledChapter): string {
  const title = headingText(chapter.title);
  return title ? `Chapter ${chapter.number}: ${title}` : `Chapter ${chapter.number}`;
}

function sceneLabel(scene: CompiledScene): string {
  return headingText(scene.title) || 'Untitled scene';
}

function sceneProse(scene: CompiledScene): string {
  const prose = normalizeLineEndings(scene.prose);
  if (prose.trim().length > 0 || !scene.unfinished) return prose;
  return `[Unfinished: ${sceneLabel(scene)}]`;
}

function countScenes(manuscript: Manuscript): number {
  return manuscript.chapters.reduce((count, chapter) => count + chapter.scenes.length, 0);
}

function assertSerializable(manuscript: Manuscript, format: CompileFormat): void {
  if (format !== 'md' && format !== 'txt' && format !== 'html') {
    throw new Error(`Cannot export manuscript: unsupported format "${String(format)}".`);
  }
  if (!manuscript || !Array.isArray(manuscript.chapters) || !manuscript.options || !manuscript.stats) {
    throw new Error('Cannot export manuscript: the manuscript data is incomplete.');
  }
  if (manuscript.error) {
    throw new Error(`Cannot export manuscript: ${manuscript.error}`);
  }
  if (manuscript.options.empty === 'require' && manuscript.stats.missing > 0) {
    throw new Error('Cannot export manuscript: every selected scene must contain prose.');
  }
  const actualIncluded = countScenes(manuscript);
  if (actualIncluded === 0 || manuscript.stats.included === 0) {
    throw new Error('Cannot export manuscript: there are no included scenes.');
  }
  if (actualIncluded !== manuscript.stats.included) {
    throw new Error('Cannot export manuscript: the included scene count does not match the manuscript data.');
  }
  if (!manuscript.canExport) {
    throw new Error('Cannot export manuscript: the selected manuscript is not ready to export.');
  }

  for (const chapter of manuscript.chapters) {
    if (!chapter || !Array.isArray(chapter.scenes) || typeof chapter.title !== 'string' || !Number.isFinite(chapter.number)) {
      throw new Error('Cannot export manuscript: a chapter is incomplete.');
    }
    for (const scene of chapter.scenes) {
      if (!scene || typeof scene.title !== 'string' || typeof scene.prose !== 'string') {
        throw new Error('Cannot export manuscript: a scene is incomplete.');
      }
    }
  }
}

function hasVisibleSceneTitles(manuscript: Manuscript): boolean {
  return manuscript.scope === 'scene' || manuscript.options.sceneTitles;
}

function markdownContents(manuscript: Manuscript): string {
  if (!manuscript.options.contents || manuscript.scope === 'scene') return '';

  const level = manuscript.options.titlePage ? 2 : 1;
  const lines = [`${'#'.repeat(level)} Contents`];
  const showScenes = manuscript.scope === 'chapter' || manuscript.options.sceneTitles;
  for (const chapter of manuscript.chapters) {
    lines.push(`- ${markdownText(chapterLabel(chapter))}`);
    if (showScenes) {
      for (const scene of chapter.scenes) lines.push(`  - ${markdownText(sceneLabel(scene))}`);
    }
  }
  return lines.join('\n');
}

function markdownScene(scene: CompiledScene, sceneLevel: number, includeHeading: boolean): string {
  const parts: string[] = [];
  if (includeHeading) parts.push(`${'#'.repeat(sceneLevel)} ${markdownText(sceneLabel(scene))}`);
  const prose = sceneProse(scene);
  if (prose.length > 0) parts.push(markdownProse(prose));
  return parts.join('\n\n');
}

function serializeMarkdown(manuscript: Manuscript): string {
  const parts: string[] = [];
  if (manuscript.options.titlePage) parts.push(`# ${markdownText(headingText(manuscript.title) || 'Untitled')}`);
  const contents = markdownContents(manuscript);
  if (contents) parts.push(contents);

  const chapterLevel = manuscript.options.titlePage ? 2 : 1;
  const chapterSections = manuscript.chapters.map(chapter => {
    const chapterParts: string[] = [];
    if (manuscript.scope !== 'scene') {
      chapterParts.push(`${'#'.repeat(chapterLevel)} ${markdownText(chapterLabel(chapter))}`);
    }

    const sceneLevel = manuscript.scope === 'scene'
      ? manuscript.options.titlePage ? 2 : 1
      : chapterLevel + 1;
    const scenes = chapter.scenes.map(scene => markdownScene(scene, sceneLevel, hasVisibleSceneTitles(manuscript)));
    if (scenes.length > 0) {
      let renderedScenes = scenes[0];
      for (let index = 1; index < scenes.length; index += 1) {
        const separator = manuscript.options.separator === 'ornament'
          ? '\n\n* * *\n\n'
          : manuscript.options.separator === 'space'
            ? '\n\n\n'
            : '\n\n';
        renderedScenes += `${separator}${scenes[index]}`;
      }
      chapterParts.push(renderedScenes);
    }
    return chapterParts.join('\n\n');
  });
  parts.push(...chapterSections);
  return parts.filter(Boolean).join('\n\n') + '\n';
}

function textContents(manuscript: Manuscript): string {
  if (!manuscript.options.contents || manuscript.scope === 'scene') return '';

  const lines = ['Contents', '--------'];
  for (const chapter of manuscript.chapters) {
    lines.push(`- ${chapterLabel(chapter)}`);
    if (manuscript.scope === 'chapter' || manuscript.options.sceneTitles) {
      for (const scene of chapter.scenes) lines.push(`  - ${sceneLabel(scene)}`);
    }
  }
  return lines.join('\n');
}

function textScene(scene: CompiledScene, manuscript: Manuscript): string {
  const parts: string[] = [];
  if (hasVisibleSceneTitles(manuscript)) parts.push(sceneLabel(scene));
  const prose = sceneProse(scene);
  if (prose.length > 0) parts.push(prose);
  return parts.join('\n\n');
}

function serializeText(manuscript: Manuscript): string {
  const parts: string[] = [];
  if (manuscript.options.titlePage) parts.push(headingText(manuscript.title) || 'Untitled');
  const contents = textContents(manuscript);
  if (contents) parts.push(contents);

  const chapterSections = manuscript.chapters.map(chapter => {
    const chapterParts: string[] = [];
    if (manuscript.scope !== 'scene') chapterParts.push(chapterLabel(chapter));
    const scenes = chapter.scenes.map(scene => textScene(scene, manuscript));
    if (scenes.length > 0) {
      const separator = manuscript.options.separator === 'ornament'
        ? '\n\n* * *\n\n'
        : manuscript.options.separator === 'space'
          ? '\n\n\n'
          : '\n\n';
      chapterParts.push(scenes.join(separator));
    }
    return chapterParts.join('\n\n');
  });
  parts.push(...chapterSections);
  return parts.filter(Boolean).join('\n\n\n') + '\n';
}

function htmlParagraphs(value: string): string {
  const normalized = normalizeLineEndings(value);
  const paragraphs = normalized.split(/\n[ \t]*\n+/).filter(paragraph => paragraph.length > 0);
  return paragraphs.map(paragraph => {
    const lines = paragraph.split('\n');
    return `<p>${lines.map(htmlText).join('<br>')}</p>`;
  }).join('\n');
}

function htmlContents(manuscript: Manuscript, headingLevel: number): string {
  if (!manuscript.options.contents || manuscript.scope === 'scene') return '';

  const chapters = manuscript.chapters.map(chapter => {
    const scenes = manuscript.scope === 'chapter' || manuscript.options.sceneTitles
      ? `<ul>${chapter.scenes.map(scene => `<li>${htmlText(sceneLabel(scene))}</li>`).join('')}</ul>`
      : '';
    return `<li>${htmlText(chapterLabel(chapter))}${scenes}</li>`;
  }).join('');
  return `<nav class="contents" aria-label="Contents"><h${headingLevel}>Contents</h${headingLevel}><ol>${chapters}</ol></nav>`;
}

function htmlScene(scene: CompiledScene, headingLevel: number, includeHeading: boolean, spaced: boolean): string {
  const className = spaced ? 'scene scene-spaced' : 'scene';
  const heading = includeHeading ? `<h${headingLevel}>${htmlText(sceneLabel(scene))}</h${headingLevel}>` : '';
  const paragraphs = htmlParagraphs(sceneProse(scene));
  return `<section class="${className}">${heading}${paragraphs}</section>`;
}

const htmlStyles = `
    :root { color-scheme: light; font-family: Georgia, "Palatino Linotype", serif; color: #25231f; background: #fff; }
    * { box-sizing: border-box; }
    body { max-width: 72ch; margin: 0 auto; padding: 3.5rem 1.5rem; line-height: 1.7; }
    h1, h2, h3 { line-height: 1.25; font-weight: 500; }
    h1 { font-size: 2.25rem; }
    h2 { font-size: 1.7rem; }
    h3 { font-size: 1.35rem; }
    p { margin: 0 0 1em; white-space: normal; }
    .title-page { min-height: 75vh; display: grid; place-items: center; text-align: center; break-after: page; }
    .title-page h1 { max-width: 18ch; }
    .contents { margin: 2rem 0 4rem; break-after: page; }
    .contents ul { margin-top: .4rem; }
    .chapter + .chapter { break-before: page; }
    .scene { margin-block: 1rem; }
    .scene-spaced { margin-top: 3rem; }
    .scene-break { width: 4rem; margin: 2.5rem auto; border: 0; text-align: center; }
    .scene-break::before { content: "* * *"; letter-spacing: .45em; }
    @media print { body { max-width: none; padding: 0; } .title-page { min-height: 95vh; } }
`;

function serializeHtml(manuscript: Manuscript): string {
  const parts: string[] = [];
  if (manuscript.options.titlePage) {
    parts.push(`<header class="title-page"><h1>${htmlText(headingText(manuscript.title) || 'Untitled')}</h1></header>`);
  }

  const baseHeadingLevel = manuscript.options.titlePage ? 2 : 1;
  const contents = htmlContents(manuscript, baseHeadingLevel);
  if (contents) parts.push(contents);

  const chapterSections = manuscript.chapters.map((chapter, chapterIndex) => {
    const chapterParts: string[] = [];
    if (manuscript.scope !== 'scene') {
      chapterParts.push(`<h${baseHeadingLevel}>${htmlText(chapterLabel(chapter))}</h${baseHeadingLevel}>`);
    }

    const sceneHeadingLevel = manuscript.scope === 'scene'
      ? manuscript.options.titlePage ? 2 : 1
      : Math.min(baseHeadingLevel + 1, 6);
    const scenes: string[] = [];
    chapter.scenes.forEach((scene, sceneIndex) => {
      if (sceneIndex > 0 && manuscript.options.separator === 'ornament') {
        scenes.push('<hr class="scene-break" aria-label="Scene break">');
      }
      scenes.push(htmlScene(
        scene,
        sceneHeadingLevel,
        hasVisibleSceneTitles(manuscript),
        sceneIndex > 0 && manuscript.options.separator === 'space',
      ));
    });
    chapterParts.push(scenes.join('\n'));

    const content = chapterParts.filter(Boolean).join('\n');
    if (manuscript.scope === 'scene') return content;
    return `<section class="chapter" id="chapter-${chapterIndex + 1}">\n${content}\n</section>`;
  });
  parts.push(...chapterSections);

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>${htmlText(headingText(manuscript.title) || 'Untitled')}</title>
    <style>${htmlStyles}</style>
  </head>
  <body>
    <main class="manuscript">
      ${parts.join('\n      ')}
    </main>
  </body>
</html>
`;
}

export function serializeManuscript(
  manuscript: Manuscript,
  format: CompileFormat = manuscript.options.format,
): string {
  assertSerializable(manuscript, format);
  switch (format) {
    case 'md': return serializeMarkdown(manuscript);
    case 'txt': return serializeText(manuscript);
    case 'html': return serializeHtml(manuscript);
  }
}
