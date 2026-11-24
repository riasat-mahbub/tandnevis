import { invoke, isTauri } from '@tauri-apps/api/core';
import { save } from '@tauri-apps/plugin-dialog';
import type { CompileFormat } from './compile';

export interface CompileExportGateway {
  desktop: boolean;
  choosePath(title: string, format: CompileFormat): Promise<string | null>;
  writeFile(path: string, contents: string): Promise<void>;
}

const FORMAT_EXTENSIONS: Record<CompileFormat, string> = {
  md: 'md',
  txt: 'txt',
  html: 'html',
};

const FORMAT_LABELS: Record<CompileFormat, string> = {
  md: 'Markdown',
  txt: 'Plain text',
  html: 'HTML',
};

const recognizedCompileExtensions = new Set(Object.values(FORMAT_EXTENSIONS));

export function compileExtension(format: CompileFormat): string {
  return FORMAT_EXTENSIONS[format];
}

/**
 * Turn a story/scope title into a safe default filename. Dots that are part of
 * a title (for example, "Book 1.2") are preserved; only a known export suffix
 * is removed before the selected format's suffix is added.
 */
export function compileDefaultFilename(title: string, format: CompileFormat): string {
  const cleaned = title
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/[ .]+$/g, '')
    .trim();
  let base = cleaned || 'Untitled story';
  const suffix = base.match(/\.([^.]+)$/)?.[1].toLowerCase();
  if (suffix && recognizedCompileExtensions.has(suffix)) base = base.slice(0, -(suffix.length + 1));
  base = base.replace(/[ .]+$/g, '').trim() || 'Untitled story';

  // Windows reserves these names even when followed by an extension.
  if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(base)) base = `_${base}`;
  let safeBase = '';
  for (const character of base) {
    if (safeBase.length + character.length > 180) break;
    safeBase += character;
  }
  base = safeBase.replace(/[ .]+$/g, '').trim() || 'Untitled story';
  return `${base}.${compileExtension(format)}`;
}

/** Add the selected format extension, or reject an explicitly different one. */
export function ensureCompileExtension(path: string, format: CompileFormat): string {
  if (!path.trim()) throw new Error('Choose a destination for the compiled manuscript.');
  const filename = path.slice(Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\')) + 1);
  if (!filename || filename === '.' || filename === '..') {
    throw new Error('Choose a valid filename for the compiled manuscript.');
  }

  const extension = compileExtension(format);
  const suffix = filename.match(/\.([^.]+)$/)?.[1]?.toLowerCase();
  if (!suffix) return `${path}.${extension}`;
  if (suffix === extension) return path;
  if (recognizedCompileExtensions.has(suffix)) {
    throw new Error(`Choose a .${extension} filename for ${FORMAT_LABELS[format]}.`);
  }

  // Alphabetic suffixes read as an explicit file extension; numeric dotted
  // title parts such as "Book 1.2" remain intact and receive the selected one.
  if (/[a-z]/i.test(suffix)) {
    throw new Error(`Choose a .${extension} filename for ${FORMAT_LABELS[format]}.`);
  }
  return `${path}.${extension}`;
}

export const desktopCompileExportGateway: CompileExportGateway = {
  desktop: isTauri(),
  async choosePath(title, format) {
    const extension = compileExtension(format);
    const selectedPath = await save({
      title: `Export ${FORMAT_LABELS[format]} manuscript`,
      defaultPath: compileDefaultFilename(title, format),
      filters: [{ name: FORMAT_LABELS[format], extensions: [extension] }],
    });
    return selectedPath === null ? null : ensureCompileExtension(selectedPath, format);
  },
  writeFile: (path, contents) => invoke('write_compiled_manuscript', { path, contents }),
};
