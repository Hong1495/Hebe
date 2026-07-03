import { type EditorState, StateEffect, StateField, type Transaction } from "@codemirror/state";
import { Decoration, type DecorationSet, EditorView, WidgetType } from "@codemirror/view";
import {
  type InlineSpanKind,
  type MarkdownLineReplacement,
  pasteMarkdownImage,
  scanMarkdownLineDecorations,
} from "../markdown-kernel";

export interface PreviewRevealRange {
  from: number;
  to: number;
}

export const setPreviewRevealRange = StateEffect.define<PreviewRevealRange | null>();
export const setEditorFocused = StateEffect.define<boolean>();

export const editorFocusedField = StateField.define<boolean>({
  create() {
    return false;
  },
  update(value, tr) {
    for (const effect of tr.effects) {
      if (effect.is(setEditorFocused)) return effect.value;
    }
    return value;
  },
});

export const editorFocusPlugin = EditorView.focusChangeEffect.of((_state, focusing) =>
  setEditorFocused.of(focusing),
);

export const previewRevealRangeField = StateField.define<PreviewRevealRange | null>({
  create() {
    return null;
  },
  update(value, tr) {
    let next = value
      ? {
          from: tr.changes.mapPos(value.from),
          to: tr.changes.mapPos(value.to),
        }
      : null;

    for (const effect of tr.effects) {
      if (effect.is(setPreviewRevealRange)) next = effect.value;
      if (effect.is(setEditorFocused) && !effect.value) next = null;
    }

    if (next && tr.selection && !selectionTouchesRange(tr.state, next.from, next.to)) {
      next = null;
    }

    return next;
  },
});

export function previewDecorationsNeedRefresh(transaction: Transaction): boolean {
  const revealChanged = transaction.effects.some(
    (effect) => effect.is(setPreviewRevealRange) || effect.is(setEditorFocused),
  );
  if (transaction.docChanged || revealChanged) return true;
  if (!transaction.selection) return false;
  return (
    selectionRevealLineSignature(transaction.startState) !==
    selectionRevealLineSignature(transaction.state)
  );
}

interface DecoSpec {
  from: number;
  to: number;
  deco: Decoration;
}

class ListMarkerWidget extends WidgetType {
  private readonly marker: string;
  private readonly checked: boolean | null;
  private readonly checkFrom: number | null;
  private readonly checkTo: number | null;

  constructor(
    marker: string,
    checked: boolean | null = null,
    checkFrom: number | null = null,
    checkTo: number | null = null,
  ) {
    super();
    this.marker = marker;
    this.checked = checked;
    this.checkFrom = checkFrom;
    this.checkTo = checkTo;
  }

  override eq(other: ListMarkerWidget): boolean {
    return (
      other.marker === this.marker &&
      other.checked === this.checked &&
      other.checkFrom === this.checkFrom &&
      other.checkTo === this.checkTo
    );
  }

  toDOM(view: EditorView): HTMLElement {
    const span = document.createElement("span");
    span.className = "cm-list-marker";
    if (this.checked !== null) {
      span.classList.add(this.checked ? "is-checked" : "is-unchecked");
      span.role = "checkbox";
      span.ariaChecked = String(this.checked);
      span.tabIndex = 0;
    }
    span.textContent = this.checked === null ? this.marker : this.checked ? "☑" : "☐";
    if (this.checked !== null && this.checkFrom !== null && this.checkTo !== null) {
      const toggle = (event: Event) => {
        event.preventDefault();
        event.stopPropagation();
        view.dispatch({
          changes: {
            from: this.checkFrom ?? 0,
            to: this.checkTo ?? 0,
            insert: this.checked ? " " : "x",
          },
        });
        view.focus();
      };
      span.addEventListener("mousedown", toggle);
      span.addEventListener("keydown", (event) => {
        if (event.key === "Enter" || event.key === " ") toggle(event);
      });
    }
    return span;
  }

  ignoreEvent(): boolean {
    return false;
  }
}

