import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { ArrowLeft, BookOpen, Check, ChevronRight, Feather, FolderOpen, Leaf, Plus, Redo2, Settings as SettingsIcon, Trash2, Undo2, Users, X } from 'lucide-react';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { desktopGateway } from './services/project';
import type { ProjectGateway, ProjectSession } from './services/project';
import { Workspace } from './services/workspace';
import { TitleField } from './components/Fields';
import ProjectPanel from './components/ProjectPanel';
import type { Panel } from './components/ProjectPanel';
import StoryView from './components/StoryView';
import SceneView from './components/SceneView';
import SettingsView from './components/SettingsView';
import type { ChatGPTSettingsState, ThemePreference } from './components/SettingsView';
import { desktopChatGPTGateway } from './services/chatgpt';
import type { ChatGPTGateway, NativeChatGPTState } from './services/chatgpt';
import { desktopGenerationGateway } from './services/generation';
import type { GenerationGateway } from './services/generation';
import { GenerationSession } from './services/generation-session';
import './styles.css';

interface Props { gateway?: ProjectGateway; initialSession?: ProjectSession; chatGPTService?: ChatGPTGateway; generationService?: GenerationGateway }
const PLATINUM_DEFAULT_VERSION = 'platinum-light-v3';

function toSettingsStatus(state: NativeChatGPTState): ChatGPTSettingsState['status'] {
  if (state.status === 'disconnected') return 'not-configured';
  if (state.status === 'connected') return state.ready ? 'ready' : 'connected';
  if (state.status === 'needs_reconnect') return 'reconnect-required';
  if (state.status === 'needs_plan_permission') return 'needs-plan-permission';
  // Native `unavailable` includes transient refresh/model/network failures.
  // Keep the Settings retry action available instead of treating it as a build
  // that cannot support sign-in.
  return 'error';
}

