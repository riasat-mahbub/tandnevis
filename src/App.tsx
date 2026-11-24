import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { ArrowLeft, BookOpen, Check, ChevronDown, Feather, FolderOpen, Plus, Redo2, Save, Settings as SettingsIcon, Trash2, Undo2, X } from 'lucide-react';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { desktopGateway } from './services/project';
import type { Character, ProjectGateway, ProjectSession, ProjectSnapshot } from './services/project';
import { Workspace } from './services/workspace';
import { TitleField } from './components/Fields';
import CharacterCreationWizard from './components/CharacterCreationWizard';
import {
  characterWizardCreateOperation,
  characterWizardHasPersonalEdits,
  characterWizardMissingDefaultGuidance,
  characterWizardReducer,
  createCharacterWizard,
} from './services/character-wizard';
import type { CharacterWizardAction, CharacterWizardOrigin, CharacterWizardState } from './services/character-wizard';
import LibraryView from './components/LibraryView';
import StoryLibraryDrawer from './components/StoryLibraryDrawer';
import type { LibraryKind } from './components/LibraryView';
import StoryView from './components/StoryView';
import ChapterView from './components/ChapterView';
import SceneView from './components/SceneView';
import SceneNavigation, { AdjacentScenes } from './components/SceneNavigation';
import SettingsView from './components/SettingsView';
import UnsavedDialog from './components/UnsavedDialog';
import type { ChatGPTSettingsState, ThemePreference } from './components/SettingsView';
import { desktopChatGPTGateway } from './services/chatgpt';
import type { ChatGPTGateway, NativeChatGPTState } from './services/chatgpt';
import { desktopGenerationGateway } from './services/generation';
import type { GenerationGateway } from './services/generation';
import { GenerationSession } from './services/generation-session';
import { desktopRuntimeGateway } from './services/runtime';
import type { ApplicationRuntimeInfo, RuntimeGateway } from './services/runtime';
import './styles.css';
import './workspace.css';

interface Props { gateway?: ProjectGateway; initialSession?: ProjectSession; chatGPTService?: ChatGPTGateway; generationService?: GenerationGateway; runtimeService?: RuntimeGateway }
type WritingDestination = 'story' | 'chapter' | 'scene';
type Destination = WritingDestination | LibraryKind | 'trash' | 'character-wizard';
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

interface CharacterCreateAttempt {
  sessionId: string;
  existingIds: Set<string>;
  operation: ReturnType<typeof characterWizardCreateOperation>;
}
interface CharacterRecoveryResolution {
  kind: 'active' | 'saved';
  project: ProjectSnapshot;
  characters: Character[];
}

function matchingCreatedCharacters(project: ProjectSnapshot, attempt: CharacterCreateAttempt): Character[] {
  const { operation, existingIds } = attempt;
  return project.characters.filter(character => !existingIds.has(character.id)
    && character.name === operation.name
    && character.background === (operation.background ?? '')
    && character.personality === (operation.personality ?? '')
    && character.voice === (operation.voice ?? '')
    && (character.icon ?? '') === (operation.icon ?? '')
    && character.defaultToneId === (operation.defaultToneId ?? '')
    && character.defaultEmotionId === (operation.defaultEmotionId ?? ''));
}

