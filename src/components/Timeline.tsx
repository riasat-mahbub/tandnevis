import type { ReactNode } from 'react';
import { DragDropProvider } from '@dnd-kit/react';
import { isSortable, useSortable } from '@dnd-kit/react/sortable';
import { arrayMove } from '@dnd-kit/helpers';
import { ArrowDown, ArrowUp, GripVertical } from 'lucide-react';

export function Timeline({ ids, group, onReorder, children }: { ids: string[]; group: string; onReorder: (ids: string[]) => void; children: ReactNode }) {
  return <DragDropProvider onDragEnd={event => {
    const { source } = event.operation;
    if (event.canceled || !isSortable(source)) return;
    // OptimisticSortingPlugin has already projected source.index and may have
    // cleared the collision target after moving the cards. The sortable index,
    // rather than the last hovered card, is the committed reading position.
    if (source.initialGroup !== group || source.group !== group) return;
    const from = ids.indexOf(String(source.id)), to = source.index;
    if (from < 0 || !Number.isInteger(to) || to < 0 || to >= ids.length || from === to) return;
    const reordered = arrayMove(ids, from, to);
    if (reordered.join() !== ids.join()) onReorder(reordered);
  }}><ol className="timeline" aria-label={group}>{children}</ol></DragDropProvider>;
}
export function TimelineItem({ id, index, count, group, label, disabled, onMove, children, actions }: {
  id: string; index: number; count: number; group: string; label: string; disabled: boolean;
  onMove: (delta: number) => void; children: ReactNode; actions: ReactNode;
}) {
  const { ref, handleRef, isDragging, isDropTarget } = useSortable({ id, index, group, type: group, accept: group, disabled, transition: { duration: 180 } });
  return <li ref={ref} className={`timeline-item ${index % 2 ? 'right' : 'left'} ${isDragging ? 'dragging' : ''} ${isDropTarget ? 'drop-target' : ''}`} data-item-id={id}>
    <span className="timeline-number" aria-hidden="true">{index + 1}</span>
    <article className="note-card">
      <div className="card-tools">
        <button ref={handleRef} className="icon-button drag-handle" title={`Drag ${label}. Space to pick up; arrow keys to move; Escape to cancel.`} aria-label={`Reorder ${label}`} disabled={disabled}><GripVertical size={16}/></button>
        <span className="move-buttons"><button className="icon-button" aria-label={`Move ${label} up`} title="Move up" disabled={disabled || index === 0} onClick={() => onMove(-1)}><ArrowUp size={14}/></button><button className="icon-button" aria-label={`Move ${label} down`} title="Move down" disabled={disabled || index === count - 1} onClick={() => onMove(1)}><ArrowDown size={14}/></button></span>
        <div className="quick-actions">{actions}</div>
      </div>
      {children}
    </article>
  </li>;
}
