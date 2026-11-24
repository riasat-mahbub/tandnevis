import { useEffect, useId, useRef, useState } from 'react';
import { Maximize2, Minimize2, Plus, RotateCcw, ZoomIn, ZoomOut } from 'lucide-react';
import { invoke, isTauri } from '@tauri-apps/api/core';
import { save } from '@tauri-apps/plugin-dialog';
import type { ProjectSnapshot } from '../services/project';
import type { Workspace } from '../services/workspace';
import { orderedScenes, relationshipKey, relationshipStates } from '../services/relationships';
import type { RelationshipChange } from '../services/relationships';
import './RelationshipPanel.css';

interface Props {
  project: ProjectSnapshot; workspace: Workspace; locked: boolean; sceneId?: string;
  run: (action: () => Promise<unknown>) => void;
}
export default function RelationshipPanel(props: Props) {
  const [scene, setScene] = useState('');
  const [phase, setPhase] = useState<'before' | 'after'>('before');
  const [expanded, setExpanded] = useState(false);
  const [visited, setVisited] = useState(false);
  const sceneId = props.sceneId ?? (props.project.scenes.some(s => s.id === scene) ? scene : '');
  return <details className={`relationship-panel ${expanded ? 'relationship-expanded' : ''}`} onToggle={e => { if (e.currentTarget.open) setVisited(true); }}>
    <summary>Character relationships <span>Before and after each scene</span></summary>
    {visited && <div className="relationship-body">
      <div className="relationship-toolbar">
        {props.sceneId === undefined && <label>Story position<select aria-label="Relationship story position" value={sceneId} onChange={e => setScene(e.target.value)}><option value="">Initial story relationships</option>{orderedScenes(props.project).map(s => <option key={s.id} value={s.id}>{props.project.chapters.find(c => c.id === s.chapterId)?.title} · {s.title}</option>)}</select></label>}
        {sceneId && <div className="relationship-phase" aria-label="Relationship state"><button type="button" aria-pressed={phase === 'before'} onClick={() => setPhase('before')}>Before</button><button type="button" aria-pressed={phase === 'after'} onClick={() => setPhase('after')}>After</button></div>}
        <button type="button" className="quiet" onClick={() => setExpanded(!expanded)}>{expanded ? <Minimize2 size={15}/> : <Maximize2 size={15}/>} {expanded ? 'Compact graph' : 'Expand graph'}</button>
      </div>
      <p className="muted relationship-explanation">{!sceneId ? 'Establish the relationships at the beginning of your story.' : phase === 'before' ? 'Inherited from earlier scenes in story order. Edits here correct the state entering this scene.' : 'Edit the relationships this scene changes. Unchanged relationships carry forward. Planned outcomes guide the AI; mark them established after reviewing the prose.'} Events and dialogue belong in the scene summary and beats.</p>
      <RelationshipEditor key={`${sceneId}:${phase}`} {...props} sceneId={sceneId} phase={sceneId ? phase : 'before'}/>
    </div>}
  </details>;
}

