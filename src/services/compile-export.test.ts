import { beforeEach, describe, expect, it, vi } from 'vitest';

const native = vi.hoisted(() => ({ invoke: vi.fn(), save: vi.fn(), isTauri: vi.fn(() => true) }));

vi.mock('@tauri-apps/api/core', () => ({ invoke: native.invoke, isTauri: native.isTauri }));
vi.mock('@tauri-apps/plugin-dialog', () => ({ save: native.save }));

import {
  compileDefaultFilename,
  desktopCompileExportGateway,
  ensureCompileExtension,
} from './compile-export';

describe('desktop manuscript export gateway', () => {
  beforeEach(() => {
    native.save.mockReset();
    native.invoke.mockReset();
  });

  it('builds a safe default filename while preserving meaningful dots', () => {
    expect(compileDefaultFilename('A Story: Part 1.2', 'md')).toBe('A Story Part 1.2.md');
    expect(compileDefaultFilename('CON.txt', 'html')).toBe('_CON.html');
    expect(compileDefaultFilename('  ', 'txt')).toBe('Untitled story.txt');
  });

  it('uses the format filter and appends only a missing extension', async () => {
    native.save.mockResolvedValue('C:\\Books\\Winter 1.2');
    await expect(desktopCompileExportGateway.choosePath('Winter 1.2', 'html'))
      .resolves.toBe('C:\\Books\\Winter 1.2.html');
    expect(native.save).toHaveBeenCalledWith({
      title: 'Export HTML manuscript',
      defaultPath: 'Winter 1.2.html',
      filters: [{ name: 'HTML', extensions: ['html'] }],
    });
  });

  it('rejects a known mismatched extension and preserves a matching extension', async () => {
    native.save.mockResolvedValue('C:\\Books\\Winter.txt');
    await expect(desktopCompileExportGateway.choosePath('Winter', 'md'))
      .rejects.toThrow('Choose a .md filename for Markdown.');
    expect(ensureCompileExtension('C:\\Books\\Winter.MD', 'md'))
      .toBe('C:\\Books\\Winter.MD');
    expect(() => ensureCompileExtension('C:\\Books\\Winter.pdf', 'md'))
      .toThrow('Choose a .md filename for Markdown.');
  });

  it('treats dialog cancellation as silent and does not write', async () => {
    native.save.mockResolvedValue(null);
    await expect(desktopCompileExportGateway.choosePath('Winter', 'txt')).resolves.toBeNull();
    expect(native.invoke).not.toHaveBeenCalled();
  });

  it('writes Unicode paths and manuscript contents through the scoped command', async () => {
    const path = 'C:\\Books\\雪の章.html';
    const contents = '<p>Привет — café</p>';
    native.invoke.mockResolvedValue(undefined);
    await desktopCompileExportGateway.writeFile(path, contents);
    expect(native.invoke).toHaveBeenCalledWith('write_compiled_manuscript', { path, contents });
  });

  it('surfaces native write failures for retry in the dialog', async () => {
    native.invoke.mockRejectedValue(new Error('Disk is full.'));
    await expect(desktopCompileExportGateway.writeFile('C:\\Books\\Winter.md', 'Text'))
      .rejects.toThrow('Disk is full.');
  });
});
