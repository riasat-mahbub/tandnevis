# Portable app and ChatGPT scene generation

Status: narrowed implementation tranche, 19 November 2026. S1 (Settings navigation, persisted appearance, and the Harvest Orange/Platinum theme), the S2 native ChatGPT implementation, and S3 scene-context/character-reference editing are in the app. Live eligible-account sign-in/inference verification remains open; S4 generation and S5 portable packaging are in progress/planned. This replaces the earlier installer-first, multiple-provider proposal. The existing SQLite authoring app and two writing views remain the foundation.

## Agreed scope

Ship a portable Windows app with a Settings page and one ChatGPT connection. Generate **one selected scene at a time from its ordered beats**. Character blocks encode structured instructions for the model. Generate stays greyed out until Settings has a verified, usable connection. Apply the Harvest Orange / Platinum / Iron Grey theme throughout the application.

This is a smaller extension of the current app: no new provider framework, helper CLI, installer service, whole-story agent, or stage simulation is needed. Authentication and persistence still need real native integration tests; a documented sign-in route alone does not prove the app's account eligibility.

## 1. Portable Windows app

Primary artifact: a versioned Windows 11 x64 ZIP containing the release executable, required native libraries/resources, a short README, and a checksum. Extract to a writable folder and double-click `Shorthand Writer.exe`. No npm, Node, Rust, Python, terminal, or admin installation is required for the shipped app.

The first package uses the machine's Microsoft WebView2 runtime. Document that prerequisite and handle a missing runtime with a readable startup diagnostic or a small checked launcher, rather than a silent failure. A ZIP around an executable does not make WebView2 disappear as a dependency. A fully self-contained archive with a fixed WebView2 runtime can follow if needed; it increases distribution size and needs its own runtime-path and update verification. [Tauri runtime distribution options](https://v2.tauri.app/distribute/windows-installer/#webview2-installation-options).

Portable storage contract:

- An explicit portable marker selects a `data/` directory beside the executable for non-secret settings, recovery state, and the WebView2 profile. Resolve paths from the executable directory, never from the shell's working directory. Verify all Tauri/WebView2 data locations respect this mode.
- `.shorthand` projects remain ordinary files in writer-chosen locations. Do not force manuscripts into the application folder. Use relative recent-project paths when a project is inside the portable folder; gracefully handle unavailable external paths.
- Tokens stay in the Windows credential store, scoped to this app/user/connection. Copying the folder to another Windows user or computer carries settings and project files, **not a working ChatGPT login**. Settings shows Reconnect there. Keep a stable per-installation host identifier on the same machine; moving a copy to another host creates that host's identity without reusing another machine's tokens.
- Treat a read-only folder as a clear startup/storage error with an action to move the app or choose a writable data location. Do not silently fall back to an undocumented directory.
- Updating means closing the app after saving and replacing application binaries/resources. Preserve `data/` and all projects; the update archive contains application files only and never replaces those directories or terminates a saving process.

Add a small developer packaging script, proposed `scripts/package-portable.ps1`, around the existing build launcher. Build in release mode without the NSIS bundler, collect the verified runtime files, add the marker/README, and archive into a versioned output directory. Test the packaged copy outside the source checkout. Local packaging needs no release host, signing account, or download service.

The earlier install script, silent NSIS flow, automatic downloads/updater, and developer bootstrap script are deferred. Existing developer commands remain the supported source workflow; they are not prerequisites for writers using the ZIP.

## 2. Settings page

Add a globally visible **Settings** action in the app header, available before a project is open. Settings is an application configuration page, not another writing zoom level. Back returns to the exact Story/Scene selection and scroll position. Unsaved authoring changes must finish saving or retain their buffers during navigation.

Keep the page small:

| Section | Controls and information |
|---|---|
| ChatGPT | Connection status, recognizable account/workspace, **Continue with ChatGPT**, **Test connection**, **Reconnect**, **Disconnect**, and a Manage usage link |
| Generation | Model picker populated for the connected account; optional default writing guidance. Model capabilities determine available controls; do not expose unsupported temperature/token parameters |
| Appearance | Harvest Orange and Platinum palette, existing Calm option, and Light/Platinum by default; System and Dark remain explicit choices |
| Portable data | Current data folder, project-storage explanation, app version, and the WebView2 prerequisite/status where available |

Use one active ChatGPT connection/model in this release. No provider picker, other-service placeholders, API-key fallback, or general-purpose agent configuration. Changing model requires access verification for the new selection. Disconnect cancels/stops new requests, clears the app's credentials, and immediately disables Generate while preserving writing and drafts.

