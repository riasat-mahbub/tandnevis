import { useEffect, useRef } from 'react';
import { ArrowLeft, ArrowRight, Check, Library, PencilLine } from 'lucide-react';
import { stockCharacterCategories, stockCharacterTemplates } from '../content/stock-characters';
import {
  characterWizardCanVisit,
  characterWizardHasPersonalEdits,
  characterWizardMissingDefaultGuidance,
  type CharacterWizardAction,
  type CharacterWizardState,
  type CharacterWizardStep,
} from '../services/character-wizard';
import type { Preset } from '../services/project';
import CharacterIcon from './CharacterIcon';
import CharacterIconPicker from './CharacterIconPicker';
import CharacterTemplateBrowser from './CharacterTemplateBrowser';
import './CharacterCreationWizard.css';

interface Props {
  state: CharacterWizardState;
  tones: readonly Preset[];
  emotions: readonly Preset[];
  creationReady: boolean;
  dispatch: (action: CharacterWizardAction) => void;
  onCreate: (state: CharacterWizardState) => void;
  onCancel: () => void;
}

const steps: readonly { id: CharacterWizardStep; label: string }[] = [
  { id: 'starting-point', label: 'Starting point' },
  { id: 'identity', label: 'Name and icon' },
  { id: 'details', label: 'Profile details' },
  { id: 'review', label: 'Review' },
];

function stepHeading(state: CharacterWizardState) {
  if (state.step === 'starting-point') return state.browser.view === 'catalog' ? 'Choose a stock type' : 'Choose a starting point';
  if (state.step === 'identity') return 'Name and icon';
  if (state.step === 'details') return 'Profile details';
  return 'Review character';
}

function stepInstruction(state: CharacterWizardState) {
  if (state.step === 'starting-point') return state.browser.view === 'catalog'
    ? 'Browse documented character types, then choose one to adapt.'
    : 'Start with a blank profile or adapt a documented stock type.';
  if (state.step === 'identity') return 'Give this character a name and choose an icon.';
  if (state.step === 'details') return 'Add any profile details you want to keep. Default tone and emotion are optional.';
  return 'Check the profile before adding it to this project.';
}

function profileLabel(field: 'background' | 'personality' | 'voice') {
  return field === 'voice' ? 'Baseline voice' : field[0].toUpperCase() + field.slice(1);
}

function profilePrompt(field: 'background' | 'personality' | 'voice') {
  if (field === 'background') return 'What shaped them, and what is happening in their life now?';
  if (field === 'personality') return 'What do they want, and how do they respond under pressure?';
  return 'How does this character usually sound in dialogue?';
}

function startingPointLabel(state: CharacterWizardState) {
  return state.appliedStartingPoint?.kind === 'stock'
    ? state.appliedStartingPoint.title
    : state.appliedStartingPoint?.kind === 'blank' ? 'Blank character' : 'Not chosen yet';
}

function presetDisplayName(preset: Preset) {
  return preset.name.trim().toLocaleLowerCase() === 'none' ? 'None (preset)' : preset.name;
}

function presetLabel(id: string, presets: readonly Preset[], type: 'tone' | 'emotion') {
  if (!id) return 'None';
  const preset = presets.find(item => item.id === id);
  if (!preset) return `Unavailable ${type} reference (${id})`;
  return `${presetDisplayName(preset)}${preset.archived ? ' (archived)' : ''}`;
}

