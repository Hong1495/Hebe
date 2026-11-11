import { describe, expect, it } from "vitest";
import { inspectLongDocument } from "../src/components/editor/long-document";
import { parseMarkdownBlocks, scanMarkdownLineDecorations } from "../src/components/editor/markdown-kernel";
import { prepareMarkdownForExport } from "../src/lib/export-preprocess";
import { parseSession } from "../src/lib/session-recovery";

describe("long documents", () => {
  it("isolates metadata and code from headings, TOC and footnotes", () => {
    const source = "---\ntitle: **draft**\n# metadata\n---\n\n[toc]\n\n# 中文 `code`\n\n```md\n# hidden\n[toc]\n[^no]: hidden\n```\n\nText[^one].\n\n[^one]: A note\n    continued";
    const doc = inspectLongDocument(source);
    expect(doc.headings.map((h) => h.text)).toEqual(["中文 code"]);
    expect(doc.blocks.map((b) => b.kind)).toEqual(["frontMatter", "toc", "footnoteDefinition"]);
    expect(doc.references).toHaveLength(1);
    expect(doc.references[0].definition).toBe(source.indexOf("[^one]:"));
    expect(doc.blocks[2].content).toBe("A note\ncontinued");
    expect(parseMarkdownBlocks(source).filter((b) => b.kind === "frontMatter")).toHaveLength(1);
    expect(scanMarkdownLineDecorations(source)).toBeDefined();
  });
  it("supports setext and repeated headings and preserves line offsets", () => {
    const doc = inspectLongDocument("---\ntitle: hi\n---\nTitle\n=====\n\n## Title\n\n## 中文");
    expect(doc.headings.map((h) => [h.slug, h.line])).toEqual([["title", 3], ["title-1", 6], ["中文", 8]]);
  });
  it("ignores code and escaped footnotes and numbers repeated references consistently", () => {
    const doc = inspectLongDocument("`[^code]` \\[^escaped] [^a] [^b] [^a]\n\n[^a]: first");
    expect(doc.references.map((r) => r.number)).toEqual([1, 2, 1]);
    expect(doc.references[1].definition).toBeUndefined();
  });
  it("exports TOC links while leaving examples in fences untouched", async () => {
    const source = "[toc]\n\n# Hello\n\n## World\n\n```md\n[toc]\n```\n\nText[^n]\n\n[^n]: footnote";
    const output = await prepareMarkdownForExport(source);
    expect(output).toContain("- [Hello](#hello)\n  - [World](#world)");
    expect(output).toContain("```md\n[toc]\n```");
    expect(output).toContain("[^n]: footnote");
  });
});

describe("draft recovery", () => {
  it("restores dirty drafts and clamps the active tab", () => {
    const session = parseSession(JSON.stringify({ version: 1, activeTabIndex: 8, tabs: [{ id: "a", path: null, content: "未保存", savedContent: "", dirty: false }] }));
    expect(session?.tabs[0].dirty).toBe(true);
    expect(session?.activeTabIndex).toBe(0);
  });
  it("rejects malformed data and duplicate tab identities", () => {
    expect(() => parseSession("broken")).toThrow();
    expect(() => parseSession(JSON.stringify({ version: 1, tabs: [{ id: "a" }, { id: "a" }] }))).toThrow();
    expect(parseSession(null)).toBeNull();
  });
});