function hideMarkDeco(state: EditorState): DecorationSet {
  const decorations: DecoSpec[] = [];
  const revealLines = new Set<number>();
  const revealRange = state.field(previewRevealRangeField, false) ?? null;
  const editorFocused = state.field(editorFocusedField, false) ?? false;

  if (editorFocused) {
    for (const r of state.selection.ranges) {
      const fromLine = state.doc.lineAt(r.from).number;
      const toLine = state.doc.lineAt(Math.min(r.to, state.doc.length)).number;
      for (let i = fromLine; i <= toLine; i++) revealLines.add(i);
    }
  }
  if (revealRange) {
    const fromLine = state.doc.lineAt(Math.min(revealRange.from, state.doc.length)).number;
    const toLine = state.doc.lineAt(Math.min(revealRange.to, state.doc.length)).number;
    for (let i = fromLine; i <= toLine; i++) revealLines.add(i);
  }

  for (const line of scanMarkdownLineDecorations(state.doc.toString(), revealLines)) {
    for (const className of line.classes) addLineClass(line.lineFrom, className, decorations);
    for (const replacement of line.replacements) addReplacement(replacement, decorations);
    for (const span of line.inlineSpans) {
      addMark(span.contentFrom, span.contentTo, inlineClassName(span.kind), decorations);
    }
  }

  return Decoration.set(
    decorations.map((d) => d.deco.range(d.from, d.to)),
    true,
  );
}

function inlineClassName(kind: InlineSpanKind): string {
  if (kind === "code") return "md-code";
  if (kind === "link") return "md-link";
  if (kind === "strong") return "md-strong";
  if (kind === "strike") return "md-strike";
  return "md-emphasis";
}

function addLineClass(from: number, className: string, decorations: DecoSpec[]): void {
  decorations.push({
    from,
    to: from,
    deco: Decoration.line({ class: className }),
  });
}

function addMark(from: number, to: number, className: string, decorations: DecoSpec[]): void {
  if (from >= to) return;
  decorations.push({ from, to, deco: Decoration.mark({ class: className }) });
}

function addReplacement(replacement: MarkdownLineReplacement, decorations: DecoSpec[]): void {
  if (replacement.kind === "hide") {
    addReplace(replacement.from, replacement.to, decorations);
    return;
  }

  if (replacement.from >= replacement.to) return;
  decorations.push({
    from: replacement.from,
    to: replacement.to,
    deco: Decoration.replace({
      widget: new ListMarkerWidget(
        replacement.marker === "bullet" ? "•" : (replacement.marker ?? ""),
        replacement.checked ?? null,
        replacement.checkFrom ?? null,
        replacement.checkTo ?? null,
      ),
    }),
  });
}

function addReplace(from: number, to: number, decorations: DecoSpec[]): void {
  if (from >= to) return;
  decorations.push({ from, to, deco: Decoration.replace({ inclusive: false }) });
}

function selectionTouchesRange(
  state: { selection: { ranges: readonly { from: number; to: number }[] } },
  from: number,
  to: number,
): boolean {
  return state.selection.ranges.some((range) => range.from <= to && range.to >= from);
}

function selectionRevealLineSignature(state: EditorState): string {
  const editorFocused = state.field(editorFocusedField, false) ?? false;
  if (!editorFocused) return "";
  return state.selection.ranges
    .map((range) => {
      const fromLine = state.doc.lineAt(range.from).number;
      const toLine = state.doc.lineAt(Math.min(range.to, state.doc.length)).number;
      return `${fromLine}:${toLine}`;
    })
    .join("|");
}

function rangeIsCurrentlyRevealed(state: EditorState, from: number, to: number): boolean {
  const editorFocused = state.field(editorFocusedField, false) ?? false;
  const revealRange = state.field(previewRevealRangeField, false) ?? null;
  return (
    (editorFocused && selectionTouchesRange(state, from, to)) ||
    (revealRange !== null && revealRange.from <= to && revealRange.to >= from)
  );
}

