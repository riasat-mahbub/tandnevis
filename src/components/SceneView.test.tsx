import '../test/dom';
import { afterEach, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { Workspace } from '../services/workspace';
import { CHARACTER_REFERENCE_MIME } from './BeatEditor';
import SceneView from './SceneView';
import { gateway, project, session } from '../test/fixtures';

afterEach(cleanup);

it('previews only the selected scene beats and character directions', async () => {
  const snapshot = project();
  const native = gateway(snapshot);
  const workspace = new Workspace(native);
  workspace.attach(session(snapshot));
  render(<SceneView
    project={snapshot}
    scene={snapshot.scenes[0]}
    workspace={workspace}
    locked={false}
    openSettings={vi.fn()}
    manageCharacters={vi.fn()}
    notify={vi.fn()}
    run={action => { void action().catch(() => {}); }}
  />);

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
});
