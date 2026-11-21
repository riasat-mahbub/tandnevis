import './test/dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import App from './App';
import type { Editor } from '@tiptap/core';

function setSummary(element: HTMLElement, text: string) {
  act(() => (element as HTMLElement & { editor: Editor }).editor.commands.setContent({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] }));
}
import type { ChatGPTGateway, NativeChatGPTState } from './services/chatgpt';
import type { ProjectSnapshot } from './services/project';
import { deferred, gateway, project, session } from './test/fixtures';

afterEach(cleanup);
describe('connected writing views', () => {
  it('puts contextual Back before the Project menu in the far-left header group', () => {
    render(<App gateway={gateway()} initialSession={session()}/>);
    fireEvent.click(screen.getByRole('button', { name: /^Arrival .*Open scene/ }));
    const identity = document.querySelector('.project-header-identity')!;
    expect(identity.firstElementChild).toBe(screen.getByRole('button', { name: 'Back to story' }));
    expect(document.querySelector('.breadcrumb button')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Characters' }));
    expect(identity.firstElementChild).toBe(screen.getByRole('button', { name: 'Return to Arrival' }));
    expect(screen.queryByRole('button', { name: 'Add starter emotions' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Add starter tones' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Return to Arrival' }));
    expect(screen.getByRole('textbox', { name: 'Scene summary' })).toBeVisible();
  });
  it('opens full global library destinations and returns to the same scene with unsaved text', async () => {
    const g = gateway(), saved = project(); saved.revision = 1; saved.scenes[0].summary = 'Keep my place.';
    vi.mocked(g.apply).mockResolvedValue(saved);
    render(<App gateway={g} initialSession={session()}/>);
    fireEvent.click(screen.getByRole('button', { name: /^Arrival .*Open scene/ }));
    const summary = screen.getByRole('textbox', { name: 'Scene summary' });
    setSummary(summary, 'Keep my place.');
    for (const name of ['Characters', 'Tones', 'Emotions']) {
      fireEvent.click(screen.getByRole('button', { name }));
      expect(screen.getByRole('heading', { name, level: 1 })).toBeVisible();
      expect(screen.getByRole('button', { name })).toHaveAttribute('aria-current', 'page');
    }
    fireEvent.click(screen.getByRole('button', { name: 'Scene' }));
    expect(screen.getByRole('textbox', { name: 'Scene summary' })).toBe(summary);
    expect(summary).toHaveTextContent('Keep my place.');
    expect(g.save).not.toHaveBeenCalled();
  });
  it('creates a tone in its full library and keeps it unsaved until project Save', async () => {
    const g = gateway(), created = project(); created.revision = 1;
    created.tones.push({ id: 'tone-new', name: 'Quiet', meaning: '', guidance: '', example: '', archived: false, revision: 0 });
    vi.mocked(g.apply).mockResolvedValue(created);
    render(<App gateway={g} initialSession={session()}/>);
    fireEvent.click(screen.getByRole('button', { name: 'Tones' }));
    fireEvent.click(screen.getAllByRole('button', { name: 'New tone' })[0]);
    fireEvent.change(screen.getByRole('textbox', { name: 'New tone name' }), { target: { value: 'Quiet' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create tone' }));
    expect(await screen.findByRole('textbox', { name: 'Tone name' })).toHaveValue('Quiet');
    expect(g.apply).toHaveBeenCalledWith('session-1', 0, { type: 'createPreset', kind: 'tone', name: 'Quiet' });
    expect(g.save).not.toHaveBeenCalled();
  });
  it('keeps prose and scene actions enabled across pending edits and saves with Ctrl+S', async () => {
    window.localStorage.clear();
    const g = gateway(), edit = deferred<ProjectSnapshot>();
    vi.mocked(g.apply).mockReturnValueOnce(edit.promise);
    render(<App gateway={g} initialSession={session()}/>);
    fireEvent.click(screen.getByRole('button', { name: /^Arrival .*Open scene/ }));
    fireEvent.click(screen.getByText('Scene prose', { selector: 'summary' }));
    const prose = screen.getByRole('textbox', { name: 'Scene prose' });
    prose.focus();
    fireEvent.change(prose, { target: { value: 'A thought worth keeping.' } });
    expect(prose).toBeEnabled(); expect(prose).toHaveFocus();
    expect(screen.getByRole('button', { name: 'Add beat' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Duplicate beat 1' })).toBeEnabled();
    expect(g.save).not.toHaveBeenCalled();
    const saved = project(); saved.revision = 1; saved.scenes[0].prose = 'A thought worth keeping.';
    vi.mocked(g.save).mockResolvedValueOnce(saved);
    await act(async () => { edit.resolve(saved); await edit.promise; });
    expect(screen.getByRole('textbox', { name: 'Scene prose' })).toBe(prose);
    fireEvent.keyDown(prose, { key: 's', ctrlKey: true });
    await waitFor(() => expect(screen.getByText('Saved locally')).toBeVisible());
    expect(g.save).toHaveBeenCalledWith('session-1');
  });
  it('defaults to manual save and remembers the optional autosave setting', () => {
    window.localStorage.clear();
    const first = render(<App gateway={gateway()}/>);
    fireEvent.click(screen.getByRole('button', { name: 'Open Settings' }));
    expect(screen.getByRole('checkbox', { name: /Autosave/ })).not.toBeChecked();
    fireEvent.click(screen.getByRole('checkbox', { name: /Autosave/ }));
    expect(localStorage.getItem('shorthand.autosave')).toBe('true');
    first.unmount();
    render(<App gateway={gateway()}/>);
    fireEvent.click(screen.getByRole('button', { name: 'Open Settings' }));
    expect(screen.getByRole('checkbox', { name: /Autosave/ })).toBeChecked();
    localStorage.removeItem('shorthand.autosave');
  });
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
    await waitFor(() => expect(scrollTo).toHaveBeenLastCalledWith(0, 0));
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
  it('shows the effective portable data folder and WebView2 status in Settings', async () => {
    const runtimeService = {
      desktop: true,
      info: vi.fn().mockResolvedValue({
        portable: true,
        dataDirectory: 'D:\\Apps\\Shorthand\\data',
        applicationVersion: '0.1.0',
        webview2Required: true,
        webview2RuntimeActive: true,
      }),
    };
    render(<App gateway={gateway()} runtimeService={runtimeService}/>);
    fireEvent.click(screen.getByRole('button', { name: 'Open Settings' }));

    expect(await screen.findByText('D:\\Apps\\Shorthand\\data')).toBeVisible();
    expect(screen.getByText('Portable folder')).toBeVisible();
    expect(screen.getByText('Active')).toBeVisible();
    expect(runtimeService.info).toHaveBeenCalledOnce();
  });
  it('migrates an existing dark preference to Platinum once, then remembers a new explicit choice', () => {
    window.localStorage.clear();
    window.localStorage.setItem('shorthand.appearance', 'dark');
    const firstLaunch = render(<App gateway={gateway()}/>);
    expect(document.querySelector('.app')).toHaveAttribute('data-theme', 'light');
    expect(window.localStorage.getItem('shorthand.appearance')).toBe('light');
    expect(window.localStorage.getItem('shorthand.appearance-default')).toBe('platinum-light-v3');

    fireEvent.click(screen.getByRole('button', { name: 'Open Settings' }));
    fireEvent.click(screen.getByRole('radio', { name: /Dark/ }));
    firstLaunch.unmount();
    render(<App gateway={gateway()}/>);
    expect(document.querySelector('.app')).toHaveAttribute('data-theme', 'dark');
  });
  it('upgrades installs that already recorded the previous default marker', () => {
    window.localStorage.clear();
    window.localStorage.setItem('shorthand.appearance', 'dark');
    window.localStorage.setItem('shorthand.appearance-default', 'platinum-light-v2');
    render(<App gateway={gateway()}/>);
    expect(document.querySelector('.app')).toHaveAttribute('data-theme', 'light');
    expect(window.localStorage.getItem('shorthand.appearance')).toBe('light');
    expect(window.localStorage.getItem('shorthand.appearance-default')).toBe('platinum-light-v3');
  });
  it('requires plan-use acknowledgement and a successful model test before showing ChatGPT as ready', async () => {
    const connected: NativeChatGPTState = {
      status: 'connected', account: 'writer@example.test', models: [{ slug: 'gpt-test', displayName: 'GPT Test' }],
      selectedModel: 'gpt-test', ready: false, usageAcknowledged: false, firstUsePending: true, reason: null, remoteRevocationConfirmed: null,
    };
    const acknowledged = { ...connected, usageAcknowledged: true, firstUsePending: false };
    const ready = { ...acknowledged, ready: true };
    const service: ChatGPTGateway = {
      desktop: true,
      connectionState: vi.fn().mockResolvedValue(connected),
      connect: vi.fn().mockResolvedValue(connected),
      acknowledgeUsage: vi.fn().mockResolvedValue(acknowledged),
      setModel: vi.fn().mockResolvedValue(connected),
      testConnection: vi.fn().mockResolvedValue(ready),
      disconnect: vi.fn().mockResolvedValue({ ...connected, status: 'disconnected', account: null, models: [], selectedModel: null }),
    };
    render(<App gateway={gateway()} initialSession={session()} chatGPTService={service}/>);
    fireEvent.click(screen.getByRole('button', { name: 'Open Settings' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Got it' }));
    await waitFor(() => expect(service.acknowledgeUsage).toHaveBeenCalledOnce());
    fireEvent.click(screen.getByRole('button', { name: 'Test connection' }));
    await waitFor(() => expect(service.testConnection).toHaveBeenCalledWith('gpt-test'));
    expect(await screen.findByText('Ready to write')).toBeVisible();
  });
  it('clearly requires the desktop app without inserting a sample manuscript', () => {
    render(<App gateway={gateway()}/>);
    expect(screen.getByText(/Desktop app required/)).toBeVisible();
    expect(screen.getByRole('button', { name: 'New project' })).toBeDisabled();
    expect(screen.getAllByRole('button', { name: 'Open project' }).every(button => (button as HTMLButtonElement).disabled)).toBe(true);
    expect(screen.queryByRole('navigation', { name: 'Writing view' })).toBeNull();
  });
  it('preserves rapid summary edits across navigation while a save is in flight', async () => {
    const g = gateway(), first = deferred<ProjectSnapshot>(), second = deferred<ProjectSnapshot>();
    vi.mocked(g.apply).mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    render(<App gateway={g} initialSession={session()}/>);
    fireEvent.click(screen.getByRole('button', { name: /^Arrival .*Open scene/ }));
    const summary = screen.getByRole('textbox', { name: 'Scene summary' });
    setSummary(summary, 'The beginning');
    setSummary(summary, 'The beginning of a difficult conversation.');
    fireEvent.click(screen.getByRole('button', { name: 'Back to story' }));
    expect(document.querySelector('.destination-view:not([hidden]) .scene-open p')).toHaveTextContent('The beginning of a difficult conversation.');
    expect(screen.getByText('Unsaved changes')).toBeVisible();
    const saved = project(); saved.revision = 1; saved.scenes[0].summary = 'The beginning';
    await act(async () => { first.resolve(saved); await first.promise; });
    expect(document.querySelector('.destination-view:not([hidden]) .scene-open p')).toHaveTextContent('The beginning of a difficult conversation.');
    const latest = structuredClone(saved); latest.revision = 2; latest.scenes[0].summary = 'The beginning of a difficult conversation.';
    await act(async () => { second.resolve(latest); await second.promise; });
    fireEvent.click(screen.getByRole('button', { name: /^Arrival .*Open scene/ }));
    expect(screen.getByRole('textbox', { name: 'Scene summary' })).toHaveTextContent(latest.scenes[0].summary);
    expect(g.apply).toHaveBeenNthCalledWith(2, 'session-1', 1, expect.objectContaining({ type: 'updateScene', sceneId: 'scene-1', summary: latest.scenes[0].summary, summaryDocument: expect.any(Object) }));
  });
  it('stages a valid title while focused and writes the project only on Save', async () => {
    const g = gateway(); const saved = project(); saved.revision = 1; saved.title = 'A changed title'; vi.mocked(g.apply).mockResolvedValueOnce(saved);
    render(<App gateway={g} initialSession={session()}/>);
    const title = screen.getByRole('textbox', { name: 'Project title' }); fireEvent.focus(title); fireEvent.change(title, { target: { value: 'A changed title' } });
    expect(g.apply).toHaveBeenCalledWith('session-1', 0, { type: 'renameProject', title: 'A changed title' });
    await waitFor(() => expect(screen.getByText('Unsaved changes')).toBeVisible());
    expect(g.save).not.toHaveBeenCalled();
    vi.mocked(g.save).mockResolvedValueOnce(saved);
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(screen.getByText('Saved locally')).toBeVisible());
  });
  it('keeps failed edits visible and makes recovery available', async () => {
    const g = gateway(); vi.mocked(g.apply).mockRejectedValueOnce(new Error('Read-only disk'));
    render(<App gateway={g} initialSession={session()}/>);
    fireEvent.click(screen.getByRole('button', { name: /^Arrival .*Open scene/ }));
    setSummary(screen.getByRole('textbox', { name: 'Scene summary' }), 'Unsaved but visible.');
    await screen.findByRole('alert'); expect(screen.getByRole('textbox', { name: 'Scene summary' })).toHaveTextContent('Unsaved but visible.');
    expect(screen.getByRole('button', { name: 'Add beat' })).toBeDisabled();
    const saved = project(); saved.revision = 1; saved.scenes[0].summary = 'Unsaved but visible.'; vi.mocked(g.apply).mockResolvedValueOnce(saved);
    fireEvent.click(screen.getByRole('button', { name: 'Retry save' })); await waitFor(() => expect(screen.queryByRole('alert')).toBeNull());
    expect(screen.getByRole('textbox', { name: 'Scene summary' })).toHaveTextContent('Unsaved but visible.');
  });
  it('uses a single native reorder operation from a visible keyboard-accessible move button', async () => {
    const g = gateway(); const saved = project(); saved.revision = 1; saved.chapters[0].sceneIds = ['scene-2','scene-1']; vi.mocked(g.apply).mockResolvedValueOnce(saved);
    render(<App gateway={g} initialSession={session()}/>);
    fireEvent.click(screen.getByRole('button', { name: 'Move Arrival down' }));
    await waitFor(() => expect(screen.getByText('Unsaved changes')).toBeVisible());
    expect(g.save).not.toHaveBeenCalled();
    vi.mocked(g.save).mockResolvedValueOnce(saved);
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
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
    fireEvent.click(screen.getByLabelText('Project menu')); fireEvent.click(screen.getByRole('button', { name: 'Trash (1)' })); fireEvent.click(screen.getByRole('button', { name: 'Restore' }));
    fireEvent.click(screen.getByRole('button', { name: 'Back to story' }));
    await waitFor(() => expect(screen.getByRole('button', { name: /^Arrival .*Open scene/ })).toBeVisible());
    expect(document.querySelector('[data-item-id="scene-1"]')).toBeTruthy();
    expect(g.apply).toHaveBeenNthCalledWith(2, 'session-1', 1, { type: 'restoreTrash', trashId: 'trash-1' });
  });
});
