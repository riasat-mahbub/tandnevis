import { useEffect, useMemo, useState } from 'react';
import { Check, Circle, Copy, Search, Tags } from 'lucide-react';
import { stockCharacterCategories, type StockCharacterTemplate } from '../content/stock-characters';
import CharacterIcon from './CharacterIcon';
import './CharacterTemplateBrowser.css';

type Category = (typeof stockCharacterCategories)[number];
type ProfileFields = Pick<StockCharacterTemplate, 'background' | 'personality' | 'voice'>;

interface Props {
  templates: readonly StockCharacterTemplate[];
  categories?: readonly Category[];
  appliedTemplateId: string;
  fields: ProfileFields;
  icon?: string;
  disabled?: boolean;
  onApply: (template: StockCharacterTemplate | null) => void;
}

function normalize(value: string) {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase().trim();
}

function standingLabel(standing: StockCharacterTemplate['standing']) {
  return standing === 'historical-literary' ? 'Historical / literary' : 'Genre convention';
}

export default function CharacterTemplateBrowser({
  templates,
  categories = stockCharacterCategories,
  appliedTemplateId,
  fields,
  icon,
  disabled = false,
  onApply,
}: Props) {
  const [query, setQuery] = useState('');
  const [categoryId, setCategoryId] = useState('all');
  const [previewId, setPreviewId] = useState(appliedTemplateId);
  const [pendingTemplate, setPendingTemplate] = useState<StockCharacterTemplate | null | undefined>(undefined);
  const [copiedUrl, setCopiedUrl] = useState('');
  const [copyErrorUrl, setCopyErrorUrl] = useState('');

  useEffect(() => { setPreviewId(appliedTemplateId); }, [appliedTemplateId]);

  const normalizedQuery = normalize(query);
  const matches = useMemo(() => templates.filter(template => {
    if (categoryId !== 'all' && template.category !== categoryId) return false;
    if (!normalizedQuery) return true;
    const searchable = normalize([
      template.title,
      ...template.aliases,
      ...template.historicalConnections,
      ...template.tags,
      template.summary,
    ].join(' '));
    return searchable.includes(normalizedQuery);
  }), [templates, categoryId, normalizedQuery]);
  const grouped = useMemo(() => categories.map(category => ({
    category,
    entries: matches.filter(template => template.category === category.id).sort((a, b) => a.title.localeCompare(b.title)),
  })).filter(group => group.entries.length > 0), [categories, matches]);
  const preview = templates.find(template => template.id === previewId) ?? null;
  const hasProfileText = !!(fields.background.trim() || fields.personality.trim() || fields.voice.trim());
  const hasCustomIcon = !!(icon && icon !== 'user');

  function apply(template: StockCharacterTemplate | null) {
    onApply(template);
    setPendingTemplate(undefined);
  }

  function requestApply(template: StockCharacterTemplate | null) {
    if (disabled) return;
    setPendingTemplate(template);
    if (!hasProfileText && !hasCustomIcon) apply(template);
  }

  function confirmApply() {
    if (pendingTemplate !== undefined) apply(pendingTemplate);
  }

  async function copySource(url: string) {
    try {
      await navigator.clipboard.writeText(url);
      setCopiedUrl(url);
      setCopyErrorUrl('');
    } catch {
      setCopyErrorUrl(url);
      setCopiedUrl('');
    }
  }

  const categoryTitle = (id: string) => categories.find(category => category.id === id)?.label ?? id;
  const actionArea = pendingTemplate !== undefined ? <div className="character-template-confirm" role="alert">
    <div><strong>Replace the current profile fields?</strong><p>{[
      hasProfileText ? pendingTemplate ? `Using ${pendingTemplate.title} replaces background, personality, and baseline voice.` : 'Using blank fields clears background, personality, and baseline voice.' : '',
      hasCustomIcon ? pendingTemplate ? 'Your chosen icon changes to the template icon.' : 'Your chosen icon returns to its default.' : '',
      'Your character name stays as entered.',
    ].filter(Boolean).join(' ')}</p></div>
    <div className="character-template-confirm-actions"><button type="button" className="primary" disabled={disabled} onClick={confirmApply}><Check size={14}/>Replace profile fields</button><button type="button" disabled={disabled} onClick={() => setPendingTemplate(undefined)}>Keep current fields</button></div>
  </div> : <div className="character-template-preview-actions">
    <button type="button" className="primary" disabled={disabled} onClick={() => requestApply(preview)}>{preview ? 'Use template' : 'Use blank fields'}</button>
    {appliedTemplateId === previewId && appliedTemplateId && <span><Circle size={9} fill="currentColor"/>Applied to this draft</span>}
  </div>;

  return <section className="character-template-browser" aria-labelledby="character-template-heading" data-testid="character-template-browser">
    <div className="character-template-heading">
      <div>
        <h3 id="character-template-heading">Stock character templates</h3>
        <p>Browse a documented convention, preview its suggested draft, then choose what to copy.</p>
      </div>
      <span className="character-template-count">{templates.length} templates</span>
    </div>

    <div className="character-template-controls">
      <label className="character-template-search">
        <span className="sr-only">Search character templates</span>
        <Search size={15} aria-hidden="true"/>
        <input type="search" value={query} onChange={event => setQuery(event.target.value)} onKeyDown={event => { if (event.key === 'Enter') event.preventDefault(); }} placeholder="Search names, aliases, tags" />
      </label>
      <div className="character-template-categories" role="group" aria-label="Template categories">
        <button type="button" aria-pressed={categoryId === 'all'} onClick={() => setCategoryId('all')}>All categories</button>
        {categories.map(category => <button type="button" key={category.id} aria-pressed={categoryId === category.id} onClick={() => setCategoryId(category.id)}><CharacterIcon icon={category.icon} size={14}/>{category.label}</button>)}
      </div>
    </div>

    <div className="character-template-browser-grid">
      <div className="character-template-results" aria-label="Character template results">
        <button type="button" className={`character-template-result character-template-blank ${previewId === '' ? 'is-selected' : ''}`} aria-label="Preview Blank character" aria-pressed={previewId === ''} onClick={() => { setPreviewId(''); setPendingTemplate(undefined); }}>
          <span className="character-template-result-title"><CharacterIcon icon="user" size={17}/><strong>Blank character</strong></span>
          <small>Start with your own profile fields.</small>
        </button>
        {matches.length ? grouped.map(({ category, entries }) => <section className="character-template-group" key={category.id} aria-label={category.label}>
          <h4>{category.label}</h4>
          <ul>{entries.map(template => <li key={template.id}>
            <button type="button" className={`character-template-result ${previewId === template.id ? 'is-selected' : ''}`} aria-label={`Preview ${template.title}`} aria-pressed={previewId === template.id} onClick={() => { setPreviewId(template.id); setPendingTemplate(undefined); }}>
              <span className="character-template-result-title"><CharacterIcon icon={template.icon} size={17}/><strong>{template.title}</strong></span>
              <small>{template.summary}</small>
            </button>
          </li>)}</ul>
        </section>) : <div className="character-template-no-results"><p>No templates match these filters.</p><button type="button" onClick={() => { setQuery(''); setCategoryId('all'); }}>Reset filters</button></div>}
      </div>

      <section className="character-template-preview" aria-label="Template preview" aria-live="polite">
        {preview ? <>
          <div className="character-template-preview-title">
            <CharacterIcon icon={preview.icon} size={22}/>
            <div><h4>{preview.title}</h4><span className="character-template-standing">{standingLabel(preview.standing)}</span></div>
          </div>
          <p className="character-template-summary">{preview.summary}</p>
          {actionArea}
          <p className="character-template-category"><Tags size={13}/>{categoryTitle(preview.category)}</p>
          {preview.contextNote && <aside className="character-template-context"><strong>Context</strong><p>{preview.contextNote}</p></aside>}
          {!!preview.aliases.length && <p className="character-template-meta"><strong>Also listed as:</strong> {preview.aliases.join(', ')}</p>}
          {!!preview.historicalConnections.length && <p className="character-template-meta"><strong>Historical connections:</strong> {preview.historicalConnections.join(', ')}</p>}
          {!!preview.tags.length && <p className="character-template-meta"><strong>Tags:</strong> {preview.tags.join(' · ')}</p>}
          <div className="character-template-suggestions">
            <h5>Suggested draft fields</h5>
            <dl>
              <div><dt>Background</dt><dd>{preview.background}</dd></div>
              <div><dt>Personality</dt><dd>{preview.personality}</dd></div>
              <div><dt>Baseline voice</dt><dd>{preview.voice}</dd></div>
            </dl>
          </div>
          <details className="character-template-sources">
            <summary>Sources ({preview.sources.length})</summary>
            {preview.sources.length ? <ul>{preview.sources.map((source, index) => <li key={`${source.url}:${index}`}>
              <a href={source.url} target="_blank" rel="noreferrer">{source.title}</a>
              <span>{source.locator}</span>
              <span className="character-template-source-url">{source.url}</span>
              <p>{source.claim}</p>
              <small>{source.verified ? 'Reference checked for this claim' : 'Reference listed; claim not verified'}</small>
              <button type="button" className="character-template-source-copy" aria-label={`Copy source link for ${source.title}`} onClick={() => void copySource(source.url)}><Copy size={13}/>{copiedUrl === source.url ? 'Copied' : 'Copy source link'}</button>
              {copiedUrl === source.url && <small role="status">Link copied.</small>}
              {copyErrorUrl === source.url && <small role="alert">Could not copy. Select the URL above to copy it.</small>}
            </li>)}</ul> : <p>No source details are available.</p>}
          </details>
        </> : <>
          <div className="character-template-preview-title"><CharacterIcon icon="user" size={22}/><div><h4>Blank character</h4><span className="character-template-standing">Your own starting point</span></div></div>
          <p className="character-template-summary">Create a profile from your own ideas. Choosing blank fields keeps the name and gives the icon its default.</p>
          {actionArea}
          <div className="character-template-suggestions">
            <h5>Fields to write</h5>
            <dl><div><dt>Background</dt><dd>Where this character comes from and what shapes their present.</dd></div><div><dt>Personality</dt><dd>What they want, how they respond, and where they contradict themselves.</dd></div><div><dt>Baseline voice</dt><dd>How they usually sound in dialogue.</dd></div></dl>
          </div>
        </>}

      </section>
    </div>
  </section>;
}
