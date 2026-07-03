import { LanguageDescription } from "@codemirror/language";
import { languages } from "@codemirror/language-data";
import { type EditorState, StateField } from "@codemirror/state";
import { Decoration, type DecorationSet, EditorView, WidgetType } from "@codemirror/view";
import { highlightCode, tags as highlightTags, tagHighlighter } from "@lezer/highlight";
import { convertFileSrc } from "@tauri-apps/api/core";
import katex from "katex";
import { isTauriRuntime } from "../../../lib/ipc";
import { dirname } from "../../../lib/path";
import {
  type MarkdownTableCellTarget,
  markdownBlockPositionFromHit,
  markdownSourceRangePositionFromRatio,
  parseMarkdownBlocks,
  type TableBlock,
  updateMarkdownTableCell,
} from "../markdown-kernel";
import {
  editorFocusedField,
  previewDecorationsNeedRefresh,
  previewRevealRangeField,
  setPreviewRevealRange,
} from "./hybrid-preview";

let widgetIdCounter = 0;

const codeHighlighter = tagHighlighter([
  { tag: highlightTags.keyword, class: "tok-keyword" },
  { tag: [highlightTags.string, highlightTags.special(highlightTags.string)], class: "tok-string" },
  { tag: [highlightTags.number, highlightTags.bool, highlightTags.null], class: "tok-literal" },
  {
    tag: [highlightTags.comment, highlightTags.lineComment, highlightTags.blockComment],
    class: "tok-comment",
  },
  {
    tag: [
      highlightTags.function(highlightTags.variableName),
      highlightTags.function(highlightTags.propertyName),
    ],
    class: "tok-function",
  },
  { tag: [highlightTags.typeName, highlightTags.className], class: "tok-type" },
  { tag: [highlightTags.operator, highlightTags.punctuation], class: "tok-punctuation" },
]);

class MathWidget extends WidgetType {
  readonly latex: string;
  readonly displayMode: boolean;
  private readonly revealFrom: number | null;
  private readonly revealTo: number | null;
  private readonly cursorFrom: number | null;
  private readonly cursorTo: number | null;

  constructor(
    latex: string,
    displayMode: boolean,
    revealFrom: number | null = null,
    revealTo: number | null = null,
    cursorFrom: number | null = null,
    cursorTo: number | null = null,
  ) {
    super();
    this.latex = latex;
    this.displayMode = displayMode;
    this.revealFrom = revealFrom;
    this.revealTo = revealTo;
    this.cursorFrom = cursorFrom;
    this.cursorTo = cursorTo;
  }

  override eq(other: MathWidget): boolean {
    return (
      other.latex === this.latex &&
      other.displayMode === this.displayMode &&
      other.revealFrom === this.revealFrom &&
      other.revealTo === this.revealTo &&
      other.cursorFrom === this.cursorFrom &&
      other.cursorTo === this.cursorTo
    );
  }

  toDOM(view: EditorView): HTMLElement {
    const span = document.createElement("span");
    span.className = this.displayMode ? "cm-math-block" : "cm-math-inline";
    if (this.revealFrom !== null) {
      makeEditableWidget(span, view, this.revealFrom, this.revealTo ?? this.revealFrom, {
        cursorFrom: this.cursorFrom ?? this.revealFrom,
        cursorTo: this.cursorTo ?? this.revealTo ?? this.revealFrom,
      });
    }
    try {
      katex.render(this.latex, span, {
        displayMode: this.displayMode,
        throwOnError: false,
        trust: false,
      });
    } catch {
      span.textContent = this.latex;
    }
    return span;
  }

  ignoreEvent(): boolean {
    return false;
  }
}

class MermaidWidget extends WidgetType {
  readonly code: string;
  private id: string;
  private readonly revealFrom: number;
  private readonly revealTo: number;
  private readonly cursorFrom: number;
  private readonly cursorTo: number;

  constructor(
    code: string,
    revealFrom: number,
    revealTo: number,
    cursorFrom: number,
    cursorTo: number,
  ) {
    super();
    this.code = code;
    this.id = `mermaid-${(widgetIdCounter++).toString(36)}`;
    this.revealFrom = revealFrom;
    this.revealTo = revealTo;
    this.cursorFrom = cursorFrom;
    this.cursorTo = cursorTo;
  }

  override eq(other: MermaidWidget): boolean {
    return (
      other.code === this.code &&
      other.revealFrom === this.revealFrom &&
      other.revealTo === this.revealTo &&
      other.cursorFrom === this.cursorFrom &&
      other.cursorTo === this.cursorTo
    );
  }

