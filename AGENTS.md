# Repository instructions

## Required desktop build

- After changes to the application, build and refresh the portable Windows app in `out/latest` before reporting the work complete. A frontend-only build is insufficient.
- Run `powershell -NoProfile -ExecutionPolicy Bypass -File scripts/package-portable.ps1` from the repository root. This runs the Tauri release build and updates `out/latest/Shorthand Writer.exe`, the portable ZIP, and its SHA-256 checksum.
- Preserve `out/latest/data` and user project files. Use the packaging script rather than replacing the output directory manually.
- If packaging fails or the running app prevents updating the executable, report the blocker explicitly; do not claim `out/latest` is current.
