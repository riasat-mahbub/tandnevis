# Tandnevis developer notes

Run the commands below from the repository root.

## Build the portable Windows app

On a Windows x64 development machine with the project dependencies and Tauri build tools installed, run the packaging script after changing the application.

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/package-portable.ps1
```

The script builds the Tauri release and refreshes the executable, ZIP, and checksum in `out/latest`. It preserves the `data` folder and separately saved projects.

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
