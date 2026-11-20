interface Props {
  value: string;
  disabled: boolean;
  onChange: (value: string) => void;
}

/** Accepted drafts live separately from freeform scene-direction beats. */
export default function SceneProseEditor({ value, disabled, onChange }: Props) {
  return <details className="scene-prose-editor" open={value.length > 0}>
    <summary>Scene prose</summary>
    <p className="muted">Accepted scene drafts appear here. Edit the prose freely; your beats remain separate direction.</p>
    <label htmlFor="scene-prose">Writing</label>
    <textarea
      id="scene-prose"
      aria-label="Scene prose"
      disabled={disabled}
      rows={12}
      value={value}
      onChange={event => onChange(event.target.value)}
      placeholder="Your scene prose will live here. Generate a draft from the beats when you’re ready."
    />
  </details>;
}
