import { useId, useState } from 'react';
import { ChevronDown, ChevronUp, Heart, MessageSquare, Network, Plus, Search, Users } from 'lucide-react';
import type { Character, Preset, ProjectSnapshot } from '../services/project';
import { effectiveColor, groupPresetsByColor, presetColorStyle } from '../services/preset-colors';
import type { LibraryKind } from './LibraryView';
import CharacterIcon from './CharacterIcon';
import { CHARACTER_REFERENCE_MIME, PRESET_REFERENCE_MIME } from './BeatEditor';

const categories = ['characters', 'emotions', 'tones'] as const;
const titles = { characters: 'Characters', emotions: 'Emotions', tones: 'Tones' };
const singular = { characters: 'character', emotions: 'emotion', tones: 'tone' } as const;
const icons = { characters: Users, emotions: Heart, tones: MessageSquare };

interface Props {
  project: ProjectSnapshot;
  locked: boolean;
  onManage: (kind: LibraryKind, id?: string) => void;
  onInsert: (kind: 'character' | 'emotion' | 'tone', definition: Character | Preset) => void;
  onRelationshipChange?: () => void;
}

export default function WritingTools({ project, locked, onManage, onInsert, onRelationshipChange }: Props) {
  const [search, setSearch] = useState('');
  const [expanded, setExpanded] = useState<Partial<Record<LibraryKind, boolean>>>({});
  const prefix = useId();
  const query = search.trim().toLocaleLowerCase();
  const insertButton = (kind: LibraryKind, definition: Character | Preset) => {
    const type = singular[kind];
    return <button key={definition.id} className={`story-block block-${type} ${kind === 'characters' ? 'character-chip' : 'preset-colored'}`}
      style={kind === 'characters' ? undefined : presetColorStyle(effectiveColor(type as 'emotion' | 'tone', definition as Preset))}
      aria-label={`${type[0].toUpperCase() + type.slice(1)}: ${definition.name}`} disabled={locked} draggable={!locked}
      title={`Insert ${definition.name} at the writing caret, or drag into the summary or a beat`}
      onClick={() => onInsert(type, definition)}
      onDragStart={event => {
        event.stopPropagation();
        event.dataTransfer.setData(kind === 'characters' ? CHARACTER_REFERENCE_MIME : PRESET_REFERENCE_MIME,
          kind === 'characters' ? definition.id : JSON.stringify({ kind: type, id: definition.id }));
        event.dataTransfer.effectAllowed = 'copy';
      }}>
      {kind === 'characters' && <CharacterIcon icon={(definition as Character).icon} size={14}/>}
      {definition.name}
    </button>;
  };
  return <div className="writing-tools">
    <label className="block-search"><Search size={15} aria-hidden="true"/><span className="sr-only">Search all story blocks</span><input type="search" autoComplete="off" value={search} placeholder="Find a block…" onChange={event => setSearch(event.target.value)}/></label>
    <div className="writing-tool-groups">
      {onRelationshipChange && (!query || 'relationship change'.includes(query)) && <section className="writing-tool-group" aria-label="Relationship changes"><div className="writing-tool-group-heading"><Network size={16} aria-hidden="true"/><h3>Relationships</h3></div><button className="story-block block-relationship-change" disabled={locked || project.characters.length < 2} onClick={onRelationshipChange} title="Add a relationship change to this scene summary">Relationship change</button><p className="muted block-empty">Changes in the summary also appear in the graph.</p></section>}
      {categories.map(kind => {
        const Icon = icons[kind];
        const items = project[kind].filter(item => !item.archived && item.name.toLocaleLowerCase().includes(query));
        const visible = query || expanded[kind] ? items : items.slice(0, kind === 'characters' ? 6 : 8);
        const groupId = `${prefix}-${kind}`;
        return <section key={kind} className="writing-tool-group" aria-labelledby={`${groupId}-heading`}>
          <div className="writing-tool-group-heading"><Icon size={16} aria-hidden="true"/><h3 id={`${groupId}-heading`}>{titles[kind]}</h3><button className="quiet icon-button" aria-label={`New ${singular[kind]}`} title={`New ${singular[kind]}`} disabled={locked} onClick={() => onManage(kind, 'new')}><Plus size={16}/></button></div>
          <div id={groupId}>
            {kind === 'characters' ? <div className="block-collection" aria-label="Character blocks">{visible.map(item => insertButton(kind, item))}</div>
              : <div className="preset-color-groups" aria-label={`${titles[kind]} blocks`}>{groupPresetsByColor(singular[kind], visible as Preset[]).map(group => <section className="preset-color-group" key={group.id} aria-label={group.name}><h4 className="preset-color-group-heading">{group.color && <span aria-hidden="true" style={{ backgroundColor: group.color }}/>} {group.name}</h4><div className="block-collection">{group.presets.map(item => insertButton(kind, item))}</div></section>)}</div>}
          </div>
          {!items.length && <p className="muted block-empty">{query ? `No ${kind} match “${search}”.` : `No ${kind} yet.`}</p>}
          <div className="writing-tool-group-footer">
            {!query && items.length > (kind === 'characters' ? 6 : 8) && <button className="quiet group-more" aria-expanded={!!expanded[kind]} aria-controls={groupId} onClick={() => setExpanded(value => ({ ...value, [kind]: !value[kind] }))}>{expanded[kind] ? <ChevronUp size={13}/> : <ChevronDown size={13}/>} {expanded[kind] ? 'Show fewer' : `Show all ${items.length}`}</button>}
            <button className="quiet block-manage" onClick={() => onManage(kind)}>Manage {titles[kind]}</button>
          </div>
        </section>;
      })}
    </div>
    {query && <button className="quiet" onClick={() => setSearch('')}>Clear search</button>}
  </div>;
}
