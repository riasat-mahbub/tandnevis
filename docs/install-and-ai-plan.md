# Installation and connected AI generation

Status: proposed next tranche, 19 November 2026. This is a development plan, not implemented functionality. It extends the [Tauri implementation plan](tauri-implementation-plan.md), [interface plan](interface-plan.md), and [delivery ledger](implementation-progress.md). Preserve the existing Story/Scene views and SQLite authoring workflows.

## Intended experience

Install Shorthand Writer, open a story, and click **Generate scene**. On first use, choose an AI connection and complete that service's supported sign-in. Later generations use the selected connection without asking the writer to log in again unless authorization expires. The writer sees the active account, model, and billing route before sending anything.

The installed core app requires neither Rust nor Node. Authoring remains available without an AI connection. Provider helpers are optional components with their own installation/authentication status.

## 1. Installation scripts

### End-user installation

Use Tauri's existing per-user NSIS configuration as the actual installer. Add `scripts/install.ps1` as a convenient launcher around a built installer; do not implement a second application-copying/update mechanism. Tauri documents Windows packaging and WebView2 installation modes in its [Windows installer guide](https://v2.tauri.app/distribute/windows-installer/).

Proposed interface, to be implemented:

```powershell
# Install a locally built or downloaded release; default opens the installer UI.
.\scripts\install.ps1 -InstallerPath '.\Shorthand-Writer-setup.exe'

# Explicit unattended mode for automation.
.\scripts\install.ps1 -InstallerPath '.\Shorthand-Writer-setup.exe' -Silent

# Download mode follows only after an actual trusted release channel exists.
.\scripts\install.ps1 -Version '<published-version>'
```

The script will:

1. Check supported Windows version/architecture and reject unsupported builds with a concrete message. Initial target: Windows 11 x64. Report the installed app version and requested version; default to the same-user install scope.
2. Prefer an explicit local installer. Download mode requires a configured HTTPS release origin, versioned release manifest, artifact size, architecture, SHA-256 digest, and trusted authenticity verification. Do not invent a GitHub release URL: this repository currently has no configured release host or signing identity. Local development artifacts are identified as unsigned development builds; published mode must fail closed when authenticity cannot be verified.
3. Validate the local file as an expected installer artifact. Resolve paths before execution; downloaded artifacts use a unique staging directory and an atomic final rename. Reject partial downloads and mismatched hashes/signatures. A checksum fetched beside an installer is corruption detection, not independent proof of publisher identity.
4. Show the existing application's install/upgrade flow. Offer closing a running app after it saves; do not terminate it and risk pending edits. Confirm NSIS silent switches and exit-code/reboot behavior against the generated installer before enabling `-Silent`.
5. Let the NSIS/WebView2 prerequisite path manage WebView2. A connected installer may download its runtime; an offline distribution must carry the supported offline runtime installer. No surprise global installation of Node, Rust, Python, or provider CLIs.
6. Wait for the installer, propagate failure/reboot results, and verify the installed executable/version. Offer launch after success; silent mode does not open a UI. Do not promise application readiness just because the installer process started.
7. Remove only the script's own validated temporary files. Log versions, step outcomes, and error codes; exclude credentials and manuscript content.

Install/upgrade owns application binaries and shortcuts. User-selected `.shorthand` projects stay in their chosen folders. App settings/recovery data belong under Tauri's per-user app-data directory. Uninstall preserves projects; clearing app-owned connections/settings is a separately explained option. Ordinary upgrade must preserve connection identities and not sign users out unnecessarily. Project-format migration occurs on project open with a recoverable backup, independently of installer replacement.

Ship an actual offline installation option after its runtime packaging is tested. A script cannot make an installer that depends on downloading WebView2 work offline simply by adding an `-Offline` flag.

### Developer setup

Add `scripts/setup-dev.ps1` alongside the end-user script:

- Default to inspecting Node/npm, Rust/MSVC, Windows SDK, and WebView2; report exact missing components and official setup links. Support an explicit dependency-install option for supported packages, with no system-wide execution-policy changes or command-string evaluation.
- Use `npm ci` and committed lockfiles. Reuse `tools/desktop.mjs` and its existing local-toolchain detection. Run the prerequisite check and renderer build; optional test/native-build flags perform the documented checks.
- Keep downloaded toolchains and build caches under documented developer locations. Do not require provider login, API credentials, a private manuscript, or an AI subscription to build/test the app.