function RelationshipEditor({ project, workspace, locked, run, sceneId = '', phase }: Props & { phase: 'before' | 'after' }) {
  const [focus, setFocus] = useState<string[]>([]);
  const [search, setSearch] = useState('');
  const [familyOnly, setFamilyOnly] = useState(false);
  const [labels, setLabels] = useState(true);
  const [editing, setEditing] = useState<RelationshipChange | 'new' | null>(null);
  const states = relationshipStates(project, sceneId);
  const current = states[phase];
  const visible = current.filter(r => r.description && (!familyOnly || r.kind === 'family') && (!focus.length || focus.includes(r.sourceId) || focus.includes(r.targetId)));
  const ids = new Set(visible.flatMap(r => [r.sourceId, r.targetId]));
  focus.forEach(id => ids.add(id));
  const characters = project.characters.filter(c => !focus.length || ids.has(c.id));
  const own = (project.relationshipChanges ?? []).filter(r => r.sceneId === sceneId && r.phase === phase);
  const name = (id: string) => project.characters.find(c => c.id === id)?.name ?? 'Unknown character';
  const update = (r: RelationshipChange, description: string, status = r.status) => workspace.dispatch({ type: 'setRelationship', change: { ...r, sceneId, phase, description, status: sceneId ? status : 'established' } });
  return <>
    <div className="relationship-filters">
      <label>Find a character<select value="" onChange={e => { if (e.target.value) setFocus(ids => [...new Set([...ids, e.target.value])]); }}><option value="">Choose to focus…</option>{project.characters.map(c => <option key={c.id} value={c.id}>{c.name}{c.archived ? ' (archived)' : ''}</option>)}</select></label>
      <label className="relationship-check"><input type="checkbox" checked={familyOnly} onChange={e => setFamilyOnly(e.target.checked)}/>Family only</label>
      <label className="relationship-check"><input type="checkbox" checked={labels} onChange={e => setLabels(e.target.checked)}/>Show labels</label>
      <button type="button" disabled={!focus.length} onClick={() => { setFocus([]); setSearch(''); }}>Show all</button>
      <button type="button" disabled={locked || project.characters.length < 2} onClick={() => setEditing('new')}><Plus size={15}/>Add relationship</button>
    </div>
    {!!focus.length && <div className="relationship-focus">Focus: {focus.map(id => <button type="button" key={id} onClick={() => setFocus(ids => ids.filter(v => v !== id))}>{name(id)} · Remove focus</button>)}</div>}
    {!project.characters.length ? <p className="relationship-empty">Create characters in Story Library to begin mapping their relationships.</p> : <div className="relationship-workspace">
      <RelationshipGraph characters={characters} relations={visible} own={own} labels={labels} focus={focus} onFocus={id => setFocus(ids => ids.includes(id) ? ids.filter(v => v !== id) : [...ids, id])} onEdit={setEditing}/>
      <div className="relationship-inspector">
        {editing ? <RelationshipForm key={editing === 'new' ? 'new' : editing.id} project={project} value={editing === 'new' ? undefined : editing} sceneId={sceneId} phase={phase} locked={locked} onCancel={() => setEditing(null)} onSave={change => workspace.dispatch({ type: 'setRelationship', change }).then(() => setEditing(null))}/> : <>
          <h3>{sceneId ? `${phase === 'before' ? 'Entering' : 'Resulting'} relationships` : 'Initial relationships'}</h3>
          <p className="muted">Select a connection to edit it. Select character boxes to focus on one or several people.</p>
          <label className="relationship-list-search">Search relationships<input type="search" value={search} onChange={e => setSearch(e.target.value)} placeholder="Name or description"/></label>
          <ul className="relationship-list">{visible.filter(r => `${name(r.sourceId)} ${name(r.targetId)} ${r.description}`.toLocaleLowerCase().includes(search.toLocaleLowerCase())).map(r => {
            const local = own.find(o => relationshipKey(o) === relationshipKey(r));
            return <li key={r.id} className={local ? 'relationship-changed' : ''}>
              <button type="button" className="relationship-open" onClick={() => setEditing(r)}><strong>{name(r.sourceId)} {r.mutual ? '↔' : '→'} {name(r.targetId)}</strong><span>{r.description}</span><small>{r.kind} · {r.status}{local && sceneId ? ' · edited here' : ''}{!local && sceneId ? ' · inherited' : ''}</small></button>
              <div className="relationship-row-actions"><button type="button" disabled={locked} onClick={() => run(() => update(r, '', sceneId && phase === 'after' ? 'planned' : 'established'))}>Clear at this point</button>{local && <button type="button" disabled={locked} onClick={() => run(() => workspace.dispatch({ type: 'removeRelationshipChange', changeId: local.id }))}>{sceneId ? 'Use inherited state' : 'Remove initial relationship'}</button>}{local && local.status === 'planned' && <button type="button" disabled={locked} onClick={() => run(() => update(r, r.description, 'established'))}>Mark established</button>}</div>
            </li>;
          })}</ul>
          {!visible.length && <p className="relationship-empty">{familyOnly || focus.length ? 'No relationships match this view.' : 'No relationships specified at this point. Add a relationship to connect two characters.'}</p>}
          {own.filter(r => !r.description).map(r => <div className="relationship-cleared" key={r.id}><p>{name(r.sourceId)} {r.mutual ? '↔' : '→'} {name(r.targetId)} · {r.kind} cleared · {r.status}</p><button type="button" disabled={locked} onClick={() => run(() => workspace.dispatch({ type: 'removeRelationshipChange', changeId: r.id }))}>Undo clear</button>{r.status === 'planned' && <button type="button" disabled={locked} onClick={() => run(() => update(r, '', 'established'))}>Mark established</button>}</div>)}
        </>}
      </div>
    </div>}
    {!!sceneId && <details className="relationship-cast"><summary>Additional characters for AI context</summary><p className="muted">Characters linked in the summary or beats, and both ends of relationships edited in this scene, are included automatically. Add relevant offstage characters here. Inclusion does not establish presence or shared knowledge.</p><div>{project.characters.map(c => <label key={c.id}><input type="checkbox" disabled={locked} checked={(project.relationshipCast?.[sceneId] ?? []).includes(c.id)} onChange={e => { const cast = project.relationshipCast?.[sceneId] ?? []; run(() => workspace.dispatch({ type: 'setRelationshipCast', sceneId, characterIds: e.target.checked ? [...cast, c.id] : cast.filter(id => id !== c.id) })); }}/>{c.name}{c.archived ? ' (archived)' : ''}</label>)}</div></details>}
    <p className="relationship-footnote">Solid lines: attitudes. Dashed lines: family. Arrows show direction; shared ties have no arrows. Orange connections changed at this point. Story order controls inheritance, including after reordering. For a flashback, correct its Before state and the following scene’s Before state explicitly.</p>
  </>;
}

