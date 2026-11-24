import type { Manuscript } from '../services/compile';

export default function ManuscriptPreview({ manuscript }: { manuscript: Manuscript }) {
  const { options, chapters } = manuscript;
  if (!manuscript.stats.included) return <div className="manuscript-page manuscript-empty"><h2>No prose to preview</h2><p>Choose scenes with written prose, or include placeholders for unfinished scenes.</p></div>;
  return <div className="manuscript-pages">
    {options.titlePage && <article className="manuscript-page manuscript-title"><h2>{manuscript.title}</h2></article>}
    {options.contents && manuscript.scope !== 'scene' && <article className="manuscript-page manuscript-contents"><h2>Contents</h2><ol>{chapters.map(chapter => <li key={chapter.id}>
      {manuscript.scope === 'story' ? `Chapter ${chapter.number} — ${chapter.title}` : chapter.title}
      {(manuscript.scope === 'chapter' || options.sceneTitles) && <ol>{chapter.scenes.map(scene => <li key={scene.id}>{scene.title}</li>)}</ol>}
    </li>)}</ol></article>}
    {chapters.map(chapter => <article className="manuscript-page" key={chapter.id}>
      {manuscript.scope !== 'scene' && <p className="manuscript-chapter-number">Chapter {chapter.number}</p>}
      <h2>{manuscript.scope === 'scene' ? manuscript.title : chapter.title}</h2>
      {chapter.scenes.map((scene, index) => <section className="manuscript-scene" key={scene.id}>
        {index > 0 && options.separator === 'ornament' && <p className="manuscript-break" aria-label="Scene break">* * *</p>}
        {index > 0 && options.separator === 'space' && <div className="manuscript-space"/>}
        {options.sceneTitles && manuscript.scope !== 'scene' && <h3>{scene.title}</h3>}
        {scene.unfinished ? <p className="manuscript-placeholder">[Unfinished: {scene.title}]</p> : <div className="manuscript-prose">{scene.prose}</div>}
      </section>)}
    </article>)}
  </div>;
}
