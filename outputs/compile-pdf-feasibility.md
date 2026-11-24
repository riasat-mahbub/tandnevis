# Compile PDF feasibility

## Decision

**PDF is unverified for production. Keep it out of the first Compile Book format dropdown.** The WebView2 page exposes `window.print`, but this spike did not establish that a user can complete or cancel a print flow, save a PDF, or return to the compile dialog reliably. This does not block shipping Markdown, plain text, and HTML.

## Windows spike

On 2026-11-24, I launched a staged copy of the existing Windows release app as an isolated child with a separate WebView2 profile and loopback CDP endpoint. The probe waited for the rendered Tandnevis landing page before calling `window.print()`.

| Item | Evidence |
| --- | --- |
| Executable | `.tools/pdf-spike/stage-20261124-1/shorthand-writer.exe`, copied from `src-tauri/target/release/shorthand-writer.exe` before the root release build |
| SHA-256 | `C85744DEB96C5ACC4646977058F8D9EF0B57A783887D21DE65FD002DAD64CF04` |
| Runtime | Windows WebView2, Edge `158.0.0.0`; page URL `http://tauri.localhost/`, title `Tandnevis` |
| Availability | `typeof window.print` returned `"function"` on the rendered application page |
| Invocation | `window.print()` was scheduled from the live application page. The renderer did not return within the 10-second observation window; CDP `Runtime.evaluate` timed out afterward. |
| Dialog/cancellation | The bounded scan found no visible print/save dialog owned directly by the Tauri main window. No cancellation action was attempted because no such dialog was identified. |
| PDF output | No PDF was created or inspected. Page count, Unicode rendering, and restoration of a Compile Book dialog were not tested. |

The probe used `windowsHide: true`, did not use global SendKeys, and terminated only its own isolated child. The child is no longer running. A first probe attached while the WebView2 page was still `about:blank`; that attempt was discarded. The evidence above is from the corrected probe after the application page rendered.

## Limits and follow-up

This confirms browser API availability only. It does not establish a usable native print UI or a production PDF export path. CDP `Page.printToPDF` was not used; a debug-protocol PDF result would not prove production support. The probe used the prior release build's landing page, not a CompileDialog or real manuscript.

Reconsider PDF only after a production-path check demonstrates all of the following in the packaged Tauri app: the user can cancel the native print/save flow, a real multi-page PDF preserves Unicode content, and the application returns to the compile dialog in a usable state after both cancellation and completion.