### Installation acceptance

Test clean Windows without developer runtimes; an existing WebView2 runtime; missing WebView2 with network; offline package installation; cancelled/failed downloads; corrupt/wrong-architecture artifacts; paths with spaces/Unicode; install/reinstall/upgrade; a running app with pending edits; and uninstall preserving projects. Check both visible and silent installer flows. A repeat run is safe and never resets story data. Signed public distribution and updater hosting remain release gates, not assumptions.

## 2. AI connections and subscriptions

An AI connection is global application configuration. The selected provider/model may be remembered per project, but authentication material never enters the project database or Markdown exports. Separate the inference service, account identity, connection mechanism, and usage route; OpenCode is also a client/gateway, not one universal model subscription.

Current documentation was checked on 19 November 2026. Recheck it during each adapter spike and record tested versions/account types; a documentation-supported route is not an integration test.

| Connection shown to the writer | Planned mechanism | What must be true before enabling it |
|---|---|---|
| **ChatGPT plan** | Native Sign in with ChatGPT; Rust calls the documented Responses endpoint with the granted OAuth access token | Validate the app's distribution/eligibility for the documented open-source/locally hosted flow, granted plan-use permission, account model access, and a completed request |
| **Gemini account** | Official Gemini CLI helper signs in with Google; the app drives its documented structured headless output using that cached authorization | Qualify Windows helper packaging, account entitlement, credential protection, text-only permissions, streaming, cancellation, and prose use |
| **OpenCode account / Go** | Supported Console key or an explicitly configured OpenCode bridge; identify the actual upstream provider and usage source | Qualify the particular service and permitted workload. Go is documented for coding-agent requests; do not claim this story app is eligible without confirmation |
| **API key** (advanced) | Direct OpenAI, Gemini, or supported OpenCode API adapter | User explicitly selects this separately metered route and supplies its own credential; no silent substitution when subscription usage fails |
| **More connections** | Extend the same adapter contract after a documented authentication/use-case check | No generic promise that every consumer subscription grants third-party inference access |

OpenAI now documents an optional ChatGPT-plan permission for eligible Responses requests from open-source/locally hosted apps. This does not grant access to the user's existing ChatGPT conversations. Choose this direct route for the first vertical AI slice, subject to the eligibility spike; no Codex executable is needed for plain scene generation. A paid/hosted distribution must follow the applicable provider onboarding route. [ChatGPT plan usage](https://developers.openai.com/siwc/token-sharing-open-source).

