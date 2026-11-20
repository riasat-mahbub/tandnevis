import { describe, expect, it, vi } from 'vitest';
import { Workspace, moved } from './workspace';
import type { ProjectSession, ProjectSnapshot } from './project';
import { deferred, gateway, project, session } from '../test/fixtures';

describe('revisioned authoring queue', () => {
  it('keeps newer typing visible across slow acknowledgements and coalesces waiting edits', async () => {
    const g = gateway(), first = deferred<ProjectSnapshot>(), second = deferred<ProjectSnapshot>();
    vi.mocked(g.apply).mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    const w = new Workspace(g); w.attach(session());
    const a = w.dispatch({ type: 'updateScene', sceneId: 'scene-1', summary: 'A' });
    const b = w.dispatch({ type: 'updateScene', sceneId: 'scene-1', summary: 'A longer idea' });
    const c = w.dispatch({ type: 'updateScene', sceneId: 'scene-1', tone: 'Wistful' });
    expect(w.getSnapshot().project!.scenes[0]).toMatchObject({ summary: 'A longer idea', tone: 'Wistful' });
    const saved = project(); saved.revision = 1; saved.scenes[0].summary = 'A'; first.resolve(saved); await a;
    expect(w.getSnapshot().project!.scenes[0].summary).toBe('A longer idea');
    expect(g.apply).toHaveBeenNthCalledWith(2, 'session-1', 1, { type: 'updateScene', sceneId: 'scene-1', summary: 'A longer idea', tone: 'Wistful' });
    const latest = structuredClone(saved); latest.revision = 2; latest.scenes[0].summary = 'A longer idea'; latest.scenes[0].tone = 'Wistful'; second.resolve(latest);
    await Promise.all([b,c,w.flush()]);
    expect(w.getSnapshot().pending).toBe(0);
    expect(w.getSnapshot().project!.scenes[0]).toMatchObject({ summary: 'A longer idea', tone: 'Wistful' });
  });
  it('orders edits before delete and keeps the current revision for each operation', async () => {
    const g = gateway(), first = deferred<ProjectSnapshot>();
    const saved = project(); saved.revision = 1; saved.scenes[0].summary = 'The complete thought';
    const deleted = structuredClone(saved); deleted.revision = 2; deleted.chapters[0].sceneIds = ['scene-2']; deleted.scenes.shift();
    vi.mocked(g.apply).mockReturnValueOnce(first.promise).mockResolvedValueOnce(deleted);
    const w = new Workspace(g); w.attach(session());
    const edit = w.dispatch({ type: 'updateScene', sceneId: 'scene-1', summary: 'The complete thought' });
    const remove = w.dispatch({ type: 'deleteScene', sceneId: 'scene-1' });
    expect(g.apply).toHaveBeenCalledTimes(1); first.resolve(saved); await edit; await remove;
    await w.flush();
    expect(g.apply).toHaveBeenNthCalledWith(2, 'session-1', 1, { type: 'deleteScene', sceneId: 'scene-1' });
    expect(w.getSnapshot().project!.scenes.map(s => s.id)).toEqual(['scene-2']);
  });
  it('retains an unsaved edit after failure and safely retries an unchanged database', async () => {
    const g = gateway(); vi.mocked(g.apply).mockRejectedValueOnce(new Error('Disk is full'));
    const w = new Workspace(g); w.attach(session());
    await expect(w.dispatch({ type: 'updateScene', sceneId: 'scene-1', summary: 'Keep this thought' })).rejects.toThrow('Disk is full');
    expect(w.getSnapshot().project!.scenes[0].summary).toBe('Keep this thought');
    expect(w.getSnapshot().pending).toBe(1); await expect(w.flush()).rejects.toThrow('Disk is full');
    const saved = project(); saved.revision = 1; saved.scenes[0].summary = 'Keep this thought'; vi.mocked(g.apply).mockResolvedValueOnce(saved);
    await w.retry(); await w.flush();
    expect(w.getSnapshot().error).toBeNull(); expect(w.getSnapshot().pending).toBe(0);
  });
  it('never blindly replays a create after a possibly committed transport failure', async () => {
    const g = gateway(); vi.mocked(g.apply).mockRejectedValueOnce('IPC connection interrupted');
    const w = new Workspace(g); w.attach(session());
    await expect(w.dispatch({ type: 'createChapter', title: 'A second chapter' })).rejects.toThrow();
    const saved = project(); saved.revision = 1; saved.chapters.push({ id: 'chapter-2', title: 'A second chapter', sceneIds: [] }); vi.mocked(g.read).mockResolvedValue(saved);
    await w.retry();
    expect(g.apply).toHaveBeenCalledTimes(1); expect(w.getSnapshot().conflict).toEqual(saved);
    expect(w.getSnapshot().pending).toBe(1); w.acceptSavedVersion();
    expect(w.getSnapshot().pending).toBe(0); expect(w.getSnapshot().project!.chapters).toHaveLength(2);
  });
  it('locks editing before the async file dialog and drains old edits before replacing a session', async () => {
    const g = gateway(), save = deferred<ProjectSnapshot>(), dialog = deferred<string | null>();
    vi.mocked(g.apply).mockReturnValueOnce(save.promise); vi.mocked(g.chooseOpen).mockReturnValueOnce(dialog.promise);
    const other = session(); other.sessionId = 'session-2'; other.project.projectId = 'project-2'; vi.mocked(g.open).mockResolvedValueOnce(other);
    const w = new Workspace(g); w.attach(session());
    const edit = w.dispatch({ type: 'updateScene', sceneId: 'scene-1', tone: 'Tender' });
    const opening = w.load('open'); expect(w.getSnapshot().ready).toBe(false);
    await expect(w.dispatch({ type: 'renameProject', title: 'Wrong window' })).rejects.toThrow('dialog');
    const saved = project(); saved.revision = 1; saved.scenes[0].tone = 'Tender'; save.resolve(saved); await edit;
    await vi.waitFor(() => expect(g.chooseOpen).toHaveBeenCalled()); expect(g.open).not.toHaveBeenCalled();
    dialog.resolve('/other.shorthand'); await opening;
    expect(w.getSnapshot().session!.sessionId).toBe('session-2'); expect(w.getSnapshot().project!.projectId).toBe('project-2');
  });
  it('ignores an obsolete retry response after accepting recovery and opening another project', async () => {
    const g = gateway(); vi.mocked(g.apply).mockRejectedValueOnce('connection failed');
    const w = new Workspace(g); w.attach(session());
    await expect(w.dispatch({ type: 'createChapter', title: 'Waiting' })).rejects.toThrow();
    const conflict = project(); conflict.revision = 1; vi.mocked(g.read).mockResolvedValueOnce(conflict);
    await w.retry();
    const delayed = deferred<ProjectSnapshot>(); vi.mocked(g.read).mockReturnValueOnce(delayed.promise);
    const lateRetry = w.retry(); w.acceptSavedVersion();
    const other: ProjectSession = { sessionId: 'session-B', project: { ...project(), projectId: 'project-B', title: 'Other story' } };
    vi.mocked(g.open).mockResolvedValueOnce(other); await w.load('open'); delayed.resolve(conflict); await lateRetry;
    expect(w.getSnapshot().session!.sessionId).toBe('session-B'); expect(w.getSnapshot().project!.title).toBe('Other story');
  });
  it('allows a different project after a failed open without requiring a dummy save retry', async () => {
    const g = gateway(); vi.mocked(g.open).mockRejectedValueOnce('Invalid project').mockResolvedValueOnce(session());
    const w = new Workspace(g); await expect(w.load('open')).rejects.toBe('Invalid project'); await w.load('open');
    expect(w.getSnapshot().project!.title).toBe('A quiet story'); expect(w.getSnapshot().error).toBeNull();
  });
});

it('keyboard movement preserves identity and refuses out-of-range moves', () => {
  const ids = ['a','b','c']; expect(moved(ids, 'a', 1)).toEqual(['b','a','c']); expect(moved(ids, 'c', 1)).toBe(ids); expect(ids).toEqual(['a','b','c']);
});
