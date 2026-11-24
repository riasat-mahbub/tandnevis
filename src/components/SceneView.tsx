import { useCallback, useEffect, useId, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import type { ReactNode } from 'react';
import type { Editor } from '@tiptap/core';
import { Copy, Plus, Trash2, ChevronLeft, ChevronRight, Search, Sparkles, ListPlus, Users, Heart, MessageSquare, SlidersHorizontal } from 'lucide-react';
import type { Character, Operation, Preset, ProjectSnapshot, Scene } from '../services/project';
import { emptyDocument } from '../services/project';
import { buildSceneGenerationContext } from '../services/generation-context';
import { generationInputFingerprint } from '../services/generation-fingerprint';
import type { GenerationSession } from '../services/generation-session';
import type { GenerationPurpose } from '../services/generation';
import { summaryBoard } from '../services/summary-board';
import { moved } from '../services/workspace';
import type { Workspace } from '../services/workspace';
import { effectiveColor, groupPresetsByColor, presetColorStyle } from '../services/preset-colors';
import CharacterIcon from './CharacterIcon';
import BeatEditor, { CHARACTER_REFERENCE_MIME, PRESET_REFERENCE_MIME, characterTargets, insertInlineReference } from './BeatEditor';
import type { LibraryKind } from './LibraryView';
import GenerationPanel from './GenerationPanel';
import SceneProseEditor from './SceneProseEditor';
import { TitleField } from './Fields';
import { Timeline, TimelineItem } from './Timeline';

interface Props { project: ProjectSnapshot; scene: Scene; workspace: Workspace; sessionId: string; generation: GenerationSession; generationReady: boolean; generationModel?: string; generationModelLabel?: string; defaultGuidance: string; locked: boolean; active?: boolean; navigation?: ReactNode; adjacentNavigation?: ReactNode; manageCharacters: (id?: string) => void; manageLibrary?: (kind: 'characters' | 'tones' | 'emotions', id?: string) => void; openSettings: () => void; notify: (message: string) => void; run: (action: () => Promise<unknown>) => void }
export default function SceneView({ project, scene, workspace, sessionId, generation, generationReady, generationModel, generationModelLabel, defaultGuidance, locked, active: visible = true, navigation, adjacentNavigation, manageCharacters, manageLibrary, openSettings, notify, run }: Props) {
  const [search, setSearch] = useState('');
  const [activeBlockTab, setActiveBlockTab] = useState<LibraryKind>('characters');
  const [shelfCollapsed, setShelfCollapsed] = useState(() => window.matchMedia('(max-width: 900px)').matches);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [draftPurpose, setDraftPurpose] = useState<GenerationPurpose>('prose');
  const root = useRef<HTMLElement>(null);
  const visibleRef = useRef(visible); visibleRef.current = visible;
  const prefix = useId();
  const editorRef = useRef<Editor | null>(null), editors = useRef(new Map<string, Editor>());
  const blockTabs = useRef<Partial<Record<LibraryKind, HTMLButtonElement>>>({});
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
  const blockTabOrder: LibraryKind[] = ['characters', 'emotions', 'tones'];
  const blockTabTitles: Record<LibraryKind, string> = { characters: 'Characters', emotions: 'Emotions', tones: 'Tones' };
  const blockTabIcons = { characters: Users, emotions: Heart, tones: MessageSquare };
  const blockTabDescriptions = { characters: 'Who is involved.', emotions: 'What they feel.', tones: 'How the writing sounds.' };
  const filteredCharacters = project.characters.filter(character => !character.archived && matches(character.name));
  const filteredEmotions = emotions.filter(preset => !preset.archived && matches(preset.name));
  const filteredTones = tones.filter(preset => !preset.archived && matches(preset.name));
  const emotionGroups = groupPresetsByColor('emotion', filteredEmotions);
  const toneGroups = groupPresetsByColor('tone', filteredTones);
  const activateBlockTab = (kind: LibraryKind, focus = false) => {
    setActiveBlockTab(kind); setSearch('');
    if (focus) blockTabs.current[kind]?.focus();
  };
  const onBlockTabKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>, current: LibraryKind) => {
    const index = blockTabOrder.indexOf(current);
    const next = ['ArrowRight', 'ArrowDown'].includes(event.key) ? (index + 1) % blockTabOrder.length
      : ['ArrowLeft', 'ArrowUp'].includes(event.key) ? (index + blockTabOrder.length - 1) % blockTabOrder.length
      : event.key === 'Home' ? 0 : event.key === 'End' ? blockTabOrder.length - 1 : -1;
    if (next < 0) return;
    event.preventDefault(); activateBlockTab(blockTabOrder[next], true);
  };
  const activeDefinitionsCount = activeBlockTab === 'characters' ? filteredCharacters.length : activeBlockTab === 'emotions' ? filteredEmotions.length : filteredTones.length;
  return <main ref={root} className={`scene-layout ${shelfCollapsed ? 'scene-layout-shelf-collapsed' : ''} ${detailsOpen ? 'scene-layout-details-open' : 'scene-layout-details-collapsed'}`}>
    <aside className={`library block-shelf ${shelfCollapsed ? 'block-shelf-collapsed' : ''}`} aria-label="Story blocks">
      <button className="shelf-toggle" aria-expanded={!shelfCollapsed} aria-controls={`${prefix}-shelf`} aria-label={shelfCollapsed ? 'Expand block sidebar' : 'Collapse block sidebar'} title={shelfCollapsed ? 'Expand block sidebar' : 'Collapse block sidebar'} onClick={() => setShelfCollapsed(!shelfCollapsed)}>{shelfCollapsed ? <ChevronRight size={15}/> : <ChevronLeft size={15}/>}<span className="shelf-toggle-label">{shelfCollapsed ? 'Blocks' : 'Hide blocks'}</span></button>
      {shelfCollapsed && <div className="block-category-rail" aria-label="Block shortcuts">{blockTabOrder.map(kind => { const Icon = blockTabIcons[kind]; return <button key={kind} className="quiet icon-button" aria-label={`Show ${blockTabTitles[kind].toLowerCase()} blocks`} aria-pressed={activeBlockTab === kind} title={blockTabTitles[kind]} onClick={() => { activateBlockTab(kind); setShelfCollapsed(false); }}><Icon size={18}/></button>; })}</div>}
      <div id={`${prefix}-shelf`} className="block-shelf-body" hidden={shelfCollapsed}>
        <h2>Story blocks</h2>
        <div className="block-tabs" role="tablist" aria-label="Block categories" aria-orientation="vertical">{blockTabOrder.map(kind => { const Icon = blockTabIcons[kind]; return <button key={kind} ref={element => { if (element) blockTabs.current[kind] = element; }} id={`${prefix}-tab-${kind}`} role="tab" aria-selected={activeBlockTab === kind} aria-controls={`${prefix}-blocks`} tabIndex={activeBlockTab === kind ? 0 : -1} onClick={() => activateBlockTab(kind)} onKeyDown={event => onBlockTabKeyDown(event, kind)}><Icon size={17} aria-hidden="true"/>{blockTabTitles[kind]}</button>; })}</div>
        <section className="block-tab-panel" id={`${prefix}-blocks`} role="tabpanel" aria-labelledby={`${prefix}-tab-${activeBlockTab}`}>
          <p className="block-category-description">{blockTabDescriptions[activeBlockTab]}</p>
          <label className="block-search"><span><Search size={13}/></span><span className="sr-only">Search {blockTabTitles[activeBlockTab].toLowerCase()}</span><input type="search" value={search} onChange={event => setSearch(event.target.value)} placeholder={`Search ${blockTabTitles[activeBlockTab].toLowerCase()}`}/></label>
          <div className="block-panel-heading"><button className="quiet block-manage" onClick={() => manage(activeBlockTab)}>Manage {blockTabTitles[activeBlockTab]}</button><button className="quiet shelf-new-definition" disabled={locked} onClick={() => manage(activeBlockTab, 'new')}><Plus size={14}/>{activeBlockTab === 'characters' ? 'New character' : activeBlockTab === 'emotions' ? 'New emotion' : 'New tone'}</button></div>
          <div className="block-palette">
          {activeBlockTab === 'characters' && <>
            <div className="block-collection" aria-label="Character blocks">{filteredCharacters.map(character => <button key={character.id} aria-label={`Character: ${character.name}`} className="character-chip story-block block-character" disabled={locked} draggable={!locked} title="Drag to add a character reference, or click to insert at the caret" onDragStart={event => { event.stopPropagation(); event.dataTransfer.setData(CHARACTER_REFERENCE_MIME, character.id); event.dataTransfer.effectAllowed = 'copy'; }} onClick={() => insertReference('character', character)}><CharacterIcon icon={character.icon} size={14}/>{character.name}<Plus size={12}/></button>)}</div>
          </>}
          {activeBlockTab === 'emotions' && <div className="preset-color-groups" aria-label="Emotion blocks">{emotionGroups.map(group => <section key={group.id} className="preset-color-group" aria-label={group.name}>
            <h4 className="preset-color-group-heading">{group.color && <span aria-hidden="true" style={{ backgroundColor: group.color }} />}{group.name}</h4>
            <div className="block-collection" aria-label={`${group.name} emotions`}>{group.presets.map(preset => <button key={preset.id} className="story-block block-emotion preset-colored" style={presetColorStyle(effectiveColor('emotion', preset))} aria-label={`Emotion: ${preset.name}`} disabled={locked} draggable={!locked} title="Drag to add an emotion reference, or click to insert at the caret" onDragStart={event => dragPreset(event, 'emotion', preset)} onClick={() => insertReference('emotion', preset)}>{preset.name}<Plus size={12}/></button>)}</div>
          </section>)}</div>}
          {activeBlockTab === 'tones' && <div className="preset-color-groups" aria-label="Tone blocks">{toneGroups.map(group => <section key={group.id} className="preset-color-group" aria-label={group.name}>
            <h4 className="preset-color-group-heading">{group.color && <span aria-hidden="true" style={{ backgroundColor: group.color }} />}{group.name}</h4>
            <div className="block-collection" aria-label={`${group.name} tones`}>{group.presets.map(preset => <button key={preset.id} className="story-block block-tone preset-colored" style={presetColorStyle(effectiveColor('tone', preset))} aria-label={`Tone: ${preset.name}`} disabled={locked} draggable={!locked} title="Drag to add a tone reference, or click to insert at the caret" onDragStart={event => dragPreset(event, 'tone', preset)} onClick={() => insertReference('tone', preset)}>{preset.name}<Plus size={12}/></button>)}</div>
          </section>)}</div>}
          {activeDefinitionsCount === 0 && <p className="muted block-empty">{search ? `No ${blockTabTitles[activeBlockTab].toLowerCase()} match “${search}”.` : `No ${blockTabTitles[activeBlockTab].toLowerCase()} yet.`}{search && <button className="quiet" onClick={() => setSearch('')}>Clear search</button>}</p>}
          </div>
        </section>
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
          {!generationReady && <button className="quiet" onClick={openSettings}>Open Settings</button>}
        </div>
      </div>
      <div className="scene-heading">
        <TitleField value={scene.title} label="Scene title" large disabled={locked} onSave={title => edit({ type: 'updateScene', sceneId: scene.id, title })}/>
        {adjacentNavigation}
      </div>
      <section className="summary-note summary-board" aria-labelledby={`${prefix}-summary-label`} data-board-id={summary.id} data-reference-drop-board>
        <div className="summary-board-heading"><h2 id={`${prefix}-summary-label`}>Scene summary</h2><span className="muted">Freeform direction</span></div>
        <BeatEditor beat={summary} index={-1} scope="summary" ariaLabel="Scene summary" placeholder="Describe the scene. Add optional character, emotion, or tone references when useful." characters={project.characters} tones={tones} emotions={emotions} notify={notify} register={register} editable={!locked} onChange={(document, text) => edit({ type: 'updateScene', sceneId: scene.id, summary: text, summaryDocument: document, toneId: '', tone: '' })} onFocus={selectEditor} onSelection={selectEditor}/>
      </section>
      <div className="sequence-heading"><h2>The beats</h2><span className="muted">{scene.beats.length} beat{scene.beats.length === 1 ? '' : 's'} - One moment, then the next.</span></div>
      {scene.beats.length ? <Timeline ids={scene.beats.map(b => b.id)} group={`Beats in ${scene.id}`} onReorder={ids => { edit({ type: 'reorderBeats', sceneId: scene.id, ids }); notify('Beat order updated.'); }}>{scene.beats.map((beat, index) => <TimelineItem key={beat.id} id={beat.id} index={index} count={scene.beats.length} group={`Beats in ${scene.id}`} label={`beat ${index + 1}`} disabled={locked} onMove={delta => { edit({ type: 'reorderBeats', sceneId: scene.id, ids: moved(scene.beats.map(b => b.id), beat.id, delta) }); notify(`Beat moved to position ${index + delta + 1}.`); }} actions={<><button disabled={locked} aria-label={`Duplicate beat ${index + 1}`} onClick={() => run(async () => { const before = new Set(scene.beats.map(b => b.id)); const p = await workspace.dispatch({ type: 'duplicateBeat', beatId: beat.id }); focusBeat(p.scenes.find(s => s.id === scene.id)!.beats.find(b => !before.has(b.id))?.id); })}><Copy size={13}/>Duplicate</button><button disabled={locked} className="danger" aria-label={`Delete beat ${index + 1}`} onClick={() => run(async () => { await workspace.dispatch({ type: 'deleteBeat', beatId: beat.id }); focusBeat(scene.beats[index + 1]?.id ?? scene.beats[index - 1]?.id); notify('Beat moved to Trash.'); })}><Trash2 size={13}/>Delete</button></>}><div className="beat-content" data-board-id={beat.id} data-reference-drop-board><span className="beat-label">Beat {index + 1}</span><BeatEditor beat={beat} index={index} characters={project.characters} tones={tones} emotions={emotions} notify={notify} register={register} editable={!locked} onChange={(document, text) => edit({ type: 'updateBeat', beatId: beat.id, document, text })} onFocus={selectEditor} onSelection={selectEditor}/></div><div className="insert-row"><button className="quiet" disabled={locked} onClick={() => run(() => addBeat(beat.id))}><Plus size={12}/>Insert beat after</button></div></TimelineItem>)}</Timeline> : <div className="empty-beats"><p>Give this scene its first moment.</p><p className="muted">Write freely. No character blocks are required.</p></div>}
      <button className="add-beat" disabled={locked} onClick={() => run(() => addBeat())}><Plus size={16}/>Add beat</button>

      {generationUnavailable && <p className="scene-generation-hint">{generationUnavailable}</p>}
      <details className="generation-preview"><summary>Preview scene context</summary><p className="muted">Only this scene's summary, ordered beats, optional narration, and references are included.</p>{preview.error ? <p role="alert">{preview.error}</p> : <pre>{preview.context?.readableContext}</pre>}</details>
      {(proseState.status !== 'idle' || beatsState.status !== 'idle') && <div className="scene-draft-review">
        {proseState.status !== 'idle' && beatsState.status !== 'idle' && <div className="draft-review-switch" aria-label="Draft to review"><button aria-pressed={reviewPurpose === 'beats'} onClick={() => setDraftPurpose('beats')}>Scene beats draft</button><button aria-pressed={reviewPurpose === 'prose'} onClick={() => setDraftPurpose('prose')}>Prose draft</button></div>}
        <GenerationPanel purpose={reviewPurpose} hideStartAction ready={generationReady && !preview.error} hasSavedBeats={reviewPurpose === 'beats' ? hasSummary : hasDirection} modelLabel={generationModelLabel} status={generationState.status} draftText={generationState.draftText} currentFingerprint={currentFingerprint} requestFingerprint={generationState.job?.inputFingerprint} currentProse={scene.prose} requestBaseProse={generationState.job?.requestSnapshot.baseProse} errorMessage={generationState.errorMessage} reason={generationUnavailable || undefined} onGenerate={() => startGeneration()} onStop={() => run(() => generation.stop(sessionId, scene.id, reviewPurpose))} onAccept={acknowledgeOutdated => run(() => acceptDraft(acknowledgeOutdated))} onCopy={copyDraft} onDiscard={discardDraft} onRetry={() => startGeneration()} onOpenSettings={openSettings}/>
      </div>}
      <SceneProseEditor value={scene.prose} disabled={locked} onChange={prose => edit({ type: 'updateScene', sceneId: scene.id, prose })}/>
    </section>

  </main>;
}
