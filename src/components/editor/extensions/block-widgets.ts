import { convertFileSrc } from "@tauri-apps/api/core";
import { StateField, type EditorState, type Text } from "@codemirror/state";
import { Decoration, type DecorationSet, EditorView, WidgetType } from "@codemirror/view";
import katex from "katex";
import { isTauriRuntime } from "../../../lib/ipc";
import { dirname } from "../../../lib/path";
import {
  editorFocusedField,
  setEditorFocused,
  previewRevealRangeField,
  setPreviewRevealRange,
} from "./hybrid-preview";

let widgetIdCounter = 0;

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
    container.innerHTML = `<pre class="cm-mermaid-code">${escapeHtml(this.code)}</pre><div id="${this.id}"></div>`;

    import("mermaid").then((mermaid) => {
      try {
        mermaid.default.run({ nodes: [document.getElementById(this.id)!] });
        const pre = container.querySelector(".cm-mermaid-code") as HTMLElement | null;
        if (pre) pre.style.display = "none";
      } catch {
        // keep pre visible as fallback
      }
    });

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
    return pre;
  }

  ignoreEvent(): boolean {
    return false;
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
    this.table.headers.forEach((cell, index) => {
      const th = document.createElement("th");
      th.textContent = cell;
      th.style.textAlign = this.table.align[index] ?? "left";
      headerRow.appendChild(th);
    });
    thead.appendChild(headerRow);
    table.appendChild(thead);

    const tbody = document.createElement("tbody");
    this.table.rows.forEach((row) => {
      const tr = document.createElement("tr");
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

type TableAlign = "left" | "center" | "right";

interface ParsedTable {
  headers: string[];
  align: TableAlign[];
  rows: string[][];
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
  const lineNo = clampInt(
    startLineNo + yRatio * Math.max(0, endLineNo - startLineNo),
    startLineNo,
    endLineNo,
  );
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

  const rowIndex = Array.from(section.children).indexOf(row);
  const sourceLineOffset = section.tagName.toLowerCase() === "thead" ? 0 : rowIndex + 2;
  const doc = view.state.doc;
  const startLineNo = doc.lineAt(Math.min(from, doc.length)).number;
  const endLineNo = doc.lineAt(Math.min(to, doc.length)).number;
  const lineNo = clampInt(startLineNo + sourceLineOffset, startLineNo, endLineNo);
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

interface TableCellSpan {
  contentFrom: number;
  contentTo: number;
}

function tableCellSpans(text: string): TableCellSpan[] {
  const rawCells: { from: number; to: number }[] = [];
  let escaped = false;
  let cellFrom = 0;

  for (let index = 0; index < text.length; index++) {
    const char = text[index];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (char === "\\") {
      escaped = true;
      continue;
    }
    if (char === "|") {
      rawCells.push({ from: cellFrom, to: index });
      cellFrom = index + 1;
    }
  }
  rawCells.push({ from: cellFrom, to: text.length });

  if (rawCells[0]?.from === 0 && rawCells[0].to === 0) rawCells.shift();
  const last = rawCells.at(-1);
  if (last && last.from === text.length && last.to === text.length) rawCells.pop();

  return rawCells.map((cell) => {
    let contentFrom = cell.from;
    let contentTo = cell.to;
    while (contentFrom < contentTo && /\s/.test(text[contentFrom])) contentFrom += 1;
    while (contentTo > contentFrom && /\s/.test(text[contentTo - 1])) contentTo -= 1;
    return { contentFrom, contentTo };
  });
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

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

interface BlockRange {
  from: number;
  to: number;
  endLine: number;
  source: string;
}

interface FenceMarker {
  marker: "`" | "~";
  length: number;
}

interface ImageLine {
  alt: string;
  src: string;
}

const MAX_BLOCK_SCAN_LINES = 500;
const MAX_INLINE_MATH_SCAN_LENGTH = 6000;

function blockDecorations(state: EditorState, mdPath: string | null): DecorationSet {
  const widgets: { from: number; to: number; widget: Decoration }[] = [];
  const doc = state.doc;
  const scannedLines = new Set<number>();
  const revealRange = state.field(previewRevealRangeField, false) ?? null;

  for (let lineNo = 1; lineNo <= doc.lines; lineNo++) {
    if (scannedLines.has(lineNo)) continue;
    const line = doc.line(lineNo);
    const text = line.text;

    const fencedBlock = readFencedBlock(doc, lineNo);
    if (fencedBlock) {
      markLines(scannedLines, lineNo, fencedBlock.endLine);
      const language = getFenceLanguage(text);
      if (!rangeIsRevealed(state, revealRange, fencedBlock.from, fencedBlock.to)) {
        const code = getInnerBlockSource(doc, lineNo, fencedBlock.endLine);
        widgets.push({
          from: fencedBlock.from,
          to: fencedBlock.to,
          widget: Decoration.replace({
            widget:
              language === "mermaid"
                ? new MermaidWidget(code, fencedBlock.from, fencedBlock.to)
                : new CodeBlockWidget(code, language, fencedBlock.from, fencedBlock.to),
            block: true,
          }),
        });
      }
      lineNo = fencedBlock.endLine;
      continue;
    }

    const mathBlock = readMathBlock(doc, lineNo);
    if (mathBlock) {
      markLines(scannedLines, lineNo, mathBlock.endLine);
      if (!rangeIsRevealed(state, revealRange, mathBlock.from, mathBlock.to)) {
        widgets.push({
          from: mathBlock.from,
          to: mathBlock.to,
          widget: Decoration.replace({
            widget: new MathWidget(mathBlock.source, true, mathBlock.from, mathBlock.to),
            block: true,
          }),
        });
      }
      lineNo = mathBlock.endLine;
      continue;
    }

    const tableBlock = readTableBlock(doc, lineNo);
    if (tableBlock) {
      markLines(scannedLines, lineNo, tableBlock.endLine);
      const table = parseMarkdownTable(tableBlock.source);
      if (table && !rangeIsRevealed(state, revealRange, tableBlock.from, tableBlock.to)) {
        widgets.push({
          from: tableBlock.from,
          to: tableBlock.to,
          widget: Decoration.replace({
            widget: new TableWidget(table, tableBlock.from, tableBlock.to),
            block: true,
          }),
        });
      }
      lineNo = tableBlock.endLine;
      continue;
    }

    const image = parseImageLine(text);
    if (image && !rangeIsRevealed(state, revealRange, line.from, line.to)) {
      widgets.push({
        from: line.from,
        to: line.to,
        widget: Decoration.replace({
          widget: new ImageWidget(
            image.alt,
            resolveImageSrc(image.src, mdPath),
            line.from,
            line.to,
          ),
          block: true,
        }),
      });
      continue;
    }

    if (
      text.length <= MAX_INLINE_MATH_SCAN_LENGTH &&
      !rangeIsRevealed(state, revealRange, line.from, line.to)
    ) {
      scanInlineMath(
        text,
        line.from,
        widgets,
        widgets.map((w) => ({ from: w.from, to: w.to })),
      );
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

function markLines(lines: Set<number>, startLine: number, endLine: number): void {
  for (let lineNo = startLine; lineNo <= endLine; lineNo++) {
    lines.add(lineNo);
  }
}

function readFencedBlock(doc: Text, startLine: number): BlockRange | null {
  const line = doc.line(startLine);
  const fence = readFenceOpener(line.text);
  if (!fence) return null;

  for (let lineNo = startLine + 1; lineNo <= doc.lines; lineNo++) {
    const closeLine = doc.line(lineNo);
    if (isFenceCloser(closeLine.text, fence)) {
      return {
        from: line.from,
        to: closeLine.to,
        endLine: lineNo,
        source: doc.sliceString(line.from, closeLine.to),
      };
    }
  }

  const lastLine = doc.line(doc.lines);
  return {
    from: line.from,
    to: lastLine.to,
    endLine: doc.lines,
    source: doc.sliceString(line.from, lastLine.to),
  };
}

function getFenceLanguage(line: string): string | null {
  const match = line.match(/^\s{0,3}(`{3,}|~{3,})\s*([^\s`~]+)?/);
  if (!match?.[2]) return null;
  return match[2].replace(/[{}]/g, "").toLowerCase();
}

function readFenceOpener(text: string): FenceMarker | null {
  const match = text.match(/^\s{0,3}(`{3,}|~{3,})/);
  if (!match) return null;
  const marker = match[1][0] as "`" | "~";
  return { marker, length: match[1].length };
}

function isFenceCloser(text: string, fence: FenceMarker): boolean {
  const escapedMarker = fence.marker === "`" ? "`" : "~";
  return new RegExp(`^\\s{0,3}${escapedMarker}{${fence.length},}\\s*$`).test(text);
}

function getInnerBlockSource(doc: Text, startLine: number, endLine: number): string {
  const lines: string[] = [];
  for (let lineNo = startLine + 1; lineNo < endLine; lineNo++) {
    lines.push(doc.line(lineNo).text);
  }
  return lines.join("\n");
}

function readMathBlock(doc: Text, startLine: number): BlockRange | null {
  const line = doc.line(startLine);
  const trimmed = line.text.trim();
  const singleLine = trimmed.match(/^\$\$(.+?)\$\$$/);
  if (singleLine) {
    return {
      from: line.from,
      to: line.to,
      endLine: startLine,
      source: singleLine[1].trim(),
    };
  }

  if (trimmed !== "$$") return null;

  const lastLine = Math.min(doc.lines, startLine + MAX_BLOCK_SCAN_LINES);
  for (let lineNo = startLine + 1; lineNo <= lastLine; lineNo++) {
    const closeLine = doc.line(lineNo);
    if (closeLine.text.trim() === "$$") {
      return {
        from: line.from,
        to: closeLine.to,
        endLine: lineNo,
        source: getInnerBlockSource(doc, startLine, lineNo),
      };
    }
  }

  return null;
}

function readTableBlock(doc: Text, startLine: number): BlockRange | null {
  if (startLine + 1 > doc.lines) return null;

  const headerLine = doc.line(startLine);
  const delimiterLine = doc.line(startLine + 1);
  if (!isTableRow(headerLine.text) || !isTableDelimiter(delimiterLine.text)) return null;

  let endLine = startLine + 1;
  while (endLine + 1 <= doc.lines && isTableRow(doc.line(endLine + 1).text)) {
    endLine += 1;
  }

  const lastLine = doc.line(endLine);
  return {
    from: headerLine.from,
    to: lastLine.to,
    endLine,
    source: doc.sliceString(headerLine.from, lastLine.to),
  };
}

function isTableRow(line: string): boolean {
  const trimmed = line.trim();
  return trimmed.length > 0 && trimmed.includes("|") && !/^\s{0,3}(```|~~~)/.test(trimmed);
}

function isTableDelimiter(line: string): boolean {
  const cells = splitTableRow(line);
  return cells.length >= 2 && cells.every((cell) => /^:?-{3,}:?$/.test(cell.trim()));
}

function parseImageLine(line: string): ImageLine | null {
  const match = line.match(/^\s*!\[([^\]\n]*)\]\((.+)\)\s*$/);
  if (!match) return null;
  const src = parseImageTarget(match[2]);
  if (!src) return null;
  return { alt: match[1], src };
}

function parseImageTarget(target: string): string | null {
  const trimmed = target.trim();
  if (!trimmed) return null;

  if (trimmed.startsWith("<")) {
    const end = trimmed.indexOf(">");
    return end > 1 ? unescapeMarkdownPath(trimmed.slice(1, end)) : null;
  }

  const titleStart = trimmed.search(/\s+(?=["'(])/);
  const path = titleStart >= 0 ? trimmed.slice(0, titleStart) : trimmed;
  return unescapeMarkdownPath(path);
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

function unescapeMarkdownPath(path: string): string {
  return path.replace(/\\([\\()[\] ])/g, "$1");
}

function parseMarkdownTable(source: string): ParsedTable | null {
  const lines = source
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  if (lines.length < 2) return null;

  const headers = splitTableRow(lines[0]);
  const delimiter = splitTableRow(lines[1]);
  if (!headers.length || delimiter.length < headers.length) return null;
  if (!delimiter.every((cell) => /^:?-{3,}:?$/.test(cell.trim()))) return null;

  const align = delimiter.map((cell): TableAlign => {
    const trimmed = cell.trim();
    if (trimmed.startsWith(":") && trimmed.endsWith(":")) return "center";
    if (trimmed.endsWith(":")) return "right";
    return "left";
  });

  const rows = lines.slice(2).map(splitTableRow);
  return { headers, align, rows };
}

function splitTableRow(line: string): string[] {
  const trimmed = line.replace(/^\|/, "").replace(/\|$/, "");
  const cells: string[] = [];
  let current = "";
  let escaped = false;

  for (const char of trimmed) {
    if (escaped) {
      current += char;
      escaped = false;
      continue;
    }
    if (char === "\\") {
      escaped = true;
      continue;
    }
    if (char === "|") {
      cells.push(cleanInlineMarkdown(current));
      current = "";
      continue;
    }
    current += char;
  }

  cells.push(cleanInlineMarkdown(current));
  return cells;
}

function cleanInlineMarkdown(value: string): string {
  return value
    .trim()
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/__([^_]+)__/g, "$1")
    .replace(/\*([^*]+)\*/g, "$1")
    .replace(/_([^_]+)_/g, "$1");
}

interface Span {
  from: number;
  to: number;
}

function scanInlineMath(
  text: string,
  baseOffset: number,
  widgets: { from: number; to: number; widget: Decoration }[],
  existingSpans: Span[],
): void {
  const inlineMathRe = /(?<!\\)\$([^$\n]+?)(?<!\\)\$/g;
  let match: RegExpExecArray | null;
  while ((match = inlineMathRe.exec(text)) !== null) {
    const from = baseOffset + match.index;
    const to = from + match[0].length;

    // Skip if this span overlaps with an existing block math widget
    const overlaps = existingSpans.some((s) => from < s.to && to > s.from);
    if (overlaps) continue;

    widgets.push({
      from,
      to,
      widget: Decoration.replace({ widget: new MathWidget(match[1], false, from, to) }),
    });
  }
}

export const blockWidgetPlugin = (mdPath: string | null) =>
  StateField.define<DecorationSet>({
    create(state) {
      return blockDecorations(state, mdPath);
    },
    update(decorations, transaction) {
      const revealChanged = transaction.effects.some(
        (effect) => effect.is(setPreviewRevealRange) || effect.is(setEditorFocused),
      );
      if (transaction.docChanged || transaction.selection || revealChanged) {
        return blockDecorations(transaction.state, mdPath);
      }
      return decorations.map(transaction.changes);
    },
    provide(field) {
      return EditorView.decorations.from(field);
    },
  });
