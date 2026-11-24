import './test/dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import App from './App';
import { openLibrary } from './test/navigation';
import { gateway, project, session } from './test/fixtures';

const native = vi.hoisted(() => ({ closeHandler: undefined as undefined | ((event: { preventDefault(): void }) => Promise<void>), destroy: vi.fn(async () => {}), unlisten: vi.fn() }));
vi.mock('@tauri-apps/api/window', () => ({ getCurrentWindow: () => ({ destroy: native.destroy, onCloseRequested: vi.fn(async handler => { native.closeHandler = handler; return native.unlisten; }) }) }));
afterEach(() => { cleanup(); native.destroy.mockClear(); localStorage.clear(); });
describe('native close protection', () => {
  it('destroys the saved window after one close request', async () => {
    const g = gateway(); g.desktop = true;
    render(<App gateway={g} initialSession={session()}/>);
    const preventDefault = vi.fn();
    await act(async () => { await native.closeHandler!({ preventDefault }); });
    expect(preventDefault).toHaveBeenCalled(); expect(native.destroy).toHaveBeenCalledOnce();
  });
  it('offers Cancel or Save before closing a dirty project', async () => {
    const g = gateway(); g.desktop = true;
    const saved = project(); saved.revision = 1; saved.title = 'Changed';
    vi.mocked(g.apply).mockResolvedValue(saved); vi.mocked(g.save).mockResolvedValue(saved);
    render(<App gateway={g} initialSession={session()}/>);
    fireEvent.change(screen.getByRole('textbox', { name: 'Project title' }), { target: { value: 'Changed' } });
    await waitFor(() => expect(g.apply).toHaveBeenCalled());
    let closing!: Promise<void>;
    await act(async () => { closing = native.closeHandler!({ preventDefault: vi.fn() }); });
    expect(await screen.findByRole('dialog')).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    await act(async () => { await closing; });
    expect(native.destroy).not.toHaveBeenCalled();
    await act(async () => { closing = native.closeHandler!({ preventDefault: vi.fn() }); });
    fireEvent.click(await screen.findByRole('button', { name: 'Save and continue' }));
    await act(async () => { await closing; });
    expect(g.save).toHaveBeenCalledWith('session-1'); expect(native.destroy).toHaveBeenCalledOnce();
  });

  it('requires an explicit wizard draft decision before native close without saving the project', async () => {
    const g = gateway(); g.desktop = true;
    render(<App gateway={g} initialSession={session()}/>);
    openLibrary('Characters');
    fireEvent.click(screen.getByRole('button', { name: 'New character' }));
    fireEvent.click(screen.getByRole('button', { name: 'Start blank' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Character name' }), { target: { value: 'Rae' } });

    let closing!: Promise<void>;
    await act(async () => { closing = native.closeHandler!({ preventDefault: vi.fn() }); });
    expect(await screen.findByRole('dialog')).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Keep working' }));
    await act(async () => { await closing; });
    expect(native.destroy).not.toHaveBeenCalled();
    expect(screen.getByRole('textbox', { name: 'Character name' })).toHaveValue('Rae');

    await act(async () => { closing = native.closeHandler!({ preventDefault: vi.fn() }); });
    fireEvent.click(await screen.findByRole('button', { name: 'Discard draft' }));
    await act(async () => { await closing; });
    expect(native.destroy).toHaveBeenCalledOnce();
    expect(g.apply).not.toHaveBeenCalled();
    expect(g.save).not.toHaveBeenCalled();
  });
});
