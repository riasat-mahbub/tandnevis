import './test/dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import App from './App';
import type { ProjectSnapshot } from './services/project';
import { deferred, gateway, project, session } from './test/fixtures';

afterEach(cleanup);
describe('connected writing views', () => {
  it('opens Settings without losing the selected scene or writing view', async () => {
    window.localStorage.clear();
    Object.defineProperty(window, 'scrollY', { configurable: true, value: 246 });
    const scrollTo = vi.spyOn(window, 'scrollTo').mockImplementation(() => {});
    render(<App gateway={gateway()} initialSession={session()}/>);
    fireEvent.click(screen.getByRole('button', { name: /^Arrival .*Open scene/ }));
    expect(screen.getByRole('button', { name: 'Generate scene' })).toBeDisabled();
    fireEvent.click(screen.getAllByRole('button', { name: 'Open Settings' })[1]);
    expect(screen.getByRole('heading', { name: 'Settings' })).toBeVisible();
    expect(document.querySelector('.app-workspace')).toHaveAttribute('hidden');
    expect(screen.getByRole('button', { name: 'Continue with ChatGPT' })).toBeDisabled();
    expect(scrollTo).toHaveBeenLastCalledWith(0, 0);
    fireEvent.click(screen.getByRole('button', { name: 'Back to writing' }));
    expect(screen.getByRole('textbox', { name: 'Scene title' })).toHaveValue('Arrival');
    expect(document.querySelector('.app-workspace')).not.toHaveAttribute('hidden');
    await waitFor(() => expect(scrollTo).toHaveBeenLastCalledWith(0, 246));
    scrollTo.mockRestore();
  });
  it('persists the selected appearance and Calm preference from global Settings', () => {
    window.localStorage.clear();
    render(<App gateway={gateway()}/>);
    expect(document.querySelector('.app')).toHaveAttribute('data-theme', 'light');
    fireEvent.click(screen.getByRole('button', { name: 'Open Settings' }));
    fireEvent.click(screen.getByRole('radio', { name: /Dark/ }));
    fireEvent.click(screen.getByRole('checkbox', { name: /Calm appearance/ }));
    expect(document.querySelector('.app')).toHaveAttribute('data-theme', 'dark');
    expect(window.localStorage.getItem('shorthand.appearance')).toBe('dark');
    expect(window.localStorage.getItem('shorthand.calm')).toBe('true');
    fireEvent.click(screen.getByRole('button', { name: 'Back to writing' }));
    expect(screen.getByRole('button', { name: 'Open Settings' })).toBeVisible();
  });
  it('clearly requires the desktop app without inserting a sample manuscript', () => {
    render(<App gateway={gateway()}/>);
    expect(screen.getByText(/Desktop app required/)).toBeVisible();
    expect(screen.getByRole('button', { name: 'New project' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Open project' })).toBeDisabled();
    expect(screen.queryByRole('navigation', { name: 'Writing view' })).toBeNull();
  });
  it('preserves rapid summary edits across navigation while a save is in flight', async () => {
    const g = gateway(), first = deferred<ProjectSnapshot>(), second = deferred<ProjectSnapshot>();
    vi.mocked(g.apply).mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    render(<App gateway={g} initialSession={session()}/>);
    fireEvent.click(screen.getByRole('button', { name: /^Arrival .*Open scene/ }));
    const summary = screen.getByRole('textbox', { name: 'Scene summary' });
    fireEvent.change(summary, { target: { value: 'The beginning' } });
    fireEvent.change(summary, { target: { value: 'The beginning of a difficult conversation.' } });
    fireEvent.click(screen.getByRole('button', { name: 'Back to story' }));
    expect(screen.getByText('The beginning of a difficult conversation.')).toBeVisible();
    expect(screen.getByText('Saving…')).toBeVisible();
    const saved = project(); saved.revision = 1; saved.scenes[0].summary = 'The beginning';
    await act(async () => { first.resolve(saved); await first.promise; });
    expect(screen.getByText('The beginning of a difficult conversation.')).toBeVisible();
    const latest = structuredClone(saved); latest.revision = 2; latest.scenes[0].summary = 'The beginning of a difficult conversation.';
    await act(async () => { second.resolve(latest); await second.promise; });
    fireEvent.click(screen.getByRole('button', { name: /^Arrival .*Open scene/ }));
    expect(screen.getByRole('textbox', { name: 'Scene summary' })).toHaveValue(latest.scenes[0].summary);
    expect(g.apply).toHaveBeenNthCalledWith(2, 'session-1', 1, { type: 'updateScene', sceneId: 'scene-1', summary: latest.scenes[0].summary });
  });
  it('autosaves a valid title while it still has focus', async () => {
    const g = gateway(); const saved = project(); saved.revision = 1; saved.title = 'A changed title'; vi.mocked(g.apply).mockResolvedValueOnce(saved);
    render(<App gateway={g} initialSession={session()}/>);
    const title = screen.getByRole('textbox', { name: 'Project title' }); fireEvent.focus(title); fireEvent.change(title, { target: { value: 'A changed title' } });
    expect(g.apply).toHaveBeenCalledWith('session-1', 0, { type: 'renameProject', title: 'A changed title' });
    await waitFor(() => expect(screen.getByText('Saved locally')).toBeVisible());
  });
  it('keeps failed edits visible and makes recovery available', async () => {
    const g = gateway(); vi.mocked(g.apply).mockRejectedValueOnce(new Error('Read-only disk'));
    render(<App gateway={g} initialSession={session()}/>);
    fireEvent.click(screen.getByRole('button', { name: /^Arrival .*Open scene/ }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Scene summary' }), { target: { value: 'Unsaved but visible.' } });
    await screen.findByRole('alert'); expect(screen.getByRole('textbox', { name: 'Scene summary' })).toHaveValue('Unsaved but visible.');
    expect(screen.getByRole('button', { name: 'Add beat' })).toBeDisabled();
    const saved = project(); saved.revision = 1; saved.scenes[0].summary = 'Unsaved but visible.'; vi.mocked(g.apply).mockResolvedValueOnce(saved);
    fireEvent.click(screen.getByRole('button', { name: 'Retry save' })); await waitFor(() => expect(screen.queryByRole('alert')).toBeNull());
    expect(screen.getByRole('textbox', { name: 'Scene summary' })).toHaveValue('Unsaved but visible.');
  });
  it('uses a single native reorder operation from a visible keyboard-accessible move button', async () => {
    const g = gateway(); const saved = project(); saved.revision = 1; saved.chapters[0].sceneIds = ['scene-2','scene-1']; vi.mocked(g.apply).mockResolvedValueOnce(saved);
    render(<App gateway={g} initialSession={session()}/>);
    fireEvent.click(screen.getByRole('button', { name: 'Move Arrival down' }));
    await waitFor(() => expect(screen.getByText('Saved locally')).toBeVisible());
    expect([...document.querySelectorAll('.scene-open h3')].map(n => n.textContent)).toEqual(['The letter','Arrival']);
    expect(g.apply).toHaveBeenCalledOnce(); expect(g.apply).toHaveBeenCalledWith('session-1', 0, { type: 'reorderScenes', chapterId: 'chapter-1', ids: ['scene-2','scene-1'] });
  });
  it('moves a scene to Trash and restores it with its original identity', async () => {
    const g = gateway(), deleted = project(); deleted.revision = 1; const original = deleted.scenes.shift()!; deleted.chapters[0].sceneIds.shift(); deleted.trash.push({ id: 'trash-1', kind: 'scene', title: 'Arrival', deletedAtRevision: 1, payload: { scene: original } });
    const restored = project(); restored.revision = 2; vi.mocked(g.apply).mockResolvedValueOnce(deleted).mockResolvedValueOnce(restored);
    render(<App gateway={g} initialSession={session()}/>);
    fireEvent.click(screen.getByRole('button', { name: 'Delete Arrival' }));
    await waitFor(() => expect(screen.queryByRole('button', { name: /^Arrival .*Open scene/ })).toBeNull());
    fireEvent.click(screen.getByRole('button', { name: 'Trash (1)' })); fireEvent.click(screen.getByRole('button', { name: 'Restore' }));
    await waitFor(() => expect(screen.getByRole('button', { name: /^Arrival .*Open scene/ })).toBeVisible());
    expect(document.querySelector('[data-item-id="scene-1"]')).toBeTruthy();
    expect(g.apply).toHaveBeenNthCalledWith(2, 'session-1', 1, { type: 'restoreTrash', trashId: 'trash-1' });
  });
});
