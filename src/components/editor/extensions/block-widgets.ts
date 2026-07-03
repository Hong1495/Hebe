import { LanguageDescription } from "@codemirror/language";
import { languages } from "@codemirror/language-data";
import { type EditorState, StateField } from "@codemirror/state";
import { Decoration, type DecorationSet, EditorView, WidgetType } from "@codemirror/view";
import { highlightCode, tags as highlightTags, tagHighlighter } from "@lezer/highlight";
import { convertFileSrc } from "@tauri-apps/api/core";
import katex from "katex";
import { isTauriRuntime } from "../../../lib/ipc";
import { dirname } from "../../../lib/path";
import { type ParsedTable, parseMarkdownBlocks, tableCellSpans } from "../markdown-kernel";
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

  constructor(
    latex: string,
    displayMode: boolean,
    revealFrom: number | null = null,
    revealTo: number | null = null,
  ) {
    super();
    this.latex = latex;
    this.displayMode = displayMode;
    this.revealFrom = revealFrom;
    this.revealTo = revealTo;
  }

  override eq(other: MathWidget): boolean {
    return (
      other.latex === this.latex &&
      other.displayMode === this.displayMode &&
      other.revealFrom === this.revealFrom &&
      other.revealTo === this.revealTo
    );
  }

  toDOM(view: EditorView): HTMLElement {
    const span = document.createElement("span");
    span.className = this.displayMode ? "cm-math-block" : "cm-math-inline";
    if (this.revealFrom !== null) {
      makeEditableWidget(span, view, this.revealFrom, this.revealTo ?? this.revealFrom);
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

  constructor(code: string, revealFrom: number, revealTo: number) {
    super();
    this.code = code;
    this.id = `mermaid-${(widgetIdCounter++).toString(36)}`;
    this.revealFrom = revealFrom;
    this.revealTo = revealTo;
  }

  override eq(other: MermaidWidget): boolean {
    return (
      other.code === this.code &&
      other.revealFrom === this.revealFrom &&
      other.revealTo === this.revealTo
    );
  }

  toDOM(view: EditorView): HTMLElement {
    const container = document.createElement("div");
    container.className = "cm-mermaid-container";
    makeEditableWidget(container, view, this.revealFrom, this.revealTo);

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

  constructor(code: string, language: string | null, revealFrom: number, revealTo: number) {
    super();
    this.code = code;
    this.language = language;
    this.revealFrom = revealFrom;
    this.revealTo = revealTo;
  }

  override eq(other: CodeBlockWidget): boolean {
    return (
      other.code === this.code &&
      other.language === this.language &&
      other.revealFrom === this.revealFrom &&
      other.revealTo === this.revealTo
    );
  }

  toDOM(view: EditorView): HTMLElement {
    const pre = document.createElement("pre");
    pre.className = "cm-code-block-widget";
    if (this.language) pre.dataset.language = this.language;
    makeEditableWidget(pre, view, this.revealFrom, this.revealTo);

    const code = document.createElement("code");
    code.textContent = this.code;
    pre.appendChild(code);

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
  readonly table: ParsedTable;
  private readonly key: string;
  private readonly revealFrom: number;
  private readonly revealTo: number;

  constructor(table: ParsedTable, revealFrom: number, revealTo: number) {
    super();
    this.table = table;
    this.key = JSON.stringify(table);
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
    makeTableWidgetEditable(wrapper, view, this.revealFrom, this.revealTo);

    const table = document.createElement("table");
    table.className = "cm-markdown-table";

    const thead = document.createElement("thead");
    const headerRow = document.createElement("tr");
    headerRow.dataset.sourceLineOffset = "0";
    this.table.headers.forEach((cell, index) => {
      const th = document.createElement("th");
      th.textContent = cell;
      th.style.textAlign = this.table.align[index] ?? "left";
      headerRow.appendChild(th);
    });
    thead.appendChild(headerRow);
    table.appendChild(thead);

    const tbody = document.createElement("tbody");
    this.table.rows.forEach((row, rowIndex) => {
      const tr = document.createElement("tr");
      tr.dataset.sourceLineOffset = String(rowIndex + 2);
      this.table.headers.forEach((_, index) => {
        const td = document.createElement("td");
        td.textContent = row[index] ?? "";
        td.style.textAlign = this.table.align[index] ?? "left";
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

function makeEditableWidget(
  element: HTMLElement,
  view: EditorView,
  from: number,
  to: number,
): void {
  element.classList.add("cm-editable-widget");
  element.tabIndex = 0;
  const reveal = (event: Event) => {
    event.preventDefault();
    event.stopPropagation();
    const pos =
      event instanceof MouseEvent
        ? blockClickPosition(event, element, view, from, to)
        : Math.min(from, view.state.doc.length);
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
  const startLineNo = doc.lineAt(Math.min(from, doc.length)).number;
  const endLineNo = doc.lineAt(Math.min(to, doc.length)).number;
  const rect = element.getBoundingClientRect();
  const yRatio = rect.height > 0 ? clamp((event.clientY - rect.top) / rect.height, 0, 1) : 0;
  const lineCount = Math.max(1, endLineNo - startLineNo + 1);
  const lineNo = startLineNo + Math.min(lineCount - 1, Math.floor(yRatio * lineCount));
  const line = doc.line(lineNo);
  const xRatio = rect.width > 0 ? clamp((event.clientX - rect.left) / rect.width, 0, 1) : 0;
  const offset = Math.round(xRatio * line.length);
  return line.from + clampInt(offset, 0, line.length);
}

function makeTableWidgetEditable(
  element: HTMLElement,
  view: EditorView,
  from: number,
  to: number,
): void {
  element.classList.add("cm-editable-widget");
  element.tabIndex = 0;

  const reveal = (event: Event) => {
    event.preventDefault();
    event.stopPropagation();
    const pos =
      event instanceof MouseEvent
        ? tableClickPosition(event, element, view, from, to)
        : Math.min(from, view.state.doc.length);
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

function tableClickPosition(
  event: MouseEvent,
  wrapper: HTMLElement,
  view: EditorView,
  from: number,
  to: number,
): number {
  const target = event.target instanceof Element ? event.target : null;
  const cell = target?.closest("th,td") as HTMLTableCellElement | null;
  if (!cell || !wrapper.contains(cell)) return Math.min(from, view.state.doc.length);

  const row = cell.closest("tr");
  const section = row?.parentElement;
  if (!row || !section) return Math.min(from, view.state.doc.length);

  const sourceLineOffset = Number.parseInt(row.dataset.sourceLineOffset ?? "", 10);
  const rowIndex = Array.from(section.children).indexOf(row);
  const fallbackLineOffset = section.tagName.toLowerCase() === "thead" ? 0 : rowIndex + 2;
  const doc = view.state.doc;
  const startLineNo = doc.lineAt(Math.min(from, doc.length)).number;
  const endLineNo = doc.lineAt(Math.min(to, doc.length)).number;
  const lineNo = clampInt(
    startLineNo + (Number.isFinite(sourceLineOffset) ? sourceLineOffset : fallbackLineOffset),
    startLineNo,
    endLineNo,
  );
  const line = doc.line(lineNo);

  const spans = tableCellSpans(line.text);
  const span = spans[clampInt(cell.cellIndex, 0, Math.max(0, spans.length - 1))];
  if (!span) return line.from;

  const rect = cell.getBoundingClientRect();
  const ratio = rect.width > 0 ? clamp((event.clientX - rect.left) / rect.width, 0, 1) : 0;
  const offset = Math.round(
    span.contentFrom + ratio * Math.max(0, span.contentTo - span.contentFrom),
  );
  return line.from + clampInt(offset, span.contentFrom, span.contentTo);
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
    if (rangeIsRevealed(state, revealRange, revealFrom, revealTo)) continue;

    switch (block.kind) {
      case "fencedCode":
        widgets.push({
          from: block.from,
          to: block.to,
          widget: Decoration.replace({
            widget: block.isMermaid
              ? new MermaidWidget(block.content, block.from, block.to)
              : new CodeBlockWidget(block.content, block.language, block.from, block.to),
            block: true,
          }),
        });
        break;

      case "mathBlock":
        widgets.push({
          from: block.from,
          to: block.to,
          widget: Decoration.replace({
            widget: new MathWidget(block.content, true, block.from, block.to),
            block: true,
          }),
        });
        break;

      case "table":
        widgets.push({
          from: block.from,
          to: block.to,
          widget: Decoration.replace({
            widget: new TableWidget(block.table, block.from, block.to),
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
            widget: new MathWidget(block.latex, false, block.from, block.to),
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
