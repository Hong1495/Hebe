import { describe, expect, it } from "vitest";
import {
  appendMarkdownTableRow,
  deleteMarkdownTableColumn,
  deleteMarkdownTableRow,
  formatMarkdownSelection,
  insertMarkdownTableColumn,
  insertMarkdownTableRow,
  isMarkdownFormatCommand,
  markdownBlockProjection,
  markdownBlockPositionFromHit,
  markdownSourceRangePositionFromRatio,
  navigateMarkdownTableCell,
  type MarkdownTextChange,
  pasteMarkdownTableCells,
  pasteMarkdownImage,
  parseImageLine,
  parseMarkdownBlocks,
  scanInlineMarkdownSpans,
  scanMarkdownLineDecorations,
  updateMarkdownTableCell,
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

  it("keeps table source rows in the kernel", () => {
    const source = "before\n| A | B |\n| :--- | ---: |\n| `x` | **y** |";
    const block = parseMarkdownBlocks(source)[0];

    expect(block).toMatchObject({
      kind: "table",
      sourceRows: [
        { kind: "header", rowIndex: 0, lineNumber: 2 },
        { kind: "delimiter", rowIndex: 0, lineNumber: 3 },
        { kind: "body", rowIndex: 0, lineNumber: 4 },
      ],
    });
  });

  it("maps rendered table cell hits to source cell positions", () => {
    const source = "before\n| A | B |\n| :--- | ---: |\n| `x` | **y** |\n| z | q |";
    const block = parseMarkdownBlocks(source)[0];

    const bodyCell = markdownBlockPositionFromHit(source, block, {
      kind: "tableCell",
      rowKind: "body",
      rowIndex: 0,
      cellIndex: 1,
      xRatio: 0,
    });
    const secondBodyCell = markdownBlockPositionFromHit(source, block, {
      kind: "tableCell",
      rowKind: "body",
      rowIndex: 1,
      cellIndex: 0,
      xRatio: 0,
    });

    expect(bodyCell).toBe(source.indexOf("**y**"));
    expect(secondBodyCell).toBe(source.indexOf("z"));
  });

  it("creates table cell update edits from the kernel source map", () => {
    const source = "| A | B |\n| --- | --- |\n| x | y |";
    const block = parseMarkdownBlocks(source)[0];
    if (block.kind !== "table") throw new Error("expected table block");

    const change = updateMarkdownTableCell(
      block,
      { rowKind: "body", rowIndex: 0, cellIndex: 1 },
      "z",
    );

    expect(change).not.toBeNull();
    expect(applyMarkdownEdit(source, { changes: [change as MarkdownTextChange] })).toBe(
      "| A | B |\n| --- | --- |\n| x | z |",
    );
  });

  it("escapes pipes when updating markdown table cells", () => {
    const source = "| A | B |\n| --- | --- |\n| x | y |";
    const block = parseMarkdownBlocks(source)[0];
    if (block.kind !== "table") throw new Error("expected table block");

    const change = updateMarkdownTableCell(
      block,
      { rowKind: "header", rowIndex: 0, cellIndex: 0 },
      "a|b",
    );

    expect(change).not.toBeNull();
    expect(applyMarkdownEdit(source, { changes: [change as MarkdownTextChange] })).toBe(
      "| a\\|b | B |\n| --- | --- |\n| x | y |",
    );
  });

  it("normalizes empty table cells when updating through projection", () => {
    const source = "| A | B |\n| --- | --- |\n|  |  |";
    const block = parseMarkdownBlocks(source)[0];
    if (block.kind !== "table") throw new Error("expected table block");

    const change = updateMarkdownTableCell(
      block,
      { rowKind: "body", rowIndex: 0, cellIndex: 0 },
      "alpha",
    );

    expect(change).not.toBeNull();
    expect(applyMarkdownEdit(source, { changes: [change as MarkdownTextChange] })).toBe(
      "| A | B |\n| --- | --- |\n| alpha |  |",
    );
  });

  it("does not create table cell edits for missing cells", () => {
    const source = "| A | B |\n| --- | --- |\n| x | y |";
    const block = parseMarkdownBlocks(source)[0];
    if (block.kind !== "table") throw new Error("expected table block");

    expect(
      updateMarkdownTableCell(block, { rowKind: "body", rowIndex: 0, cellIndex: 5 }, "z"),
    ).toBeNull();
  });

  it("navigates table cells in projected editing order", () => {
    const source = "| A | B |\n| --- | --- |\n| x | y |\n| z | q |";
    const block = parseMarkdownBlocks(source)[0];
    if (block.kind !== "table") throw new Error("expected table block");

    expect(
      navigateMarkdownTableCell(block, { rowKind: "header", rowIndex: 0, cellIndex: 1 }, "next"),
    ).toEqual({ rowKind: "body", rowIndex: 0, cellIndex: 0 });
    expect(
      navigateMarkdownTableCell(block, { rowKind: "body", rowIndex: 1, cellIndex: 0 }, "previous"),
    ).toEqual({ rowKind: "body", rowIndex: 0, cellIndex: 1 });
    expect(
      navigateMarkdownTableCell(block, { rowKind: "body", rowIndex: 1, cellIndex: 1 }, "next"),
    ).toBeNull();
    expect(
      navigateMarkdownTableCell(block, { rowKind: "body", rowIndex: 0, cellIndex: 1 }, "down"),
    ).toEqual({ rowKind: "body", rowIndex: 1, cellIndex: 1 });
    expect(
      navigateMarkdownTableCell(block, { rowKind: "body", rowIndex: 0, cellIndex: 0 }, "up"),
    ).toEqual({ rowKind: "header", rowIndex: 0, cellIndex: 0 });
  });

  it("creates append-row edits from table shape", () => {
    const source = "| A | B |\n| --- | --- |\n| x | y |";
    const block = parseMarkdownBlocks(source)[0];
    if (block.kind !== "table") throw new Error("expected table block");

    const edit = appendMarkdownTableRow(block);

    expect(edit).not.toBeNull();
    expect(applyMarkdownEdit(source, { changes: [(edit as NonNullable<typeof edit>).change] })).toBe(
      "| A | B |\n| --- | --- |\n| x | y |\n|  |  |",
    );
    expect(edit?.target).toEqual({ rowKind: "body", rowIndex: 1, cellIndex: 0 });
  });

  it("creates append-row edits targeting the requested column", () => {
    const source = "| A | B |\n| --- | --- |";
    const block = parseMarkdownBlocks(source)[0];
    if (block.kind !== "table") throw new Error("expected table block");

    const edit = appendMarkdownTableRow(block, 1);

    expect(edit).not.toBeNull();
    expect(applyMarkdownEdit(source, { changes: [(edit as NonNullable<typeof edit>).change] })).toBe(
      "| A | B |\n| --- | --- |\n|  |  |",
    );
    expect(edit?.target).toEqual({ rowKind: "body", rowIndex: 0, cellIndex: 1 });
  });

  it("combines last-cell updates with table row insertion", () => {
    const source = "| A | B |\n| --- | --- |\n| alpha |  |";
    const block = parseMarkdownBlocks(source)[0];
    if (block.kind !== "table") throw new Error("expected table block");

    const cellChange = updateMarkdownTableCell(
      block,
      { rowKind: "body", rowIndex: 0, cellIndex: 1 },
      "beta",
    );
    const rowInsert = appendMarkdownTableRow(block);

    expect(cellChange).not.toBeNull();
    expect(rowInsert).not.toBeNull();
    expect(
      applyMarkdownEdit(source, {
        changes: [cellChange as MarkdownTextChange, (rowInsert as NonNullable<typeof rowInsert>).change],
      }),
    ).toBe("| A | B |\n| --- | --- |\n| alpha | beta |\n|  |  |");
  });

  it("inserts markdown table rows before and after projected targets", () => {
    const source = "| A | B |\n| --- | --- |\n| x | y |\n| z | q |";
    const block = parseMarkdownBlocks(source)[0];
    if (block.kind !== "table") throw new Error("expected table block");

    const before = insertMarkdownTableRow(
      block,
      { rowKind: "body", rowIndex: 1, cellIndex: 1 },
      "before",
    );
    const afterHeader = insertMarkdownTableRow(
      block,
      { rowKind: "header", rowIndex: 0, cellIndex: 1 },
      "after",
    );

    expect(before).not.toBeNull();
    expect(applyMarkdownEdit(source, before as NonNullable<typeof before>)).toBe(
      "| A | B |\n| --- | --- |\n| x | y |\n|  |  |\n| z | q |",
    );
    expect(before?.target).toEqual({ rowKind: "body", rowIndex: 1, cellIndex: 1 });
    expect(applyMarkdownEdit(source, afterHeader as NonNullable<typeof afterHeader>)).toBe(
      "| A | B |\n| --- | --- |\n|  |  |\n| x | y |\n| z | q |",
    );
  });

  it("deletes markdown table body rows without removing the table header", () => {
    const source = "| A | B |\n| --- | --- |\n| x | y |\n| z | q |";
    const block = parseMarkdownBlocks(source)[0];
    if (block.kind !== "table") throw new Error("expected table block");

    const edit = deleteMarkdownTableRow(block, { rowKind: "body", rowIndex: 0, cellIndex: 1 });

    expect(edit).not.toBeNull();
    expect(applyMarkdownEdit(source, edit as NonNullable<typeof edit>)).toBe(
      "| A | B |\n| --- | --- |\n| z | q |",
    );
    expect(edit?.target).toEqual({ rowKind: "body", rowIndex: 0, cellIndex: 1 });
    expect(deleteMarkdownTableRow(block, { rowKind: "header", rowIndex: 0, cellIndex: 1 })).toBeNull();
  });

  it("inserts and deletes markdown table columns while preserving cell source", () => {
    const source = "| **A** | B |\n| :--- | ---: |\n| `x` | y |";
    const block = parseMarkdownBlocks(source)[0];
    if (block.kind !== "table") throw new Error("expected table block");

    const inserted = insertMarkdownTableColumn(
      block,
      { rowKind: "body", rowIndex: 0, cellIndex: 0 },
      "after",
    );
    const withColumn = applyMarkdownEdit(source, inserted as NonNullable<typeof inserted>);
    const insertedBlock = parseMarkdownBlocks(withColumn)[0];
    if (insertedBlock.kind !== "table") throw new Error("expected table block");
    const deleted = deleteMarkdownTableColumn(insertedBlock, {
      rowKind: "body",
      rowIndex: 0,
      cellIndex: 1,
    });

    expect(inserted).not.toBeNull();
    expect(withColumn).toBe("| **A** |  | B |\n| --- | --- | ---: |\n| `x` |  | y |");
    expect(inserted?.target).toEqual({ rowKind: "body", rowIndex: 0, cellIndex: 1 });
    expect(deleted).not.toBeNull();
    expect(applyMarkdownEdit(withColumn, deleted as NonNullable<typeof deleted>)).toBe(
      "| **A** | B |\n| --- | ---: |\n| `x` | y |",
    );
  });

  it("pastes TSV cells into a projected markdown table and appends missing rows", () => {
    const source = "| A | B | C |\n| --- | --- | --- |\n| x | y | z |";
    const block = parseMarkdownBlocks(source)[0];
    if (block.kind !== "table") throw new Error("expected table block");

    const edit = pasteMarkdownTableCells(
      block,
      { rowKind: "body", rowIndex: 0, cellIndex: 1 },
      "b1\tc1\nb2\tc2",
    );

    expect(edit).not.toBeNull();
    expect(applyMarkdownEdit(source, edit as NonNullable<typeof edit>)).toBe(
      "| A | B | C |\n| --- | --- | --- |\n| x | b1 | c1 |\n|  | b2 | c2 |",
    );
    expect(edit?.target).toEqual({ rowKind: "body", rowIndex: 1, cellIndex: 2 });
  });

  it("pastes markdown table cells through the projected table core", () => {
    const source = "| A | B |\n| --- | --- |\n| x | y |";
    const block = parseMarkdownBlocks(source)[0];
    if (block.kind !== "table") throw new Error("expected table block");

    const edit = pasteMarkdownTableCells(
      block,
      { rowKind: "header", rowIndex: 0, cellIndex: 0 },
      "| H1 | H2 |\n| --- | --- |\n| a | b |",
    );

    expect(edit).not.toBeNull();
    expect(applyMarkdownEdit(source, edit as NonNullable<typeof edit>)).toBe(
      "| H1 | H2 |\n| --- | --- |\n| a | b |",
    );
  });

  it("maps block ratio hits by line buckets instead of rounding into the next line", () => {
    const source = "```js\nconst a = 1;\nconst b = 2;\n```";
    const block = parseMarkdownBlocks(source)[0];

    const firstLine = markdownSourceRangePositionFromRatio(source, block.from, block.to, {
      xRatio: 0,
      yRatio: 0.24,
    });
    const secondLine = markdownSourceRangePositionFromRatio(source, block.from, block.to, {
      xRatio: 0,
      yRatio: 0.25,
    });

    expect(firstLine).toBe(0);
    expect(secondLine).toBe(source.indexOf("const a"));
  });

  it("maps fenced block content ranges without targeting fence lines", () => {
    const source = "```js\nalpha();\nbeta();\n```";
    const block = parseMarkdownBlocks(source)[0];
    if (block.kind !== "fencedCode") throw new Error("expected fenced code block");

    const firstContentLine = markdownSourceRangePositionFromRatio(
      source,
      block.contentFrom,
      block.contentTo,
      { xRatio: 0, yRatio: 0 },
    );
    const lastContentLine = markdownSourceRangePositionFromRatio(
      source,
      block.contentFrom,
      block.contentTo,
      { xRatio: 0, yRatio: 0.99 },
    );

    expect(firstContentLine).toBe(source.indexOf("alpha"));
    expect(lastContentLine).toBe(source.indexOf("beta"));
  });

  it("keeps tilde Mermaid edges inside backtick fences", () => {
    const source = [
      "```mermaid",
      "flowchart LR",
      "    B1 ~~~ C1",
      "    B2 ~~~ C2",
      "```",
    ].join("\n");
    const block = parseMarkdownBlocks(source)[0];

    expect(block).toMatchObject({
      kind: "fencedCode",
      isMermaid: true,
      startLine: 1,
      endLine: 5,
      content: "flowchart LR\n    B1 ~~~ C1\n    B2 ~~~ C2",
    });
  });

  it("creates unified block projection targets for Mermaid and code fences", () => {
    const source = "```mermaid\nflowchart TD\n  A-->B\n```\n\n```js\nalpha();\nbeta();\n```";
    const blocks = parseMarkdownBlocks(source);
    const mermaid = blocks[0];
    const code = blocks[1];
    if (mermaid.kind !== "fencedCode" || code.kind !== "fencedCode") {
      throw new Error("expected fenced code blocks");
    }

    expect(markdownBlockProjection(mermaid)).toEqual({
      revealFrom: mermaid.from,
      revealTo: mermaid.to,
      cursorFrom: mermaid.contentFrom,
      cursorTo: mermaid.contentTo,
      clickMode: "contentStart",
    });
    expect(markdownBlockProjection(code)).toEqual({
      revealFrom: code.from,
      revealTo: code.to,
      cursorFrom: code.contentFrom,
      cursorTo: code.contentTo,
      clickMode: "content",
    });
  });

  it("creates unified block projection targets for math and images", () => {
    const source = "$$\na+b\n$$\n\n![Alt](assets/a.png)";
    const blocks = parseMarkdownBlocks(source);
    const math = blocks[0];
    const image = blocks[1];
    if (math.kind !== "mathBlock" || image.kind !== "image") {
      throw new Error("expected math and image blocks");
    }

    expect(markdownBlockProjection(math)).toEqual({
      revealFrom: math.from,
      revealTo: math.to,
      cursorFrom: math.contentFrom,
      cursorTo: math.contentTo,
      clickMode: "range",
    });
    expect(markdownBlockProjection(image)).toEqual({
      revealFrom: image.from,
      revealTo: image.to,
      cursorFrom: image.from,
      cursorTo: image.to,
      clickMode: "range",
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

  it("creates inline markdown format edits", () => {
    const edit = formatMarkdownSelection("hello", { from: 0, to: 5 }, "format-bold");

    expect(applyMarkdownEdit("hello", edit)).toBe("**hello**");
    expect(edit.selection).toEqual({ from: 2, to: 7 });
  });

  it("creates markdown link edits with the url selected", () => {
    const edit = formatMarkdownSelection("OpenAI", { from: 0, to: 6 }, "format-link");

    expect(applyMarkdownEdit("OpenAI", edit)).toBe("[OpenAI](url)");
    expect(edit.selection).toEqual({ from: 9, to: 12 });
  });

  it("creates heading edits from the current line", () => {
    const source = "Intro\n  ## Old title";
    const edit = formatMarkdownSelection(source, { from: source.length, to: source.length }, "format-heading-1");

    expect(applyMarkdownEdit(source, edit)).toBe("Intro\n# Old title");
    expect(edit.selection).toEqual({ from: "Intro\n# Old title".length, to: "Intro\n# Old title".length });
  });

  it("creates line prefix edits while stripping existing list markers", () => {
    const source = "- one\n2. two\n> three";
    const edit = formatMarkdownSelection(source, { from: 0, to: source.length }, "format-task-list");

    expect(applyMarkdownEdit(source, edit)).toBe("- [ ] one\n- [ ] two\n- [ ] three");
    expect(edit.selection).toBeUndefined();
  });

  it("creates block wrapper edits across full selected lines", () => {
    const source = "before\nalpha\nbeta\nafter";
    const edit = formatMarkdownSelection(source, { from: 8, to: 15 }, "format-code-fence");

    expect(applyMarkdownEdit(source, edit)).toBe("before\n```\nalpha\nbeta\n```\nafter");
    expect(edit.selection).toEqual({ from: 11, to: 21 });
  });

  it("recognizes markdown format commands in the kernel", () => {
    expect(isMarkdownFormatCommand("format-bold")).toBe(true);
    expect(isMarkdownFormatCommand("unknown")).toBe(false);
  });

  it("creates image paste edits on a blank line", () => {
    const edit = pasteMarkdownImage("", { from: 0, to: 0 }, "![](assets/image.png)");

    expect(applyMarkdownEdit("", edit)).toBe("![](assets/image.png)\n");
    expect(edit.selection).toEqual({ from: "![](assets/image.png)\n".length, to: "![](assets/image.png)\n".length });
  });

  it("creates image paste edits on a non-empty line with a leading break", () => {
    const source = "before";
    const edit = pasteMarkdownImage(source, { from: source.length, to: source.length }, "![](assets/image.png)");

    expect(applyMarkdownEdit(source, edit)).toBe("before\n![](assets/image.png)\n");
  });
});

function applyMarkdownEdit(source: string, edit: { changes: MarkdownTextChange[] }): string {
  return [...edit.changes]
    .sort((a, b) => b.from - a.from)
    .reduce((current, change) => {
      return `${current.slice(0, change.from)}${change.insert}${current.slice(change.to)}`;
    }, source);
}
