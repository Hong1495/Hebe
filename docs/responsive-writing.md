# Responsive writing

Body text and source mode soft-wrap without inserting Markdown line breaks. The writing area stays centered with a maximum width of 760px; side margins shrink with the available editor width, including when the outline is open. Long links and inline code may break visually. Lists use hanging continuation indentation in hybrid mode.

Settings → Editor → **Wrap long lines in code previews** defaults to on and persists across restarts. Off gives rendered code blocks their own horizontal scrollbar. When a code block is revealed for editing, source text always soft-wraps. Formula blocks retain their own horizontal scroll; images preserve aspect ratio.

Table cells wrap and grow vertically. Each column has a minimum width of 9em; wider tables scroll inside their container. Up/Down move within the wrapped cell, Alt+Up/Down move between rows, Tab moves between cells, and Enter moves to the next row. Existing structure shortcuts and multi-cell paste remain available.

PDF export always wraps highlighted and plain code blocks using `fvextra`; this is separate from the preview preference. Minimal TeX installations need that package and its dependencies.

## Verification

- Browser widths 420, 600, 800 and 1200px: no document-wide horizontal overflow; source remains byte-for-byte unchanged during resizing.
- Checked 100–160% zoom with long Chinese/English paragraphs, a continuous URL, list text, long code, long table cells and a wide formula. Table textarea height matches its scroll height; Tab commits and appends/navigates rows.
- Editing plus undo restores the original source; Mod+/ switches source mode without inserting comments.
- Independent macOS preview bundle: outline, settings checkbox, source menu, focus emphasis and typewriter centering checked. Presentation classes are now managed by CodeMirror so transactions cannot remove them.
- Automated autosave regression: presentation settings do not dirty clean tabs or trigger writes.
- PDF: reproduced clipped long code before the fix; rendered a corrected export and checked that the code tail stays on the page. Integration coverage checks tail markers in both highlighted and plain code.

## Limits

Native Chinese IME candidate-window behavior, complex nested lists, extremely wide PDF tables and every image/diagram format have not been exhaustively tested. Browser viewport tests supplement native checks; they are not a complete OS window-drag test matrix.
