import { useEffect, useId, useRef, useState } from 'react';
import { Maximize2, Minimize2, ZoomIn, ZoomOut } from 'lucide-react';
import type { ProjectSnapshot } from '../services/project';
import type { Workspace } from '../services/workspace';
import { orderedScenes, relationshipKey, relationshipStates } from '../services/relationships';
import type { RelationshipChange } from '../services/relationships';
import './RelationshipPanel.css';

type Point = { x: number; y: number };
type RelationshipDraft = Omit<RelationshipChange, 'id'> & { id?: string };
const EMPTY_LAYOUT: Record<string, Point> = {};

interface Props {
  project: ProjectSnapshot;
  workspace: Workspace;
  locked: boolean;
  sceneId?: string;
  openRequest?: number;
  editChangeId?: string;
  editRequest?: number;
  createRequest?: number;
  run: (action: () => Promise<unknown>) => void;
}

export default function RelationshipPanel(props: Props) {
  const [scene, setScene] = useState('');
  const [phase, setPhase] = useState<'before' | 'after'>('before');
  const [expanded, setExpanded] = useState(false);
  const [visited, setVisited] = useState(false);
  const panel = useRef<HTMLDetailsElement>(null);
  const sceneId = props.sceneId ?? (props.project.scenes.some(item => item.id === scene) ? scene : '');

  const openPanel = (focusSummary = false) => {
    setVisited(true);
    if (panel.current) {
      panel.current.open = true;
      panel.current.scrollIntoView({ block: 'start' });
      if (focusSummary) panel.current.querySelector('summary')?.focus({ preventScroll: true });
    }
  };

  useEffect(() => {
    if (props.openRequest) openPanel(true);
  }, [props.openRequest]);

  useEffect(() => {
    if (!props.editRequest || !props.editChangeId) return;
    const change = props.project.relationshipChanges?.find(item => item.id === props.editChangeId);
    if (change && (!props.sceneId || change.sceneId === props.sceneId)) setPhase(change.phase);
    openPanel();
  }, [props.editRequest, props.editChangeId, props.sceneId]);

  useEffect(() => {
    if (props.createRequest) openPanel();
  }, [props.createRequest]);

  return <details
    ref={panel}
    className={'relationship-panel' + (expanded ? ' relationship-expanded' : '')}
    onToggle={event => { if (event.currentTarget.open) setVisited(true); }}
  >
    <summary>Character graph <span>Relationships before and after each scene</span></summary>
    {visited && <div className="relationship-body">
      <div className="relationship-toolbar">
        {props.sceneId === undefined && <label>Story position
          <select aria-label="Relationship story position" value={sceneId} onChange={event => setScene(event.target.value)}>
            <option value="">Initial story relationships</option>
            {orderedScenes(props.project).map(item => <option key={item.id} value={item.id}>
              {props.project.chapters.find(chapter => chapter.id === item.chapterId)?.title} · {item.title}
            </option>)}
          </select>
        </label>}
        {sceneId && <div className="relationship-phase" aria-label="Relationship state">
          <button type="button" aria-pressed={phase === 'before'} onClick={() => setPhase('before')}>Before</button>
          <button type="button" aria-pressed={phase === 'after'} onClick={() => setPhase('after')}>After</button>
        </div>}
        <button type="button" className="quiet relationship-expand" onClick={() => setExpanded(value => !value)}>
          {expanded ? <Minimize2 size={15}/> : <Maximize2 size={15}/>} {expanded ? 'Compact graph' : 'Expand graph'}
        </button>
      </div>
      <p className="muted relationship-explanation">
        {!sceneId
          ? 'Establish relationships at the beginning of your story.'
          : phase === 'before'
            ? 'This is the relationship state entering this scene. Edits here correct that entry state.'
            : 'This is the target state after this scene. Planned outcomes guide the AI; mark them established after reviewing the prose.'}
        {' '}Events and dialogue belong in the scene summary and beats.
      </p>
      <RelationshipEditor
        key={props.project.projectId + ':' + sceneId}
        {...props}
        sceneId={sceneId}
        phase={sceneId ? phase : 'before'}
      />
    </div>}
  </details>;
}

