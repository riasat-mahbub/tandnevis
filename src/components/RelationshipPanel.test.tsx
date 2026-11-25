import '../test/dom';
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import source from '../test/relationship-context.json';
import type { ProjectSnapshot } from '../services/project';
import { Workspace } from '../services/workspace';
import { gateway, session } from '../test/fixtures';
import RelationshipPanel from './RelationshipPanel';

afterEach(cleanup);

async function setup(fail = false) {
  const project = structuredClone(source) as ProjectSnapshot;
  const native = gateway(project);
  native.apply = vi.fn(async () => {
    if (fail) throw new Error('Synthetic disk failure');
    return { ...project, revision: project.revision + 1 };
  });
  const workspace = new Workspace(native);
  workspace.attach(session(project));
  const view = render(<RelationshipPanel
    project={project}
    workspace={workspace}
    locked={false}
    sceneId="scene"
    run={action => { void action().catch(() => {}); }}
  />);
  const details = view.container.querySelector('details')!;
  details.open = true;
  fireEvent(details, new Event('toggle'));
  await screen.findByRole('button', { name: 'After' });
  return { ...view, native, project, workspace };
}

it('edits the selected relationship at the scene boundary and keeps its story phase', async () => {
  const { native } = await setup();
  fireEvent.click(screen.getByRole('button', { name: 'After' }));
  expect(screen.getByRole('button', { name: /Edit Maya toward Damian: Values his skill/ })).not.toHaveClass('relationship-edge-changed');
  expect(screen.getByRole('button', { name: /Edit Damian toward Maya: Respects her help/ })).toHaveClass('relationship-edge-changed');
  fireEvent.click(screen.getByRole('button', { name: /Edit Maya toward Damian: Values his skill/ }));
  expect(screen.getByLabelText('Outcome status')).toHaveValue('planned');
  fireEvent.change(screen.getByLabelText('Relationship label'), { target: { value: 'Trusts her judgment, with reservations.' } });
  fireEvent.click(screen.getByRole('button', { name: 'Apply relationship' }));
  await waitFor(() => expect(native.apply).toHaveBeenCalled());
  expect(vi.mocked(native.apply).mock.calls[0][2]).toMatchObject({
    type: 'setRelationship',
    change: {
      sceneId: 'scene',
      phase: 'after',
      sourceId: 'maya',
      targetId: 'damian',
      description: 'Trusts her judgment, with reservations.',
      status: 'planned',
      id: 'prior-change',
    },
  });
  expect(native.save).not.toHaveBeenCalled();
});

it('defaults an inherited relationship edited as an After outcome to Planned', async () => {
  await setup();
  fireEvent.click(screen.getByRole('button', { name: 'After' }));
  fireEvent.click(screen.getByRole('button', { name: /Edit Iris toward Maya: PRIVATE OFFSTAGE/ }));
  expect(screen.getByLabelText('Outcome status')).toHaveValue('planned');
});

it('creates through keyboard connector handles and retains an authored label after failure', async () => {
  const { native } = await setup(true);
  fireEvent.click(screen.getByRole('button', { name: 'After' }));
  fireEvent.keyDown(screen.getByRole('button', { name: 'Start relationship from Maya' }), { key: 'Enter' });
  expect(screen.getByText(/Maya selected as the source/)).toBeVisible();
  fireEvent.keyDown(screen.getByRole('button', { name: 'Connect to Joy' }), { key: 'Enter' });
  expect(screen.getByLabelText('Outcome status')).toHaveValue('planned');
  fireEvent.change(screen.getByLabelText('Relationship label'), { target: { value: 'A draft relationship worth retaining.' } });
  fireEvent.click(screen.getByRole('button', { name: 'Apply relationship' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Synthetic disk failure');
  expect(screen.getByLabelText('Relationship label')).toHaveValue('A draft relationship worth retaining.');
  expect(vi.mocked(native.apply).mock.calls[0][2]).toMatchObject({
    type: 'setRelationship',
    change: { sourceId: 'maya', targetId: 'joy-person', phase: 'after' },
  });
});

it('keeps external block edit requests from reopening after a phase change or project update', async () => {
  const { project, workspace, rerender, container } = await setup();
  const props = {
    project,
    workspace,
    locked: false,
    sceneId: 'scene',
    editChangeId: 'current-change',
    editRequest: 1,
    run: (action: () => Promise<unknown>) => { void action().catch(() => {}); },
  };
  rerender(<RelationshipPanel {...props}/>);
  expect(await screen.findByLabelText('Relationship label')).toHaveValue('Respects her help; pride and resentment remain.');
  expect(screen.getByRole('button', { name: 'After' })).toHaveAttribute('aria-pressed', 'true');

  rerender(<RelationshipPanel {...props} project={{ ...project, relationshipChanges: [...(project.relationshipChanges ?? [])] }}/>);
  expect(screen.getByLabelText('Relationship label')).toHaveValue('Respects her help; pride and resentment remain.');
  fireEvent.click(screen.getByRole('button', { name: 'Before' }));
  await waitFor(() => expect(container.querySelector('.relationship-form')).toBeNull());
  expect(screen.getByRole('button', { name: 'Before' })).toHaveAttribute('aria-pressed', 'true');
  fireEvent.click(screen.getByRole('button', { name: 'After' }));
  await waitFor(() => expect(container.querySelector('.relationship-form')).toBeNull());
});

it('supports keyboard character focus and cancels a self-connection', async () => {
  const { container } = await setup();
  fireEvent.keyDown(screen.getByRole('button', { name: 'Focus Maya' }), { key: 'Enter' });
  expect(container.querySelector('.relationship-focus button')).toHaveTextContent('Maya');
  fireEvent.keyDown(screen.getByRole('button', { name: 'Start relationship from Maya' }), { key: 'Enter' });
  fireEvent.keyDown(screen.getByRole('button', { name: 'Connect to Maya' }), { key: 'Enter' });
  expect(screen.getByText('Choose a different character for the other endpoint.')).toBeVisible();
  fireEvent.keyDown(screen.getByRole('button', { name: 'Connect to Damian' }), { key: 'Escape' });
  expect(screen.getByText('Connection cancelled.')).toBeVisible();
});