  toDOM(view: EditorView): HTMLElement {
    const container = document.createElement("div");
    container.className = "cm-mermaid-container";
    makeEditableWidget(container, view, this.revealFrom, this.revealTo, {
      cursorFrom: this.cursorFrom,
      cursorTo: this.cursorTo,
    });

    const fallback = document.createElement("pre");
    fallback.className = "cm-mermaid-code";
    fallback.textContent = this.code;

    const diagram = document.createElement("div");
    diagram.className = "cm-mermaid-diagram";
    container.append(fallback, diagram);

    void (async () => {
      try {
        const { default: mermaid } = await import("mermaid");
        mermaid.initialize({ startOnLoad: false, securityLevel: "strict" });
        const result = await mermaid.render(`${this.id}-svg`, this.code);
        if (!container.isConnected) return;
        diagram.innerHTML = result.svg;
        result.bindFunctions?.(diagram);
        fallback.hidden = true;
      } catch (error) {
        const message = formatWidgetError(error);
        fallback.dataset.error = message;
        fallback.title = message;
        diagram.replaceChildren();
      }
    })();

    return container;
  }

  ignoreEvent(): boolean {
    return false;
  }
}

class CodeBlockWidget extends WidgetType {
  readonly code: string;
  private readonly language: string | null;
  private readonly revealFrom: number;
  private readonly revealTo: number;
  private readonly cursorFrom: number;
  private readonly cursorTo: number;

  constructor(
    code: string,
    language: string | null,
    revealFrom: number,
    revealTo: number,
    cursorFrom: number,
    cursorTo: number,
  ) {
    super();
    this.code = code;
    this.language = language;
    this.revealFrom = revealFrom;
    this.revealTo = revealTo;
    this.cursorFrom = cursorFrom;
    this.cursorTo = cursorTo;
  }

  override eq(other: CodeBlockWidget): boolean {
    return (
      other.code === this.code &&
      other.language === this.language &&
      other.revealFrom === this.revealFrom &&
      other.revealTo === this.revealTo &&
      other.cursorFrom === this.cursorFrom &&
      other.cursorTo === this.cursorTo
    );
  }

  toDOM(view: EditorView): HTMLElement {
    const pre = document.createElement("pre");
    pre.className = "cm-code-block-widget";
    if (this.language) pre.dataset.language = this.language;

    const code = document.createElement("code");
    code.textContent = this.code;
    pre.appendChild(code);
    makeEditableWidget(pre, view, this.revealFrom, this.revealTo, {
      cursorFrom: this.cursorFrom,
      cursorTo: this.cursorTo,
      positionFromEvent: (event) =>
        codeBlockPositionFromEvent(event, code, this.cursorFrom, this.cursorTo),
    });

    if (this.language) {
      void highlightCodeElement(code, this.code, this.language);
    }

    return pre;
  }

  ignoreEvent(): boolean {
    return false;
  }
}

async function highlightCodeElement(
  element: HTMLElement,
  source: string,
  languageName: string,
): Promise<void> {
  try {
    const description = LanguageDescription.matchLanguageName(languages, languageName, true);
    if (!description) return;

    const support = await description.load();
    const tree = support.language.parser.parse(source);
    if (!element.isConnected) return;

    element.replaceChildren();
    highlightCode(
      source,
      tree,
      codeHighlighter,
      (text, classes) => {
        if (!classes) {
          element.appendChild(document.createTextNode(text));
          return;
        }
        const span = document.createElement("span");
        span.className = classes;
        span.textContent = text;
        element.appendChild(span);
      },
      () => element.appendChild(document.createTextNode("\n")),
    );
  } catch {
    // Unknown or unavailable language packages fall back to plain text.
  }
}

class ImageWidget extends WidgetType {
  readonly alt: string;
  readonly src: string;
  private readonly revealFrom: number;
  private readonly revealTo: number;

  constructor(alt: string, src: string, revealFrom: number, revealTo: number) {
    super();
    this.alt = alt;
    this.src = src;
    this.revealFrom = revealFrom;
    this.revealTo = revealTo;
  }

  override eq(other: ImageWidget): boolean {
    return (
      other.src === this.src &&
      other.revealFrom === this.revealFrom &&
      other.revealTo === this.revealTo
    );
  }

  toDOM(view: EditorView): HTMLElement {
    const container = document.createElement("div");
    container.className = "cm-image-container";
    makeEditableWidget(container, view, this.revealFrom, this.revealTo);

    const img = document.createElement("img");
    img.src = this.src;
    img.alt = this.alt;
    img.loading = "lazy";

    img.onerror = () => {
      container.replaceChildren(createFallbackText(this.alt || this.src));
    };

    container.appendChild(img);
    return container;
  }