export default function CharacterCreationWizard({ state, tones, emotions, creationReady, dispatch, onCreate, onCancel }: Props) {
  const headingRef = useRef<HTMLHeadingElement>(null);
  const nameRef = useRef<HTMLInputElement>(null);
  const defaultGuidanceRef = useRef<HTMLDetailsElement>(null);
  const defaultToneRef = useRef<HTMLSelectElement>(null);
  const focusDefaultGuidanceOnDetails = useRef(false);
  const nameError = state.nameError;
  const isCreating = state.submission.status === 'creating' || state.submission.status === 'recovering';
  const cancelLocked = state.submission.status !== 'idle';
  const missingGuidance = characterWizardMissingDefaultGuidance(state, { tones, emotions });

  useEffect(() => {
    if (state.step === 'details' && focusDefaultGuidanceOnDetails.current) {
      if (defaultGuidanceRef.current) defaultGuidanceRef.current.open = true;
      defaultToneRef.current?.focus({ preventScroll: true });
      focusDefaultGuidanceOnDetails.current = false;
      return;
    }
    const target = state.step === 'identity' ? nameRef.current : headingRef.current;
    target?.focus({ preventScroll: true });
  }, [state.step, state.browser.view]);

  function visitStep(step: CharacterWizardStep) {
    if (!characterWizardCanVisit(state, step) || step === state.step) return;
    dispatch({ type: 'GO_TO_STEP', step });
  }

  function requestCancel() {
    if (cancelLocked) return;
    const needsConfirmation = characterWizardHasPersonalEdits(state);
    dispatch({ type: 'REQUEST_CANCEL' });
    if (!needsConfirmation) onCancel();
  }

  function discardDraft() {
    dispatch({ type: 'DISCARD_DRAFT' });
    onCancel();
  }

  function createOrRetry() {
    if (state.step !== 'review' || isCreating || state.submission.status === 'succeeded') return;
    if (state.submission.status === 'idle' && (!creationReady || missingGuidance.length)) return;
    onCreate(state);
  }

  function editDefaultGuidance() {
    focusDefaultGuidanceOnDetails.current = true;
    dispatch({ type: 'EDIT_REVIEW_SECTION', section: 'details' });
  }

  const renderStartingPoint = () => state.browser.view === 'choices' ? <div className="wizard-starting-choices" data-testid="character-wizard-starting-choices" role="group" aria-label="Character starting points">
    <button type="button" className="wizard-starting-choice wizard-starting-choice-primary" aria-label="Start blank" onClick={() => dispatch({ type: 'CHOOSE_BLANK' })}>
      <span className="wizard-starting-choice-copy"><strong>Start blank</strong><small>Begin with your own name, icon, and profile details.</small></span>
      <PencilLine size={18} aria-hidden="true"/>
    </button>
    <button type="button" className="wizard-starting-choice" aria-label="Choose a stock type" onClick={() => dispatch({ type: 'OPEN_CATALOG' })}>
      <span className="wizard-starting-choice-copy"><strong>Choose a stock type</strong><small>Browse a documented character convention and adapt its suggestions.</small></span>
      <Library size={18} aria-hidden="true"/>
    </button>
  </div> : <CharacterTemplateBrowser mode="wizard" templates={stockCharacterTemplates} categories={stockCharacterCategories} state={state} dispatch={dispatch}/>;

  function declineStartingPointChange() {
    dispatch({ type: 'CONFIRM_STARTING_POINT_CHANGE', confirmed: false });
    dispatch({ type: 'SET_BROWSER', patch: { selectedId: state.appliedStartingPoint?.kind === 'stock' ? state.appliedStartingPoint.templateId : null } });
  }

  function renderStartingPointConfirmation() {
    const confirmation = state.startingPointConfirmation;
    if (!confirmation) return null;
    const fieldLabels = confirmation.fields.map(field => field === 'voice' ? 'baseline voice' : field).join(', ');
    const target = confirmation.target.kind === 'stock' ? confirmation.target.title : 'blank fields';
    return <section className="wizard-starting-point-confirm" role="alert" aria-labelledby="character-wizard-starting-point-confirm-heading">
      <div>
        <h2 id="character-wizard-starting-point-confirm-heading">Replace {fieldLabels}?</h2>
        <p>Using {target} replaces {fieldLabels}. Your name stays. An icon you chose stays; an untouched icon follows the starting point.</p>
      </div>
      <div className="wizard-starting-point-confirm-actions">
        <button type="button" className="primary" onClick={() => dispatch({ type: 'CONFIRM_STARTING_POINT_CHANGE', confirmed: true })}>Replace profile fields</button>
        <button type="button" onClick={declineStartingPointChange}>Keep current fields</button>
      </div>
    </section>;
  }

  const renderIdentity = () => <div className="wizard-identity-fields">
    <div className="wizard-name-field">
      <label htmlFor="character-wizard-name">Character name</label>
      <input
        ref={nameRef}
        id="character-wizard-name"
        value={state.draft.name}
        maxLength={250}
        autoComplete="off"
        aria-invalid={!!nameError}
        aria-describedby={nameError ? 'character-wizard-name-error' : undefined}
        onChange={event => dispatch({ type: 'SET_FIELD', field: 'name', value: event.target.value })}
      />
      {nameError && <p className="wizard-name-error" id="character-wizard-name-error" role="alert">{nameError}</p>}
    </div>

    <CharacterIconPicker
      value={state.draft.icon}
      onChange={icon => icon ? dispatch({ type: 'SET_ICON', icon }) : dispatch({ type: 'RESET_ICON' })}
    />

    <div className="wizard-starting-point-summary">
      <p>Starting with <strong>{startingPointLabel(state)}</strong></p>
      <button type="button" className="quiet" onClick={() => dispatch({ type: 'OPEN_CATALOG' })}>Change starting point</button>
    </div>
  </div>;

  const renderDetails = () => <div className="wizard-profile-fields">
    {state.appliedStartingPoint?.kind === 'stock' && <p className="wizard-suggestion-note">Suggested profile from <strong>{state.appliedStartingPoint.title}</strong>. Edit any field to make it your own.</p>}
    {(['background', 'personality', 'voice'] as const).map(field => <div className="wizard-profile-field" key={field}>
      <label htmlFor={`character-wizard-${field}`}>{profileLabel(field)}</label>
      <small id={`character-wizard-${field}-hint`}>{profilePrompt(field)}</small>
      <textarea
        id={`character-wizard-${field}`}
        rows={field === 'background' ? 5 : 4}
        value={state.draft[field]}
        placeholder={profilePrompt(field)}
        aria-describedby={`character-wizard-${field}-hint`}
        onChange={event => dispatch({ type: 'SET_FIELD', field, value: event.target.value })}
      />
    </div>)}
    <details ref={defaultGuidanceRef} className="wizard-default-guidance" data-testid="character-wizard-default-guidance">
      <summary>
        <span>Optional default guidance</span>
        <small>Choose a project tone or emotion to suggest when this character is used.</small>
      </summary>
      <div className="wizard-default-guidance-fields">
        {(['tone', 'emotion'] as const).map(type => {
          const field = type === 'tone' ? 'defaultToneId' : 'defaultEmotionId';
          const value = state.draft[field];
          const presets = type === 'tone' ? tones : emotions;
          const selected = presets.find(item => item.id === value);
          const missing = !!value && !selected;
          const selectable = presets.filter(item => !item.archived || item.id === value);
          const noActive = selectable.length === 0;
          return <div className="wizard-default-guidance-field" key={type}>
            <label htmlFor={`character-wizard-default-${type}`}>Default {type}</label>
            <select
              id={`character-wizard-default-${type}`}
              ref={type === 'tone' ? defaultToneRef : undefined}
              data-testid={`character-wizard-default-${type}`}
              value={value}
              aria-describedby={`character-wizard-default-${type}-note`}
              onChange={event => dispatch({ type: 'SET_DEFAULT_GUIDANCE', field, value: event.target.value })}
            >
              <option value="">None</option>
              {missing && <option value={value}>Unavailable saved reference ({value})</option>}
              {selectable.map(preset => <option key={preset.id} value={preset.id}>{presetDisplayName(preset)}{preset.archived ? ' (archived)' : ''}</option>)}
            </select>
            <div id={`character-wizard-default-${type}-note`} className="wizard-default-guidance-note" data-testid={`character-wizard-default-${type}-preview`}>
              {selected ? <>
                <span><strong>Meaning:</strong> {selected.meaning || 'No meaning supplied.'}</span>
                <span><strong>{type === 'tone' ? 'Writing guidance' : 'Expression guidance'}:</strong> {selected.guidance || 'No guidance supplied.'}</span>
              </> : missing ? <span role="alert">This saved reference is no longer in the project. Choose None or a current {type}.</span> : noActive ? <span data-testid={`character-wizard-no-${type}-options`}>No active {type}s in this project yet. None is still a valid choice. Add a {type} in the {type === 'tone' ? 'Tones' : 'Emotions'} library to make another option available.</span> : type === 'tone' ? <span>None leaves this unset. Neutral is a separate tone preset.</span> : <span>None leaves this unset; emotion defaults are optional scene guidance.</span>}
            </div>
          </div>;
        })}
      </div>
    </details>
  </div>;

  const renderReviewSection = (field: 'background' | 'personality' | 'voice') => <section className="wizard-review-section" aria-labelledby={`character-wizard-review-${field}`} key={field}>
    <div className="wizard-review-section-heading">
      <h2 id={`character-wizard-review-${field}`}>{profileLabel(field)}</h2>
      <button type="button" className="quiet" disabled={cancelLocked} onClick={() => dispatch({ type: 'EDIT_REVIEW_SECTION', section: 'details' })}>Edit {field === 'voice' ? 'baseline voice' : field}</button>
    </div>
    <p className={state.draft[field] ? 'wizard-review-prose' : 'wizard-review-empty'}>{state.draft[field].trim() || 'Not added'}</p>
  </section>;

  const renderReview = () => <div className="wizard-review">
    <p className="wizard-review-save-note">Create adds this character to the project. Use project Save to write project changes to disk.</p>
    <section className="wizard-review-identity" aria-labelledby="character-wizard-review-name">
      <span className="wizard-review-icon"><CharacterIcon icon={state.draft.icon} size={24}/></span>
      <div className="wizard-review-name">
        <span className="wizard-review-label">Character</span>
        <h2 id="character-wizard-review-name">{state.draft.name.trim() || 'Unnamed character'}</h2>
      </div>
      <button type="button" className="quiet" disabled={cancelLocked} onClick={() => dispatch({ type: 'EDIT_REVIEW_SECTION', section: 'identity' })}>Edit name and icon</button>
    </section>
    <div className="wizard-review-profile" aria-label="Profile details">
      {(['background', 'personality', 'voice'] as const).map(renderReviewSection)}
    </div>
    <section className="wizard-review-guidance" aria-labelledby="character-wizard-review-guidance-heading" data-testid="character-wizard-review-guidance">
      <div className="wizard-review-section-heading">
        <h2 id="character-wizard-review-guidance-heading">Default guidance</h2>
        <button type="button" className="quiet" data-testid="character-wizard-edit-default-guidance" disabled={cancelLocked} onClick={editDefaultGuidance}>Edit default guidance</button>
      </div>
      <dl>
        <div><dt>Default tone</dt><dd data-testid="character-wizard-review-default-tone">{presetLabel(state.draft.defaultToneId, tones, 'tone')}</dd></div>
        <div><dt>Default emotion</dt><dd data-testid="character-wizard-review-default-emotion">{presetLabel(state.draft.defaultEmotionId, emotions, 'emotion')}</dd></div>
      </dl>
      {missingGuidance.length > 0 && state.submission.status === 'idle' && <p className="wizard-default-guidance-error" role="alert">A selected default is no longer in this project. Edit default guidance to choose None or a current preset before creating this character.</p>}
      {!creationReady && state.submission.status === 'idle' && <p className="wizard-create-pending" role="status" data-testid="character-wizard-create-pending">Project changes are still in progress. Creation will be available when they finish.</p>}
    </section>
  </div>;

  function renderFooterAction() {
    if (state.step === 'identity') return <>
      <button type="button" className="quiet" onClick={() => dispatch({ type: 'REVIEW_NOW' })}>Review now</button>
      <button type="button" className="primary" onClick={() => dispatch({ type: 'NEXT' })}>Next: Profile details<ArrowRight size={15}/></button>
    </>;
    if (state.step === 'details') return <button type="button" className="primary" onClick={() => dispatch({ type: 'NEXT' })}>Next: Review<ArrowRight size={15}/></button>;
    if (state.step !== 'review') return null;
    if (state.submission.status === 'succeeded') return <p className="wizard-submission-status" role="status">Character created. Returning to your writing.</p>;
    const label = state.submission.status === 'creating' ? 'Creating character…'
      : state.submission.status === 'recovering' ? 'Checking creation status…'
      : state.submission.status === 'failed' ? 'Retry character creation'
      : state.submission.status === 'conflict' ? 'Try recovery again'
      : 'Create character';
    return <button type="button" className="primary" disabled={isCreating || state.submission.status === 'idle' && (!creationReady || missingGuidance.length > 0)} onClick={createOrRetry}>{label}</button>;
  }

  const heading = stepHeading(state);
  return <section className="character-creation-wizard" aria-labelledby="character-wizard-heading" data-testid="character-creation-wizard" data-wizard-step={state.step} data-browser-view={state.step === 'starting-point' ? state.browser.view : undefined}>
    <header className="wizard-header">
      <nav className="wizard-step-nav" aria-label="Character creation steps" data-testid="character-wizard-step-indicator">
        <ol>{steps.map(step => {
          const current = state.step === step.id;
          const visited = characterWizardCanVisit(state, step.id);
          return <li key={step.id}>
            <button
              type="button"
              className={current ? 'is-current' : visited ? 'is-complete' : ''}
              disabled={!visited || current || cancelLocked}
              aria-current={current ? 'step' : undefined}
              aria-label={step.label}
              onClick={() => visitStep(step.id)}
            >{visited && !current ? <Check size={14} aria-hidden="true"/> : <span className="wizard-step-marker" aria-hidden="true"/>}<span>{step.label}</span></button>
          </li>;
        })}</ol>
      </nav>

      <div className="wizard-title">
        <h1 id="character-wizard-heading" ref={headingRef} tabIndex={-1}>{heading}</h1>
        <p>{stepInstruction(state)}</p>
      </div>
    </header>

    <div className={`wizard-content wizard-content-${state.step}`} data-testid="character-wizard-content">
      {state.step === 'starting-point' && renderStartingPoint()}
      {state.step === 'identity' && renderIdentity()}
      {state.step === 'details' && renderDetails()}
      {state.step === 'review' && renderReview()}
      {state.step === 'starting-point' && renderStartingPointConfirmation()}

      {state.step === 'review' && (state.submission.status === 'failed' || state.submission.status === 'conflict') && <div className="wizard-submission-error" role="alert">
        <strong>{state.submission.status === 'conflict' ? 'The project changed during creation.' : 'Character creation did not finish.'}</strong>
        <p>{state.submission.error || 'Your draft is still here. Review it and retry when ready.'}</p>
      </div>}
      {state.step === 'review' && state.submission.status === 'recovering' && <p className="wizard-submission-status" role="status">Checking whether this character was already created…</p>}

      {state.cancel.status === 'confirm' && <section className="wizard-discard-confirm" role="alert" aria-labelledby="character-wizard-discard-heading">
        <div><h2 id="character-wizard-discard-heading">Discard this character draft?</h2><p>Your name, icon, profile details, and default guidance will be lost.</p></div>
        <div className="wizard-discard-actions"><button type="button" className="primary" onClick={discardDraft}>Discard draft</button><button type="button" onClick={() => dispatch({ type: 'KEEP_WORKING' })}>Keep working</button></div>
      </section>}
    </div>

    <footer className="wizard-footer" data-testid="character-wizard-footer">
      <div className="wizard-footer-navigation">
        {state.step !== 'starting-point' && <button type="button" onClick={() => dispatch({ type: 'BACK' })} disabled={cancelLocked}><ArrowLeft size={15}/>Back</button>}
        {state.step === 'starting-point' && state.browser.view === 'catalog' && <button type="button" onClick={() => dispatch({ type: 'SHOW_STARTING_CHOICES' })}><ArrowLeft size={15}/>Back to starting choices</button>}
        <button type="button" className="quiet wizard-cancel" data-testid="character-wizard-cancel" aria-label="Cancel creation" disabled={cancelLocked} onClick={requestCancel}>Cancel creation</button>
      </div>
      <div className="wizard-footer-primary">{renderFooterAction()}</div>
    </footer>
  </section>;
}
