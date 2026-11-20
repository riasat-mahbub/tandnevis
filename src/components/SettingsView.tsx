import { ArrowLeft, Check, ExternalLink, HardDrive, KeyRound, Moon, Sun, Laptop, Sparkles } from 'lucide-react';
import type { ApplicationRuntimeInfo } from '../services/runtime';

export type ThemePreference = 'system' | 'light' | 'dark';
export type ChatGPTConnectionStatus = 'not-configured' | 'checking' | 'connected' | 'ready' | 'needs-plan-permission' | 'reconnect-required' | 'unavailable' | 'error';

export interface ChatGPTModelOption { id: string; name: string }
/** UI contract for the native ChatGPT service; it never contains an access or refresh token. */
export interface ChatGPTSettingsState {
  status: ChatGPTConnectionStatus;
  accountLabel?: string;
  models: ChatGPTModelOption[];
  selectedModel?: string;
  defaultGuidance: string;
  message?: string;
  firstUsePending?: boolean;
}

interface Props {
  autosave: boolean;
  onAutosaveChange: (enabled: boolean) => void;
  appearance: ThemePreference;
  onAppearanceChange: (preference: ThemePreference) => void;
  calm: boolean;
  onCalmChange: (calm: boolean) => void;
  chatGPT: ChatGPTSettingsState;
  runtimeInfo: ApplicationRuntimeInfo | null;
  runtimeError: string;
  runtimeLoading: boolean;
  desktopRuntime: boolean;
  onRetryRuntime: () => void;
  onConnect?: () => void;
  onReconnect?: () => void;
  onTestConnection?: () => void;
  onAcknowledgeUsage?: () => void;
  onDisconnect?: () => void;
  onModelChange?: (model: string) => void;
  onGuidanceChange?: (guidance: string) => void;
  onBack: () => void;
}

const appearanceOptions: { value: ThemePreference; label: string; description: string; Icon: typeof Sun }[] = [
  { value: 'light', label: 'Platinum', description: 'Bright writing desk', Icon: Sun },
  { value: 'system', label: 'System', description: 'Follow your device', Icon: Laptop },
  { value: 'dark', label: 'Dark', description: 'Low-light writing', Icon: Moon },
];

function statusCopy(status: ChatGPTConnectionStatus) {
  if (status === 'ready') return ['Ready to write', 'Your ChatGPT account and selected model passed the connection test.'];
  if (status === 'connected') return ['Connected', 'Choose a model and test it before generating a scene.'];
  if (status === 'needs-plan-permission') return ['Plan access needed', 'Reconnect and allow this app to use eligible ChatGPT plan access.'];
  if (status === 'checking') return ['Checking connection', 'Waiting for ChatGPT to confirm this account and model.'];
  if (status === 'reconnect-required') return ['Reconnect required', 'Sign in again in Settings before generating another scene.'];
  if (status === 'error') return ['Needs attention', 'The connection could not be verified. Your story is still available offline.'];
  if (status === 'unavailable') return ['Unavailable', 'ChatGPT sign-in is not available in this build.'];
  return ['Not connected', 'Connect a ChatGPT account before generating a scene.'];
}

