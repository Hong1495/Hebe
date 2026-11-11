import { describe, expect, it } from "vitest";
import { EditorState, StateEffect } from "@codemirror/state";
import { history, undoDepth } from "@codemirror/commands";
import { editorSessions } from "../src/components/editor/editor-sessions";
import { useAppStore } from "../src/stores/app-store";
describe("tab editor sessions", () => {
  it("preserves history and selection when restoring with new extensions", () => {
    let state = EditorState.create({ doc: "hello", extensions: [history()] });
    state = state.update({changes:{from:5,insert:" world"},selection:{anchor:11}}).state;
    editorSessions.set("history", {state,scrollTop:240});
    const saved = editorSessions.get("history")!;
    const restored = saved.state.update({effects:StateEffect.reconfigure.of([history()])}).state;
    expect(restored.doc.toString()).toBe("hello world");
    expect(restored.selection.main.head).toBe(11);
    expect(undoDepth(restored)).toBe(1);
    expect(saved.scrollTop).toBe(240);
    editorSessions.prune([]);
    expect(editorSessions.get("history")).toBeUndefined();
  });
  it("keeps stable identities across save and reorder, including new tabs", () => {
    useAppStore.getState().openNewTab();
    const first = useAppStore.getState().tabs.at(-1)!.id;
    useAppStore.getState().openNewTab();
    const second = useAppStore.getState().tabs.at(-1)!.id;
    expect(first).not.toBe(second);
    useAppStore.getState().setActiveTabPath("/tmp/saved.md");
    expect(useAppStore.getState().tabs.at(-1)!.id).toBe(second);
    useAppStore.getState().moveTab(useAppStore.getState().tabs.length-1,0);
    expect(useAppStore.getState().tabs[0].id).toBe(second);
  });
});
