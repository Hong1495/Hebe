import { StateEffect, StateField } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";
import { invoke } from "@tauri-apps/api/core";
import { message, open } from "@tauri-apps/plugin-dialog";
import { pasteImage } from "../../lib/ipc";
import { pasteMarkdownImage } from "./markdown-kernel";

interface PendingImage {
  id: string;
  from: number;
  to: number;
}
const addImage = StateEffect.define<PendingImage>();
const removeImage = StateEffect.define<string>();
export const pendingImages = StateField.define<PendingImage[]>({
  create: () => [],
  update(value, transaction) {
    let next = value
      .filter((item) => !transaction.changes.touchesRange(item.from, item.to))
      .map((item) => ({
        ...item,
        from: transaction.changes.mapPos(item.from, 1),
        to: transaction.changes.mapPos(item.to, 1),
      }));
    for (const effect of transaction.effects) {
      if (effect.is(addImage)) next = [...next, effect.value];
      if (effect.is(removeImage)) next = next.filter((item) => item.id !== effect.value);
    }
    return next;
  },
});

export async function insertImage(
  view: EditorView,
  mdPath: string | null,
  blob?: Blob,
  range?: { from: number; to: number },
) {
  if (!mdPath) {
    await message("Save this document first so images can be stored in its assets folder.", {
      title: "Insert Image",
    });
    return;
  }
  const selection = range ?? view.state.selection.main;
  const pending = { id: crypto.randomUUID(), from: selection.from, to: selection.to };
  view.dispatch({ effects: addImage.of(pending) });
  try {
    let path: string;
    if (blob) path = await pasteImage(Array.from(new Uint8Array(await blob.arrayBuffer())), mdPath);
    else {
      const selected = await open({
        multiple: false,
        filters: [{ name: "Image", extensions: ["png", "jpg", "jpeg", "gif", "webp", "svg"] }],
      });
      if (!selected || Array.isArray(selected)) return;
      path = await invoke<string>("import_image", { source: selected, mdPath });
    }
    if (!view.dom.isConnected) return;
    const target = view.state.field(pendingImages).find((item) => item.id === pending.id);
    if (!target) {
      await message(
        "The insertion location changed while the image was loading. Insert the image again at the desired location.",
        { title: "Image Not Inserted" },
      );
      return;
    }
    const edit = pasteMarkdownImage(view.state.doc.toString(), target, `![](${path})`);
    view.dispatch({
      changes: edit.changes,
      selection: { anchor: edit.selection.from },
      effects: removeImage.of(pending.id),
      scrollIntoView: true,
    });
    view.focus();
  } catch (error) {
    await message(String(error), { title: "Image Insertion Failed", kind: "error" });
  } finally {
    if (view.dom.isConnected) view.dispatch({ effects: removeImage.of(pending.id) });
  }
}
