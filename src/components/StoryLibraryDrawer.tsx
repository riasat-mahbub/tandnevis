import { useEffect, useId, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { ArrowLeft, BookOpen, ChevronDown, ChevronRight, ChevronUp, Heart, MessageSquare, Plus, Search, Users, X } from 'lucide-react';
import type { Character, Preset, ProjectSnapshot } from '../services/project';
import type { LibraryKind } from './LibraryView';
import CharacterIcon from './CharacterIcon';
import { effectiveColor, presetColorStyle } from '../services/preset-colors';

interface Props {
  open: boolean;
  browsing: boolean;
  project: ProjectSnapshot;
  locked: boolean;
  returnLabel: string;
  onClose: () => void;
  onBrowse: () => void;
  onOpen: (kind: LibraryKind, id?: string) => void;
  children: ReactNode;
  feedback?: ReactNode;
}

const categories = ['characters', 'emotions', 'tones'] as const;
const titles = { characters: 'Characters', emotions: 'Emotions', tones: 'Tones' };
const singular = { characters: 'character', emotions: 'emotion', tones: 'tone' } as const;
const icons = { characters: Users, emotions: Heart, tones: MessageSquare };

export default function StoryLibraryDrawer({ open, browsing, project, locked, returnLabel, onClose, onBrowse, onOpen, children, feedback }: Props) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [search, setSearch] = useState('');
  const [expanded, setExpanded] = useState<Partial<Record<LibraryKind, boolean>>>({});
  const titleId = useId();
  const query = search.trim().toLocaleLowerCase();
  useEffect(() => {
    if (!open) return;
    const element = dialog.current!;
    const previous = document.activeElement as HTMLElement | null;
    const scrollY = window.scrollY;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    if (element.showModal) element.showModal(); else element.setAttribute('open', '');
    (element.querySelector('input') ?? element.querySelector('button'))?.focus({ preventScroll: true });
    return () => {
      if (element.close) element.close(); else element.removeAttribute('open');
      document.body.style.overflow = overflow;
      window.scrollTo(0, scrollY);
      if (previous?.isConnected && !previous.closest('[hidden]')) previous.focus({ preventScroll: true });
    };
  }, [open]);
  useEffect(() => { if (!open) { setSearch(''); setExpanded({}); } }, [open]);
  return <dialog ref={dialog} className="story-library-drawer" aria-labelledby={titleId} onCancel={event => { event.preventDefault(); onClose(); }} onClick={event => {
    if (event.target !== event.currentTarget) return;
    const rect = event.currentTarget.getBoundingClientRect();
    if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) onClose();
  }}>
    <div className="story-library-header"><div><h1 id={titleId}><BookOpen size={23} aria-hidden="true"/>Story Library</h1><p>Project-wide characters, emotions and tones</p></div><button className="quiet icon-button" aria-label={returnLabel} title="Close Story Library" onClick={onClose}><X size={20}/></button></div>
    <div className="story-library-body">
      {feedback}
      {!browsing && <button className="quiet library-all" onClick={onBrowse}><ArrowLeft size={15}/>All definitions</button>}
      <div hidden={!browsing}>
        <label className="library-global-search"><Search size={17} aria-hidden="true"/><span className="sr-only">Search all definitions</span><input type="search" value={search} onChange={event => setSearch(event.target.value)} placeholder="Search characters, emotions and tones…"/></label>
        {categories.map(kind => {
          const Icon = icons[kind];
          const items = project[kind].filter(item => !item.archived && `${item.name} ${kind === 'characters' ? (item as Character).personality : (item as Preset).meaning}`.toLocaleLowerCase().includes(query));
          const visible = query || expanded[kind] ? items : items.slice(0, 6);
          return <section className="library-overview-group" key={kind} aria-label={`${titles[kind]} overview`}>
            <div className="library-overview-heading"><Icon size={18} aria-hidden="true"/><h2><button className="quiet" onClick={() => onOpen(kind)}>{titles[kind]}</button></h2><span>{items.length} definitions</span><button disabled={locked} onClick={() => onOpen(kind, 'new')}><Plus size={14}/>New {singular[kind]}</button></div>
            <div className="library-overview-items">{visible.map(item => <button className="library-overview-row" key={item.id} onClick={() => onOpen(kind, item.id)}>
              <span className={`library-overview-icon block-${singular[kind]} ${kind === 'characters' ? '' : 'preset-colored'}`} style={kind === 'characters' ? undefined : presetColorStyle(effectiveColor(singular[kind] as 'emotion' | 'tone', item as Preset))}>{kind === 'characters' ? <CharacterIcon icon={(item as Character).icon} size={17}/> : <Icon size={17}/>}</span>
              <span><strong>{item.name}</strong><small>{kind === 'characters' ? (item as Character).personality || (item as Character).voice || 'Character profile' : (item as Preset).meaning || (item as Preset).guidance || 'Reusable writing guidance'}</small></span><ChevronRight size={16}/>
            </button>)}</div>
            {!items.length && <p className="muted">{query ? 'No matching definitions.' : `No ${kind} yet.`}</p>}
            {!query && items.length > 6 && <button className="quiet group-more" aria-expanded={!!expanded[kind]} onClick={() => setExpanded(value => ({ ...value, [kind]: !value[kind] }))}>{expanded[kind] ? <ChevronUp size={14}/> : <ChevronDown size={14}/>} {expanded[kind] ? 'Show fewer' : `Show all ${items.length}`}</button>}
          </section>;
        })}
      </div>
      <div hidden={browsing}>{children}</div>
    </div>
  </dialog>;
}