Use the documented ChatGPT browser sign-in and plan-use authorization. Rust owns PKCE/state/nonce, callback validation, account identity, token storage/refresh/revocation, model discovery, and network requests. Never collect a ChatGPT password or read another app's token files. Confirm that this app's local distribution qualifies for the supported plan-usage flow, then complete a real inference request before calling the connection ready. [ChatGPT plan usage](https://developers.openai.com/siwc/token-sharing-open-source), [registration/sign-in](https://developers.openai.com/siwc/token-sharing-open-source/sign-in).

Show **Using ChatGPT plan** and **Manage usage** near generation, following the provider's first-sign-in confirmation and usage guidance. Account limits remain account limits; a failed connection never switches to paid API billing. [ChatGPT connection UX](https://developers.openai.com/siwc/ui-ux-guidelines).

## 3. Beats and character blocks are the scene instructions

Generation always targets a stable selected scene ID. Take that scene's ordered beats, summary/tone, and existing optional narration guidance. Do not loop through chapters or generate the whole story. No stage, character count, or mandatory POV form is required.

Character dragging is an authoring shortcut for inserting a structured inline reference at the beat caret/drop position. Clicking to insert remains an accessible alternative. It does not mean the character moves around a simulated physical stage.

Each reference keeps a character ID and occurrence-specific direction. Rust resolves the ID into the selected global profile and baseline voice/personality/background when preparing the request. Explicit local emotion/delivery overrides baseline guidance for that occurrence; it does not edit the reusable profile or apply silently to another character/reference.

Conceptual request representation:

```text
scene: { id, title, summary, tone }
beats: [
  { id, order, document: freeform text + inline character references },
  ...
]
referencedCharacters: { characterId: { name, background, personality, voice } }
references: embedded in the beat document with characterId and local emotion/delivery
writingGuidance: optional scene/default instructions
```

The inline document preserves where each reference occurs; a flat cast list cannot replace it. Include readable directions alongside the structured context so the model understands both actions and scope. Preserve paragraph/beat order and distinguish scene tone, character baseline, local emotion, and spoken delivery. The writer never has to type pipe markup or internal IDs.

For the infirmary example, the request contains Maya and Damian's referenced profiles, the ordered wound-stitching/flinching/staring/dialogue beats, and local serious/awe/angry/embarrassed direction. Output is one prose scene. Changing or renaming a global profile still resolves by ID; characters mentioned only as ordinary text remain ordinary text unless explicitly linked.

Preview exactly the context being sent. Send only this scene and its referenced profiles/instructions; exclude unrelated scenes, Trash, credentials, and the project database. Legacy replay, automatic continuity reconstruction, private-knowledge modelling, and prior-chapter retrieval are not prerequisites for this first slice.

## 4. Generate button and draft flow

Place **Generate scene** in Scene view beside its scene controls. It is visibly grey and natively disabled until the selected ChatGPT connection/model is ready. Do not open sign-in by clicking a disabled button. Put a readable reason and an independently clickable **Open Settings** link beside it.

| State | Generate behavior | Nearby explanation/action |
|---|---|---|
| Not configured | Grey, disabled | Connect ChatGPT in Settings · Open Settings |
| Signing in/checking | Grey, disabled | Checking your ChatGPT connection |
| Signed in without plan permission, reconnect required, or model unverified | Grey, disabled | Finish setup or test the selected model in Settings |
| Ready, but scene has no non-empty beats | Grey, disabled | Add a beat to describe this scene; character references are optional |
| Ready with saved scene direction | Enabled in the orange primary-action treatment | Selected model · Using ChatGPT plan · Manage usage |
| Saving | Wait for the queued save before submitting; never send an older draft silently | Saving scene direction |
| Generating | One active request; expose **Stop generating** | Streaming draft for this scene |
| Offline, provider limit, or unusable authorization | Disabled until usable again | Concrete failure reason and Settings/Manage usage/Retry as appropriate |

Readiness means validated account/permission, selected supported model, and a successful small connection test for that selection. Label the test as sending a small request using the plan. Persist configuration, recheck/refresh authorization on launch, and disable Generate while readiness is unknown. A non-secret boolean from a previous run cannot by itself authorize a request. Network/usage errors may still occur after a successful test and must preserve partial output.

Check the same preconditions in Rust; bypassing a disabled button must not start inference. Bind the prepared request, job, and stream events to project/session, scene, connection, and model IDs. Settings changes or project switching cannot attach late output to another scene/account.

Simple first-release flow:

1. Flush the selected scene's pending writes and capture its ordered beats/profiles into an immutable request snapshot.
2. Start one job and stream into a separate draft area below the scene direction. Keep beat editing available. Limit to one active generation request for this release.
3. Offer **Accept draft**, **Copy**, and **Discard** when done; **Stop** retains clearly marked partial output. Regenerating creates a separate attempt. Side-by-side comparison and a dedicated revision workflow are deferred.
4. Acceptance updates only that scene's prose, keeps the beats intact, preserves previous prose, and is undoable. Edits to request inputs during streaming mark its result **Based on earlier direction** and require review before acceptance.
5. Save jobs, request snapshots, draft checkpoints, terminal states, and accepted prose/revisions in SQLite through a versioned migration. Streaming checkpoints do not create a full authoring-history snapshot for every token. Restore interrupted drafts after restart; do not silently restart remote requests.

The direct ChatGPT route uses its documented streaming request format and supported settings. Mark completion only on the successful terminal event, not stream EOF; preserve incomplete/error output. No tools, shell, filesystem access, helper CLI, or autonomous scene editing is required. [ChatGPT inference](https://developers.openai.com/siwc/token-sharing-open-source/models-and-inference), [current request limitations](https://developers.openai.com/siwc/token-sharing-open-source/preview-limitations).

## 5. Harvest Orange theme

Replace the moss/rose/ochre base theme with these anchors across the app, Settings, and draft states. Fresh installations open in Light/Platinum regardless of the operating system preference; System and Dark are available only as explicit choices:

| Token | Value | Intended role |
|---|---|---|
| Harvest Orange | `#FF7700` | Primary brand color for enabled actions, selected accents, timeline emphasis, restrained decorative backings |
| Platinum | `#E5EBEA` | Default light theme foundation: main background, writing surfaces, and pale supporting surfaces |
| Iron Grey | `#435058` | Text, controls, outlines, timeline structure, secondary surfaces |
| Deep ink | `#20282D` | Supporting text contrast and optional dark-mode surfaces; not a primary brand color |
| Neutral derivatives | Derived light/dark shades | Raised writing surfaces, borders, hover states, muted/disabled controls, and semantic feedback |

Harvest Orange and Platinum should be the visible brand colors; reserve Iron Grey and deep ink for readable text, control outlines, and supporting structure rather than large black-looking areas in the default theme. Use Iron Grey on Platinum for body text. Harvest Orange on Platinum is approximately 2.21:1, so it cannot carry normal body text or the sole focus indicator. Iron Grey on orange is approximately 3.12:1; primary orange buttons need the darker ink label, not white/platinum or Iron Grey small text. Verify every final combination, including dark mode, against normal text/focus requirements.

Disabled Generate uses an intentionally grey neutral surface, readable grey label, disabled cursor/semantics, and its adjacent reason. It must not retain the orange enabled appearance. Focus/error/success states use labels/icons as well as color. Character, emotion, and delivery remain distinguishable by explicit labels and scope, not three conflicting theme palettes.

Retain the two timelines, useful asymmetry, flat writing surfaces, Georgia writing font, platform controls, and Calm/reduced-motion support. Apply orange sparingly around content. Do not redesign the layout or recolor only selected components; update shared semantic tokens and their light/dark overrides together.

## 6. Commit-sized implementation sequence

| Step | Proposed commit | Completion evidence |
|---|---|---|
| S1 | `feat: add settings navigation and harvest orange theme` | Real global Settings page, persisted appearance with Light/Platinum first-run default, return-to-scene behavior, consistent orange-and-platinum palette in both writing views and settings; disabled Generate has a setup reason/link |
| S2 | `feat: connect ChatGPT from native settings` | Eligible test-account browser sign-in, protected credentials, refresh/disconnect, model selection and test; readiness state gates UI and Rust; no API fallback |
| S3 | `feat: encode scene beats and character references for generation` | Drag/click character insertion, local direction scope, stable profile resolution and context preview; infirmary fixture encodes exact beat order with zero/one/multiple-character cases |
| S4 | `feat: generate and accept individual scene drafts` | SQLite migration, immutable request/job, streaming/stop/checkpoints, Accept/Undo, one active job, outdated/interrupted handling; native end-to-end generation from the selected scene |
| S5 | `build: package and verify portable Windows release` | Versioned ZIP opens outside the checkout without developer tools; data-folder/host behavior, WebView2 prerequisite, clean-machine launch, offline authoring, update preservation, Settings connection and real scene generation |

Commit after each step's relevant checks pass. Do not require the legacy engine or other providers before S4. Deterministic tests use mock OAuth/stream servers and synthetic writing; real sign-in/generation tests use an explicitly connected test account and remain separate from routine CI.

Acceptance includes fresh startup in Light/Platinum with Generate disabled; Settings setup/test enabling it; disconnect/expiry disabling it again; keyboard-accessible Settings links; Maya/Damian profile and local-direction encoding; empty and character-free beats; stop/restart recovery; input edits and project/account switches during a job; Accept/Undo; and all explicit themes at desktop/minimum widths. No source change or implementation test is performed merely by updating this plan.

## 7. Deferred scope

Gemini/OpenCode and other providers; API-key configuration; installer/bootstrap/download/updater scripts; bundled fixed WebView2 distribution; batch chapter/story generation; automatic continuity/replay; physical stages; tool-using agents; comparison/revision workspaces; release hosting/signing; and multi-platform packaging. These remain possible later work, not controls or blockers in this release.
