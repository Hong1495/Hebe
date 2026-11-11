# Writing foundations verification

Implemented after v1.1.1; this document describes current source, not a published installer.

## Automated checks

- 73 frontend tests cover Markdown editing, updater background behavior, tab history, saved-snapshot acknowledgements, per-tab autosave, conflict blocking, IME synchronization guards, draft validation, metadata isolation, TOC and footnotes.
- 7 Rust tests cover atomic replacement, stale/deleted-file rejection, symlink/permission preservation, relative image export, failed-export preservation, Chinese PDF pagination/footnotes, SVG rendering and restart targeting. Tests requiring Pandoc/TeX skip when those tools are absent; both tools were installed for local verification.
- Production TypeScript/Vite build passes. Large Mermaid dependencies still produce the existing chunk-size advisory.

## Interactive checks

- Browser: metadata and contents preview, Chinese text, footnote and heading navigation, list Enter continuation, undo, refresh recovery of an untitled draft.
- Isolated macOS test bundle: focus emphasis, centered typewriter cursor, cross-paragraph selection/deletion and full undo.
- Real exported PDF: Chinese title and footnote extraction, multiple pages, rendered first and second pages checked for readable text, margins and page numbers.

## Remaining limits

- Native Chinese IME candidate-window flows were not fully exercised. Composition guards prevent autosave and external reload during composition; that automated coverage is not a substitute for input-method testing.
- Recovery uses local WebView storage. Quota/write failures are visible, and clearing application data removes recovery snapshots. Undo history is not persisted across restart.
- External applications do not share Hebe’s save mutex. Baseline comparison plus atomic replacement detects observed changes but cannot make simultaneous cross-process writes transactional.
- Front Matter is preserved as source; the editor does not validate YAML. Footnote definitions support four-space/tab continuation; complex nested footnote content is shown as text in the editor, while Pandoc handles exported formatting.
