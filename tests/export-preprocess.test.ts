import { describe, expect, it } from "vitest";
import { prepareMarkdownForExport } from "../src/lib/export-preprocess";

describe("export preprocess", () => {
  it("replaces Mermaid fences with PNG images before Pandoc export", async () => {
    const source = [
      "# Export",
      "",
      "```mermaid",
      "flowchart TD",
      "  A-->B",
      "```",
      "",
      "```ts",
      "const value = 1;",
      "```",
    ].join("\n");

    const result = await prepareMarkdownForExport(
      source,
      async (code, index) =>
        `data:image/png;base64,${Buffer.from(`${index}:${code}`).toString("base64")}`,
    );

    expect(result).toContain("![Mermaid diagram 1](data:image/png;base64,");
    expect(result).not.toContain("```mermaid");
    expect(result).not.toContain("flowchart TD");
    expect(result).toContain("```ts\nconst value = 1;\n```");
  });

  it("supports mmd and attribute-style Mermaid fences", async () => {
    const source = "~~~{.mmd}\nsequenceDiagram\n  A->>B: hello\n~~~";

    const result = await prepareMarkdownForExport(
      source,
      async () => "data:image/png;base64,ZmFrZQ==",
    );

    expect(result).toBe("![Mermaid diagram 1](data:image/png;base64,ZmFrZQ==)");
  });

  it("surfaces Mermaid render failures with a diagram number", async () => {
    await expect(
      prepareMarkdownForExport("```mermaid\nbad diagram\n```", async () => {
        throw new Error("parse failed");
      }),
    ).rejects.toThrow("Failed to render Mermaid diagram 1: parse failed");
  });
});
