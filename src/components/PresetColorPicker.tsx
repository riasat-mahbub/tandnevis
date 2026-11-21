import { PRESET_COLOR_FAMILIES, effectiveColor } from '../services/preset-colors';
import type { PresetKind } from '../services/project';

interface Props {
  kind: PresetKind;
  name: string;
  value: string;
  onChange: (color: string) => void;
  disabled?: boolean;
}

export default function PresetColorPicker({ kind, name, value, onChange, disabled = false }: Props) {
  const automaticColor = effectiveColor(kind, { name });
  const previewColor = value || automaticColor;
  const selectedColor = value.toUpperCase();
  const selectedFamily = PRESET_COLOR_FAMILIES.find(family => family.color === value.toUpperCase());
  const automaticFamily = PRESET_COLOR_FAMILIES.find(family => family.color === automaticColor);
  const status = value ? selectedFamily ? `${selectedFamily.name} color` : `Custom color ${value.toUpperCase()}` : `Automatic · ${automaticFamily?.name ?? 'Focus'}`;

  return <fieldset className="preset-color-picker" disabled={disabled}>
    <legend>Color</legend>
    <div className="preset-color-options" aria-label="Preset colors">
      {PRESET_COLOR_FAMILIES.map(family => <button
        key={family.id}
        type="button"
        className="preset-color-swatch"
        aria-label={`Use ${family.name} color ${family.color}`}
        aria-pressed={selectedColor === family.color}
        title={`${family.name} ${family.color}`}
        style={{ backgroundColor: family.color }}
        onClick={() => onChange(family.color)}
      />)}
      <label className="preset-color-custom">
        <span>Custom</span>
        <input aria-label="Custom color" type="color" value={previewColor} onChange={event => onChange(event.target.value.toUpperCase())}/>
      </label>
    </div>
    <div className="preset-color-status">
      <span>{status}</span>
      <button type="button" className="quiet preset-color-reset" aria-label="Reset to default" disabled={!value} onClick={() => onChange('')}>Reset to default</button>
    </div>
    <span className="sr-only">Preview color {previewColor}</span>
  </fieldset>;
}
