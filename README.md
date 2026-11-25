# Tandnevis

Tandnevis is a Windows writing app for outlining chapters and scenes, drafting prose, and exporting a manuscript. Your projects are stored on your computer, and you can write offline without an account.

## Install on Windows

1. Get `Shorthand-Writer-latest-win-x64.zip` for **Windows x64** from the maintainer. If a build has been published, look for the ZIP under **Assets**. [GitHub Releases](https://github.com/riasat-mahbub/tandnevis/releases)
2. Right-click the ZIP and choose **Extract All**. Pick a folder you can write to, such as `Documents\Tandnevis`, and keep the extracted files together.
3. Open the extracted folder and double-click **Shorthand Writer.exe**. Tandnevis uses this executable name for compatibility. The portable app runs from this folder.

If Windows reports that WebView2 is missing, download and run the **Evergreen Bootstrapper**, then reopen the app. [Microsoft Edge WebView2 downloads](https://developer.microsoft.com/en-us/microsoft-edge/webview2#download)

## Write your first scene

1. Enter a **Story name**, choose **New project**, and pick where to save the `.shorthand` file. To resume a story, choose **Open project** and select its file.
2. In **Story**, choose **New chapter**. In the chapter, choose **New scene**, then give the scene a title.
3. Use **Scene summary** to jot down what happens. Choose **Add beat** to break the action into smaller moments. Write the narration and dialogue you want readers to see in **Scene prose**.
4. Choose **Save** or press **Ctrl+S**. To save automatically as you work, turn on **Autosave** in **Settings**.

![Tandnevis tour showing the story outline, scene writing, Story Library, character creation, the relationship graph, and manuscript preview.](assets/feature-tour.gif)

## Organize your story

- Open chapters and scenes from **Story**. Use the zoom-out control to return to the chapter or story, or click the current scene name to search the outline.
- Drag chapters, scenes, or beats into order, or use their move buttons. Use **Undo** for a recent change or open **Project → Trash** to restore a deleted item.
- Use **Project → Import Markdown** to bring notes into an open project as chapters, scenes, and beats. Use **Project → Export outline as Markdown** to take the outline and beats with you.

## Reuse characters, tones, and emotions

Open **Story Library** to search and edit definitions shared across the project. Choose **New character** to start with a blank profile or adapt a stock character type. Add a name, review the profile, and choose **Create character**. Default tone and emotion are optional.

In a scene, place the caret in the summary or a beat, then click a character, emotion, or tone in **Writing tools** to insert it. You can also drag a reference directly into the text.

### Map character relationships

Open **Character graph** beside the scene title. In **After**, drag from one character’s connector to another, choose a relationship such as **Trusts** or **Rivals**, and apply it. Tandnevis adds the change to the scene summary. Click the line or the summary block to edit it again.

Use **Before** to see relationships inherited from earlier scenes or to correct what’s true when the scene opens. **After** describes what changes by the end. New outcomes start as **Planned** and can be marked **Established** once you’ve written the scene.

Choose **End relationship** to record that a connection ends here. To undo the change and restore the inherited relationship, delete its summary block.

## Export a manuscript

1. Choose **Compile Book** in the sidebar or press **Ctrl+Shift+E**.
2. Pick the whole story, a chapter, or a scene. Choose **Markdown**, **plain text**, or **HTML**, then adjust options such as the title page and how to handle unfinished scenes.
3. Review the preview and choose **Export**. If you edit the prose while the preview is open, choose **Refresh preview** before exporting. The manuscript contains scene prose. Use **Export outline as Markdown** for summaries and beats.

To make a PDF, export HTML, open it in your browser, and use the browser’s **Print → Save as PDF** option.

## Draft with ChatGPT

If your build offers ChatGPT generation, connect an eligible account under **Settings → Write with ChatGPT**. Choose a **Writing model** and select **Test connection**. Back in a scene, use **Generate beats** or **Generate prose**, then review the draft before accepting it. Accepted beats are added to the sequence. Accepting a prose draft replaces the current scene prose.

## Back up your projects

Back up the `.shorthand` files you save for each story. The portable app keeps its settings and recovery data in a separate `data` folder beside `Shorthand Writer.exe`. When updating the app, save and close it first, then keep that `data` folder and your project files.

[Developer notes and demo recording](tools/README.md)
