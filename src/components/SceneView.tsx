import { useCallback, useEffect, useId, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import type { ReactNode } from 'react';
import type { Editor } from '@tiptap/core';
import { Copy, Plus, Trash2, ChevronLeft, ChevronRight, Search, Sparkles, ListPlus, SlidersHorizontal } from 'lucide-react';
import type { Character, Operation, Preset, ProjectSnapshot, Scene } from '../services/project';
import { emptyDocument } from '../services/project';
import { buildSceneGenerationContext } from '../services/generation-context';
import { generationInputFingerprint } from '../services/generation-fingerprint';
import type { GenerationSession } from '../services/generation-session';
import type { GenerationPurpose } from '../services/generation';
import { summaryBoard } from '../services/summary-board';
import { moved } from '../services/workspace';
import type { Workspace } from '../services/workspace';
import BeatEditor, { characterTargets, insertInlineReference } from './BeatEditor';
import WritingTools from './WritingTools';
import GenerationPanel from './GenerationPanel';
import SceneProseEditor from './SceneProseEditor';
import { TitleField } from './Fields';
import { Timeline, TimelineItem } from './Timeline';
import RelationshipPanel from './RelationshipPanel';

interface Props { project: ProjectSnapshot; scene: Scene; workspace: Workspace; sessionId: string; generation: GenerationSession; generationReady: boolean; generationModel?: string; generationModelLabel?: string; defaultGuidance: string; locked: boolean; active?: boolean; navigation?: ReactNode; adjacentNavigation?: ReactNode; manageCharacters: (id?: string) => void; manageLibrary?: (kind: 'characters' | 'tones' | 'emotions', id?: string) => void; openSettings: () => void; notify: (message: string) => void; run: (action: () => Promise<unknown>) => void }
export default function SceneView({ project, scene, workspace, sessionId, generation, generationReady, generationModel, generationModelLabel, defaultGuidance, locked, active: visible = true, navigation, adjacentNavigation, manageCharacters, manageLibrary, openSettings, notify, run }: Props) {
  const [shelfCollapsed, setShelfCollapsed] = useState(() => window.matchMedia('(max-width: 900px)').matches);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [draftPurpose, setDraftPurpose] = useState<GenerationPurpose>('prose');
  const [reviewOpen, setReviewOpen] = useState(true);
  const root = useRef<HTMLElement>(null);
  const visibleRef = useRef(visible); visibleRef.current = visible;
  const prefix = useId();
  const editorRef = useRef<Editor | null>(null), editors = useRef(new Map<string, Editor>());
  const tones = project.tones ?? [], emotions = project.emotions ?? [];
  const summary = useMemo(() => summaryBoard(scene, project.tones), [scene, project.tones]);
  const manage = (kind: 'characters' | 'tones' | 'emotions', id?: string) => { if (manageLibrary) manageLibrary(kind, id); else if (kind === 'characters') manageCharacters(id); };
  const register = useCallback((id: string, editor: Editor | null) => { if (editor) editors.current.set(id, editor); else editors.current.delete(id); }, []);
  const selectEditor = useCallback((editor: Editor) => {
    editorRef.current = editor;
  }, []);
  useEffect(() => {
    const focus = (event: Event) => {
      if (!visible) return;
      const { beatId, occurrenceId } = (event as CustomEvent<{ beatId: string; occurrenceId?: string }>).detail;
      const editor = editors.current.get(beatId); if (!editor) return;
      editor.commands.focus();
      if (occurrenceId) { const target = characterTargets(editor).find(t => t.occurrenceId === occurrenceId); if (target) editor.commands.setNodeSelection(target.pos); }
      selectEditor(editor); root.current?.querySelector(`[data-board-id="${beatId}"]`)?.scrollIntoView({ block: 'center' });
    };
    window.addEventListener('shorthand:focus-beat', focus); return () => window.removeEventListener('shorthand:focus-beat', focus);
  }, [selectEditor, visible]);
  useEffect(() => {
    if (!visible || !editorRef.current || editorRef.current.isDestroyed) return;
    const frame = requestAnimationFrame(() => editorRef.current?.commands.focus(undefined, { scrollIntoView: false }));
    return () => cancelAnimationFrame(frame);
  }, [visible]);
  const edit = (op: Operation) => { void workspace.dispatch(op).catch(() => {}); };
  const currentEditor = () => editorRef.current && !editorRef.current.isDestroyed ? editorRef.current : editors.current.get(summary.id);
  const focusBeat = (id?: string) => requestAnimationFrame(() => { if (!visibleRef.current) return; if (id) { editors.current.get(id)?.commands.focus('end'); root.current?.querySelector(`[data-item-id="${id}"]`)?.scrollIntoView({ block: 'nearest' }); } else root.current?.querySelector<HTMLButtonElement>('.add-beat')?.focus(); });
  async function addBeat(afterId?: string) {
    const current = workspace.getSnapshot().project!.scenes.find(s => s.id === scene.id)!, before = new Set(current.beats.map(b => b.id));
    const p = await workspace.dispatch({ type: 'createBeat', sceneId: scene.id, document: emptyDocument, text: '' });
    const id = p.scenes.find(s => s.id === scene.id)!.beats.find(b => !before.has(b.id))!.id;
    if (afterId) { const ids = p.scenes.find(s => s.id === scene.id)!.beats.map(b => b.id).filter(b => b !== id); ids.splice(ids.indexOf(afterId) + 1, 0, id); await workspace.dispatch({ type: 'reorderBeats', sceneId: scene.id, ids }); }
    focusBeat(id);
  }
  function insertReference(kind: 'character' | 'emotion' | 'tone', definition: Character | Preset) {
    const editor = currentEditor();
    if (!editor || editor.isDestroyed) return;
    if (insertInlineReference(editor, kind, definition)) {
      editor.commands.focus();
      notify(`${definition.name} inserted at the caret.`);
    }
  }
  const preview = useMemo(() => { try { const context = buildSceneGenerationContext(project, scene.id); return { context, error: context.unresolvedReferences.length ? 'A character definition is missing. Repair its reference before generating.' : '' }; } catch (error) { return { context: null, error: error instanceof Error ? error.message : String(error) }; } }, [project, scene.id]);
  const proseState = useSyncExternalStore(listener => generation.subscribe(sessionId, scene.id, listener), () => generation.getState(sessionId, scene.id), () => generation.getState(sessionId, scene.id));
  const beatsState = useSyncExternalStore(listener => generation.subscribe(sessionId, scene.id, listener, 'beats'), () => generation.getState(sessionId, scene.id, 'beats'), () => generation.getState(sessionId, scene.id, 'beats'));
  const proseReviewable = !['idle', 'accepted', 'discarded'].includes(proseState.status);
  const beatsReviewable = !['idle', 'accepted', 'discarded'].includes(beatsState.status);
  const reviewPurpose: GenerationPurpose = draftPurpose === 'prose' && !proseReviewable && beatsReviewable ? 'beats' : draftPurpose === 'beats' && !beatsReviewable && proseReviewable ? 'prose' : draftPurpose;
  const reviewVisible = reviewOpen && (proseReviewable || beatsReviewable);
  const generationState = reviewPurpose === 'beats' ? beatsState : proseState;
  const currentFingerprint = useMemo(() => preview.context ? generationInputFingerprint(preview.context, defaultGuidance, reviewPurpose) : '', [preview.context, defaultGuidance, reviewPurpose]);
  useEffect(() => { for (const purpose of ['prose', 'beats'] as const) void generation.load(sessionId, scene.id, purpose).catch(error => generation.failBeforeStart(sessionId, scene.id, error, purpose)); }, [generation, scene.id, sessionId]);
  const hasSummary = !!preview.context?.summaryBoard.readableText.trim();
  const hasDirection = hasSummary || scene.beats.some(beat => beat.text.trim().length > 0);
  const active = [proseState, beatsState].some(state => ['starting', 'streaming', 'stopping'].includes(state.status));
  const generationUnavailable = preview.error || (!generation.gateway.desktop ? 'Scene generation is available in the desktop app.' : !generationReady ? 'Connect and verify ChatGPT in Settings to generate.' : '');
  const startGeneration = (purpose: GenerationPurpose = reviewPurpose) => {
    if (!generationModel || preview.error) return;
    setDraftPurpose(purpose); setReviewOpen(true);
    void workspace.flush().then(() => { const state = workspace.getSnapshot(); if (!state.ready || state.session?.sessionId !== sessionId) throw new Error('The selected project is switching. Try generating again after it opens.'); return generation.start(sessionId, scene.id, generationModel, defaultGuidance, purpose); }).catch(error => generation.failBeforeStart(sessionId, scene.id, error, purpose));
  };
  const acceptDraft = (acknowledgeOutdated: boolean) => {
    const job = generationState.job; if (!job) return Promise.reject(new Error('The generated draft could not be found.'));
    return workspace.applyNativeMutation(sessionId, currentSession => generation.gateway.accept(sessionId, scene.id, job.id, currentSession.project.revision, job.model, job.connectionId, acknowledgeOutdated)).then(() => { generation.markAccepted(sessionId, scene.id, reviewPurpose); notify(reviewPurpose === 'beats' ? 'Generated beats added to this scene. Existing writing is preserved.' : 'Draft accepted into Scene prose.'); });
  };
  const copyDraft = () => { if (!generationState.draftText) return; if (!navigator.clipboard?.writeText) { notify('Clipboard access is unavailable. Select the draft text to copy it.'); return; } run(() => navigator.clipboard.writeText(generationState.draftText).then(() => notify('Draft copied to the clipboard.'))); };
  const discardDraft = () => { if (generationState.job) run(() => generation.discard(sessionId, scene.id, reviewPurpose).then(() => notify('Generated draft discarded.'))); };
  return <main ref={root} className={`scene-layout ${shelfCollapsed ? 'scene-layout-shelf-collapsed' : ''} ${detailsOpen ? 'scene-layout-details-open' : 'scene-layout-details-collapsed'}`}>
    <aside className={`library block-shelf ${shelfCollapsed ? 'block-shelf-collapsed' : ''}`} aria-label="Story blocks">
      <div className="shelf-heading"><strong hidden={shelfCollapsed}>Writing tools</strong><button className="shelf-toggle quiet icon-button" aria-expanded={!shelfCollapsed} aria-controls={`${prefix}-shelf`} aria-label={shelfCollapsed ? 'Expand block sidebar' : 'Collapse block sidebar'} title={shelfCollapsed ? 'Expand block sidebar' : 'Collapse block sidebar'} onClick={() => { setShelfCollapsed(!shelfCollapsed); if (!shelfCollapsed) setDetailsOpen(false); }}>{shelfCollapsed ? <ChevronRight size={17}/> : <ChevronLeft size={17}/>}</button></div>
      {shelfCollapsed && <button className="quiet icon-button" aria-label="Search story blocks" onClick={() => { setShelfCollapsed(false); requestAnimationFrame(() => root.current?.querySelector<HTMLInputElement>('.block-search input')?.focus()); }}><Search size={18}/></button>}
      <div id={`${prefix}-shelf`} className="block-shelf-body" hidden={shelfCollapsed}>
        <WritingTools project={project} locked={locked} onManage={manage} onInsert={insertReference}/>
      </div>
    <section className="scene-settings" aria-label="Scene settings">
      <button className="inspector-toggle" aria-expanded={detailsOpen} aria-controls={`${prefix}-details`} aria-label={detailsOpen ? 'Collapse scene details' : 'Expand scene details'} title={detailsOpen ? 'Collapse scene details' : 'Expand scene details'} onClick={() => { setDetailsOpen(!detailsOpen); if (!detailsOpen) setShelfCollapsed(false); }}><SlidersHorizontal size={17}/><span>{detailsOpen ? 'Hide details' : 'Scene details'}</span></button>
      <div id={`${prefix}-details`} className="block-inspector-body" hidden={!detailsOpen}><h2>Scene details</h2><p className="muted">Optional narration guidance. Writing and references work without these fields.</p>{(['pointOfView', 'tense', 'instructions'] as const).map(field => <label key={field}>{field === 'pointOfView' ? 'Point of view' : field === 'tense' ? 'Tense' : 'Instructions'}<textarea rows={field === 'instructions' ? 4 : 2} disabled={locked} value={scene.narration[field]} onChange={e => edit({ type: 'updateScene', sceneId: scene.id, narration: { ...scene.narration, [field]: e.target.value } })}/></label>)}</div>
    </section>
    </aside>
    <section className="scene-writing" aria-label="Scene writing">
      <div className="scene-toolbar">
        {navigation}
        <div className="scene-generate-actions" aria-label="Scene generation">
          <button className="primary" disabled={locked || !generationReady || !!generationUnavailable || !hasSummary || active} title={generationUnavailable || (!hasSummary ? 'Describe the scene first.' : 'Propose editable beats from the summary')} onClick={() => startGeneration('beats')}><ListPlus size={15}/>Generate beats</button>
          <button disabled={locked || !generationReady || !!generationUnavailable || !hasDirection || active} title={generationUnavailable || (!hasDirection ? 'Write a summary or a beat first.' : 'Draft prose from the summary and beats')} onClick={() => startGeneration('prose')}><Sparkles size={15}/>Generate prose</button>
          {(proseReviewable || beatsReviewable) && !reviewOpen && <button onClick={() => setReviewOpen(true)}>Review draft</button>}
          {!generationReady && <button className="quiet" onClick={openSettings}>Open Settings</button>}
        </div>
      </div>
      <div className="scene-heading">
        <TitleField value={scene.title} label="Scene title" large disabled={locked} onSave={title => edit({ type: 'updateScene', sceneId: scene.id, title })}/>
        {adjacentNavigation}
      </div>
      {reviewVisible && <div className="review-banner"><div><h2>{reviewPurpose === 'beats' ? 'Review proposed beats' : 'Review prose draft'}</h2><span className="muted">Draft not applied</span></div><button onClick={() => setReviewOpen(false)}>Close review</button></div>}
      <div className={`scene-review-grid ${reviewVisible ? 'scene-review-visible' : ''}`}>
      <div className="scene-composition">
        <div className="review-source-heading" hidden={!reviewVisible}><h2>{reviewPurpose === 'beats' ? 'Current scene direction' : 'Current manuscript'}</h2><p className="muted">Your writing remains editable while you compare the proposal.</p></div>
      <section className="summary-note summary-board" aria-labelledby={`${prefix}-summary-label`} data-board-id={summary.id} data-reference-drop-board>
        <div className="summary-board-heading"><h2 id={`${prefix}-summary-label`}>Scene summary</h2><span className="muted">Freeform direction</span></div>
        <BeatEditor beat={summary} index={-1} scope="summary" ariaLabel="Scene summary" placeholder="Describe the scene. Add optional character, emotion, or tone references when useful." characters={project.characters} tones={tones} emotions={emotions} notify={notify} register={register} editable={!locked} onChange={(document, text) => edit({ type: 'updateScene', sceneId: scene.id, summary: text, summaryDocument: document, toneId: '', tone: '' })} onFocus={selectEditor} onSelection={selectEditor}/>
      </section>
      <RelationshipPanel project={project} workspace={workspace} locked={locked} sceneId={scene.id} run={run}/>
      <div className="sequence-heading"><h2>The beats</h2><span className="muted">{scene.beats.length} beat{scene.beats.length === 1 ? '' : 's'} - One moment, then the next.</span></div>
      {scene.beats.length ? <Timeline ids={scene.beats.map(b => b.id)} group={`Beats in ${scene.id}`} onReorder={ids => { edit({ type: 'reorderBeats', sceneId: scene.id, ids }); notify('Beat order updated.'); }}>{scene.beats.map((beat, index) => <TimelineItem key={beat.id} id={beat.id} index={index} count={scene.beats.length} group={`Beats in ${scene.id}`} label={`beat ${index + 1}`} disabled={locked} onMove={delta => { edit({ type: 'reorderBeats', sceneId: scene.id, ids: moved(scene.beats.map(b => b.id), beat.id, delta) }); notify(`Beat moved to position ${index + delta + 1}.`); }} actions={<><button disabled={locked} aria-label={`Duplicate beat ${index + 1}`} onClick={() => run(async () => { const before = new Set(scene.beats.map(b => b.id)); const p = await workspace.dispatch({ type: 'duplicateBeat', beatId: beat.id }); focusBeat(p.scenes.find(s => s.id === scene.id)!.beats.find(b => !before.has(b.id))?.id); })}><Copy size={13}/>Duplicate</button><button disabled={locked} className="danger" aria-label={`Delete beat ${index + 1}`} onClick={() => run(async () => { await workspace.dispatch({ type: 'deleteBeat', beatId: beat.id }); focusBeat(scene.beats[index + 1]?.id ?? scene.beats[index - 1]?.id); notify('Beat moved to Trash.'); })}><Trash2 size={13}/>Delete</button></>}><div className="beat-content" data-board-id={beat.id} data-reference-drop-board><span className="beat-label">Beat {index + 1}</span><BeatEditor beat={beat} index={index} characters={project.characters} tones={tones} emotions={emotions} notify={notify} register={register} editable={!locked} onChange={(document, text) => edit({ type: 'updateBeat', beatId: beat.id, document, text })} onFocus={selectEditor} onSelection={selectEditor}/></div><div className="insert-row"><button className="quiet" disabled={locked} onClick={() => run(() => addBeat(beat.id))}><Plus size={12}/>Insert beat after</button></div></TimelineItem>)}</Timeline> : <div className="empty-beats"><p>Give this scene its first moment.</p><p className="muted">Write freely. No character blocks are required.</p></div>}
      <button className="add-beat" disabled={locked} onClick={() => run(() => addBeat())}><Plus size={16}/>Add beat</button>

      {generationUnavailable && <p className="scene-generation-hint">{generationUnavailable}</p>}
      <details className="generation-preview"><summary>Preview scene context</summary><p className="muted">Includes this scene's summary, ordered beats, narration, selected character profiles, and their Before/After relationship states.</p>{preview.error ? <p role="alert">{preview.error}</p> : <pre>{preview.context?.readableContext}</pre>}</details>
      <SceneProseEditor value={scene.prose} disabled={locked} onChange={prose => edit({ type: 'updateScene', sceneId: scene.id, prose })}/>
      </div>
      <aside className="scene-draft-review" aria-label="Draft proposal" hidden={!reviewVisible}>
        {proseReviewable && beatsReviewable && <div className="draft-review-switch" aria-label="Draft to review"><button aria-pressed={reviewPurpose === 'beats'} onClick={() => setDraftPurpose('beats')}>Scene beats draft</button><button aria-pressed={reviewPurpose === 'prose'} onClick={() => setDraftPurpose('prose')}>Prose draft</button></div>}
        <GenerationPanel purpose={reviewPurpose} hideStartAction ready={generationReady && !preview.error} hasSavedBeats={reviewPurpose === 'beats' ? hasSummary : hasDirection} modelLabel={generationModelLabel} status={generationState.status} draftText={generationState.draftText} currentFingerprint={currentFingerprint} requestFingerprint={generationState.job?.inputFingerprint} currentProse={scene.prose} requestBaseProse={generationState.job?.requestSnapshot.baseProse} errorMessage={generationState.errorMessage} reason={generationUnavailable || undefined} onGenerate={() => startGeneration()} onStop={() => run(() => generation.stop(sessionId, scene.id, reviewPurpose))} onAccept={acknowledgeOutdated => run(() => acceptDraft(acknowledgeOutdated))} onCopy={copyDraft} onDiscard={discardDraft} onRetry={() => startGeneration()} onOpenSettings={openSettings}/>
      </aside>
      </div>
    </section>

  </main>;
}
