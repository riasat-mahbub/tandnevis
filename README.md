# Shorthand Writer

Shorthand Writer is a local desktop app for shaping a story with chapters, scenes, and ordered beats, then writing editable prose for each scene. You can write and manage projects offline; ChatGPT generation is optional.

![Story overview and character setup screens in Shorthand Writer.](assets/feature-tour.gif)

*Browse character starting points and 58 stock types, set optional guidance, and review the profile.*

## Start on Windows

Download the portable Windows ZIP from [GitHub Releases](https://github.com/riasat-mahbub/tandnevis/releases), extract it to a folder you can write to, and run `Shorthand Writer.exe`. The app requires Microsoft's Edge WebView2 Runtime. If it is missing, install the Evergreen Runtime from Microsoft's [WebView2 download page](https://developer.microsoft.com/en-us/microsoft-edge/webview2).

Choose **New project** or **Open project** from the welcome screen or the **Project** menu. Projects are local `.shorthand` files saved where you choose. No account is needed to create or edit a project.

## Shape and write a story

1. In **Story**, add chapters and scenes to build the story overview. Open a scene to work on it.
2. Write the scene's direction in **Scene summary**. Use **Add beat** to create ordered beat cards beneath it, and write narration or dialogue in **Scene prose**.
3. Use **Characters**, **Tones**, and **Emotions** to manage reusable project-wide definitions. In a scene, click a block or drag it into the summary or a beat to insert a reference.
4. To make a character, choose **New character**. The four steps are **Starting point**, **Name and icon**, optional **Profile details**, and **Review**. Start blank or adapt one of 58 stock character types, including five ensemble functions. Tone and emotion defaults are optional; **None** leaves either unset. Review the profile and choose **Create character**, then **Save** to write the project changes to disk.

Reorder scenes and beats with drag and drop or the move controls. Use the **Undo** and **Redo** buttons for recent project changes. Deleted scenes, beats, chapters, and unused definitions go to **Trash**, where you can restore them.

## Save and move between projects

Saving is manual by default: choose **Save** or press **Ctrl+S**. To save automatically, turn on **Autosave** in **Settings**. If you close or switch projects with unsaved changes, choose whether to save, discard, or cancel.

The **Project** menu also has **Import Markdown...** and **Export outline as Markdown...**. Import adds Markdown as chapters, scenes, and beats; export includes the story outline and beat text. These are explicit import and export actions, not a live sync.

## Optional ChatGPT generation

To generate in a scene, connect ChatGPT and verify a model in **Settings**. Generation needs an internet connection and eligible ChatGPT plan access; availability depends on your account and the current app build. **Generate scene** proposes beats from the summary. **Generate prose** drafts from the summary and beats. Review each result, then accept it into the project or discard it. You can continue writing without connecting ChatGPT.

## Projects and backups

In portable mode, app settings and recovery data are stored in a `data` folder beside the application. Each `.shorthand` project is saved separately at its chosen location. Back up your project files separately from the portable app folder.
