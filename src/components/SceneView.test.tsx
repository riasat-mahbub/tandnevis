import '../test/dom';
import { afterEach, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { Workspace } from '../services/workspace';
import type { Editor } from '@tiptap/core';
import { CHARACTER_REFERENCE_MIME } from './BeatEditor';
import SceneView from './SceneView';
import { gateway, project, session } from '../test/fixtures';
import { GenerationSession } from '../services/generation-session';
import type { GenerationJob } from '../services/generation';

afterEach(cleanup);

it('offers New character alongside existing character references', () => {
  const snapshot = project(), native = gateway(snapshot), workspace = new Workspace(native); workspace.attach(session(snapshot));
  const manageLibrary = vi.fn();
  render(<SceneView project={snapshot} scene={snapshot.scenes[0]} workspace={workspace} sessionId="session-1" generation={generationSession()} generationReady={false} defaultGuidance="" locked={false} openSettings={vi.fn()} manageCharacters={vi.fn()} manageLibrary={manageLibrary} notify={vi.fn()} run={action => { void action().catch(() => {}); }}/>);
  expect(screen.getByRole('button', { name: 'Character: Maya' })).toHaveAttribute('draggable', 'true');
  fireEvent.click(screen.getByRole('button', { name: 'New character' }));
  expect(manageLibrary).toHaveBeenCalledWith('characters', 'new');
  expect(native.apply).not.toHaveBeenCalled();
});

it('shows only one category, scopes search, and keeps one dynamic manage link', async () => {
  const snapshot = project();
  snapshot.emotions.push({ id: 'emotion-calm', name: 'Calm', meaning: '', guidance: '', example: '', archived: false, revision: 0 });
  snapshot.tones.push({ id: 'tone-wry', name: 'Wry', meaning: '', guidance: '', example: '', archived: false, revision: 0 });
  const workspace = new Workspace(gateway(snapshot)); workspace.attach(session(snapshot));
  const manageLibrary = vi.fn();
  render(<SceneView project={snapshot} scene={snapshot.scenes[0]} workspace={workspace} sessionId="session-1" generation={generationSession()} generationReady={false} defaultGuidance="" locked={false} openSettings={vi.fn()} manageCharacters={vi.fn()} manageLibrary={manageLibrary} notify={vi.fn()} run={action => { void action().catch(() => {}); }}/>);

  const tabs = screen.getAllByRole('tab');
  expect(tabs).toHaveLength(3);
  expect(tabs.map(tab => tab.getAttribute('aria-label'))).toEqual(['Characters', 'Emotions', 'Tones']);
  expect(tabs.map(tab => tab.getAttribute('aria-selected'))).toEqual(['true', 'false', 'false']);
  expect(within(tabs[0]).getByText('Who is in the scene')).toBeVisible();
  expect(within(tabs[1]).getByText('What they feel')).toBeVisible();
  expect(within(tabs[2]).getByText('How the writing sounds')).toBeVisible();
  expect(tabs.every(tab => tab.querySelector('svg') !== null)).toBe(true);
  expect(screen.getByRole('button', { name: 'Character: Maya' })).toBeVisible();
  expect(screen.queryByRole('button', { name: 'Emotion: Calm' })).toBeNull();
  expect(screen.getAllByRole('button', { name: /^Manage / })).toHaveLength(1);
  expect(screen.getByRole('button', { name: 'New character' })).toBeVisible();

  fireEvent.click(screen.getByRole('tab', { name: 'Emotions' }));
  expect(screen.getByRole('button', { name: 'Emotion: Calm' })).toBeVisible();
  expect(screen.queryByRole('button', { name: 'Character: Maya' })).toBeNull();
  expect(screen.queryByRole('button', { name: 'New character' })).toBeNull();
  expect(screen.getAllByRole('button', { name: /^Manage / })).toHaveLength(1);
  expect(screen.getByPlaceholderText('Search emotions')).toBeVisible();
  fireEvent.change(screen.getByPlaceholderText('Search emotions'), { target: { value: 'does-not-match' } });
  expect(screen.queryByRole('button', { name: 'Emotion: Calm' })).toBeNull();
  expect(screen.getByText('No emotions match “does-not-match”.')).toBeVisible();

  fireEvent.keyDown(screen.getByRole('tab', { name: 'Emotions' }), { key: 'ArrowRight' });
  await waitFor(() => expect(screen.getByRole('tab', { name: 'Tones' })).toHaveAttribute('aria-selected', 'true'));
  expect(screen.getByRole('tab', { name: 'Tones' })).toHaveFocus();
  expect(screen.getByPlaceholderText('Search tones')).toHaveValue('');
  fireEvent.click(screen.getByRole('button', { name: 'Manage Tones' }));
  expect(manageLibrary).toHaveBeenCalledWith('tones', undefined);
});

it('groups preset shelf blocks by effective color and keeps custom colors last', () => {
  const snapshot = project();
  snapshot.emotions.push(
    { id: 'emotion-awe', name: 'Awe', meaning: '', guidance: '', example: '', archived: false, revision: 0 },
    { id: 'emotion-surprised', name: 'Surprised', meaning: '', guidance: '', example: '', color: '#25877F', archived: false, revision: 0 },
    { id: 'emotion-custom', name: 'Custom', meaning: '', guidance: '', example: '', color: '#FF00AA', archived: false, revision: 0 },
  );
  snapshot.tones.push(
    { id: 'tone-warm', name: 'Warm', meaning: '', guidance: '', example: '', color: '#B98116', archived: false, revision: 0 },
    { id: 'tone-custom', name: 'Unlisted', meaning: '', guidance: '', example: '', color: '#FF00AA', archived: false, revision: 0 },
  );
  const workspace = new Workspace(gateway(snapshot)); workspace.attach(session(snapshot));
  render(<SceneView project={snapshot} scene={snapshot.scenes[0]} workspace={workspace} sessionId="session-1" generation={generationSession()} generationReady={false} defaultGuidance="" locked={false} openSettings={vi.fn()} manageCharacters={vi.fn()} notify={vi.fn()} run={action => { void action().catch(() => {}); }}/>);

  fireEvent.click(screen.getByRole('tab', { name: 'Emotions' }));
  const discovery = screen.getByRole('region', { name: 'Discovery' });
  expect(within(discovery).getByRole('heading', { name: 'Discovery', level: 4 })).toBeVisible();
  expect(within(discovery).getByRole('button', { name: 'Emotion: Awe' })).toHaveClass('preset-colored');
  expect(within(discovery).getByRole('button', { name: 'Emotion: Surprised' })).toBeVisible();
  const customEmotions = screen.getByRole('region', { name: 'Custom colors' });
  expect(within(customEmotions).getByRole('button', { name: 'Emotion: Custom' })).toBeVisible();
  expect(screen.getByRole('button', { name: 'Emotion: Awe' })).toHaveAttribute('draggable', 'true');

  fireEvent.click(screen.getByRole('tab', { name: 'Characters' }));
  expect(screen.getByRole('button', { name: 'Character: Maya' })).not.toHaveClass('preset-colored');
  fireEvent.click(screen.getByRole('tab', { name: 'Emotions' }));

  fireEvent.change(screen.getByPlaceholderText('Search emotions'), { target: { value: 'awe' } });
  expect(screen.getByRole('button', { name: 'Emotion: Awe' })).toBeVisible();
  expect(screen.queryByRole('button', { name: 'Emotion: Surprised' })).toBeNull();
  expect(screen.queryByRole('region', { name: 'Custom colors' })).toBeNull();

  fireEvent.click(screen.getByRole('tab', { name: 'Tones' }));
  const positiveEnergy = screen.getByRole('region', { name: 'Positive energy' });
  expect(within(positiveEnergy).getByRole('button', { name: 'Tone: Warm' })).toBeVisible();
  expect(screen.getByRole('region', { name: 'Custom colors' })).toContainElement(screen.getByRole('button', { name: 'Tone: Unlisted' }));
});

it('collapses the desktop block shelf and keeps Scene details closed until deliberately opened', () => {
  const snapshot = project(), workspace = new Workspace(gateway(snapshot)); workspace.attach(session(snapshot));
  const view = render(<SceneView project={snapshot} scene={snapshot.scenes[0]} workspace={workspace} sessionId="session-1" generation={generationSession()} generationReady={false} defaultGuidance="" locked={false} openSettings={vi.fn()} manageCharacters={vi.fn()} notify={vi.fn()} run={action => { void action().catch(() => {}); }}/>);
  const layout = view.container.querySelector('.scene-layout')!;
  expect(layout).toHaveClass('scene-layout-details-collapsed');
  fireEvent.click(screen.getByRole('button', { name: 'Collapse block sidebar' }));
  expect(layout).toHaveClass('scene-layout-shelf-collapsed');
  expect(screen.getByRole('button', { name: 'Expand block sidebar' })).toHaveAttribute('aria-expanded', 'false');
  expect(screen.getByRole('button', { name: 'Expand scene details' })).toHaveAttribute('aria-expanded', 'false');
  fireEvent.click(screen.getByRole('button', { name: 'Expand scene details' }));
  expect(layout).toHaveClass('scene-layout-details-open');
  expect(screen.getByRole('button', { name: 'Collapse scene details' })).toHaveAttribute('aria-expanded', 'true');
  expect(screen.getByRole('heading', { name: 'Scene details' })).toBeVisible();
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

it('inserts optional references at the last caret without a target dialog or automatic details opening', async () => {
  const snapshot = project();
  snapshot.emotions.push({ id: 'emotion-calm', name: 'Calm', meaning: '', guidance: '', example: '', archived: false, revision: 0 });
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
  const character = screen.getByRole('button', { name: 'Character: Maya' });
  expect(character).toHaveAttribute('draggable', 'true');
  fireEvent.click(character);
  await waitFor(() => expect(beat.querySelector('.character-chip')).not.toBeNull());
  expect(beat.querySelector('.character-chip')?.textContent).toContain('Maya');

  const dataTransfer = { setData: vi.fn(), effectAllowed: '' };
  fireEvent.dragStart(character, { dataTransfer });
  expect(dataTransfer.setData).toHaveBeenCalledWith(CHARACTER_REFERENCE_MIME, 'character-1');
  expect(dataTransfer.effectAllowed).toBe('copy');
  expect(fireEvent.mouseDown(character, { button: 0 })).toBe(true);

  fireEvent.click(screen.getByRole('tab', { name: 'Emotions' }));
  fireEvent.click(screen.getByRole('button', { name: 'Emotion: Calm' }));
  await waitFor(() => expect(beat).toHaveTextContent('Emotion: Calm'));
  expect(screen.queryByRole('dialog')).toBeNull();
  expect(screen.getByRole('button', { name: 'Expand scene details' })).toHaveAttribute('aria-expanded', 'false');
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

it('migrates a legacy scene tone into the rich summary once, then lets its reference be removed', async () => {
  const snapshot = project(); snapshot.tones.push({ id: 'tender', name: 'Tender', meaning: 'Care expressed with restraint.', guidance: 'Small gestures of care.', example: 'She warmed the bandage in her hands.', archived: false, revision: 0 });
  snapshot.scenes[0].toneId = 'tender'; snapshot.scenes[0].tone = 'Tender';
  const native = gateway(snapshot), workspace = new Workspace(native); workspace.attach(session(snapshot));
  vi.mocked(native.apply).mockImplementation(async (_session, _revision, operation) => {
    const next = structuredClone(snapshot); next.revision++;
    if (operation.type === 'updateScene') {
      next.scenes[0].summary = operation.summary ?? '';
      next.scenes[0].summaryDocument = operation.summaryDocument;
      next.scenes[0].toneId = operation.toneId ?? '';
      next.scenes[0].tone = operation.tone ?? '';
    }
    return next;
  });
  const props = { project: snapshot, scene: snapshot.scenes[0], workspace, sessionId: 'session-1', generation: generationSession(), generationReady: false, defaultGuidance: '', locked: false, openSettings: vi.fn(), manageCharacters: vi.fn(), notify: vi.fn(), run: (action: () => Promise<unknown>) => { void action().catch(() => {}); } };
  const view = render(<SceneView {...props}/>);
  const summary = screen.getByRole('textbox', { name: 'Scene summary' }) as HTMLElement & { editor: Editor };
  expect(JSON.stringify(summary.editor.getJSON())).toContain('"toneId":"tender"');
  act(() => {
    let tonePosition = -1;
    summary.editor.state.doc.descendants((node, position) => { if (node.type.name === 'toneReference') tonePosition = position; });
    expect(tonePosition).toBeGreaterThanOrEqual(0);
    summary.editor.commands.setNodeSelection(tonePosition);
    summary.editor.commands.deleteSelection();
  });
  await waitFor(() => expect(native.apply).toHaveBeenCalledTimes(1));
  const update = vi.mocked(native.apply).mock.calls[0][2];
  expect(update).toMatchObject({ type: 'updateScene', sceneId: 'scene-1', toneId: '', tone: '' });
  expect(JSON.stringify(update)).not.toContain('tender');
  const acknowledged = workspace.getSnapshot().project!;
  view.rerender(<SceneView {...props} project={acknowledged} scene={acknowledged.scenes[0]}/>);
  expect(JSON.stringify((screen.getByRole('textbox', { name: 'Scene summary' }) as HTMLElement & { editor: Editor }).editor.getJSON())).not.toContain('toneReference');
  expect(acknowledged.scenes[0].toneId).toBe('');
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
