import '../test/dom';
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import { DragDropManager } from '@dnd-kit/dom';
import { Sortable } from '@dnd-kit/dom/sortable';
import type { DragEndEvent } from '@dnd-kit/react';
import { Timeline } from './Timeline';

const events = vi.hoisted(() => ({ end: null as ((event: DragEndEvent) => void) | null }));
vi.mock('@dnd-kit/react', async importOriginal => {
  const original = await importOriginal<typeof import('@dnd-kit/react')>();
  return { ...original, DragDropProvider: ({ children, onDragEnd }: { children: React.ReactNode; onDragEnd: (event: DragEndEvent) => void }) => { events.end = onDragEnd; return children; } };
});
afterEach(cleanup);

function dragEnd(source: Sortable['draggable'], canceled = false): DragEndEvent {
  return { canceled, operation: { source, target: null } } as DragEndEvent;
}
it('commits the final optimistic sortable position even when release has no collision target', () => {
  const onReorder = vi.fn(), manager = new DragDropManager();
  const sortable = new Sortable({ id: 'first', index: 0, group: 'scenes', type: 'scenes', accept: 'scenes' }, manager);
  render(<Timeline ids={['first','second','third']} group="scenes" onReorder={onReorder}><li>First scene</li></Timeline>);
  // Same projected state produced by OptimisticSortingPlugin during a real drag.
  sortable.index = 2;
  events.end!(dragEnd(sortable.draggable));
  expect(onReorder).toHaveBeenCalledExactlyOnceWith(['second','third','first']);
  sortable.destroy(); manager.destroy();
});
it('does not persist canceled, unchanged, foreign-group, or invalid drops', () => {
  const onReorder = vi.fn(), manager = new DragDropManager();
  const sortable = new Sortable({ id: 'first', index: 0, group: 'scenes', type: 'scenes', accept: 'scenes' }, manager);
  render(<Timeline ids={['first','second']} group="scenes" onReorder={onReorder}><li>First scene</li></Timeline>);
  events.end!(dragEnd(sortable.draggable));
  sortable.index = 1; events.end!(dragEnd(sortable.draggable, true));
  sortable.index = 2; events.end!(dragEnd(sortable.draggable));
  sortable.index = 1; sortable.group = 'another chapter'; events.end!(dragEnd(sortable.draggable));
  expect(onReorder).not.toHaveBeenCalled();
  sortable.destroy(); manager.destroy();
});
