import { syntaxTree } from "@codemirror/language";
import { StateEffect, StateField } from "@codemirror/state";
import {
  Decoration,
  type DecorationSet,
  EditorView,
  ViewPlugin,
  type ViewUpdate,
} from "@codemirror/view";

// Track whether the mouse is currently selecting (prevent flicker during drag)
export const setMouseSelecting = StateEffect.define<boolean>();

export const mouseSelectingField = StateField.define<boolean>({
  create() {
    return false;
  },
  update(value, tr) {
    for (const e of tr.effects) {
      if (e.is(setMouseSelecting)) return e.value;
    }
    return value;
  },
});

// Mark types that should be hidden in preview mode
const HIDDEN_MARKS = new Set([
  "HeaderMark",
  "EmphasisMark",
  "StrongMark",
  "CodeMark",
  "LinkMark",
  "QuoteMark",
  "ListMark",
  "LinkReferenceMark",
  "CodeInfo",
  "StrikethroughMark",
]);

function hideMarkDeco(view: EditorView): DecorationSet {
  const decorations: { from: number; to: number; deco: Decoration }[] = [];
  const { state } = view;
  const tree = syntaxTree(state);
  const cursorLine = state.selection.main.head;

  // Determine which lines should have syntax revealed
  const revealLines = new Set<number>();
  const ranges = state.selection.ranges;
  for (const r of ranges) {
    const fromLine = state.doc.lineAt(r.from).number;
    const toLine = state.doc.lineAt(r.to).number;
    for (let i = fromLine; i <= toLine; i++) revealLines.add(i);
  }
  // Always reveal the cursor line
  revealLines.add(state.doc.lineAt(cursorLine).number);

  tree.iterate({
    enter(node) {
      const nodeType = node.type.name;
      if (HIDDEN_MARKS.has(nodeType)) {
        const from = node.from;
        const to = node.to;
        const fromLine = state.doc.lineAt(from).number;
        const toLine = state.doc.lineAt(to).number;

        // Only hide if the mark is NOT on revealed lines
        let onRevealed = false;
        for (let i = fromLine; i <= toLine; i++) {
          if (revealLines.has(i)) {
            onRevealed = true;
            break;
          }
        }

        if (!onRevealed) {
          decorations.push({
            from,
            to,
            deco: Decoration.replace({
              inclusive: false,
            }),
          });
        }
      }

      // Handle inline code: hide backtick markers
      if (nodeType === "Monospace") {
        const from = node.from;
        const to = node.to;
        const fromLine = state.doc.lineAt(from).number;
        const text = state.doc.sliceString(from, to);
        const backtickMatch = text.match(/^`+([\s\S]*?)`+$/);

        if (backtickMatch) {
          let onRevealed = false;
          for (let i = fromLine; i <= state.doc.lineAt(to).number; i++) {
            if (revealLines.has(i)) {
              onRevealed = true;
              break;
            }
          }

          if (!onRevealed) {
            // Find the markers (opening ` + closing ` )
            const openLen = backtickMatch[0].length - backtickMatch[0].replace(/^`+/, "").length;
            const closeLen = backtickMatch[0].length - backtickMatch[0].replace(/`+$/, "").length;

            const innerFrom = from + openLen;
            const innerTo = to - closeLen;

            if (innerFrom < innerTo) {
              decorations.push({
                from,
                to: innerFrom,
                deco: Decoration.replace({}),
              });
              decorations.push({
                from: innerTo,
                to,
                deco: Decoration.replace({}),
              });
            }
          }
        }
      }
    },
  });

  return Decoration.set(
    decorations.map((d) => d.deco.range(d.from, d.to)),
    true,
  );
}

export const pasteImagePlugin = (mdPath: string | null) =>
  EditorView.domEventHandlers({
    paste(event: ClipboardEvent) {
      if (!mdPath) return false;
      const items = event.clipboardData?.items;
      if (!items) return false;
      for (let i = 0; i < items.length; i++) {
        const item = items[i];
        if (item.type.startsWith("image/")) {
          event.preventDefault();
          const blob = item.getAsFile();
          if (!blob) continue;
          const reader = new FileReader();
          reader.onload = async () => {
            const data = Array.from(new Uint8Array(reader.result as ArrayBuffer));
            try {
              const { pasteImage } = await import("../../../lib/ipc");
              const relPath = await pasteImage(data, mdPath);
              const view = EditorView.findFromDOM(
                document.querySelector(".cm-editor") as HTMLElement,
              );
              if (view) {
                view.dispatch({
                  changes: {
                    from: view.state.selection.main.from,
                    insert: `![](${relPath})`,
                  },
                });
              }
            } catch {
              // clipboard paste not available
            }
          };
          reader.readAsArrayBuffer(blob);
          return true;
        }
      }
      return false;
    },
  });

export const inlinePreviewPlugin = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;

    constructor(view: EditorView) {
      this.decorations = hideMarkDeco(view);
    }

    update(update: ViewUpdate) {
      const mouseSelecting = update.state.field(mouseSelectingField, false);
      if (mouseSelecting) return;

      if (update.docChanged || update.selectionSet || update.viewportChanged) {
        this.decorations = hideMarkDeco(update.view);
      }
    }
  },
  {
    decorations: (v) => v.decorations,
    eventHandlers: {
      mousedown() {
        // Deferred: we'll set mouse selecting via an effect
        return false;
      },
    },
  },
);

// Base theme that styles the hidden decorations visually
export const hybridBaseTheme = EditorView.baseTheme({
  ".cm-hybrid-hidden": {
    display: "none !important",
  },
  // When a line is focused (cursor inside), show raw markdown marks
  ".cm-line.cm-activeLine .cm-hybrid-hidden": {
    display: "inline !important",
  },
  "&.cm-editor": {
    height: "100%",
  },
  "&.cm-editor .cm-scroller": {
    fontFamily: "var(--font-sans)",
    fontSize: "var(--editor-font-size)",
    lineHeight: "var(--editor-line-height)",
  },
  "&.cm-editor .cm-content": {
    fontFamily: "var(--font-sans)",
    maxWidth: "var(--editor-width)",
    margin: "0 auto",
    padding: "48px 32px",
  },
  "&.cm-editor.cm-focused": {
    outline: "none",
  },
  // Heading styles (rendered view)
  ".cm-md-heading1": {
    fontSize: "2em",
    fontWeight: "700",
    marginTop: "0.8em",
    marginBottom: "0.4em",
    color: "var(--text-heading)",
  },
  ".cm-md-heading2": {
    fontSize: "1.5em",
    fontWeight: "600",
    marginTop: "0.7em",
    marginBottom: "0.3em",
    color: "var(--text-heading)",
  },
  ".cm-md-heading3": {
    fontSize: "1.25em",
    fontWeight: "600",
    marginTop: "0.6em",
    marginBottom: "0.2em",
    color: "var(--text-heading)",
  },
  // Bold
  ".cm-md-strong": {
    fontWeight: "700",
  },
  // Italic
  ".cm-md-emphasis": {
    fontStyle: "italic",
  },
  // Inline code
  ".cm-md-monospace": {
    fontFamily: "var(--font-mono)",
    fontSize: "0.9em",
    background: "var(--code-bg)",
    borderRadius: "3px",
    padding: "2px 4px",
  },
  // Code blocks
  ".cm-md-codeblock": {
    fontFamily: "var(--font-mono)",
    fontSize: "0.9em",
    background: "var(--code-bg)",
    borderRadius: "6px",
    padding: "12px 16px",
    margin: "8px 0",
  },
});
