export interface FenceMarker {
  marker: "`" | "~";
  length: number;
  info: string;
}

export type TableAlign = "left" | "center" | "right";

export interface ParsedTable {
  headers: string[];
  align: TableAlign[];
  rows: string[][];
}

export interface ImageLine {
  alt: string;
  src: string;
}

export type InlineSpanKind = "code" | "link" | "strong" | "emphasis" | "strike";

export interface InlineSpan {
  kind: InlineSpanKind;
  from: number;
  to: number;
  contentFrom: number;
  contentTo: number;
  openingFrom: number;
  openingTo: number;
  closingFrom: number;
  closingTo: number;
}

export interface TableCellSpan {
  contentFrom: number;
  contentTo: number;
}

export function readFenceOpener(text: string): FenceMarker | null {
  const match = text.match(/^[ \t]{0,3}(`{3,}|~{3,})(.*)$/);
  if (!match) return null;
  const marker = match[1][0] as "`" | "~";
  const info = match[2].trim();
  if (marker === "`" && info.includes("`")) return null;
  return { marker, length: match[1].length, info };
}

export function isFenceCloser(text: string, fence: FenceMarker): boolean {
  const marker = fence.marker === "`" ? "`" : "~";
  return new RegExp(`^[ \\t]{0,3}${marker}{${fence.length},}[ \\t]*$`).test(text);
}

export function getFenceLanguage(line: string): string | null {
  const fence = readFenceOpener(line);
  const token = fence?.info.split(/\s+/)[0]?.trim();
  if (!token) return null;
  return token
    .replace(/^\{?\.?/, "")
    .replace(/[{}]/g, "")
    .toLowerCase();
}

export function isMermaidLanguage(language: string | null): boolean {
  return language === "mermaid" || language === "mmd";
}

export function isTableRow(line: string): boolean {
  const trimmed = line.trim();
  return trimmed.length > 0 && trimmed.includes("|") && !readFenceOpener(trimmed);
}

export function isTableDelimiter(line: string): boolean {
  const cells = splitTableRow(line);
  return cells.length >= 2 && cells.every((cell) => /^:?-{3,}:?$/.test(cell.trim()));
}

export function parseMarkdownTable(source: string): ParsedTable | null {
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

export function splitTableRow(line: string): string[] {
  return rawTableCells(line).map((cell) => cleanInlineMarkdown(cell.text));
}

export function tableCellSpans(text: string): TableCellSpan[] {
  return rawTableCells(text).map((cell) => {
    let contentFrom = cell.from;
    let contentTo = cell.to;
    while (contentFrom < contentTo && /\s/.test(text[contentFrom])) contentFrom += 1;
    while (contentTo > contentFrom && /\s/.test(text[contentTo - 1])) contentTo -= 1;
    return { contentFrom, contentTo };
  });
}

export function parseImageLine(line: string): ImageLine | null {
  const firstBang = line.search(/!\[/);
  if (firstBang < 0 || line.slice(0, firstBang).trim()) return null;

  const labelStart = firstBang + 1;
  const labelEnd = findClosingBracket(line, labelStart);
  if (labelEnd < 0) return null;

  let cursor = labelEnd + 1;
  while (cursor < line.length && /\s/.test(line[cursor])) cursor += 1;
  if (line[cursor] !== "(") return null;

  const targetEnd = findClosingParen(line, cursor);
  if (targetEnd < 0 || line.slice(targetEnd + 1).trim()) return null;

  const src = parseImageTarget(line.slice(cursor + 1, targetEnd));
  if (!src) return null;
  return { alt: unescapeMarkdownText(line.slice(labelStart + 1, labelEnd)), src };
}

export function parseImageTarget(target: string): string | null {
  const trimmed = target.trim();
  if (!trimmed) return null;

  if (trimmed.startsWith("<")) {
    const end = findUnescaped(trimmed, ">", 1);
    return end > 1 ? unescapeMarkdownPath(trimmed.slice(1, end)) : null;
  }

  let end = trimmed.length;
  let escaped = false;
  let depth = 0;
  for (let index = 0; index < trimmed.length; index++) {
    const char = trimmed[index];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (char === "\\") {
      escaped = true;
      continue;
    }
    if (char === "(") depth += 1;
    if (char === ")" && depth > 0) depth -= 1;
    if (depth === 0 && /\s/.test(char) && /["'(]/.test(trimmed[index + 1] ?? "")) {
      end = index;
      break;
    }
  }

  return unescapeMarkdownPath(trimmed.slice(0, end));
}

export function scanInlineMarkdownSpans(text: string): InlineSpan[] {
  const spans: InlineSpan[] = [];
  const protectedSpans: Array<{ from: number; to: number }> = [];

  scanCodeSpans(text, spans, protectedSpans);
  scanLinks(text, spans, protectedSpans);
  scanPairedDelimiter(text, "~~", "strike", spans, protectedSpans);
  scanPairedDelimiter(text, "**", "strong", spans, protectedSpans);
  scanPairedDelimiter(text, "__", "strong", spans, protectedSpans);
  scanSingleEmphasis(text, "*", spans, protectedSpans);
  scanSingleEmphasis(text, "_", spans, protectedSpans);

  return spans.sort((a, b) => a.from - b.from || a.to - b.to);
}

function rawTableCells(line: string): Array<{ text: string; from: number; to: number }> {
  const trimmedStart = line.startsWith("|") ? 1 : 0;
  const trimmedEnd = line.endsWith("|") ? line.length - 1 : line.length;
  const cells: Array<{ text: string; from: number; to: number }> = [];
  let current = "";
  let escaped = false;
  let cellFrom = trimmedStart;

  for (let index = trimmedStart; index < trimmedEnd; index++) {
    const char = line[index];
    if (escaped) {
      current += char;
      escaped = false;
      continue;
    }
    if (char === "\\") {
      escaped = true;
      current += char;
      continue;
    }
    if (char === "|") {
      cells.push({ text: current, from: cellFrom, to: index });
      current = "";
      cellFrom = index + 1;
      continue;
    }
    current += char;
  }

  cells.push({ text: current, from: cellFrom, to: trimmedEnd });
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

function scanCodeSpans(
  text: string,
  spans: InlineSpan[],
  protectedSpans: Array<{ from: number; to: number }>,
): void {
  for (let index = 0; index < text.length; index++) {
    if (text[index] !== "`" || isEscaped(text, index)) continue;
    const openingTo = scanRun(text, index, "`");
    const delimiter = text.slice(index, openingTo);
    const closingFrom = text.indexOf(delimiter, openingTo);
    if (closingFrom < 0) {
      index = openingTo - 1;
      continue;
    }
    const closingTo = closingFrom + delimiter.length;
    addInlineSpan(
      spans,
      protectedSpans,
      {
        kind: "code",
        from: index,
        to: closingTo,
        contentFrom: openingTo,
        contentTo: closingFrom,
        openingFrom: index,
        openingTo,
        closingFrom,
        closingTo,
      },
      true,
    );
    index = closingTo - 1;
  }
}

function scanLinks(
  text: string,
  spans: InlineSpan[],
  protectedSpans: Array<{ from: number; to: number }>,
): void {
  for (let index = 0; index < text.length; index++) {
    const image = text[index] === "!" && text[index + 1] === "[";
    const labelStart = image ? index + 1 : index;
    if (text[labelStart] !== "[" || isEscaped(text, labelStart)) continue;
    if (spanOverlaps({ from: index, to: labelStart + 1 }, protectedSpans)) continue;

    const labelEnd = findClosingBracket(text, labelStart);
    if (labelEnd < 0 || text[labelEnd + 1] !== "(") continue;

    const targetEnd = findClosingParen(text, labelEnd + 1);
    if (targetEnd < 0) continue;

    const fullFrom = image ? index : labelStart;
    const fullTo = targetEnd + 1;
    const protectedSpan = { from: fullFrom, to: fullTo };
    if (spanOverlaps(protectedSpan, protectedSpans)) continue;

    if (!image) {
      addInlineSpan(
        spans,
        protectedSpans,
        {
          kind: "link",
          from: fullFrom,
          to: fullTo,
          contentFrom: labelStart + 1,
          contentTo: labelEnd,
          openingFrom: labelStart,
          openingTo: labelStart + 1,
          closingFrom: labelEnd,
          closingTo: fullTo,
        },
        true,
      );
    } else {
      protectedSpans.push(protectedSpan);
    }

    index = fullTo - 1;
  }
}

function scanPairedDelimiter(
  text: string,
  delimiter: string,
  kind: InlineSpanKind,
  spans: InlineSpan[],
  protectedSpans: Array<{ from: number; to: number }>,
): void {
  for (let index = 0; index < text.length; index++) {
    if (!text.startsWith(delimiter, index) || isEscaped(text, index)) continue;
    const contentFrom = index + delimiter.length;
    if (/\s/.test(text[contentFrom] ?? "")) continue;

    const closingFrom = findDelimiter(text, delimiter, contentFrom);
    if (closingFrom < 0 || /\s/.test(text[closingFrom - 1] ?? "")) continue;
    const closingTo = closingFrom + delimiter.length;

    if (
      addInlineSpan(spans, protectedSpans, {
        kind,
        from: index,
        to: closingTo,
        contentFrom,
        contentTo: closingFrom,
        openingFrom: index,
        openingTo: contentFrom,
        closingFrom,
        closingTo,
      })
    ) {
      index = closingTo - 1;
    }
  }
}

function scanSingleEmphasis(
  text: string,
  delimiter: "*" | "_",
  spans: InlineSpan[],
  protectedSpans: Array<{ from: number; to: number }>,
): void {
  for (let index = 0; index < text.length; index++) {
    if (text[index] !== delimiter || isEscaped(text, index)) continue;
    if (text[index - 1] === delimiter || text[index + 1] === delimiter) continue;
    if (!canOpenEmphasis(text, index, delimiter)) continue;

    const contentFrom = index + 1;
    const closingFrom = findSingleEmphasisClose(text, delimiter, contentFrom);
    if (closingFrom < 0) continue;
    const closingTo = closingFrom + 1;

    if (
      addInlineSpan(spans, protectedSpans, {
        kind: "emphasis",
        from: index,
        to: closingTo,
        contentFrom,
        contentTo: closingFrom,
        openingFrom: index,
        openingTo: contentFrom,
        closingFrom,
        closingTo,
      })
    ) {
      index = closingTo - 1;
    }
  }
}

function addInlineSpan(
  spans: InlineSpan[],
  protectedSpans: Array<{ from: number; to: number }>,
  span: InlineSpan,
  protect = false,
): boolean {
  if (span.contentFrom >= span.contentTo) return false;
  if (spanOverlaps(span, protectedSpans)) return false;
  spans.push(span);
  if (protect) protectedSpans.push({ from: span.from, to: span.to });
  return true;
}

function findDelimiter(text: string, delimiter: string, from: number): number {
  let cursor = from;
  while (cursor < text.length) {
    const next = text.indexOf(delimiter, cursor);
    if (next < 0) return -1;
    if (!isEscaped(text, next)) return next;
    cursor = next + delimiter.length;
  }
  return -1;
}

function findSingleEmphasisClose(text: string, delimiter: "*" | "_", from: number): number {
  for (let index = from; index < text.length; index++) {
    if (text[index] !== delimiter || isEscaped(text, index)) continue;
    if (text[index - 1] === delimiter || text[index + 1] === delimiter) continue;
    if (/\s/.test(text[index - 1] ?? "")) continue;
    if (delimiter === "_" && isWord(text[index - 1]) && isWord(text[index + 1])) continue;
    return index;
  }
  return -1;
}

function canOpenEmphasis(text: string, index: number, delimiter: "*" | "_"): boolean {
  if (/\s/.test(text[index + 1] ?? "")) return false;
  if (delimiter === "_" && isWord(text[index - 1]) && isWord(text[index + 1])) return false;
  return true;
}

function findClosingBracket(text: string, openIndex: number): number {
  let escaped = false;
  let depth = 0;
  for (let index = openIndex; index < text.length; index++) {
    const char = text[index];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (char === "\\") {
      escaped = true;
      continue;
    }
    if (char === "[") depth += 1;
    if (char === "]") {
      depth -= 1;
      if (depth === 0) return index;
    }
  }
  return -1;
}

function findClosingParen(text: string, openIndex: number): number {
  let escaped = false;
  let depth = 0;
  let inAngleDestination = false;
  for (let index = openIndex; index < text.length; index++) {
    const char = text[index];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (char === "\\") {
      escaped = true;
      continue;
    }
    if (char === "<" && depth === 1) inAngleDestination = true;
    if (char === ">" && inAngleDestination) inAngleDestination = false;
    if (inAngleDestination) continue;
    if (char === "(") depth += 1;
    if (char === ")") {
      depth -= 1;
      if (depth === 0) return index;
    }
  }
  return -1;
}

function findUnescaped(text: string, needle: string, from: number): number {
  for (let index = from; index < text.length; index++) {
    if (text[index] === needle && !isEscaped(text, index)) return index;
  }
  return -1;
}

function scanRun(text: string, from: number, char: string): number {
  let cursor = from;
  while (text[cursor] === char) cursor += 1;
  return cursor;
}

function isEscaped(text: string, index: number): boolean {
  let slashCount = 0;
  for (let cursor = index - 1; cursor >= 0 && text[cursor] === "\\"; cursor--) {
    slashCount += 1;
  }
  return slashCount % 2 === 1;
}

function spanOverlaps(
  span: { from: number; to: number },
  spans: Array<{ from: number; to: number }>,
): boolean {
  return spans.some((other) => span.from < other.to && span.to > other.from);
}

function unescapeMarkdownPath(path: string): string {
  return path.replace(/\\([\\()[\] ])/g, "$1");
}

function unescapeMarkdownText(text: string): string {
  return text.replace(/\\([\\[\]])/g, "$1");
}

function isWord(char: string | undefined): boolean {
  return !!char && /[\p{L}\p{N}_]/u.test(char);
}