  ignoreEvent(): boolean {
    return false;
  }
}

class TableWidget extends WidgetType {
  readonly block: TableBlock;
  private readonly key: string;
  private readonly revealFrom: number;
  private readonly revealTo: number;

  constructor(block: TableBlock, revealFrom: number, revealTo: number) {
    super();
    this.block = block;
    this.key = JSON.stringify(block.table);
    this.revealFrom = revealFrom;
    this.revealTo = revealTo;
  }

  override eq(other: TableWidget): boolean {
    return (
      other.key === this.key &&
      other.revealFrom === this.revealFrom &&
      other.revealTo === this.revealTo
    );
  }

  toDOM(view: EditorView): HTMLElement {
    const wrapper = document.createElement("div");
    wrapper.className = "cm-markdown-table-wrap";
    wrapper.classList.add("cm-editable-widget");

    const table = document.createElement("table");
    table.className = "cm-markdown-table";

    const thead = document.createElement("thead");
    const headerRow = document.createElement("tr");
    this.block.table.headers.forEach((cell, index) => {
      const th = document.createElement("th");
      th.style.textAlign = this.block.table.align[index] ?? "left";
      makeTableCellInput(
        th,
        view,
        this.block,
        {
          rowKind: "header",
          rowIndex: 0,
          cellIndex: index,
        },
        cell,
      );
      headerRow.appendChild(th);
    });
    thead.appendChild(headerRow);
    table.appendChild(thead);

    const tbody = document.createElement("tbody");
    this.block.table.rows.forEach((row, rowIndex) => {
      const tr = document.createElement("tr");
      this.block.table.headers.forEach((_, index) => {
        const td = document.createElement("td");
        td.style.textAlign = this.block.table.align[index] ?? "left";
        makeTableCellInput(
          td,
          view,
          this.block,
          {
            rowKind: "body",
            rowIndex,
            cellIndex: index,
          },
          row[index] ?? "",
        );
        tr.appendChild(td);
      });
      tbody.appendChild(tr);
    });
    table.appendChild(tbody);

    wrapper.appendChild(table);
    return wrapper;
  }

  ignoreEvent(): boolean {
    return false;
  }
}

function makeTableCellInput(
  cell: HTMLTableCellElement,
  view: EditorView,
  block: TableBlock,
  target: MarkdownTableCellTarget,
  value: string,
): void {
  const input = document.createElement("input");
  input.className = "cm-markdown-table-cell-input";
  input.type = "text";
  input.value = value;
  input.spellcheck = true;

  const stop = (event: Event) => event.stopPropagation();
  input.addEventListener("mousedown", stop);
  input.addEventListener("click", stop);
  input.addEventListener("input", stop);
  input.addEventListener("focus", () => {
    const pos = markdownBlockPositionFromHit(view.state.doc.toString(), block, {
      kind: "tableCell",
      rowKind: target.rowKind,
      rowIndex: target.rowIndex,
      cellIndex: target.cellIndex,
      xRatio: 0,
    });
    view.dispatch({
      selection: { anchor: pos, head: pos },
      effects: setPreviewRevealRange.of(null),
    });
  });

  let committedValue = value;
  const commit = () => {
    if (input.value === committedValue) return;
    const change = updateMarkdownTableCell(block, target, input.value);
    if (!change) return;
    committedValue = input.value;
    view.dispatch({
      changes: change,
      selection: { anchor: change.from + change.insert.length },
      effects: setPreviewRevealRange.of(null),
    });
  };

  input.addEventListener("blur", commit);
  input.addEventListener("change", commit);
  input.addEventListener("keydown", (event) => {
    event.stopPropagation();
    if (event.key === "Enter") {
      event.preventDefault();
      commit();
      input.blur();
    }
    if (event.key === "Escape") {
      event.preventDefault();
      input.value = value;
      input.blur();
    }
  });

  cell.appendChild(input);
}

interface EditableWidgetOptions {
  cursorFrom?: number;
  cursorTo?: number;
  positionFromEvent?: (event: MouseEvent) => number | null;
}

function makeEditableWidget(
  element: HTMLElement,
  view: EditorView,
  from: number,
  to: number,
  options: EditableWidgetOptions = {},
): void {
  element.classList.add("cm-editable-widget");
  element.tabIndex = 0;
  const cursorFrom = options.cursorFrom ?? from;
  const cursorTo = options.cursorTo ?? to;
  const reveal = (event: Event) => {
    event.preventDefault();
    event.stopPropagation();
    const pos =
      event instanceof MouseEvent
        ? (options.positionFromEvent?.(event) ??
          blockClickPosition(event, element, view, cursorFrom, cursorTo))
        : Math.min(cursorFrom, view.state.doc.length);
    view.dispatch({
      selection: { anchor: pos, head: pos },
      effects: setPreviewRevealRange.of({ from, to }),
      scrollIntoView: true,
    });
    view.focus();
  };
  element.addEventListener("mousedown", reveal);
  element.addEventListener("keydown", (event) => {
    if (event.key === "Enter" || event.key === " ") reveal(event);
  });
}

