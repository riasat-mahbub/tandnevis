import { useEffect, useMemo, useRef, useState } from 'react';
import { Archive, ArrowLeft, Copy, Plus, Search, Trash2, Users, Heart, Waves } from 'lucide-react';
import type { Character, Operation, Preset, PresetKind, ProjectSnapshot } from '../services/project';
import type { Workspace } from '../services/workspace';
import { TitleField } from './Fields';

export type LibraryKind = 'characters' | 'tones' | 'emotions';
type Definition = Character | Preset;
interface Usage { key: string; label: string; sceneId?: string; beatId?: string; occurrenceId?: string; characterId?: string }
const titles = { characters: 'Characters', tones: 'Tones', emotions: 'Emotions' };
const singulars = { characters: 'character', tones: 'tone', emotions: 'emotion' };

function walk(value: unknown, visit: (node: Record<string, unknown>) => void) {
  if (!value || typeof value !== 'object') return;
  if (Array.isArray(value)) { value.forEach(node => walk(node, visit)); return; }
  const node = value as Record<string, unknown>;
  visit(node);
  Object.values(node).forEach(child => walk(child, visit));
}

function references(value: unknown, kind: LibraryKind, id: string) {
  const found: { occurrenceId?: string }[] = [];
  walk(value, node => {
    const attrs = node.attrs as Record<string, unknown> | undefined;
    if (!attrs) return;
    if (kind === 'characters' && node.type === 'characterReference' && attrs.characterId === id) found.push({ occurrenceId: typeof attrs.occurrenceId === 'string' ? attrs.occurrenceId : undefined });
    if (kind === 'emotions' && node.type === 'emotionReference' && attrs.emotionId === id) found.push({ occurrenceId: typeof attrs.targetOccurrenceId === 'string' ? attrs.targetOccurrenceId : undefined });
    if (kind === 'tones' && node.type === 'toneReference' && attrs.toneId === id) found.push({});
  });
  return found;
}

export function libraryUsages(project: ProjectSnapshot, kind: LibraryKind, id: string): Usage[] {
  const usages: Usage[] = [];
  for (const scene of project.scenes) {
    if (kind === 'tones' && scene.toneId === id) usages.push({ key: `scene:${scene.id}`, label: `${scene.title} · Scene tone`, sceneId: scene.id });
    scene.beats.forEach((beat, index) => references(beat.document, kind, id).forEach((reference, occurrence) => {
      usages.push({ key: `${beat.id}:${occurrence}`, label: `${scene.title} · Beat ${index + 1}${reference.occurrenceId ? ` · ${kind === 'characters' ? 'Character reference' : 'Character emotion'}` : ''}`, sceneId: scene.id, beatId: beat.id, occurrenceId: reference.occurrenceId });
    }));
  }
  if (kind !== 'characters') for (const character of project.characters) {
    if ((kind === 'tones' ? character.defaultToneId : character.defaultEmotionId) === id) usages.push({ key: `default:${character.id}`, label: `${character.name} · Default ${singulars[kind]}`, characterId: character.id });
  }
  for (const item of project.trash) {
    let used = references(item.payload, kind, id).length > 0;
    if (kind !== 'characters') walk(item.payload, node => {
      if (kind === 'tones' && (node.toneId === id || node.defaultToneId === id)) used = true;
      if (kind === 'emotions' && node.defaultEmotionId === id) used = true;
    });
    if (used) usages.push({ key: `trash:${item.id}`, label: `${item.title || 'Untitled item'} · In Trash` });
  }
  return usages;
}

interface Props {
  kind: LibraryKind; project: ProjectSnapshot; workspace: Workspace; locked: boolean;
  selectedId: string | null; onSelect: (id: string | null) => void;
  createRequest?: number;
  returnScene?: string; onReturnScene: () => void;
  onOpenUsage: (sceneId: string, beatId?: string, occurrenceId?: string) => void;
  onOpenCharacter: (id: string) => void;
  notify: (message: string) => void; run: (action: () => Promise<unknown>) => void;
}

