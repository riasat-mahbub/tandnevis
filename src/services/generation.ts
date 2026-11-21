import { Channel, invoke, isTauri } from '@tauri-apps/api/core';
import type { ProjectSnapshot } from './project';

export type GenerationJobStatus = 'pending' | 'streaming' | 'completed' | 'stopped' | 'failed' | 'interrupted' | 'accepted' | 'discarded';
export type GenerationPurpose = 'prose' | 'beats';

export interface GenerationRequestSnapshot {
  schemaVersion: number;
  /** Older saved requests are prose drafts. */
  purpose?: GenerationPurpose;
  connectionId: string;
  model: string;
  defaultGuidance: string;
  baseProse: string;
  context: unknown;
  request: unknown;
}

export interface GenerationJob {
  id: string;
  sceneId: string;
  sceneRevision: number;
  connectionId: string;
  model: string;
  requestSnapshot: GenerationRequestSnapshot;
  inputFingerprint: string;
  status: GenerationJobStatus;
  draftText: string;
  errorMessage: string | null;
  createdAtMs: number;
  updatedAtMs: number;
}

export interface GenerationBinding {
  jobId: string;
  sessionId: string;
  sceneId: string;
  model: string;
  connectionId: string;
}

export type GenerationEvent =
  | { type: 'started'; binding: GenerationBinding; job: GenerationJob }
  | { type: 'textDelta'; binding: GenerationBinding; delta: string; draftText: string }
  | { type: 'checkpoint'; binding: GenerationBinding; job: GenerationJob }
  | { type: 'completed' | 'stopped'; binding: GenerationBinding; job: GenerationJob }
  | { type: 'failed'; binding: GenerationBinding; job: GenerationJob; error: string };

export interface GenerationGateway {
  desktop: boolean;
  start(sessionId: string, sceneId: string, model: string, defaultGuidance: string, onEvent: (event: GenerationEvent) => void, purpose?: GenerationPurpose): Promise<GenerationJob>;
  stop(sessionId: string, jobId: string): Promise<GenerationJob>;
  list(sessionId: string, sceneId: string): Promise<GenerationJob[]>;
  accept(sessionId: string, sceneId: string, jobId: string, expectedProjectRevision: number, model: string, connectionId: string, acknowledgeOutdated: boolean): Promise<ProjectSnapshot>;
  discard(sessionId: string, sceneId: string, jobId: string, model: string, connectionId: string): Promise<GenerationJob>;
}

export const desktopGenerationGateway: GenerationGateway = {
  desktop: isTauri(),
  start(sessionId, sceneId, model, defaultGuidance, onEvent, purpose = 'prose') {
    const onEventChannel = new Channel<GenerationEvent>(onEvent);
    return invoke('start_scene_generation', { sessionId, sceneId, model, defaultGuidance, purpose, onEvent: onEventChannel });
  },
  stop: (sessionId, jobId) => invoke('stop_scene_generation', { sessionId, jobId }),
  list: (sessionId, sceneId) => invoke('scene_generation_jobs', { sessionId, sceneId }),
  accept: (sessionId, sceneId, jobId, expectedProjectRevision, model, connectionId, acknowledgeOutdated) => invoke('accept_scene_generation', {
    sessionId, sceneId, jobId, expectedProjectRevision, model, connectionId, acknowledgeOutdated,
  }),
  discard: (sessionId, sceneId, jobId, model, connectionId) => invoke('discard_scene_generation', {
    sessionId, sceneId, jobId, model, connectionId,
  }),
};
