import { useCallback, useEffect, useId, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { Download, RefreshCw, X } from 'lucide-react';
import { compileManuscript } from '../services/compile';
import type { CompileOptions } from '../services/compile';
import { serializeManuscript } from '../services/compile-serializers';
import type { CompileExportGateway } from '../services/compile-export';
import type { ProjectSnapshot } from '../services/project';
import type { Workspace } from '../services/workspace';
import ManuscriptPreview from './ManuscriptPreview';
import './CompileDialog.css';

interface Props {
  sessionId: string;
  workspace: Workspace;
  options: CompileOptions;
  onOptionsChange: (options: CompileOptions) => void;
  exportGateway: CompileExportGateway;
  onClose: () => void;
  onRecover: () => void;
}

export default function CompileDialog({ sessionId, workspace, options, onOptionsChange, exportGateway, onClose, onRecover }: Props) {
  const id = useId();
  const dialog = useRef<HTMLDialogElement>(null);
  const mounted = useRef(false);
  const request = useRef(0);
  const snapshotRef = useRef<ProjectSnapshot | null>(null);
  const [snapshot, setSnapshot] = useState<ProjectSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const current = useSyncExternalStore(workspace.subscribe, workspace.getSnapshot);
  const manuscript = useMemo(() => snapshot ? compileManuscript(snapshot, options) : null, [snapshot, options]);
  const stale = !!snapshot && (current.project?.revision !== snapshot.revision || current.pending > 0);
  const busy = loading || exporting;
  const refresh = useCallback(async () => {
    const token = ++request.current;
    setLoading(true); setError(''); setSuccess('');
    try {
      await workspace.flush();
      const state = workspace.getSnapshot();
      if (state.session?.sessionId !== sessionId || !state.ready || !state.project) throw new Error('The project changed. Close compilation and open it again.');
      if (state.error || state.conflict) throw new Error(state.error || 'Resolve the project recovery before compiling.');
      if (!mounted.current || token !== request.current) return;
      const next = structuredClone(state.project);
      snapshotRef.current = next;
      setSnapshot(next);
    } catch (cause) {
      if (mounted.current && token === request.current) setError(cause instanceof Error ? cause.message : String(cause));
    } finally { if (mounted.current && token === request.current) setLoading(false); }
  }, [workspace, sessionId]);

  useEffect(() => {
    mounted.current = true;
    const element = dialog.current!;
    const previous = document.activeElement as HTMLElement | null;
    const overflow = document.body.style.overflow;
    const scroll = window.scrollY;
    document.body.style.overflow = 'hidden';
    if (element.showModal) element.showModal(); else element.setAttribute('open', '');
    void refresh();
    return () => {
      mounted.current = false; ++request.current; snapshotRef.current = null;
      element.close?.(); document.body.style.overflow = overflow;
      window.scrollTo(0, scroll);
      if (previous?.isConnected && !previous.closest('[hidden]')) previous.focus({ preventScroll: true });
    };
  }, [refresh]);

  function change(patch: Partial<CompileOptions>) {
    setSuccess(''); setError('');
    const next = { ...options, ...patch };
    if (patch.chapterId !== undefined) next.sceneId = snapshot?.chapters.find(chapter => chapter.id === patch.chapterId)?.sceneIds[0] ?? '';
    onOptionsChange(next);
  }

  async function exportManuscript() {
    if (!manuscript?.canExport || !snapshot || busy || stale || !current.ready || current.error || current.conflict || !exportGateway.desktop) return;
    const source = snapshot;
    setExporting(true); setError(''); setSuccess('');
    try {
      const contents = serializeManuscript(manuscript);
      const path = await exportGateway.choosePath(manuscript.title, options.format);
      if (!path || !mounted.current) return;
      const state = workspace.getSnapshot();
      if (state.session?.sessionId !== sessionId || !state.ready || snapshotRef.current !== source) throw new Error('The project changed while choosing a file. Open compilation again.');
      if (state.error || state.conflict) throw new Error('Resolve the project recovery before exporting.');
      if (state.pending || state.project?.revision !== source.revision) throw new Error('The manuscript changed while choosing a file. Refresh the preview before exporting.');
      await exportGateway.writeFile(path, contents);
      if (mounted.current) setSuccess(`Exported manuscript to ${path}`);
    } catch (cause) { if (mounted.current) setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { if (mounted.current) setExporting(false); }
  }

  const chapter = snapshot?.chapters.find(item => item.id === options.chapterId);
  const scenes = chapter?.sceneIds.flatMap(sceneId => snapshot?.scenes.find(scene => scene.id === sceneId) ?? []) ?? [];
  return <dialog ref={dialog} className="compile-dialog" aria-labelledby={`${id}-heading`} aria-describedby={`${id}-description`} onCancel={event => { event.preventDefault(); if (!exporting) onClose(); }}>
    <header className="compile-header"><div><h1 id={`${id}-heading`}>Compile Book</h1><p id={`${id}-description`}>Assemble written scene prose into a manuscript. No AI required.</p></div><button className="quiet icon-button" aria-label="Close compilation" disabled={exporting} onClick={onClose}><X size={20}/></button></header>
    {loading && <p className="compile-feedback" role="status">Preparing manuscript preview…</p>}
    {error && <div className="compile-feedback compile-error" role="alert"><p>{error}</p>{current.error ? <button onClick={onRecover}>Close and review project recovery</button> : <button disabled={busy} onClick={() => void refresh()}>Refresh preview</button>}</div>}
    {stale && <div className="compile-feedback compile-stale" role="status"><p>Your writing has changed since this preview. Refresh it before exporting.</p><button disabled={busy} onClick={() => void refresh()}><RefreshCw size={14}/>Refresh preview</button></div>}
    <div className="compile-body">
      <fieldset className="compile-config" disabled={busy || !snapshot} aria-label="Compilation options">
        <fieldset><legend>What to compile</legend>{(['story', 'chapter', 'scene'] as const).map((scope, index) => <label className="compile-choice" key={scope}><input type="radio" name={`${id}-scope`} value={scope} checked={options.scope === scope} onChange={() => change({ scope })}/>{['Entire story', 'One chapter', 'One scene'][index]}</label>)}
          {options.scope !== 'story' && <label htmlFor={`${id}-chapter`}>Chapter<select id={`${id}-chapter`} value={options.chapterId} onChange={event => change({ chapterId: event.target.value })}>{!chapter && <option value="">Choose a chapter</option>}{snapshot?.chapters.map(item => <option key={item.id} value={item.id}>{item.title}</option>)}</select></label>}
          {options.scope === 'scene' && <label htmlFor={`${id}-scene`}>Scene<select id={`${id}-scene`} value={options.sceneId} onChange={event => change({ sceneId: event.target.value })}>{!scenes.some(scene => scene.id === options.sceneId) && <option value="">Choose a scene</option>}{scenes.map(scene => <option key={scene.id} value={scene.id}>{scene.title}</option>)}</select></label>}
        </fieldset>
        <fieldset><legend>Output format</legend><label htmlFor={`${id}-format`}>File type<select id={`${id}-format`} value={options.format} onChange={event => change({ format: event.target.value as CompileOptions['format'] })}><option value="md">Markdown — editable text</option><option value="txt">Plain text</option><option value="html">HTML — readable document</option></select></label><p className="compile-note">The preview shows the manuscript content. Exported files use the selected format.</p></fieldset>
        <fieldset><legend>Manuscript formatting</legend><label className="compile-choice"><input type="checkbox" checked={options.titlePage} onChange={event => change({ titlePage: event.target.checked })}/>Include title page</label>
          {options.scope !== 'scene' && <><label className="compile-choice"><input type="checkbox" checked={options.contents} onChange={event => change({ contents: event.target.checked })}/>Include contents</label><label className="compile-choice"><input type="checkbox" checked={options.sceneTitles} onChange={event => change({ sceneTitles: event.target.checked })}/>Show scene titles</label></>}
          <label htmlFor={`${id}-separator`}>Scene separator<select id={`${id}-separator`} disabled={options.scope === 'scene'} value={options.separator} onChange={event => change({ separator: event.target.value as CompileOptions['separator'] })}><option value="ornament">* * * — scene break</option><option value="space">Extra paragraph space</option><option value="none">None</option></select></label>
        </fieldset>
        <fieldset><legend>Unfinished scenes</legend><label htmlFor={`${id}-empty`}>If a scene has no prose<select id={`${id}-empty`} value={options.empty} onChange={event => change({ empty: event.target.value as CompileOptions['empty'] })}><option value="skip">Skip it</option><option value="placeholder">Include a placeholder</option><option value="require">Require all scenes to have prose</option></select></label><p className="compile-note">Summaries, beats, library definitions and unaccepted drafts are never exported.</p></fieldset>
      </fieldset>
      <section className="compile-preview" aria-label="Manuscript preview" aria-busy={loading}><div className="compile-preview-heading"><strong>Manuscript preview</strong><span>{options.format.toUpperCase()} · Content preview</span></div>{manuscript && <ManuscriptPreview manuscript={manuscript}/>}</section>
    </div>
    <footer className="compile-footer"><div className="compile-summary" aria-live="polite">{manuscript && <><strong>{manuscript.stats.included} of {manuscript.stats.selected} scenes · {manuscript.stats.words.toLocaleString()} words</strong><span>{manuscript.error || (manuscript.stats.missing ? `${manuscript.stats.missing} unfinished ${manuscript.stats.missing === 1 ? 'scene' : 'scenes'} ${options.empty === 'skip' ? 'will be skipped.' : options.empty === 'placeholder' ? 'will have placeholders.' : 'must be completed.'}` : 'All selected scenes have prose.')}</span></>}{!exportGateway.desktop && <span>File export is available in the desktop app.</span>}{success && <span role="status">{success}</span>}</div><div className="compile-actions"><button disabled={exporting} onClick={onClose}>Close</button><button className="primary" disabled={busy || stale || !manuscript?.canExport || !current.ready || !!current.error || !!current.conflict || !exportGateway.desktop} onClick={() => void exportManuscript()}><Download size={16}/>{exporting ? 'Exporting…' : `Export ${options.format.toUpperCase()}`}</button></div></footer>
  </dialog>;
}
