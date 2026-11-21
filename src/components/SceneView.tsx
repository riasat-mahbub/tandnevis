import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import type { Editor } from '@tiptap/core';
import type { ReactNode } from 'react';
import { Copy, Plus, Trash2, ChevronDown, Search, Sparkles, ListPlus } from 'lucide-react';
import type { Character, Operation, Preset, ProjectSnapshot, Scene } from '../services/project';
import { emptyDocument } from '../services/project';
import { buildSceneGenerationContext } from '../services/generation-context';
import { generationInputFingerprint } from '../services/generation-fingerprint';
import type { GenerationSession } from '../services/generation-session';
import type { GenerationPurpose } from '../services/generation';
import { summaryBoard } from '../services/summary-board';
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
  const [draftPurpose, setDraftPurpose] = useState<GenerationPurpose>('prose');
  const [emotionChoice, setEmotionChoice] = useState<{ preset: Preset; editor: Editor; targets: CharacterTarget[] } | null>(null);
  const editorRef = useRef<Editor | null>(null), editors = useRef(new Map<string, Editor>());
  const tones = project.tones ?? [], emotions = project.emotions ?? [];
  const summary = useMemo(() => summaryBoard(scene, project.tones), [scene, project.tones]);
  const selectedSummary = selectedBeatId === summary.id;
  const selectedBeatIndex = scene.beats.findIndex(b => b.id === selectedBeatId);
  const manage = (kind: 'characters' | 'tones' | 'emotions', id?: string) => { if (manageLibrary) manageLibrary(kind, id); else if (kind === 'characters') manageCharacters(id); };
  useEffect(() => { if (selectedBeatId && selectedBeatId !== summary.id && !scene.beats.some(b => b.id === selectedBeatId)) { setSelectedBeatId(null); editorRef.current = null; setReference(null); setEmotionChoice(null); } }, [scene.beats, selectedBeatId, summary.id]);
  const register = useCallback((id: string, editor: Editor | null) => { if (editor) editors.current.set(id, editor); else editors.current.delete(id); }, []);
  const selectEditor = useCallback((editor: Editor) => {
    editorRef.current = editor;
    const owner = [...editors.current].find(([, registered]) => registered === editor);
    if (owner) setSelectedBeatId(owner[0]);
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
  const currentEditor = () => editorRef.current && !editorRef.current.isDestroyed ? editorRef.current : editors.current.get(summary.id);
  const focusBeat = (id?: string) => requestAnimationFrame(() => { if (id) { editors.current.get(id)?.commands.focus('end'); document.querySelector(`[data-item-id="${id}"]`)?.scrollIntoView({ block: 'nearest' }); } else document.getElementById('add-beat')?.focus(); });
  async function addBeat(afterId?: string) {
    const current = workspace.getSnapshot().project!.scenes.find(s => s.id === scene.id)!, before = new Set(current.beats.map(b => b.id));
    const p = await workspace.dispatch({ type: 'createBeat', sceneId: scene.id, document: emptyDocument, text: '' });
    const id = p.scenes.find(s => s.id === scene.id)!.beats.find(b => !before.has(b.id))!.id;
    if (afterId) { const ids = p.scenes.find(s => s.id === scene.id)!.beats.map(b => b.id).filter(b => b !== id); ids.splice(ids.indexOf(afterId) + 1, 0, id); await workspace.dispatch({ type: 'reorderBeats', sceneId: scene.id, ids }); }
    setSelectedBeatId(id); focusBeat(id);
  }
  function insertCharacter(character: Character) {
    const editor = currentEditor();
    if (!editor || editor.isDestroyed) { notify('Select a beat, then choose a character to insert a reference at the caret.'); return; }
    insertCharacterReference(editor, character); editor.commands.focus();
    notify(`${character.name} inserted into this beat. Select the reference to add local direction.`);
  }
  function insertEmotion(preset: Preset) {
    const editor = currentEditor();
    if (!editor || editor.isDestroyed) { notify('Select a character block in a beat, then choose an emotion.'); return; }
    const targets = characterTargets(editor), selection = editor.state.selection;
    const selected = 'node' in selection ? targets.find(t => t.pos === selection.from || (selection.node as { attrs: Record<string, string> }).attrs.targetOccurrenceId === t.occurrenceId && !!t.occurrenceId) : undefined;
    if (selected) { insertEmotionReference(editor, preset, selected); setInspectorOpen(true); notify(`${preset.name} applies to this character occurrence only.`); }
    else if (targets.length) setEmotionChoice({ preset, editor, targets });
    else notify('This beat has no character blocks. Insert a character before applying an emotion.');
  }
  function applyTone(preset: Preset) {
    const editor = currentEditor();
    if (!editor || editor.isDestroyed) { notify('Select the summary or a beat before inserting a tone.'); return; }
    insertToneReference(editor, preset); editor.commands.focus(); setInspectorOpen(true);
    notify(editor === editors.current.get(summary.id) ? `${preset.name} guides this scene from its summary.` : `${preset.name} applies to this beat only.`);
  }
  const localCharacter = project.characters.find(c => c.id === reference?.attrs.characterId);
  const localEmotion = emotions.find(p => p.id === reference?.attrs.emotionId), localTone = tones.find(p => p.id === reference?.attrs.toneId);
  const emotionTarget = reference?.kind === 'emotionReference' && editorRef.current ? characterTargets(editorRef.current).find(t => t.occurrenceId === reference.attrs.targetOccurrenceId) : undefined;
  const emotionTargetName = project.characters.find(c => c.id === emotionTarget?.characterId)?.name ?? emotionTarget?.label;
  const preview = useMemo(() => { try { const context = buildSceneGenerationContext(project, scene.id); return { context, error: context.unresolvedReferences.length ? 'A character definition is missing. Repair its reference before generating.' : '' }; } catch (error) { return { context: null, error: error instanceof Error ? error.message : String(error) }; } }, [project, scene.id]);
  const proseState = useSyncExternalStore(listener => generation.subscribe(sessionId, scene.id, listener), () => generation.getState(sessionId, scene.id), () => generation.getState(sessionId, scene.id));
  const beatsState = useSyncExternalStore(listener => generation.subscribe(sessionId, scene.id, listener, 'beats'), () => generation.getState(sessionId, scene.id, 'beats'), () => generation.getState(sessionId, scene.id, 'beats'));
  const reviewPurpose: GenerationPurpose = draftPurpose === 'prose' && proseState.status === 'idle' && beatsState.status !== 'idle' ? 'beats' : draftPurpose === 'beats' && beatsState.status === 'idle' && proseState.status !== 'idle' ? 'prose' : draftPurpose;
  const generationState = reviewPurpose === 'beats' ? beatsState : proseState;
  const currentFingerprint = useMemo(() => preview.context ? generationInputFingerprint(preview.context, defaultGuidance, reviewPurpose) : '', [preview.context, defaultGuidance, reviewPurpose]);
  useEffect(() => { for (const purpose of ['prose', 'beats'] as const) void generation.load(sessionId, scene.id, purpose).catch(error => generation.failBeforeStart(sessionId, scene.id, error, purpose)); }, [generation, scene.id, sessionId]);
  const hasSummary = !!preview.context?.summaryBoard.readableText.trim();
  const hasDirection = hasSummary || scene.beats.some(beat => beat.text.trim().length > 0);
  const active = [proseState, beatsState].some(state => ['starting', 'streaming', 'stopping'].includes(state.status));
  const generationUnavailable = preview.error || (!generation.gateway.desktop ? 'Scene generation is available in the desktop app.' : !generationReady ? 'Connect and verify ChatGPT in Settings to generate.' : '');
  const startGeneration = (purpose: GenerationPurpose = reviewPurpose) => {
    if (!generationModel || preview.error) return;
    setDraftPurpose(purpose);
    void workspace.flush().then(() => { const state = workspace.getSnapshot(); if (!state.ready || state.session?.sessionId !== sessionId) throw new Error('The selected project is switching. Try generating again after it opens.'); return generation.start(sessionId, scene.id, generationModel, defaultGuidance, purpose); }).catch(error => generation.failBeforeStart(sessionId, scene.id, error, purpose));
  };
  const acceptDraft = (acknowledgeOutdated: boolean) => {
    const job = generationState.job; if (!job) return Promise.reject(new Error('The generated draft could not be found.'));
    return workspace.applyNativeMutation(sessionId, currentSession => generation.gateway.accept(sessionId, scene.id, job.id, currentSession.project.revision, job.model, job.connectionId, acknowledgeOutdated)).then(() => { generation.markAccepted(sessionId, scene.id, reviewPurpose); notify(reviewPurpose === 'beats' ? 'Generated beats added to this scene. Existing writing is preserved.' : 'Draft accepted into Scene prose.'); });
  };
  const copyDraft = () => { if (!generationState.draftText) return; if (!navigator.clipboard?.writeText) { notify('Clipboard access is unavailable. Select the draft text to copy it.'); return; } run(() => navigator.clipboard.writeText(generationState.draftText).then(() => notify('Draft copied to the clipboard.'))); };
  const discardDraft = () => { if (generationState.job) run(() => generation.discard(sessionId, scene.id, reviewPurpose).then(() => notify('Generated draft discarded.'))); };
  const matches = (name: string) => name.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase());
  const dragPreset = (event: React.DragEvent, kind: 'tone' | 'emotion', preset: Preset) => { event.stopPropagation(); event.dataTransfer.setData(PRESET_REFERENCE_MIME, JSON.stringify({ kind, id: preset.id })); event.dataTransfer.effectAllowed = 'copy'; };
  return <main id="main" className="scene-layout">
    <aside className="library block-shelf"><button className="shelf-toggle" aria-expanded={shelfOpen} onClick={() => setShelfOpen(!shelfOpen)}>Insert blocks<ChevronDown size={15}/></button><div className="block-shelf-body" data-open={shelfOpen}>
      <h2>Story blocks</h2><p className="muted">Reusable across every scene.</p><label className="block-search"><span><Search size={13}/>Search blocks</span><input value={search} onChange={e => setSearch(e.target.value)} placeholder="Find a block"/></label>
      <section className="shelf-group"><div className="shelf-heading"><h3>Characters</h3><button className="quiet" onClick={() => manage('characters')}>Manage characters</button></div><div className="block-collection">{project.characters.filter(c => !c.archived && matches(c.name)).map(c => <button key={c.id} aria-label={c.name} className="character-chip story-block block-character" disabled={locked} draggable={!locked} title="Character · insert at the caret or drag into a beat" onDragStart={event => { event.stopPropagation(); event.dataTransfer.setData(CHARACTER_REFERENCE_MIME, c.id); event.dataTransfer.effectAllowed = 'copy'; }} onClick={() => insertCharacter(c)}>{c.name}<Plus size={12}/></button>)}</div>{!project.characters.some(c => !c.archived) && <button className="quiet" onClick={() => manage('characters', 'new')}>New character…</button>}</section>
      {(['emotions', 'tones'] as const).map(kind => <section className="shelf-group" key={kind}><div className="shelf-heading"><h3>{kind === 'emotions' ? 'Emotions' : 'Tones'}</h3><button className="quiet" onClick={() => manage(kind)}>Manage {kind}</button></div><div className="block-collection">{(kind === 'emotions' ? emotions : tones).filter(p => !p.archived && matches(p.name)).map(p => <button key={p.id} className={`story-block block-${kind === 'emotions' ? 'emotion' : 'tone'}`} aria-label={`${kind === 'emotions' ? 'Emotion' : 'Tone'}: ${p.name}`} disabled={locked} draggable={!locked} title={kind === 'emotions' ? 'Emotion · drop onto a character occurrence' : 'Tone · drop in a scene or beat'} onDragStart={e => dragPreset(e, kind === 'emotions' ? 'emotion' : 'tone', p)} onClick={() => { if (kind === 'emotions') insertEmotion(p); else applyTone(p); }}>{p.name}<Plus size={12}/></button>)}</div>{!(kind === 'emotions' ? emotions : tones).some(p => !p.archived) && <button className="quiet" onClick={() => manage(kind, 'new')}>New {kind === 'emotions' ? 'emotion' : 'tone'}…</button>}</section>)}
      {search && ![...project.characters, ...emotions, ...tones].some(p => !p.archived && matches(p.name)) && <p className="muted">No blocks match. <button className="quiet" onClick={() => setSearch('')}>Clear search</button></p>}
    </div></aside>
    <section className="scene-writing" aria-label="Scene writing">
      <div className="scene-heading">
        <div className="scene-generate-actions" aria-label="Scene generation">
          <button className="primary" disabled={locked || !generationReady || !!generationUnavailable || !hasSummary || active} title={generationUnavailable || (!hasSummary ? 'Describe the scene on its summary board first.' : 'Turn the summary into proposed editable beats')} onClick={() => startGeneration('beats')}><ListPlus size={15}/>Generate scene</button>
          <button disabled={locked || !generationReady || !!generationUnavailable || !hasDirection || active} title={generationUnavailable || (!hasDirection ? 'Write a summary or a beat first.' : 'Write prose from the summary and beats')} onClick={() => startGeneration('prose')}><Sparkles size={15}/>Generate prose</button>
          {!generationReady && <button className="quiet" onClick={openSettings}>Open Settings</button>}
        </div>
        {generationUnavailable && <p className="scene-generation-hint">{generationUnavailable}</p>}
        <TitleField value={scene.title} label="Scene title" large disabled={locked} onSave={title => edit({ type: 'updateScene', sceneId: scene.id, title })}/>
      </div>
      <section className={selectedSummary ? 'summary-note summary-board selected' : 'summary-note summary-board'} aria-labelledby="scene-summary-label" data-board-id={summary.id}>
        <h2 id="scene-summary-label">Scene summary</h2>
        <BeatEditor beat={summary} index={-1} scope="summary" ariaLabel="Scene summary" placeholder="Describe the scene. Drop characters, emotions, and tones into your text." characters={project.characters} tones={tones} emotions={emotions} notify={notify} register={register} editable={!locked} onChange={(document, text) => edit({ type: 'updateScene', sceneId: scene.id, summary: text, summaryDocument: document, toneId: '', tone: '' })} onFocus={editor => { setSelectedBeatId(summary.id); selectEditor(editor); }} onSelection={selectEditor}/>
      </section>
      <div className="sequence-heading"><h2>The beats</h2><span className="muted">{scene.beats.length} beat{scene.beats.length === 1 ? '' : 's'} - One moment, then the next.</span></div>
      {scene.beats.length ? <Timeline ids={scene.beats.map(b => b.id)} group={`Beats in ${scene.id}`} onReorder={ids => { edit({ type: 'reorderBeats', sceneId: scene.id, ids }); notify('Beat order updated.'); }}>{scene.beats.map((beat, index) => <TimelineItem key={beat.id} id={beat.id} index={index} count={scene.beats.length} group={`Beats in ${scene.id}`} label={`beat ${index + 1}`} disabled={locked} onMove={delta => { edit({ type: 'reorderBeats', sceneId: scene.id, ids: moved(scene.beats.map(b => b.id), beat.id, delta) }); notify(`Beat moved to position ${index + delta + 1}.`); }} actions={<><button disabled={locked} aria-label={`Duplicate beat ${index + 1}`} onClick={() => run(async () => { const before = new Set(scene.beats.map(b => b.id)); const p = await workspace.dispatch({ type: 'duplicateBeat', beatId: beat.id }); focusBeat(p.scenes.find(s => s.id === scene.id)!.beats.find(b => !before.has(b.id))?.id); })}><Copy size={13}/>Duplicate</button><button disabled={locked} className="danger" aria-label={`Delete beat ${index + 1}`} onClick={() => run(async () => { await workspace.dispatch({ type: 'deleteBeat', beatId: beat.id }); if (selectedBeatId === beat.id) { editorRef.current = null; setReference(null); } focusBeat(scene.beats[index + 1]?.id ?? scene.beats[index - 1]?.id); notify('Beat moved to Trash.'); })}><Trash2 size={13}/>Delete</button></>}><div className={selectedBeatId === beat.id ? 'beat-content selected' : 'beat-content'}><span className="beat-label">Beat {index + 1}</span><BeatEditor beat={beat} index={index} characters={project.characters} tones={tones} emotions={emotions} notify={notify} register={register} editable={!locked} onChange={(document, text) => edit({ type: 'updateBeat', beatId: beat.id, document, text })} onFocus={editor => { setSelectedBeatId(beat.id); selectEditor(editor); }} onSelection={selectEditor}/></div><div className="insert-row"><button className="quiet" disabled={locked} onClick={() => run(() => addBeat(beat.id))}><Plus size={12}/>Insert beat after</button></div></TimelineItem>)}</Timeline> : <div className="empty-beats"><p>Give this scene its first moment.</p><p className="muted">Write freely. No character blocks are required.</p></div>}
      <button id="add-beat" className="primary add-beat" disabled={locked} onClick={() => run(() => addBeat())}><Plus size={16}/>Add beat</button>
      <details className="generation-preview"><summary>Preview scene context</summary><p className="muted">Only this scene's summary, ordered beats, referenced profiles, tones, and targeted emotions are included.</p>{preview.error ? <p role="alert">{preview.error}</p> : <pre>{preview.context?.readableContext}</pre>}</details>
      {(proseState.status !== 'idle' || beatsState.status !== 'idle') && <div className="scene-draft-review">
        {proseState.status !== 'idle' && beatsState.status !== 'idle' && <div className="draft-review-switch" aria-label="Draft to review"><button aria-pressed={reviewPurpose === 'beats'} onClick={() => setDraftPurpose('beats')}>Scene beats draft</button><button aria-pressed={reviewPurpose === 'prose'} onClick={() => setDraftPurpose('prose')}>Prose draft</button></div>}
        <GenerationPanel purpose={reviewPurpose} hideStartAction ready={generationReady && !preview.error} hasSavedBeats={reviewPurpose === 'beats' ? hasSummary : hasDirection} modelLabel={generationModelLabel} status={generationState.status} draftText={generationState.draftText} currentFingerprint={currentFingerprint} requestFingerprint={generationState.job?.inputFingerprint} currentProse={scene.prose} requestBaseProse={generationState.job?.requestSnapshot.baseProse} errorMessage={generationState.errorMessage} reason={generationUnavailable || undefined} onGenerate={() => startGeneration()} onStop={() => run(() => generation.stop(sessionId, scene.id, reviewPurpose))} onAccept={acknowledgeOutdated => run(() => acceptDraft(acknowledgeOutdated))} onCopy={copyDraft} onDiscard={discardDraft} onRetry={() => startGeneration()} onOpenSettings={openSettings}/>
      </div>}
      <SceneProseEditor value={scene.prose} disabled={locked} onChange={prose => edit({ type: 'updateScene', sceneId: scene.id, prose })}/>
    </section>
    <aside className="inspector block-inspector"><button className="inspector-toggle" aria-expanded={inspectorOpen} onClick={() => setInspectorOpen(!inspectorOpen)}>Block details<ChevronDown size={15}/></button><div className="block-inspector-body" data-open={inspectorOpen}><h2>Block details</h2>{reference ? <section><span className="scope-label">{reference.kind === 'toneReference' ? selectedSummary ? 'Summary: scene direction' : `Beat ${selectedBeatIndex + 1} only` : 'This character occurrence only'}</span>
      {reference.kind === 'characterReference' ? <><h3>{localCharacter?.name ?? reference.attrs.label}</h3>{localCharacter && <><p className="muted">{localCharacter.voice || 'No baseline voice yet.'}</p>{localCharacter.defaultToneId && <p className="muted">Default tone: {tones.find(t => t.id === localCharacter.defaultToneId)?.name ?? 'Unavailable'}</p>}{localCharacter.defaultEmotionId && <p className="muted">Default emotion: {emotions.find(p => p.id === localCharacter.defaultEmotionId)?.name ?? 'Unavailable'}</p>}</>}{(['emotion', 'delivery'] as const).map(field => <label key={field} className={`${field}-field`}>{field === 'emotion' ? 'Local emotion note' : 'Delivery'}<input value={reference.attrs[field] ?? ''} placeholder={field === 'emotion' ? 'Optional custom guidance' : 'e.g. Under her breath'} onChange={e => { if (editorRef.current) updateCharacterReference(editorRef.current, { [field]: e.target.value }); setReference({ ...reference, attrs: { ...reference.attrs, [field]: e.target.value } }); }}/></label>)}<button className="quiet" onClick={() => manageCharacters(reference.attrs.characterId)}>Edit reusable profile</button></> : reference.kind === 'emotionReference' ? <><h3>Emotion: {localEmotion?.name ?? reference.attrs.label}</h3><p>For {emotionTargetName || 'unresolved target'} - {selectedSummary ? 'Summary' : `Beat ${selectedBeatIndex + 1}`}</p><p>{localEmotion?.guidance || localEmotion?.meaning}</p><button className="quiet" onClick={() => manage('emotions', reference.attrs.emotionId)}>Edit shared emotion</button></> : <><h3>Tone: {localTone?.name ?? reference.attrs.label}</h3><p>{localTone?.guidance || localTone?.meaning}</p><p className="muted">{selectedSummary ? 'Guides the scene unless a beat has its own tone.' : `Overrides summary tone: ${preview.context?.summaryBoard.tone || 'None'}`}</p><button className="quiet" onClick={() => manage('tones', reference.attrs.toneId)}>Edit shared tone</button></>}
      <p className="muted">Local blocks do not edit shared definitions.</p><button className="quiet danger" onClick={() => { if (editorRef.current) removeSelectedReference(editorRef.current); setReference(null); }}>Remove this reference</button></section> : <p className="muted">Select a block to see its guidance and scope.</p>}
      <details><summary>Optional narration</summary><p className="muted">Guidance for this scene. No setting is needed to write.</p>{(['pointOfView', 'tense', 'instructions'] as const).map(field => <label key={field}>{field === 'pointOfView' ? 'Point of view' : field === 'tense' ? 'Tense' : 'Instructions'}<textarea rows={field === 'instructions' ? 3 : 1} value={scene.narration[field]} onChange={e => edit({ type: 'updateScene', sceneId: scene.id, narration: { ...scene.narration, [field]: e.target.value } })}/></label>)}</details></div></aside>
    {emotionChoice && <TargetPicker label="Emotion target" onCancel={() => setEmotionChoice(null)}><strong>Who feels {emotionChoice.preset.name}?</strong>{emotionChoice.targets.map((target, index) => <button key={target.pos} onClick={() => { if (!emotionChoice.editor.isDestroyed) insertEmotionReference(emotionChoice.editor, emotionChoice.preset, target); setEmotionChoice(null); setInspectorOpen(true); }}><span>{project.characters.find(c => c.id === target.characterId)?.name ?? target.label} · occurrence {index + 1}</span><small>{target.excerpt}</small></button>)}<button onClick={() => setEmotionChoice(null)}>Cancel emotion</button></TargetPicker>}
  </main>;
}
