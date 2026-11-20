import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import type { Editor } from '@tiptap/core';
import type { ReactNode } from 'react';
import { Copy, Plus, Trash2, ChevronDown, Search } from 'lucide-react';
import type { Character, Operation, Preset, ProjectSnapshot, Scene } from '../services/project';
import { emptyDocument } from '../services/project';
import { buildSceneGenerationContext } from '../services/generation-context';
import { generationInputFingerprint } from '../services/generation-fingerprint';
import type { GenerationSession } from '../services/generation-session';
import { moved } from '../services/workspace';
import type { Workspace } from '../services/workspace';
import BeatEditor, { CHARACTER_REFERENCE_MIME, PRESET_REFERENCE_MIME, characterTargets, insertCharacterReference, insertEmotionReference, insertToneReference, removeSelectedReference, updateCharacterReference } from './BeatEditor';
import type { CharacterTarget } from './BeatEditor';
import GenerationPanel from './GenerationPanel';
import SceneProseEditor from './SceneProseEditor';
import { TitleField } from './Fields';
import { Timeline, TimelineItem } from './Timeline';

interface Props { project: ProjectSnapshot; scene: Scene; workspace: Workspace; sessionId: string; generation: GenerationSession; generationReady: boolean; generationModel?: string; generationModelLabel?: string; defaultGuidance: string; locked: boolean; manageCharacters: (id?: string) => void; manageLibrary?: (kind: 'characters' | 'tones' | 'emotions', id?: string) => void; openSettings: () => void; notify: (message: string) => void; run: (action: () => Promise<unknown>) => void }
type Selection = { kind: string; pos: number; attrs: Record<string, string> };
function TargetPicker({ label, onCancel, children }: { label: string; onCancel: () => void; children: ReactNode }) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const current = dialog.current!;
    const previous = document.activeElement as HTMLElement | null;
    if (current.showModal) current.showModal(); else current.setAttribute('open', '');
    return () => { current.close?.(); previous?.focus({ preventScroll: true }); };
  }, []);
  return <dialog className="block-target-picker" ref={dialog} aria-label={label} onCancel={event => { event.preventDefault(); onCancel(); }}>{children}</dialog>;
}
export default function SceneView({ project, scene, workspace, sessionId, generation, generationReady, generationModel, generationModelLabel, defaultGuidance, locked, manageCharacters, manageLibrary, openSettings, notify, run }: Props) {
  const [selectedBeatId, setSelectedBeatId] = useState<string | null>(null);
  const [reference, setReference] = useState<Selection | null>(null);
  const [search, setSearch] = useState('');
  const [shelfOpen, setShelfOpen] = useState(false), [inspectorOpen, setInspectorOpen] = useState(false);
  const [toneChoice, setToneChoice] = useState<{ preset: Preset; editor: Editor | null } | null>(null);
  const [emotionChoice, setEmotionChoice] = useState<{ preset: Preset; editor: Editor; targets: CharacterTarget[] } | null>(null);
  const editorRef = useRef<Editor | null>(null), editors = useRef(new Map<string, Editor>());
  const tones = project.tones ?? [], emotions = project.emotions ?? [];
  const selectedBeatIndex = scene.beats.findIndex(b => b.id === selectedBeatId);
  const manage = (kind: 'characters' | 'tones' | 'emotions', id?: string) => { if (manageLibrary) manageLibrary(kind, id); else if (kind === 'characters') manageCharacters(id); };
  useEffect(() => { if (selectedBeatId && !scene.beats.some(b => b.id === selectedBeatId)) { setSelectedBeatId(null); editorRef.current = null; setReference(null); setToneChoice(null); setEmotionChoice(null); } }, [scene.beats, selectedBeatId]);
  const register = useCallback((id: string, editor: Editor | null) => { if (editor) editors.current.set(id, editor); else editors.current.delete(id); }, []);
  const selectEditor = useCallback((editor: Editor) => {
    editorRef.current = editor;
    const selection = editor.state.selection;
    const node = 'node' in selection ? selection.node as { type: { name: string }; attrs: Record<string, string> } : null;
    setReference(node && ['characterReference', 'emotionReference', 'toneReference'].includes(node.type.name) ? { kind: node.type.name, pos: selection.from, attrs: { ...node.attrs } } : null);
  }, []);
  useEffect(() => {
    const focus = (event: Event) => {
      const { beatId, occurrenceId } = (event as CustomEvent<{ beatId: string; occurrenceId?: string }>).detail;
      const editor = editors.current.get(beatId); if (!editor) return;
      setSelectedBeatId(beatId); editor.commands.focus();
      if (occurrenceId) { const target = characterTargets(editor).find(t => t.occurrenceId === occurrenceId); if (target) editor.commands.setNodeSelection(target.pos); }
      selectEditor(editor); document.querySelector(`[data-item-id="${beatId}"]`)?.scrollIntoView({ block: 'center' });
    };
    window.addEventListener('shorthand:focus-beat', focus); return () => window.removeEventListener('shorthand:focus-beat', focus);
  }, [selectEditor]);
  const edit = (op: Operation) => { void workspace.dispatch(op).catch(() => {}); };
  const focusBeat = (id?: string) => requestAnimationFrame(() => { if (id) { editors.current.get(id)?.commands.focus('end'); document.querySelector(`[data-item-id="${id}"]`)?.scrollIntoView({ block: 'nearest' }); } else document.getElementById('add-beat')?.focus(); });
  async function addBeat(afterId?: string) {
    const current = workspace.getSnapshot().project!.scenes.find(s => s.id === scene.id)!, before = new Set(current.beats.map(b => b.id));
    const p = await workspace.dispatch({ type: 'createBeat', sceneId: scene.id, document: emptyDocument, text: '' });
    const id = p.scenes.find(s => s.id === scene.id)!.beats.find(b => !before.has(b.id))!.id;
    if (afterId) { const ids = p.scenes.find(s => s.id === scene.id)!.beats.map(b => b.id).filter(b => b !== id); ids.splice(ids.indexOf(afterId) + 1, 0, id); await workspace.dispatch({ type: 'reorderBeats', sceneId: scene.id, ids }); }
    setSelectedBeatId(id); focusBeat(id);
  }
  function insertCharacter(character: Character) {
    const editor = editorRef.current;
    if (!editor || editor.isDestroyed) { notify('Select a beat, then choose a character to insert a reference at the caret.'); return; }
    insertCharacterReference(editor, character); editor.commands.focus();
    notify(`${character.name} inserted into this beat. Select the reference to add local direction.`);
  }
  function insertEmotion(preset: Preset) {
    const editor = editorRef.current;
    if (!editor || editor.isDestroyed) { notify('Select a character block in a beat, then choose an emotion.'); return; }
    const targets = characterTargets(editor), selection = editor.state.selection;
    const selected = 'node' in selection ? targets.find(t => t.pos === selection.from || (selection.node as { attrs: Record<string, string> }).attrs.targetOccurrenceId === t.occurrenceId && !!t.occurrenceId) : undefined;
    if (selected) { insertEmotionReference(editor, preset, selected); setInspectorOpen(true); notify(`${preset.name} applies to this character occurrence only.`); }
    else if (targets.length) setEmotionChoice({ preset, editor, targets });
    else notify('This beat has no character blocks. Insert a character before applying an emotion.');
  }
  function applySceneTone(preset: Preset) { edit({ type: 'updateScene', sceneId: scene.id, toneId: preset.id }); setToneChoice(null); notify(`${preset.name} is the default tone for this scene.`); }
  function applyBeatTone(preset: Preset, editor = editorRef.current) {
    if (!editor || editor.isDestroyed) { notify('Select a beat before inserting its tone.'); return; }
    insertToneReference(editor, preset); setToneChoice(null); setInspectorOpen(true); notify(`${preset.name} applies to this beat only.`);
  }
  const sceneTone = tones.find(t => t.id === scene.toneId), localCharacter = project.characters.find(c => c.id === reference?.attrs.characterId);
  const localEmotion = emotions.find(p => p.id === reference?.attrs.emotionId), localTone = tones.find(p => p.id === reference?.attrs.toneId);
  const emotionTarget = reference?.kind === 'emotionReference' && editorRef.current ? characterTargets(editorRef.current).find(t => t.occurrenceId === reference.attrs.targetOccurrenceId) : undefined;
  const emotionTargetName = project.characters.find(c => c.id === emotionTarget?.characterId)?.name ?? emotionTarget?.label;
  const preview = useMemo(() => { try { const context = buildSceneGenerationContext(project, scene.id); return { context, error: context.unresolvedReferences.length ? 'A character definition is missing. Repair its reference before generating.' : '' }; } catch (error) { return { context: null, error: error instanceof Error ? error.message : String(error) }; } }, [project, scene.id]);
  const generationState = useSyncExternalStore(listener => generation.subscribe(sessionId, scene.id, listener), () => generation.getState(sessionId, scene.id), () => generation.getState(sessionId, scene.id));
  const currentFingerprint = useMemo(() => preview.context ? generationInputFingerprint(preview.context, defaultGuidance) : '', [preview.context, defaultGuidance]);
  useEffect(() => { void generation.load(sessionId, scene.id).catch(error => generation.failBeforeStart(sessionId, scene.id, error)); }, [generation, scene.id, sessionId]);
  const hasSavedBeats = scene.beats.some(beat => beat.text.trim().length > 0);
  const startGeneration = () => {
    if (!generationModel || preview.error) return;
    void workspace.flush().then(() => { const state = workspace.getSnapshot(); if (!state.ready || state.session?.sessionId !== sessionId) throw new Error('The selected project is switching. Try generating again after it opens.'); return generation.start(sessionId, scene.id, generationModel, defaultGuidance); }).catch(error => generation.failBeforeStart(sessionId, scene.id, error));
  };
  const acceptDraft = (acknowledgeOutdated: boolean) => {
    const job = generationState.job; if (!job) return Promise.reject(new Error('The generated draft could not be found.'));
    return workspace.applyNativeMutation(sessionId, currentSession => generation.gateway.accept(sessionId, scene.id, job.id, currentSession.project.revision, job.model, job.connectionId, acknowledgeOutdated)).then(() => { generation.markAccepted(sessionId, scene.id); notify('Scene draft accepted into Scene prose.'); });
  };
  const copyDraft = () => { if (!generationState.draftText) return; if (!navigator.clipboard?.writeText) { notify('Clipboard access is unavailable. Select the draft text to copy it.'); return; } run(() => navigator.clipboard.writeText(generationState.draftText).then(() => notify('Draft copied to the clipboard.'))); };
  const discardDraft = () => { if (generationState.job) run(() => generation.discard(sessionId, scene.id).then(() => notify('Generated draft discarded.'))); };
  const matches = (name: string) => name.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase());
  const dragPreset = (event: React.DragEvent, kind: 'tone' | 'emotion', preset: Preset) => { event.stopPropagation(); event.dataTransfer.setData(PRESET_REFERENCE_MIME, JSON.stringify({ kind, id: preset.id })); event.dataTransfer.effectAllowed = 'copy'; };
  return <main id="main" className="scene-layout">
    <aside className="library block-shelf"><button className="shelf-toggle" aria-expanded={shelfOpen} onClick={() => setShelfOpen(!shelfOpen)}>Insert blocks<ChevronDown size={15}/></button><div className="block-shelf-body" data-open={shelfOpen}>
      <h2>Story blocks</h2><p className="muted">Reusable across every scene.</p><label className="block-search"><span><Search size={13}/>Search blocks</span><input value={search} onChange={e => setSearch(e.target.value)} placeholder="Find a block"/></label>
      <section className="shelf-group"><div className="shelf-heading"><h3>Characters</h3><button className="quiet" onClick={() => manage('characters')}>Manage characters</button></div><div className="block-collection">{project.characters.filter(c => !c.archived && matches(c.name)).map(c => <button key={c.id} aria-label={c.name} className="character-chip story-block block-character" disabled={locked} draggable={!locked} title="Character · insert at the caret or drag into a beat" onMouseDown={e => e.preventDefault()} onDragStart={event => { event.stopPropagation(); event.dataTransfer.setData(CHARACTER_REFERENCE_MIME, c.id); event.dataTransfer.effectAllowed = 'copy'; }} onClick={() => insertCharacter(c)}>{c.name}<Plus size={12}/></button>)}</div>{!project.characters.some(c => !c.archived) && <button className="quiet" onClick={() => manage('characters', 'new')}>New character…</button>}</section>
      {(['emotions', 'tones'] as const).map(kind => <section className="shelf-group" key={kind}><div className="shelf-heading"><h3>{kind === 'emotions' ? 'Emotions' : 'Tones'}</h3><button className="quiet" onClick={() => manage(kind)}>Manage {kind}</button></div><div className="block-collection">{(kind === 'emotions' ? emotions : tones).filter(p => !p.archived && matches(p.name)).map(p => <button key={p.id} className={`story-block block-${kind === 'emotions' ? 'emotion' : 'tone'}`} aria-label={`${kind === 'emotions' ? 'Emotion' : 'Tone'}: ${p.name}`} disabled={locked} draggable={!locked} title={kind === 'emotions' ? 'Emotion · drop onto a character occurrence' : 'Tone · drop in a scene or beat'} onMouseDown={e => e.preventDefault()} onDragStart={e => dragPreset(e, kind === 'emotions' ? 'emotion' : 'tone', p)} onClick={() => { if (kind === 'emotions') insertEmotion(p); else setToneChoice({ preset: p, editor: editorRef.current }); }}>{p.name}<Plus size={12}/></button>)}</div>{!(kind === 'emotions' ? emotions : tones).some(p => !p.archived) && <button className="quiet" onClick={() => manage(kind, 'new')}>New {kind === 'emotions' ? 'emotion' : 'tone'}…</button>}</section>)}
      {search && ![...project.characters, ...emotions, ...tones].some(p => !p.archived && matches(p.name)) && <p className="muted">No blocks match. <button className="quiet" onClick={() => setSearch('')}>Clear search</button></p>}
    </div></aside>
    <section className="scene-writing" aria-label="Scene writing"><div className="scene-heading"><TitleField value={scene.title} label="Scene title" large onSave={title => edit({ type: 'updateScene', sceneId: scene.id, title })}/><span className="muted">{scene.beats.length} beat{scene.beats.length === 1 ? '' : 's'}</span></div>
      <details className="generation-preview"><summary>Preview scene context</summary><p className="muted">Only this scene's ordered beats, referenced profiles, tones and targeted emotions are included.</p>{preview.error ? <p role="alert">{preview.error}</p> : <pre>{preview.context?.readableContext}</pre>}</details>
      <div className="scene-tone-target" data-scene-tone-target onDragOver={event => { if (event.dataTransfer.types.includes(PRESET_REFERENCE_MIME)) { event.preventDefault(); event.currentTarget.classList.add('block-drop-target'); } }} onDragLeave={event => event.currentTarget.classList.remove('block-drop-target')} onDrop={event => { event.preventDefault(); event.stopPropagation(); event.currentTarget.classList.remove('block-drop-target'); try { const payload = JSON.parse(event.dataTransfer.getData(PRESET_REFERENCE_MIME)); const preset = tones.find(p => payload.kind === 'tone' && p.id === payload.id && !p.archived); if (preset) applySceneTone(preset); else notify('Drop a tone here. Emotion blocks belong to a character in a beat.'); } catch { notify('Choose a tone from Story blocks.'); } }}>
        <label>Scene tone<select aria-label="Scene tone block" value={scene.toneId || ''} disabled={locked} onChange={event => edit({ type: 'updateScene', sceneId: scene.id, toneId: event.target.value })}><option value="">{scene.tone ? `Custom: ${scene.tone}` : 'Choose or drop a tone'}</option>{tones.filter(p => !p.archived || p.id === scene.toneId).map(p => <option value={p.id} key={p.id}>{p.name}{p.archived ? ' (archived)' : ''}</option>)}</select></label>{sceneTone && <><span className="story-block block-tone">Tone: {sceneTone.name}</span><button className="quiet" disabled={locked} onClick={() => edit({ type: 'updateScene', sceneId: scene.id, toneId: '', tone: '' })}>Remove scene tone</button></>}
      </div>
      {!scene.toneId && <label className="tone-field">Custom scene tone<input placeholder="Optional guidance" value={scene.tone} maxLength={1000} onChange={e => edit({ type: 'updateScene', sceneId: scene.id, tone: e.target.value })}/></label>}
      <div className="summary-note"><label>Scene summary<textarea aria-label="Scene summary" value={scene.summary} placeholder="What changes in this scene?" rows={3} onChange={e => edit({ type: 'updateScene', sceneId: scene.id, summary: e.target.value })}/></label></div>
      <div className="sequence-heading"><h2>The beats</h2><span className="muted">One moment, then the next.</span></div>
      {scene.beats.length ? <Timeline ids={scene.beats.map(b => b.id)} group={`Beats in ${scene.id}`} onReorder={ids => { edit({ type: 'reorderBeats', sceneId: scene.id, ids }); notify('Beat order updated.'); }}>{scene.beats.map((beat, index) => <TimelineItem key={beat.id} id={beat.id} index={index} count={scene.beats.length} group={`Beats in ${scene.id}`} label={`beat ${index + 1}`} disabled={locked} onMove={delta => { edit({ type: 'reorderBeats', sceneId: scene.id, ids: moved(scene.beats.map(b => b.id), beat.id, delta) }); notify(`Beat moved to position ${index + delta + 1}.`); }} actions={<><button disabled={locked} aria-label={`Duplicate beat ${index + 1}`} onClick={() => run(async () => { const before = new Set(scene.beats.map(b => b.id)); const p = await workspace.dispatch({ type: 'duplicateBeat', beatId: beat.id }); focusBeat(p.scenes.find(s => s.id === scene.id)!.beats.find(b => !before.has(b.id))?.id); })}><Copy size={13}/>Duplicate</button><button disabled={locked} className="danger" aria-label={`Delete beat ${index + 1}`} onClick={() => run(async () => { await workspace.dispatch({ type: 'deleteBeat', beatId: beat.id }); if (selectedBeatId === beat.id) { editorRef.current = null; setReference(null); } focusBeat(scene.beats[index + 1]?.id ?? scene.beats[index - 1]?.id); notify('Beat moved to Trash.'); })}><Trash2 size={13}/>Delete</button></>}><div className={selectedBeatId === beat.id ? 'beat-content selected' : 'beat-content'}><span className="beat-label">Beat {index + 1}</span><BeatEditor beat={beat} index={index} characters={project.characters} tones={tones} emotions={emotions} notify={notify} register={register} editable={!locked} onChange={(document, text) => edit({ type: 'updateBeat', beatId: beat.id, document, text })} onFocus={editor => { setSelectedBeatId(beat.id); selectEditor(editor); }} onSelection={selectEditor}/></div><div className="insert-row"><button className="quiet" disabled={locked} onClick={() => run(() => addBeat(beat.id))}><Plus size={12}/>Insert beat after</button></div></TimelineItem>)}</Timeline> : <div className="empty-beats"><p>Give this scene its first moment.</p><p className="muted">Write freely. No character blocks are required.</p></div>}
      <button id="add-beat" className="primary add-beat" disabled={locked} onClick={() => run(() => addBeat())}><Plus size={16}/>Add beat</button>
      <GenerationPanel ready={generationReady && !preview.error} hasSavedBeats={hasSavedBeats} modelLabel={generationModelLabel} status={generationState.status} draftText={generationState.draftText} currentFingerprint={currentFingerprint} requestFingerprint={generationState.job?.inputFingerprint} currentProse={scene.prose} requestBaseProse={generationState.job?.requestSnapshot.baseProse} errorMessage={generationState.errorMessage} reason={preview.error || (!generation.gateway.desktop ? 'Scene generation is available in the desktop app.' : undefined)} onGenerate={startGeneration} onStop={() => run(() => generation.stop(sessionId, scene.id))} onAccept={acknowledgeOutdated => run(() => acceptDraft(acknowledgeOutdated))} onCopy={copyDraft} onDiscard={discardDraft} onRetry={startGeneration} onOpenSettings={openSettings}/><SceneProseEditor value={scene.prose} disabled={locked} onChange={prose => edit({ type: 'updateScene', sceneId: scene.id, prose })}/>
    </section>
    <aside className="inspector block-inspector"><button className="inspector-toggle" aria-expanded={inspectorOpen} onClick={() => setInspectorOpen(!inspectorOpen)}>Block details<ChevronDown size={15}/></button><div className="block-inspector-body" data-open={inspectorOpen}><h2>Block details</h2>{reference ? <section><span className="scope-label">{reference.kind === 'toneReference' ? `Beat ${selectedBeatIndex + 1} only` : 'This character occurrence only'}</span>
      {reference.kind === 'characterReference' ? <><h3>{localCharacter?.name ?? reference.attrs.label}</h3>{localCharacter && <><p className="muted">{localCharacter.voice || 'No baseline voice yet.'}</p>{localCharacter.defaultToneId && <p className="muted">Default tone: {tones.find(t => t.id === localCharacter.defaultToneId)?.name ?? 'Unavailable'}</p>}{localCharacter.defaultEmotionId && <p className="muted">Default emotion: {emotions.find(p => p.id === localCharacter.defaultEmotionId)?.name ?? 'Unavailable'}</p>}</>}{(['emotion', 'delivery'] as const).map(field => <label key={field} className={`${field}-field`}>{field === 'emotion' ? 'Local emotion note' : 'Delivery'}<input value={reference.attrs[field] ?? ''} placeholder={field === 'emotion' ? 'Optional custom guidance' : 'e.g. Under her breath'} onChange={e => { if (editorRef.current) updateCharacterReference(editorRef.current, { [field]: e.target.value }); setReference({ ...reference, attrs: { ...reference.attrs, [field]: e.target.value } }); }}/></label>)}<button className="quiet" onClick={() => manageCharacters(reference.attrs.characterId)}>Edit reusable profile</button></> : reference.kind === 'emotionReference' ? <><h3>Emotion: {localEmotion?.name ?? reference.attrs.label}</h3><p>For {emotionTargetName || 'unresolved target'} · Beat {selectedBeatIndex + 1}</p><p>{localEmotion?.guidance || localEmotion?.meaning}</p><button className="quiet" onClick={() => manage('emotions', reference.attrs.emotionId)}>Edit shared emotion</button></> : <><h3>Tone: {localTone?.name ?? reference.attrs.label}</h3><p>{localTone?.guidance || localTone?.meaning}</p><p className="muted">Overrides scene tone: {sceneTone?.name || scene.tone || 'None'}</p><button className="quiet" onClick={() => manage('tones', reference.attrs.toneId)}>Edit shared tone</button></>}
      <p className="muted">Local blocks do not edit shared definitions.</p><button className="quiet danger" onClick={() => { if (editorRef.current) removeSelectedReference(editorRef.current); setReference(null); }}>Remove this reference</button></section> : <p className="muted">Select a block to see its guidance and scope.</p>}
      <details><summary>Optional narration</summary><p className="muted">Guidance for this scene. No setting is needed to write.</p>{(['pointOfView', 'tense', 'instructions'] as const).map(field => <label key={field}>{field === 'pointOfView' ? 'Point of view' : field === 'tense' ? 'Tense' : 'Instructions'}<textarea rows={field === 'instructions' ? 3 : 1} value={scene.narration[field]} onChange={e => edit({ type: 'updateScene', sceneId: scene.id, narration: { ...scene.narration, [field]: e.target.value } })}/></label>)}</details></div></aside>
    {toneChoice && <TargetPicker label="Apply tone" onCancel={() => setToneChoice(null)}><strong>Apply {toneChoice.preset.name} to</strong><button onClick={() => applySceneTone(toneChoice.preset)}>This scene</button>{toneChoice.editor && !toneChoice.editor.isDestroyed && selectedBeatIndex >= 0 && <button onClick={() => applyBeatTone(toneChoice.preset, toneChoice.editor)}>Beat {selectedBeatIndex + 1} only</button>}<button onClick={() => setToneChoice(null)}>Cancel tone</button></TargetPicker>}
    {emotionChoice && <TargetPicker label="Emotion target" onCancel={() => setEmotionChoice(null)}><strong>Who feels {emotionChoice.preset.name}?</strong>{emotionChoice.targets.map((target, index) => <button key={target.pos} onClick={() => { if (!emotionChoice.editor.isDestroyed) insertEmotionReference(emotionChoice.editor, emotionChoice.preset, target); setEmotionChoice(null); setInspectorOpen(true); }}><span>{project.characters.find(c => c.id === target.characterId)?.name ?? target.label} · occurrence {index + 1}</span><small>{target.excerpt}</small></button>)}<button onClick={() => setEmotionChoice(null)}>Cancel emotion</button></TargetPicker>}
  </main>;
}