function RelationshipEditor({ project, workspace, locked, run, sceneId = '', phase, editChangeId, editRequest, createRequest }: Props & {
  phase: 'before' | 'after';
}) {
  const [focus, setFocus] = useState<string[]>([]);
  const [search, setSearch] = useState('');
  const [familyOnly, setFamilyOnly] = useState(false);
  const [editing, setEditing] = useState<RelationshipChange | RelationshipDraft | null>(null);
  const [selectedId, setSelectedId] = useState('');
  const lastEditRequest = useRef<number | undefined>(undefined);
  const pendingPhaseEdit = useRef<{ request: number; id: string } | null>(null);
  const previousPhase = useRef(phase);
  const states = relationshipStates(project, sceneId);
  const current = states[phase];
  const own = (project.relationshipChanges ?? []).filter(change => change.sceneId === sceneId && change.phase === phase);
  const name = (id: string) => project.characters.find(character => character.id === id)?.name ?? 'Unknown character';
  const query = search.trim().toLocaleLowerCase();
  const visible = current.filter(change => {
    const namesAndDescription = (name(change.sourceId) + ' ' + name(change.targetId) + ' ' + change.description).toLocaleLowerCase();
    return !!change.description
      && (!familyOnly || change.kind === 'family')
      && (!focus.length || focus.includes(change.sourceId) || focus.includes(change.targetId))
      && (!query || namesAndDescription.includes(query));
  });
  const visibleIds = new Set(visible.flatMap(change => [change.sourceId, change.targetId]));
  const namedIds = new Set(project.characters
    .filter(character => !query || character.name.toLocaleLowerCase().includes(query))
    .map(character => character.id));
  focus.forEach(id => visibleIds.add(id));
  const characters = project.characters.filter(character => {
    if (!focus.length && !query) return true;
    return visibleIds.has(character.id) || namedIds.has(character.id);
  });
  const selected = current.find(change => change.id === selectedId && !!change.description);
  const selectedOwn = selected && own.find(change => relationshipKey(change) === relationshipKey(selected));

  useEffect(() => {
    if (previousPhase.current === phase) return;
    previousPhase.current = phase;
    const pending = pendingPhaseEdit.current;
    const requested = pending && pending.request === editRequest
      ? project.relationshipChanges?.find(item => item.id === pending.id)
      : undefined;
    if (requested?.phase === phase) {
      pendingPhaseEdit.current = null;
      setSelectedId(requested.id);
      setEditing(requested);
      return;
    }
    setSelectedId('');
    setEditing(null);
  }, [phase, editRequest, editChangeId]);

  useEffect(() => {
    if (lastEditRequest.current !== undefined && lastEditRequest.current === editRequest) return;
    lastEditRequest.current = editRequest;
    if (!editRequest || !editChangeId) return;
    const change = project.relationshipChanges?.find(item => item.id === editChangeId);
    if (!change) return;
    pendingPhaseEdit.current = change.phase !== phase ? { request: editRequest, id: change.id } : null;
    setSelectedId(change.id);
    setEditing(change);
  }, [editRequest, editChangeId]);

  const focusChangeBlock = (change: RelationshipChange) => {
    if (!sceneId || change.sceneId !== sceneId) return;
    window.dispatchEvent(new CustomEvent('shorthand:focus-relationship-change', {
      detail: { sceneId, changeId: change.id },
    }));
  };

  const editEdge = (change: RelationshipChange) => {
    setSelectedId(change.id);
    setEditing(change);
    focusChangeBlock(change);
  };

  const saveChange = async (change: RelationshipDraft, original: RelationshipChange | RelationshipDraft | null) => {
    if (locked) throw new Error('Relationship editing is unavailable right now.');
    await workspace.flush();
    const latest = workspace.getSnapshot().project;
    if (!latest) throw new Error('Open a project before editing relationships.');
    const normalized: RelationshipDraft = { ...change };
    if (normalized.mutual && normalized.sourceId > normalized.targetId) {
      [normalized.sourceId, normalized.targetId] = [normalized.targetId, normalized.sourceId];
    }
    const identity = relationshipKey(normalized as RelationshipChange);
    const collision = (latest.relationshipChanges ?? []).find(item =>
      item.sceneId === sceneId && item.phase === phase && relationshipKey(item) === identity && item.id !== original?.id,
    );
    if (collision) throw new Error('A relationship with this direction and type already exists here. Select that connection to edit it.');

    const payload: RelationshipDraft = {
      ...normalized,
      sceneId,
      phase,
      status: sceneId ? normalized.status : 'established',
      ...(original?.id ? { id: original.id } : {}),
    };
    if (original?.id && relationshipKey(original as RelationshipChange) !== identity) {
      await workspace.dispatch({
        type: 'replaceRelationship',
        previousChangeId: original.id,
        change: payload as Omit<RelationshipChange, 'id'>,
      });
    } else {
      // Passing the selected id lets a local summary block survive description edits.
      await workspace.dispatch({ type: 'setRelationship', change: payload as Omit<RelationshipChange, 'id'> });
    }
    setEditing(null);
    setSelectedId('');
  };

  const mutate = (action: () => Promise<unknown>) => run(async () => {
    await workspace.flush();
    await action();
  });

  const endRelationship = (change: RelationshipChange) => {
    const ended: RelationshipDraft = {
      sourceId: change.sourceId,
      targetId: change.targetId,
      kind: change.kind,
      mutual: change.mutual,
      sceneId,
      phase,
      description: '',
      status: sceneId ? change.status : 'established',
      ...(change.sceneId === sceneId && change.phase === phase ? { id: change.id } : {}),
    };
    return workspace.dispatch({ type: 'setRelationship', change: ended as Omit<RelationshipChange, 'id'> });
  };

  const removeLocalChange = (change: RelationshipChange) => workspace.dispatch({ type: 'removeRelationshipChange', changeId: change.id });

  const onConnection = (sourceId: string, targetId: string) => {
    if (locked || sourceId === targetId) return;
    const existing = current.find(change => change.description
      && change.kind === 'attitude'
      && !change.mutual
      && change.sourceId === sourceId
      && change.targetId === targetId);
    if (existing) {
      editEdge(existing);
      return;
    }
    setSelectedId('');
    setEditing({
      sourceId,
      targetId,
      kind: 'attitude',
      mutual: false,
      sceneId,
      phase,
      description: '',
      status: sceneId && phase === 'after' ? 'planned' : 'established',
    });
  };

  return <>
    <div className="relationship-filters">
      <label className="relationship-search-label">Search characters or relationships
        <input type="search" value={search} onChange={event => setSearch(event.target.value)} placeholder="Name or relationship label"/>
      </label>
      <label className="relationship-find-label">Focus a character
        <select value="" onChange={event => {
          if (event.target.value) setFocus(ids => [...new Set([...ids, event.target.value])]);
        }}>
          <option value="">Choose a character…</option>
          {project.characters.map(character => <option key={character.id} value={character.id}>
            {character.name}{character.archived ? ' (archived)' : ''}
          </option>)}
        </select>
      </label>
      <label className="relationship-check"><input type="checkbox" checked={familyOnly} onChange={event => setFamilyOnly(event.target.checked)}/>Family only</label>
      <button type="button" disabled={!focus.length && !search && !familyOnly} onClick={() => {
        setFocus([]);
        setSearch('');
        setFamilyOnly(false);
      }}>Show all</button>
    </div>
    {!!focus.length && <div className="relationship-focus">
      <span>Focus:</span>
      {focus.map(id => <button type="button" key={id} onClick={() => setFocus(ids => ids.filter(value => value !== id))}>
        {name(id)} <span aria-hidden="true">×</span>
      </button>)}
    </div>}
    {!project.characters.length
      ? <p className="relationship-empty">Create characters in Story Library to begin mapping their relationships.</p>
      : !characters.length ? <p className="relationship-empty">No characters or connections match this search.</p>
      : <div className="relationship-workspace">
        <RelationshipGraph
          allCharacters={project.characters}
          characters={characters}
          relations={visible}
          layout={project.relationshipLayout ?? EMPTY_LAYOUT}
          selectedId={selectedId}
          changedIds={own.map(change => change.id)}
          focus={focus}
          locked={locked}
          createRequest={createRequest ?? 0}
          onFocus={id => setFocus(ids => ids.includes(id) ? ids.filter(value => value !== id) : [...ids, id])}
          onEdit={editEdge}
          onConnect={onConnection}
          onLayout={positions => mutate(async () => {
            const latest = workspace.getSnapshot().project;
            if (!latest) throw new Error('The selected project is unavailable.');
            await workspace.dispatch({
              type: 'setRelationshipLayout',
              positions: { ...(latest.relationshipLayout ?? {}), ...positions },
            });
          })}
        />
        <aside className="relationship-inspector" aria-label="Selected relationship">
          {editing
            ? <RelationshipForm
              key={editing.id ?? (editing.sourceId + ':' + editing.targetId)}
              project={project}
              value={editing}
              sceneId={sceneId}
              phase={phase}
              locked={locked}
              onCancel={() => setEditing(null)}
              onSave={change => saveChange(change, editing)}
            />
            : selected
              ? <div className="relationship-selected">
                <h3>Selected relationship</h3>
                <p className="relationship-endpoints">
                  <strong>{name(selected.sourceId)}</strong>
                  <span aria-label={selected.mutual ? 'shared relationship' : 'toward'}>{selected.mutual ? '↔' : '→'}</span>
                  <strong>{name(selected.targetId)}</strong>
                </p>
                <p className="relationship-description">{selected.description}</p>
                <p className="muted relationship-meta">{selected.kind === 'family' ? 'Family' : 'Attitude'} · {selected.mutual ? 'Shared' : 'Directed'} · {selected.status}</p>
                <div className="relationship-inspector-actions">
                  <button type="button" disabled={locked} onClick={() => setEditing(selected)}>Edit connection</button>
                  {selectedOwn?.status === 'planned' && <button type="button" disabled={locked} onClick={() => mutate(() => workspace.dispatch({
                    type: 'setRelationship',
                    change: {
                      sourceId: selected.sourceId,
                      targetId: selected.targetId,
                      kind: selected.kind,
                      mutual: selected.mutual,
                      sceneId,
                      phase,
                      description: selected.description,
                      status: 'established',
                      id: selectedOwn.id,
                    } as Omit<RelationshipChange, 'id'>,
                  }))}>Mark established</button>}
                  <button type="button" disabled={locked} onClick={() => mutate(() => endRelationship(selected))}>End relationship here</button>
                  {!!selectedOwn && <button type="button" disabled={locked} onClick={() => mutate(() => removeLocalChange(selectedOwn))}>
                    {sceneId ? 'Use inherited state' : 'Remove initial relationship'}
                  </button>}
                </div>
              </div>
              : <div className="relationship-inspector-empty">
                <h3>Relationship inspector</h3>
                <p className="muted">Select a connection label to edit it. Drag a connector handle from one character to another to start a relationship.</p>
              </div>}
        </aside>
      </div>}
    {!!sceneId && <details className="relationship-cast">
      <summary>Additional characters for AI context</summary>
      <p className="muted">Characters linked in the summary or beats, and both ends of relationships edited in this scene, are included automatically. Add relevant offstage characters here. Inclusion does not establish presence or shared knowledge.</p>
      <div>{project.characters.map(character => <label key={character.id}>
        <input type="checkbox" disabled={locked} checked={(project.relationshipCast?.[sceneId] ?? []).includes(character.id)} onChange={event => {
          const cast = project.relationshipCast?.[sceneId] ?? [];
          const checked = event.target.checked;
          mutate(() => workspace.dispatch({
            type: 'setRelationshipCast',
            sceneId,
            characterIds: checked ? [...cast, character.id] : cast.filter(id => id !== character.id),
          }));
        }}/>
        {character.name}{character.archived ? ' (archived)' : ''}
      </label>)}</div>
    </details>}
    <p className="relationship-footnote">Attitudes are directional; family ties use dashed lines. Arrows show direction, while shared ties have no arrows. Orange lines changed at this point. Before edits correct the entering state; After edits describe the outcome. Story order controls inheritance.</p>
  </>;
}

