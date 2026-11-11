import { inspectLongDocument } from "../components/editor/long-document";
import { type FencedCodeBlock, parseMarkdownBlocks } from "../components/editor/markdown-kernel";
import { isTauriRuntime, renderSvgToPngDataUri } from "./ipc";

export type MermaidExportRenderer = (code: string, index: number) => Promise<string>;

let mermaidExportIdCounter = 0;

interface MarkdownReplacement {
  from: number;
  to: number;
  text: string;
}

export async function prepareMarkdownForExport(
  content: string,
  renderMermaid: MermaidExportRenderer = renderMermaidPngDataUri,
): Promise<string> {
  const mermaidBlocks = parseMarkdownBlocks(content).filter(
    (block): block is FencedCodeBlock => block.kind === "fencedCode" && block.isMermaid,
  );

  const longDocument = inspectLongDocument(content);
  const tocReplacements = longDocument.blocks
    .filter((block) => block.kind === "toc")
    .map((block) => ({
      from: block.from,
      to: block.to,
      text: longDocument.headings
        .map(
          (heading) =>
            `${"  ".repeat(heading.level - 1)}- [${heading.text.replace(/[\[\]]/g, "")}](#${heading.slug})`,
        )
        .join("\n"),
    }));

  const replacements = await Promise.all(
    mermaidBlocks.map(async (block, index): Promise<MarkdownReplacement> => {
      try {
        const dataUri = await renderMermaid(block.content, index);
        return {
          from: block.from,
          to: block.to,
          text: `![Mermaid diagram ${index + 1}](${dataUri})`,
        };
      } catch (error) {
        const detail = error instanceof Error ? error.message : String(error);
        throw new Error(`Failed to render Mermaid diagram ${index + 1}: ${detail}`);
      }
    }),
  );

  return applyMarkdownReplacements(content, [...replacements, ...tocReplacements]);
}

function applyMarkdownReplacements(content: string, replacements: MarkdownReplacement[]): string {
  return [...replacements]
    .sort((a, b) => b.from - a.from)
    .reduce(
      (nextContent, replacement) =>
        `${nextContent.slice(0, replacement.from)}${replacement.text}${nextContent.slice(
          replacement.to,
        )}`,
      content,
    );
}

async function renderMermaidPngDataUri(code: string, index: number): Promise<string> {
  const { default: mermaid } = await import("mermaid");
  mermaid.initialize({
    startOnLoad: false,
    securityLevel: "strict",
    htmlLabels: false,
    flowchart: { htmlLabels: false },
  });

  const renderId = `hebe-export-mermaid-${(mermaidExportIdCounter++).toString(36)}-${index}`;
  const result = await mermaid.render(renderId, code);

  if (isTauriRuntime()) {
    return renderSvgToPngDataUri(result.svg);
  }

  const size = readSvgSize(result.svg);
  return svgToPngDataUri(result.svg, size);
}

interface SvgSize {
  width: number;
  height: number;
}

function readSvgSize(svg: string): SvgSize {
  const parsed = new DOMParser().parseFromString(svg, "image/svg+xml");
  const root = parsed.documentElement;
  const viewBox = root
    .getAttribute("viewBox")
    ?.split(/[\s,]+/)
    .map(Number);
  const viewBoxWidth = viewBox && viewBox.length >= 4 ? viewBox[2] : null;
  const viewBoxHeight = viewBox && viewBox.length >= 4 ? viewBox[3] : null;

  return {
    width: clampSvgSize(readSvgLength(root.getAttribute("width")) ?? viewBoxWidth ?? 800),
    height: clampSvgSize(readSvgLength(root.getAttribute("height")) ?? viewBoxHeight ?? 400),
  };
}

function readSvgLength(value: string | null): number | null {
  if (!value) return null;
  const match = value.trim().match(/^(\d+(?:\.\d+)?)/);
  if (!match) return null;
  const length = Number(match[1]);
  return Number.isFinite(length) && length > 0 ? length : null;
}

function clampSvgSize(value: number): number {
  return Math.max(1, Math.min(2400, Math.ceil(value)));
}

async function svgToPngDataUri(svg: string, size: SvgSize): Promise<string> {
  const image = new Image();
  const objectUrl = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml;charset=utf-8" }));

  try {
    await new Promise<void>((resolve, reject) => {
      image.onload = () => resolve();
      image.onerror = () => reject(new Error("Unable to load rendered Mermaid SVG"));
      image.src = objectUrl;
    });

    const scale = Math.min(2, Math.max(1, window.devicePixelRatio || 1));
    const canvas = document.createElement("canvas");
    canvas.width = Math.ceil(size.width * scale);
    canvas.height = Math.ceil(size.height * scale);

    const context = canvas.getContext("2d");
    if (!context) throw new Error("Unable to create image canvas");

    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(image, 0, 0, canvas.width, canvas.height);

    return canvas.toDataURL("image/png");
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}
