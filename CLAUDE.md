# CLAUDE.md

This is a Tauri 2 Markdown editor (Hebe). General principles: prefer simplicity, edit existing files, verify with tsc + cargo build.

## Project structure
```
hebe/
├── src/                  # React 19 + TypeScript + Vite frontend
│   ├── components/editor/  # CodeMirror 6 Hybrid Editor
│   ├── components/layout/  # App layout (EditorArea, Sidebar, OutlinePanel, TabBar, etc.)
│   ├── stores/             # Zustand state management (TabState[] for multi-tab)
│   ├── lib/ipc.ts          # Tauri IPC type-safe wrappers
│   └── index.css           # Tailwind 4 + CSS variables (System/Light/Dark themes)
├── src-tauri/            # Rust backend
│   ├── src/commands/       # Tauri commands (file, dir, export, search, image, reveal)
│   └── src/lib.rs          # Tauri Builder with plugin registration
├── packages.json
├── vite.config.ts
├── biome.json
└── tsconfig.json
```

## Key files
- `src/stores/app-store.ts` — Zustand store: TabState[], currentFilePath(), currentContent(), openFile, closeTab, moveTab
- `src/components/editor/HybridEditor.tsx` — CM6 React wrapper with Markdown highlighting, paste plugin, outline jump
- `src/components/editor/extensions/hybrid-preview.ts` — Inline WYSIWYG decorations + pasteImagePlugin
- `src/components/editor/extensions/block-widgets.ts` — KaTeX/Mermaid/Image block widgets
- `src/components/layout/EditorArea.tsx` — Toolbar + TabBar + editor + auto-save + file watching + GlobalSearch + QuickOpen
- `src/components/layout/TabBar.tsx` — Tab rendering with drag-to-reorder + right-click context menu
- `src/components/layout/Sidebar.tsx` — File tree with subdirectory navigation + right-click context menu

## Check commands
```bash
npx biome check --write src/       # Format + lint
npx tsc -b                          # Type-check
cargo build --manifest-path src-tauri/Cargo.toml  # Rust build
npx vite build                      # Frontend production build
```

## Rust dependencies
- pulldown-cmark (0.12) — heading outline extraction
- tantivy (0.22) — full-text search with in-memory index
- Tauri plugins: dialog, fs, store, window-state, clipboard-manager, log

## Key patterns
- Theme system: store keeps `system | light | dark`; App resolves `system` to `light | dark` and writes CSS `[data-theme="light/dark"]`
- Markdown styling: keep internal `--md-*` semantic colors for light/dark readability; do not add separate Markdown theme choices unless the product scope changes
- File watching: 2s poll `stat()` mtime, uses `setTabContent` to avoid dirty flag
- Auto-save: 3s debounce via `dirtyRef`, only when `currentFilePath` exists
- Search index: `static SEARCH_CACHE: Mutex<SearchCache>` — rebuilds only on folder change
- Tab management: `openFile` deduplicates by path, replaces empty placeholder tab
