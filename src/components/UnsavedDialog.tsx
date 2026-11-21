import { useEffect, useRef } from 'react';

export default function UnsavedDialog({ kind = 'project', busy, error, onSave, onDiscard, onCancel }: { kind?: 'project' | 'character-draft'; busy: boolean; error: string; onSave: () => void; onDiscard: () => void; onCancel: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current!;
    const previous = document.activeElement as HTMLElement | null;
    if (dialog.showModal) dialog.showModal(); else dialog.setAttribute('open', '');
    return () => { dialog.close?.(); previous?.focus(); };
  }, []);
  if (kind === 'character-draft') return <dialog ref={ref} className="unsaved-dialog" aria-labelledby="unsaved-title" onCancel={event => { event.preventDefault(); if (!busy) onCancel(); }}>
    <h2 id="unsaved-title">Discard this character draft?</h2>
    <p>This unsubmitted draft is held only in this window. Project Save does not save it.</p>
    {error && <p role="alert">{error}</p>}
    <div className="button-row"><button autoFocus disabled={busy} onClick={onCancel}>Keep working</button><button className="primary" disabled={busy} onClick={onDiscard}>Discard draft</button></div>
  </dialog>;
  return <dialog ref={ref} className="unsaved-dialog" aria-labelledby="unsaved-title" onCancel={event => { event.preventDefault(); if (!busy) onCancel(); }}>
    <h2 id="unsaved-title">Save your changes?</h2>
    <p>Your project has unsaved changes. Save them before continuing, or discard them.</p>
    {error && <p role="alert">{error}</p>}
    <div className="button-row"><button autoFocus disabled={busy} onClick={onCancel}>Cancel</button><button disabled={busy} onClick={onDiscard}>Discard changes</button><button className="primary" disabled={busy} onClick={onSave}>{busy ? 'Saving…' : 'Save and continue'}</button></div>
  </dialog>;
}
