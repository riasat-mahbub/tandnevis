import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, Check, Circle, Copy, Search, Tags } from 'lucide-react';
import { stockCharacterCategories, type StockCharacterTemplate } from '../content/stock-characters';
import type { CharacterWizardAction, CharacterWizardState, CharacterWizardStockStartingPoint } from '../services/character-wizard';
import CharacterIcon from './CharacterIcon';
import './CharacterTemplateBrowser.css';

type Category = (typeof stockCharacterCategories)[number];
type ProfileFields = Pick<StockCharacterTemplate, 'background' | 'personality' | 'voice'>;

interface CommonProps {
  templates: readonly StockCharacterTemplate[];
  categories?: readonly Category[];
}

interface LegacyProps extends CommonProps {
  mode?: 'legacy';
  appliedTemplateId: string;
  fields: ProfileFields;
  icon?: string;
  disabled?: boolean;
  onApply: (template: StockCharacterTemplate | null) => void;
}

interface WizardProps extends CommonProps {
  mode: 'wizard';
  state: CharacterWizardState;
  dispatch: (action: CharacterWizardAction) => void;
}

type Props = LegacyProps | WizardProps;

function normalize(value: string) {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase().trim();
}

function standingLabel(standing: StockCharacterTemplate['standing']) {
  if (standing === 'historical-literary') return 'Historical / literary';
  if (standing === 'ensemble-function') return 'Ensemble function';
  return 'Genre convention';
}

export default function CharacterTemplateBrowser(props: Props) {
  return props.mode === 'wizard'
    ? <WizardCharacterTemplateBrowser {...props}/>
    : <LegacyCharacterTemplateBrowser {...props}/>;
}

function wizardStartingPoint(template: StockCharacterTemplate): CharacterWizardStockStartingPoint {
  return {
    kind: 'stock',
    templateId: template.id,
    title: template.title,
    icon: template.icon,
    background: template.background,
    personality: template.personality,
    voice: template.voice,
  };
}

