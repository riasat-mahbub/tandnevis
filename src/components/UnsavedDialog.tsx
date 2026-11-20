import { useEffect, useRef } from 'react';

export default function UnsavedDialog({ busy, error, onSave, onDiscard, onCancel }: { busy: boolean; error: string; onSave: () => void; onDiscard: () => void; onCancel: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current!;
    const previous = document.activeElement as HTMLElement | null;
    if (dialog.showModal) dialog.showModal(); else dialog.setAttribute('open', '');
    return () => { dialog.close?.(); previous?.focus(); };
  }, []);
  return <dialog ref={ref} className="unsaved-dialog" aria-labelledby="unsaved-title" onCancel={event => { event.preventDefault(); if (!busy) onCancel(); }}>
    <h2 id="unsaved-title">Save your changes?</h2>
    <p>Your project has unsaved changes. Save them before continuing, or discard them.</p>
    {error && <p role="alert">{error}</p>}
    <div className="button-row"><button autoFocus disabled={busy} onClick={onCancel}>Cancel</button><button disabled={busy} onClick={onDiscard}>Discard changes</button><button className="primary" disabled={busy} onClick={onSave}>{busy ? 'Saving…' : 'Save and continue'}</button></div>
  </dialog>;
}