export const pasteImagePlugin = (mdPath: string | null) =>
  EditorView.domEventHandlers({
    paste(event: ClipboardEvent, view: EditorView) {
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
              const imageMarkdown = `![](${relPath})`;
              const selection = view.state.selection.main;
              const paste = pasteMarkdownImage(
                view.state.doc.toString(),
                { from: selection.from, to: selection.to },
                imageMarkdown,
              );
              view.dispatch({
                changes: paste.changes[0],
                selection: { anchor: paste.selection.from },
                effects: setPreviewRevealRange.of(null),
                scrollIntoView: true,
              });
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

export const inlinePreviewPlugin = StateField.define<DecorationSet>({
  create(state) {
    return hideMarkDeco(state);
  },
  update(decorations, transaction) {
    if (previewDecorationsNeedRefresh(transaction)) {
      return hideMarkDeco(transaction.state);
    }
    return decorations.map(transaction.changes);
  },
  provide(field) {
    return EditorView.decorations.from(field);
  },
});

export const clickRevealPlugin = (() => {
  return EditorView.domEventHandlers({
    mousedown(event, view) {
      if (
        event.button !== 0 ||
        event.detail > 1 ||
        event.shiftKey ||
        event.metaKey ||
        event.altKey ||
        event.ctrlKey ||
        (event.target instanceof Element && event.target.closest(".cm-editable-widget"))
      ) {
        return false;
      }

      const click = clickPositionFromEvent(event, view);
      if (!click) return false;
      if (rangeIsCurrentlyRevealed(view.state, click.lineFrom, click.lineTo)) return false;

      event.preventDefault();
      view.dispatch({
        selection: { anchor: click.pos, head: click.pos },
        effects: setPreviewRevealRange.of({ from: click.lineFrom, to: click.lineTo }),
      });
      refineCursorAfterReveal(view, event.clientX, event.clientY, click.lineFrom, click.lineTo);
      view.focus();
      return true;
    },
  });
})();

interface ClickPosition {
  pos: number;
  lineFrom: number;
  lineTo: number;
}

function clickPositionFromEvent(event: MouseEvent, view: EditorView): ClickPosition | null {
  const targetLine = lineFromEventTarget(event, view);
  const coordsPos = view.posAtCoords({ x: event.clientX, y: event.clientY }, false);

  if (targetLine) {
    const pos = visualPositionInLine(
      event.clientX,
      event.clientY,
      view,
      targetLine.element,
      targetLine.line,
    );
    return { pos, lineFrom: targetLine.line.from, lineTo: targetLine.line.to };
  }

  if (coordsPos === null) return null;
  const line = view.state.doc.lineAt(coordsPos);
  return { pos: coordsPos, lineFrom: line.from, lineTo: line.to };
}

function refineCursorAfterReveal(
  view: EditorView,
  clientX: number,
  clientY: number,
  lineFrom: number,
  lineTo: number,
): void {
  view.requestMeasure({
    read(measuringView) {
      return positionFromCoordinates(measuringView, clientX, clientY, lineFrom, lineTo);
    },
    write(pos, measuringView) {
      if (pos === null) return;
      const line = measuringView.state.doc.lineAt(
        Math.min(lineFrom, measuringView.state.doc.length),
      );
      const cursor = clampInt(pos, line.from, line.to);
      const selection = measuringView.state.selection.main;
      if (selection.empty && selection.from === cursor) return;
      measuringView.dispatch({ selection: { anchor: cursor, head: cursor } });
    },
  });
}

function positionFromCoordinates(
  view: EditorView,
  clientX: number,
  clientY: number,
  lineFrom: number,
  lineTo: number,
): number | null {
  const doc = view.state.doc;
  if (doc.length === 0) return 0;

  const targetLine = doc.lineAt(Math.min(lineFrom, doc.length));
  const coordsPos = view.posAtCoords({ x: clientX, y: clientY }, false);
  if (coordsPos !== null) {
    const coordsLine = doc.lineAt(clampInt(coordsPos, 0, doc.length));
    if (coordsLine.number === targetLine.number) {
      return clampInt(coordsPos, targetLine.from, targetLine.to);
    }
  }

  const lineElement = lineElementAtPosition(view, targetLine.from);
  if (lineElement) {
    return visualPositionInLine(clientX, clientY, view, lineElement, targetLine);
  }

  return clampInt(lineFrom, targetLine.from, Math.min(lineTo, targetLine.to));
}

function lineElementAtPosition(view: EditorView, pos: number): HTMLElement | null {
  try {
    const dom = view.domAtPos(pos);
    const element = dom.node instanceof Element ? dom.node : dom.node.parentElement;
    return element?.closest(".cm-line") as HTMLElement | null;
  } catch {
    return null;
  }
}

function lineFromEventTarget(event: MouseEvent, view: EditorView) {
  const target = eventTargetElement(event);
  const lineElement = target?.closest(".cm-line") as HTMLElement | null;
  if (!lineElement) return null;

  try {
    const line = view.state.doc.lineAt(view.posAtDOM(lineElement, 0));
    return { element: lineElement, line };
  } catch {
    return null;
  }
}

function eventTargetElement(event: MouseEvent): Element | null {
  if (event.target instanceof Element) return event.target;
  if (event.target instanceof Node) return event.target.parentElement;
  return null;
}

function visualPositionInLine(
  clientX: number,
  clientY: number,
  view: EditorView,
  element: HTMLElement,
  line: { from: number; to: number },
): number {
  const visibleBounds = visibleTextBounds(element);
  if (visibleBounds) {
    if (clientX < visibleBounds.left - 1) return line.from;
    if (clientX > visibleBounds.right + 1) return line.to;
  }

  const caretPos = domCaretPositionFromPoint(clientX, clientY, view, line.from, line.to);
  if (caretPos !== null) return caretPos;

  const coordsPos = view.posAtCoords({ x: clientX, y: clientY }, false);
  if (coordsPos !== null) {
    const coordsLine = view.state.doc.lineAt(coordsPos);
    if (coordsLine.from === line.from && coordsLine.to === line.to) {
      return clampInt(coordsPos, line.from, line.to);
    }
  }

  return approximatePositionInLine(clientX, element, line.from, line.to);
}

function domCaretPositionFromPoint(
  clientX: number,
  clientY: number,
  view: EditorView,
  from: number,
  to: number,
): number | null {
  const doc = document as Document & {
    caretPositionFromPoint?: (x: number, y: number) => { offsetNode: Node; offset: number } | null;
    caretRangeFromPoint?: (x: number, y: number) => Range | null;
  };

  try {
    const caret = doc.caretPositionFromPoint?.(clientX, clientY);
    if (caret) {
      const pos = view.posAtDOM(caret.offsetNode, caret.offset);
      if (pos >= from && pos <= to) return clampInt(pos, from, to);
    }
  } catch {
    // Some WebKit builds throw for widget DOM nodes. Fall back below.
  }

  try {
    const range = doc.caretRangeFromPoint?.(clientX, clientY);
    if (range) {
      const pos = view.posAtDOM(range.startContainer, range.startOffset);
      if (pos >= from && pos <= to) return clampInt(pos, from, to);
    }
  } catch {
    // Fall through to coordinate and ratio based fallback.
  }

  return null;
}

function visibleTextBounds(element: HTMLElement): { left: number; right: number } | null {
  const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      return node.textContent && node.textContent.length > 0
        ? NodeFilter.FILTER_ACCEPT
        : NodeFilter.FILTER_REJECT;
    },
  });
  const range = document.createRange();
  let left = Number.POSITIVE_INFINITY;
  let right = Number.NEGATIVE_INFINITY;

  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    range.selectNodeContents(node);
    for (const rect of Array.from(range.getClientRects())) {
      if (rect.width <= 0 && rect.height <= 0) continue;
      left = Math.min(left, rect.left);
      right = Math.max(right, rect.right);
    }
  }

  range.detach();
  if (!Number.isFinite(left) || !Number.isFinite(right)) return null;
  return { left, right };
}

