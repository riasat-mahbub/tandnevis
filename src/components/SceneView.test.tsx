import '../test/dom';
import { afterEach, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { Workspace } from '../services/workspace';
import { CHARACTER_REFERENCE_MIME, PRESET_REFERENCE_MIME } from './BeatEditor';
import SceneView from './SceneView';
import { gateway, project, session } from '../test/fixtures';
import { GenerationSession } from '../services/generation-session';
import type { GenerationJob } from '../services/generation';

afterEach(cleanup);

it('always offers New character alongside existing character blocks', () => {
  const snapshot = project(), native = gateway(snapshot), workspace = new Workspace(native); workspace.attach(session(snapshot));
  const manageLibrary = vi.fn();
  render(<SceneView project={snapshot} scene={snapshot.scenes[0]} workspace={workspace} sessionId="session-1" generation={generationSession()} generationReady={false} defaultGuidance="" locked={false} openSettings={vi.fn()} manageCharacters={vi.fn()} manageLibrary={manageLibrary} notify={vi.fn()} run={action => { void action().catch(() => {}); }}/>);
  expect(screen.getByRole('button', { name: 'Maya' })).toHaveAttribute('draggable', 'true');
  fireEvent.click(screen.getByRole('button', { name: 'New character' }));
  expect(manageLibrary).toHaveBeenCalledWith('characters', 'new');
  expect(native.apply).not.toHaveBeenCalled();
});

it('adds an optional stock character with a complete profile and available default in one unsaved operation', async () => {
  const snapshot = project(), original = structuredClone(snapshot);
  snapshot.tones.push({ id: 'playful-tone', name: 'Playful', meaning: '', guidance: 'Light teasing.', example: '', archived: false, revision: 0 });
  const native = gateway(snapshot), workspace = new Workspace(native); workspace.attach(session(snapshot));
  vi.mocked(native.apply).mockImplementation(async (_session, _revision, operation) => {
    const next = structuredClone(snapshot); next.revision++;
    if (operation.type === 'createCharacter') next.characters.push({ id: 'joy-profile', name: operation.name, background: operation.background ?? '', personality: operation.personality ?? '', voice: operation.voice ?? '', archived: false, defaultToneId: operation.defaultToneId ?? '', defaultEmotionId: operation.defaultEmotionId ?? '' });
    return next;
  });
  const props = { project: snapshot, scene: snapshot.scenes[0], workspace, sessionId: 'session-1', generation: generationSession(), generationReady: false, defaultGuidance: '', locked: false, openSettings: vi.fn(), manageCharacters: vi.fn(), notify: vi.fn(), run: (action: () => Promise<unknown>) => { void action().catch(() => {}); } };
  const view = render(<SceneView {...props}/>);
  expect(native.apply).not.toHaveBeenCalled();
  fireEvent.click(screen.getByText('Stock characters'));
  expect(screen.getByRole('button', { name: 'Maya already added' })).toBeDisabled();
  fireEvent.click(screen.getByRole('button', { name: 'Add Joy' }));
  await waitFor(() => expect(native.apply).toHaveBeenCalledTimes(1));
  expect(native.apply).toHaveBeenCalledWith('session-1', 0, {
    type: 'createCharacter', name: 'Joy',
    background: "Knows everyone's habits and keeps the group connected.",
    personality: 'Warm, curious, and occasionally prone to overstepping.',
    voice: 'Conversational, quick questions, and vivid details; talks around awkward silences.',
    defaultToneId: 'playful-tone',
  });
  await waitFor(() => expect(workspace.getSnapshot().project?.characters).toHaveLength(2));
  const next = workspace.getSnapshot().project!;
  view.rerender(<SceneView {...props} project={next} scene={next.scenes[0]}/>);
  expect(screen.getByRole('button', { name: 'Joy already added' })).toBeDisabled();
  expect(screen.getByRole('button', { name: 'Joy' })).toHaveAttribute('draggable', 'true');
  expect(snapshot.characters).toEqual(original.characters);
  expect(snapshot.characters[0].background).toBe('');
  expect(native.save).not.toHaveBeenCalled();
});

it('does not overwrite or duplicate an archived stock-name character with different capitalization', () => {
  const snapshot = project(); snapshot.characters[0] = { ...snapshot.characters[0], name: 'mAyA', background: 'My own medic background', archived: true };
  const native = gateway(snapshot), workspace = new Workspace(native); workspace.attach(session(snapshot));
  render(<SceneView project={snapshot} scene={snapshot.scenes[0]} workspace={workspace} sessionId="session-1" generation={generationSession()} generationReady={false} defaultGuidance="" locked={false} openSettings={vi.fn()} manageCharacters={vi.fn()} notify={vi.fn()} run={action => { void action().catch(() => {}); }}/>);
  fireEvent.click(screen.getByText('Stock characters'));
  const added = screen.getByRole('button', { name: 'Maya already added' });
  expect(added).toBeDisabled(); expect(added).toHaveTextContent('Added');
  fireEvent.click(added);
  expect(native.apply).not.toHaveBeenCalled();
  expect(snapshot.characters[0].background).toBe('My own medic background');
  expect(screen.getByRole('button', { name: 'New character' })).toBeEnabled();
});

function generationSession() {
  return new GenerationSession({
    desktop: false,
    start: async () => { throw new Error('Desktop only'); },
    stop: async () => { throw new Error('Desktop only'); },
    list: async () => [],
    accept: async () => project(),
    discard: async () => { throw new Error('Desktop only'); },
  });
}

it('previews only the selected scene beats and character directions', async () => {
  const snapshot = project();
  const native = gateway(snapshot);
  const workspace = new Workspace(native);
  workspace.attach(session(snapshot));
  render(<SceneView
    project={snapshot}
    scene={snapshot.scenes[0]}
    workspace={workspace}
    sessionId={session(snapshot).sessionId}
    generation={generationSession()}
    generationReady={false}
    defaultGuidance=""
    locked={false}
    openSettings={vi.fn()}
    manageCharacters={vi.fn()}
    notify={vi.fn()}
    run={action => { void action().catch(() => {}); }}
  />);

  expect(screen.getByRole('button', { name: 'Generate scene' })).toBeDisabled();
  expect(screen.getByRole('button', { name: 'Generate prose' })).toBeDisabled();
  expect(screen.getByRole('button', { name: 'Open Settings' })).toBeEnabled();
  expect(screen.getByText('Scene generation is available in the desktop app.')).toBeVisible();
  fireEvent.click(screen.getByText('Preview scene context'));
  const preview = document.querySelector('.generation-preview pre');
  expect(preview?.textContent).toContain('Scene: Arrival');
  expect(preview?.textContent).toContain('The door opens.');
  expect(preview?.textContent).not.toContain('The letter');
});

it('keeps click-to-insert available and makes character library blocks draggable', async () => {
  const snapshot = project();
  const native = gateway(snapshot);
  vi.mocked(native.apply).mockResolvedValue(snapshot);
  const workspace = new Workspace(native);
  workspace.attach(session(snapshot));
  render(<SceneView
    project={snapshot}
    scene={snapshot.scenes[0]}
    workspace={workspace}
    sessionId={session(snapshot).sessionId}
    generation={generationSession()}
    generationReady={false}
    defaultGuidance=""
    locked={false}
    openSettings={vi.fn()}
    manageCharacters={vi.fn()}
    notify={vi.fn()}
    run={action => { void action().catch(() => {}); }}
  />);

  const beat = screen.getByRole('textbox', { name: 'Freeform text for beat 1' });
  act(() => { beat.focus(); });
  const character = screen.getByRole('button', { name: 'Maya' });
  expect(character).toHaveAttribute('draggable', 'true');
  fireEvent.click(character);
  await waitFor(() => expect(beat.querySelector('.character-chip')).not.toBeNull());
  expect(beat.querySelector('.character-chip')?.textContent).toContain('Maya');

  const dataTransfer = { setData: vi.fn(), effectAllowed: '' };
  fireEvent.dragStart(character, { dataTransfer });
  expect(dataTransfer.setData).toHaveBeenCalledWith(CHARACTER_REFERENCE_MIME, 'character-1');
  expect(dataTransfer.effectAllowed).toBe('copy');
  expect(fireEvent.mouseDown(character, { button: 0 })).toBe(true);
});

it('opens with the title and rich summary before the beats, with no separate scene tone control', () => {
  const snapshot = project(), workspace = new Workspace(gateway(snapshot)); workspace.attach(session(snapshot));
  render(<SceneView project={snapshot} scene={snapshot.scenes[0]} workspace={workspace} sessionId="session-1" generation={generationSession()} generationReady={false} defaultGuidance="" locked={false} openSettings={vi.fn()} manageCharacters={vi.fn()} notify={vi.fn()} run={action => { void action().catch(() => {}); }}/>);
  const summary = screen.getByRole('textbox', { name: 'Scene summary' });
  expect(summary).toHaveAttribute('contenteditable', 'true');
  expect(summary).toHaveTextContent('Someone comes home.');
  const heading = document.querySelector('.scene-heading')!;
  expect(heading.nextElementSibling).toBe(summary.closest('.summary-board'));
  expect(summary.compareDocumentPosition(screen.getByRole('textbox', { name: 'Freeform text for beat 1' })) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  expect(screen.queryByRole('combobox', { name: 'Scene tone block' })).toBeNull();
  expect(document.querySelector('.scene-generate-actions')).toContainElement(screen.getByRole('button', { name: 'Generate prose' }));
});

it('updates the local inspector to the drop destination when a summary tone is dropped after editing a beat', async () => {
  const snapshot = project(); snapshot.tones.push({ id: 'tender', name: 'Tender', meaning: 'Care expressed with restraint.', guidance: 'Small gestures of care.', example: 'She warmed the bandage in her hands.', archived: false, revision: 0 });
  const native = gateway(snapshot), workspace = new Workspace(native); workspace.attach(session(snapshot));
  vi.mocked(native.apply).mockImplementation(async (_session, _revision, operation) => {
    const next = structuredClone(snapshot); next.revision++;
    if (operation.type === 'updateScene') Object.assign(next.scenes[0], operation);
    return next;
  });
  render(<SceneView project={snapshot} scene={snapshot.scenes[0]} workspace={workspace} sessionId="session-1" generation={generationSession()} generationReady={false} defaultGuidance="" locked={false} openSettings={vi.fn()} manageCharacters={vi.fn()} notify={vi.fn()} run={action => { void action().catch(() => {}); }}/>);
  act(() => screen.getByRole('textbox', { name: 'Freeform text for beat 1' }).focus());
  fireEvent.drop(screen.getByRole('textbox', { name: 'Scene summary' }), { dataTransfer: { types: [PRESET_REFERENCE_MIME], getData: (type: string) => type === PRESET_REFERENCE_MIME ? JSON.stringify({ kind: 'tone', id: 'tender' }) : '' }, clientX: 10, clientY: 10 });
  await waitFor(() => expect(document.querySelector('.inspector .scope-label')).toHaveTextContent('Summary: scene direction'));
  expect(document.querySelector('.inspector .preset-guidance')).toHaveTextContent('Care expressed with restraint.');
  expect(document.querySelector('.inspector .preset-guidance')).toHaveTextContent('Small gestures of care.');
  expect(document.querySelector('.inspector .preset-guidance')).toHaveTextContent('She warmed the bandage in her hands.');
});

it('routes the two top actions to different generation purposes without saving the project file', async () => {
  const snapshot = project(), native = gateway(snapshot), workspace = new Workspace(native); workspace.attach(session(snapshot));
  const start = vi.fn(async () => { throw new Error('Synthetic request ended'); });
  const generation = new GenerationSession({ ...generationSession().gateway, desktop: true, start });
  render(<SceneView project={snapshot} scene={snapshot.scenes[0]} workspace={workspace} sessionId="session-1" generation={generation} generationReady generationModel="test-model" defaultGuidance="" locked={false} openSettings={vi.fn()} manageCharacters={vi.fn()} notify={vi.fn()} run={action => { void action().catch(() => {}); }}/>);
  fireEvent.click(screen.getByRole('button', { name: 'Generate scene' }));
  await waitFor(() => expect(start).toHaveBeenCalledWith('session-1', 'scene-1', 'test-model', '', expect.any(Function), 'beats'));
  await waitFor(() => expect(screen.getByRole('button', { name: 'Generate prose' })).toBeEnabled());
  fireEvent.click(screen.getByRole('button', { name: 'Generate prose' }));
  await waitFor(() => expect(start).toHaveBeenCalledWith('session-1', 'scene-1', 'test-model', '', expect.any(Function), 'prose'));
  expect(native.save).not.toHaveBeenCalled();
});

it('shows recovered beat proposals even when this scene has no prose draft', async () => {
  const snapshot = project(), workspace = new Workspace(gateway(snapshot)); workspace.attach(session(snapshot));
  const saved: GenerationJob = {
    id: 'recovered-beats', sceneId: 'scene-1', sceneRevision: 0, connectionId: 'connection', model: 'test-model',
    requestSnapshot: { schemaVersion: 1, purpose: 'beats', connectionId: 'connection', model: 'test-model', defaultGuidance: '', baseProse: '', context: {}, request: {} },
    inputFingerprint: 'earlier-direction', status: 'completed', draftText: JSON.stringify({ beats: [{ document: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Maya opens the infirmary door.' }] }] } }] }), errorMessage: null, createdAtMs: 1, updatedAtMs: 2,
  };
  const generation = new GenerationSession({ ...generationSession().gateway, desktop: true, list: async () => [saved] });
  render(<SceneView project={snapshot} scene={snapshot.scenes[0]} workspace={workspace} sessionId="session-1" generation={generation} generationReady={false} defaultGuidance="" locked={false} openSettings={vi.fn()} manageCharacters={vi.fn()} notify={vi.fn()} run={action => { void action().catch(() => {}); }}/>);
  expect(await screen.findByRole('heading', { name: 'Draft beats' })).toBeVisible();
  expect(screen.getByText('Maya opens the infirmary door.')).toBeVisible();
});
