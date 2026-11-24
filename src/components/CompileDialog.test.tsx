import '../test/dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { useState } from 'react';
import CompileDialog from './CompileDialog';
import { defaultCompileOptions } from '../services/compile';
import type { CompileExportGateway } from '../services/compile-export';
import type { ProjectSnapshot, ProjectSession } from '../services/project';
import { Workspace } from '../services/workspace';
import { deferred, gateway, project, session } from '../test/fixtures';

afterEach(cleanup);

function compileGateway(overrides: Partial<CompileExportGateway> = {}): CompileExportGateway {
  return {
    desktop: true,
    choosePath: vi.fn(async () => 'C:\\Books\\A quiet story.md'),
    writeFile: vi.fn(async () => {}),
    ...overrides,
  };
}

function DialogHarness({ workspace, exportGateway = compileGateway(), onClose = vi.fn(), onRecover = vi.fn() }: {
  workspace: Workspace;
  exportGateway?: CompileExportGateway;
  onClose?: () => void;
  onRecover?: () => void;
}) {
  const [options, setOptions] = useState(() => defaultCompileOptions(workspace.getSnapshot().project!));
  const sessionId = workspace.getSnapshot().session!.sessionId;
  return <CompileDialog sessionId={sessionId} workspace={workspace} options={options} onOptionsChange={setOptions} exportGateway={exportGateway} onClose={onClose} onRecover={onRecover}/>;
}

function attachWorkspace(snapshot = project(), gatewayOverride = gateway(snapshot)) {
  if (!snapshot.scenes[0].prose) snapshot.scenes[0].prose = 'Some authored prose.';
  const workspace = new Workspace(gatewayOverride);
  workspace.attach(session(snapshot));
  return { workspace, projectGateway: gatewayOverride };
}

async function readyPreview() {
  await waitFor(() => expect(screen.getByRole('button', { name: /^Export/ })).toBeEnabled());
  return screen.getByRole('region', { name: 'Manuscript preview' });
}

