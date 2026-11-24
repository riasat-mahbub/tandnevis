import './test/dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { Editor } from '@tiptap/core';
import App from './App';
import type { CompileExportGateway } from './services/compile-export';
import { gateway, project, session } from './test/fixtures';
import { openArrival, openChapter } from './test/navigation';

vi.mock('@tauri-apps/api/window', () => ({ getCurrentWindow: () => ({ destroy: vi.fn(), onCloseRequested: vi.fn(async () => vi.fn()) }) }));
afterEach(cleanup);

function compileGateway(): CompileExportGateway {
  return {
    desktop: true,
    choosePath: vi.fn(async () => 'C:\\Books\\A quiet story.md'),
    writeFile: vi.fn(async () => {}),
  };
}

function populatedSession() {
  const snapshot = project(); snapshot.scenes[0].prose = 'A little authored prose.';
  return session(snapshot);
}

async function openCompile() {
  fireEvent.click(screen.getByRole('button', { name: 'Compile Book' }));
  await screen.findByRole('dialog', { name: 'Compile Book' });
  await waitFor(() => expect(screen.getByRole('button', { name: /^Export/ })).toBeEnabled());
}

function closeCompile() {
  fireEvent.click(screen.getByRole('button', { name: 'Close compilation' }));
}

describe('App Compile Book integration', () => {
  it('defaults to the scope of the active story, chapter, or scene canvas', async () => {
    render(<App gateway={gateway()} initialSession={populatedSession()} compileService={compileGateway()}/>);

    await openCompile();
    expect(screen.getByRole('radio', { name: 'Entire story' })).toBeChecked();
    closeCompile();

    openChapter();
    await openCompile();
    expect(screen.getByRole('radio', { name: 'One chapter' })).toBeChecked();
    expect(screen.getByLabelText('Chapter')).toHaveValue('chapter-1');
    closeCompile();

    openArrival();
    await openCompile();
    expect(screen.getByRole('radio', { name: 'One scene' })).toBeChecked();
    expect(screen.getByLabelText('Chapter')).toHaveValue('chapter-1');
    expect(screen.getByLabelText('Scene')).toHaveValue('scene-1');
  });

  it('keeps format choices within a session and resets them after switching projects', async () => {
    const g = gateway(); g.desktop = true;
    const another = project(); another.projectId = 'project-2'; another.title = 'New book'; another.scenes[0].prose = 'New prose.';
    vi.mocked(g.chooseOpen).mockResolvedValueOnce('C:\\Books\\new.shorthand');
    vi.mocked(g.open).mockResolvedValueOnce({ sessionId: 'session-2', project: another });
    render(<App gateway={g} initialSession={populatedSession()} compileService={compileGateway()}/>);

    await openCompile();
    fireEvent.change(screen.getByLabelText('File type'), { target: { value: 'html' } });
    fireEvent.click(screen.getByRole('checkbox', { name: 'Include title page' }));
    closeCompile();

    await openCompile();
    expect(screen.getByLabelText('File type')).toHaveValue('html');
    expect(screen.getByRole('checkbox', { name: 'Include title page' })).toBeChecked();
    closeCompile();

    fireEvent.click(screen.getByLabelText('Project menu'));
    fireEvent.click(screen.getByRole('button', { name: 'Open project' }));
    await waitFor(() => expect(screen.getByRole('textbox', { name: 'Project title' })).toHaveValue('New book'));

    await openCompile();
    expect(screen.getByLabelText('File type')).toHaveValue('md');
    expect(screen.getByRole('checkbox', { name: 'Include title page' })).not.toBeChecked();
  });

  it('preserves the mounted scene editor and caret when compilation is dismissed', async () => {
    render(<App gateway={gateway()} initialSession={populatedSession()} compileService={compileGateway()}/>);
    openArrival();
    const summary = screen.getByRole('textbox', { name: 'Scene summary' });
    const editor = (summary as HTMLElement & { editor: Editor }).editor;
    act(() => { editor.commands.setTextSelection(8); });
    const caret = editor.state.selection.from;
    const trigger = screen.getByRole('button', { name: 'Compile Book' });
    trigger.focus();
    fireEvent.click(trigger);
    await screen.findByRole('dialog', { name: 'Compile Book' });

    closeCompile();

    expect(screen.getByRole('textbox', { name: 'Scene summary' })).toBe(summary);
    expect(editor.state.selection.from).toBe(caret);
    expect(trigger).toHaveFocus();
  });

  it('guards the compile shortcut while another dialog is open', async () => {
    render(<App gateway={gateway()} initialSession={populatedSession()} compileService={compileGateway()}/>);
    fireEvent.click(screen.getByLabelText('Library'));
    expect(screen.getByRole('dialog', { name: 'Story Library' })).toBeInTheDocument();

    fireEvent.keyDown(window, { key: 'e', ctrlKey: true, shiftKey: true });
    expect(screen.queryByRole('dialog', { name: 'Compile Book' })).toBeNull();

    fireEvent(screen.getByRole('dialog', { name: 'Story Library' }), new Event('cancel', { bubbles: true, cancelable: true }));
    fireEvent.keyDown(window, { key: 'e', ctrlKey: true, shiftKey: true });
    await waitFor(() => expect(screen.getByRole('dialog', { name: 'Compile Book' })).toBeInTheDocument());
  });
});
