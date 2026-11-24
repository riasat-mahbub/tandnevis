import { useEffect, useRef, useState } from 'react';
import { BookOpen, ChevronDown, ChevronRight, Copy, List, Plus, Rows3, Trash2, ZoomIn } from 'lucide-react';
import type { Operation, ProjectSnapshot } from '../services/project';
import type { Workspace } from '../services/workspace';
import { moved } from '../services/workspace';
import { TitleField } from './Fields';
import { Timeline, TimelineItem } from './Timeline';

export interface ChapterFocusRequest { chapterId: string; request: number }
interface Props {
  project: ProjectSnapshot; workspace: Workspace; locked: boolean;
  openScene: (id: string) => void; notify: (message: string) => void;
  run: (action: () => Promise<unknown>) => void;
  focusRequest?: ChapterFocusRequest | null; lastSceneId?: string | null;
}
export default function StoryView({ project, workspace, locked, openScene, notify, run, focusRequest, lastSceneId }: Props) {
  const [presentation, setPresentation] = useState<'timeline' | 'compact'>('timeline');
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set());
  const [focusedChapter, setFocusedChapter] = useState<string | null>(null);
  const root = useRef<HTMLElement>(null);
  const edit = (op: Operation) => { void workspace.dispatch(op).catch(() => {}); };
  function focusChapter(id: string) {
    setFocusedChapter(id);
    setCollapsed(new Set(project.chapters.filter(chapter => chapter.id !== id).map(chapter => chapter.id)));
    requestAnimationFrame(() => Array.from(root.current?.querySelectorAll<HTMLElement>('[data-chapter-id]') ?? []).find(element => element.dataset.chapterId === id)?.scrollIntoView({ block: 'start' }));
  }
  useEffect(() => {
    if (focusRequest && project.chapters.some(chapter => chapter.id === focusRequest.chapterId)) focusChapter(focusRequest.chapterId);
    // A focus request is a navigation action, not a reaction to writing edits.
  }, [focusRequest]);
  function toggleChapter(id: string) {
    setFocusedChapter(null);
    setCollapsed(previous => { const next = new Set(previous); if (next.has(id)) next.delete(id); else next.add(id); return next; });
  }
  async function createScene(chapterId?: string) {
    let p = workspace.getSnapshot().project!;
    if (!p.chapters.length) p = await workspace.dispatch({ type: 'createChapter', title: 'Chapter 1' });
    const parent = chapterId ?? p.chapters.at(-1)!.id;
    p = await workspace.dispatch({ type: 'createScene', chapterId: parent, title: 'Untitled scene' });
    setCollapsed(previous => { const next = new Set(previous); next.delete(parent); return next; });
    openScene(p.chapters.find(chapter => chapter.id === parent)!.sceneIds.at(-1)!);
    requestAnimationFrame(() => { const input = Array.from(document.querySelectorAll<HTMLInputElement>('[aria-label="Scene title"]')).find(element => !element.closest('[hidden]')); input?.focus(); input?.select(); });
  }
  return <main ref={root} id="main" className={`story-view story-${presentation}`}>
    <div className="story-heading"><div><h1>Your story, taking shape.</h1><p className="muted">Follow the whole story, focus a chapter, or step into a scene.</p></div><button className="primary" disabled={locked} onClick={() => run(() => createScene())}><Plus size={16}/>New scene</button></div>
    {project.chapters.length > 0 && <div className="story-view-controls">
      <div className="story-presentation" role="group" aria-label="Story presentation"><button aria-pressed={presentation === 'timeline'} onClick={() => setPresentation('timeline')}><Rows3 size={15}/>Timeline</button><button aria-pressed={presentation === 'compact'} onClick={() => setPresentation('compact')}><List size={15}/>Compact</button></div>
      <div className="chapter-visibility"><button className="quiet" onClick={() => { setCollapsed(new Set()); setFocusedChapter(null); }}>Show all chapters</button><button className="quiet" onClick={() => { setCollapsed(new Set(project.chapters.map(chapter => chapter.id))); setFocusedChapter(null); }}>Collapse all</button></div>
    </div>}
    {!project.chapters.length && <div className="empty-story"><div className="paper-stack" aria-hidden="true"><BookOpen size={36}/></div><h2>Room for your first scene.</h2><p>Start anywhere. A chapter holds the scenes;<br/>each scene holds the moments you want to write.</p><button disabled={locked} onClick={() => run(() => createScene())}><Plus size={16}/>Create your first scene</button></div>}
    {project.chapters.map((chapter, chapterIndex) => {
      const expanded = !collapsed.has(chapter.id);
      return <section className={`chapter ${focusedChapter === chapter.id ? 'chapter-focused' : ''}`} key={chapter.id} aria-label={chapter.title} data-chapter-id={chapter.id}>
        <div className="chapter-heading">
          <div className="chapter-title"><button className="quiet chapter-disclosure" aria-label={`${expanded ? 'Collapse' : 'Expand'} chapter ${chapter.title}`} aria-expanded={expanded} aria-controls={`chapter-scenes-${chapter.id}`} onClick={() => toggleChapter(chapter.id)}>{expanded ? <ChevronDown size={18}/> : <ChevronRight size={18}/>}<span className="chapter-index">Chapter {chapterIndex + 1}</span></button><TitleField value={chapter.title} label={`Chapter ${chapterIndex + 1} title`} onSave={title => edit({ type: 'renameChapter', chapterId: chapter.id, title })}/></div>
          <div className="chapter-actions"><button className="quiet" aria-pressed={focusedChapter === chapter.id} aria-label={`Focus chapter ${chapter.title}`} onClick={() => focusChapter(chapter.id)}><ZoomIn size={14}/>Focus</button><button disabled={locked || chapterIndex === 0} className="quiet" onClick={() => edit({ type: 'reorderChapters', ids: moved(project.chapters.map(item => item.id), chapter.id, -1) })}>Move up</button><button disabled={locked || chapterIndex === project.chapters.length - 1} className="quiet" onClick={() => edit({ type: 'reorderChapters', ids: moved(project.chapters.map(item => item.id), chapter.id, 1) })}>Move down</button><button disabled={locked} className="quiet danger" title="Move chapter and its scenes to Trash" aria-label={`Delete ${chapter.title} and its scenes`} onClick={() => run(async () => { await workspace.dispatch({ type: 'deleteChapter', chapterId: chapter.id }); notify('Chapter and its scenes moved to Trash.'); })}><Trash2 size={13}/><span>Delete chapter</span></button></div>
        </div>
        <div id={`chapter-scenes-${chapter.id}`} hidden={!expanded}>
          {chapter.sceneIds.length ? <Timeline ids={chapter.sceneIds} group={`Scenes in ${chapter.id}`} onReorder={ids => { edit({ type: 'reorderScenes', chapterId: chapter.id, ids }); notify('Scene order updated.'); }}>{chapter.sceneIds.map((id, index) => {
            const scene = project.scenes.find(item => item.id === id)!;
            return <TimelineItem id={scene.id} key={scene.id} index={index} count={chapter.sceneIds.length} group={`Scenes in ${chapter.id}`} label={scene.title} disabled={locked} onMove={delta => { edit({ type: 'reorderScenes', chapterId: chapter.id, ids: moved(chapter.sceneIds, scene.id, delta) }); notify(`${scene.title} moved to position ${index + delta + 1}.`); }} actions={<><button disabled={locked} aria-label={`Duplicate ${scene.title}`} onClick={() => edit({ type: 'duplicateScene', sceneId: scene.id })}><Copy size={13}/>Duplicate</button><button disabled={locked} className="danger" aria-label={`Delete ${scene.title}`} title="Move scene to Trash" onClick={() => run(async () => { await workspace.dispatch({ type: 'deleteScene', sceneId: scene.id }); notify('Scene moved to Trash. Undo or Restore brings it back.'); })}><Trash2 size={13}/>Delete</button></>}>
              <button className={`scene-open ${lastSceneId === scene.id ? 'last-opened-scene' : ''}`} aria-current={lastSceneId === scene.id ? 'location' : undefined} onClick={() => openScene(scene.id)}><h3>{scene.title}</h3><p>{scene.summary || 'An idea waiting for your words…'}</p><div className="scene-facts"><span>{scene.beats.length} beat{scene.beats.length === 1 ? '' : 's'}</span><span className="open-label">Open scene<ChevronRight size={13}/></span></div></button>
            </TimelineItem>;
          })}</Timeline> : <p className="empty-inline">This chapter is ready for its first scene.</p>}
          <button className="chapter-add" disabled={locked} onClick={() => run(() => createScene(chapter.id))}><Plus size={15}/>Add scene to {chapter.title}</button>
        </div>
      </section>;
    })}
    <div className="story-bottom"><button disabled={locked} onClick={() => edit({ type: 'createChapter', title: `Chapter ${project.chapters.length + 1}` })}><Plus size={16}/>New chapter</button><span className="muted">Drag by the handle, or use the arrows to put things in order.</span></div>
  </main>;
}