Google documents Google-account authentication for Gemini CLI, including Google AI Pro/Ultra accounts, and reuse of cached authentication in headless mode. This is a CLI integration path, not evidence that arbitrary Google OAuth grants consumer Gemini web-app access. [Gemini CLI authentication](https://geminicli.com/docs/get-started/authentication/), [structured headless output](https://geminicli.com/docs/cli/headless/).

OpenCode documents ChatGPT sign-in as a client option, Console API access, and Go credentials. These are distinct routes. Its Go guide asks clients to send coding-agent traffic, so prose eligibility is unresolved for this product; never disguise story requests as code or another client to obtain access. Console/API mode is an explicit alternative after its supported workload and billing are verified. [OpenCode providers](https://opencode.ai/docs/providers/), [Go requirements](https://opencode.ai/docs/console/go/), [Console inference](https://opencode.ai/docs/console/api/inference/).

## 3. Generate button and connection UI

Preserve the two zoom levels. Add a compact **Generate scene** action to Scene view near the summary/scene controls, with the selected connection/model beside it. Story view does not gain a third editor pane. Scene summary, beats, stage-free writing, character profiles, and local direction remain the inputs.

First use opens **AI connections** in the existing settings/panel pattern. Preserve the selected scene and any unsent generation settings during connection setup. Each connection shows the provider, recognizable account/workspace, status, model picker, usage route, and **Connect**, **Reconnect**, **Test connection**, or **Disconnect** as appropriate. Do not show a subscription as connected merely because a CLI executable exists.

For ChatGPT, use the provider's **Continue with ChatGPT** sign-in wording. Show its first-success plan-use confirmation once, **Using ChatGPT plan** near generation, and a **Manage usage** link. Account labels must distinguish registrations/workspaces even if email addresses match. A sign-in with identity-only permission cannot enable plan generation. [Sign-in UX guidelines](https://developers.openai.com/siwc/ui-ux-guidelines), [account/session handling](https://developers.openai.com/siwc/token-sharing-open-source/profiles-and-sessions).

Normal writing flow:

1. Click **Generate scene**. Flush pending authoring writes. Show connection/model, optional length/style instruction, and a collapsed **Context being sent** summary that can expand to the exact outgoing content. After a connection is set up, generation does not require a repeated login wizard.
2. Submit an immutable scene/context snapshot. Stream into a distinct draft candidate below the scene direction; keep shorthand edits available. Replace the action with **Stop generating** and a clear state label.
3. On completion, offer **Accept draft**, **Revise**, **Compare**, **Copy**, and recoverable **Discard**. Acceptance is explicit and undoable; a generation never replaces the writer's beats or existing prose automatically.
4. If direction changes during generation, keep the result and label it **Based on earlier direction**. If the scene moves or is deleted, retain the job/candidate with its captured context and mark its status; never write into another scene by index.
5. Preserve partial output after cancellation, disconnect, crash, or a limit error. **Try again** creates a visibly separate attempt; never invisibly repeat an uncertain remote request or switch to a different paid route/account.

Connection states: not connected, component missing, signing in, signed in without generation permission, checking access, ready, reconnect needed, usage limit reached, offline, and service unavailable. Only a successful generation request proves the selected model works for that account; a catalog entry alone is insufficient. Expired credentials and limits show a concrete next action while keeping drafts and authoring intact. Do not label quota usage as zero-cost or unlimited because an API cost field is absent.

## 4. Native authentication and provider adapters

Add Rust-owned `ConnectionService`, `SecretStore`, `ProviderRegistry`, and `GenerationService`. The webview receives connection summaries and generation events, not saved credentials or direct network access. Extend the current command permission allowlist explicitly; do not grant general shell, filesystem, or remote-script capabilities.

### ChatGPT direct connection

- Follow the current public-client OAuth registration flow, rather than extracting browser cookies or copying another app's OAuth client identity. Persist a stable opaque host ID; retain each issued client registration with its validated account identity.
- Rust starts a bounded loopback callback listener before opening the system browser. Use PKCE S256, fresh state/nonce, exact redirect matching, callback timeout/cancel, and ID-token signature/issuer/audience/expiry validation. Validate granted plan-use scopes and the returning account before activating a connection. No client secret is embedded in a desktop binary. [Registration and sign-in](https://developers.openai.com/siwc/token-sharing-open-source/sign-in).
- Store access/refresh/ID tokens through the native credential store. Serialize refresh per connection and replace rotating tokens together. Disconnect stops new jobs, attempts documented revocation, and clears local credentials; distinguish unconfirmed remote revocation from a failed local sign-out. [Session lifecycle](https://developers.openai.com/siwc/token-sharing-open-source/profiles-and-sessions).
- Discover current account models and use the public Responses endpoint. In the documented preview, HTTP generation requires streaming with storage disabled and has a restricted parameter set; build a route-specific request serializer instead of forwarding generic settings such as temperature or maximum-output-token fields. Only a successful terminal completion makes the candidate complete. Preserve partial output on incomplete/error termination. [Models/inference](https://developers.openai.com/siwc/token-sharing-open-source/models-and-inference), [preview limits](https://developers.openai.com/siwc/token-sharing-open-source/preview-limitations).

### Gemini helper and optional OpenCode bridge

Qualify each helper before bundling it. Pin the binary/runtime version, source, digest, license notices, and Windows architecture. Prefer a self-contained app-private component; do not make ordinary installation depend on a global npm installation. A bridge to an already installed helper is an advanced option requiring a verified executable/version and explicit connection choice.

Invoke fixed executables with argument arrays and structured input through stdin, never a user-assembled shell command. Use a disposable working directory rather than the manuscript/project folder. Disable filesystem modification, shell, MCP, plugins, browsing, and tool execution for prose generation, and verify this in the supported helper version; if an agent helper cannot be constrained, that adapter does not ship. No local instruction file or generated text can enable tools.

Gemini connection setup may need the official interactive helper before cached-auth headless use. Determine how to present that supported login flow from the desktop without collecting a Google password or reimplementing private endpoints. Report progress/cancel back to the connection panel. Normalize documented streaming JSON events into text/status/usage events; tool requests are rejected.

Native-owned credentials use the OS store. A helper-owned authentication cache needs a separate documented location, same-user ACLs, and an approved at-rest protection strategy; do not claim Shorthand's keyring protects a third-party cache automatically. The spike must demonstrate credential handling or leave the subscription helper unavailable, with an explicit supported alternative. Never import another app's token files behind the user's back.

If OpenCode integration is pursued, first choose direct Console inference or a pinned bridge and document why. Its current embedded SDK hosts JavaScript services and therefore introduces a packaged runtime; it must not be imported as backend code into the Tauri webview. A direct Rust gateway adapter avoids that runtime for supported API routes. [OpenCode SDK architecture](https://opencode.ai/docs/build/sdk/), [permissions](https://opencode.ai/docs/permissions/).

## 5. Jobs, context, and SQLite changes

Keep global connection metadata in app settings, separate from user projects. Metadata includes connection ID, provider/adapter, credential reference, auth kind, verified account/workspace label, capability status, and component version. The OS secret store holds credentials. A project can remember a connection ID/model preference; opening a copied project asks the writer to choose a local connection when that ID is unavailable.

Introduce versioned project migrations for:

- `generation_jobs`: stable job ID, scene ID, captured authoring revision/context hash, immutable request snapshot, connection/model IDs, prompt-template version, state, timestamps, terminal reason, and reported usage.
- `generation_candidates`: candidate/job/scene IDs, checkpointed text, completion status, local edits/label, parent candidate for revisions, and recoverable discard state.
- Accepted scene prose and its recoverable revisions, linked to the accepted candidate and source context. Acceptance remains a Rust domain transaction, participates in Undo/Redo, and preserves the prior prose.

Connection secrets and credential-bearing headers never enter these tables. Checkpoint job output separately from authoring revisions/history; streaming every token must not create a full-project undo snapshot or invalidate the job's own input revision.

Initial context: scene summary and tone, ordered freeform beat documents/text, referenced character profiles and occurrence-specific emotion/delivery, narration guidance if present, optional writer-selected prior prose, and explicit revision instructions. Zero-character and empty-stage scenes work. Exclude Trash, unrelated scenes, unselected private notes, credentials, and the whole database. Show actual scope and truncation; do not silently drop constraints. Advanced entering-state/legacy continuity results are included only after those systems are implemented and verified, with provenance. The first AI slice can use explicit scene context without claiming replay compatibility.

Proposed narrow commands: `list_ai_connections`, `begin_ai_connection`, `cancel_ai_connection`, `disconnect_ai_connection`, `list_ai_models`, `test_ai_connection`, `prepare_scene_generation`, `start_scene_generation`, `cancel_generation`, `read_generation`, `revise_candidate`, `accept_candidate`, and `discard_candidate`. Final schemas are fixed in the implementation commit. The start command validates project session, expected revision, prepared-context hash, connection identity, and a unique local request ID before sending. A repeated command returns the existing job rather than starting duplicate inference. Cancellation is idempotent. No database lock is held while waiting for browser auth or network streams.

Persist states `prepared`, `running`, `completed`, `cancelled`, `failed`, and `interrupted`; derive a separate outdated flag from context changes. After restart, restore candidates and mark unfinished network jobs interrupted. A candidate is not accepted or declared complete on stream EOF alone. Selecting another project/account cannot attach late events or acceptance to the new selection: bind every event to project/session, scene, job, and connection identities.

## 6. Commit-sized delivery sequence

Each row is a reviewable commit or small sequence split at its stated boundary. Commit after its checks pass. Installer work and AI spikes may proceed independently; the native authoring app stays usable throughout.

| Step | Proposed commit | Scope and exit evidence |
|---|---|---|
| I1 | `feat: add repeatable Windows developer setup` | Add setup-dev script; verify missing prerequisites, existing local/global toolchains, lockfile install, and rerun behavior using a disposable developer environment |
| I2 | `build: package a Windows desktop installer` | Produce NSIS release with tested WebView2 policy and runtime dependencies; install/start offline authoring on clean Windows without developer tooling |
| I3 | `feat: add verified installer launcher` | Add local installer path, visible/silent flows, staging/cleanup/version checks; test corrupt inputs, cancellation, reinstall/upgrade, and preserved projects |
| I4 | `build: add authenticated release downloads` | Add real release origin and authenticity policy, then download mode; requires release ownership/signing decisions before enabling public downloads |
| A1 | `docs: qualify subscription connection adapters` | Spike ChatGPT eligibility/auth/completed inference, Gemini helper login/text-only isolation, and OpenCode workload access; record tested versions and blockers, without claiming working integrations from docs alone |
| A2 | `feat: add native AI connection management` | Global connection settings, OS credential store, ChatGPT browser flow/refresh/revocation, model discovery, identity validation, and reconnect/limit states; synthetic OAuth tests cover cancelled, mismatched, expired, and out-of-order callbacks |
| A3 | `feat: persist generation jobs and draft candidates` | Migration/backup tests, immutable scene-context preview, typed commands, fake streaming adapter, checkpoint recovery, scoped cancellation, idempotent start, outdated detection, and transactional Accept/Undo |
| A4 | `feat: generate scenes with a connected ChatGPT plan` | Add Scene Generate/Stop/candidate controls and direct adapter; prove one real sign-in plus completed generation on an eligible test account, interruption and limit handling, then native Generate/Revise/Accept/Undo end to end |
| A5 | `feat: add qualified Gemini and OpenCode connections` | Add only adapters that passed A1; connect/test/model selection/stream/cancel/expiry in native app, optional helper package checks, clear usage labels, no silent paid fallback |
| V1 | `test: verify installed generation and recovery` | Installed-app native flows, light/dark/minimum width/keyboard states, offline authoring, safe upgrades, crash/stream recovery, diagnostics redaction, and credential removal behavior |

A real-provider test is an explicit developer/user operation on a connected test account, not part of routine CI. Routine tests use deterministic mock authorization and stream servers; no developer credentials or manuscripts enter fixtures. One working provider delivers the first generation release; Gemini/OpenCode are staged additions, not blockers to shipping the initial loop.

## 7. Acceptance scenarios

- On a clean Windows machine, install and launch without Node/Rust, create/edit/reopen a story offline, then connect an eligible AI account without touching a terminal for the direct ChatGPT path.
- Click Generate, inspect outgoing context, stream a candidate, Stop, retain partial text, retry deliberately, revise, accept, undo acceptance, close, and reopen with all saved work intact.
- Use the Maya/Damian infirmary scene as a synthetic fixture: baseline profiles remain global; serious/awe/angry/embarrassed references stay local; the preview shows those scopes and generation targets the selected scene only. Staging and a mandatory POV form are unnecessary.
- Edit/reorder beats or change profiles during a job, switch scenes/projects/accounts, delete/restore the source scene, and deliver late callbacks/stream chunks. Results never overwrite another scene or attach to the wrong account; outdated results remain reviewable.
- Exercise declined sign-in, identity-only permission, invalid OAuth state/nonce/identity, concurrent refresh, expired/revoked tokens, unavailable credential store, missing helper, denied tool execution, unsupported model, network loss, limits during streaming, and abrupt process exit. Explain the next action and preserve authoring/candidate text.
- Verify plan-vs-API usage labels and provider privacy links. A limit cannot silently trigger API billing or a different provider. If a provider itself supports account-controlled overage, identify that billing source rather than claiming a hard subscription-only spending cap the app cannot enforce.
- Install/upgrade/uninstall with existing projects and connections, including interrupted migration. Preserve projects, avoid credential logging/exports, and verify the documented connection-removal behavior.

Implementation and publishing are separate from this plan. No installer, OAuth login, provider download, subscription purchase, or AI request is executed by creating this document.