function WizardCharacterTemplateBrowser({ templates, categories = stockCharacterCategories, state, dispatch }: WizardProps) {
  const { browser } = state;
  const [detailOpen, setDetailOpen] = useState(() => Boolean(browser.selectedId));
  const [copiedUrl, setCopiedUrl] = useState('');
  const [copyErrorUrl, setCopyErrorUrl] = useState('');
  const resultsRef = useRef<HTMLDivElement>(null);
  const previewHeadingRef = useRef<HTMLHeadingElement>(null);
  const selectedResultRef = useRef<HTMLButtonElement>(null);
  const resultScrollTop = useRef(browser.scrollTop);
  const detailOpenRef = useRef(detailOpen);
  const previousDetailOpen = useRef(detailOpen);
  const focusResultsOnReturn = useRef(false);

  const normalizedQuery = normalize(browser.query);
  const matches = useMemo(() => templates.filter(template => {
    if (browser.category !== 'all' && template.category !== browser.category) return false;
    if (!normalizedQuery) return true;
    const searchable = normalize([
      template.title,
      ...template.aliases,
      ...template.historicalConnections,
      ...template.tags,
      template.summary,
    ].join(' '));
    return searchable.includes(normalizedQuery);
  }), [templates, browser.category, normalizedQuery]);
  const grouped = useMemo(() => categories.map(category => ({
    category,
    entries: matches.filter(template => template.category === category.id).sort((a, b) => a.title.localeCompare(b.title)),
  })).filter(group => group.entries.length > 0), [categories, matches]);
  const preview = templates.find(template => template.id === browser.selectedId) ?? null;
  const categoryTitle = (id: string) => categories.find(category => category.id === id)?.label ?? id;
  const narrow = () => window.matchMedia('(max-width: 900px)').matches;

  function saveScroll(scrollTop: number) {
    if (Math.abs(resultScrollTop.current - scrollTop) < 1) return;
    resultScrollTop.current = scrollTop;
    dispatch({ type: 'SET_BROWSER', patch: { scrollTop } });
  }

  useEffect(() => {
    if (narrow()) window.scrollTo(0, detailOpen ? 0 : browser.scrollTop);
    else if (resultsRef.current) resultsRef.current.scrollTop = browser.scrollTop;
    const savePageScroll = () => { if (!detailOpenRef.current) saveScroll(window.scrollY); };
    if (narrow()) window.addEventListener('scroll', savePageScroll, { passive: true });
    return () => window.removeEventListener('scroll', savePageScroll);
    // Restore once per catalog mount; later positions are captured by the scroll handlers.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const media = window.matchMedia('(max-width: 900px)');
    const onViewportChange = () => {
      if (media.matches && browser.selectedId) {
        detailOpenRef.current = true;
        setDetailOpen(true);
        window.scrollTo(0, 0);
      } else if (!media.matches && resultsRef.current) resultsRef.current.scrollTop = browser.scrollTop;
    };
    media.addEventListener('change', onViewportChange);
    return () => media.removeEventListener('change', onViewportChange);
  }, [browser.selectedId, browser.scrollTop]);

  useEffect(() => {
    detailOpenRef.current = detailOpen;
    if (previousDetailOpen.current === detailOpen) return;
    if (detailOpen && narrow()) previewHeadingRef.current?.focus({ preventScroll: true });
    if (!detailOpen && focusResultsOnReturn.current) {
      focusResultsOnReturn.current = false;
      selectedResultRef.current?.focus({ preventScroll: true });
    }
    previousDetailOpen.current = detailOpen;
  }, [detailOpen]);

  function resetSearchPosition() {
    resultScrollTop.current = 0;
    dispatch({ type: 'SET_BROWSER', patch: { scrollTop: 0 } });
    if (narrow()) window.scrollTo(0, 0);
    else if (resultsRef.current) resultsRef.current.scrollTop = 0;
  }

  function select(template: StockCharacterTemplate) {
    dispatch({ type: 'PREVIEW_STARTING_POINT', point: wizardStartingPoint(template) });
    if (narrow()) {
      const scrollTop = window.scrollY;
      resultScrollTop.current = scrollTop;
      dispatch({ type: 'SET_BROWSER', patch: { scrollTop } });
      detailOpenRef.current = true;
      setDetailOpen(true);
      window.scrollTo(0, 0);
    }
  }

  function returnToResults() {
    focusResultsOnReturn.current = true;
    detailOpenRef.current = false;
    setDetailOpen(false);
    if (narrow()) window.scrollTo(0, resultScrollTop.current);
  }

  function useSelectedType() {
    if (!preview || state.startingPointConfirmation) return;
    const point = wizardStartingPoint(preview);
    if (state.provisionalStartingPoint?.kind !== 'stock' || state.provisionalStartingPoint.templateId !== point.templateId) dispatch({ type: 'PREVIEW_STARTING_POINT', point });
    dispatch({ type: 'APPLY_PROVISIONAL_STARTING_POINT' });
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

  const replaceConfirmation = state.startingPointConfirmation;
  const titleId = 'character-wizard-stock-heading';
  return <section
    className="character-template-browser character-template-browser-wizard"
    aria-labelledby={titleId}
    data-testid="character-wizard-stock-browser"
    data-browser-view="catalog"
    data-detail-open={detailOpen}
  >
    <div className="character-template-heading">
      <div>
        <h2 id={titleId}>Stock character types</h2>
        <p>Browse a documented convention, review its suggestions, then choose what to copy.</p>
      </div>
      <span className="character-template-count">{templates.length} types</span>
    </div>

    <div className="character-template-controls">
      <label className="character-template-search">
        <span className="sr-only">Search stock types</span>
        <Search size={15} aria-hidden="true"/>
        <input
          type="search"
          aria-label="Search stock types"
          value={browser.query}
          onChange={event => {
            dispatch({ type: 'SET_BROWSER', patch: { query: event.target.value, scrollTop: 0 } });
            resetSearchPosition();
          }}
          onKeyDown={event => { if (event.key === 'Enter') event.preventDefault(); }}
          placeholder="Search names, aliases, tags"
        />
      </label>
      <div className="character-template-categories" role="group" aria-label="Stock type categories">
        <button type="button" aria-pressed={browser.category === 'all'} onClick={() => { dispatch({ type: 'SET_BROWSER', patch: { category: 'all', scrollTop: 0 } }); resetSearchPosition(); }}>All categories</button>
        {categories.map(category => <button type="button" key={category.id} aria-pressed={browser.category === category.id} onClick={() => { dispatch({ type: 'SET_BROWSER', patch: { category: category.id, scrollTop: 0 } }); resetSearchPosition(); }}><CharacterIcon icon={category.icon} size={14}/>{category.label}</button>)}
      </div>
    </div>

    <div className="character-template-browser-grid" data-detail-open={detailOpen}>
      <div className="character-template-results" role="group" aria-label="Stock type results" data-testid="character-wizard-stock-results" ref={resultsRef} onScroll={event => { if (!narrow()) saveScroll(event.currentTarget.scrollTop); }}>
        {matches.length ? grouped.map(({ category, entries }) => <section className="character-template-group" key={category.id} aria-label={category.label}>
          <h3>{category.label}</h3>
          <ul>{entries.map(template => <li key={template.id}>
            <button
              ref={template.id === browser.selectedId ? selectedResultRef : undefined}
              type="button"
              className={`character-template-result ${browser.selectedId === template.id ? 'is-selected' : ''}`}
              aria-label={`Preview ${template.title}`}
              aria-pressed={browser.selectedId === template.id}
              onClick={() => select(template)}
            >
              <span className="character-template-result-title"><CharacterIcon icon={template.icon} size={17}/><strong>{template.title}</strong></span>
              <small>{template.summary}</small>
            </button>
          </li>)}</ul>
        </section>) : <div className="character-template-no-results">
          <p>No stock types match these filters.</p>
          <button type="button" onClick={() => { dispatch({ type: 'SET_BROWSER', patch: { query: '', category: 'all', scrollTop: 0 } }); resetSearchPosition(); }}>Reset filters</button>
          <button type="button" className="primary" onClick={() => dispatch({ type: 'CHOOSE_BLANK' })}>Start blank</button>
        </div>}
      </div>

      <section className="character-template-preview" aria-label="Stock type preview" aria-live="polite">
        <button type="button" className="character-template-preview-back quiet" onClick={returnToResults}><ArrowLeft size={15}/>Back to stock type results</button>
        {preview ? <>
          <div className="character-template-preview-title">
            <CharacterIcon icon={preview.icon} size={22}/>
            <div><h3 ref={previewHeadingRef} tabIndex={-1}>{preview.title}</h3><span className="character-template-standing">{standingLabel(preview.standing)}</span></div>
          </div>
          <p className="character-template-summary">{preview.summary}</p>
          {preview.contextNote && <aside className="character-template-context"><strong>Context</strong><p>{preview.contextNote}</p></aside>}
          {!replaceConfirmation && <div className="character-template-preview-actions">
            <button type="button" className="primary" aria-label="Use this type and continue" onClick={useSelectedType}>Use this type and continue</button>
          </div>}
          <p className="character-template-category"><Tags size={13}/>{categoryTitle(preview.category)}</p>
          <details className="character-template-suggestions">
            <summary>Suggested profile</summary>
            <dl>
              <div><dt>Background</dt><dd>{preview.background}</dd></div>
              <div><dt>Personality</dt><dd>{preview.personality}</dd></div>
              <div><dt>Baseline voice</dt><dd>{preview.voice}</dd></div>
            </dl>
          </details>
          <details className="character-template-sources">
            <summary>About this type</summary>
            <div className="character-template-about">
              {!!preview.aliases.length && <p className="character-template-meta"><strong>Also listed as:</strong> {preview.aliases.join(', ')}</p>}
              {!!preview.historicalConnections.length && <p className="character-template-meta"><strong>Historical connections:</strong> {preview.historicalConnections.join(', ')}</p>}
              {!!preview.tags.length && <p className="character-template-meta"><strong>Tags:</strong> {preview.tags.join(' · ')}</p>}
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
            </div>
          </details>
        </> : <div className="character-template-empty-preview">
          <h3>Select a stock type</h3>
          <p>Choose a result to read its summary and suggestions.</p>
        </div>}
      </section>
    </div>
  </section>;
}

function LegacyCharacterTemplateBrowser({
  templates,
  categories = stockCharacterCategories,
  appliedTemplateId,
  fields,
  icon,
  disabled = false,
  onApply,
}: LegacyProps) {
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
