import { ChevronDown, RotateCcw } from 'lucide-react';
import { useState } from 'react';
import { characterIcons } from '../content/character-icons';
import CharacterIcon from './CharacterIcon';
import './CharacterIconPicker.css';

interface Props {
  value?: string;
  disabled?: boolean;
  onChange: (icon: string) => void;
  label?: string;
}

export default function CharacterIconPicker({ value, disabled = false, onChange, label = 'Character icon' }: Props) {
  const selected = value || 'user';
  const [expanded, setExpanded] = useState(false);
  return <fieldset className="character-icon-picker" disabled={disabled}>
    <legend>{label}</legend>
    <div className="character-icon-picker-status">
      <span>{characterIcons.find(item => item.id === selected)?.label ?? 'Person'} icon</span>
      <button type="button" className="character-icon-expand" aria-expanded={expanded} onClick={() => setExpanded(open => !open)}><CharacterIcon icon={selected} size={15}/>{expanded ? 'Hide icons' : 'Choose character icon'}<ChevronDown size={13}/></button>
      <button type="button" className="character-icon-reset" disabled={selected === 'user'} onClick={() => onChange('')}><RotateCcw size={13}/>Use default icon</button>
    </div>
    {expanded && <div className="character-icon-grid" role="group" aria-label="Character icon choices">
      {characterIcons.map(({ id, label: iconLabel }) => <button
        key={id}
        type="button"
        className="character-icon-choice"
        aria-label={`${iconLabel} icon`}
        aria-pressed={selected === id}
        title={`${iconLabel} icon`}
        onClick={() => onChange(id === 'user' ? '' : id)}
      ><CharacterIcon icon={id} size={17}/></button>)}
    </div>}
  </fieldset>;
}
