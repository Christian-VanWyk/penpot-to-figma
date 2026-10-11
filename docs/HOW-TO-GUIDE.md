# How-to guide

This guide walks you through moving a design from **Penpot** into **Figma** with the two plugins in this repository. It takes about five minutes to set up the first time, and under a minute after that.

- [What you need](#what-you-need)
- [Step 1: Download the plugins](#step-1-download-the-plugins)
- [Step 2: Install the Penpot plugin](#step-2-install-the-penpot-plugin)
- [Step 3: Install the Figma plugin](#step-3-install-the-figma-plugin)
- [Step 4: Export from Penpot](#step-4-export-from-penpot)
- [Step 5: Import into Figma](#step-5-import-into-figma)
- [Every time after that](#every-time-after-that)
- [Tips for the best result](#tips-for-the-best-result)
- [Troubleshooting](#troubleshooting)

---

## What you need

- A **Penpot** account, either [design.penpot.app](https://design.penpot.app) or your own self-hosted Penpot.
- The **Figma desktop app** ([download](https://www.figma.com/downloads/)). The browser version of Figma can't load plugins from your computer, so you need the desktop app for the one-time install.
- **To run the Penpot plugin**, one of these:
  - **Windows:** nothing extra. A PowerShell script is included.
  - **Mac / Linux:** Python 3 (`python3 --version`) or Node.js (`node --version`).

## Step 1: Download the plugins

Either clone the repository:

```bash
git clone https://github.com/Christian-VanWyk/penpot-to-figma.git
```

…or click **Code → Download ZIP** on GitHub and unzip it somewhere you'll find it again, such as your Desktop.

You'll have this folder:

```
penpot-to-figma/
├── penpot-exporter/   ← the Penpot plugin
└── figma-importer/    ← the Figma plugin
```

## Step 2: Install the Penpot plugin

Penpot loads plugins from a web address, so the plugin folder has to be served from your computer while you use it.

### 2a. Start the plugin server

**Windows:** open `penpot-exporter` and double-click **`start-penpot-plugin.bat`**.

> If a blue "Windows protected your PC" box appears, click **More info → Run anyway**. The script only serves the files in that folder, and only to your own computer.

**Mac / Linux:** open a terminal in the `penpot-exporter` folder and run one of these:

```bash
python3 serve.py
```

```bash
node serve.mjs
```

A window or terminal will say the plugin is being served at `http://localhost:4400`. **Keep it open** while you use the plugin.

### 2b. Add the plugin to Penpot

1. Open any file in Penpot.
2. Open the **Plugins manager** with **Ctrl + Alt + P** (**⌘ + Option + P** on Mac), or from the main menu → **Plugins**.
3. Paste this address into the box at the top:

   ```
   http://localhost:4400/manifest.json
   ```

4. Click **Install**, then **Allow**. The plugin asks for permission to read your design and to download the export file.

**Export to Figma** now appears in your plugin list.

## Step 3: Install the Figma plugin

1. Open the **Figma desktop app** and open any design file.
2. Open the main menu → **Plugins → Development → Import plugin from manifest…**
3. Browse to the `figma-importer` folder and select **`manifest.json`**.

**Import from Penpot** now appears under **Plugins → Development**. You only do this once.

## Step 4: Export from Penpot

1. Make sure the plugin server from step 2a is running.
2. Choose what to export:
   - **Specific boards or layers:** select them on the canvas.
   - **The whole page:** click an empty spot on the canvas so nothing is selected.
3. Open the Plugins manager (**Ctrl + Alt + P**) and run **Export to Figma**.
4. The panel shows the page name and what will be exported. Tick **Include hidden layers** if you want hidden layers too.
5. Click **Export**.

A file named something like `Page 1.penpot-figma.json` downloads, usually into your Downloads folder.

> **No download?** Some browsers block downloads from plugin windows. Click **Copy to clipboard instead**. You'll paste it into Figma in the next step.

## Step 5: Import into Figma

1. In Figma, open the file and go to the page where you want the design.
2. Run **Plugins → Development → Import from Penpot**.
3. Click the dashed box and choose your `.penpot-figma.json` file, or drag the file onto it. If you copied the export instead, paste it into the text box.
4. Leave **Turn Penpot flex layouts into Auto Layout** ticked, unless you want every layer to keep a fixed position.
5. Click **Import**.

The design is built in the same positions as in Penpot, then selected and zoomed to. The panel tells you how many layers were imported, and lists any fonts it had to replace.

## Every time after that

1. Start the plugin server (step 2a).
2. In Penpot: select → **Export to Figma** → **Export**.
3. In Figma: **Import from Penpot** → choose the file → **Import**.

When you're done, close the server window (or press **Ctrl + C** in the terminal).

## Tips for the best result

- **Install your fonts in Figma first.** Penpot uses Google Fonts, and most of these are available in Figma automatically. Custom fonts must be installed on your computer before you import. If a font is missing, the importer uses the closest weight of the same family, or Inter, and tells you which ones it swapped.
- **Export a few boards at a time on big files.** Everything works in one go, but smaller exports are quicker to check.
- **Use flex layouts in Penpot** for anything you want as Auto Layout in Figma. Grid layouts arrive as fixed positions.
- **Images:** PNG, JPG and GIF fills come across as-is. Figma doesn't accept WebP, so those are skipped and listed in the notes.

## Troubleshooting

**Penpot says it can't load the plugin, or the install fails**
- Check that the server window is still open and shows the "being served" message.
- Open `http://localhost:4400/manifest.json` in your browser. You should see a few lines of text. If you don't, the server isn't running, or something else is using port 4400. With Python or Node you can choose another port, for example `python3 serve.py 4401`; then install from `http://localhost:4401/manifest.json`.
- On Windows, if double-clicking the `.bat` file flashes and closes, right-click `serve.ps1` → **Run with PowerShell**.

**The plugin panel opens but stays blank**
- The server was probably closed after the plugin was installed. Start it again, then close and reopen the plugin.

**I can't find "Development" in Figma's plugin menu**
- You're probably in the browser version of Figma. Development plugins can only be imported in the desktop app.

**Figma says "That isn't a Penpot export file"**
- Make sure you chose the `.penpot-figma.json` file, not a `.penpot` file. Penpot's own export format is different and isn't supported.

**Text looks different from Penpot**
- Usually a missing font. The import result lists any fonts it replaced. Install them on your computer, restart Figma, and import again.

**Layout is off inside a frame**
- Untick **Turn Penpot flex layouts into Auto Layout** and import again. Everything keeps its exact Penpot position, but you lose Auto Layout.

Still stuck? [Open an issue](../../issues) with a screenshot and, if you can, the exported `.penpot-figma.json` file.
