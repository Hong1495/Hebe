import { EditorView, ViewPlugin, type ViewUpdate } from "@codemirror/view";

// Center only in response to editing/navigation. Manual scrolling remains free.
export const typewriterExtension = ViewPlugin.fromClass(
  class {
    private frame = 0;
    readonly view: EditorView;
    constructor(view: EditorView) {
      this.view = view;
      this.center();
    }
    update(update: ViewUpdate) {
      if (update.docChanged || update.selectionSet) this.center();
    }
    center() {
      cancelAnimationFrame(this.frame);
      this.frame = requestAnimationFrame(() => {
        if (this.view.composing || !this.view.hasFocus) return;
        this.view.dispatch({
          effects: EditorView.scrollIntoView(this.view.state.selection.main.head, { y: "center" }),
        });
      });
    }
    destroy() {
      cancelAnimationFrame(this.frame);
    }
  },
);