function RelationshipForm({ project, value, sceneId, phase, locked, onCancel, onSave }: {
  project: ProjectSnapshot; value?: RelationshipChange; sceneId: string; phase: 'before' | 'after'; locked: boolean;
  onCancel: () => void; onSave: (change: Omit<RelationshipChange, 'id'>) => Promise<unknown>;
}) {
  const [sourceId, setSource] = useState(value?.sourceId ?? project.characters[0]?.id ?? '');
  const [targetId, setTarget] = useState(value?.targetId ?? project.characters[1]?.id ?? '');
  const [kind, setKind] = useState<RelationshipChange['kind']>(value?.kind ?? 'attitude');
  const [mutual, setMutual] = useState(value?.mutual ?? false);
  const [description, setDescription] = useState(value?.description ?? '');
  const [status, setStatus] = useState<RelationshipChange['status']>(value?.sceneId === sceneId && value.phase === phase ? value.status : sceneId && phase === 'after' ? 'planned' : 'established');
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const options = project.characters.map(c => <option value={c.id} key={c.id}>{c.name}{c.archived ? ' (archived)' : ''}</option>);
  return <form className="relationship-form" onSubmit={e => { e.preventDefault(); setBusy(true); setError(''); void onSave({ sourceId, targetId, kind, mutual, description: description.trim(), sceneId, phase, status: sceneId ? status : 'established' }).catch(e => setError(e instanceof Error ? e.message : String(e))).finally(() => setBusy(false)); }}>
    <h3>{value ? 'Edit relationship' : 'New relationship'}</h3>
    <fieldset disabled={locked || busy}>
      <label>From<select value={sourceId} disabled={!!value} onChange={e => setSource(e.target.value)}>{options}</select></label>
      <label>To<select value={targetId} disabled={!!value} onChange={e => setTarget(e.target.value)}>{options}</select></label>
      <label>Relationship kind<select value={kind} disabled={!!value} onChange={e => setKind(e.target.value as typeof kind)}><option value="attitude">Attitude</option><option value="family">Family tie</option></select></label>
      <label>Direction<select value={mutual ? 'shared' : 'directed'} disabled={!!value} onChange={e => setMutual(e.target.value === 'shared')}><option value="directed">From → To</option><option value="shared">Shared ↔</option></select></label>
      <label>Description<textarea autoFocus rows={5} maxLength={5000} value={description} onChange={e => setDescription(e.target.value)} placeholder="Describe the relationship, including tensions that remain." required/></label>
      {!!sceneId && <label>Outcome status<select value={status} onChange={e => setStatus(e.target.value as typeof status)}><option value="planned">Planned</option><option value="established">Established</option></select></label>}
      {sourceId === targetId && <p role="alert">Choose two different characters.</p>}
      {error && <p role="alert">{error}</p>}
      <div className="relationship-form-actions"><button className="primary" type="submit" disabled={!description.trim() || sourceId === targetId}>{busy ? 'Applying…' : 'Apply relationship'}</button><button type="button" onClick={onCancel}>Cancel</button></div>
    </fieldset>
    <p className="muted">Changes join project Undo/Redo. Use Save to keep them in the project file.</p>
  </form>;
}

