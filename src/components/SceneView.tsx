import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import type { Editor } from '@tiptap/core';
import { Copy, Plus, Trash2, Users } from 'lucide-react';
import type { Character, Operation, ProjectSnapshot, Scene } from '../services/project';
import { emptyDocument } from '../services/project';
import { buildSceneGenerationContext } from '../services/generation-context';
import { generationInputFingerprint } from '../services/generation-fingerprint';
import type { GenerationSession } from '../services/generation-session';
import { moved } from '../services/workspace';
import type { Workspace } from '../services/workspace';
import BeatEditor, { CHARACTER_REFERENCE_MIME, updateCharacterReference } from './BeatEditor';
import GenerationPanel from './GenerationPanel';
import SceneProseEditor from './SceneProseEditor';
import { TitleField } from './Fields';
import { Timeline, TimelineItem } from './Timeline';

interface Props { project: ProjectSnapshot; scene: Scene; workspace: Workspace; sessionId: string; generation: GenerationSession; generationReady: boolean; generationModel?: string; generationModelLabel?: string; defaultGuidance: string; locked: boolean; manageCharacters: (id?: string) => void; openSettings: () => void; notify: (message: string) => void; run: (action: () => Promise<unknown>) => void }
export default function SceneView({ project, scene, workspace, sessionId, generation, generationReady, generationModel, generationModelLabel, defaultGuidance, locked, manageCharacters, openSettings, notify, run }: Props) {
  const [selectedBeatId, setSelectedBeatId] = useState<string | null>(null);
  const [reference, setReference] = useState<Record<string, string> | null>(null);
  const editorRef = useRef<Editor | null>(null);
  const editors = useRef(new Map<string, Editor>());
  useEffect(() => {
    if (selectedBeatId && !scene.beats.some(b => b.id === selectedBeatId)) {
      setSelectedBeatId(null); editorRef.current = null; setReference(null);
    }
  }, [scene.beats, selectedBeatId]);
  const register = useCallback((id: string, editor: Editor | null) => { if (editor) editors.current.set(id, editor); else editors.current.delete(id); }, []);
  const selectEditor = useCallback((editor: Editor) => {
    editorRef.current = editor;
    const selection = editor.state.selection;
    const node = 'node' in selection ? selection.node as { type: { name: string }; attrs: Record<string, string> } : null;
    setReference(node?.type.name === 'characterReference' ? { ...node.attrs } : null);
  }, []);
  const edit = (op: Operation) => { void workspace.dispatch(op).catch(() => {}); };
  const focusBeat = (id?: string) => requestAnimationFrame(() => { if (id) { editors.current.get(id)?.commands.focus('end'); document.querySelector(`[data-item-id="${id}"]`)?.scrollIntoView({ block: 'nearest' }); } else document.getElementById('add-beat')?.focus(); });
  async function addBeat(afterId?: string) {
    const current = workspace.getSnapshot().project!.scenes.find(s => s.id === scene.id)!;
    const before = new Set(current.beats.map(b => b.id));
    const p = await workspace.dispatch({ type: 'createBeat', sceneId: scene.id, document: emptyDocument, text: '' });
    const id = p.scenes.find(s => s.id === scene.id)!.beats.find(b => !before.has(b.id))!.id;
    if (afterId) { const ids = p.scenes.find(s => s.id === scene.id)!.beats.map(b => b.id).filter(b => b !== id); ids.splice(ids.indexOf(afterId) + 1, 0, id); await workspace.dispatch({ type: 'reorderBeats', sceneId: scene.id, ids }); }
    setSelectedBeatId(id); focusBeat(id);
  }
  function insertCharacter(character: Character) {
    const editor = editorRef.current;
    if (!editor || editor.isDestroyed) { notify('Select a beat, then choose a character to insert a reference at the caret.'); return; }
    editor.chain().focus().insertContent([{ type: 'characterReference', attrs: { characterId: character.id, label: character.name, emotion: '', delivery: '' } }, { type: 'text', text: ' ' }]).run();
    notify(`${character.name} inserted into this beat. Select the reference to add local direction.`);
  }
  const localCharacter = project.characters.find(c => c.id === reference?.characterId);
  const contextPreview = useMemo(() => buildSceneGenerationContext(project, scene.id), [project, scene.id]);
  const generationState = useSyncExternalStore(
    listener => generation.subscribe(sessionId, scene.id, listener),
    () => generation.getState(sessionId, scene.id),
    () => generation.getState(sessionId, scene.id),
  );
  const currentFingerprint = useMemo(() => generationInputFingerprint(contextPreview, defaultGuidance), [contextPreview, defaultGuidance]);
  useEffect(() => { void generation.load(sessionId, scene.id).catch(error => generation.failBeforeStart(sessionId, scene.id, error)); }, [generation, scene.id, sessionId]);
  const hasSavedBeats = scene.beats.some(beat => beat.text.trim().length > 0);
  const startGeneration = () => {
    if (!generationModel) return;
    void workspace.flush().then(() => {
      const state = workspace.getSnapshot();
      if (!state.ready || state.session?.sessionId !== sessionId) throw new Error('The selected project is switching. Try generating again after it opens.');
      return generation.start(sessionId, scene.id, generationModel, defaultGuidance);
    }).catch(error => generation.failBeforeStart(sessionId, scene.id, error));
  };
  const acceptDraft = (acknowledgeOutdated: boolean) => {
    const job = generationState.job;
    if (!job) return Promise.reject(new Error('The generated draft could not be found.'));
    return workspace.applyNativeMutation(sessionId, currentSession => generation.gateway.accept(
      sessionId, scene.id, job.id, currentSession.project.revision, job.model, job.connectionId, acknowledgeOutdated,
    )).then(() => { generation.markAccepted(sessionId, scene.id); notify('Scene draft accepted into Scene prose.'); });
  };
  const copyDraft = () => {
    if (!generationState.draftText) return;
    if (!navigator.clipboard?.writeText) { notify('Clipboard access is unavailable. Select the draft text to copy it.'); return; }
    run(() => navigator.clipboard.writeText(generationState.draftText).then(() => notify('Draft copied to the clipboard.')));
  };
  const discardDraft = () => {
    if (!generationState.job) return;
    run(() => generation.discard(sessionId, scene.id).then(() => notify('Generated draft discarded.')));
  };
  return <main id="main" className="scene-layout"><aside className="library"><h2>At your fingertips</h2><p className="muted">Click a character to insert it at the caret, or drag it into a beat.</p><h3>Characters</h3><div className="character-collection">{project.characters.filter(c => !c.archived).map(c => <button key={c.id} className="character-chip" draggable={!locked} title="Click to insert at the caret, or drag into a beat" onDragStart={event => { event.stopPropagation(); event.dataTransfer.setData(CHARACTER_REFERENCE_MIME, c.id); event.dataTransfer.effectAllowed = 'copy'; }} onClick={() => insertCharacter(c)}>{c.name}<Plus size={12}/></button>)}</div>{!project.characters.some(c => !c.archived) && <p className="muted">A beat can start with only your words.</p>}<button className="quiet library-manage" onClick={() => manageCharacters()}><Users size={14}/>Manage characters</button><div className="writing-note">A thought. A line of dialogue.<br/>An action that changes everything.<br/><span>There’s no required form.</span></div></aside>
    <section className="scene-writing" aria-label="Scene writing"><div className="scene-heading"><TitleField value={scene.title} label="Scene title" large onSave={title => edit({ type: 'updateScene', sceneId: scene.id, title })}/><div className="scene-heading-actions"><span className="muted">{scene.beats.length} beat{scene.beats.length === 1 ? '' : 's'}</span></div></div><details className="generation-preview"><summary>Preview scene context</summary><p className="muted">This is the selected scene’s summary, ordered beats, inline character directions, and only the profiles those references use.</p><pre>{contextPreview.readableContext}</pre></details><label className="tone-field">Scene tone<input placeholder="e.g. Quiet tension" value={scene.tone} maxLength={1000} onChange={e => edit({ type: 'updateScene', sceneId: scene.id, tone: e.target.value })}/></label><div className="summary-note"><label>Scene summary<textarea aria-label="Scene summary" value={scene.summary} placeholder="What changes in this scene? Keep the idea close while you write." rows={3} onChange={e => edit({ type: 'updateScene', sceneId: scene.id, summary: e.target.value })}/></label></div><div className="sequence-heading"><h2>The beats</h2><span className="muted">One moment, then the next.</span></div>
      {scene.beats.length ? <Timeline ids={scene.beats.map(b => b.id)} group={`Beats in ${scene.id}`} onReorder={ids => { edit({ type: 'reorderBeats', sceneId: scene.id, ids }); notify('Beat order updated.'); }}>{scene.beats.map((beat, index) => <TimelineItem key={beat.id} id={beat.id} index={index} count={scene.beats.length} group={`Beats in ${scene.id}`} label={`beat ${index + 1}`} disabled={locked} onMove={delta => { edit({ type: 'reorderBeats', sceneId: scene.id, ids: moved(scene.beats.map(b => b.id), beat.id, delta) }); notify(`Beat moved to position ${index + delta + 1}.`); }} actions={<><button disabled={locked} aria-label={`Duplicate beat ${index + 1}`} onClick={() => run(async () => { const before = new Set(scene.beats.map(b => b.id)); const p = await workspace.dispatch({ type: 'duplicateBeat', beatId: beat.id }); focusBeat(p.scenes.find(s => s.id === scene.id)!.beats.find(b => !before.has(b.id))?.id); })}><Copy size={13}/>Duplicate</button><button disabled={locked} className="danger" aria-label={`Delete beat ${index + 1}`} onClick={() => run(async () => { await workspace.dispatch({ type: 'deleteBeat', beatId: beat.id }); if (selectedBeatId === beat.id) { editorRef.current = null; setReference(null); } focusBeat(scene.beats[index + 1]?.id ?? scene.beats[index - 1]?.id); notify('Beat moved to Trash. Undo or Restore brings it back.'); })}><Trash2 size={13}/>Delete</button></>}><div className={selectedBeatId === beat.id ? 'beat-content selected' : 'beat-content'}><span className="beat-label">Beat {index + 1}</span><BeatEditor beat={beat} index={index} characters={project.characters} register={register} editable={workspace.getSnapshot().ready} onChange={(document, text) => edit({ type: 'updateBeat', beatId: beat.id, document, text })} onFocus={editor => { setSelectedBeatId(beat.id); selectEditor(editor); }} onSelection={selectEditor}/></div><div className="insert-row"><button className="quiet" disabled={locked} onClick={() => run(() => addBeat(beat.id))}><Plus size={12}/>Insert beat after</button></div></TimelineItem>)}</Timeline> : <div className="empty-beats"><p>Give this scene its first moment.</p><p className="muted">Write freely. Add character references only when they help.</p></div>}
      <button id="add-beat" className="primary add-beat" disabled={locked} onClick={() => run(() => addBeat())}><Plus size={16}/>Add beat</button>
      <GenerationPanel ready={generationReady} hasSavedBeats={hasSavedBeats} modelLabel={generationModelLabel} status={generationState.status} draftText={generationState.draftText} currentFingerprint={currentFingerprint} requestFingerprint={generationState.job?.inputFingerprint} currentProse={scene.prose} requestBaseProse={generationState.job?.requestSnapshot.baseProse} errorMessage={generationState.errorMessage} reason={!generation.gateway.desktop ? 'Scene generation is available in the desktop app.' : undefined} onGenerate={startGeneration} onStop={() => run(() => generation.stop(sessionId, scene.id))} onAccept={acknowledgeOutdated => run(() => acceptDraft(acknowledgeOutdated))} onCopy={copyDraft} onDiscard={discardDraft} onRetry={startGeneration} onOpenSettings={openSettings}/><SceneProseEditor value={scene.prose} disabled={locked} onChange={prose => edit({ type: 'updateScene', sceneId: scene.id, prose })}/>
    </section><aside className="inspector"><h2>Direction, gently</h2>{reference ? <section><span className="scope-label">This character reference only</span><h3>{localCharacter?.name ?? reference.label}</h3>{(['emotion', 'delivery'] as const).map(field => <label key={field} className={`${field}-field`}>{field === 'emotion' ? 'Emotion' : 'Delivery'}<input value={reference[field] ?? ''} placeholder={field === 'emotion' ? 'e.g. Relieved' : 'e.g. Under her breath'} onChange={e => { if (editorRef.current) updateCharacterReference(editorRef.current, { [field]: e.target.value }); setReference({ ...reference, [field]: e.target.value }); }}/></label>)}<p className="muted">These directions affect this occurrence only. The reusable profile stays the same.</p><button className="quiet danger" onClick={() => { editorRef.current?.chain().focus().deleteSelection().run(); setReference(null); }}>Remove this reference</button><button className="quiet" onClick={() => manageCharacters(reference.characterId)}>Edit reusable profile</button></section> : <p className="muted">Select a character reference in a beat to add its local emotion and delivery.</p>}<details><summary>Optional narration</summary><p className="muted">Guidance for this scene. No setting is needed to write.</p>{(['pointOfView', 'tense', 'instructions'] as const).map(field => <label key={field}>{field === 'pointOfView' ? 'Point of view' : field === 'tense' ? 'Tense' : 'Instructions'}<textarea rows={field === 'instructions' ? 3 : 1} value={scene.narration[field]} onChange={e => edit({ type: 'updateScene', sceneId: scene.id, narration: { ...scene.narration, [field]: e.target.value } })}/></label>)}</details></aside>
  </main>;
}
