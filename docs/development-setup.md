# Desktop development setup

The application runs locally through Tauri 2. React renders the interface; Rust owns project operations and the canonical SQLite database. The HTML files in `outputs/` are historical design references.

## Prerequisites

Windows development requires Node 22.12 or newer, Rust 1.90 or newer with the MSVC toolchain, Visual Studio C++ Build Tools and Windows SDK, and Microsoft Edge WebView2. Follow the [Tauri Windows prerequisites](https://v2.tauri.app/start/prerequisites/) when preparing another machine. Building an installer also downloads the bundler's packaging tools on first use.

From the repository root:

```powershell
npm ci
node tools/desktop.mjs check
npm run desktop:dev
```

`desktop:dev` launches Vite and the actual native application. `npm run dev` launches only the browser renderer, which cannot open or save native projects. Browser development does not supply a second persistence implementation.

The launcher uses `.tools/cargo/bin` when a repository-local Rust installation exists, sets `CARGO_HOME=.tools/cargo` and `RUSTUP_HOME=.tools/rustup`, and adds that Cargo directory to the child process's PATH. Otherwise it uses the normal system Rust installation. It does not install or update a toolchain or change persistent machine environment variables. `.tools/` is ignored by Git.

For direct Cargo maintenance with the local toolchain in PowerShell:

```powershell
$env:CARGO_HOME = Join-Path $PWD '.tools/cargo'
$env:RUSTUP_HOME = Join-Path $PWD '.tools/rustup'
$env:Path = "$env:CARGO_HOME/bin;$env:Path"
cargo fmt --manifest-path src-tauri/Cargo.toml --check
cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings
```

## Checks and builds

```powershell
npm run typecheck
npm test
npm run build
npm run test:rust
npm run desktop:build
```

`build` verifies and bundles the renderer. `test:rust` runs Rust tests against synthetic data. `desktop:build` builds the executable and a per-user NSIS installer under `src-tauri/target/release/bundle/nsis/`. The executable is `src-tauri/target/release/shorthand-writer.exe`. Use `npm run desktop:build -- --debug --no-bundle` for a faster native debug build, with the executable under `src-tauri/target/debug/`.

Installer generation does not establish clean-machine installation, signing, or upgrade verification. Automatic updates are not configured. Keep user projects outside the source checkout; no developer runtime should be required by the packaged executable.

## Native smoke runner

After a native executable is built, run:

```powershell
node tools/native-smoke.cjs
# Or select the debug executable explicitly:
node tools/native-smoke.cjs --exe src-tauri/target/debug/shorthand-writer.exe
```

The dependency-free Node runner launches that exact executable with a temporary local WebView2 debugging port and an isolated profile, invokes the actual Rust bridge, creates a synthetic `.shorthand` project, and verifies authoring operations, rejected stale/session requests, Markdown interchange, and close/reopen persistence. It then opens that project in the native interface, edits the summary and beat text, uses visible Duplicate/Move/Delete/Restore controls, and reopens the project to verify those changes. Real pointer drags must change the persisted scene and beat order. The character check inserts a library reference, selects its chip, saves occurrence-only emotion, and verifies a shared profile rename updates the displayed chip without extra editor saves.

The runner captures Story and Scene in light and dark appearances at 1440px and 800px viewports and checks horizontal page overflow. Only the OS chooser's IPC response is replaced in that test process; the immutable Tauri invoke bridge and all project reads and writes still use Rust and SQLite. Native open/save dialog interaction needs separate verification.

Reports, screenshots, and app logs are retained under `.tools/native-smoke/run-*/`. Temporary projects and WebView2 profiles are removed after the runner closes its own child process. No existing project, unrelated app process, machine-wide environment setting, or production debug configuration is changed. A failed run records its error and any cleanup issue in `report.json`; screenshots alone do not mean the full run passed.

This uses Microsoft's documented [WebView2 child-process debugging flag](https://learn.microsoft.com/en-us/microsoft-edge/webview2/how-to/debug-visual-studio-code) and the Chrome DevTools Protocol's [Runtime](https://chromedevtools.github.io/devtools-protocol/tot/Runtime/) and [Page](https://chromedevtools.github.io/devtools-protocol/tot/Page/) APIs. It supplements unit tests; it does not prove installer behavior, operating-system dialog behavior, or every capability-origin denial.

## Projects and Markdown

Create or open a `.shorthand` file through the desktop controls. Each file is a versioned SQLite project database containing authoring data, stable identities, ordering, revision history, and recoverable Trash. Rust validates operations and commits them transactionally. Ordinary authoring requires no network account or AI provider. Keep backups of important projects, and close the app before copying a database with external tools.

Manual save is now the default. Native operations update a private in-memory SQLite working copy; Save or Ctrl+S writes every project table to the selected file in one transaction. The save checks for external file changes before writing. Autosave is optional in Settings and saves after a short idle period without disabling editor controls. Generated draft checkpoints also belong to the working copy and require Save when autosave is off. Unsaved changes have no crash durability. A normal close or project switch prompts Save / Discard / Cancel.

Markdown import/export is deliberate interchange with a selected UTF-8 `.md` or `.markdown` file, with a 16 MB import limit. Import appends new content: level-two headings establish chapters, level-three headings establish scenes, and blank-line-separated paragraphs become plain-text beats. Fenced code content is kept as text. Import retains the original source in the database and leaves the source file unchanged. A leading level-one heading is ordinary imported text; it does not rename the existing project.

Export writes the project title, chapter and scene headings, scene summaries, and current beat text in story order. It does not preserve all rich formatting or import syntax as a round-trip codec. Markdown is not a lossless backup of local reference attributes, profiles, identities, history, or Trash. Preserve the `.shorthand` database for full project fidelity. This interchange is not a live editable mirror and does not synchronize an Obsidian vault.

The app includes native ChatGPT Settings and individual scene drafting. Connect an eligible account, acknowledge plan usage, choose a model, and pass its connection test before Generate becomes available. Live account inference remains unverified in this development session. Legacy replay compatibility, continuity review, production stages, signing, clean-machine certification, and automatic updates remain later work. See [implementation progress](implementation-progress.md) for the verification record.

Build a portable ZIP with `powershell -ExecutionPolicy Bypass -File .\scripts\package-portable.ps1`. Use `-OutputDirectory out/another-build` if an archive already exists. The ZIP has an explicit `portable.mode` marker and stores app data beside its executable; separately chosen projects remain in their saved locations. Native smoke accepts an extracted portable executable through `--exe` and verifies its Platinum default, runtime path, disabled generation gate, and authoring behavior.