function RelationshipGraph({ characters, relations, own, labels, focus, onFocus, onEdit }: {
  characters: ProjectSnapshot['characters']; relations: RelationshipChange[]; own: RelationshipChange[]; labels: boolean; focus: string[];
  onFocus: (id: string) => void; onEdit: (r: RelationshipChange) => void;
}) {
  const [zoom, setZoom] = useState(1);
  const [exportError, setExportError] = useState('');
  const [exporting, setExporting] = useState(false);
  const [offsets, setOffsets] = useState<Record<string, { x: number; y: number }>>({});
  const viewport = useRef<HTMLDivElement>(null), svg = useRef<SVGSVGElement>(null);
  const drag = useRef<{ x: number; y: number; left: number; top: number; id?: string; dx: number; dy: number; moved: boolean } | null>(null);
  const suppressClick = useRef(false);
  const marker = `relationship-arrow-${useId().replace(/[^a-zA-Z0-9]/g, '')}`;
  const radius = Math.max(175, characters.length * 32), size = radius * 2 + 240;
  const points = new Map(characters.map((c, i) => {
    const angle = characters.length === 2 ? i * Math.PI : i * 2 * Math.PI / Math.max(1, characters.length) - Math.PI / 2;
    return [c.id, { x: size / 2 + (characters.length === 1 ? 0 : Math.cos(angle) * radius), y: size / 2 + (characters.length === 1 ? 0 : Math.sin(angle) * radius) }];
  }));
  const geometry = (r: RelationshipChange) => {
    const a = points.get(r.sourceId), b = points.get(r.targetId); if (!a || !b) return null;
    const dx = b.x - a.x, dy = b.y - a.y, len = Math.hypot(dx, dy) || 1;
    const same = relations.filter(v => (v.sourceId === r.sourceId && v.targetId === r.targetId) || (v.sourceId === r.targetId && v.targetId === r.sourceId));
    const lane = same.findIndex(v => v.id === r.id) - (same.length - 1) / 2;
    const direction = r.sourceId < r.targetId ? 1 : -1;
    const offset = offsets[r.id] ?? { x: 0, y: 0 };
    return { ax: a.x + dx / len * 73, ay: a.y + dy / len * 32, bx: b.x - dx / len * 73, by: b.y - dy / len * 32,
      mx: (a.x + b.x) / 2 - dy / len * lane * 100 * direction + offset.x,
      my: (a.y + b.y) / 2 + dx / len * lane * 100 * direction + offset.y, offset };
  };
  const extents = [...points.values()].map(p => ({ x: p.x, y: p.y, w: 92, h: 38 }));
  for (const r of relations) { const g = geometry(r); if (g) extents.push({ x: g.mx, y: g.my, w: 110, h: 38 }); }
  const minX = Math.min(0 + size / 2, ...extents.map(p => p.x - p.w)) - 24;
  const minY = Math.min(0 + size / 2, ...extents.map(p => p.y - p.h)) - 24;
  const viewWidth = Math.max(size / 2, ...extents.map(p => p.x + p.w)) + 24 - minX;
  const viewHeight = Math.max(size / 2, ...extents.map(p => p.y + p.h)) + 24 - minY;
  const fit = () => { setZoom(Math.max(.2, Math.min(1, (viewport.current?.clientWidth ?? viewWidth) / viewWidth, (viewport.current?.clientHeight ?? viewHeight) / viewHeight))); viewport.current?.scrollTo?.(0, 0); };
  const topologyKey = characters.map(c => c.id).join('|');
  // Fit when opening the graph or changing its focused characters; manual zoom/label moves stay put.
  useEffect(() => { fit(); }, [topologyKey]);
  const exportSvg = async () => {
    if (!svg.current) return;
    setExportError(''); setExporting(true);
    try {
    const copy = svg.current.cloneNode(true) as SVGSVGElement;
    // Inline computed presentation so the saved graph remains readable outside the app.
    const originals = [svg.current, ...svg.current.querySelectorAll('*')];
    [copy, ...copy.querySelectorAll('*')].forEach((node, index) => { const style = getComputedStyle(originals[index]); for (const key of ['fill', 'stroke', 'stroke-width', 'stroke-dasharray', 'font-family', 'font-size', 'font-weight']) (node as SVGElement).style.setProperty(key, style.getPropertyValue(key)); });
    copy.setAttribute('xmlns', 'http://www.w3.org/2000/svg'); copy.setAttribute('width', String(viewWidth)); copy.setAttribute('height', String(viewHeight));
    copy.style.width = `${viewWidth}px`; copy.style.minHeight = '0';
    copy.style.background = getComputedStyle(viewport.current!).backgroundColor;
    const contents = new XMLSerializer().serializeToString(copy);
    if (isTauri()) {
      const selected = await save({ title: 'Save relationship graph', defaultPath: 'character-relationships.svg', filters: [{ name: 'SVG graph', extensions: ['svg'] }] });
      if (selected) await invoke('write_relationship_svg', { path: /\.svg$/i.test(selected) ? selected : `${selected}.svg`, contents });
      return;
    }
    const url = URL.createObjectURL(new Blob([contents], { type: 'image/svg+xml' }));
    const a = document.createElement('a'); a.href = url; a.download = 'character-relationships.svg'; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (error) { setExportError(error instanceof Error ? error.message : String(error)); }
    finally { setExporting(false); }
  };
  return <div className="relationship-map">
    <div className="relationship-map-controls"><button type="button" aria-label="Zoom out relationship graph" disabled={zoom <= .2} onClick={() => setZoom(z => Math.max(.2, z - .25))}><ZoomOut size={15}/></button><output aria-label="Relationship graph zoom">{Math.round(zoom * 100)}%</output><button type="button" aria-label="Zoom in relationship graph" disabled={zoom >= 3} onClick={() => setZoom(z => Math.min(3, z + .25))}><ZoomIn size={15}/></button><button type="button" onClick={fit}>Fit</button><button type="button" onClick={() => setOffsets({})} disabled={!Object.keys(offsets).length}><RotateCcw size={13}/>Reset labels</button><button type="button" disabled={exporting} onClick={() => { void exportSvg(); }}>{exporting ? 'Saving SVG…' : 'Save SVG'}</button></div>
    {exportError && <p role="alert">{exportError}</p>}
    <div ref={viewport} className="relationship-viewport" tabIndex={0} aria-label="Relationship graph. Scroll or drag the background to pan. Use arrow keys to scroll." onKeyDown={e => { if (e.target !== e.currentTarget) return; const d = ({ ArrowLeft: [-60, 0], ArrowRight: [60, 0], ArrowUp: [0, -60], ArrowDown: [0, 60] } as Record<string, number[]>)[e.key]; if (d) { e.preventDefault(); e.currentTarget.scrollLeft += d[0]; e.currentTarget.scrollTop += d[1]; } }} onPointerDown={e => {
      if (e.button !== 0 || (e.target as Element).closest('[data-character], [data-connection]')) return;
      e.currentTarget.setPointerCapture(e.pointerId); drag.current = { x: e.clientX, y: e.clientY, left: e.currentTarget.scrollLeft, top: e.currentTarget.scrollTop, dx: 0, dy: 0, moved: false };
    }} onPointerMove={e => { const d = drag.current; if (!d) return; const dx = e.clientX - d.x, dy = e.clientY - d.y; if (Math.abs(dx) + Math.abs(dy) > 3) d.moved = true; if (d.id) { const ratio = viewWidth / (svg.current?.getBoundingClientRect().width || viewWidth); setOffsets(o => ({ ...o, [d.id!]: { x: d.dx + dx * ratio, y: d.dy + dy * ratio } })); } else { e.currentTarget.scrollLeft = d.left - dx; e.currentTarget.scrollTop = d.top - dy; } }} onPointerUp={() => { suppressClick.current = !!drag.current?.moved; drag.current = null; }} onPointerCancel={() => { drag.current = null; }}>
      <svg ref={svg} viewBox={`${minX} ${minY} ${viewWidth} ${viewHeight}`} style={{ width: `${viewWidth * zoom}px` }} role="group" aria-label="Character relationship map">
        <defs><marker id={marker} viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0 0 10 5 0 10z" className="relationship-arrow"/></marker></defs>
        {relations.map((r, index) => {
          const g = geometry(r); if (!g) return null;
          const { ax, ay, bx, by, mx, my, offset } = g;
          const changed = own.some(o => relationshipKey(o) === relationshipKey(r));
          return <g key={r.id} className={`relationship-edge ${changed ? 'relationship-edge-changed' : ''}`}>
            <path d={`M${ax},${ay} Q${2 * mx - (ax + bx) / 2},${2 * my - (ay + by) / 2} ${bx},${by}`} fill="none" strokeDasharray={r.kind === 'family' ? '7 5' : undefined} markerEnd={r.mutual ? undefined : `url(#${marker})`}/>
            {labels && <g className="relationship-edge-label" data-connection={r.id} role="button" tabIndex={0} aria-label={`Edit ${characters.find(c => c.id === r.sourceId)?.name} ${r.mutual ? 'and' : 'toward'} ${characters.find(c => c.id === r.targetId)?.name}: ${r.description}`} onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onEdit(r); } }} onClick={() => { if (!suppressClick.current) onEdit(r); suppressClick.current = false; }} onPointerDown={e => { if (e.button !== 0) return; e.stopPropagation(); suppressClick.current = false; e.currentTarget.setPointerCapture(e.pointerId); drag.current = { id: r.id, x: e.clientX, y: e.clientY, left: 0, top: 0, dx: offset.x, dy: offset.y, moved: false }; }}>
              <title>{r.description} ({r.kind}; {r.status})</title><rect x={mx - 94} y={my - 22} width="188" height="44" rx="4"/><text x={mx} y={my - 3} textAnchor="middle">{r.description.length > 26 ? `${r.description.slice(0, 25)}…` : r.description}<tspan x={mx} dy="15" className="relationship-edge-status">{r.kind} · {r.status}</tspan></text>
            </g>}
            <title>{index + 1}. {r.description}</title>
          </g>;
        })}
        {characters.map(c => { const p = points.get(c.id)!; return <g key={c.id} data-character={c.id} role="button" tabIndex={0} aria-label={`Focus ${c.name}${c.archived ? ' (archived)' : ''}`} aria-pressed={focus.includes(c.id)} className={`relationship-node ${focus.includes(c.id) ? 'relationship-node-selected' : ''}`} onClick={() => onFocus(c.id)} onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onFocus(c.id); } }}><title>{c.name}{c.archived ? ' (archived)' : ''}</title><rect x={p.x - 80} y={p.y - 25} width="160" height="50" rx="5"/><text x={p.x} y={p.y + 5} textAnchor="middle">{c.name.length > 20 ? `${c.name.slice(0, 19)}…` : c.name}</text></g>; })}
      </svg>
    </div>
    <p className="muted relationship-map-hint">{characters.length} characters · {relations.length} connections. Drag label boxes to move them. Full descriptions appear beside the graph.</p>
  </div>;
}