describe('CompileDialog', () => {
  it('flushes queued prose into its preview without saving the project', async () => {
    const initial = project();
    const updated = structuredClone(initial); updated.revision = 1; updated.scenes[0].prose = 'Latest words still waiting to save.';
    const g = gateway(initial), applying = deferred<ProjectSnapshot>();
    vi.mocked(g.apply).mockReturnValue(applying.promise);
    const { workspace } = attachWorkspace(initial, g);
    let queued!: Promise<ProjectSnapshot>;
    act(() => { queued = workspace.dispatch({ type: 'updateScene', sceneId: 'scene-1', prose: updated.scenes[0].prose }); });
    expect(g.apply).toHaveBeenCalledOnce();

    render(<DialogHarness workspace={workspace}/>);
    expect(screen.getByRole('dialog', { name: 'Compile Book' })).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('Preparing manuscript preview');
    await act(async () => { applying.resolve(updated); await queued; });

    const preview = await readyPreview();
    expect(within(preview).getByText(updated.scenes[0].prose)).toBeInTheDocument();
    expect(g.save).not.toHaveBeenCalled();
  });

  it('renders prose as literal text and excludes summaries, beats, and an unaccepted draft', async () => {
    const snapshot = project();
    const prose = '<script>bad()</script> & **snow** ☃\nSecond paragraph.';
    snapshot.scenes[0].prose = prose;
    snapshot.scenes[0].summary = 'SUMMARY_ONLY';
    snapshot.scenes[0].beats[0].text = 'BEAT_ONLY';
    (snapshot.scenes[0] as typeof snapshot.scenes[number] & { unacceptedDraft?: string }).unacceptedDraft = 'UNACCEPTED_DRAFT';
    const { workspace } = attachWorkspace(snapshot);
    render(<DialogHarness workspace={workspace}/>);

    const preview = await readyPreview();
    expect(preview.querySelector('.manuscript-prose')?.textContent).toBe(prose);
    expect(preview.querySelector('script')).toBeNull();
    expect(preview).not.toHaveTextContent('SUMMARY_ONLY');
    expect(preview).not.toHaveTextContent('BEAT_ONLY');
    expect(preview).not.toHaveTextContent('UNACCEPTED_DRAFT');
  });

  it('exports the preview prose and excludes planning text', async () => {
    const snapshot = project();
    snapshot.scenes[0].prose = 'Only the authored sentence.';
    snapshot.scenes[0].summary = 'SUMMARY_ONLY';
    snapshot.scenes[0].beats[0].text = 'BEAT_ONLY';
    (snapshot.scenes[0] as typeof snapshot.scenes[number] & { unacceptedDraft?: string }).unacceptedDraft = 'UNACCEPTED_DRAFT';
    const { workspace, projectGateway } = attachWorkspace(snapshot);
    const output = compileGateway();
    render(<DialogHarness workspace={workspace} exportGateway={output}/>);
    const preview = await readyPreview();
    expect(preview).toHaveTextContent('Only the authored sentence.');

    fireEvent.change(screen.getByLabelText('File type'), { target: { value: 'txt' } });
    fireEvent.click(screen.getByRole('button', { name: 'Export TXT' }));
    await waitFor(() => expect(output.writeFile).toHaveBeenCalledOnce());
    const [, contents] = vi.mocked(output.writeFile).mock.calls[0];
    expect(contents).toContain('Only the authored sentence.');
    expect(contents).not.toContain('SUMMARY_ONLY');
    expect(contents).not.toContain('BEAT_ONLY');
    expect(contents).not.toContain('UNACCEPTED_DRAFT');
    expect(projectGateway.save).not.toHaveBeenCalled();
  });

  it('treats chooser cancellation as silent and performs no write', async () => {
    const { workspace } = attachWorkspace();
    const output = compileGateway({ choosePath: vi.fn(async () => null) });
    render(<DialogHarness workspace={workspace} exportGateway={output}/>);
    await readyPreview();

    fireEvent.click(screen.getByRole('button', { name: 'Export MD' }));
    await waitFor(() => expect(output.choosePath).toHaveBeenCalledOnce());
    expect(output.writeFile).not.toHaveBeenCalled();
    expect(screen.queryByRole('status', { name: /Exported manuscript/ })).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('keeps the dialog open after a write failure and allows retry', async () => {
    const { workspace } = attachWorkspace();
    const output = compileGateway({ writeFile: vi.fn().mockRejectedValueOnce(new Error('Disk is full.')).mockResolvedValueOnce(undefined) });
    render(<DialogHarness workspace={workspace} exportGateway={output}/>);
    await readyPreview();

    fireEvent.click(screen.getByRole('button', { name: 'Export MD' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Disk is full.');
    expect(screen.getByRole('dialog', { name: 'Compile Book' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Export MD' }));

    await waitFor(() => expect(output.writeFile).toHaveBeenCalledTimes(2));
    expect(screen.getByText(/Exported manuscript to/)).toHaveTextContent('C:\\Books\\A quiet story.md');
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('marks a snapshot stale after an edit and refreshes from the acknowledged project', async () => {
    const initial = project(); initial.scenes[0].prose = 'Old passage.';
    const updated = structuredClone(initial); updated.revision = 1; updated.scenes[0].prose = 'Refreshed passage.';
    const g = gateway(initial); vi.mocked(g.apply).mockResolvedValue(updated);
    const { workspace } = attachWorkspace(initial, g);
    const output = compileGateway();
    render(<DialogHarness workspace={workspace} exportGateway={output}/>);
    const preview = await readyPreview();
    expect(preview).toHaveTextContent('Old passage.');

    await act(async () => { await workspace.dispatch({ type: 'updateScene', sceneId: 'scene-1', prose: updated.scenes[0].prose }); });
    expect(screen.getByRole('status')).toHaveTextContent('Your writing has changed since this preview');
    expect(screen.getByRole('button', { name: 'Export MD' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Refresh preview' }));

    await waitFor(() => expect(preview).toHaveTextContent('Refreshed passage.'));
    expect(screen.queryByText('Your writing has changed since this preview')).toBeNull();
    expect(output.writeFile).not.toHaveBeenCalled();
  });

  it('cancels a pending export when manuscript content changes during the chooser', async () => {
    const initial = project(); initial.scenes[0].prose = 'Before chooser.';
    const updated = structuredClone(initial); updated.revision = 1; updated.scenes[0].prose = 'Changed during chooser.';
    const g = gateway(initial); vi.mocked(g.apply).mockResolvedValue(updated);
    const { workspace } = attachWorkspace(initial, g);
    const path = deferred<string | null>();
    const output = compileGateway({ choosePath: vi.fn(() => path.promise) });
    render(<DialogHarness workspace={workspace} exportGateway={output}/>);
    await readyPreview();
    fireEvent.click(screen.getByRole('button', { name: 'Export MD' }));
    await waitFor(() => expect(output.choosePath).toHaveBeenCalledOnce());

    await act(async () => { await workspace.dispatch({ type: 'updateScene', sceneId: 'scene-1', prose: updated.scenes[0].prose }); });
    await act(async () => { path.resolve('C:\\Books\\A quiet story.md'); });

    expect(await screen.findByRole('alert')).toHaveTextContent('manuscript changed while choosing a file');
    expect(output.writeFile).not.toHaveBeenCalled();
  });

  it('cancels a pending export if the project session changes during the chooser', async () => {
    const { workspace } = attachWorkspace();
    const path = deferred<string | null>();
    const output = compileGateway({ choosePath: vi.fn(() => path.promise) });
    render(<DialogHarness workspace={workspace} exportGateway={output}/>);
    await readyPreview();
    fireEvent.click(screen.getByRole('button', { name: 'Export MD' }));
    await waitFor(() => expect(output.choosePath).toHaveBeenCalledOnce());

    const other = project(); other.title = 'Another story';
    act(() => { workspace.attach({ sessionId: 'session-2', project: other } satisfies ProjectSession); });
    await act(async () => { path.resolve('C:\\Books\\Another story.md'); });

    expect(await screen.findByRole('alert')).toHaveTextContent('project changed while choosing a file');
    expect(output.writeFile).not.toHaveBeenCalled();
  });

  it('rejects a session change that happens while the opening flush is pending', async () => {
    const original = project();
    const next = project(); next.title = 'New session';
    const flush = deferred<void>();
    let state = { session: session(original), project: original, pending: 0, dirty: false, saving: false, error: null, ready: true, conflict: null };
    const listeners = new Set<() => void>();
    const mockedWorkspace = {
      subscribe: (listener: () => void) => { listeners.add(listener); return () => listeners.delete(listener); },
      getSnapshot: () => state,
      flush: vi.fn(() => flush.promise),
    } as unknown as Workspace;
    const output = compileGateway();
    render(<DialogHarness workspace={mockedWorkspace} exportGateway={output}/>);
    await waitFor(() => expect(mockedWorkspace.flush).toHaveBeenCalledOnce());

    state = { ...state, session: { sessionId: 'session-2', project: next }, project: next };
    act(() => listeners.forEach(listener => listener()));
    await act(async () => { flush.resolve(); await flush.promise; });

    expect(await screen.findByRole('alert')).toHaveTextContent('project changed. Close compilation and open it again');
    expect(screen.getByRole('button', { name: 'Refresh preview' })).toBeInTheDocument();
    expect(output.choosePath).not.toHaveBeenCalled();
  });
});
