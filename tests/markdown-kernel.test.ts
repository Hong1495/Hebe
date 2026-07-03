import { describe, expect, it } from "vitest";
import {
  parseImageLine,
  parseMarkdownBlocks,
  scanInlineMarkdownSpans,
  scanMarkdownLineDecorations,
} from "../src/components/editor/markdown-kernel";

describe("markdown kernel", () => {
  it("parses Mermaid fences without treating diagram text as markdown", () => {
    const source = "before\n```mermaid\nflowchart TD\n  A-->B\n```\nafter";
    const blocks = parseMarkdownBlocks(source);

    expect(blocks).toHaveLength(1);
    expect(blocks[0]).toMatchObject({
      kind: "fencedCode",
      language: "mermaid",
      isMermaid: true,
      content: "flowchart TD\n  A-->B",
      startLine: 2,
      endLine: 5,
    });
  });

  it("keeps unclosed fence content through the last line", () => {
    const blocks = parseMarkdownBlocks("```js\nconst a = 1;\nlast line");

    expect(blocks[0]).toMatchObject({
      kind: "fencedCode",
      language: "js",
      content: "const a = 1;\nlast line",
      startLine: 1,
      endLine: 3,
    });
  });

  it("parses table alignment and cleaned inline cell text", () => {
    const blocks = parseMarkdownBlocks("| A | B |\n| :--- | ---: |\n| `x` | **y** |");

    expect(blocks[0]).toMatchObject({
      kind: "table",
      table: {
        headers: ["A", "B"],
        align: ["left", "right"],
        rows: [["x", "y"]],
      },
    });
  });

  it("parses standalone image lines with markdown path forms", () => {
    expect(parseImageLine("![](assets/image-1.png)")).toEqual({
      alt: "",
      src: "assets/image-1.png",
    });
    expect(parseImageLine("![A](<assets/my image.png>)")).toEqual({
      alt: "A",
      src: "assets/my image.png",
    });
    expect(parseMarkdownBlocks("![A](<assets/my image.png>)")[0]).toMatchObject({
      kind: "image",
      alt: "A",
      src: "assets/my image.png",
    });
  });

  it("scans inline markdown spans while protecting code spans", () => {
    const spans = scanInlineMarkdownSpans("**bold** *em* `code` [link](url) ~~gone~~");

    expect(spans.map((span) => span.kind)).toEqual([
      "strong",
      "emphasis",
      "code",
      "link",
      "strike",
    ]);
  });

  it("scans line decorations and isolates fenced code lines", () => {
    const source = "# Title\n- [x] Done\n> Quote\n---\n```js\n**not bold**\n```";
    const lines = scanMarkdownLineDecorations(source);

    expect(lines[0].classes).toEqual(["md-heading", "md-heading-1"]);
    expect(lines[0].replacements[0]).toMatchObject({ kind: "hide", from: 0, to: 2 });
    expect(lines[1].classes).toEqual(["md-list-line"]);
    expect(lines[1].replacements[0]).toMatchObject({
      kind: "listMarker",
      marker: "bullet",
      checked: true,
      checkFrom: "# Title\n- [".length,
      checkTo: "# Title\n- [x".length,
    });
    expect(lines[5].classes).toEqual(["md-code-block-line"]);
    expect(lines[5].inlineSpans).toEqual([]);
  });

  it("finds inline math outside inline code", () => {
    const math = parseMarkdownBlocks("Inline $x+1$ and `$no$`").filter(
      (block) => block.kind === "inlineMath",
    );

    expect(math).toHaveLength(1);
    expect(math[0]).toMatchObject({
      latex: "x+1",
      lineFrom: 0,
      lineTo: "Inline $x+1$ and `$no$`".length,
    });
  });

  it("parses block math content", () => {
    expect(parseMarkdownBlocks("$$\na^2 + b^2 = c^2\n$$")[0]).toMatchObject({
      kind: "mathBlock",
      content: "a^2 + b^2 = c^2",
      startLine: 1,
      endLine: 3,
    });
  });
});
