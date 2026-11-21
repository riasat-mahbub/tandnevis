import { useState } from 'react';
import { AlertCircle, Check, Copy, LoaderCircle, Sparkles, Square, Trash2 } from 'lucide-react';
import type { GenerationPurpose } from '../services/generation';
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
  purpose?: GenerationPurpose;
  /** The scene toolbar supplies generation controls while this panel reviews output. */
  hideStartAction?: boolean;
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

function beatProposalText(value: unknown): string {
  if (!value || typeof value !== 'object') return '';
  const node = value as { type?: string; text?: string; attrs?: Record<string, string>; content?: unknown[] };
  if (node.type === 'text') return typeof node.text === 'string' ? node.text : '';
  if (node.type === 'characterReference') return `[${node.attrs?.label || 'Character'}]`;
  if (node.type === 'emotionReference') return ` [Emotion: ${node.attrs?.label || 'Emotion'}] `;
  if (node.type === 'toneReference') return ` [Tone: ${node.attrs?.label || 'Tone'}] `;
  if (node.type === 'hardBreak') return '\n';
  return Array.isArray(node.content) ? node.content.map(beatProposalText).join(['doc', 'bulletList', 'orderedList', 'listItem'].includes(node.type ?? '') ? '\n' : '') : '';
}

function proposedBeats(draft: string): string[] | null {
  try {
    const parsed = JSON.parse(draft) as { beats?: { document?: unknown }[] };
    if (!Array.isArray(parsed.beats) || !parsed.beats.length) return null;
    const beats = parsed.beats.map(beat => beatProposalText(beat.document).trim());
    return beats.every(Boolean) ? beats : null;
  } catch { return null; }
}