function RelationshipForm({ project, value, sceneId, phase, locked, onCancel, onSave }: {
  project: ProjectSnapshot;
  value: RelationshipDraft;
  sceneId: string;
  phase: 'before' | 'after';
  locked: boolean;
  onCancel: () => void;
  onSave: (change: RelationshipDraft) => Promise<unknown>;
}) {
  const [kind, setKind] = useState<RelationshipChange['kind']>(value.kind);
  const [mutual, setMutual] = useState(value.mutual);
  const [description, setDescription] = useState(value.description);
  const [status, setStatus] = useState<RelationshipChange['status']>(
    value.sceneId === sceneId && value.phase === phase
      ? value.status
      : sceneId && phase === 'after' ? 'planned' : 'established',
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const source = project.characters.find(character => character.id === value.sourceId)?.name ?? 'Unknown character';
  const target = project.characters.find(character => character.id === value.targetId)?.name ?? 'Unknown character';
  const quickChoices: Array<{ label: string; description: string; kind: RelationshipChange['kind']; mutual: boolean }> = [
    { label: 'Trusts', description: 'Trusts', kind: 'attitude', mutual: false },
    { label: 'Distrusts', description: 'Distrusts', kind: 'attitude', mutual: false },
    { label: 'Friends', description: 'Friends', kind: 'attitude', mutual: true },
    { label: 'Rivals', description: 'Rivals', kind: 'attitude', mutual: true },
    { label: 'Parent of', description: 'Parent of', kind: 'family', mutual: false },
    { label: 'Siblings', description: 'Siblings', kind: 'family', mutual: true },
  ];
  const activeChoice = quickChoices.find(choice =>
    choice.description === description && choice.kind === kind && choice.mutual === mutual,
  )?.label ?? (description.trim() ? 'Custom' : '');

  const applyChoice = (label: string) => {
    const choice = quickChoices.find(item => item.label === label);
    if (!choice) {
      setDescription('');
      return;
    }
    setDescription(choice.description);
    setKind(choice.kind);
    setMutual(choice.mutual);
  };

  return <form className="relationship-form" onSubmit={event => {
    event.preventDefault();
    setBusy(true);
    setError('');
    const nextSource = mutual && value.sourceId > value.targetId ? value.targetId : value.sourceId;
    const nextTarget = mutual && value.sourceId > value.targetId ? value.sourceId : value.targetId;
    void onSave({
      ...value,
      sourceId: nextSource,
      targetId: nextTarget,
      kind,
      mutual,
      description: description.trim(),
      sceneId,
      phase,
      status: sceneId ? status : 'established',
    }).catch(reason => setError(reason instanceof Error ? reason.message : String(reason))).finally(() => setBusy(false));
  }}>
    <h3>{value.id ? 'Edit relationship' : 'New relationship'}</h3>
    <p className="relationship-form-endpoints">
      <span>{source}</span><span aria-label={mutual ? 'shared relationship' : 'toward'}>{mutual ? '↔' : '→'}</span><span>{target}</span>
    </p>
    <fieldset disabled={locked || busy}>
      <legend>Choose a meaning</legend>
      <div className="relationship-presets">
        {quickChoices.map(choice => <button
          type="button"
          key={choice.label}
          aria-pressed={activeChoice === choice.label}
          onClick={() => applyChoice(choice.label)}
        >{choice.label}</button>)}
        <button type="button" aria-pressed={activeChoice === 'Custom'} onClick={() => applyChoice('Custom')}>Custom</button>
      </div>
      <div className="relationship-form-row">
        <label>Type
          <select value={kind} onChange={event => setKind(event.target.value as RelationshipChange['kind'])}>
            <option value="attitude">Attitude</option>
            <option value="family">Family</option>
          </select>
        </label>
        <label>Direction
          <select value={mutual ? 'shared' : 'directed'} onChange={event => setMutual(event.target.value === 'shared')}>
            <option value="directed">Directed</option>
            <option value="shared">Shared</option>
          </select>
        </label>
      </div>
      <label>Relationship label
        <textarea autoFocus rows={3} maxLength={5000} value={description} onChange={event => setDescription(event.target.value)} placeholder="Add a custom label or nuance to the relationship." required/>
      </label>
      {!!sceneId && <label>Outcome status
        <select value={status} onChange={event => setStatus(event.target.value as RelationshipChange['status'])}>
          <option value="planned">Planned</option>
          <option value="established">Established</option>
        </select>
      </label>}
      {error && <p role="alert">{error}</p>}
    </fieldset>
    <div className="relationship-form-actions">
      <button className="primary" type="submit" disabled={locked || busy || !description.trim()}>{busy ? 'Applying…' : 'Apply relationship'}</button>
      <button type="button" disabled={busy} onClick={onCancel}>Cancel</button>
    </div>
    <p className="muted relationship-form-note">Changes join project Undo/Redo. Save the project to keep them in the file.</p>
  </form>;
}

function defaultPositions(characters: ProjectSnapshot['characters']): Record<string, Point> {
  const count = characters.length;
  const radius = Math.max(190, count * 43);
  const center = { x: radius + 180, y: radius + 145 };
  return Object.fromEntries(characters.map((character, index) => {
    const angle = count === 2
      ? index * Math.PI
      : index * Math.PI * 2 / Math.max(1, count) - Math.PI / 2;
    return [character.id, count === 1
      ? center
      : { x: center.x + Math.cos(angle) * radius, y: center.y + Math.sin(angle) * radius }];
  }));
}

function RelationshipGraph({ allCharacters, characters, relations, layout, selectedId, changedIds, focus, locked, createRequest, onFocus, onEdit, onConnect, onLayout }: {
  allCharacters: ProjectSnapshot['characters'];
  characters: ProjectSnapshot['characters'];
  relations: RelationshipChange[];
  layout: Record<string, Point>;
  selectedId: string;
  changedIds: string[];
  focus: string[];
  locked: boolean;
  createRequest: number;
  onFocus: (id: string) => void;
  onEdit: (change: RelationshipChange) => void;
  onConnect: (sourceId: string, targetId: string) => void;
  onLayout: (positions: Record<string, Point>) => void;
}) {
  const [zoom, setZoom] = useState(1);
  const [positions, setPositions] = useState<Record<string, Point>>(() => ({ ...defaultPositions(allCharacters), ...layout }));
  const [connectionSource, setConnectionSource] = useState('');
  const [previewPoint, setPreviewPoint] = useState<Point | null>(null);
  const [hoverTarget, setHoverTarget] = useState('');
  const [message, setMessage] = useState('');
  const [requestMode, setRequestMode] = useState(false);
  const [requestSource, setRequestSource] = useState('');
  const viewport = useRef<HTMLDivElement>(null);
  const svg = useRef<SVGSVGElement>(null);
  const drag = useRef<{
    type: 'pan' | 'node' | 'connector';
    x: number;
    y: number;
    left: number;
    top: number;
    id?: string;
    sourceId?: string;
    start?: Point;
    scale: number;
    moved: boolean;
  } | null>(null);
  const positionsRef = useRef(positions);
  const suppressClick = useRef(false);
  const suppressConnectorClick = useRef(false);
  const [fixedBounds, setFixedBounds] = useState<{ minX: number; minY: number; width: number; height: number } | null>(null);
  const marker = 'relationship-arrow-' + useId().replace(/[^a-zA-Z0-9]/g, '');
  const idsKey = allCharacters.map(character => character.id).join('|');

  useEffect(() => {
    const next = { ...defaultPositions(allCharacters), ...layout };
    positionsRef.current = next;
    setPositions(next);
  }, [layout, idsKey]);

  useEffect(() => {
    if (!createRequest) return;
    setRequestMode(true);
    setRequestSource('');
    setConnectionSource('');
    setMessage('Choose two character boxes to add a relationship change to the summary.');
  }, [createRequest]);

  const points = new Map(characters.map(character => [
    character.id,
    positions[character.id] ?? defaultPositions(allCharacters)[character.id] ?? { x: 300, y: 240 },
  ]));
  const pointToSvg = (clientX: number, clientY: number): Point => {
    const element = svg.current;
    if (!element) return { x: clientX, y: clientY };
    const matrix = element.getScreenCTM?.();
    if (matrix && typeof element.createSVGPoint === 'function') {
      const screenPoint = element.createSVGPoint();
      screenPoint.x = clientX;
      screenPoint.y = clientY;
      const worldPoint = screenPoint.matrixTransform(matrix.inverse());
      return { x: worldPoint.x, y: worldPoint.y };
    }
    const rect = element.getBoundingClientRect();
    const viewBox = element.viewBox.baseVal;
    if (!rect.width || !rect.height || !viewBox.width || !viewBox.height) return { x: clientX, y: clientY };
    return {
      x: viewBox.x + (clientX - rect.left) / rect.width * viewBox.width,
      y: viewBox.y + (clientY - rect.top) / rect.height * viewBox.height,
    };
  };
  const pointFor = (id: string) => points.get(id);
  const findTarget = (clientX: number, clientY: number) => {
    const element = document.elementFromPoint?.(clientX, clientY);
    const hit = element?.closest<SVGGElement>('[data-connector-target], [data-character]');
    const hitId = hit?.getAttribute('data-connector-target') ?? hit?.getAttribute('data-character');
    if (hitId && pointFor(hitId)) return hitId;
    const point = pointToSvg(clientX, clientY);
    return characters.find(character => {
      const node = pointFor(character.id);
      return !!node && Math.abs(point.x - node.x) <= 84 && Math.abs(point.y - node.y) <= 34;
    })?.id ?? '';
  };

  const extents = [...points.values()].map(point => ({ x: point.x, y: point.y, w: 98, h: 48 }));
  const edgeGeometry = (change: RelationshipChange) => {
    const source = pointFor(change.sourceId);
    const target = pointFor(change.targetId);
    if (!source || !target) return null;
    const dx = target.x - source.x;
    const dy = target.y - source.y;
    const length = Math.hypot(dx, dy) || 1;
    const ux = dx / length;
    const uy = dy / length;
    const clip = Math.min(80 / Math.max(Math.abs(ux), 0.0001), 25 / Math.max(Math.abs(uy), 0.0001));
    const ax = source.x + ux * clip;
    const ay = source.y + uy * clip;
    const bx = target.x - ux * clip;
    const by = target.y - uy * clip;
    const siblings = relations.filter(item =>
      (item.sourceId === change.sourceId && item.targetId === change.targetId)
      || (item.sourceId === change.targetId && item.targetId === change.sourceId),
    );
    const lane = siblings.findIndex(item => item.id === change.id) - (siblings.length - 1) / 2;
    const direction = change.sourceId < change.targetId ? 1 : -1;
    const normalX = -uy;
    const normalY = ux;
    const control = {
      x: (ax + bx) / 2 + normalX * lane * 80 * direction,
      y: (ay + by) / 2 + normalY * lane * 80 * direction,
    };
    const label = { x: (ax + 2 * control.x + bx) / 4, y: (ay + 2 * control.y + by) / 4 };
    return { ax, ay, bx, by, control, label };
  };
  for (const relation of relations) {
    const geometry = edgeGeometry(relation);
    if (geometry) extents.push({ x: geometry.label.x, y: geometry.label.y, w: 92, h: 22 });
  }
  const calculatedMinX = Math.min(...extents.map(item => item.x - item.w)) - 30;
  const calculatedMinY = Math.min(...extents.map(item => item.y - item.h)) - 30;
  const calculatedWidth = Math.max(320, ...extents.map(item => item.x + item.w)) + 30 - calculatedMinX;
  const calculatedHeight = Math.max(240, ...extents.map(item => item.y + item.h)) + 30 - calculatedMinY;
  // Hold the viewBox steady while a box moves so pointer coordinates do not jump
  // when the graph's content extents change during the drag.
  const minX = fixedBounds?.minX ?? calculatedMinX;
  const minY = fixedBounds?.minY ?? calculatedMinY;
  const viewWidth = fixedBounds?.width ?? calculatedWidth;
  const viewHeight = fixedBounds?.height ?? calculatedHeight;
  const fit = () => {
    setZoom(Math.max(.2, Math.min(1,
      (viewport.current?.clientWidth ?? viewWidth) / viewWidth,
      (viewport.current?.clientHeight ?? viewHeight) / viewHeight,
    )));
    viewport.current?.scrollTo?.(0, 0);
  };

  useEffect(() => { fit(); }, [idsKey]);

  const commitPair = (sourceId: string, targetId: string) => {
    if (sourceId === targetId) {
      setMessage('Choose a different character for the other endpoint.');
      return;
    }
    setConnectionSource('');
    setPreviewPoint(null);
    setHoverTarget('');
    setRequestMode(false);
    setRequestSource('');
    setMessage('');
    onConnect(sourceId, targetId);
  };

  const startKeyboardConnection = (sourceId: string) => {
    if (locked) return;
    setConnectionSource(sourceId);
    setPreviewPoint(pointFor(sourceId) ?? null);
    setMessage((allCharacters.find(character => character.id === sourceId)?.name ?? 'Character') + ' selected as the source. Choose a target handle or press Escape to cancel.');
  };

  const activateTarget = (targetId: string) => {
    if (!connectionSource) return;
    commitPair(connectionSource, targetId);
  };

  const cancelConnection = () => {
    setConnectionSource('');
    setPreviewPoint(null);
    setHoverTarget('');
    setRequestMode(false);
    setRequestSource('');
    setMessage('Connection cancelled.');
    drag.current = null;
  };

  const activateNode = (id: string) => {
    if (suppressClick.current) {
      suppressClick.current = false;
      return;
    }
    if (requestMode) {
      if (!requestSource) {
        setRequestSource(id);
        setMessage((allCharacters.find(character => character.id === id)?.name ?? 'Character') + ' selected. Choose the other character.');
      } else commitPair(requestSource, id);
      return;
    }
    onFocus(id);
  };

  const beginConnectorDrag = (event: React.PointerEvent<SVGGElement>, sourceId: string) => {
    if (locked || event.button !== 0) return;
    event.stopPropagation();
    const source = pointFor(sourceId);
    drag.current = {
      type: 'connector',
      x: event.clientX,
      y: event.clientY,
      left: 0,
      top: 0,
      sourceId,
      start: source,
      scale: 1 / (svg.current?.getScreenCTM?.()?.a || (svg.current?.getBoundingClientRect().width || viewWidth) / viewWidth),
      moved: false,
    };
    setConnectionSource(sourceId);
    setPreviewPoint(source ?? null);
    setHoverTarget('');
    setMessage((allCharacters.find(character => character.id === sourceId)?.name ?? 'Character') + ' connector selected.');
    try { viewport.current?.setPointerCapture(event.pointerId); } catch { /* Pointer capture is unavailable in some test environments. */ }
  };

  const moveNodeTo = (id: string, point: Point) => {
    const next = { ...positionsRef.current, [id]: point };
    positionsRef.current = next;
    setPositions(next);
  };

  const handlePointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const active = drag.current;
    if (!active) return;
    const dx = event.clientX - active.x;
    const dy = event.clientY - active.y;
    if (Math.abs(dx) + Math.abs(dy) > 3) active.moved = true;
    if (active.type === 'connector') {
      setPreviewPoint(pointToSvg(event.clientX, event.clientY));
      const candidate = findTarget(event.clientX, event.clientY);
      setHoverTarget(candidate && candidate !== active.sourceId ? candidate : '');
    } else if (active.type === 'node' && active.id && active.start) {
      moveNodeTo(active.id, {
        x: active.start.x + dx * active.scale,
        y: active.start.y + dy * active.scale,
      });
    } else if (active.type === 'pan') {
      event.currentTarget.scrollLeft = active.left - dx;
      event.currentTarget.scrollTop = active.top - dy;
    }
  };

  const handlePointerUp = (event: React.PointerEvent<HTMLDivElement>) => {
    const active = drag.current;
    if (!active) return;
    if (active.type === 'connector') {
      const target = findTarget(event.clientX, event.clientY);
      suppressConnectorClick.current = true;
      setTimeout(() => { suppressConnectorClick.current = false; }, 0);
      if (target && target !== active.sourceId) commitPair(active.sourceId!, target);
      else cancelConnection();
    } else if (active.type === 'node' && active.id && active.moved) {
      suppressClick.current = true;
      setTimeout(() => { suppressClick.current = false; }, 0);
      onLayout(positionsRef.current);
      setFixedBounds(null);
    } else if (active.type === 'pan') {
      suppressClick.current = active.moved;
      setTimeout(() => { suppressClick.current = false; }, 0);
    }
    if (active.type === 'node' && !active.moved) setFixedBounds(null);
    drag.current = null;
  };

  const startNodeDrag = (event: React.PointerEvent<SVGGElement>, id: string) => {
    if (locked || event.button !== 0 || (event.target as Element).closest('[data-connector], [data-connector-target]')) return;
    event.stopPropagation();
    const start = pointFor(id);
    if (!start) return;
    drag.current = {
      type: 'node',
      id,
      x: event.clientX,
      y: event.clientY,
      left: 0,
      top: 0,
      start,
      scale: 1 / (svg.current?.getScreenCTM?.()?.a || (svg.current?.getBoundingClientRect().width || viewWidth) / viewWidth),
      moved: false,
    };
    setFixedBounds({ minX, minY, width: viewWidth, height: viewHeight });
    try { viewport.current?.setPointerCapture(event.pointerId); } catch { /* Pointer capture is unavailable in some test environments. */ }
  };

  const announceSourceClick = (id: string) => {
    if (suppressConnectorClick.current) return;
    if (connectionSource) {
      setConnectionSource('');
      setPreviewPoint(null);
      setMessage('Connection cancelled.');
    } else startKeyboardConnection(id);
  };

  return <div className="relationship-map">
    <div className="relationship-map-controls">
      <button type="button" aria-label="Zoom out relationship graph" disabled={zoom <= .2} onClick={() => setZoom(value => Math.max(.2, value - .25))}><ZoomOut size={15}/></button>
      <output aria-label="Relationship graph zoom">{Math.round(zoom * 100)}%</output>
      <button type="button" aria-label="Zoom in relationship graph" disabled={zoom >= 3} onClick={() => setZoom(value => Math.min(3, value + .25))}><ZoomIn size={15}/></button>
      <button type="button" onClick={fit}>Fit</button>
    </div>
    <div
      ref={viewport}
      className="relationship-viewport"
      tabIndex={0}
      aria-label="Relationship graph. Scroll or drag the background to pan."
      onKeyDown={event => {
        if (event.key === 'Escape' && (connectionSource || requestMode || drag.current)) {
          event.preventDefault();
          cancelConnection();
          return;
        }
        if (event.target !== event.currentTarget) return;
        const delta: Record<string, Point> = {
          ArrowLeft: { x: -60, y: 0 },
          ArrowRight: { x: 60, y: 0 },
          ArrowUp: { x: 0, y: -60 },
          ArrowDown: { x: 0, y: 60 },
        };
        const move = delta[event.key];
        if (move) {
          event.preventDefault();
          event.currentTarget.scrollLeft += move.x;
          event.currentTarget.scrollTop += move.y;
        }
      }}
      onPointerDown={event => {
        if (event.button !== 0 || (event.target as Element).closest('[data-character], [data-relationship-edge], [data-connector], [data-connector-target]')) return;
        drag.current = {
          type: 'pan',
          x: event.clientX,
          y: event.clientY,
          left: event.currentTarget.scrollLeft,
          top: event.currentTarget.scrollTop,
          scale: 1,
          moved: false,
        };
        try { event.currentTarget.setPointerCapture(event.pointerId); } catch { /* Pointer capture is unavailable in some test environments. */ }
      }}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={() => {
        const active = drag.current;
        cancelConnection();
        if (active?.type === 'node') setFixedBounds(null);
      }}
    >
      <svg
        ref={svg}
        viewBox={minX + ' ' + minY + ' ' + viewWidth + ' ' + viewHeight}
        style={{ width: (viewWidth * zoom) + 'px' }}
        role="group"
        aria-label="Character relationship map"
      >
        <defs><marker id={marker} viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
          <path d="M0 0 10 5 0 10z" className="relationship-arrow"/>
        </marker></defs>
        {relations.map((change, index) => {
          const geometry = edgeGeometry(change);
          if (!geometry) return null;
          const label = change.description.length > 22 ? change.description.slice(0, 21) + '…' : change.description;
          const changedHere = changedIds.includes(change.id);
          return <g
            key={change.id}
            data-relationship-edge={change.id}
            className={'relationship-edge' + (changedHere ? ' relationship-edge-changed' : '') + (selectedId === change.id ? ' relationship-edge-selected' : '')}
            role="button"
            tabIndex={0}
            aria-label={'Edit ' + nameFrom(allCharacters, change.sourceId) + (change.mutual ? ' and ' : ' toward ') + nameFrom(allCharacters, change.targetId) + ': ' + change.description}
            onClick={() => onEdit(change)}
            onKeyDown={event => {
              if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault();
                onEdit(change);
              }
            }}
          >
            <title>{index + 1}. {change.description} ({change.kind}; {change.status})</title>
            <path className="relationship-edge-hit" d={'M' + geometry.ax + ',' + geometry.ay + ' Q' + geometry.control.x + ',' + geometry.control.y + ' ' + geometry.bx + ',' + geometry.by}/>
            <path
              className="relationship-edge-line"
              d={'M' + geometry.ax + ',' + geometry.ay + ' Q' + geometry.control.x + ',' + geometry.control.y + ' ' + geometry.bx + ',' + geometry.by}
              strokeDasharray={change.kind === 'family' ? '7 5' : undefined}
              markerEnd={change.mutual ? undefined : 'url(#' + marker + ')'}
            />
            <rect x={geometry.label.x - 78} y={geometry.label.y - 12} width="156" height="24" rx="4" className="relationship-edge-label-bg"/>
            <text x={geometry.label.x} y={geometry.label.y + 4} textAnchor="middle" className="relationship-edge-label-text">{label}</text>
          </g>;
        })}
        {connectionSource && previewPoint && pointFor(connectionSource) && <path
          className="relationship-connector-preview"
          d={'M' + (pointFor(connectionSource)!.x + 87) + ',' + pointFor(connectionSource)!.y + ' L' + (hoverTarget && pointFor(hoverTarget) ? pointFor(hoverTarget)!.x - 87 : previewPoint.x) + ',' + (hoverTarget && pointFor(hoverTarget) ? pointFor(hoverTarget)!.y : previewPoint.y)}
        />}
        {characters.map(character => {
          const point = pointFor(character.id);
          if (!point) return null;
          const isFocused = focus.includes(character.id);
          return <g
            key={character.id}
            data-character={character.id}
            className={'relationship-node' + (isFocused ? ' relationship-node-selected' : '') + (hoverTarget === character.id || requestSource === character.id ? ' relationship-node-target' : '')}
            onPointerDown={event => startNodeDrag(event, character.id)}
          >
            <rect
              x={point.x - 80}
              y={point.y - 25}
              width="160"
              height="50"
              rx="5"
              role="button"
              tabIndex={0}
              aria-label={'Focus ' + character.name + (character.archived ? ' (archived)' : '')}
              aria-pressed={isFocused}
              onClick={() => activateNode(character.id)}
              onKeyDown={event => {
                if ((event.key === 'Enter' || event.key === ' ') && !event.altKey) {
                  event.preventDefault();
                  activateNode(character.id);
                  return;
                }
                if (event.altKey && event.key.startsWith('Arrow') && !locked) {
                  event.preventDefault();
                  const delta = event.key === 'ArrowLeft' ? { x: -20, y: 0 }
                    : event.key === 'ArrowRight' ? { x: 20, y: 0 }
                      : event.key === 'ArrowUp' ? { x: 0, y: -20 } : { x: 0, y: 20 };
                  const next = { ...positionsRef.current, [character.id]: { x: point.x + delta.x, y: point.y + delta.y } };
                  positionsRef.current = next;
                  setPositions(next);
                  onLayout(next);
                }
              }}
            />
            <text x={point.x} y={point.y + 5} textAnchor="middle" aria-hidden="true">
              {character.name.length > 20 ? character.name.slice(0, 19) + '…' : character.name}
            </text>
            <g
              data-connector={character.id}
              className="relationship-connector-handle relationship-connector-source"
              role="button"
              tabIndex={0}
              aria-label={'Start relationship from ' + character.name}
              aria-keyshortcuts="Enter Space"
              onPointerDown={event => beginConnectorDrag(event, character.id)}
              onClick={() => announceSourceClick(character.id)}
              onKeyDown={event => {
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault();
                  startKeyboardConnection(character.id);
                }
              }}
            >
              <circle cx={point.x + 88} cy={point.y} r="8"/>
              <path d={'M' + (point.x + 84) + ',' + point.y + ' L' + (point.x + 92) + ',' + point.y + ' M' + (point.x + 88) + ',' + (point.y - 4) + ' L' + (point.x + 88) + ',' + (point.y + 4)}/>
            </g>
            <g
              data-connector-target={character.id}
              className={'relationship-connector-handle relationship-connector-target' + (connectionSource && connectionSource !== character.id ? ' relationship-connector-ready' : '')}
              role="button"
              tabIndex={0}
              aria-label={'Connect to ' + character.name}
              aria-keyshortcuts="Enter Space"
              onClick={() => activateTarget(character.id)}
              onKeyDown={event => {
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault();
                  activateTarget(character.id);
                }
              }}
            >
              <circle cx={point.x - 88} cy={point.y} r="8"/>
              <path d={'M' + (point.x - 92) + ',' + point.y + ' L' + (point.x - 84) + ',' + point.y}/>
            </g>
          </g>;
        })}
      </svg>
    </div>
    <p className="relationship-graph-status" aria-live="polite">{message}</p>
    <p className="muted relationship-map-hint">
      {characters.length} characters · {relations.length} connections. Drag boxes to arrange the shared story layout. Use a plus handle to connect; keyboard users can activate a source handle, then a target handle. Press Escape to cancel.
    </p>
  </div>;
}

function nameFrom(characters: ProjectSnapshot['characters'], id: string) {
  return characters.find(character => character.id === id)?.name ?? 'Unknown character';
}
