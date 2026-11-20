import type { GenerationBinding, GenerationEvent, GenerationGateway, GenerationJob, GenerationJobStatus } from './generation';

export type GenerationViewStatus = Exclude<GenerationJobStatus, 'pending'> | 'idle' | 'starting' | 'stopping';

export interface GenerationViewState {
  status: GenerationViewStatus;
  job: GenerationJob | null;
  binding: GenerationBinding | null;
  draftText: string;
  errorMessage?: string;
}

const idleState: GenerationViewState = { status: 'idle', job: null, binding: null, draftText: '' };
const isActive = (status: GenerationViewStatus) => status === 'starting' || status === 'streaming' || status === 'stopping';
const keyFor = (sessionId: string, sceneId: string) => `${sessionId}\u0000${sceneId}`;

function panelStatus(status: GenerationJobStatus): GenerationViewStatus {
  return status === 'pending' ? 'starting' : status;
}

function bindingFor(sessionId: string, job: GenerationJob): GenerationBinding {
  return { jobId: job.id, sessionId, sceneId: job.sceneId, model: job.model, connectionId: job.connectionId };
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Keeps native stream listeners alive as the writer moves between Story/Scene views. */
export class GenerationSession {
  private states = new Map<string, GenerationViewState>();
  private listeners = new Map<string, Set<() => void>>();
  private loading = new Set<string>();
  private stopRequested = new Set<string>();

  constructor(readonly gateway: GenerationGateway, private onNativeChange: () => void = () => {}) {}

  getState(sessionId: string, sceneId: string): GenerationViewState {
    return this.states.get(keyFor(sessionId, sceneId)) ?? idleState;
  }

  subscribe(sessionId: string, sceneId: string, listener: () => void): () => void {
    const key = keyFor(sessionId, sceneId);
    const set = this.listeners.get(key) ?? new Set<() => void>();
    set.add(listener);
    this.listeners.set(key, set);
    return () => {
      set.delete(listener);
      if (!set.size) this.listeners.delete(key);
    };
  }

  private publish(sessionId: string, sceneId: string, state: GenerationViewState) {
    const key = keyFor(sessionId, sceneId);
    this.states.set(key, state);
    this.listeners.get(key)?.forEach(listener => listener());
  }

  private waitForTerminal(sessionId: string, sceneId: string): Promise<void> {
    if (!isActive(this.getState(sessionId, sceneId).status)) return Promise.resolve();
    return new Promise((resolve, reject) => {
      let unsubscribe = () => {};
      const timeout = setTimeout(() => {
        unsubscribe();
        reject(new Error('The scene draft did not report that it stopped. Keep this project open and try Stop again.'));
      }, 45_000);
      const finish = () => {
        if (isActive(this.getState(sessionId, sceneId).status)) return;
        clearTimeout(timeout);
        unsubscribe();
        resolve();
      };
      unsubscribe = this.subscribe(sessionId, sceneId, finish);
      finish();
    });
  }

  async load(sessionId: string, sceneId: string): Promise<void> {
    const key = keyFor(sessionId, sceneId);
    const current = this.getState(sessionId, sceneId);
    if (!this.gateway.desktop || this.loading.has(key) || current.status !== 'idle' || isActive(current.status)) return;
    this.loading.add(key);
    try {
      const jobs = await this.gateway.list(sessionId, sceneId);
      if (this.states.has(key)) return;
      const job = jobs[0];
      if (!job) return;
      this.publish(sessionId, sceneId, {
        status: panelStatus(job.status),
        job,
        binding: bindingFor(sessionId, job),
        draftText: job.draftText,
        errorMessage: job.errorMessage ?? undefined,
      });
    } finally {
      this.loading.delete(key);
    }
  }

  async start(sessionId: string, sceneId: string, model: string, defaultGuidance: string): Promise<void> {
    const key = keyFor(sessionId, sceneId);
    const active = [...this.states.values()].find(state => isActive(state.status));
    if (active) throw new Error('A scene draft is already generating. Stop it or wait for it to finish.');
    if (!this.gateway.desktop) throw new Error('Scene generation requires the desktop app.');
    const initial: GenerationViewState = { status: 'starting', job: null, binding: null, draftText: '' };
    this.publish(sessionId, sceneId, initial);
    try {
      const job = await this.gateway.start(sessionId, sceneId, model, defaultGuidance, event => this.receive(event));
      const current = this.getState(sessionId, sceneId);
      if (current.binding?.jobId === job.id) {
        // A channel event may arrive before the invoke promise resolves. Preserve
        // its newer draft or terminal state and only fill in a missing job.
        this.publish(sessionId, sceneId, { ...current, job: current.job ?? job });
      } else {
        this.publish(sessionId, sceneId, {
          status: panelStatus(job.status), job, binding: bindingFor(sessionId, job),
          draftText: job.draftText, errorMessage: job.errorMessage ?? undefined,
        });
      }
      if (this.stopRequested.delete(key) && isActive(this.getState(sessionId, sceneId).status)) {
        void this.stop(sessionId, sceneId);
      }
    } catch (error) {
      this.stopRequested.delete(key);
      const current = this.getState(sessionId, sceneId);
      this.publish(sessionId, sceneId, { ...current, status: 'failed', errorMessage: messageOf(error) });
    }
  }

  private receive(event: GenerationEvent) {
    const { sessionId, sceneId } = event.binding;
    const current = this.getState(sessionId, sceneId);
    if (current.binding && current.binding.jobId !== event.binding.jobId) return;
    this.onNativeChange();
    if (event.type === 'textDelta') {
      const job = current.job ? { ...current.job, status: 'streaming' as const, draftText: event.draftText } : null;
      this.publish(sessionId, sceneId, { ...current, status: current.status === 'stopping' ? 'stopping' : 'streaming', job, binding: event.binding, draftText: event.draftText });
      return;
    }
    const incomingStatus: GenerationViewStatus = event.type === 'failed' ? 'failed' : panelStatus(event.job.status);
    const status: GenerationViewStatus = current.status === 'stopping' && isActive(incomingStatus) ? 'stopping' : incomingStatus;
    this.publish(sessionId, sceneId, {
      status,
      job: event.job,
      binding: event.binding,
      draftText: event.job.draftText,
      errorMessage: event.type === 'failed' ? event.error : event.job.errorMessage ?? undefined,
    });
  }

  async stop(sessionId: string, sceneId: string): Promise<void> {
    const current = this.getState(sessionId, sceneId);
    if (!current.job) {
      if (current.status !== 'starting' && current.status !== 'stopping') return;
      this.stopRequested.add(keyFor(sessionId, sceneId));
      this.publish(sessionId, sceneId, { ...current, status: 'stopping' });
      try { await this.waitForTerminal(sessionId, sceneId); } catch (error) {
        const latest = this.getState(sessionId, sceneId);
        if (latest.status === 'stopping') this.publish(sessionId, sceneId, { ...latest, status: 'failed', errorMessage: messageOf(error) });
      }
      return;
    }
    if (!isActive(current.status)) return;
    this.publish(sessionId, sceneId, { ...current, status: 'stopping', errorMessage: undefined });
    try {
      const job = await this.gateway.stop(sessionId, current.job.id);
      const latest = this.getState(sessionId, sceneId);
      if (latest.binding?.jobId !== job.id || !isActive(latest.status)) return;
      if (!isActive(panelStatus(job.status))) {
        this.publish(sessionId, sceneId, { ...latest, status: panelStatus(job.status), job, draftText: job.draftText, errorMessage: job.errorMessage ?? undefined });
      }
      await this.waitForTerminal(sessionId, sceneId);
    } catch (error) {
      const latest = this.getState(sessionId, sceneId);
      if (latest.binding?.jobId === current.job.id && latest.status === 'stopping') {
        this.publish(sessionId, sceneId, {
          ...latest,
          status: latest.job?.status === 'pending' ? 'starting' : 'streaming',
          errorMessage: messageOf(error),
        });
      }
    }
  }

  async stopSession(sessionId: string): Promise<void> {
    const prefix = `${sessionId}\u0000`;
    const scenes = [...this.states.entries()]
      .filter(([key, state]) => key.startsWith(prefix) && isActive(state.status))
      .map(([key]) => key.slice(prefix.length));
    for (const sceneId of scenes) {
      await this.stop(sessionId, sceneId);
      const latest = this.getState(sessionId, sceneId);
      if (isActive(latest.status)) throw new Error(latest.errorMessage ?? 'Stop the current scene draft before switching projects.');
    }
  }

  hasActiveSession(sessionId: string): boolean {
    const prefix = `${sessionId}\u0000`;
    return [...this.states.entries()].some(([key, state]) => key.startsWith(prefix) && isActive(state.status));
  }

  async discard(sessionId: string, sceneId: string): Promise<void> {
    const current = this.getState(sessionId, sceneId);
    if (!current.job) return;
    const job = await this.gateway.discard(sessionId, sceneId, current.job.id, current.job.model, current.job.connectionId);
    this.onNativeChange();
    this.publish(sessionId, sceneId, { status: panelStatus(job.status), job, binding: bindingFor(sessionId, job), draftText: job.draftText, errorMessage: job.errorMessage ?? undefined });
  }

  markAccepted(sessionId: string, sceneId: string) {
    const current = this.getState(sessionId, sceneId);
    if (!current.job) return;
    const job = { ...current.job, status: 'accepted' as const };
    this.publish(sessionId, sceneId, { ...current, status: 'accepted', job });
  }

  failBeforeStart(sessionId: string, sceneId: string, error: unknown) {
    const current = this.getState(sessionId, sceneId);
    this.publish(sessionId, sceneId, { ...current, status: 'failed', errorMessage: messageOf(error) });
  }
}
