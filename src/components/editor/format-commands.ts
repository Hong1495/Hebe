import { type ChangeSpec, EditorSelection } from "@codemirror/state";
import { EditorView } from "@codemirror/view";

export type MarkdownFormatCommand =
  | "format-bold"
  | "format-italic"
  | "format-strike"
  | "format-inline-code"
  | "format-link"
  | "format-heading-1"
  | "format-heading-2"
  | "format-heading-3"
  | "format-bullet-list"
  | "format-ordered-list"
  | "format-task-list"
  | "format-quote"
  | "format-code-fence";

const MARKDOWN_FORMAT_COMMANDS = new Set<string>([
  "format-bold",
  "format-italic",
  "format-strike",
  "format-inline-code",
  "format-link",
  "format-heading-1",
  "format-heading-2",
  "format-heading-3",
  "format-bullet-list",
  "format-ordered-list",
  "format-task-list",
  "format-quote",
  "format-code-fence",
]);

export function isMarkdownFormatCommand(action: string): action is MarkdownFormatCommand {
  return MARKDOWN_FORMAT_COMMANDS.has(action);
}

export function runMarkdownFormatCommand(
  view: EditorView,
  command: MarkdownFormatCommand,
): boolean {
  switch (command) {
    case "format-bold":
      return wrapSelection(view, "**", "**", "bold");
    case "format-italic":
      return wrapSelection(view, "*", "*", "italic");
    case "format-strike":
      return wrapSelection(view, "~~", "~~", "strikethrough");
    case "format-inline-code":
      return wrapSelection(view, "`", "`", "code");
    case "format-link":
      return insertLink(view);
    case "format-heading-1":
      return setHeading(view, 1);
    case "format-heading-2":
      return setHeading(view, 2);
    case "format-heading-3":
      return setHeading(view, 3);
    case "format-bullet-list":
      return prefixSelectedLines(view, (_line, _index) => "- ");
    case "format-ordered-list":
      return prefixSelectedLines(view, (_line, index) => `${index + 1}. `);
    case "format-task-list":
      return prefixSelectedLines(view, (_line, _index) => "- [ ] ");
    case "format-quote":
      return prefixSelectedLines(view, (_line, _index) => "> ");
    case "format-code-fence":
      return wrapBlock(view, "```\n", "\n```", "");
  }
}

function wrapSelection(
  view: EditorView,
  before: string,
  after: string,
  placeholder: string,
): boolean {
  const selection = view.state.selection.main;
  const selected = view.state.sliceDoc(selection.from, selection.to);
  const inner = selected || placeholder;
  const insert = `${before}${inner}${after}`;
  const anchor = selection.from + before.length;
  const head = anchor + inner.length;

  view.dispatch({
    changes: { from: selection.from, to: selection.to, insert },
    selection: EditorSelection.range(anchor, head),
    scrollIntoView: true,
  });
  view.focus();
  return true;
}

function insertLink(view: EditorView): boolean {
  const selection = view.state.selection.main;
  const selected = view.state.sliceDoc(selection.from, selection.to) || "link";
  const insert = `[${selected}](url)`;
  const urlFrom = selection.from + selected.length + 3;
  const urlTo = urlFrom + 3;

  view.dispatch({
    changes: { from: selection.from, to: selection.to, insert },
    selection: EditorSelection.range(urlFrom, urlTo),
    scrollIntoView: true,
  });
  view.focus();
  return true;
}

function setHeading(view: EditorView, level: 1 | 2 | 3): boolean {
  const selection = view.state.selection.main;
  const line = view.state.doc.lineAt(selection.from);
  const lineText = line.text;
  const stripped = lineText.replace(/^\s{0,3}#{1,6}[ \t]+/, "").trimStart();
  const prefix = `${"#".repeat(level)} `;

  view.dispatch({
    changes: { from: line.from, to: line.to, insert: `${prefix}${stripped}` },
    selection: EditorSelection.cursor(line.from + prefix.length + stripped.length),
    scrollIntoView: true,
  });
  view.focus();
  return true;
}

function prefixSelectedLines(
  view: EditorView,
  prefixForLine: (lineText: string, index: number) => string,
): boolean {
  const selection = view.state.selection.main;
  const startLine = view.state.doc.lineAt(selection.from);
  const endLine = view.state.doc.lineAt(selection.to);
  const changes: ChangeSpec[] = [];

  for (let lineNo = startLine.number; lineNo <= endLine.number; lineNo++) {
    const line = view.state.doc.line(lineNo);
    const stripped = stripCommonLinePrefix(line.text);
    changes.push({
      from: line.from,
      to: line.to,
      insert: `${prefixForLine(stripped, lineNo - startLine.number)}${stripped}`,
    });
  }

  view.dispatch({ changes, scrollIntoView: true });
  view.focus();
  return true;
}

function wrapBlock(view: EditorView, before: string, after: string, placeholder: string): boolean {
  const selection = view.state.selection.main;
  const startLine = view.state.doc.lineAt(selection.from);
  const endLine = view.state.doc.lineAt(selection.to);
  const selected = view.state.sliceDoc(startLine.from, endLine.to) || placeholder;
  const insert = `${before}${selected}${after}`;
  const anchor = startLine.from + before.length;
  const head = anchor + selected.length;

  view.dispatch({
    changes: { from: startLine.from, to: endLine.to, insert },
    selection: EditorSelection.range(anchor, head),
    scrollIntoView: true,
  });
  view.focus();
  return true;
}

function stripCommonLinePrefix(line: string): string {
  return line
    .replace(/^(\s{0,3})[-+*]\s+\[[ xX]\]\s+/, "$1")
    .replace(/^(\s{0,3})(?:[-+*]|\d+[.)])\s+/, "$1")
    .replace(/^(\s{0,3})>\s?/, "$1");
}
