import { useEffect, useRef } from 'react';
import { ArrowLeft, ArrowRight, Check, Library, PencilLine } from 'lucide-react';
import {
  characterWizardCanVisit,
  characterWizardHasPersonalEdits,
  type CharacterWizardAction,
  type CharacterWizardState,
  type CharacterWizardStep,
} from '../services/character-wizard';
import CharacterIcon from './CharacterIcon';
import CharacterIconPicker from './CharacterIconPicker';
import './CharacterCreationWizard.css';

interface Props {
  state: CharacterWizardState;
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
  if (state.step === 'details') return 'Add any background, personality, and voice details you want to keep.';
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

export default function CharacterCreationWizard({ state, dispatch, onCreate, onCancel }: Props) {
  const headingRef = useRef<HTMLHeadingElement>(null);
  const nameRef = useRef<HTMLInputElement>(null);
  const nameError = state.nameError;
  const isCreating = state.submission.status === 'creating' || state.submission.status === 'recovering';
  const cancelLocked = state.submission.status !== 'idle';

  useEffect(() => {
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
    onCreate(state);
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
  </div> : <section className="wizard-stock-placeholder" data-testid="character-wizard-stock-browser" aria-label="Choose a stock type">
    <h2>Choose a stock type</h2>
    <p>The stock type browser will appear here. Your current draft stays unchanged while you browse.</p>
    <button type="button" className="quiet" onClick={() => dispatch({ type: 'SHOW_STARTING_CHOICES' })}><ArrowLeft size={15}/>Back to starting choices</button>
  </section>;

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
  </div>;

  const renderReviewSection = (field: 'background' | 'personality' | 'voice') => <section className="wizard-review-section" aria-labelledby={`character-wizard-review-${field}`} key={field}>
    <div className="wizard-review-section-heading">
      <h2 id={`character-wizard-review-${field}`}>{profileLabel(field)}</h2>
      <button type="button" className="quiet" disabled={cancelLocked} onClick={() => dispatch({ type: 'EDIT_REVIEW_SECTION', section: 'details' })}>Edit {field === 'voice' ? 'baseline voice' : field}</button>
    </div>
    <p className={state.draft[field] ? 'wizard-review-prose' : 'wizard-review-empty'}>{state.draft[field].trim() || 'Not added'}</p>
  </section>;

  const renderReview = () => <div className="wizard-review">
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
    return <button type="button" className="primary" disabled={isCreating} onClick={createOrRetry}>{label}</button>;
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

      {state.step === 'review' && (state.submission.status === 'failed' || state.submission.status === 'conflict') && <div className="wizard-submission-error" role="alert">
        <strong>{state.submission.status === 'conflict' ? 'The project changed during creation.' : 'Character creation did not finish.'}</strong>
        <p>{state.submission.error || 'Your draft is still here. Review it and retry when ready.'}</p>
      </div>}
      {state.step === 'review' && state.submission.status === 'recovering' && <p className="wizard-submission-status" role="status">Checking whether this character was already created…</p>}

      {state.cancel.status === 'confirm' && <section className="wizard-discard-confirm" role="alert" aria-labelledby="character-wizard-discard-heading">
        <div><h2 id="character-wizard-discard-heading">Discard this character draft?</h2><p>Your name, icon, and profile details will be lost.</p></div>
        <div className="wizard-discard-actions"><button type="button" className="primary" onClick={discardDraft}>Discard draft</button><button type="button" onClick={() => dispatch({ type: 'KEEP_WORKING' })}>Keep working</button></div>
      </section>}
    </div>

    <footer className="wizard-footer" data-testid="character-wizard-footer">
      <div className="wizard-footer-navigation">
        {state.step !== 'starting-point' && <button type="button" onClick={() => dispatch({ type: 'BACK' })} disabled={cancelLocked}><ArrowLeft size={15}/>Back</button>}
        <button type="button" className="quiet wizard-cancel" data-testid="character-wizard-cancel" aria-label="Cancel creation" disabled={cancelLocked} onClick={requestCancel}>Cancel creation</button>
      </div>
      <div className="wizard-footer-primary">{renderFooterAction()}</div>
    </footer>
  </section>;
}
