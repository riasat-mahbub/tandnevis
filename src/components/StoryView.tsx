import { BookOpen, ChevronRight, Plus, Trash2 } from 'lucide-react';
import type { ProjectSnapshot } from '../services/project';
import type { Workspace } from '../services/workspace';
import { moved } from '../services/workspace';
import { Timeline, TimelineItem } from './Timeline';

interface Props {
  project: ProjectSnapshot; workspace: Workspace; locked: boolean;
  openChapter: (id: string) => void; lastChapterId: string | null;
  notify: (message: string) => void; run: (action: () => Promise<unknown>) => void;
}
export default function StoryView({ project, workspace, locked, openChapter, lastChapterId, notify, run }: Props) {
  async function createChapter() {
    const before = new Set(project.chapters.map(chapter => chapter.id));
    const next = await workspace.dispatch({ type: 'createChapter', title: `Chapter ${project.chapters.length + 1}` });
    const created = next.chapters.find(chapter => !before.has(chapter.id));
    if (created) openChapter(created.id);
  }
  return <main className="story-view story-canvas" aria-label="Story canvas">
    <div className="story-heading"><div><h1>{project.title}</h1><p className="muted">Open a chapter to explore its scenes.</p></div><button className="primary" disabled={locked} onClick={() => run(createChapter)}><Plus size={16}/>New chapter</button></div>
    {project.chapters.length ? <Timeline ids={project.chapters.map(chapter => chapter.id)} group="Story chapters" onReorder={ids => run(() => workspace.dispatch({ type: 'reorderChapters', ids }))}>
      {project.chapters.map((chapter, index) => <TimelineItem key={chapter.id} id={chapter.id} index={index} count={project.chapters.length} group="Story chapters" label={chapter.title} disabled={locked} onMove={delta => run(() => workspace.dispatch({ type: 'reorderChapters', ids: moved(project.chapters.map(item => item.id), chapter.id, delta) }))} actions={<button className="danger" disabled={locked} aria-label={`Delete ${chapter.title} and its scenes`} onClick={() => run(async () => { await workspace.dispatch({ type: 'deleteChapter', chapterId: chapter.id }); notify('Chapter and its scenes moved to Trash.'); })}><Trash2 size={13}/>Delete</button>}>
        <button className="chapter-open scene-open" data-chapter-id={chapter.id} aria-label={`Open chapter ${chapter.title}`} aria-current={lastChapterId === chapter.id ? 'location' : undefined} onClick={() => openChapter(chapter.id)}>
          <h2>{chapter.title}</h2><p>{chapter.sceneIds.length ? project.scenes.find(scene => scene.id === chapter.sceneIds[0])?.summary || 'Explore the scenes in this chapter.' : 'A new part of the story, ready to begin.'}</p>
          <div className="scene-facts"><span>{chapter.sceneIds.length} scene{chapter.sceneIds.length === 1 ? '' : 's'}</span><span className="open-label">Open chapter<ChevronRight size={13}/></span></div>
        </button>
      </TimelineItem>)}
    </Timeline> : <div className="empty-story"><BookOpen size={36} aria-hidden="true"/><h2>Room for your first chapter.</h2><p>Create a chapter, then step inside to add its scenes.</p></div>}
  </main>;
}