export default function App({ gateway = desktopGateway, initialSession, chatGPTService, generationService, runtimeService }: Props) {
  const [chatGPTGateway] = useState(() => chatGPTService ?? desktopChatGPTGateway);
  const [runtimeGateway] = useState(() => runtimeService ?? desktopRuntimeGateway);
  const [autosave, setAutosave] = useState(() => { try { return localStorage.getItem('shorthand.autosave') === 'true'; } catch { return false; } });
  const [workspace] = useState(() => { const w = new Workspace(gateway); w.setAutosave(autosave); if (initialSession) w.attach(initialSession); return w; });
  const [generationSession] = useState(() => new GenerationSession(generationService ?? desktopGenerationGateway, () => workspace.markDirty()));
  const { session, project, pending, dirty, saving, error, ready, conflict } = useSyncExternalStore(workspace.subscribe, workspace.getSnapshot);
  const [unsavedPrompt, setUnsavedPrompt] = useState(false);
  const [wizardBoundaryPrompt, setWizardBoundaryPrompt] = useState(false);
  const [promptBusy, setPromptBusy] = useState(false);
  const [promptError, setPromptError] = useState('');
  const leaveDecision = useRef<((proceed: boolean) => void) | null>(null);
  const wizardBoundaryDecision = useRef<((discard: boolean) => void) | null>(null);
  const [characterWizard, setCharacterWizard] = useState<CharacterWizardState | null>(null);
  const [characterRecoveryResolution, setCharacterRecoveryResolution] = useState<CharacterRecoveryResolution | null>(null);
  const characterWizardRef = useRef<CharacterWizardState | null>(null);
  const characterCreateInFlight = useRef(false);
  const characterCreateAttempt = useRef<CharacterCreateAttempt | null>(null);
  function replaceCharacterWizard(next: CharacterWizardState | null) {
    characterWizardRef.current = next;
    setCharacterWizard(next);
  }
  function dispatchCharacterWizard(action: CharacterWizardAction) {
    const current = characterWizardRef.current;
    if (!current) return current;
    const next = characterWizardReducer(current, action);
    if (next !== current) replaceCharacterWizard(next);
    return next;
  }
  async function confirmLeaving() {
    if (!workspace.getSnapshot().error && !await workspace.hasUnsavedChanges()) return true;
    setPromptError(''); setUnsavedPrompt(true);
    return new Promise<boolean>(resolve => { leaveDecision.current = resolve; });
  }
  function finishLeaving(proceed: boolean) { leaveDecision.current?.(proceed); leaveDecision.current = null; setUnsavedPrompt(false); }
  async function confirmWizardDiscard() {
    const current = characterWizardRef.current;
    if (!current || !characterWizardHasPersonalEdits(current)) return true;
    setWizardBoundaryPrompt(true);
    return new Promise<boolean>(resolve => { wizardBoundaryDecision.current = resolve; });
  }
  function finishWizardDiscard(discard: boolean) {
    wizardBoundaryDecision.current?.(discard);
    wizardBoundaryDecision.current = null;
    setWizardBoundaryPrompt(false);
  }
  async function saveBeforeLeaving() {
    setPromptBusy(true); setPromptError('');
    try { if (workspace.getSnapshot().error) await workspace.retry(); await workspace.save(); finishLeaving(true); }
    catch (error) { setPromptError(error instanceof Error ? error.message : String(error)); }
    finally { setPromptBusy(false); }
  }
  function changeAutosave(value: boolean) { setAutosave(value); workspace.setAutosave(value); try { localStorage.setItem('shorthand.autosave', String(value)); } catch { /* Session choice remains active. */ } }
  const [sceneId, setSceneId] = useState<string | null>(null);
  const [lastSceneId, setLastSceneId] = useState<string | null>(null);
  const [sceneVisits, setSceneVisits] = useState<{ sessionId: string; ids: string[] }>({ sessionId: '', ids: [] });
  const [chapterId, setChapterId] = useState<string | null>(null);
  const [chapterVisits, setChapterVisits] = useState<{ sessionId: string; ids: string[] }>({ sessionId: '', ids: [] });
  const [libraryCreationOrigin, setLibraryCreationOrigin] = useState<{ kind: LibraryKind; sceneId: string } | null>(null);
  const [destination, setDestination] = useState<Destination>('story');
  const destinationRef = useRef<Destination>('story');
  const [librarySelection, setLibrarySelection] = useState<Record<LibraryKind, string | null>>({ characters: null, tones: null, emotions: null });
  const [characterProfileRequests, setCharacterProfileRequests] = useState(0);
  const [createRequests, setCreateRequests] = useState<Record<LibraryKind, number>>({ characters: 0, tones: 0, emotions: 0 });
  const destinationScroll = useRef<Record<string, number>>({});
  const previousDestination = useRef<Destination>('story');
  const projectMenu = useRef<HTMLDetailsElement>(null);
  const [libraryBrowserOpen, setLibraryBrowserOpen] = useState(false);
  const writingOrigin = useRef<{ destination: WritingDestination; chapterId: string | null; sceneId: string | null }>({ destination: 'story', chapterId: null, sceneId: null });
  const navigationFrame = useRef<number | null>(null);
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
  const [runtimeInfo, setRuntimeInfo] = useState<ApplicationRuntimeInfo | null>(null);
  const [runtimeError, setRuntimeError] = useState('');
  const [runtimeLoading, setRuntimeLoading] = useState(false);
  const [runtimeRetry, setRuntimeRetry] = useState(0);
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
  const [reviewRecovery, setReviewRecovery] = useState(false);
  const scene = project?.scenes.find(s => s.id === sceneId);
  const currentChapter = project?.chapters.find(chapter => chapter.id === chapterId);
  const locked = !!error || !ready;
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
  const positionKey = (route: Destination) => route === 'scene' ? `scene:${sceneId}` : route === 'chapter' ? `chapter:${chapterId}` : route;
  const rememberPosition = () => { destinationScroll.current[positionKey(destinationRef.current)] = window.scrollY; };
  const restorePosition = (key: string, focus?: { kind: 'chapter' | 'scene'; id: string }) => {
    if (navigationFrame.current !== null) cancelAnimationFrame(navigationFrame.current);
    navigationFrame.current = requestAnimationFrame(() => {
      window.scrollTo(0, destinationScroll.current[key] ?? 0);
      if (focus) Array.from(document.querySelectorAll<HTMLButtonElement>(focus.kind === 'chapter' ? '.chapter-open' : '.scene-open[data-scene-id]')).find(element => element.dataset[focus.kind === 'chapter' ? 'chapterId' : 'sceneId'] === focus.id && !element.closest('[hidden]'))?.focus({ preventScroll: true });
    });
  };
  useEffect(() => () => { if (navigationFrame.current !== null) cancelAnimationFrame(navigationFrame.current); }, []);
  const navigate = (next: Destination) => {
    rememberPosition();
    if (['characters', 'emotions', 'tones'].includes(next) && ['story', 'chapter', 'scene'].includes(destinationRef.current)) writingOrigin.current = { destination: destinationRef.current as WritingDestination, chapterId, sceneId };
    setLibraryBrowserOpen(false);
    setSettingsOpen(false); destinationRef.current = next; setDestination(next);
    if (libraryCreationOrigin && next !== libraryCreationOrigin.kind) setLibraryCreationOrigin(null);
    restorePosition(positionKey(next));
  };
  const backToStory = () => { navigate('story'); restorePosition('story', chapterId ? { kind: 'chapter', id: chapterId } : undefined); };
  const visitChapter = (id: string) => setChapterVisits(previous => ({ sessionId: session!.sessionId, ids: previous.sessionId === session!.sessionId ? [...new Set([...previous.ids, id])] : [id] }));
  const openChapter = (id: string) => {
    setLibraryBrowserOpen(false);
    rememberPosition();
    const returningScene = destinationRef.current === 'scene' ? sceneId : null;
    setChapterId(id); visitChapter(id);
    setSettingsOpen(false); destinationRef.current = 'chapter'; setDestination('chapter');
    restorePosition(`chapter:${id}`, returningScene ? { kind: 'scene', id: returningScene } : undefined);
  };
  const openScene = (id: string) => {
    setLibraryBrowserOpen(false);
    rememberPosition();
    const parent = workspace.getSnapshot().project?.scenes.find(item => item.id === id)?.chapterId;
    if (parent) { setChapterId(parent); visitChapter(parent); }
    setSceneId(id); setLastSceneId(id); destinationRef.current = 'scene'; setDestination('scene'); setSettingsOpen(false);
    setLibraryCreationOrigin(null);
    setSceneVisits(previous => ({ sessionId: session!.sessionId, ids: previous.sessionId === session!.sessionId ? [...new Set([...previous.ids, id])] : [id] }));
    restorePosition(`scene:${id}`);
  };
  const returnToWriting = () => {
    const origin = writingOrigin.current;
    if (origin.destination === 'scene' && project?.scenes.some(item => item.id === origin.sceneId)) openScene(origin.sceneId!);
    else if (origin.destination !== 'story' && project?.chapters.some(item => item.id === origin.chapterId)) openChapter(origin.chapterId!);
    else backToStory();
  };
  function startCharacterWizard(origin: CharacterWizardOrigin) {
    const activeSession = workspace.getSnapshot().session;
    if (!activeSession) return;
    const existing = characterWizardRef.current;
    if (existing?.projectSessionId === activeSession.sessionId && existing.cancel.status !== 'discarded' && existing.submission.status !== 'succeeded') {
      navigate('character-wizard');
      return;
    }
    const next = createCharacterWizard({ projectSessionId: activeSession.sessionId, origin });
    characterCreateAttempt.current = null;
    characterCreateInFlight.current = false;
    setCharacterRecoveryResolution(null);
    replaceCharacterWizard(next);
    navigate('character-wizard');
  }
  function resumeCharacterWizard() {
    const existing = characterWizardRef.current;
    if (existing?.projectSessionId === workspace.getSnapshot().session?.sessionId) navigate('character-wizard');
  }
  function returnToWizardOrigin(origin: CharacterWizardOrigin, projectSnapshot = workspace.getSnapshot().project) {
    if (origin.kind === 'scene' && projectSnapshot?.scenes.some(item => item.id === origin.sceneId)) {
      setSceneId(origin.sceneId);
      setLastSceneId(origin.sceneId);
      navigate('scene');
    } else navigate(origin.kind === 'scene' ? 'story' : 'characters');
  }
  function cancelCharacterWizard() {
    const current = characterWizardRef.current;
    if (!current || characterCreateInFlight.current) return;
    const origin = current.origin;
    if (current.cancel.status !== 'discarded' && characterWizardHasPersonalEdits(current)) return;
    characterCreateAttempt.current = null;
    setCharacterRecoveryResolution(null);
    replaceCharacterWizard(null);
    returnToWizardOrigin(origin);
  }
  function finishCharacterCreation(character: Character, attempt: CharacterCreateAttempt, projectSnapshot: ProjectSnapshot) {
    if (characterCreateAttempt.current?.sessionId !== attempt.sessionId) return;
    const current = characterWizardRef.current;
    const origin = current?.projectSessionId === attempt.sessionId ? current.origin : { kind: 'library' as const };
    if (current?.projectSessionId === attempt.sessionId) dispatchCharacterWizard({ type: 'SUBMISSION_SUCCEEDED', characterId: character.id });
    characterCreateAttempt.current = null;
    characterCreateInFlight.current = false;
    setCharacterRecoveryResolution(null);
    if (origin.kind === 'library') {
      setLibrarySelection(selection => ({ ...selection, characters: character.id }));
      setCharacterProfileRequests(request => request + 1);
    }
    const shouldReturn = destinationRef.current === 'character-wizard'
      && current?.projectSessionId === attempt.sessionId;
    if (shouldReturn) {
      replaceCharacterWizard(null);
      returnToWizardOrigin(origin, projectSnapshot);
    } else if (current?.projectSessionId === attempt.sessionId) replaceCharacterWizard(null);
    setNotice(`${character.name} created. Save the project to keep it.`);
  }
  async function recoverCharacterCreation() {
    const attempt = characterCreateAttempt.current;
    const current = characterWizardRef.current;
    if (!attempt || !current || current.projectSessionId !== attempt.sessionId || characterCreateInFlight.current) return;
    characterCreateInFlight.current = true;
    dispatchCharacterWizard({ type: 'RECOVERY_STARTED' });
    try {
      await workspace.retry();
      const snapshot = workspace.getSnapshot();
      if (snapshot.session?.sessionId !== attempt.sessionId) return;
      const matches = snapshot.project ? matchingCreatedCharacters(snapshot.project, attempt) : [];
      if (matches.length === 1) {
        finishCharacterCreation(matches[0], attempt, snapshot.project!);
      } else if (matches.length > 1) {
        setCharacterRecoveryResolution({ kind: 'active', project: snapshot.project!, characters: matches });
        dispatchCharacterWizard({ type: 'SUBMISSION_CONFLICT', error: 'More than one new character matches this creation. No retry was sent; inspect the project before resolving it.' });
      } else if (snapshot.conflict) {
        const savedMatches = matchingCreatedCharacters(snapshot.conflict, attempt);
        if (savedMatches.length > 1) setCharacterRecoveryResolution({ kind: 'saved', project: snapshot.conflict, characters: savedMatches });
        dispatchCharacterWizard({ type: 'SUBMISSION_CONFLICT', error: savedMatches.length > 1
          ? 'Several saved characters match this creation. Review the saved project before resolving it.'
          : savedMatches.length === 1
            ? 'A matching character may already be in the saved project. Use the saved version to resolve it without creating another.'
            : snapshot.error ?? 'Review the saved project before choosing how to recover this creation.' });
      } else if (snapshot.error) {
        dispatchCharacterWizard({ type: 'SUBMISSION_FAILED', error: snapshot.error });
      } else if (snapshot.pending === 0) {
        characterCreateAttempt.current = null;
        dispatchCharacterWizard({ type: 'SUBMISSION_RESET_AFTER_RECOVERY' });
        setNotice('The saved project does not contain this character. Your draft is ready to create again.');
      } else dispatchCharacterWizard({ type: 'SUBMISSION_FAILED', error: 'The project still has a waiting creation. Retry recovery before creating again.' });
    } catch (error) {
      dispatchCharacterWizard({ type: 'SUBMISSION_FAILED', error: error instanceof Error ? error.message : String(error) });
    } finally { characterCreateInFlight.current = false; }
  }
  function requestCharacterCreation(requestState: CharacterWizardState) {
    const current = characterWizardRef.current;
    if (!current || current.projectSessionId !== requestState.projectSessionId || characterCreateInFlight.current) return;
    if (current.submission.status === 'failed' || current.submission.status === 'conflict') {
      void recoverCharacterCreation();
      return;
    }
    if (current.submission.status !== 'idle' || current.step !== 'review') return;
    const workspaceState = workspace.getSnapshot();
    if (!workspaceState.session || workspaceState.session.sessionId !== current.projectSessionId || !workspaceState.project) return;
    if (!workspaceState.ready || workspaceState.pending > 0 || workspaceState.saving || workspaceState.error || workspaceState.conflict) {
      setNotice('Wait for the current project changes to finish before creating this character.');
      return;
    }
    const missingGuidance = characterWizardMissingDefaultGuidance(current, workspaceState.project);
    if (missingGuidance.length) {
      setNotice('A selected default guidance preset is no longer in this project. Choose None or a current preset before creating this character.');
      return;
    }
    let operation: ReturnType<typeof characterWizardCreateOperation>;
    try { operation = characterWizardCreateOperation(current); }
    catch (error) { setNotice(error instanceof Error ? error.message : String(error)); return; }

    const attempt: CharacterCreateAttempt = {
      sessionId: current.projectSessionId,
      existingIds: new Set(workspaceState.project.characters.map(character => character.id)),
      operation,
    };
    characterCreateAttempt.current = attempt;
    characterCreateInFlight.current = true;
    dispatchCharacterWizard({ type: 'SUBMISSION_STARTED' });
    void workspace.dispatch(operation).then(snapshot => {
      const matches = matchingCreatedCharacters(snapshot, attempt);
      if (matches.length === 1) finishCharacterCreation(matches[0], attempt, snapshot);
      else if (matches.length > 1) {
        setCharacterRecoveryResolution({ kind: 'active', project: snapshot, characters: matches });
        dispatchCharacterWizard({ type: 'SUBMISSION_CONFLICT', error: 'More than one new character matches the returned project. No retry was sent; inspect the project before resolving it.' });
      }
      else dispatchCharacterWizard({ type: 'SUBMISSION_CONFLICT', error: 'Creation was acknowledged without a matching character in the returned project. Check recovery before retrying.' });
    }).catch(error => {
      const currentWorkspace = workspace.getSnapshot();
      const message = error instanceof Error ? error.message : String(error);
      if (currentWorkspace.conflict) dispatchCharacterWizard({ type: 'SUBMISSION_CONFLICT', error: currentWorkspace.error ?? message });
      else dispatchCharacterWizard({ type: 'SUBMISSION_FAILED', error: message });
    }).finally(() => { characterCreateInFlight.current = false; });
  }
  const openLibrary = (kind: LibraryKind, id?: string) => {
    if (kind === 'characters' && id === 'new') {
      const activeScene = destinationRef.current === 'scene' && sceneId ? project?.scenes.find(item => item.id === sceneId) : undefined;
      startCharacterWizard(activeScene ? { kind: 'scene', sceneId: activeScene.id, sceneTitle: activeScene.title } : { kind: 'library' });
      return;
    }
    setLibraryCreationOrigin(id === 'new' && destinationRef.current === 'scene' && sceneId ? { kind, sceneId } : null);
    if (id === 'new') setCreateRequests(requests => ({ ...requests, [kind]: requests[kind] + 1 }));
    else if (id) {
      setLibrarySelection(selection => ({ ...selection, [kind]: id }));
      if (kind === 'characters') setCharacterProfileRequests(request => request + 1);
    }
    navigate(kind);
  };
  const openUsage = (id: string, beatId?: string, occurrenceId?: string) => {
    openScene(id);
    if (beatId) requestAnimationFrame(() => window.dispatchEvent(new CustomEvent('shorthand:focus-beat', { detail: { beatId, occurrenceId } })));
  };
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
  useEffect(() => {
    if (sceneId && project && !project.scenes.some(item => item.id === sceneId)) {
      setLibraryBrowserOpen(false); setSceneId(null); setLastSceneId(null);
      if (destinationRef.current === 'scene') { if (currentChapter) openChapter(currentChapter.id); else backToStory(); }
    }
    if (chapterId && project && !project.chapters.some(item => item.id === chapterId)) {
      setChapterId(null);
      if (destinationRef.current === 'chapter' || destinationRef.current === 'scene') backToStory();
    }
  }, [project, sceneId, chapterId]);
  useEffect(() => {
    const current = characterWizardRef.current;
    if (!current || current.projectSessionId === session?.sessionId) return;
    characterCreateAttempt.current = null;
    characterCreateInFlight.current = false;
    setCharacterRecoveryResolution(null);
    replaceCharacterWizard(null);
    destinationRef.current = 'story'; setDestination('story');
    setLibraryBrowserOpen(false); setSceneId(null); setLastSceneId(null); setLibrarySelection({ characters: null, tones: null, emotions: null });
    setChapterId(null); setChapterVisits({ sessionId: '', ids: [] }); writingOrigin.current = { destination: 'story', chapterId: null, sceneId: null }; setLibraryCreationOrigin(null); setSceneVisits({ sessionId: '', ids: [] });
    setCharacterProfileRequests(0); destinationScroll.current = {};
  }, [session?.sessionId]);
  useEffect(() => {
    const beforeUnload = (event: BeforeUnloadEvent) => {
      const s = workspace.getSnapshot();
      const wizardDraft = characterWizardRef.current;
      if (s.pending || s.dirty || s.saving || s.error || !!wizardDraft && characterWizardHasPersonalEdits(wizardDraft)) {
        event.preventDefault(); event.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', beforeUnload);
    let disposed = false;
    let stop: (() => void) | undefined;
    let closing = false;
    if (gateway.desktop) void getCurrentWindow().onCloseRequested(async event => {
      event.preventDefault();
      if (closing) return;
      closing = true;
      try {
        const s = workspace.getSnapshot();
        if (!s.ready) { setNotice('Wait for the current project operation to finish, then close the app.'); return; }
        if (s.session && generationSession.hasActiveSession(s.session.sessionId)) await generationSession.stopSession(s.session.sessionId);
        if (await confirmLeaving() && await confirmWizardDiscard()) await getCurrentWindow().destroy();
      } catch (error) { setNotice(error instanceof Error ? error.message : String(error)); }
      finally { closing = false; }
    }).then(unlisten => { if (disposed) unlisten(); else stop = unlisten; }).catch(() => {});
    return () => { disposed = true; stop?.(); window.removeEventListener('beforeunload', beforeUnload); };
  }, [gateway.desktop, workspace, generationSession]);
  useEffect(() => {
    const saveKey = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey) || event.key.toLowerCase() !== 's') return;
      event.preventDefault();
      if (workspace.getSnapshot().session && workspace.getSnapshot().ready) void workspace.save().catch(() => {});
    };
    window.addEventListener('keydown', saveKey);
    return () => window.removeEventListener('keydown', saveKey);
  }, [workspace]);
  useEffect(() => {
    if (!chatGPTGateway.desktop) return;
    let disposed = false;
    void chatGPTGateway.connectionState().then(state => { if (!disposed) setNativeChatGPTState(state); }).catch(e => {
      if (!disposed) setChatGPTError(e instanceof Error ? e.message : String(e));
    });
    return () => { disposed = true; };
  }, [chatGPTGateway]);
  useEffect(() => {
    if (!settingsOpen || !runtimeGateway.desktop) return;
    let disposed = false;
    setRuntimeLoading(true);
    setRuntimeError('');
    void runtimeGateway.info().then(info => { if (!disposed) setRuntimeInfo(info); }).catch(error => {
      if (!disposed) setRuntimeError(error instanceof Error ? error.message : String(error));
    }).finally(() => { if (!disposed) setRuntimeLoading(false); });
    return () => { disposed = true; };
  }, [runtimeGateway, runtimeRetry, settingsOpen]);
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
      if (!await confirmLeaving()) return false;
      return confirmWizardDiscard();
    });
    if (workspace.getSnapshot().session?.sessionId !== previous) {
      characterCreateAttempt.current = null;
      characterCreateInFlight.current = false;
      setCharacterRecoveryResolution(null);
      replaceCharacterWizard(null);
      setLibraryBrowserOpen(false); setSceneId(null); setLastSceneId(null); setSceneVisits({ sessionId: '', ids: [] }); setChapterId(null); setChapterVisits({ sessionId: '', ids: [] }); writingOrigin.current = { destination: 'story', chapterId: null, sceneId: null }; setLibraryCreationOrigin(null); destinationRef.current = 'story'; setDestination('story'); setLibrarySelection({ characters: null, tones: null, emotions: null }); setCharacterProfileRequests(0); setCreateRequests({ characters: 0, tones: 0, emotions: 0 }); destinationScroll.current = {}; setNotice('');
    }
  }
  function retryWorkspace() {
    const current = characterWizardRef.current;
    if (characterCreateAttempt.current && current && (current.submission.status === 'creating' || current.submission.status === 'failed' || current.submission.status === 'conflict')) {
      if (current.submission.status === 'creating') characterCreateInFlight.current = false;
      void recoverCharacterCreation();
      return;
    }
    run(() => workspace.retry());
  }
  function acceptSavedVersion() {
    const current = workspace.getSnapshot();
    const attempt = characterCreateAttempt.current;
    const matches = attempt && current.conflict ? matchingCreatedCharacters(current.conflict, attempt) : [];
    const savedVersion = current.conflict;
    if (matches && matches.length > 1) {
      setReviewRecovery(true);
      setCharacterRecoveryResolution({ kind: 'saved', project: savedVersion!, characters: matches });
      setNotice('Several new characters match this draft. Review the saved version before resolving the conflict. No creation was repeated.');
      return;
    }
    workspace.acceptSavedVersion();
    setReviewRecovery(false);
    if (!attempt || !savedVersion || !characterWizardRef.current) {
      setNotice('Using the saved database version.');
      return;
    }
    if (matches?.length === 1) {
      finishCharacterCreation(matches[0], attempt, savedVersion);
      return;
    }
    characterCreateAttempt.current = null;
    characterCreateInFlight.current = false;
    setCharacterRecoveryResolution(null);
    dispatchCharacterWizard({ type: 'SUBMISSION_RESET_AFTER_RECOVERY' });
    setNotice('The saved version did not contain the new character. Your draft is ready to create again.');
  }
  function resolveCharacterRecoveryCandidate(characterId: string) {
    const resolution = characterRecoveryResolution;
    const attempt = characterCreateAttempt.current;
    const current = workspace.getSnapshot();
    if (!resolution || !attempt || current.session?.sessionId !== attempt.sessionId) return;
    const sourceProject = resolution.kind === 'saved' ? current.conflict : current.project;
    if (!sourceProject) return;
    const candidate = matchingCreatedCharacters(sourceProject, attempt).find(character => character.id === characterId);
    if (!candidate) {
      setCharacterRecoveryResolution(null);
      setNotice('That matching character is no longer available. Check the current project before retrying.');
      return;
    }
    if (resolution.kind === 'saved') {
      workspace.acceptSavedVersion();
      setReviewRecovery(false);
    }
    finishCharacterCreation(candidate, attempt, sourceProject);
  }
  function closeProjectMenu() { if (projectMenu.current) projectMenu.current.open = false; }
  async function interchange(mode: 'import' | 'export') {
    closeProjectMenu(); await workspace.flush();
    const path = await gateway.chooseMarkdown(mode);
    if (!path) return;
    if (mode === 'import') { await workspace.importMarkdownFile(path); setNotice('Markdown appended as chapters, scenes, and beats. Save the project to keep it; Undo reverses the import.'); }
    else { await gateway.exportMarkdownFile(workspace.getSnapshot().session!.sessionId, path); setNotice(`Story outline and beat text exported to ${path}`); }
  }
  const backAction = settingsOpen ? { label: 'Return to writing', run: closeSettings }
    : !project || destination === 'story' ? null
    : destination === 'chapter' ? { label: 'Back to story', run: backToStory }
    : destination === 'scene' ? { label: 'Back to chapter', run: () => scene && openChapter(scene.chapterId) }
    : destination === 'trash' ? { label: `Back to ${previousDestination.current}`, run: () => navigate(previousDestination.current) }
    : destination === 'character-wizard' ? { label: characterWizard?.origin.kind === 'scene' ? `Return to ${characterWizard.origin.sceneTitle ?? 'scene'}` : 'Return to Characters', run: () => characterWizard && returnToWizardOrigin(characterWizard.origin) }
    : { label: writingOrigin.current.destination === 'scene' && scene ? `Return to ${scene.title}` : writingOrigin.current.destination === 'chapter' && currentChapter ? `Return to ${currentChapter.title}` : 'Back to story', run: returnToWriting };
  const libraryDestination = destination === 'characters' || destination === 'emotions' || destination === 'tones';
  const libraryVisible = !!project && !settingsOpen && (libraryBrowserOpen || libraryDestination);
  const canvasDestination = libraryDestination ? writingOrigin.current.destination : destination;
  const closeLibrary = () => { setLibraryBrowserOpen(false); if (libraryDestination) returnToWriting(); };
  const libraryReturnLabel = writingOrigin.current.destination === 'scene' && scene ? `Return to ${scene.title}` : writingOrigin.current.destination === 'chapter' && currentChapter ? `Return to ${currentChapter.title}` : 'Back to story';
  return <div className={`app ${calm ? 'calm' : ''}`} data-theme={appearance}>
    <header className="app-header project-app-header" aria-hidden={libraryVisible || undefined}>
      <a href="#workspace-main" className="skip-link">Skip to workspace</a>
      <div className="project-header-identity">
        {backAction && <button className="project-back quiet icon-button" aria-label={backAction.label} title={backAction.label} onClick={backAction.run}><ArrowLeft size={18}/></button>}
        <span className="studio-brand"><Feather size={23} aria-hidden="true"/><span>Tandnevis</span></span>
        <details className="project-menu" ref={projectMenu} onKeyDown={event => { if (event.key === 'Escape') { closeProjectMenu(); projectMenu.current?.querySelector('summary')?.focus(); } }} onBlur={event => { if (event.relatedTarget && !event.currentTarget.contains(event.relatedTarget as Node)) closeProjectMenu(); }}>
          <summary aria-label="Project menu"><span>Project</span><ChevronDown size={13}/></summary>
          <div className="project-menu-items">
            <button disabled={!gateway.desktop || locked} onClick={() => { closeProjectMenu(); run(() => load('create')); }}><Plus size={15}/>New project...</button>
            <button aria-label="Open project" disabled={!gateway.desktop || locked} onClick={() => { closeProjectMenu(); run(() => load('open')); }}><FolderOpen size={15}/>Open project...</button>
            {project && <><hr/><button disabled={locked} onClick={() => run(() => interchange('import'))}>Import Markdown...</button><button disabled={locked} onClick={() => run(() => interchange('export'))}>Export outline as Markdown...</button><hr/><button onClick={() => { closeProjectMenu(); previousDestination.current = destination === 'trash' ? 'story' : destination; navigate('trash'); }}><Trash2 size={15}/>Trash{project.trash.length > 0 && ` (${project.trash.length})`}</button></>}
          </div>
        </details>
        {project && <TitleField value={project.title} label="Project title" disabled={!ready} onSave={title => { void workspace.dispatch({ type: 'renameProject', title }).catch(() => {}); }}/>}
      </div>
      <div className="project-header-actions">
        {project && <button className="story-library-trigger" aria-label="Library" aria-haspopup="dialog" aria-expanded={libraryVisible} onClick={() => {
          if (['story', 'chapter', 'scene'].includes(destinationRef.current)) writingOrigin.current = { destination: destinationRef.current as WritingDestination, chapterId, sceneId };
          setLibraryBrowserOpen(true);
        }}><BookOpen size={17}/><span>Story Library</span></button>}
        {project && <><div className="project-history"><button className="icon-button quiet" aria-label="Undo project change" title="Undo project change (Ctrl/Cmd Z outside a text field)" disabled={locked || pending > 0 || !project.canUndo} onClick={() => run(() => workspace.dispatch({ type: 'undo' }))}><Undo2 size={16}/></button><button className="icon-button quiet" aria-label="Redo project change" title="Redo project change" disabled={locked || pending > 0 || !project.canRedo} onClick={() => run(() => workspace.dispatch({ type: 'redo' }))}><Redo2 size={16}/></button></div><span className="save-state" role="status">{error ? 'Save needs attention' : saving ? 'Saving...' : dirty || pending ? 'Unsaved changes' : <><Check size={13}/>Saved locally</>}</span><button className={dirty || pending ? 'primary project-save' : 'project-save'} disabled={!ready || saving || !dirty && !pending} onClick={() => run(() => workspace.save())} title={dirty || pending ? 'Save all project changes (Ctrl/Cmd S)' : 'All project changes are saved'}><Save size={15}/>Save</button></>}
        <button ref={settingsButton} className="settings-nav quiet" aria-pressed={settingsOpen} aria-label="Open Settings" onClick={() => settingsOpen ? closeSettings() : openSettings()}><SettingsIcon size={16}/><span>Settings</span></button>
      </div>
    </header>
    <div className="app-workspace" hidden={settingsOpen} aria-hidden={libraryVisible || undefined} inert={libraryVisible}>
    {error && <div className="error-banner" role="alert"><div><strong>{pending ? 'Your latest edits are waiting to save.' : 'The project could not be opened.'}</strong><p>{error}</p>{pending > 0 && <p>Edits stay in this window. Retry checks the current database revision before replaying anything.</p>}</div><button onClick={retryWorkspace}>Retry save</button></div>}
    {characterRecoveryResolution && <section className="conflict-review character-recovery-resolution" aria-labelledby="character-recovery-heading"><h2 id="character-recovery-heading">Choose a matching character</h2><p>More than one new profile matches this creation. No second create was sent. Choose the profile to resolve this recovery.</p>{characterRecoveryResolution.kind === 'saved' && <p>Choosing a saved character adopts the saved project version and discards waiting changes in this window.</p>}<ul>{characterRecoveryResolution.characters.map((character, index) => <li key={character.id}><button onClick={() => resolveCharacterRecoveryCandidate(character.id)}>{characterRecoveryResolution.kind === 'saved' ? 'Use saved version and open' : 'Open'} {character.name} (match {index + 1})</button></li>)}</ul></section>}
    {conflict && <section className="conflict-review"><button onClick={() => setReviewRecovery(!reviewRecovery)}>Review saved version and recovery copy</button>{reviewRecovery && <><p>The database is at revision {conflict.revision}. Your waiting version is shown below. Save or copy it before choosing the saved version; choosing it discards the waiting changes in this window.</p><div className="recovery-columns"><label>Waiting version — select all to copy<textarea readOnly rows={12} value={JSON.stringify(project, null, 2)} onFocus={e => e.target.select()}/></label><label>Saved database version<textarea readOnly rows={12} value={JSON.stringify(conflict, null, 2)} onFocus={e => e.target.select()}/></label></div><button onClick={acceptSavedVersion}>Use saved version and discard waiting changes</button></>}</section>}
    {notice && <div className="notice" role="status"><span>{notice}</span><button className="icon-button" aria-label="Dismiss message" onClick={() => setNotice('')}><X size={15}/></button></div>}
    {!project ? <main id="main" className="welcome"><div className="welcome-mark"><Feather size={38}/></div><h1>Every story starts<br/>with a little room.</h1><p>Arrange the shape of your story.<br/>Then step into a scene and write freely.</p><section className="start-project"><label>Story name<input value={newTitle} onChange={e => setNewTitle(e.target.value)} placeholder="Untitled story" maxLength={250}/></label><div className="button-row"><button className="primary" disabled={!gateway.desktop || !ready} onClick={() => run(() => load('create'))}><Plus size={17}/>New project</button><button disabled={!gateway.desktop || !ready} onClick={() => run(() => load('open'))}><FolderOpen size={17}/>Open project</button></div><small>{!ready ? 'Opening your project…' : gateway.desktop ? 'Choose where your local SQLite project lives. No account needed.' : 'Desktop app required. Open Shorthand Writer through Tauri to create or open a local project. This browser preview does not store manuscripts.'}</small></section></main> : <>
      <fieldset id="workspace-main" className="workspace-content" disabled={!ready}>
        <div className="destination-view" hidden={canvasDestination !== 'story'}><StoryView key={session!.sessionId} project={project} workspace={workspace} locked={locked} openChapter={openChapter} notify={setNotice} run={run} lastChapterId={chapterId}/></div>
        {project.chapters.filter(item => item.id === chapterId || chapterVisits.sessionId === session!.sessionId && chapterVisits.ids.includes(item.id)).map(item => <div key={`${session!.sessionId}:chapter:${item.id}`} className="destination-view chapter-destination" hidden={canvasDestination !== 'chapter' || item.id !== chapterId}><ChapterView project={project} chapter={item} workspace={workspace} locked={locked} openScene={openScene} onStory={backToStory} lastSceneId={lastSceneId} notify={setNotice} run={run}/></div>)}
        {project.scenes.filter(item => item.id === sceneId || sceneVisits.sessionId === session!.sessionId && sceneVisits.ids.includes(item.id)).map(item => <div key={`${session!.sessionId}:${item.id}`} className="destination-view scene-destination" hidden={canvasDestination !== 'scene' || item.id !== sceneId}><SceneView project={project} scene={item} active={destination === 'scene' && item.id === sceneId && !settingsOpen} navigation={destination === 'scene' && item.id === sceneId ? <SceneNavigation project={project} scene={item} onStory={backToStory} onOpenChapter={openChapter} onOpenScene={openScene}/> : null} adjacentNavigation={<AdjacentScenes project={project} scene={item} onOpenScene={openScene}/>} workspace={workspace} sessionId={session!.sessionId} generation={generationSession} generationReady={generationSession.gateway.desktop && nativeChatGPTState?.ready === true && !!nativeChatGPTState.selectedModel && !locked} generationModel={nativeChatGPTState?.selectedModel ?? undefined} generationModelLabel={nativeChatGPTState?.models.find(model => model.slug === nativeChatGPTState.selectedModel)?.displayName} defaultGuidance={defaultGuidance} locked={locked} notify={setNotice} run={run} openSettings={openSettings} manageCharacters={id => openLibrary('characters', id)} manageLibrary={openLibrary}/></div>)}
        {characterWizard && <div className="destination-view character-wizard-destination" hidden={destination !== 'character-wizard'}><CharacterCreationWizard state={characterWizard} tones={project.tones} emotions={project.emotions} creationReady={ready && pending === 0 && !saving && !error && !conflict} dispatch={dispatchCharacterWizard} onCreate={requestCharacterCreation} onCancel={cancelCharacterWizard}/></div>}

        {destination === 'trash' && <main className="recovery-screen" aria-labelledby="trash-heading"><div className="recovery-heading"><div><h1 id="trash-heading">Trash</h1><p>Restore deleted writing and unused definitions to this project.</p></div></div>{project.trash.length ? <ul className="trash-list">{project.trash.map(item => <li key={item.id}><div><strong>{item.title || 'Untitled item'}</strong><small>{item.kind} - Deleted at revision {item.deletedAtRevision}</small></div><button disabled={locked} onClick={() => run(async () => { await workspace.dispatch({ type: 'restoreTrash', trashId: item.id }); setNotice(`${item.title || item.kind} restored. Save the project to keep this change.`); })}>Restore</button></li>)}</ul> : <div className="library-empty"><h2>Trash is empty</h2><p>Deleted scenes, beats, chapters, and unused definitions can be restored here.</p></div>}</main>}
      </fieldset>
    </>}
    </div>
    {project && <StoryLibraryDrawer open={libraryVisible} browsing={libraryBrowserOpen} project={project} locked={locked} returnLabel={libraryReturnLabel} onClose={closeLibrary} onBrowse={() => setLibraryBrowserOpen(true)} onOpen={openLibrary} feedback={<>{error && <div className="library-feedback" role="alert"><p>{error}</p><button onClick={retryWorkspace}>Retry save</button></div>}{notice && <div className="library-feedback" role="status"><p>{notice}</p><button className="quiet" aria-label="Dismiss message" onClick={() => setNotice('')}>Dismiss</button></div>}</>}>
        {(['characters', 'emotions', 'tones'] as const).map(kind => <div key={`${project.projectId}:${kind}`} className="destination-view" hidden={destination !== kind}><LibraryView kind={kind} project={project} workspace={workspace} locked={locked} selectedId={librarySelection[kind]} onSelect={id => setLibrarySelection(selection => ({ ...selection, [kind]: id }))} createRequest={createRequests[kind]} openSelectionRequest={kind === 'characters' ? characterProfileRequests : librarySelection[kind] ? 1 : 0} onCreateCharacter={() => startCharacterWizard({ kind: 'library' })} hasCharacterDraft={!!characterWizard && characterWizard.projectSessionId === session?.sessionId && characterWizard.submission.status !== 'succeeded'} onResumeCharacterDraft={resumeCharacterWizard} onCreated={libraryCreationOrigin?.kind === kind ? () => openScene(libraryCreationOrigin.sceneId) : undefined} onCancelCreate={libraryCreationOrigin?.kind === kind ? () => openScene(libraryCreationOrigin.sceneId) : undefined} onOpenUsage={openUsage} onOpenCharacter={id => openLibrary('characters', id)} notify={setNotice} run={run}/></div>)}
    </StoryLibraryDrawer>}
    {unsavedPrompt && <UnsavedDialog busy={promptBusy} error={promptError} onSave={() => { void saveBeforeLeaving(); }} onDiscard={() => finishLeaving(true)} onCancel={() => finishLeaving(false)}/>}
    {wizardBoundaryPrompt && <UnsavedDialog kind="character-draft" busy={false} error="" onSave={() => {}} onDiscard={() => finishWizardDiscard(true)} onCancel={() => finishWizardDiscard(false)}/>}
    {settingsOpen && <SettingsView autosave={autosave} onAutosaveChange={changeAutosave} appearance={appearance} onAppearanceChange={changeAppearance} calm={calm} onCalmChange={setCalm} chatGPT={chatGPT}
      runtimeInfo={runtimeInfo} runtimeError={runtimeError} runtimeLoading={runtimeLoading} desktopRuntime={runtimeGateway.desktop}
      onRetryRuntime={() => { setRuntimeInfo(null); setRuntimeError(''); setRuntimeRetry(value => value + 1); }}
      onConnect={chatGPTGateway.desktop ? () => runChatGPT(() => chatGPTGateway.connect()) : undefined}
      onReconnect={chatGPTGateway.desktop ? () => runChatGPT(() => chatGPTGateway.connect()) : undefined}
      onTestConnection={chatGPTGateway.desktop ? () => { if (nativeChatGPTState?.selectedModel) runChatGPT(() => chatGPTGateway.testConnection(nativeChatGPTState.selectedModel!)); } : undefined}
      onAcknowledgeUsage={chatGPTGateway.desktop ? () => runChatGPT(() => chatGPTGateway.acknowledgeUsage()) : undefined}
      onDisconnect={chatGPTGateway.desktop ? () => runChatGPT(() => chatGPTGateway.disconnect()) : undefined}
      onModelChange={chatGPTGateway.desktop ? model => runChatGPT(() => chatGPTGateway.setModel(model)) : undefined}
      onGuidanceChange={chatGPTGateway.desktop ? guidance => { setDefaultGuidance(guidance); try { localStorage.setItem('shorthand.chatgpt-guidance', guidance); } catch { /* Current session value still applies. */ } } : undefined}
      onBack={closeSettings}/>}
    <footer className="app-footer"><span>Tandnevis</span><span>{project ? `Local project · revision ${project.revision}` : 'Your words, on your computer.'}</span></footer>
  </div>;
}
