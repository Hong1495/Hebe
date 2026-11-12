# Responsive writing

Body text and source mode soft-wrap without inserting Markdown line breaks. The writing area stays centered with a maximum width of 760px; side margins shrink with the available editor width, including when the outline is open. Long links and inline code may break visually. Lists use hanging continuation indentation in hybrid mode.

Settings → Editor → **Wrap long lines in code previews** defaults to on and persists across restarts. Off gives rendered code blocks their own horizontal scrollbar. When a code block is revealed for editing, source text always soft-wraps. Formula blocks retain their own horizontal scroll; images preserve aspect ratio.

Table cells wrap and grow vertically. Each column has a minimum width of 9em; wider tables scroll inside their container. Up/Down move within the wrapped cell, Alt+Up/Down move between rows, Tab moves between cells, and Enter moves to the next row. Existing structure shortcuts and multi-cell paste remain available.

PDF export always wraps highlighted and plain code blocks using `fvextra`; this is separate from the preview preference. Minimal TeX installations need that package and its dependencies. PDF tables use wrapping columns. Wide tables are split into column groups (4–6 columns depending on paper and margins), with the first column repeated as a row reference; captions remain with the first group. Long identifiers and inline code can break inside cells. Wide tables with merged cells fail with an explicit message instead of silently losing their structure. Markdown and other export formats are unchanged.

## Verification

- Browser widths 420, 600, 800 and 1200px: no document-wide horizontal overflow; source remains byte-for-byte unchanged during resizing.
- Checked 100–160% zoom with long Chinese/English paragraphs, a continuous URL, list text, long code, long table cells and a wide formula. Table textarea height matches its scroll height; Tab commits and appends/navigates rows.
- Editing plus undo restores the original source; Mod+/ switches source mode without inserting comments.
- Independent macOS preview bundle: outline, settings checkbox, source menu, focus emphasis and typewriter centering checked. Presentation classes are now managed by CodeMirror so transactions cannot remove them.
- Automated autosave regression: presentation settings do not dirty clean tabs or trigger writes.
- PDF: reproduced clipped long code and overlapping 16-column tables before the fixes. Rendered corrected exports and checked the full page. Integration coverage checks all 48 table cells, a 300-character token, escaped inline code, unchanged source, and text bounds at A4/10mm/10pt, A4/40mm/12pt and Letter/20mm/11pt. Existing tests cover Chinese footnotes, pagination, overwrites and relative assets.
- Native Pinyin: confirmed pre-edit and Space submission in body text and table cells; Down selected another candidate in wrapped body text. Reproduced Enter ending composition and also navigating a table row. Added the WebKit keyCode 229 guard. Final rebuilt native application confirmed Mod+/ changes source mode without inserting comments, and ordinary table commit/navigation works.

## Limits

Final native IME confirmation-key retesting is blocked by the current input-source state: after restarting the preview, the selected source reported WeType and the supported UI controls could not re-enter Chinese composition. System input-menu accessibility calls timed out. The final WebKit guard is therefore not claimed as native-verified. Candidate-panel positioning was not captured by app-window screenshots. Complex nested lists and every image/diagram format have not been exhaustively tested. Browser viewport tests supplement native checks; they are not a complete OS window-drag test matrix.
