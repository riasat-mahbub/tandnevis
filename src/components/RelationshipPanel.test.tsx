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
  native.apply = vi.fn(async () => { if (fail) throw new Error('Synthetic disk failure'); return { ...project, revision: project.revision + 1 }; });
  const workspace = new Workspace(native); workspace.attach(session(project));
  const view = render(<RelationshipPanel project={project} workspace={workspace} locked={false} sceneId="scene" run={action => { void action().catch(() => {}); }}/>);
  const details = view.container.querySelector('details')!;
  details.open = true; fireEvent(details, new Event('toggle'));
  await screen.findByRole('button', { name: 'After' });
  return { ...view, native };
}
it('edits inherited relationships at the selected scene boundary and keeps the baseline untouched', async () => {
  const { native } = await setup();
  fireEvent.click(screen.getByRole('button', { name: 'After' }));
  fireEvent.click(screen.getByRole('button', { name: /Maya → Damian.*Values his skill/ }));
  expect(screen.getByLabelText('Outcome status')).toHaveValue('planned');
  fireEvent.change(screen.getByLabelText('Description'), { target: { value: 'Trusts her judgment, with reservations.' } });
  fireEvent.click(screen.getByRole('button', { name: 'Apply relationship' }));
  await waitFor(() => expect(native.apply).toHaveBeenCalled());
  expect(vi.mocked(native.apply).mock.calls[0][2]).toMatchObject({ type: 'setRelationship', change: { sceneId: 'scene', phase: 'after', sourceId: 'maya', targetId: 'damian', description: 'Trusts her judgment, with reservations.', status: 'planned' } });
  expect(native.save).not.toHaveBeenCalled();
});
it('retains the authored description after an apply failure', async () => {
  await setup(true);
  fireEvent.click(screen.getByRole('button', { name: 'Add relationship' }));
  fireEvent.change(screen.getByLabelText('Description'), { target: { value: 'A draft relationship worth retaining.' } });
  fireEvent.click(screen.getByRole('button', { name: 'Apply relationship' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Synthetic disk failure');
  expect(screen.getByLabelText('Description')).toHaveValue('A draft relationship worth retaining.');
});
it('provides keyboard character focus and prevents self relationships', async () => {
  await setup();
  fireEvent.keyDown(screen.getByRole('button', { name: 'Focus Maya' }), { key: 'Enter' });
  expect(screen.getByRole('button', { name: 'Maya · Remove focus' })).toBeVisible();
  fireEvent.click(screen.getByRole('button', { name: 'Add relationship' }));
  fireEvent.change(screen.getByLabelText('To'), { target: { value: 'maya' } });
  expect(screen.getByRole('alert')).toHaveTextContent('Choose two different characters.');
  expect(screen.getByRole('button', { name: 'Apply relationship' })).toBeDisabled();
});
