import { LanguageDescription } from "@codemirror/language";
import { languages } from "@codemirror/language-data";
import { type EditorState, StateField } from "@codemirror/state";
import { Decoration, type DecorationSet, EditorView, WidgetType } from "@codemirror/view";
import { highlightCode, tags as highlightTags, tagHighlighter } from "@lezer/highlight";
import { convertFileSrc } from "@tauri-apps/api/core";
import katex from "katex";
import { isTauriRuntime } from "../../../lib/ipc";
import { dirname } from "../../../lib/path";
import { useAppStore } from "../../../stores/app-store";
import { insertImage } from "../image-actions";
import {
  type DocumentHeading,
  type FootnoteReference,
  inspectLongDocument,
  type LongDocumentBlock,
} from "../long-document";
import {
  appendMarkdownTableRow,
  deleteMarkdownTableColumn,
  deleteMarkdownTableRow,
  insertMarkdownTableColumn,
  insertMarkdownTableRow,
  type MarkdownBlockProjection,
  type MarkdownTableCellTarget,
  type MarkdownTableEdit,
  markdownBlockPositionFromHit,
  markdownBlockProjection,
  markdownSourceRangePositionFromRatio,
  navigateMarkdownTableCell,
  parseMarkdownBlocks,
  pasteMarkdownTableCells,
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
  private readonly projection: MarkdownBlockProjection | null;

  constructor(
    latex: string,
    displayMode: boolean,
    projection: MarkdownBlockProjection | null = null,
  ) {
    super();
    this.latex = latex;
    this.displayMode = displayMode;
    this.projection = projection;
  }

  override eq(other: MathWidget): boolean {
    return (
      other.latex === this.latex &&
      other.displayMode === this.displayMode &&
      markdownBlockProjectionKey(other.projection) === markdownBlockProjectionKey(this.projection)
    );
  }

  toDOM(view: EditorView): HTMLElement {
    const span = document.createElement("span");
    span.className = this.displayMode ? "cm-math-block" : "cm-math-inline";
    if (this.projection) {
      makeEditableWidget(span, view, this.projection);
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
  private readonly projection: MarkdownBlockProjection;

  constructor(code: string, projection: MarkdownBlockProjection) {
    super();
    this.code = code;
    this.id = `mermaid-${(widgetIdCounter++).toString(36)}`;
    this.projection = projection;
  }

  override eq(other: MermaidWidget): boolean {
    return (
      other.code === this.code &&
      markdownBlockProjectionKey(other.projection) === markdownBlockProjectionKey(this.projection)
    );
  }

  toDOM(view: EditorView): HTMLElement {
    const container = document.createElement("div");
    container.className = "cm-mermaid-container";
    makeEditableWidget(container, view, this.projection);

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
  private readonly projection: MarkdownBlockProjection;

  constructor(code: string, language: string | null, projection: MarkdownBlockProjection) {
    super();
    this.code = code;
    this.language = language;
    this.projection = projection;
  }

  override eq(other: CodeBlockWidget): boolean {
    return (
      other.code === this.code &&
      other.language === this.language &&
      markdownBlockProjectionKey(other.projection) === markdownBlockProjectionKey(this.projection)
    );
  }

  toDOM(view: EditorView): HTMLElement {
    const pre = document.createElement("pre");
    pre.className = "cm-code-block-widget";
    if (this.language) pre.dataset.language = this.language;

    const code = document.createElement("code");
    code.textContent = this.code;
    pre.appendChild(code);
    makeEditableWidget(pre, view, this.projection, {
      positionFromEvent: (event) =>
        codeBlockPositionFromEvent(
          event,
          code,
          this.projection.cursorFrom,
          this.projection.cursorTo,
        ),
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

class LongDocumentWidget extends WidgetType {
  readonly data: LongDocumentBlock;
  readonly headings: DocumentHeading[];
  constructor(data: LongDocumentBlock, headings: DocumentHeading[]) {
    super();
    this.data = data;
    this.headings = headings;
  }
  eq(other: LongDocumentWidget) {
    return (
      JSON.stringify(this.data) === JSON.stringify(other.data) &&
      JSON.stringify(this.headings) === JSON.stringify(other.headings)
    );
  }
  toDOM(view: EditorView) {
    const container = document.createElement("div");
    container.className = "cm-long-document cm-editable-widget";
    const edit = document.createElement("button");
    edit.textContent = "Edit source";
    edit.className = "cm-long-document-edit";
    edit.onclick = () => {
      view.dispatch({
        selection: { anchor: this.data.from },
        effects: setPreviewRevealRange.of({ from: this.data.from, to: this.data.to }),
        scrollIntoView: true,
      });
      view.focus();
    };
    const title = document.createElement("strong");
    title.textContent =
      this.data.kind === "toc"
        ? "Contents"
        : this.data.kind === "frontMatter"
          ? "Document metadata"
          : `Footnote · ${this.data.label}`;
    container.append(title, edit);
    if (this.data.kind === "toc") {
      const nav = document.createElement("nav");
      nav.setAttribute("aria-label", "Document contents");
      for (const heading of this.headings) {
        const link = document.createElement("button");
        link.textContent = heading.text;
        link.style.paddingLeft = `${(heading.level - 1) * 16}px`;
        link.onclick = () => {
          view.dispatch({ selection: { anchor: heading.from }, scrollIntoView: true });
          view.focus();
        };
        nav.append(link);
      }
      if (!this.headings.length) nav.textContent = "Add headings to build a table of contents.";
      container.append(nav);
    } else {
      const content = document.createElement("pre");
      content.textContent = this.data.content;
      container.append(content);
      if (this.data.kind === "footnoteDefinition") {
        const back = document.createElement("button");
        back.textContent = "Back to reference ↑";
        back.onclick = () => {
          const reference = inspectLongDocument(view.state.doc.toString()).references.find(
            (item) => item.label === this.data.label,
          );
          if (reference) {
            view.dispatch({ selection: { anchor: reference.from }, scrollIntoView: true });
            view.focus();
          }
        };
        container.append(back);
      }
    }
    return container;
  }
  ignoreEvent() {
    return false;
  }
}

class FootnoteWidget extends WidgetType {
  readonly reference: FootnoteReference;
  constructor(reference: FootnoteReference) {
    super();
    this.reference = reference;
  }
  eq(other: FootnoteWidget) {
    return JSON.stringify(other.reference) === JSON.stringify(this.reference);
  }
  toDOM(view: EditorView) {
    const button = document.createElement("button");
    button.className = "cm-footnote-reference cm-editable-widget";
    button.textContent = String(this.reference.number);
    button.title =
      this.reference.definition === undefined
        ? `Missing footnote: ${this.reference.label}`
        : `Go to footnote: ${this.reference.label}`;
    button.setAttribute("aria-label", button.title);
    button.onclick = () => {
      const anchor = this.reference.definition ?? this.reference.from;
      view.dispatch({ selection: { anchor }, scrollIntoView: true });
      view.focus();
    };
    return button;
  }
  ignoreEvent() {
    return false;
  }
}

class ImageWidget extends WidgetType {
  readonly alt: string;
  readonly src: string;
  private readonly projection: MarkdownBlockProjection;

  constructor(alt: string, src: string, projection: MarkdownBlockProjection) {
    super();
    this.alt = alt;
    this.src = src;
    this.projection = projection;
  }

  override eq(other: ImageWidget): boolean {
    return (
      other.src === this.src &&
      other.alt === this.alt &&
      markdownBlockProjectionKey(other.projection) === markdownBlockProjectionKey(this.projection)
    );
  }

  toDOM(view: EditorView): HTMLElement {
    const container = document.createElement("div");
    container.className = "cm-image-container";
    makeEditableWidget(container, view, this.projection);

    const img = document.createElement("img");
    img.src = this.src;
    img.alt = this.alt;
    img.loading = "lazy";

    img.onerror = () => {
      img.replaceWith(createFallbackText(this.alt || this.src));
    };

    const actions = document.createElement("div");
    actions.className = "cm-image-actions";
    const replace = document.createElement("button");
    replace.textContent = "Replace image…";
    replace.onmousedown = (event) => event.stopPropagation();
    replace.onclick = (event) => {
      event.stopPropagation();
      void insertImage(view, useAppStore.getState().currentFilePath(), undefined, {
        from: this.projection.revealFrom,
        to: this.projection.revealTo,
      });
    };
    const edit = document.createElement("button");
    edit.textContent = "Edit description / path";
    edit.onmousedown = (event) => event.stopPropagation();
    edit.onclick = (event) => {
      event.stopPropagation();
      view.dispatch({
        selection: { anchor: this.projection.cursorFrom },
        effects: setPreviewRevealRange.of({
          from: this.projection.revealFrom,
          to: this.projection.revealTo,
        }),
      });
      view.focus();
    };
    actions.append(replace, edit);
    container.append(img, actions);
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
    table.style.minWidth = `${this.block.table.headers.length * 9}em`;

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
  const field = document.createElement("div");
  field.className = "cm-table-cell-field";
  const mirror = document.createElement("div");
  mirror.className = "cm-table-cell-mirror";
  mirror.setAttribute("aria-hidden", "true");
  mirror.textContent = value + "\n";
  const input = document.createElement("textarea");
  input.className = "cm-markdown-table-cell-input";
  input.rows = 1;
  input.wrap = "soft";
  input.setAttribute("aria-label", `Table ${target.rowKind} row ${target.rowIndex + 1}, column ${target.cellIndex + 1}`);
  input.value = value;
  input.spellcheck = true;
  input.dataset.tableRowKind = target.rowKind;
  input.dataset.tableRowIndex = String(target.rowIndex);
  input.dataset.tableCellIndex = String(target.cellIndex);

  const stop = (event: Event) => event.stopPropagation();
  input.addEventListener("mousedown", stop);
  input.addEventListener("click", stop);
  input.addEventListener("input", (event) => {
    stop(event);
    mirror.textContent = input.value + "\n";
    view.requestMeasure();
  });
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
  const pendingCellChange = () => {
    if (input.value === committedValue) return;
    const change = updateMarkdownTableCell(block, target, input.value);
    if (!change) return;
    committedValue = input.value;
    return change;
  };
  const commit = () => {
    const change = pendingCellChange();
    if (!change) return;
    view.dispatch({
      changes: change,
      selection: { anchor: change.from + change.insert.length },
      effects: setPreviewRevealRange.of(null),
    });
  };

  input.addEventListener("blur", commit);
  input.addEventListener("change", commit);
  input.addEventListener("paste", (event) => {
    event.stopPropagation();
    const text = event.clipboardData?.getData("text/plain") ?? "";
    const edit = pasteMarkdownTableCells(block, target, text);
    if (!edit) return;

    event.preventDefault();
    dispatchMarkdownTableEdit(view, edit);
  });
  input.addEventListener("keydown", (event) => {
    event.stopPropagation();
    // WebKit ends composition before delivering the confirmation keydown.
    // Its legacy 229 code still marks that key as owned by the IME.
    if (event.isComposing || event.keyCode === 229) return;

    const structureEdit = tableStructureEditForKey(event, block, target);
    if (structureEdit) {
      event.preventDefault();
      const change = pendingCellChange();
      dispatchMarkdownTableEdit(view, mergeMarkdownTableEdit(structureEdit, change));
      return;
    }

    if (event.key === "Tab") {
      event.preventDefault();
      const direction = event.shiftKey ? "previous" : "next";
      const nextTarget = navigateMarkdownTableCell(block, target, direction);
      const change = pendingCellChange();

      if (nextTarget) {
        if (change) {
          view.dispatch({
            changes: change,
            effects: setPreviewRevealRange.of(null),
          });
        }
        focusMarkdownTableCellInput(view, nextTarget);
        return;
      }

      if (!event.shiftKey) {
        const rowInsert = appendMarkdownTableRow(block);
        if (rowInsert) {
          view.dispatch({
            changes: change ? [change, rowInsert.change] : rowInsert.change,
            selection: {
              anchor: rowInsert.change.from + rowInsert.change.insert.length,
            },
            effects: setPreviewRevealRange.of(null),
          });
          focusMarkdownTableCellInput(view, rowInsert.target);
          return;
        }
      }

      if (change) {
        view.dispatch({
          changes: change,
          selection: { anchor: change.from + change.insert.length },
          effects: setPreviewRevealRange.of(null),
        });
      }
      input.blur();
      return;
    }
    if (event.key === "Enter") {
      event.preventDefault();
      const direction = event.shiftKey ? "up" : "down";
      const nextTarget = navigateMarkdownTableCell(block, target, direction);
      const change = pendingCellChange();

      if (nextTarget) {
        if (change) {
          view.dispatch({
            changes: change,
            effects: setPreviewRevealRange.of(null),
          });
        }
        focusMarkdownTableCellInput(view, nextTarget);
        return;
      }

      if (!event.shiftKey) {
        const rowInsert = appendMarkdownTableRow(block, target.cellIndex);
        if (rowInsert) {
          view.dispatch({
            changes: change ? [change, rowInsert.change] : rowInsert.change,
            selection: {
              anchor: rowInsert.change.from + rowInsert.change.insert.length,
            },
            effects: setPreviewRevealRange.of(null),
          });
          focusMarkdownTableCellInput(view, rowInsert.target);
          return;
        }
      }

      if (change) {
        view.dispatch({
          changes: change,
          selection: { anchor: change.from + change.insert.length },
          effects: setPreviewRevealRange.of(null),
        });
      }
      input.blur();
      return;
    }
    if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
      const atStart = input.selectionStart === 0 && input.selectionEnd === 0;
      const atEnd =
        input.selectionStart === input.value.length && input.selectionEnd === input.value.length;
      if ((event.key === "ArrowLeft" && !atStart) || (event.key === "ArrowRight" && !atEnd)) {
        return;
      }

      event.preventDefault();
      const direction = event.key === "ArrowLeft" ? "previous" : "next";
      const nextTarget = navigateMarkdownTableCell(block, target, direction);
      const change = pendingCellChange();

      if (nextTarget) {
        if (change) {
          view.dispatch({
            changes: change,
            effects: setPreviewRevealRange.of(null),
          });
        }
        focusMarkdownTableCellInput(view, nextTarget, event.key === "ArrowLeft" ? "end" : "start");
        return;
      }

      if (change) {
        view.dispatch({
          changes: change,
          selection: { anchor: change.from + change.insert.length },
          effects: setPreviewRevealRange.of(null),
        });
      }
      return;
    }
    if (event.altKey && (event.key === "ArrowUp" || event.key === "ArrowDown")) {
      event.preventDefault();
      const direction = event.key === "ArrowUp" ? "up" : "down";
      const nextTarget = navigateMarkdownTableCell(block, target, direction);
      const change = pendingCellChange();

      if (nextTarget) {
        if (change) {
          view.dispatch({
            changes: change,
            effects: setPreviewRevealRange.of(null),
          });
        }
        focusMarkdownTableCellInput(view, nextTarget);
        return;
      }

      if (change) {
        view.dispatch({
          changes: change,
          selection: { anchor: change.from + change.insert.length },
          effects: setPreviewRevealRange.of(null),
        });
      }
      return;
    }
    if (event.key === "Escape") {
      event.preventDefault();
      input.value = value;
      input.blur();
    }
  });

  field.append(mirror, input);
  cell.appendChild(field);
}

type TableCellFocusPlacement = "start" | "end";

function dispatchMarkdownTableEdit(view: EditorView, edit: MarkdownTableEdit): void {
  const changes = [...edit.changes].sort((a, b) => a.from - b.from || a.to - b.to);
  view.dispatch({
    changes: changes.length === 1 ? changes[0] : changes,
    effects: setPreviewRevealRange.of(null),
  });
  if (edit.target) focusMarkdownTableCellInput(view, edit.target);
}

function mergeMarkdownTableEdit(
  edit: MarkdownTableEdit,
  change: ReturnType<typeof updateMarkdownTableCell> | undefined,
): MarkdownTableEdit {
  if (!change || edit.changes.some((editChange) => textChangesOverlap(change, editChange))) {
    return edit;
  }
  return { ...edit, changes: [change, ...edit.changes] };
}

function textChangesOverlap(
  first: { from: number; to: number },
  second: { from: number; to: number },
): boolean {
  return first.from < second.to && second.from < first.to;
}

function tableStructureEditForKey(
  event: KeyboardEvent,
  block: TableBlock,
  target: MarkdownTableCellTarget,
): MarkdownTableEdit | null {
  const mod = event.metaKey || event.ctrlKey;
  if (!mod) return null;

  if (event.altKey && event.key === "ArrowLeft") {
    return insertMarkdownTableColumn(block, target, "before");
  }
  if (event.altKey && event.key === "ArrowRight") {
    return insertMarkdownTableColumn(block, target, "after");
  }
  if (event.altKey && (event.key === "Backspace" || event.key === "Delete")) {
    return deleteMarkdownTableColumn(block, target);
  }
  if (!event.altKey && event.key === "Enter") {
    return insertMarkdownTableRow(block, target, event.shiftKey ? "before" : "after");
  }
  if (!event.altKey && (event.key === "Backspace" || event.key === "Delete")) {
    return deleteMarkdownTableRow(block, target);
  }

  return null;
}

function focusMarkdownTableCellInput(
  view: EditorView,
  target: MarkdownTableCellTarget,
  placement: TableCellFocusPlacement = "end",
): void {
  const selector = `.cm-markdown-table-cell-input[data-table-row-kind="${target.rowKind}"][data-table-row-index="${target.rowIndex}"][data-table-cell-index="${target.cellIndex}"]`;
  const focus = () => {
    const input = view.dom.querySelector<HTMLTextAreaElement>(selector);
    if (!input) return;
    input.focus();
    const cursor = placement === "start" ? 0 : input.value.length;
    input.setSelectionRange(cursor, cursor);
  };
  requestAnimationFrame(() => {
    focus();
    requestAnimationFrame(focus);
  });
}

interface EditableWidgetOptions {
  positionFromEvent?: (event: MouseEvent) => number | null;
}

function makeEditableWidget(
  element: HTMLElement,
  view: EditorView,
  projection: MarkdownBlockProjection,
  options: EditableWidgetOptions = {},
): void {
  element.classList.add("cm-editable-widget");
  element.tabIndex = 0;
  const reveal = (event: Event) => {
    event.preventDefault();
    event.stopPropagation();
    const pos =
      event instanceof MouseEvent
        ? projectedBlockClickPosition(event, element, view, projection, options)
        : Math.min(projection.cursorFrom, view.state.doc.length);
    view.dispatch({
      selection: { anchor: pos, head: pos },
      effects: setPreviewRevealRange.of({
        from: projection.revealFrom,
        to: projection.revealTo,
      }),
      scrollIntoView: true,
    });
    view.focus();
  };
  element.addEventListener("mousedown", reveal);
  element.addEventListener("keydown", (event) => {
    if (event.key === "Enter" || event.key === " ") reveal(event);
  });
}

function markdownBlockProjectionKey(projection: MarkdownBlockProjection | null): string {
  return projection
    ? `${projection.revealFrom}:${projection.revealTo}:${projection.cursorFrom}:${projection.cursorTo}:${projection.clickMode}`
    : "";
}

function projectedBlockClickPosition(
  event: MouseEvent,
  element: HTMLElement,
  view: EditorView,
  projection: MarkdownBlockProjection,
  options: EditableWidgetOptions,
): number {
  if (projection.clickMode === "contentStart") {
    return Math.min(projection.cursorFrom, view.state.doc.length);
  }

  if (projection.clickMode === "content") {
    const pos = options.positionFromEvent?.(event);
    if (pos !== null && pos !== undefined) return pos;
  }

  return blockClickPosition(event, element, view, projection.cursorFrom, projection.cursorTo);
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

  const longDocument = inspectLongDocument(state.doc.toString());
  for (const block of parseMarkdownBlocks(state.doc.toString())) {
    const revealFrom = block.kind === "inlineMath" ? block.lineFrom : block.from;
    const revealTo = block.kind === "inlineMath" ? block.lineTo : block.to;
    const projection = markdownBlockProjection(block);
    if (block.kind !== "table" && rangeIsRevealed(state, revealRange, revealFrom, revealTo)) {
      continue;
    }

    switch (block.kind) {
      case "frontMatter":
      case "toc":
      case "footnoteDefinition":
        widgets.push({
          from: block.from,
          to: block.to,
          widget: Decoration.replace({
            widget: new LongDocumentWidget(block, longDocument.headings),
            block: true,
          }),
        });
        break;
      case "fencedCode":
        widgets.push({
          from: block.from,
          to: block.to,
          widget: Decoration.replace({
            widget: block.isMermaid
              ? new MermaidWidget(block.content, projection)
              : new CodeBlockWidget(block.content, block.language, projection),
            block: true,
          }),
        });
        break;

      case "mathBlock":
        widgets.push({
          from: block.from,
          to: block.to,
          widget: Decoration.replace({
            widget: new MathWidget(block.content, true, projection),
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
            widget: new ImageWidget(block.alt, resolveImageSrc(block.src, mdPath), projection),
            block: true,
          }),
        });
        break;

      case "inlineMath":
        widgets.push({
          from: block.from,
          to: block.to,
          widget: Decoration.replace({
            widget: new MathWidget(block.latex, false, projection),
          }),
        });
        break;
    }
  }

  for (const reference of longDocument.references) {
    const line = state.doc.lineAt(reference.from);
    if (rangeIsRevealed(state, revealRange, line.from, line.to)) continue;
    if (widgets.some((widget) => reference.from < widget.to && reference.to > widget.from))
      continue;
    widgets.push({
      from: reference.from,
      to: reference.to,
      widget: Decoration.replace({ widget: new FootnoteWidget(reference) }),
    });
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
