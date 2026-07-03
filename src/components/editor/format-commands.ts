import { EditorSelection } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import {
  formatMarkdownSelection,
  isMarkdownFormatCommand,
  type MarkdownFormatCommand,
  type MarkdownTextChange,
} from "./markdown-kernel";

export { isMarkdownFormatCommand, type MarkdownFormatCommand };

export function runMarkdownFormatCommand(
  view: EditorView,
  command: MarkdownFormatCommand,
): boolean {
  const selection = view.state.selection.main;
  const edit = formatMarkdownSelection(
    view.state.doc.toString(),
    { from: selection.from, to: selection.to },
    command,
  );

  view.dispatch({
    changes: toCodeMirrorChanges(edit.changes),
    selection: edit.selection
      ? EditorSelection.range(edit.selection.from, edit.selection.to)
      : undefined,
    scrollIntoView: true,
  });
  view.focus();
  return true;
}

function toCodeMirrorChanges(
  changes: MarkdownTextChange[],
): MarkdownTextChange | MarkdownTextChange[] {
  return changes.length === 1 ? changes[0] : changes;
}