export default function GenerationPanel({
  purpose = 'prose',
  hideStartAction = false,
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
  const proseChanged = purpose === 'prose' && requestBaseProse !== undefined && currentProse !== undefined && requestBaseProse !== currentProse;
  const isOutdated = directionsChanged || proseChanged;
  const reviewKey = reviewPair(requestFingerprint, currentFingerprint, requestBaseProse, currentProse);
  const acknowledgedOutdated = !isOutdated || reviewedPair === reviewKey;
  const canStart = ready && hasSavedBeats && !active;
  const showDraft = ['starting', 'stopping', 'streaming', 'completed', 'stopped', 'failed', 'interrupted'].includes(status);
  const hasDraft = draftText.trim().length > 0;
  const beats = purpose === 'beats' ? proposedBeats(draftText) : null;
  const headingId = `generation-${purpose}-heading`;
  const draftLabelId = `generation-${purpose}-draft-label`;
  const disabledReasonId = `generation-${purpose}-disabled-reason`;

  let disabledReason = reason;
  if (!ready) disabledReason ||= 'Connect and verify ChatGPT in Settings to generate this scene.';
  else if (!hasSavedBeats) disabledReason ||= purpose === 'beats' ? 'Describe the scene in its summary board first.' : 'Add a summary or non-empty beat to describe this scene.';

  const statusLabel: Record<GenerationStatus, string> = {
    idle: 'Ready when you are',
    starting: purpose === 'beats' ? 'Preparing beat request' : 'Preparing prose request',
    stopping: 'Stopping scene generation',
    streaming: purpose === 'beats' ? 'Building the beats' : 'Writing prose',
    completed: 'Draft ready',
    stopped: 'Generation stopped',
    failed: 'Generation failed',
    interrupted: 'Draft recovered after interruption',
    accepted: 'Draft accepted',
    discarded: 'Draft discarded',
  };

  return <section className="generation-panel" data-generation-purpose={purpose} aria-labelledby={headingId}>
    <div className="generation-panel-header">
      <div>
        <h2 id={headingId}>{purpose === 'beats' ? 'Draft beats' : 'Prose draft'}</h2>
      </div>
      <span className={`generation-panel-state generation-state-${status}`} role="status">
        {active ? <LoaderCircle size={13} aria-hidden="true"/> : status === 'failed' ? <AlertCircle size={13} aria-hidden="true"/> : status === 'accepted' ? <Check size={13} aria-hidden="true"/> : <Sparkles size={13} aria-hidden="true"/>}
        {statusLabel[status]}
      </span>
    </div>

    {ready && <p className="generation-usage-note"><span>Using ChatGPT plan{modelLabel ? ` · ${modelLabel}` : ''}</span><a href="https://chatgpt.com/settings/usage" target="_blank" rel="noreferrer">Manage usage</a></p>}

    {!hideStartAction && (status === 'idle' || status === 'accepted' || status === 'discarded') ? <div className="generation-start-row">
      <button className="generation-primary" type="button" disabled={!canStart} aria-describedby={!canStart ? disabledReasonId : undefined} onClick={onGenerate}>
        <Sparkles size={15} aria-hidden="true"/>{purpose === 'beats' ? 'Generate scene' : 'Generate prose'}
      </button>
      {!canStart && <span className="generation-reason" id={disabledReasonId}>{disabledReason}</span>}
      {!ready && <button className="generation-settings-link" type="button" onClick={onOpenSettings}>Open Settings</button>}
    </div> : null}

    {active && <div className="generation-active-row">
      <p className="generation-live-status" aria-live="polite">{status === 'starting' ? 'Preparing the current scene direction before sending it.' : status === 'stopping' ? 'Stopping the request and keeping its latest draft.' : purpose === 'beats' ? 'Review the proposed beats before adding them to your scene.' : 'The beats are unchanged while the prose streams below.'}</p>
      <button className="generation-stop" type="button" disabled={status === 'stopping'} onClick={onStop}><Square size={13} aria-hidden="true"/>{status === 'stopping' ? 'Stopping…' : 'Stop generating'}</button>
    </div>}

    {errorMessage && <p className="generation-error" role="alert">{errorMessage}</p>}

    {isOutdated && showDraft && <div className="generation-outdated" role="alert">
      <strong>Based on earlier direction</strong>
      <span>{purpose === 'beats' ? 'The scene direction changed after this request began. Review the beats before adding them.' : 'The scene direction or prose changed after this request began. Review the draft before accepting it.'}</span>
      <label><input type="checkbox" checked={acknowledgedOutdated} onChange={event => setReviewedPair(event.target.checked ? reviewKey : '')}/>I reviewed this draft against the current scene</label>
    </div>}

    {showDraft && <div className="generation-draft-wrap">
      <p className="generation-draft-label" id={draftLabelId}>{purpose === 'beats' ? 'Proposed beats' : active ? 'Draft so far' : status === 'stopped' ? 'Partial draft' : 'Generated prose'}</p>
      {purpose === 'beats' ? beats ? <ol className="generation-beat-proposals" aria-labelledby={draftLabelId}>{beats.map((beat, index) => <li key={index}><p>{beat}</p></li>)}</ol> : <p className="generation-empty-draft">{active ? 'Building the beat proposals…' : !hasDraft ? 'No beat proposals were received.' : status === 'completed' ? 'This beat draft could not be read. Generate a new attempt.' : 'The beat draft is incomplete. Generate a new attempt to add editable beats.'}</p> : hasDraft ? <pre className="generation-draft" aria-labelledby={draftLabelId} aria-live="off">{draftText}</pre> : <p className="generation-empty-draft">No draft text was received.</p>}
    </div>}

    {status === 'completed' || status === 'stopped' ? <div className="generation-actions">
      <button className="generation-primary" type="button" disabled={!hasDraft || !acknowledgedOutdated || (purpose === 'beats' && (status !== 'completed' || !beats))} onClick={() => onAccept(isOutdated)}><Check size={14} aria-hidden="true"/>{purpose === 'beats' ? 'Accept beats' : 'Accept draft'}</button>
      <button type="button" disabled={!hasDraft} onClick={onCopy}><Copy size={14} aria-hidden="true"/>Copy</button>
      <button className="generation-discard" type="button" onClick={onDiscard}><Trash2 size={14} aria-hidden="true"/>Discard</button>
    </div> : null}
    {purpose === 'beats' && status === 'completed' && beats && <p className="generation-reason">Accept adds these beats after your existing beats. Your summary and prose stay unchanged.</p>}

    {(status === 'failed' || status === 'interrupted') && <div className="generation-actions">
      <button className="generation-primary" type="button" disabled={!ready || !hasSavedBeats} onClick={onRetry ?? onGenerate}><Sparkles size={14} aria-hidden="true"/>Generate a new attempt</button>
      <button type="button" disabled={!hasDraft} onClick={onCopy}><Copy size={14} aria-hidden="true"/>Copy partial</button>
      <button className="generation-discard" type="button" onClick={onDiscard}><Trash2 size={14} aria-hidden="true"/>Discard</button>
    </div>}
  </section>;
}