function blockClickPosition(
  event: MouseEvent,
  element: HTMLElement,
  view: EditorView,
  from: number,
  to: number,
): number {
  const doc = view.state.doc;
  const rect = element.getBoundingClientRect();
  return markdownSourceRangePositionFromRatio(doc.toString(), from, to, {
    xRatio: rect.width > 0 ? (event.clientX - rect.left) / rect.width : 0,
    yRatio: rect.height > 0 ? (event.clientY - rect.top) / rect.height : 0,
  });
}

function codeBlockPositionFromEvent(
  event: MouseEvent,
  codeElement: HTMLElement,
  contentFrom: number,
  contentTo: number,
): number | null {
  const caret = caretFromPoint(event.clientX, event.clientY);
  if (caret && codeElement.contains(caret.node)) {
    const offset = textOffsetWithin(codeElement, caret.node, caret.offset);
    if (offset !== null) return clampInt(contentFrom + offset, contentFrom, contentTo);
  }

  const text = codeElement.textContent ?? "";
  if (!text) return contentFrom;

  const lineHit = codeLinePositionFromPoint(event, codeElement, text);
  if (lineHit !== null) return clampInt(contentFrom + lineHit, contentFrom, contentTo);

  return null;
}

function caretFromPoint(clientX: number, clientY: number): { node: Node; offset: number } | null {
  const doc = document as Document & {
    caretPositionFromPoint?: (x: number, y: number) => { offsetNode: Node; offset: number } | null;
    caretRangeFromPoint?: (x: number, y: number) => Range | null;
  };

  try {
    const caret = doc.caretPositionFromPoint?.(clientX, clientY);
    if (caret) return { node: caret.offsetNode, offset: caret.offset };
  } catch {
    // Fall through to the WebKit range API.
  }

  try {
    const range = doc.caretRangeFromPoint?.(clientX, clientY);
    if (range) return { node: range.startContainer, offset: range.startOffset };
  } catch {
    // Fall back to ratio based line mapping.
  }

  return null;
}

function textOffsetWithin(root: Node, target: Node, targetOffset: number): number | null {
  let offset = 0;
  let found = false;

  const walk = (node: Node): void => {
    if (found) return;
    if (node === target) {
      if (node.nodeType === Node.TEXT_NODE) {
        offset += Math.min(targetOffset, node.textContent?.length ?? 0);
      } else {
        const children = Array.from(node.childNodes).slice(0, targetOffset);
        offset += children.reduce((sum, child) => sum + (child.textContent?.length ?? 0), 0);
      }
      found = true;
      return;
    }
    if (node.nodeType === Node.TEXT_NODE) {
      offset += node.textContent?.length ?? 0;
      return;
    }
    for (const child of Array.from(node.childNodes)) walk(child);
  };

  walk(root);
  return found ? offset : null;
}

function codeLinePositionFromPoint(
  event: MouseEvent,
  codeElement: HTMLElement,
  source: string,
): number | null {
  const lineRanges = codeTextLineRanges(source);
  if (!lineRanges.length) return 0;

  const rect = codeElement.getBoundingClientRect();
  const yRatio = rect.height > 0 ? clamp((event.clientY - rect.top) / rect.height, 0, 1) : 0;
  const lineIndex = Math.min(lineRanges.length - 1, Math.floor(yRatio * lineRanges.length));
  const line = lineRanges[lineIndex];
  const xRatio = rect.width > 0 ? clamp((event.clientX - rect.left) / rect.width, 0, 1) : 0;
  return line.from + Math.round(xRatio * Math.max(0, line.to - line.from));
}

