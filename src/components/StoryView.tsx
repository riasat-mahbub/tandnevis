import { BookOpen, ChevronRight, Plus, Trash2 } from 'lucide-react';
import type { ProjectSnapshot } from '../services/project';
import type { Workspace } from '../services/workspace';
import { moved } from '../services/workspace';
import { Timeline, TimelineItem } from './Timeline';
import RelationshipPanel from './RelationshipPanel';

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
    <div className="story-heading"><div><h1>{project.title}</h1><p className="muted">{project.chapters.length} chapters · {project.scenes.length} scenes</p></div><button className="primary" disabled={locked} onClick={() => run(createChapter)}><Plus size={16}/>New chapter</button></div>
    <RelationshipPanel project={project} workspace={workspace} locked={locked} run={run}/>
    {project.chapters.length > 0 && <div className="chapter-table-labels" aria-hidden="true"><span>Chapter</span><span>Narrative</span><span>Scene outline</span></div>}
    {project.chapters.length ? <Timeline ids={project.chapters.map(chapter => chapter.id)} group="Story chapters" onReorder={ids => run(() => workspace.dispatch({ type: 'reorderChapters', ids }))}>
      {project.chapters.map((chapter, index) => {
        const scenes = chapter.sceneIds.flatMap(id => { const scene = project.scenes.find(item => item.id === id); return scene ? [scene] : []; });
        const excerpt = scenes.find(scene => scene.summary.trim())?.summary || 'A new part of the story, ready to begin.';
        return <TimelineItem key={chapter.id} id={chapter.id} index={index} count={project.chapters.length} group="Story chapters" label={chapter.title} disabled={locked} onMove={delta => run(() => workspace.dispatch({ type: 'reorderChapters', ids: moved(project.chapters.map(item => item.id), chapter.id, delta) }))} actions={<button className="danger" disabled={locked} aria-label={`Delete ${chapter.title} and its scenes`} onClick={() => run(async () => { await workspace.dispatch({ type: 'deleteChapter', chapterId: chapter.id }); notify('Chapter and its scenes moved to Trash.'); })}><Trash2 size={13}/>Delete</button>}>
        <button className="chapter-open scene-open" data-chapter-id={chapter.id} aria-label={`Open chapter ${chapter.title}`} aria-current={lastChapterId === chapter.id ? 'location' : undefined} onClick={() => openChapter(chapter.id)}>
          <span className="chapter-ordinal" aria-hidden="true">{String(index + 1).padStart(2, '0')}</span>
          <span className="chapter-narrative"><h2>{chapter.title}</h2><span className="chapter-excerpt">{excerpt}</span></span>
          <span className="chapter-scene-preview">{scenes.slice(0, 3).map(scene => <span key={scene.id}>{scene.title}</span>)}{scenes.length > 3 && <small>+ {scenes.length - 3} more</small>}{!scenes.length && <span>No scenes yet</span>}</span>
          <ChevronRight size={17} aria-hidden="true"/>
        </button>
      </TimelineItem>; })}
    </Timeline> : <div className="empty-story"><BookOpen size={36} aria-hidden="true"/><h2>Room for your first chapter.</h2><p>Create a chapter, then step inside to add its scenes.</p></div>}
  </main>;
}
