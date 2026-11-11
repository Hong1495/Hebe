import { parser } from "@lezer/markdown";

export interface DocumentRegion {
  from: number;
  to: number;
}
export interface LongDocumentBlock extends DocumentRegion {
  kind: "frontMatter" | "toc" | "footnoteDefinition";
  source: string;
  content: string;
  label?: string;
  startLine: number;
  endLine: number;
}
export interface DocumentHeading extends DocumentRegion {
  text: string;
  level: number;
  line: number;
  slug: string;
}
export interface FootnoteReference extends DocumentRegion {
  label: string;
  definition?: number;
  number: number;
}

export function frontMatterRange(source: string): DocumentRegion | null {
  const match = /^(?:\uFEFF)?---\r?\n[\s\S]*?\r?\n(?:---|\.\.\.)(?=\r?\n|$)/.exec(source);
  return match ? { from: 0, to: match[0].length } : null;
}

let cachedSource: string | undefined;
let cachedDocument: ReturnType<typeof parseLongDocument> | undefined;
export function inspectLongDocument(source: string) {
  if (source === cachedSource && cachedDocument) return cachedDocument;
  cachedSource = source;
  cachedDocument = parseLongDocument(source);
  return cachedDocument;
}

function parseLongDocument(source: string) {
  const front = frontMatterRange(source);
  // Keep offsets and line numbers unchanged while shielding metadata from Markdown.
  const body = front
    ? source.slice(0, front.to).replace(/[^\r\n]/g, " ") + source.slice(front.to)
    : source;
  const tree = parser.parse(body);
  const protectedRanges: DocumentRegion[] = [];
  const headings: DocumentHeading[] = [];
  const blocks: LongDocumentBlock[] = [];
  const slugs = new Map<string, number>();
  const lineStarts = [0];
  for (let index = 0; index < source.length; index++)
    if (source[index] === "\n") lineStarts.push(index + 1);
  const lineAt = (pos: number) => {
    let low = 0,
      high = lineStarts.length;
    while (low < high) {
      const mid = (low + high) >>> 1;
      if (lineStarts[mid] <= pos) low = mid + 1;
      else high = mid;
    }
    return low;
  };
  const block = (
    kind: LongDocumentBlock["kind"],
    from: number,
    to: number,
    content: string,
    label?: string,
  ) => {
    blocks.push({
      kind,
      from,
      to,
      content,
      label,
      source: source.slice(from, to),
      startLine: lineAt(from),
      endLine: lineAt(to),
    });
  };
  if (front)
    block(
      "frontMatter",
      0,
      front.to,
      source.slice(0, front.to).split(/\r?\n/).slice(1, -1).join("\n"),
    );
  tree.iterate({
    enter(node) {
      if (
        ["FencedCode", "CodeBlock", "InlineCode", "HTMLBlock", "Image"].includes(node.name) ||
        (node.name === "Link" && !/^\[(?:\^|toc\])/i.test(source.slice(node.from, node.to)))
      ) {
        protectedRanges.push({ from: node.from, to: node.to });
        return false;
      }
      const heading = /^(?:ATX|Setext)Heading([1-6])$/.exec(node.name);
      if (heading) {
        const raw = source.slice(node.from, node.to);
        const text = raw
          .replace(/^#{1,6}\s+/, "")
          .replace(/\s+#+\s*$/, "")
          .replace(/\r?\n[=-]+\s*$/, "")
          .replace(/[*_`]/g, "")
          .trim();
        const base =
          text
            .toLowerCase()
            .replace(/[^\p{L}\p{N}_\-\s]/gu, "")
            .trim()
            .replace(/\s+/g, "-")
            .replace(/^[^\p{L}]+/u, "") || "section";
        const count = slugs.get(base) ?? 0;
        slugs.set(base, count + 1);
        headings.push({
          text,
          from: node.from,
          to: node.to,
          level: Number(heading[1]),
          line: lineAt(node.from) - 1,
          slug: count ? `${base}-${count}` : base,
        });
      }
    },
  });
  const protectedAt = (from: number, to: number) =>
    protectedRanges.some((range) => from < range.to && to > range.from) ||
    !!(front && from < front.to);
  for (const match of source.matchAll(/^\[toc\][ \t]*\r?$/gim)) {
    if (!protectedAt(match.index, match.index + match[0].length))
      block("toc", match.index, match.index + match[0].trimEnd().length, "");
  }
  for (const match of source.matchAll(/^\[\^([^\]\s]+)\]:[ \t]*(.*)(?:\r?\n(?: {4}|\t).*)*/gm)) {
    if (protectedAt(match.index, match.index + 1)) continue;
    block(
      "footnoteDefinition",
      match.index,
      match.index + match[0].length,
      match[0].replace(/^\[\^[^\]]+\]:\s*/, "").replace(/\n(?: {4}|\t)/g, "\n"),
      match[1],
    );
  }
  const definitions = blocks.filter((item) => item.kind === "footnoteDefinition");
  const references: FootnoteReference[] = [];
  const numbers = new Map<string, number>();
  for (const match of source.matchAll(/\[\^([^\]\s]+)\]/g)) {
    const from = match.index;
    if (
      protectedAt(from, from + match[0].length) ||
      definitions.some((item) => from >= item.from && from < item.to) ||
      source[from - 1] === "\\"
    )
      continue;
    if (!numbers.has(match[1])) numbers.set(match[1], numbers.size + 1);
    references.push({
      from,
      to: from + match[0].length,
      label: match[1],
      number: numbers.get(match[1])!,
      definition: definitions.find((item) => item.label === match[1])?.from,
    });
  }
  return { blocks, headings, references };
}
