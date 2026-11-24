import { useEffect, useId, useRef, useState } from 'react';
import { ArrowLeft, ArrowRight, BookOpen, ChevronDown, ChevronRight, Search, X, ZoomOut } from 'lucide-react';
import type { ProjectSnapshot, Scene } from '../services/project';

interface Props {
  project: ProjectSnapshot;
  scene: Scene;
  onOpenScene: (id: string) => void;
  onStory: () => void;
  onOpenChapter: (id: string) => void;
}

export default function SceneNavigation({ project, scene, onOpenScene, onStory, onOpenChapter }: Props) {
  const [outlineOpen, setOutlineOpen] = useState(false);
  const chapter = project.chapters.find(item => item.id === scene.chapterId);
  const orderedIds = project.chapters.flatMap(item => item.sceneIds);
  const index = orderedIds.indexOf(scene.id);
  const previous = project.scenes.find(item => item.id === orderedIds[index - 1]);
  const next = project.scenes.find(item => item.id === orderedIds[index + 1]);
  return <>
    <nav className="scene-navigation" aria-label="Scene navigation">
      <div className="scene-location">
        <button className="quiet" onClick={onStory} title="Zoom out to your story"><BookOpen size={15}/>Story overview</button>
        <ChevronRight size={13} aria-hidden="true"/>
        <button className="quiet" aria-label={`Open chapter ${chapter?.title ?? 'Chapter'}`} onClick={() => onOpenChapter(scene.chapterId)}>{chapter?.title ?? 'Chapter'}</button>
        <ChevronRight size={13} aria-hidden="true"/>
        <button className="quiet current-scene" aria-current="location" aria-haspopup="dialog" aria-label={`Jump to scene: ${scene.title}`} onClick={() => setOutlineOpen(true)}>{scene.title}<ChevronDown size={13}/></button>
      </div>
      <div className="adjacent-scenes">
        <button aria-label="Zoom out to chapter" onClick={() => onOpenChapter(scene.chapterId)}><ZoomOut size={15}/><span>Chapter</span></button>
        <button aria-label="Previous scene" title={previous ? `Previous: ${previous.title}` : 'This is the first scene'} disabled={!previous} onClick={() => previous && onOpenScene(previous.id)}><ArrowLeft size={15}/><span>Previous</span></button>
        <button aria-label="Next scene" title={next ? `Next: ${next.title}` : 'This is the last scene'} disabled={!next} onClick={() => next && onOpenScene(next.id)}><span>Next</span><ArrowRight size={15}/></button>
      </div>
    </nav>
    {outlineOpen && <StoryOutline project={project} sceneId={scene.id} onClose={() => setOutlineOpen(false)} onOpenScene={id => { setOutlineOpen(false); onOpenScene(id); }} onOpenChapter={id => { setOutlineOpen(false); onOpenChapter(id); }} />}
  </>;
}

function StoryOutline({ project, sceneId, onClose, onOpenScene, onOpenChapter }: {
  project: ProjectSnapshot; sceneId: string; onClose: () => void; onOpenScene: (id: string) => void; onOpenChapter: (id: string) => void;
}) {
  const [search, setSearch] = useState('');
  const dialog = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const query = search.trim().toLocaleLowerCase();
  const chapters = project.chapters.map(chapter => ({
    ...chapter,
    scenes: chapter.sceneIds.flatMap(id => {
      const scene = project.scenes.find(item => item.id === id);
      return scene && (!query || chapter.title.toLocaleLowerCase().includes(query) || scene.title.toLocaleLowerCase().includes(query)) ? [scene] : [];
    }),
  })).filter(chapter => chapter.scenes.length || !query || chapter.title.toLocaleLowerCase().includes(query));
  useEffect(() => {
    const element = dialog.current!;
    const previous = document.activeElement as HTMLElement | null;
    if (element.showModal) element.showModal(); else element.setAttribute('open', '');
    element.querySelector('input')?.focus();
    return () => { element.close?.(); if (previous?.isConnected) previous.focus({ preventScroll: true }); };
  }, []);
  return <dialog ref={dialog} className="story-outline" aria-labelledby={titleId} onCancel={event => { event.preventDefault(); onClose(); }} onClick={event => { if (event.target === event.currentTarget) { const rect = event.currentTarget.getBoundingClientRect(); if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) onClose(); } }} onKeyDown={event => {
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
    if (event.target instanceof HTMLInputElement && event.key !== 'ArrowDown') return;
    const buttons = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('.outline-scene'));
    if (!buttons.length) return;
    const current = buttons.indexOf(document.activeElement as HTMLButtonElement);
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1 : event.key === 'ArrowDown' ? (current + 1) % buttons.length : (current - 1 + buttons.length) % buttons.length;
    event.preventDefault(); buttons[next].focus();
  }}>
    <div className="outline-heading"><h2 id={titleId}>Story outline</h2><button className="quiet icon-button" aria-label="Close story outline" onClick={onClose}><X size={18}/></button></div>
    <label className="outline-search"><Search size={17} aria-hidden="true"/><span className="sr-only">Search chapters and scenes</span><input type="search" value={search} onChange={event => setSearch(event.target.value)} placeholder="Search chapters and scenes"/></label>
    <nav className="outline-results" aria-label="Chapters and scenes">
      {chapters.map(chapter => <section key={chapter.id} aria-label={chapter.title}>
        <button className="outline-chapter quiet" aria-label={`Open chapter ${chapter.title}`} onClick={() => onOpenChapter(chapter.id)}>{chapter.title}<span>Open chapter<ChevronRight size={13}/></span></button>
        {chapter.scenes.length ? <ol>{chapter.scenes.map(scene => <li key={scene.id}><button className="outline-scene" aria-current={scene.id === sceneId ? 'location' : undefined} onClick={() => onOpenScene(scene.id)}><span>{scene.title}</span>{scene.id === sceneId && <small>Current scene</small>}</button></li>)}</ol> : <p className="muted">No scenes in this chapter yet.</p>}
      </section>)}
      {!chapters.length && <p className="outline-empty">No chapters or scenes match “{search}”.</p>}
    </nav>
  </dialog>;
}
