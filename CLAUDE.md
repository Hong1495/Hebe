# CLAUDE.md

Hebe is a private Tauri 2 + React + CodeMirror Markdown editor. The product
target is a clean, Typora-like desktop app: native menus, minimal chrome,
resizable optional sidebars, and a hybrid Markdown engine that previews structure
while preserving source-first editing.

## Non-negotiables

- Preserve the Typora-like writing feel. The editor surface is primary; chrome,
  tabs, sidebars, and status UI must stay quiet and compact.
- Use native OS affordances where possible. App commands belong in the system
  menu, not in large in-app toolbars.
- Keep sidebars collapsed by default and resizable when visible.
- Do not add landing-page or marketing-style UI inside the app.
- Do not commit build outputs, dependencies, `.app`, `.dmg`, `dist`,
  `node_modules`, or `src-tauri/target`.
- The user tests releases from `/Applications/Hebe.app` and often keeps a copy
  on the Desktop. Kill the running `hebe` process before replacing either app.

## Project Structure

```text
src/
  App.tsx                         App shell, theme sync, drag/open events
  stores/app-store.ts             Zustand state: tabs, layout, theme, zoom, recent files
  lib/ipc.ts                      Typed Tauri command wrappers
  components/layout/              TabBar, EditorArea, Sidebar, OutlinePanel, StatusBar, Settings
  components/editor/HybridEditor.tsx
  components/editor/extensions/
    hybrid-preview.ts             Inline WYSIWYG decorations and reveal logic
    block-widgets.ts              Editable block widgets for code/math/table/image/Mermaid
src-tauri/
  src/lib.rs                      Tauri builder, menu, close/reopen/open-file lifecycle
  src/commands/                   File, folder, export, search, image, reveal commands
```

## Markdown Kernel

The editor is not a separate source pane plus HTML preview. CodeMirror owns the
canonical Markdown document, and preview behavior is layered on top with
decorations and widgets.

Key files:

- `HybridEditor.tsx` wires CodeMirror extensions, keymaps, theme highlighting,
  paste handling, and block widget support.
- `hybrid-preview.ts` hides Markdown markers in preview mode and reveals raw
  source for the active line/range.
- `block-widgets.ts` replaces larger blocks with editable widgets when they are
  not revealed.

Kernel rules:

- Source text is always canonical.
- Fenced code blocks are isolation boundaries; never run inline Markdown
  scanners inside code fences.
- Every block widget must reveal its original source range on click/keyboard
  activation.
- Click reveal for unrevealed text happens on `mousedown` to avoid transient
  selection of adjacent widgets.
- If a range is already revealed, let CodeMirror handle normal cursor movement
  and text selection.
- Avoid expensive full-document work. Scan linearly, skip known block ranges,
  and keep inline scan length caps.

Supported block widgets:

- Fenced code blocks.
- Mermaid fenced blocks.
- KaTeX block math.
- Markdown tables.
- Local images resolved relative to the current Markdown file.

Supported inline preview:

- Headings, strong/emphasis/strike, links, inline code.
- Block quotes, lists, task lists, horizontal rules.

## Native Shell

- Tauri menus are declared in `src-tauri/src/lib.rs` and emit `menu-action`.
- `EditorArea.tsx` consumes menu actions for file operations, navigation,
  settings, sidebars, focus/typewriter modes, and zoom.
- Closing the window hides it instead of quitting.
- macOS open/reopen events show/focus the window and pass Markdown paths to the
  frontend.
- Startup paths are queued through `take_pending_open_files`.

## State Model

- `app-store.ts` owns tabs, active tab index, dirty state, layout visibility,
  sidebar widths, theme, zoom, folder path, and recent files.
- `openFile` deduplicates by path and replaces the initial empty tab when safe.
- `updateActiveContent` marks the active tab dirty.
- Saved files auto-save after a short debounce; clean tabs can reload external
  mtime changes.

## Checks

Run these before shipping meaningful changes:

```bash
npm run build
cargo check --manifest-path src-tauri/Cargo.toml
```

For formatting specific frontend files:

```bash
npx biome format --write <files>
```

## Release Build

```bash
npm run tauri -- build --bundles app
pkill -x hebe || true
rm -rf /Applications/Hebe.app "$HOME/Desktop/Hebe.app"
cp -R src-tauri/target/release/bundle/macos/Hebe.app /Applications/Hebe.app
cp -R src-tauri/target/release/bundle/macos/Hebe.app "$HOME/Desktop/Hebe.app"
```

Current stripped macOS `.app` size is about 16 MB. Large frontend chunks mostly
come from Mermaid and KaTeX; do not add new heavyweight rendering dependencies
without a clear product reason.