export default function SettingsView({ autosave, onAutosaveChange, appearance, onAppearanceChange, calm, onCalmChange, chatGPT, runtimeInfo, runtimeError, runtimeLoading, desktopRuntime, onRetryRuntime, onConnect, onReconnect, onTestConnection, onAcknowledgeUsage, onDisconnect, onModelChange, onGuidanceChange, onBack }: Props) {
  const [statusLabel, statusDescription] = statusCopy(chatGPT.status);
  const canConfigure = chatGPT.status !== 'checking' && chatGPT.status !== 'unavailable';
  const needsExistingRegistration = chatGPT.status === 'reconnect-required' || chatGPT.status === 'needs-plan-permission';
  const primaryAction = needsExistingRegistration ? onReconnect : onConnect;
  const primaryLabel = chatGPT.status === 'needs-plan-permission' ? 'Enable ChatGPT plan access' : needsExistingRegistration ? 'Reconnect with ChatGPT' : 'Continue with ChatGPT';
  const canManageConnection = chatGPT.status === 'connected' || chatGPT.status === 'ready';

  return <main id="settings-page" className="settings-page" aria-labelledby="settings-title">
    <div className="settings-heading">
      <button className="quiet settings-back" type="button" onClick={onBack}><ArrowLeft size={15}/>Back to writing</button>
      <div className="settings-title-row"><div><span className="eyebrow">Your writing desk</span><h1 id="settings-title">Settings</h1><p>Set up your workspace once. Your stories remain in their own project files.</p></div><div className="settings-stamp" aria-hidden="true"><Sparkles size={25}/><span>Make it yours</span></div></div>
    </div>

    <div className="settings-grid">
      <section className="settings-card connection-card" aria-labelledby="chatgpt-heading">
        <div className="settings-card-heading"><span className="settings-kicker"><KeyRound size={14}/>Connection</span><span className={`connection-state state-${chatGPT.status}`} role="status"><i aria-hidden="true"/>{statusLabel}</span></div>
        <h2 id="chatgpt-heading">Write with ChatGPT</h2>
        <p>{statusDescription}</p>
        <p className="usage-disclosure">Scene drafts use eligible ChatGPT plan usage and follow your account’s limits. Shorthand Writer does not switch to API billing.</p>
        {chatGPT.accountLabel && canManageConnection && <p className="account-label">Signed in as <strong>{chatGPT.accountLabel}</strong></p>}
        {(!canManageConnection || chatGPT.status === 'reconnect-required' || chatGPT.status === 'needs-plan-permission') && <button className="primary connect-button" type="button" disabled={!canConfigure || !primaryAction} onClick={primaryAction}>{primaryLabel}<ExternalLink size={14}/></button>}
        {chatGPT.status === 'not-configured' && !primaryAction && <small className="settings-note">Native ChatGPT sign-in setup is being added. Scene generation stays disabled until you complete and test the connection here.</small>}
        {chatGPT.status === 'unavailable' && <small className="settings-note">This build cannot connect yet. You can keep writing while connection setup is added.</small>}
        {chatGPT.message && <p className="settings-feedback" role="alert">{chatGPT.message}</p>}
        {canManageConnection && <div className="connection-controls">
          <label>Writing model<select value={chatGPT.selectedModel ?? ''} disabled={!onModelChange || !chatGPT.models.length} onChange={e => onModelChange?.(e.target.value)}><option value="" disabled>Choose a verified model</option>{chatGPT.models.map(model => <option value={model.id} key={model.id}>{model.name}</option>)}</select><small>Only models verified for this account appear here.</small></label>
          <label>Default writing guidance<textarea rows={3} value={chatGPT.defaultGuidance} disabled={!onGuidanceChange} onChange={e => onGuidanceChange?.(e.target.value)} placeholder="Optional style notes for every scene"/></label>
          <div className="connection-actions">{onTestConnection && <button type="button" disabled={!chatGPT.selectedModel} onClick={onTestConnection}>Test connection</button>}{onReconnect && <button type="button" onClick={onReconnect}>Reconnect</button>}{onDisconnect && <button className="danger" type="button" onClick={onDisconnect}>Disconnect</button>}</div>
          <a className="usage-link" href="https://chatgpt.com/settings/usage" target="_blank" rel="noreferrer">Manage ChatGPT usage <ExternalLink size={12}/></a>
        </div>}
        {chatGPT.status === 'reconnect-required' && onReconnect && <small className="settings-note">Your saved writing is unchanged. Reconnect to resume generation.</small>}
      </section>

      <section className="settings-card appearance-card" aria-labelledby="appearance-heading">
        <span className="settings-kicker"><Sun size={14}/>Appearance</span><h2 id="appearance-heading">A desk that feels right</h2><p>Harvest Orange brings a little warmth. Platinum and Iron Grey keep the pages calm and readable.</p>
        <fieldset className="appearance-options"><legend className="sr-only">Color theme</legend>{appearanceOptions.map(({ value, label, description, Icon }) => <label className="appearance-option" key={value} data-selected={appearance === value}>
          <input type="radio" name="appearance" value={value} checked={appearance === value} onChange={() => onAppearanceChange(value)}/><span className="appearance-option-icon"><Icon size={17}/></span><span className="appearance-option-copy"><strong>{label}</strong><small>{description}</small></span>{appearance === value && <Check className="appearance-check" size={15}/>}
        </label>)}</fieldset>
        <label className="calm-setting"><span><strong>Calm appearance</strong><small>Keep the layout; remove the playful angles.</small></span><input type="checkbox" checked={calm} onChange={e => onCalmChange(e.target.checked)}/></label>
        <label className="calm-setting"><span><strong>Autosave</strong><small>{autosave ? 'Save project changes automatically.' : 'Manual save: use Save or Ctrl+S. Unsaved changes stay in this session.'}</small></span><input type="checkbox" checked={autosave} onChange={e => onAutosaveChange(e.target.checked)}/></label>
      </section>

      <aside className="settings-aside"><span className="settings-aside-mark" aria-hidden="true">✦</span><h2>Your story, your pace.</h2><p>Connect only when you want a draft. Scene generation will use the beats and character references in the scene you choose.</p><div className="palette-swatches" aria-label="Harvest Orange, Platinum, and Iron Grey palette"><span title="Harvest Orange"/><span title="Platinum"/><span title="Iron Grey"/></div></aside>
      <section className="settings-card runtime-card" aria-labelledby="runtime-heading">
        <span className="settings-kicker"><HardDrive size={14}/>Local app data</span><h2 id="runtime-heading">Portable storage</h2>
        <p>Stories stay in the separate <code>.shorthand</code> project files you choose. This folder holds app settings, recovery data, and the WebView profile.</p>
        {!desktopRuntime && <p className="settings-note">Open Shorthand Writer on desktop to see its data folder and runtime details.</p>}
        {desktopRuntime && runtimeLoading && <p className="settings-note" role="status">Reading local app details...</p>}
        {desktopRuntime && runtimeError && <p className="settings-feedback" role="alert">{runtimeError} <button type="button" onClick={onRetryRuntime}>Retry</button></p>}
        {runtimeInfo && <>
          <dl className="runtime-facts"><div><dt>Mode</dt><dd>{runtimeInfo.portable ? 'Portable folder' : 'Standard app data'}</dd></div><div><dt>App version</dt><dd>{runtimeInfo.applicationVersion}</dd></div><div><dt>WebView2</dt><dd>{runtimeInfo.webview2Required ? runtimeInfo.webview2RuntimeActive ? 'Active' : 'Not detected' : 'Not required'}</dd></div></dl>
          <div className="runtime-folder"><span>App data folder</span><code className="runtime-path">{runtimeInfo.dataDirectory}</code></div>
        </>}
      </section>
    </div>
    {chatGPT.firstUsePending && <div className="usage-confirmation-backdrop"><section className="usage-confirmation" role="dialog" aria-modal="true" aria-labelledby="usage-confirmation-title"><span className="settings-kicker"><KeyRound size={14}/>ChatGPT plan usage</span><h2 id="usage-confirmation-title">You’re using your ChatGPT plan</h2><p>Scene generation uses the plan access you just enabled. Usage limits and availability are managed by your ChatGPT account.</p><button className="primary" type="button" autoFocus disabled={!onAcknowledgeUsage} onClick={onAcknowledgeUsage}>Got it</button></section></div>}
  </main>;
}
