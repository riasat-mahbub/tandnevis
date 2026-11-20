import type { Operation, ProjectGateway, ProjectSession, ProjectSnapshot } from './project';

type Write = { operation?: Operation; markdown?: string; path?: string; resolve: (project: ProjectSnapshot) => void; reject: (reason: Error) => void };
export interface WorkspaceState { session: ProjectSession | null; project: ProjectSnapshot | null; pending: number; error: string | null; ready: boolean; conflict: ProjectSnapshot | null }
const errorText = (error: unknown) => error instanceof Error ? error.message : String(error);

/** Pending edits are layered over each acknowledged snapshot, so a slow save can never replace newer typing. */
export function projectEdits(project: ProjectSnapshot, operations: Operation[]): ProjectSnapshot {
  const result = structuredClone(project);
  for (const op of operations) {
    if (op.type === 'renameProject') result.title = op.title;
    if (op.type === 'renameChapter') { const c = result.chapters.find(c => c.id === op.chapterId); if (c) c.title = op.title; }
    if (op.type === 'updateScene') { const s = result.scenes.find(s => s.id === op.sceneId); if (s) Object.assign(s, op); }
    if (op.type === 'updateBeat') { const b = result.scenes.flatMap(s => s.beats).find(b => b.id === op.beatId); if (b) { b.document = op.document; b.text = op.text; } }
    if (op.type === 'updateCharacter') { const c = result.characters.find(c => c.id === op.characterId); if (c) Object.assign(c, op); }
    if (op.type === 'reorderScenes') { const c = result.chapters.find(c => c.id === op.chapterId); if (c) c.sceneIds = op.ids; }
    if (op.type === 'reorderBeats') { const s = result.scenes.find(s => s.id === op.sceneId); if (s) s.beats.sort((a,b) => op.ids.indexOf(a.id) - op.ids.indexOf(b.id)); }
    if (op.type === 'reorderChapters') result.chapters.sort((a,b) => op.ids.indexOf(a.id) - op.ids.indexOf(b.id));
  }
  return result;
}
function editKey(op?: Operation) {
  if (op?.type === 'updateBeat') return `beat:${op.beatId}`;
  if (op?.type === 'updateScene') return `scene:${op.sceneId}`;
  if (op?.type === 'updateCharacter') return `character:${op.characterId}`;
  return null;
}
export class Workspace {
  private state: WorkspaceState = { session: null, project: null, pending: 0, error: null, ready: true, conflict: null };
  private listeners = new Set<() => void>();
  private writes: Write[] = [];
  private running = false;
  private recoveryGeneration = 0;
  constructor(readonly gateway: ProjectGateway) {}
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  getSnapshot = () => this.state;
  private publish(patch: Partial<WorkspaceState> = {}) {
    const session = patch.session ?? this.state.session;
    this.state = { ...this.state, ...patch, pending: this.writes.length, project: session ? projectEdits(session.project, this.writes.flatMap(w => w.operation ? [w.operation] : [])) : null };
    this.listeners.forEach(listener => listener());
  }
  async load(kind: 'create' | 'open', title = 'Untitled story') {
    if (!this.state.ready) throw new Error('A project is already opening.');
    this.recoveryGeneration++;
    this.publish({ ready: false, ...(!this.writes.length ? { error: null } : {}) });
    try {
    await this.flush();
    const path = await (kind === 'create' ? this.gateway.chooseCreate() : this.gateway.chooseOpen());
    if (!path) return;
    // Native dialogs are asynchronous. Reject new edits for the entire switch, including the dialog.
    await this.flush();
    this.publish({ session: await (kind === 'create' ? this.gateway.create(path, title) : this.gateway.open(path)), error: null, conflict: null });
    } catch (error) { this.publish({ error: errorText(error) }); throw error; }
    finally { this.publish({ ready: true }); }
  }
  /** Test gateways can attach an actual session without adding browser persistence. */
  attach(session: ProjectSession) { if (this.writes.length) throw new Error('Save pending edits before opening a project.'); this.publish({ session, error: null }); }
  dispatch(operation: Operation): Promise<ProjectSnapshot> { return this.enqueue({ operation }); }
  importMarkdown(markdown: string) { return this.enqueue({ markdown }); }
  importMarkdownFile(path: string) { return this.enqueue({ path }); }
  private enqueue(content: Pick<Write, 'operation' | 'markdown' | 'path'>): Promise<ProjectSnapshot> {
    if (!this.state.session) return Promise.reject(new Error('Open a desktop project first.'));
    if (!this.state.ready) return Promise.reject(new Error('Wait for the project dialog to close before editing.'));
    const promise = new Promise<ProjectSnapshot>((resolve, reject) => {
      const last = this.writes.at(-1);
      const key = editKey(content.operation);
      // Never modify the in-flight operation; coalesce only a waiting edit to the same entity.
      if (last && last !== (this.running ? this.writes[0] : null) && key && key === editKey(last.operation)) {
        last.operation = { ...last.operation, ...content.operation } as Operation;
        const previousResolve = last.resolve, previousReject = last.reject;
        last.resolve = p => { previousResolve(p); resolve(p); };
        last.reject = e => { previousReject(e); reject(e); };
      } else this.writes.push({ ...content, resolve, reject });
    });
    this.publish();
    void this.pump();
    return promise;
  }
  private async pump() {
    if (this.running || this.state.error || !this.state.session) return;
    this.running = true;
    while (this.writes.length && !this.state.error) {
      const write = this.writes[0];
      const session: ProjectSession = this.state.session!;
      try {
        const project = write.operation ? await this.gateway.apply(session.sessionId, session.project.revision, write.operation) : write.path ? await this.gateway.importMarkdownFile(session.sessionId, session.project.revision, write.path) : await this.gateway.importMarkdown(session.sessionId, session.project.revision, write.markdown!);
        if (this.state.session?.sessionId !== session.sessionId) throw new Error('The project session changed while saving. Your waiting edits have been retained.');
        this.writes.shift();
        this.publish({ session: { ...session, project } });
        write.resolve(project);
      } catch (error) {
        const message = errorText(error);
        this.publish({ error: message });
        this.writes.forEach(w => w.reject(new Error(message)));
      }
    }
    this.running = false;
    this.publish();
  }
  async flush() {
    while (this.running || this.writes.length) {
      if (this.state.error) throw new Error(this.state.error);
      await new Promise<void>(resolve => {
        const stop = this.subscribe(() => { stop(); resolve(); });
      });
    }
    if (this.state.error) throw new Error(this.state.error);
  }
  async retry() {
    if (!this.state.session) { this.publish({ error: null }); return; }
    const session: ProjectSession = this.state.session;
    const generation = ++this.recoveryGeneration;
    try {
      const project = await this.gateway.read(session.sessionId);
      if (generation !== this.recoveryGeneration || this.state.session?.sessionId !== session.sessionId || this.state.session.project.revision !== session.project.revision) return;
      if (this.writes.length && project.revision !== session.project.revision) {
        this.publish({ conflict: project, error: 'The saved project has a newer revision. A save may have completed before the connection failed. Waiting changes were not replayed. Review the saved version and keep a recovery copy before choosing it.' });
        return;
      }
      this.publish({ session: { ...session, project }, error: null });
      await this.pump();
    } catch (error) { if (generation === this.recoveryGeneration && this.state.session?.sessionId === session.sessionId) this.publish({ error: errorText(error) }); }
  }
  async exportMarkdown() { await this.flush(); return this.gateway.exportMarkdown(this.state.session!.sessionId); }
  acceptSavedVersion() {
    if (!this.state.conflict || !this.state.session) return;
    this.recoveryGeneration++;
    this.writes = [];
    this.publish({ session: { ...this.state.session, project: this.state.conflict }, conflict: null, error: null });
  }
}
export function moved(ids: string[], id: string, delta: number) {
  const from = ids.indexOf(id), to = from + delta;
  if (from < 0 || to < 0 || to >= ids.length) return ids;
  const next = [...ids]; next.splice(to, 0, next.splice(from, 1)[0]); return next;
}