export default function LibraryView({ kind, project, workspace, locked, selectedId, onSelect, createRequest = 0, returnScene, onReturnScene, onOpenUsage, onOpenCharacter, notify, run }: Props) {
  const [search, setSearch] = useState('');
  const [archived, setArchived] = useState(false);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState('');
  const [detailOpen, setDetailOpen] = useState(false);
  const createInput = useRef<HTMLInputElement>(null);
  const detailRef = useRef<HTMLDivElement>(null);
  const definitions: Definition[] = kind === 'characters' ? project.characters : kind === 'tones' ? project.tones : project.emotions;
  const filtered = definitions.filter(item => item.archived === archived && item.name.toLocaleLowerCase().includes(search.toLocaleLowerCase())).sort((a, b) => a.name.localeCompare(b.name));
  const selected = definitions.find(item => item.id === selectedId);
  const usages = useMemo(() => selected ? libraryUsages(project, kind, selected.id) : [], [project, kind, selected]);
  const presetKind: PresetKind | undefined = kind === 'characters' ? undefined : kind === 'tones' ? 'tone' : 'emotion';
  const singular = singulars[kind];
  const Icon = kind === 'characters' ? Users : kind === 'tones' ? Waves : Heart;

  useEffect(() => {
    if (!selectedId || !definitions.some(item => item.id === selectedId)) { const next = filtered[0]?.id ?? null; if (next !== selectedId) onSelect(next); }
  }, [selectedId, definitions, filtered, onSelect]);
  useEffect(() => { if (createRequest) { setCreating(true); setDetailOpen(false); } }, [createRequest]);
  useEffect(() => { if (creating) createInput.current?.focus(); }, [creating]);

  const edit = (operation: Operation) => { void workspace.dispatch(operation).catch(() => {}); };
  function update(fields: Record<string, string | boolean>) {
    if (!selected) return;
    if (kind === 'characters') edit({ type: 'updateCharacter', characterId: selected.id, ...fields });
    else edit({ type: 'updatePreset', kind: presetKind!, presetId: selected.id, ...fields });
  }
  async function create() {
    const before = new Set(definitions.map(item => item.id));
    const snapshot = await workspace.dispatch(kind === 'characters' ? { type: 'createCharacter', name: newName.trim() } : { type: 'createPreset', kind: presetKind!, name: newName.trim() });
    const items = kind === 'characters' ? snapshot.characters : kind === 'tones' ? snapshot.tones : snapshot.emotions;
    const created = items.find(item => !before.has(item.id));
    onSelect(created?.id ?? null); setNewName(''); setSearch(''); setArchived(false); setCreating(false); setDetailOpen(true);
    requestAnimationFrame(() => { const input = detailRef.current?.querySelector<HTMLInputElement>('input'); input?.focus(); input?.select(); });
  }
  async function duplicate() {
    if (!selected) return;
    const before = new Set(definitions.map(item => item.id));
    const snapshot = await workspace.dispatch(kind === 'characters' ? { type: 'duplicateCharacter', characterId: selected.id } : { type: 'duplicatePreset', kind: presetKind!, presetId: selected.id });
    const items = kind === 'characters' ? snapshot.characters : kind === 'tones' ? snapshot.tones : snapshot.emotions;
    onSelect(items.find(item => !before.has(item.id))?.id ?? null); setSearch(''); setArchived(false); setDetailOpen(true);
    notify(`${singular[0].toUpperCase() + singular.slice(1)} duplicated. Existing references still use the original.`);
  }
  async function remove() {
    if (!selected || usages.length) return;
    await workspace.dispatch(kind === 'characters' ? { type: 'deleteCharacter', characterId: selected.id } : { type: 'deletePreset', kind: presetKind!, presetId: selected.id });
    onSelect(null); setDetailOpen(false); notify(`${selected.name} moved to Trash. Undo or Restore brings it back.`);
  }
  const description = kind === 'characters' ? 'Build profiles once. Use their blocks in every scene.' : kind === 'tones' ? 'Define reusable writing guidance for a scene or a freeform beat.' : 'Define reusable feelings to attach to a character in a beat.';

  return <main className={`global-library global-library-${singular} ${detailOpen ? 'library-detail-open' : ''}`} aria-labelledby={`${kind}-heading`}>
    <div className="global-library-heading"><div><h1 id={`${kind}-heading`}>{titles[kind]}</h1><p>{description}</p></div><div className="library-heading-actions">{returnScene && <button className="quiet" onClick={onReturnScene}><ArrowLeft size={15}/>Return to {returnScene}</button>}<button className="primary" disabled={locked} onClick={() => { setCreating(true); setDetailOpen(false); }}><Plus size={16}/>New {singular}</button></div></div>
    <div className="library-master-detail">
      <aside className="definition-list" aria-label={`${titles[kind]} library`}>
        <label className="library-search"><span className="sr-only">Search {kind}</span><Search size={15} aria-hidden="true"/><input type="search" value={search} onChange={event => setSearch(event.target.value)} placeholder={`Search ${kind}`} /></label>
        <div className="library-filter" aria-label={`${titles[kind]} status`}><button aria-pressed={!archived} onClick={() => { setArchived(false); setDetailOpen(false); }}>Active</button><button aria-pressed={archived} onClick={() => { setArchived(true); setDetailOpen(false); }}>Archived</button></div>
        {creating && <form className="library-create" onSubmit={event => { event.preventDefault(); if (newName.trim()) run(create); }}><label>{`New ${singular} name`}<input ref={createInput} value={newName} maxLength={250} onChange={event => setNewName(event.target.value)} /></label><div className="button-row"><button className="primary" disabled={locked || !newName.trim()}>Create {singular}</button><button type="button" onClick={() => setCreating(false)}>Cancel</button></div></form>}
        {filtered.length ? <ul className="definition-rows">{filtered.map(item => <li key={item.id}><button className={item.id === selectedId ? 'definition-selected' : ''} aria-pressed={item.id === selectedId} onClick={() => { onSelect(item.id); setDetailOpen(true); }}><span><Icon size={14}/><strong>{item.name}</strong></span><small>{kind === 'characters' ? (item as Character).voice || (item as Character).personality || 'Character profile' : (item as Preset).meaning || (item as Preset).guidance || 'Reusable guidance'}</small>{item.archived && <span className="definition-archived">Archived</span>}</button></li>)}</ul> : <div className="library-empty"><p>{search ? `No ${kind} match “${search}”.` : archived ? `No archived ${kind}.` : `No ${kind} yet.`}</p>{search ? <button onClick={() => setSearch('')}>Clear search</button> : !archived && <p>{kind === 'characters' ? 'Start with a name. Add background and voice when you need them.' : `Create a ${singular} or add the editable starter blocks.`}</p>}</div>}
        {presetKind && !project.starterTypes.includes(presetKind) && <button className="starter-blocks" disabled={locked} onClick={() => run(async () => { await workspace.dispatch({ type: 'addStarterPresets', kind: presetKind }); setArchived(false); setSearch(''); notify(`Starter ${kind} added where names were not already in use.`); })}><Plus size={14}/>Add starter {kind}</button>}
      </aside>
      <div className="definition-detail" ref={detailRef}>
        {selected ? <><button className="quiet library-back-list" onClick={() => setDetailOpen(false)}><ArrowLeft size={15}/>Back to {kind}</button><div className="definition-heading"><div><span className={`block-preview block-${singular}`}><Icon size={14}/>{singular[0].toUpperCase() + singular.slice(1)}: {selected.name}</span><p className="shared-definition">Shared across this project</p></div><div className="definition-actions"><button disabled={locked} onClick={() => run(duplicate)}><Copy size={14}/>Duplicate</button><button disabled={locked} onClick={() => { update({ archived: !selected.archived }); notify(selected.archived ? `${selected.name} restored to the insertion library.` : `${selected.name} archived. Existing references are preserved.`); }}><Archive size={14}/>{selected.archived ? 'Restore' : 'Archive'}</button><button className="danger" disabled={locked || usages.length > 0} title={usages.length ? 'This definition is in use. Archive it to preserve its references.' : 'Move this unused definition to Trash'} onClick={() => run(remove)}><Trash2 size={14}/>Delete</button></div></div>
          <TitleField key={selected.id} label={`${singular[0].toUpperCase() + singular.slice(1)} name`} value={selected.name} disabled={locked} large onSave={name => update({ name })}/>
          {kind === 'characters' ? <>
            {(['background', 'personality', 'voice'] as const).map(field => <label key={field}>{field === 'voice' ? 'Baseline voice' : field[0].toUpperCase() + field.slice(1)}<textarea rows={field === 'background' ? 5 : 3} value={(selected as Character)[field]} disabled={locked} placeholder={field === 'voice' ? 'How does this character usually sound?' : undefined} onChange={event => update({ [field]: event.target.value })}/></label>)}
            <section className="character-defaults"><h2>Default direction</h2><p className="muted">Used when a character occurrence has no local override.</p>{(['tone', 'emotion'] as const).map(type => { const character = selected as Character; const value = type === 'tone' ? character.defaultToneId : character.defaultEmotionId; const options = type === 'tone' ? project.tones : project.emotions; return <label key={type}>Default {type}<select value={value} disabled={locked} onChange={event => update({ [type === 'tone' ? 'defaultToneId' : 'defaultEmotionId']: event.target.value })}><option value="">None</option>{options.filter(item => !item.archived || item.id === value).map(item => <option key={item.id} value={item.id}>{item.name}{item.archived ? ' (archived)' : ''}</option>)}</select>{value && <small>{options.find(item => item.id === value)?.guidance}</small>}</label>; })}</section>
          </> : <>{(['meaning', 'guidance', 'example'] as const).map(field => <label key={field}>{field === 'guidance' ? kind === 'tones' ? 'Writing guidance' : 'Expression guidance' : field === 'example' ? 'Example (optional)' : 'Meaning'}<textarea disabled={locked} rows={field === 'guidance' ? 5 : 3} value={(selected as Preset)[field]} onChange={event => update({ [field]: event.target.value })}/></label>)}<p className="definition-instruction">{kind === 'tones' ? 'Use this block for a whole scene or an individual beat.' : 'Drop this block onto a character in a beat.'}</p></>}
          <section className="definition-usages"><h2>Used in</h2><p className="muted">Edits affect future generation wherever this definition is referenced. Written prose stays unchanged.</p>{usages.length ? <ul>{usages.map(usage => <li key={usage.key}>{usage.sceneId ? <button className="quiet" onClick={() => onOpenUsage(usage.sceneId!, usage.beatId, usage.occurrenceId)}>{usage.label}</button> : usage.characterId ? <button className="quiet" onClick={() => onOpenCharacter(usage.characterId!)}>{usage.label}</button> : <span>{usage.label}</span>}</li>)}</ul> : <p className="empty-inline">Not used in any scene or character default yet.</p>}</section>
        </> : <div className="definition-empty"><Icon size={30}/><h2>{definitions.length ? `Choose a ${singular}` : `Create your first ${singular}`}</h2><p>{definitions.length ? 'Select a definition from the library to edit its shared guidance.' : description}</p><button disabled={locked} onClick={() => { setCreating(true); setDetailOpen(false); }}>New {singular}</button></div>}
      </div>
    </div>
  </main>;
}