export default function App({ gateway = desktopGateway, initialSession, chatGPTService, generationService }: Props) {
  const [chatGPTGateway] = useState(() => chatGPTService ?? desktopChatGPTGateway);
  const [generationSession] = useState(() => new GenerationSession(generationService ?? desktopGenerationGateway));
  const [workspace] = useState(() => { const w = new Workspace(gateway); if (initialSession) w.attach(initialSession); return w; });
  const { session, project, pending, error, ready, conflict } = useSyncExternalStore(workspace.subscribe, workspace.getSnapshot);
  const [sceneId, setSceneId] = useState<string | null>(null);
  const [lastSceneId, setLastSceneId] = useState<string | null>(null);
  const [panel, setPanel] = useState<Panel>(null);
  const [appearance, setAppearance] = useState<ThemePreference>(() => {
    try {
      // Make Platinum the one-time default for existing installs too. Bump the
      // marker so installs that saw the earlier default also switch to light.
      // Explicit choices made after this migration continue to stick.
      if (localStorage.getItem('shorthand.appearance-default') !== PLATINUM_DEFAULT_VERSION) {
        localStorage.setItem('shorthand.appearance', 'light');
        localStorage.setItem('shorthand.appearance-default', PLATINUM_DEFAULT_VERSION);
        return 'light';
      }
      const saved = localStorage.getItem('shorthand.appearance');
      return saved === 'light' || saved === 'dark' || saved === 'system' ? saved : 'light';
    } catch { return 'light'; }
  });
  const [calm, setCalmState] = useState(() => {
    try { return localStorage.getItem('shorthand.calm') === 'true'; } catch { return false; }
  });
  const setCalm = (value: boolean) => {
    setCalmState(value);
    try { localStorage.setItem('shorthand.calm', String(value)); } catch { /* The session preference still applies. */ }
  };
  const [settingsOpen, setSettingsOpen] = useState(false);
  const settingsScroll = useRef(0);
  const settingsButton = useRef<HTMLButtonElement>(null);
  const [nativeChatGPTState, setNativeChatGPTState] = useState<NativeChatGPTState | null>(null);
  const [chatGPTError, setChatGPTError] = useState('');
  const [defaultGuidance, setDefaultGuidance] = useState(() => {
    try { return localStorage.getItem('shorthand.chatgpt-guidance') ?? ''; } catch { return ''; }
  });
  const chatGPT: ChatGPTSettingsState = nativeChatGPTState ? {
    status: toSettingsStatus(nativeChatGPTState),
    accountLabel: nativeChatGPTState.account ?? undefined,
    models: nativeChatGPTState.models.map(model => ({ id: model.slug, name: model.displayName })),
    selectedModel: nativeChatGPTState.selectedModel ?? undefined,
    defaultGuidance,
    message: chatGPTError || nativeChatGPTState.reason || (nativeChatGPTState.remoteRevocationConfirmed === false ? 'Disconnected locally, but ChatGPT did not confirm remote token revocation.' : undefined),
    firstUsePending: nativeChatGPTState.firstUsePending,
  } : {
    status: chatGPTGateway.desktop ? (chatGPTError ? 'error' : 'checking') : 'not-configured',
    models: [],
    defaultGuidance,
    message: chatGPTError || undefined,
  };
  const [notice, setNotice] = useState('');
  const [newTitle, setNewTitle] = useState('');
  const [characterId, setCharacterId] = useState<string | null>(null);
  const [reviewRecovery, setReviewRecovery] = useState(false);
  const storyScroll = useRef(0);
  const scene = project?.scenes.find(s => s.id === sceneId);
  const chapter = project?.chapters.find(c => c.id === scene?.chapterId);
  const locked = pending > 0 || !!error || !ready;
  const run = (action: () => Promise<unknown>) => { void action().catch(e => setNotice(e instanceof Error ? e.message : String(e))); };
  const runChatGPT = (action: () => Promise<NativeChatGPTState>) => {
    setChatGPTError('');
    void action().then(setNativeChatGPTState).catch(async e => {
      const message = e instanceof Error ? e.message : String(e);
      setChatGPTError(message);
      setNativeChatGPTState(previous => previous ? { ...previous, ready: false } : previous);
      try { setNativeChatGPTState(await chatGPTGateway.connectionState()); } catch { /* Keep the safe, not-ready state. */ }
    });
  };
  const backToStory = () => { setSceneId(null); requestAnimationFrame(() => window.scrollTo(0, storyScroll.current)); };
  const openScene = (id: string) => { if (!scene) storyScroll.current = window.scrollY; setSceneId(id); setLastSceneId(id); window.scrollTo(0, 0); };
  const openSettings = () => {
    settingsScroll.current = window.scrollY;
    setSettingsOpen(true);
    requestAnimationFrame(() => window.scrollTo(0, 0));
  };
  const closeSettings = () => {
    setSettingsOpen(false);
    requestAnimationFrame(() => {
      window.scrollTo(0, settingsScroll.current);
      settingsButton.current?.focus({ preventScroll: true });
    });
  };
  const changeAppearance = (value: ThemePreference) => {
    setAppearance(value);
    try { localStorage.setItem('shorthand.appearance', value); } catch { /* The session preference still applies. */ }
  };
  useEffect(() => { if (sceneId && project && !project.scenes.some(s => s.id === sceneId)) backToStory(); }, [project, sceneId]);
  useEffect(() => {
    const beforeUnload = (event: BeforeUnloadEvent) => { const s = workspace.getSnapshot(); if (s.pending || s.error) event.preventDefault(); };
    window.addEventListener('beforeunload', beforeUnload);
    let disposed = false;
    let stop: (() => void) | undefined;
    if (gateway.desktop) void getCurrentWindow().onCloseRequested(event => {
      const s = workspace.getSnapshot();
      if (s.pending || s.error) { event.preventDefault(); setNotice('Your project is still saving. Resolve any save error before closing this window.'); }
    }).then(unlisten => { if (disposed) unlisten(); else stop = unlisten; }).catch(() => {});
    return () => { disposed = true; stop?.(); window.removeEventListener('beforeunload', beforeUnload); };
  }, [gateway.desktop, workspace]);
  useEffect(() => {
    if (!chatGPTGateway.desktop) return;
    let disposed = false;
    void chatGPTGateway.connectionState().then(state => { if (!disposed) setNativeChatGPTState(state); }).catch(e => {
      if (!disposed) setChatGPTError(e instanceof Error ? e.message : String(e));
    });
    return () => { disposed = true; };
  }, [chatGPTGateway]);
  useEffect(() => {
    const keys = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey) || event.key.toLowerCase() !== 'z') return;
      // Tiptap and native text fields keep their own text undo history.
      const target = event.target as HTMLElement;
      if (target.closest('[contenteditable="true"],input,textarea')) return;
      const s = workspace.getSnapshot();
      if (!s.project || s.pending || s.error) return;
      if (event.shiftKey ? !s.project.canRedo : !s.project.canUndo) return;
      event.preventDefault();
      void workspace.dispatch({ type: event.shiftKey ? 'redo' : 'undo' }).catch(() => {});
    };
    window.addEventListener('keydown', keys); return () => window.removeEventListener('keydown', keys);
  }, [workspace]);
  async function load(kind: 'create' | 'open') {
    const previous = workspace.getSnapshot().session?.sessionId;
    await workspace.load(kind, newTitle.trim() || 'Untitled story', async () => {
      if (previous && generationSession.hasActiveSession(previous)) {
        setNotice('Stopping the current scene draft before switching projects.');
        try { await generationSession.stopSession(previous); }
        catch (error) { setNotice(error instanceof Error ? error.message : String(error)); return false; }
        setNotice('Scene generation stopped.');
      }
      return true;
    });
    if (workspace.getSnapshot().session?.sessionId !== previous) { setSceneId(null); setPanel(null); setNotice(''); }
  }
  return <div className={`app ${calm ? 'calm' : ''}`} data-theme={appearance}>
    <header className="app-header"><a href="#main" className="skip-link">Skip to writing</a><div className="brand"><Feather size={21}/><span>Shorthand</span><span className="brand-divider"/><span className="brand-caption">a place for your story</span></div>
      {project && !settingsOpen && <nav className="zoom-switch" aria-label="Writing view"><button aria-pressed={!scene} onClick={backToStory}><BookOpen size={15}/>Story</button><button aria-pressed={!!scene} disabled={!project.scenes.length} onClick={() => { const id = lastSceneId && project.scenes.some(s => s.id === lastSceneId) ? lastSceneId : project.scenes[0]?.id; if (id) openScene(id); }}>Scene<ChevronRight size={14}/></button></nav>}
      <div className="header-actions">{!settingsOpen && <button aria-pressed={calm} className="quiet" onClick={() => setCalm(!calm)} title="Remove decorative angles"><Leaf size={15}/>Calm</button>}{project && !settingsOpen && <><button className="quiet" disabled={locked} onClick={() => run(() => load('create'))}><Plus size={15}/>New project</button><button className="quiet" aria-label="Open project" disabled={locked} onClick={() => run(() => load('open'))}><FolderOpen size={15}/>Open</button></>}<button ref={settingsButton} className="settings-nav" aria-pressed={settingsOpen} aria-label={settingsOpen ? 'Return to writing' : 'Open Settings'} onClick={() => settingsOpen ? closeSettings() : openSettings()}><SettingsIcon size={15}/>{settingsOpen ? 'Back to writing' : 'Settings'}</button></div>
    </header>
    <div className="app-workspace" hidden={settingsOpen}>
    {project && <div className="project-toolbar"><div className="project-identity"><TitleField value={project.title} label="Project title" disabled={!ready} onSave={title => { void workspace.dispatch({ type: 'renameProject', title }).catch(() => {}); }}/><span className="save-state" role="status">{error ? 'Save needs attention' : pending ? 'Saving…' : <><Check size={13}/>Saved locally</>}</span></div><div className="toolbar-actions"><button className="icon-button" aria-label="Undo project change" title="Undo project change (Ctrl/⌘ Z outside a text field)" disabled={locked || !project.canUndo} onClick={() => run(() => workspace.dispatch({ type: 'undo' }))}><Undo2 size={17}/></button><button className="icon-button" aria-label="Redo project change" title="Redo project change" disabled={locked || !project.canRedo} onClick={() => run(() => workspace.dispatch({ type: 'redo' }))}><Redo2 size={17}/></button><span className="separator"/><button aria-expanded={panel === 'characters'} onClick={() => setPanel(panel === 'characters' ? null : 'characters')}><Users size={15}/>Characters</button><button aria-expanded={panel === 'trash'} onClick={() => setPanel(panel === 'trash' ? null : 'trash')}><Trash2 size={15}/>Trash{project.trash.length > 0 && ` (${project.trash.length})`}</button><button aria-expanded={panel === 'interchange'} onClick={() => setPanel(panel === 'interchange' ? null : 'interchange')}>Markdown</button></div></div>}
    {error && <div className="error-banner" role="alert"><div><strong>{pending ? 'Your latest edits are waiting to save.' : 'The project could not be opened.'}</strong><p>{error}</p>{pending > 0 && <p>Edits stay in this window. Retry checks the current database revision before replaying anything.</p>}</div><button onClick={() => run(() => workspace.retry())}>Retry save</button></div>}
    {conflict && <section className="conflict-review"><button onClick={() => setReviewRecovery(!reviewRecovery)}>Review saved version and recovery copy</button>{reviewRecovery && <><p>The database is at revision {conflict.revision}. Your waiting version is shown below. Save or copy it before choosing the saved version; choosing it discards the waiting changes in this window.</p><div className="recovery-columns"><label>Waiting version — select all to copy<textarea readOnly rows={12} value={JSON.stringify(project, null, 2)} onFocus={e => e.target.select()}/></label><label>Saved database version<textarea readOnly rows={12} value={JSON.stringify(conflict, null, 2)} onFocus={e => e.target.select()}/></label></div><button onClick={() => { workspace.acceptSavedVersion(); setReviewRecovery(false); setNotice('Using the saved database version.'); }}>Use saved version and discard waiting changes</button></>}</section>}
    {notice && <div className="notice" role="status"><span>{notice}</span><button className="icon-button" aria-label="Dismiss message" onClick={() => setNotice('')}><X size={15}/></button></div>}
    {!project ? <main id="main" className="welcome"><div className="welcome-mark"><Feather size={38}/></div><h1>Every story starts<br/>with a little room.</h1><p>Arrange the shape of your story.<br/>Then step into a scene and write freely.</p><section className="start-project"><label>Story name<input value={newTitle} onChange={e => setNewTitle(e.target.value)} placeholder="Untitled story" maxLength={250}/></label><div className="button-row"><button className="primary" disabled={!gateway.desktop || !ready} onClick={() => run(() => load('create'))}><Plus size={17}/>New project</button><button disabled={!gateway.desktop || !ready} onClick={() => run(() => load('open'))}><FolderOpen size={17}/>Open project</button></div><small>{!ready ? 'Opening your project…' : gateway.desktop ? 'Choose where your local SQLite project lives. No account needed.' : 'Desktop app required. Open Shorthand Writer through Tauri to create or open a local project. This browser preview does not store manuscripts.'}</small></section></main> : <>
      <fieldset className="workspace-content" disabled={!ready}>
        <ProjectPanel panel={panel} project={project} workspace={workspace} locked={locked} characterId={characterId} selectCharacter={setCharacterId} onClose={() => setPanel(null)} notify={setNotice} run={run}/>
        {scene ? <><div className="breadcrumb"><button className="quiet" onClick={backToStory}><ArrowLeft size={15}/>Back to story</button><span>{chapter?.title}<ChevronRight size={13}/>{scene.title}</span></div><SceneView key={`${project.projectId}:${scene.id}`} project={project} scene={scene} workspace={workspace} sessionId={session!.sessionId} generation={generationSession} generationReady={generationSession.gateway.desktop && nativeChatGPTState?.ready === true && !!nativeChatGPTState.selectedModel && !locked} generationModel={nativeChatGPTState?.selectedModel ?? undefined} generationModelLabel={nativeChatGPTState?.models.find(model => model.slug === nativeChatGPTState.selectedModel)?.displayName} defaultGuidance={defaultGuidance} locked={locked} notify={setNotice} run={run} openSettings={openSettings} manageCharacters={id => { if (id) setCharacterId(id); setPanel('characters'); }}/></> : <StoryView project={project} workspace={workspace} locked={locked} openScene={openScene} notify={setNotice} run={run}/>}</fieldset>
    </>}
    </div>
    {settingsOpen && <SettingsView appearance={appearance} onAppearanceChange={changeAppearance} calm={calm} onCalmChange={setCalm} chatGPT={chatGPT}
      onConnect={chatGPTGateway.desktop ? () => runChatGPT(() => chatGPTGateway.connect()) : undefined}
      onReconnect={chatGPTGateway.desktop ? () => runChatGPT(() => chatGPTGateway.connect()) : undefined}
      onTestConnection={chatGPTGateway.desktop ? () => { if (nativeChatGPTState?.selectedModel) runChatGPT(() => chatGPTGateway.testConnection(nativeChatGPTState.selectedModel!)); } : undefined}
      onAcknowledgeUsage={chatGPTGateway.desktop ? () => runChatGPT(() => chatGPTGateway.acknowledgeUsage()) : undefined}
      onDisconnect={chatGPTGateway.desktop ? () => runChatGPT(() => chatGPTGateway.disconnect()) : undefined}
      onModelChange={chatGPTGateway.desktop ? model => runChatGPT(() => chatGPTGateway.setModel(model)) : undefined}
      onGuidanceChange={chatGPTGateway.desktop ? guidance => { setDefaultGuidance(guidance); try { localStorage.setItem('shorthand.chatgpt-guidance', guidance); } catch { /* Current session value still applies. */ } } : undefined}
      onBack={closeSettings}/>}
    <footer className="app-footer"><span>Shorthand Writer</span><span>{project ? `Local project · revision ${project.revision}` : 'Your words, on your computer.'}</span></footer>
  </div>;
}