function approximatePositionInLine(
  clientX: number,
  element: HTMLElement,
  from: number,
  to: number,
): number {
  const bounds = visibleTextBounds(element);
  const rect = bounds ?? element.getBoundingClientRect();
  const width = Math.max(0, rect.right - rect.left);
  const ratio = width > 0 ? clamp((clientX - rect.left) / width, 0, 1) : 0;
  return from + Math.round(ratio * Math.max(0, to - from));
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function clampInt(value: number, min: number, max: number): number {
  return Math.round(clamp(value, min, max));
}

// Base theme that styles the hidden decorations visually
export const hybridBaseTheme = EditorView.baseTheme({
  ".cm-hybrid-hidden": {
    display: "none !important",
  },
  // When a line is focused (cursor inside), show raw markdown marks
  ".cm-line.cm-activeLine .cm-hybrid-hidden": {
    display: "inline !important",
  },
  ".cm-line": {
    padding: "1px 0",
  },
  ".cm-line.cm-activeLine": {
    background: "transparent",
  },
  ".cm-activeLineGutter": {
    background: "transparent",
  },
  "&.cm-editor": {
    height: "100%",
    color: "var(--md-text)",
    background: "var(--bg)",
  },
  "&.cm-editor .cm-cursor": {
    borderLeftColor: "var(--accent)",
  },
  "&.cm-editor .cm-selectionBackground, &.cm-editor.cm-focused .cm-selectionBackground": {
    backgroundColor: "var(--select-bg)",
  },
  "&.cm-editor .cm-gutters": {
    color: "var(--text-secondary)",
    backgroundColor: "var(--bg)",
    border: "0",
  },
  "&.cm-editor .cm-scroller": {
    fontFamily: "var(--font-sans)",
    fontSize: "var(--editor-font-size)",
    lineHeight: "var(--editor-line-height)",
    scrollbarWidth: "none",
  },
  "&.cm-editor .cm-scroller::-webkit-scrollbar": {
    width: "0",
    height: "0",
  },
  "&.cm-editor .cm-content": {
    fontFamily: "var(--font-sans)",
    width: "min(var(--editor-width), calc(100% - 112px))",
    maxWidth: "calc(100% - 112px)",
    margin: "0 auto",
    padding: "52px 0 110px",
    boxSizing: "border-box",
  },
  "&.cm-editor.cm-focused": {
    outline: "none",
  },
  ".md-heading-1": {
    fontSize: "1.85em",
    fontWeight: "700",
    color: "var(--md-heading)",
  },
  ".md-heading-2": {
    fontSize: "1.38em",
    fontWeight: "650",
    color: "var(--md-heading)",
  },
  ".md-heading-3": {
    fontSize: "1.18em",
    fontWeight: "620",
    color: "var(--md-heading)",
  },
  ".md-heading": {
    fontWeight: "600",
    color: "var(--md-heading)",
  },
  ".md-strong": {
    fontWeight: "700",
    color: "var(--md-strong)",
  },
  ".md-emphasis": {
    fontStyle: "italic",
  },
  ".md-link": {
    color: "var(--md-link)",
    textDecoration: "none",
    borderBottom: "1px solid var(--md-link-border)",
  },
  ".md-url": {
    color: "var(--md-muted)",
  },
  ".md-code": {
    fontFamily: "var(--font-mono)",
    fontSize: "0.9em",
    color: "var(--md-inline-code-text)",
    background: "var(--md-inline-code-bg)",
    borderRadius: "4px",
    padding: "0 0.28em",
  },
  ".md-quote": {
    color: "var(--md-quote-text)",
  },
  ".md-list": {
    color: "var(--md-muted)",
  },
  ".md-list-line": {
    color: "var(--md-text)",
  },
  ".cm-list-marker": {
    display: "inline-block",
    minWidth: "1.35em",
    color: "var(--md-muted)",
    fontWeight: "500",
  },
  ".cm-list-marker.is-checked": {
    color: "var(--md-link)",
  },
  ".md-mark": {
    color: "var(--md-mark)",
  },
  ".md-strike": {
    textDecoration: "line-through",
    color: "var(--md-muted)",
  },
  ".md-quote-line": {
    color: "var(--md-quote-text)",
    borderLeft: "2px solid var(--md-quote-border)",
    paddingLeft: "12px",
  },
  ".md-code-block-line": {
    fontFamily: "var(--font-mono)",
    fontSize: "0.92em",
    color: "var(--md-code-block-text)",
  },
  ".md-code-fence-line": {
    fontFamily: "var(--font-mono)",
    color: "var(--md-mark)",
  },
  ".md-rule-line": {
    color: "transparent",
    borderTop: "1px solid var(--md-rule)",
    transform: "translateY(0.8em)",
  },
  ".md-separator": {
    color: "transparent",
  },
  // Heading styles (rendered view)
  ".cm-md-heading1": {
    fontSize: "1.85em",
    fontWeight: "700",
    marginTop: "0.9em",
    marginBottom: "0.45em",
    color: "var(--md-heading)",
  },
  ".cm-md-heading2": {
    fontSize: "1.38em",
    fontWeight: "600",
    marginTop: "0.8em",
    marginBottom: "0.35em",
    color: "var(--md-heading)",
  },
  ".cm-md-heading3": {
    fontSize: "1.18em",
    fontWeight: "600",
    marginTop: "0.6em",
    marginBottom: "0.2em",
    color: "var(--md-heading)",
  },
  // Bold
  ".cm-md-strong": {
    fontWeight: "700",
    color: "var(--md-strong)",
  },
  // Italic
  ".cm-md-emphasis": {
    fontStyle: "italic",
  },
  // Inline code
  ".cm-md-monospace": {
    fontFamily: "var(--font-mono)",
    fontSize: "0.9em",
    color: "var(--md-inline-code-text)",
    background: "var(--md-inline-code-bg)",
    borderRadius: "4px",
    padding: "0 0.28em",
  },
  // Code blocks
  ".cm-md-codeblock": {
    fontFamily: "var(--font-mono)",
    fontSize: "0.9em",
    color: "var(--md-code-block-text)",
    background: "var(--md-code-block-bg)",
    padding: "0 14px",
  },
  ".cm-code-block-widget .tok-keyword": {
    color: "var(--md-link)",
    fontWeight: "600",
  },
  ".cm-code-block-widget .tok-string": {
    color: "var(--md-strong)",
  },
  ".cm-code-block-widget .tok-literal": {
    color: "var(--accent)",
  },
  ".cm-code-block-widget .tok-comment": {
    color: "var(--md-muted)",
    fontStyle: "italic",
  },
  ".cm-code-block-widget .tok-function": {
    color: "var(--md-heading)",
  },
  ".cm-code-block-widget .tok-type": {
    color: "var(--md-link)",
  },
  ".cm-code-block-widget .tok-punctuation": {
    color: "var(--md-mark)",
  },
});
