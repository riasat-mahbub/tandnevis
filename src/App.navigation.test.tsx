import './test/dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { Editor } from '@tiptap/core';
import App from './App';
import { deferred, gateway, project, session } from './test/fixtures';
import type { ProjectSnapshot } from './services/project';

vi.mock('@tauri-apps/api/window', () => ({ getCurrentWindow: () => ({ destroy: vi.fn(), onCloseRequested: vi.fn(async () => vi.fn()) }) }));
afterEach(cleanup);

function narrative() {
  const snapshot = project();
  snapshot.chapters.push({ id: 'empty', title: 'Interlude', sceneIds: [] }, { id: 'chapter-2', title: 'Beyond the gate', sceneIds: ['scene-3'] });
  snapshot.scenes.push({ ...structuredClone(snapshot.scenes[1]), id: 'scene-3', chapterId: 'chapter-2', title: 'The academy', summary: 'At the academy gates.' });
  return snapshot;
}
const openArrival = () => fireEvent.click(screen.getByRole('button', { name: /^Arrival .*Open scene/ }));
const editorFor = (element: HTMLElement) => (element as HTMLElement & { editor: Editor }).editor;

describe('story-first navigation', () => {
  it('follows chapter reading order across empty chapters and disables the end controls', () => {
    const snapshot = narrative();
    // Scene storage order must not determine narrative navigation order.
    snapshot.scenes.reverse();
    render(<App gateway={gateway(snapshot)} initialSession={session(snapshot)}/>);
    openArrival();
    expect(screen.getByRole('button', { name: 'Previous scene' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Next scene' }));
    expect(screen.getByRole('textbox', { name: 'Scene title' })).toHaveValue('The letter');
    fireEvent.click(screen.getByRole('button', { name: 'Next scene' }));
    expect(screen.getByRole('textbox', { name: 'Scene title' })).toHaveValue('The academy');
    expect(screen.getByRole('button', { name: 'Jump to chapter or scene: Beyond the gate' })).toBeVisible();
    expect(screen.getByRole('button', { name: 'Next scene' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Previous scene' }));
    expect(screen.getByRole('textbox', { name: 'Scene title' })).toHaveValue('The letter');
  });

  it('searches the temporary outline and jumps directly to a scene', () => {
    const snapshot = narrative();
    render(<App gateway={gateway(snapshot)} initialSession={session(snapshot)}/>);
    openArrival();
    fireEvent.click(screen.getByRole('button', { name: 'Jump to scene: Arrival' }));
    const outline = screen.getByRole('dialog', { name: 'Story outline' });
    expect(within(outline).getByRole('button', { name: 'Arrival Current scene' })).toHaveAttribute('aria-current', 'location');
    const search = within(outline).getByRole('searchbox');
    expect(search).toHaveFocus();
    fireEvent.change(search, { target: { value: 'academy' } });
    expect(within(outline).queryByRole('button', { name: 'The letter' })).toBeNull();
    fireEvent.keyDown(search, { key: 'ArrowDown' });
    expect(within(outline).getByRole('button', { name: 'The academy' })).toHaveFocus();
    fireEvent.click(within(outline).getByRole('button', { name: 'The academy' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.getByRole('textbox', { name: 'Scene title' })).toHaveValue('The academy');
  });

  it('restores outline focus on cancellation and reports empty searches', () => {
    render(<App gateway={gateway()} initialSession={session()}/>);
    openArrival();
    const trigger = screen.getByRole('button', { name: 'Jump to scene: Arrival' });
    trigger.focus(); fireEvent.click(trigger);
    const outline = screen.getByRole('dialog', { name: 'Story outline' });
    fireEvent.change(within(outline).getByRole('searchbox'), { target: { value: 'missing chapter' } });
    expect(within(outline).getByText('No chapters or scenes match “missing chapter”.')).toBeVisible();
    fireEvent(outline, new Event('cancel', { bubbles: true, cancelable: true }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(trigger).toHaveFocus();
  });

  it('focuses a chapter in Story View and retains its compact presentation across a scene visit', () => {
    const snapshot = narrative();
    render(<App gateway={gateway(snapshot)} initialSession={session(snapshot)}/>);
    fireEvent.click(screen.getByRole('button', { name: 'Compact' }));
    openArrival();
    fireEvent.click(screen.getByRole('button', { name: 'Jump to chapter or scene: The beginning' }));
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Focus chapter Beyond the gate' }));
    expect(screen.getByRole('button', { name: 'Compact' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'Expand chapter The beginning' })).toHaveAttribute('aria-expanded', 'false');
    expect(screen.getByRole('button', { name: 'Collapse chapter Beyond the gate' })).toHaveAttribute('aria-expanded', 'true');
    fireEvent.click(screen.getByRole('button', { name: /^The academy .*Open scene/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Story overview' }));
    expect(screen.getByRole('button', { name: /^The academy .*Open scene/ })).toHaveAttribute('aria-current', 'location');
    expect(screen.queryByRole('button', { name: /^Arrival .*Open scene/ })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Show all chapters' }));
    expect(screen.getByRole('button', { name: /^Arrival .*Open scene/ })).toBeVisible();
  });

  it('keeps an opened editor, its caret, and undo history while navigating with a write pending', () => {
    const g = gateway(), pending = deferred<ProjectSnapshot>();
    vi.mocked(g.apply).mockReturnValue(pending.promise);
    render(<App gateway={g} initialSession={session()}/>);
    openArrival();
    const summary = screen.getByRole('textbox', { name: 'Scene summary' });
    const editor = editorFor(summary);
    act(() => { editor.commands.setTextSelection(9); editor.commands.insertContent('unexpectedly '); });
    const caret = editor.state.selection.from;
    expect(editor.can().undo()).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Next scene' }));
    fireEvent.click(screen.getByRole('button', { name: 'Previous scene' }));
    expect(screen.getByRole('textbox', { name: 'Scene summary' })).toBe(summary);
    expect(editor.state.selection.from).toBe(caret);
    expect(editor.can().undo()).toBe(true);
    expect(summary).toHaveTextContent('unexpectedly');
    act(() => { editor.commands.undo(); });
    expect(summary).not.toHaveTextContent('unexpectedly');
    expect(g.save).not.toHaveBeenCalled();
  });

  it('returns from a new preset to the originating editor without inserting the preset or saving', async () => {
    const snapshot = project(), g = gateway(snapshot);
    vi.mocked(g.apply).mockImplementation(async (_session, _revision, operation) => {
      if (operation.type !== 'createPreset') throw new Error('Unexpected operation');
      const next = structuredClone(snapshot); next.revision++;
      next.emotions.push({ id: 'hope', name: operation.name, meaning: '', guidance: '', example: '', archived: false, revision: 0 });
      return next;
    });
    render(<App gateway={g} initialSession={session(snapshot)}/>);
    openArrival();
    const summary = screen.getByRole('textbox', { name: 'Scene summary' });
    act(() => { editorFor(summary).commands.setTextSelection(7); });
    fireEvent.click(screen.getByRole('tab', { name: 'Emotions' }));
    fireEvent.click(screen.getByRole('button', { name: 'New emotion' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'New emotion name' }), { target: { value: 'Hope' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create emotion' }));
    await waitFor(() => expect(screen.getByRole('textbox', { name: 'Scene summary' })).toBe(summary));
    expect(editorFor(summary).state.selection.from).toBe(7);
    expect(screen.getByRole('button', { name: 'Emotion: Hope' })).toBeVisible();
    expect(summary).not.toHaveTextContent('Hope');
    expect(g.save).not.toHaveBeenCalled();
  });

  it('restores independent scene and overview scroll positions', async () => {
    const descriptor = Object.getOwnPropertyDescriptor(window, 'scrollY')!;
    let scrollPosition = 420;
    Object.defineProperty(window, 'scrollY', { configurable: true, get: () => scrollPosition });
    try {
      render(<App gateway={gateway()} initialSession={session()}/>);
      openArrival();
      await waitFor(() => expect(window.scrollTo).toHaveBeenLastCalledWith(0, 0));
      scrollPosition = 600;
      fireEvent.click(screen.getByRole('button', { name: 'Next scene' }));
      await waitFor(() => expect(window.scrollTo).toHaveBeenLastCalledWith(0, 0));
      scrollPosition = 250;
      fireEvent.click(screen.getByRole('button', { name: 'Previous scene' }));
      await waitFor(() => expect(window.scrollTo).toHaveBeenLastCalledWith(0, 600));
      fireEvent.click(screen.getByRole('button', { name: 'Story overview' }));
      await waitFor(() => expect(window.scrollTo).toHaveBeenLastCalledWith(0, 420));
    } finally { Object.defineProperty(window, 'scrollY', descriptor); }
  });

  it('returns from cancelling preset creation and leaves the scene intact', () => {
    const g = gateway();
    render(<App gateway={g} initialSession={session()}/>);
    openArrival();
    const summary = screen.getByRole('textbox', { name: 'Scene summary' });
    fireEvent.click(screen.getByRole('tab', { name: 'Tones' }));
    fireEvent.click(screen.getByRole('button', { name: 'New tone' }));
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.getByRole('textbox', { name: 'Scene summary' })).toBe(summary);
    expect(g.apply).not.toHaveBeenCalled();
  });
});
