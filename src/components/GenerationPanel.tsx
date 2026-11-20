import { useState } from 'react';
import { AlertCircle, Check, Copy, LoaderCircle, Sparkles, Square, Trash2 } from 'lucide-react';
import './GenerationPanel.css';

export type GenerationStatus =
  | 'idle'
  | 'starting'
  | 'stopping'
  | 'streaming'
  | 'completed'
  | 'stopped'
  | 'failed'
  | 'interrupted'
  | 'accepted'
  | 'discarded';

export interface GenerationPanelProps {
  /** True only after the native ChatGPT connection and selected model were verified. */
  ready: boolean;
  hasSavedBeats: boolean;
  modelLabel?: string;
  status: GenerationStatus;
  draftText: string;
  currentFingerprint: string;
  requestFingerprint?: string;
  currentProse?: string;
  requestBaseProse?: string;
  reason?: string;
  errorMessage?: string;
  onGenerate: () => void;
  onStop: () => void;
  onAccept: (acknowledgeOutdated: boolean) => void;
  onCopy: () => void;
  onDiscard: () => void;
  /** Starts a new attempt; retrying never resumes/replays the failed remote request. */
  onRetry?: () => void;
  onOpenSettings: () => void;
}

const activeStatuses: GenerationStatus[] = ['starting', 'streaming', 'stopping'];
const reviewPair = (request?: string, current?: string, requestProse?: string, currentProse?: string) => JSON.stringify([request ?? '', current ?? '', requestProse, currentProse]);

export default function GenerationPanel({
  ready,
  hasSavedBeats,
  modelLabel,
  status,
  draftText,
  currentFingerprint,
  requestFingerprint,
  currentProse,
  requestBaseProse,
  reason,
  errorMessage,
  onGenerate,
  onStop,
  onAccept,
  onCopy,
  onDiscard,
  onRetry,
  onOpenSettings,
}: GenerationPanelProps) {
  const [reviewedPair, setReviewedPair] = useState('');
  const active = activeStatuses.includes(status);
  const directionsChanged = !!requestFingerprint && requestFingerprint !== currentFingerprint;
  const proseChanged = requestBaseProse !== undefined && currentProse !== undefined && requestBaseProse !== currentProse;
  const isOutdated = directionsChanged || proseChanged;
  const reviewKey = reviewPair(requestFingerprint, currentFingerprint, requestBaseProse, currentProse);
  const acknowledgedOutdated = !isOutdated || reviewedPair === reviewKey;
  const canStart = ready && hasSavedBeats && !active;
  const showDraft = ['starting', 'stopping', 'streaming', 'completed', 'stopped', 'failed', 'interrupted'].includes(status);
  const hasDraft = draftText.trim().length > 0;

  let disabledReason = reason;
  if (!ready) disabledReason ||= 'Connect and verify ChatGPT in Settings to generate this scene.';
  else if (!hasSavedBeats) disabledReason ||= 'Add a non-empty beat to describe this scene.';

  const statusLabel: Record<GenerationStatus, string> = {
    idle: 'Ready when you are',
    starting: 'Preparing scene request',
    stopping: 'Stopping scene generation',
    streaming: 'Writing this scene',
    completed: 'Draft ready',
    stopped: 'Generation stopped',
    failed: 'Generation failed',
    interrupted: 'Draft recovered after interruption',
    accepted: 'Draft accepted',
    discarded: 'Draft discarded',
  };

  return <section className="generation-panel" aria-labelledby="generation-heading">
    <div className="generation-panel-header">
      <div>
        <span className="generation-panel-eyebrow">One scene at a time</span>
        <h2 id="generation-heading">Scene draft</h2>
      </div>
      <span className={`generation-panel-state generation-state-${status}`} role="status">
        {active ? <LoaderCircle size={13} aria-hidden="true"/> : status === 'failed' ? <AlertCircle size={13} aria-hidden="true"/> : status === 'accepted' ? <Check size={13} aria-hidden="true"/> : <Sparkles size={13} aria-hidden="true"/>}
        {statusLabel[status]}
      </span>
    </div>

    {ready && <p className="generation-usage-note"><span>Using ChatGPT plan{modelLabel ? ` · ${modelLabel}` : ''}</span><a href="https://chatgpt.com/settings/usage" target="_blank" rel="noreferrer">Manage usage</a></p>}

    {status === 'idle' || status === 'accepted' || status === 'discarded' ? <div className="generation-start-row">
      <button className="generation-primary" type="button" disabled={!canStart} aria-describedby={!canStart ? 'generation-disabled-reason' : undefined} onClick={onGenerate}>
        <Sparkles size={15} aria-hidden="true"/>{status === 'idle' ? 'Generate scene' : 'Generate another draft'}
      </button>
      {!canStart && <span className="generation-reason" id="generation-disabled-reason">{disabledReason}</span>}
      {!ready && <button className="generation-settings-link" type="button" onClick={onOpenSettings}>Open Settings</button>}
    </div> : null}

    {active && <div className="generation-active-row">
      <p className="generation-live-status" aria-live="polite">{status === 'starting' ? 'Saving the current scene direction before sending it.' : status === 'stopping' ? 'Stopping the request and keeping its latest saved draft.' : 'The beats are unchanged while the draft streams below.'}</p>
      <button className="generation-stop" type="button" disabled={status === 'stopping'} onClick={onStop}><Square size={13} aria-hidden="true"/>{status === 'stopping' ? 'Stopping…' : 'Stop generating'}</button>
    </div>}

    {errorMessage && <p className="generation-error" role="alert">{errorMessage}</p>}

    {isOutdated && showDraft && <div className="generation-outdated" role="alert">
      <strong>Based on earlier direction</strong>
      <span>The scene direction or prose changed after this request began. Review the draft before accepting it.</span>
      <label><input type="checkbox" checked={acknowledgedOutdated} onChange={event => setReviewedPair(event.target.checked ? reviewKey : '')}/>I reviewed this draft against the current scene</label>
    </div>}

    {showDraft && <div className="generation-draft-wrap">
      <p className="generation-draft-label" id="generation-draft-label">{status === 'streaming' || status === 'starting' || status === 'stopping' ? 'Draft so far' : status === 'stopped' ? 'Partial draft' : 'Generated prose'}</p>
      {hasDraft ? <pre className="generation-draft" aria-labelledby="generation-draft-label" aria-live="off">{draftText}</pre> : <p className="generation-empty-draft">No draft text was received.</p>}
    </div>}

    {status === 'completed' || status === 'stopped' ? <div className="generation-actions">
      <button className="generation-primary" type="button" disabled={!hasDraft || !acknowledgedOutdated} onClick={() => onAccept(isOutdated)}><Check size={14} aria-hidden="true"/>Accept draft</button>
      <button type="button" disabled={!hasDraft} onClick={onCopy}><Copy size={14} aria-hidden="true"/>Copy</button>
      <button className="generation-discard" type="button" onClick={onDiscard}><Trash2 size={14} aria-hidden="true"/>Discard</button>
    </div> : null}

    {(status === 'failed' || status === 'interrupted') && <div className="generation-actions">
      <button className="generation-primary" type="button" disabled={!ready || !hasSavedBeats} onClick={onRetry ?? onGenerate}><Sparkles size={14} aria-hidden="true"/>Generate a new attempt</button>
      <button type="button" disabled={!hasDraft} onClick={onCopy}><Copy size={14} aria-hidden="true"/>Copy partial</button>
      <button className="generation-discard" type="button" onClick={onDiscard}><Trash2 size={14} aria-hidden="true"/>Discard</button>
    </div>}
  </section>;
}
