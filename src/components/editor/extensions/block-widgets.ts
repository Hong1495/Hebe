import { syntaxTree } from "@codemirror/language";
import {
  Decoration,
  type DecorationSet,
  EditorView,
  ViewPlugin,
  type ViewUpdate,
  WidgetType,
} from "@codemirror/view";
import katex from "katex";

let widgetIdCounter = 0;

class MathWidget extends WidgetType {
  readonly latex: string;
  readonly displayMode: boolean;

  constructor(latex: string, displayMode: boolean) {
    super();
    this.latex = latex;
    this.displayMode = displayMode;
  }

  override eq(other: MathWidget): boolean {
    return other.latex === this.latex && other.displayMode === this.displayMode;
  }

  toDOM(): HTMLElement {
    const span = document.createElement("span");
    span.className = this.displayMode ? "cm-math-block" : "cm-math-inline";
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

  constructor(code: string) {
    super();
    this.code = code;
    this.id = `mermaid-${(widgetIdCounter++).toString(36)}`;
  }

  override eq(other: MermaidWidget): boolean {
    return other.code === this.code;
  }

  toDOM(): HTMLElement {
    const container = document.createElement("div");
    container.className = "cm-mermaid-container";
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

class ImageWidget extends WidgetType {
  readonly alt: string;
  readonly src: string;

  constructor(alt: string, src: string) {
    super();
    this.alt = alt;
    this.src = src;
  }

  override eq(other: ImageWidget): boolean {
    return other.src === this.src;
  }

  toDOM(): HTMLElement {
    const container = document.createElement("div");
    container.className = "cm-image-container";

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

const IMAGE_RE = /^!\[([^\]]*)\]\(([^)]+)\)$/;
const MERMAID_RE = /^```mermaid\n([\s\S]*?)\n```$/;

function blockDecorations(view: EditorView): DecorationSet {
  const widgets: { from: number; to: number; widget: Decoration }[] = [];
  const { state } = view;
  const doc = state.doc;
  const tree = syntaxTree(state);
  let cursor = tree.cursor();

  do {
    const nodeName = cursor.name;
    const from = cursor.from;
    const to = cursor.to;

    if (nodeName === "Image") {
      const text = doc.sliceString(from, to);
      const match = text.match(IMAGE_RE);
      if (match) {
        widgets.push({
          from,
          to,
          widget: Decoration.replace({ widget: new ImageWidget(match[1], match[2]) }),
        });
      }
    }

    if (nodeName === "FencedCode") {
      const text = doc.sliceString(from, to);
      const mermaidMatch = text.match(MERMAID_RE);
      if (mermaidMatch) {
        widgets.push({
          from,
          to,
          widget: Decoration.replace({ widget: new MermaidWidget(mermaidMatch[1]) }),
        });
      }
    }

    // Scan paragraph/document text for both block and inline math regardless of children
    if (nodeName === "Paragraph" || nodeName === "Document") {
      const text = doc.sliceString(from, to);

      // Find block math spans: $$...$$
      scanBlockMath(text, from, widgets);

      // Find inline math: $...$ (skip spans inside blocks that are already widget-covered)
      scanInlineMath(
        text,
        from,
        widgets,
        widgets.map((w) => ({ from: w.from, to: w.to })),
      );
    }
  } while (cursor.next());

  return Decoration.set(
    widgets.map((w) => w.widget.range(w.from, w.to)),
    true,
  );
}

function scanBlockMath(
  text: string,
  baseOffset: number,
  widgets: { from: number; to: number; widget: Decoration }[],
): void {
  const blockMathRe = /\$\$([^$]+)\$\$/g;
  let match: RegExpExecArray | null;
  while ((match = blockMathRe.exec(text)) !== null) {
    const from = baseOffset + match.index;
    const to = from + match[0].length;
    widgets.push({
      from,
      to,
      widget: Decoration.replace({ widget: new MathWidget(match[1], true) }),
    });
  }
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
      widget: Decoration.replace({ widget: new MathWidget(match[1], false) }),
    });
  }
}

export const blockWidgetPlugin = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;

    constructor(view: EditorView) {
      this.decorations = blockDecorations(view);
    }

    update(update: ViewUpdate): void {
      if (update.docChanged || update.viewportChanged) {
        this.decorations = blockDecorations(update.view);
      }
    }
  },
  {
    decorations: (v) => v.decorations,
  },
);
