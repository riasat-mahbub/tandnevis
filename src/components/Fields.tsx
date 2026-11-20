import { useEffect, useRef, useState } from 'react';

export function TitleField({ value, label, onSave, large = false, disabled = false }: { value: string; label: string; onSave: (value: string) => void; large?: boolean; disabled?: boolean }) {
  const [draft, setDraft] = useState(value);
  const focused = useRef(false);
  useEffect(() => { if (!focused.current) setDraft(value); }, [value]);
  return <label className={`title-field ${large ? 'large' : ''}`}><span className="sr-only">{label}</span><input value={draft} aria-label={label} aria-invalid={!draft.trim()} required disabled={disabled} maxLength={250} onFocus={() => { focused.current = true; }} onChange={e => { setDraft(e.target.value); if (e.target.value.trim()) onSave(e.target.value); }} onBlur={() => {
    focused.current = false;
    if (!draft.trim()) { setDraft(value); return; }
  }} onKeyDown={e => { if (e.key === 'Enter' || e.key === 'Escape') e.currentTarget.blur(); }}/>{!draft.trim() && <small className="field-error">A name is required. The previous name is kept until you enter one.</small>}</label>;
}