function codeTextLineRanges(source: string): Array<{ from: number; to: number }> {
  if (!source) return [{ from: 0, to: 0 }];
  const lines: Array<{ from: number; to: number }> = [];
  let from = 0;

  while (from <= source.length) {
    const newline = source.indexOf("\n", from);
    if (newline < 0) {
      lines.push({ from, to: source.length });
      break;
    }
    lines.push({ from, to: newline });
    from = newline + 1;
    if (from === source.length) {
      lines.push({ from, to: from });
      break;
    }
  }

  return lines;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function clampInt(value: number, min: number, max: number): number {
  return Math.round(clamp(value, min, max));
}

function createFallbackText(message: string): HTMLElement {
  const span = document.createElement("span");
  span.style.color = "var(--text-secondary)";
  span.style.fontSize = "12px";
  span.textContent = `[Image: ${message}]`;
  return span;
}

function formatWidgetError(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  try {
    return JSON.stringify(error) ?? String(error);
  } catch {
    return String(error);
  }
}

function blockDecorations(state: EditorState, mdPath: string | null): DecorationSet {
  const widgets: { from: number; to: number; widget: Decoration }[] = [];
  const revealRange = state.field(previewRevealRangeField, false) ?? null;

  for (const block of parseMarkdownBlocks(state.doc.toString())) {
    const revealFrom = block.kind === "inlineMath" ? block.lineFrom : block.from;
    const revealTo = block.kind === "inlineMath" ? block.lineTo : block.to;
    if (block.kind !== "table" && rangeIsRevealed(state, revealRange, revealFrom, revealTo)) {
      continue;
    }

    switch (block.kind) {
      case "fencedCode":
        widgets.push({
          from: block.from,
          to: block.to,
          widget: Decoration.replace({
            widget: block.isMermaid
              ? new MermaidWidget(
                  block.content,
                  block.from,
                  block.to,
                  block.contentFrom,
                  block.contentTo,
                )
              : new CodeBlockWidget(
                  block.content,
                  block.language,
                  block.from,
                  block.to,
                  block.contentFrom,
                  block.contentTo,
                ),
            block: true,
          }),
        });
        break;

      case "mathBlock":
        widgets.push({
          from: block.from,
          to: block.to,
          widget: Decoration.replace({
            widget: new MathWidget(
              block.content,
              true,
              block.from,
              block.to,
              block.contentFrom,
              block.contentTo,
            ),
            block: true,
          }),
        });
        break;

      case "table":
        widgets.push({
          from: block.from,
          to: block.to,
          widget: Decoration.replace({
            widget: new TableWidget(block, block.from, block.to),
            block: true,
          }),
        });
        break;

      case "image":
        widgets.push({
          from: block.from,
          to: block.to,
          widget: Decoration.replace({
            widget: new ImageWidget(
              block.alt,
              resolveImageSrc(block.src, mdPath),
              block.from,
              block.to,
            ),
            block: true,
          }),
        });
        break;

      case "inlineMath":
        widgets.push({
          from: block.from,
          to: block.to,
          widget: Decoration.replace({
            widget: new MathWidget(
              block.latex,
              false,
              block.from,
              block.to,
              block.contentFrom,
              block.contentTo,
            ),
          }),
        });
        break;
    }
  }

  return Decoration.set(
    widgets.map((w) => w.widget.range(w.from, w.to)),
    true,
  );
}

function selectionTouchesRange(state: EditorState, from: number, to: number): boolean {
  return state.selection.ranges.some((range) => range.from <= to && range.to >= from);
}

function rangeIsRevealed(
  state: EditorState,
  revealRange: { from: number; to: number } | null,
  from: number,
  to: number,
): boolean {
  const editorFocused = state.field(editorFocusedField, false) ?? false;
  return (
    (editorFocused && selectionTouchesRange(state, from, to)) ||
    (revealRange !== null && revealRange.from <= to && revealRange.to >= from)
  );
}

function resolveImageSrc(src: string, mdPath: string | null): string {
  if (/^(?:[a-z][a-z\d+.-]*:|#)/i.test(src)) return src;
  if (!isTauriRuntime()) return src;

  const filePath = isAbsolutePath(src) || !mdPath ? src : joinFilesystemPath(dirname(mdPath), src);
  try {
    return convertFileSrc(filePath);
  } catch {
    return src;
  }
}

function joinFilesystemPath(basePath: string, childPath: string): string {
  if (!basePath) return childPath;
  const separator = basePath.includes("\\") ? "\\" : "/";
  return `${basePath.replace(/[\\/]+$/, "")}${separator}${childPath.replace(/^[\\/]+/, "")}`;
}

function isAbsolutePath(path: string): boolean {
  return path.startsWith("/") || /^[A-Za-z]:[\\/]/.test(path);
}

export const blockWidgetPlugin = (mdPath: string | null) =>
  StateField.define<DecorationSet>({
    create(state) {
      return blockDecorations(state, mdPath);
    },
    update(decorations, transaction) {
      if (previewDecorationsNeedRefresh(transaction)) {
        return blockDecorations(transaction.state, mdPath);
      }
      return decorations.map(transaction.changes);
    },
    provide(field) {
      return EditorView.decorations.from(field);
    },
  });
