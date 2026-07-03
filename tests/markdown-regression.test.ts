import { describe, expect, it } from "vitest";
import {
  markdownBlockProjection,
  markdownVisibleLineLength,
  parseMarkdownBlocks,
  scanMarkdownLineDecorations,
} from "../src/components/editor/markdown-kernel";

const REGRESSION_MARKDOWN_SAMPLE = [
  "# Hybrid Kernel Regression",
  "",
  "A paragraph with **bold**, *emphasis*, ~~strike~~, `code`, [link](https://example.com), and $x+1$.",
  "",
  "- [x] Done",
  "- [ ] Todo",
  "> Quote with **strong text**",
  "",
  "| Name | Value |",
  "| --- | ---: |",
  "| alpha | 1 |",
  "| beta |  |",
  "",
  "```mermaid",
  "flowchart LR",
  "    A[Start] --> B[Done]",
  "```",
  "",
  "```mermaid",
  "flowchart LR",
  "    A -->",
  "```",
  "",
  "```js",
  "const value = '**not markdown**';",
  "```",
  "",
  "$$",
  "a^2 + b^2 = c^2",
  "$$",
  "",
  "![Missing](assets/missing-image.png)",
].join("\n");

describe("markdown regression matrix", () => {
  it("parses the fixed hybrid kernel sample without collapsing unrelated blocks", () => {
    const blocks = parseMarkdownBlocks(REGRESSION_MARKDOWN_SAMPLE);

    expect(blocks.filter((block) => block.kind === "table")).toHaveLength(1);
    expect(blocks.filter((block) => block.kind === "fencedCode")).toHaveLength(3);
    expect(blocks.filter((block) => block.kind === "inlineMath")).toHaveLength(1);
    expect(blocks.filter((block) => block.kind === "mathBlock")).toHaveLength(1);
    expect(blocks.filter((block) => block.kind === "image")).toHaveLength(1);
  });

  it("keeps projection targets stable across all fixed block kinds", () => {
    const projections = parseMarkdownBlocks(REGRESSION_MARKDOWN_SAMPLE).map(markdownBlockProjection);

    expect(projections.every((projection) => projection.revealFrom <= projection.revealTo)).toBe(
      true,
    );
    expect(projections.every((projection) => projection.cursorFrom <= projection.cursorTo)).toBe(
      true,
    );
    expect(projections.some((projection) => projection.clickMode === "contentStart")).toBe(true);
    expect(projections.some((projection) => projection.clickMode === "content")).toBe(true);
    expect(projections.some((projection) => projection.clickMode === "range")).toBe(true);
  });

  it("keeps inline projection visible lengths stable for common markdown forms", () => {
    expect(markdownVisibleLineLength("**bold** and *em*")).toBe("bold and em".length);
    expect(markdownVisibleLineLength("[link](https://example.com)")).toBe("link".length);
    expect(markdownVisibleLineLength("- [ ] task")).toBe("☐task".length);
    expect(markdownVisibleLineLength("> quoted")).toBe("quoted".length);
  });

  it("scans a large mixed markdown document within a conservative baseline", () => {
    const section = [
      "## Section",
      "Paragraph with **bold** and [link](url).",
      "| A | B |",
      "| --- | --- |",
      "| x | y |",
      "```js",
      "const a = 1;",
      "```",
      "",
    ].join("\n");
    const largeDocument = Array.from({ length: 400 }, () => section).join("\n");

    const startedAt = performance.now();
    const blocks = parseMarkdownBlocks(largeDocument);
    const decorations = scanMarkdownLineDecorations(largeDocument);
    const elapsed = performance.now() - startedAt;

    expect(blocks.length).toBeGreaterThan(700);
    expect(decorations.length).toBeGreaterThan(3000);
    expect(elapsed).toBeLessThan(3000);
  });
});
