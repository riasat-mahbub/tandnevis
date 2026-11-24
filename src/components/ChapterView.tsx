import { useState } from 'react';
import { ArrowLeft, BookOpen, ChevronRight, Copy, List, Plus, Trash2 } from 'lucide-react';
import type { Chapter, ProjectSnapshot } from '../services/project';
import type { Workspace } from '../services/workspace';
import { moved } from '../services/workspace';
import { TitleField } from './Fields';
import { Timeline, TimelineItem } from './Timeline';

interface Props {
  project: ProjectSnapshot; chapter: Chapter; workspace: Workspace; locked: boolean;
  openScene: (id: string) => void; onStory: () => void; lastSceneId: string | null;
  notify: (message: string) => void; run: (action: () => Promise<unknown>) => void;
}
export default function ChapterView({ project, chapter, workspace, locked, openScene, onStory, lastSceneId, notify, run }: Props) {
  const [compact, setCompact] = useState(false);
  async function createScene() {
    const before = new Set(chapter.sceneIds);
    const next = await workspace.dispatch({ type: 'createScene', chapterId: chapter.id, title: 'Untitled scene' });
    const created = next.chapters.find(item => item.id === chapter.id)?.sceneIds.find(id => !before.has(id));
    if (created) {
      openScene(created);
      requestAnimationFrame(() => { const input = document.querySelector<HTMLInputElement>('.scene-destination:not([hidden]) [aria-label="Scene title"]'); input?.focus(); input?.select(); });
    }
  }
  return <main className={`story-view chapter-canvas ${compact ? 'story-compact' : ''}`} aria-label={`Chapter canvas: ${chapter.title}`}>
    <nav className="chapter-navigation" aria-label="Chapter navigation"><button className="quiet" onClick={onStory} aria-label="Zoom out to story"><ArrowLeft size={16}/><BookOpen size={15}/>Story</button><ChevronRight size={13} aria-hidden="true"/><span aria-current="location">{chapter.title}</span></nav>
    <div className="story-heading chapter-canvas-heading"><div><TitleField value={chapter.title} label={`Chapter ${project.chapters.findIndex(item => item.id === chapter.id) + 1} title`} large disabled={locked} onSave={title => run(() => workspace.dispatch({ type: 'renameChapter', chapterId: chapter.id, title }))}/><p className="muted">Chapter {project.chapters.findIndex(item => item.id === chapter.id) + 1} of {project.chapters.length} · {chapter.sceneIds.length} scenes</p></div><button className="primary" disabled={locked} onClick={() => run(createScene)}><Plus size={16}/>New scene</button></div>
    {chapter.sceneIds.length > 0 && <div className="chapter-canvas-controls"><button className="quiet" aria-pressed={compact} onClick={() => setCompact(!compact)}><List size={15}/>Compact scene list</button></div>}
    {chapter.sceneIds.length ? <Timeline ids={chapter.sceneIds} group={`Scenes in ${chapter.id}`} onReorder={ids => run(() => workspace.dispatch({ type: 'reorderScenes', chapterId: chapter.id, ids }))}>
      {chapter.sceneIds.map((id, index) => {
        const scene = project.scenes.find(item => item.id === id)!;
        return <TimelineItem key={id} id={id} index={index} count={chapter.sceneIds.length} group={`Scenes in ${chapter.id}`} label={scene.title} disabled={locked} onMove={delta => run(() => workspace.dispatch({ type: 'reorderScenes', chapterId: chapter.id, ids: moved(chapter.sceneIds, id, delta) }))} actions={<><button disabled={locked} aria-label={`Duplicate ${scene.title}`} onClick={() => run(() => workspace.dispatch({ type: 'duplicateScene', sceneId: id }))}><Copy size={13}/>Duplicate</button><button disabled={locked} className="danger" aria-label={`Delete ${scene.title}`} onClick={() => run(async () => { await workspace.dispatch({ type: 'deleteScene', sceneId: id }); notify('Scene moved to Trash. Undo or Restore brings it back.'); })}><Trash2 size={13}/>Delete</button></>}>
          <button className={`scene-open ${lastSceneId === id ? 'last-opened-scene' : ''}`} data-scene-id={id} aria-current={lastSceneId === id ? 'location' : undefined} onClick={() => openScene(id)}><h3>{scene.title}</h3><p>{scene.summary || 'An idea waiting for your words…'}</p><div className="scene-facts"><span>{scene.beats.length} beat{scene.beats.length === 1 ? '' : 's'}</span><span className="open-label">Open scene<ChevronRight size={13}/></span></div></button>
        </TimelineItem>;
      })}
    </Timeline> : <div className="empty-story"><h2>This chapter is ready for its first scene.</h2><p>Start with a moment, an encounter, or a place.</p><button disabled={locked} onClick={() => run(createScene)}><Plus size={16}/>Create the first scene</button></div>}
  </main>;
}
