import { useId } from 'react';

interface Props {
  value: string;
  disabled: boolean;
  onChange: (value: string) => void;
}

/** Accepted drafts live separately from freeform scene-direction beats. */
export default function SceneProseEditor({ value, disabled, onChange }: Props) {
  const proseId = useId();
  return <section className="scene-prose-editor" aria-labelledby={`${proseId}-heading`}>
    <h2 id={`${proseId}-heading`}>Scene prose</h2>
    <p className="muted">Accepted scene drafts appear here. Edit the prose freely; your beats remain separate direction.</p>
    <label htmlFor={proseId}>Writing</label>
    <textarea
      id={proseId}
      aria-label="Scene prose"
      disabled={disabled}
      rows={8}
      value={value}
      onChange={event => onChange(event.target.value)}
      placeholder="Your scene prose will live here. Generate a draft from the beats when you’re ready."
    />
  </section>;
}
