import { describe, expect, it, vi } from 'vitest';
import type { GenerationBinding, GenerationEvent, GenerationGateway, GenerationJob } from './generation';
import { GenerationSession } from './generation-session';

const binding: GenerationBinding = {
  jobId: 'job-1', sessionId: 'session-1', sceneId: 'scene-1', model: 'gpt-test', connectionId: 'connection-1',
};

function job(overrides: Partial<GenerationJob> = {}): GenerationJob {
  return {
    id: binding.jobId,
    sceneId: binding.sceneId,
    sceneRevision: 4,
    connectionId: binding.connectionId,
    model: binding.model,
    requestSnapshot: { schemaVersion: 1, connectionId: binding.connectionId, model: binding.model, defaultGuidance: '', baseProse: '', context: {}, request: {} },
    inputFingerprint: 'fingerprint-1',
    status: 'completed',
    draftText: 'A saved scene draft.',
    errorMessage: null,
    createdAtMs: 1,
    updatedAtMs: 2,
    ...overrides,
  };
}

function fakeGateway(overrides: Partial<GenerationGateway> = {}): GenerationGateway {
  return {
    desktop: true,
    start: vi.fn(async () => job({ status: 'pending', draftText: '' })),
    stop: vi.fn(async () => job({ status: 'streaming' })),
    list: vi.fn(async () => []),
    accept: vi.fn(async () => { throw new Error('Not used'); }),
    discard: vi.fn(async () => job({ status: 'discarded' })),
    ...overrides,
  };
}

describe('GenerationSession', () => {
  it('recovers a persisted draft and publishes state to scene subscribers', async () => {
    const gateway = fakeGateway({ list: vi.fn(async () => [job()]) });
    const session = new GenerationSession(gateway);
    const listener = vi.fn();
    session.subscribe('session-1', 'scene-1', listener);

    await session.load('session-1', 'scene-1');

    expect(session.getState('session-1', 'scene-1')).toMatchObject({ status: 'completed', draftText: 'A saved scene draft.' });
    expect(session.getState('session-1', 'scene-1').binding).toEqual(binding);
    expect(listener).toHaveBeenCalledOnce();
    await session.load('session-1', 'scene-1');
    expect(gateway.list).toHaveBeenCalledOnce();
  });

  it('keeps the native channel state when events arrive before start resolves', async () => {
    let sendEvent!: (event: GenerationEvent) => void;
    const streaming = job({ status: 'streaming', draftText: 'Maya begins.' });
    const gateway = fakeGateway({
      start: vi.fn(async (_sessionId, _sceneId, _model, _guidance, onEvent) => {
        sendEvent = onEvent;
        sendEvent({ type: 'started', binding, job: job({ status: 'pending', draftText: '' }) });
        sendEvent({ type: 'textDelta', binding, delta: 'Maya begins.', draftText: 'Maya begins.' });
        return streaming;
      }),
    });
    const session = new GenerationSession(gateway);

    await session.start('session-1', 'scene-1', 'gpt-test', '');

    expect(session.getState('session-1', 'scene-1')).toMatchObject({ status: 'streaming', draftText: 'Maya begins.', job: streaming });
    sendEvent({ type: 'completed', binding, job: job({ status: 'completed', draftText: 'Maya begins.' }) });
    expect(session.getState('session-1', 'scene-1').status).toBe('completed');
  });

  it('blocks a second scene while one scene is active', async () => {
    const gateway = fakeGateway({ start: vi.fn(async () => job({ status: 'streaming', draftText: '' })) });
    const session = new GenerationSession(gateway);
    await session.start('session-1', 'scene-1', 'gpt-test', '');

    await expect(session.start('session-1', 'scene-2', 'gpt-test', '')).rejects.toThrow('already generating');
    expect(gateway.start).toHaveBeenCalledOnce();
  });

  it('carries an immediate Stop click through the Starting window', async () => {
    let sendEvent!: (event: GenerationEvent) => void;
    let resolveStart!: (value: GenerationJob) => void;
    const gateway = fakeGateway({
      start: vi.fn((_sessionId, _sceneId, _model, _guidance, onEvent) => {
        sendEvent = onEvent;
        return new Promise<GenerationJob>(resolve => { resolveStart = resolve; });
      }),
      stop: vi.fn(async () => job({ status: 'streaming', draftText: '' })),
    });
    const session = new GenerationSession(gateway);

    const starting = session.start('session-1', 'scene-1', 'gpt-test', '');
    const stopping = session.stop('session-1', 'scene-1');
    expect(session.getState('session-1', 'scene-1').status).toBe('stopping');
    sendEvent({ type: 'started', binding, job: job({ status: 'pending', draftText: '' }) });
    resolveStart(job({ status: 'streaming', draftText: '' }));
    await vi.waitFor(() => expect(gateway.stop).toHaveBeenCalledOnce());
    sendEvent({ type: 'stopped', binding, job: job({ status: 'stopped', draftText: '' }) });
    await Promise.all([starting, stopping]);

    expect(session.getState('session-1', 'scene-1').status).toBe('stopped');
  });

  it('does not replace a terminal event with a stale stop response', async () => {
    let sendEvent!: (event: GenerationEvent) => void;
    let resolveStop!: (value: GenerationJob) => void;
    const gateway = fakeGateway({
      start: vi.fn(async (_sessionId, _sceneId, _model, _guidance, onEvent) => {
        sendEvent = onEvent;
        sendEvent({ type: 'started', binding, job: job({ status: 'pending', draftText: '' }) });
        return job({ status: 'streaming', draftText: '' });
      }),
      stop: vi.fn(() => new Promise<GenerationJob>(resolve => { resolveStop = resolve; })),
    });
    const session = new GenerationSession(gateway);
    await session.start('session-1', 'scene-1', 'gpt-test', '');

    const stopping = session.stop('session-1', 'scene-1');
    sendEvent({ type: 'completed', binding, job: job({ status: 'completed' }) });
    resolveStop(job({ status: 'streaming', draftText: '' }));
    await stopping;

    expect(session.getState('session-1', 'scene-1').status).toBe('completed');
    expect(session.getState('session-1', 'scene-1').draftText).toBe('A saved scene draft.');
  });

  it('stops all active scenes before the project session changes', async () => {
    let sendEvent!: (event: GenerationEvent) => void;
    const gateway = fakeGateway({
      start: vi.fn(async (_sessionId, _sceneId, _model, _guidance, onEvent) => {
        sendEvent = onEvent;
        sendEvent({ type: 'started', binding, job: job({ status: 'pending', draftText: '' }) });
        return job({ status: 'streaming', draftText: '' });
      }),
      stop: vi.fn(async () => job({ status: 'streaming', draftText: '' })),
    });
    const session = new GenerationSession(gateway);
    await session.start('session-1', 'scene-1', 'gpt-test', '');
    const changingProject = session.stopSession('session-1');
    await vi.waitFor(() => expect(gateway.stop).toHaveBeenCalledOnce());
    sendEvent({ type: 'stopped', binding, job: job({ status: 'stopped', draftText: '' }) });
    await changingProject;

    expect(session.hasActiveSession('session-1')).toBe(false);
  });
});
