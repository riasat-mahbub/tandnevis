# Tandnevis developer notes

Run the commands below from the repository root.

## Build the portable Windows app

On a Windows x64 development machine with the project dependencies and Tauri build tools installed, run the packaging script after changing the application.

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/package-portable.ps1
```

The script builds the Tauri release and refreshes the executable, ZIP, and checksum in `out/latest`. It preserves the `data` folder and separately saved projects.

## Build the portable Linux app

On Linux x86-64, install Node 22.12 or later, Rust 1.90 or later, and the platform build dependencies. The release workflow uses Ubuntu 22.04 as its build baseline. Local builds use the libraries on the build machine, including its glibc version. [Tauri Linux prerequisites](https://v2.tauri.app/start/prerequisites/#linux)

```bash
npm ci
bash scripts/package-portable-linux.sh
```

The script builds the Tauri release executable and writes it, the portable archive, and its SHA-256 checksum to `out/linux-latest`. Existing `data` and project files stay in place.

## Create a GitHub release

Once the [workflow](../.github/workflows/portable-release.yml) is on the default branch, you can run **Portable builds** from the repository’s **Actions** tab to download test packages from the run’s **Artifacts**.

To prepare a release, push a tag matching the app version. For example, use `v0.1.0` for package version `0.1.0`.

```bash
git tag -a v0.1.0 -m "Tandnevis v0.1.0"
git push origin v0.1.0
```

The tag run builds both x64 packages on native runners, verifies their checksums, and attaches them to one draft GitHub Release. Review the draft and publish it from **Releases** when ready. [GitHub release management](https://docs.github.com/en/repositories/releasing-projects-on-github/managing-releases-in-a-repository)

## Background desktop verification

Relationship integration checks can run against an invisible, unfocused native window, using an isolated WebView profile and synthetic project.

```powershell
node tools/desktop.mjs build --debug --no-bundle --config tools/native-smoke.background.json
node tools/native-smoke.cjs --relationships --background --exe src-tauri/target/debug/shorthand-writer.exe
```

This exercises connector input, summary/graph synchronization, Undo, AI context, layout persistence and Save/reopen without activating a desktop window. The background runner verifies that the window stays hidden and destroys it after checking the fixture is saved. Use the portable packaging script to produce the visible user app.

## Refresh the README demo

Install the project's Node dependencies and put FFmpeg with the `libx264` encoder on `PATH`.

```bash
npx playwright install chromium
npm run demo:readme
```

The runner opens Tandnevis in Chromium with a fresh copy of a fictional project for each feature. Each `*.test.mjs` file in `tools/readme-demo` drives and checks one workflow. The runner records the actions in the order listed in `tools/readme-demo/run.mjs` and combines the clips into `assets/feature-tour.gif` and `out/readme-demo.mp4`. It uses in-memory project data and captures the manuscript preview without opening a native save dialog.

Use `npm run demo:readme -- --check` to verify the flows without recording, or `npm run demo:readme -- --check relationships` to verify one feature.
