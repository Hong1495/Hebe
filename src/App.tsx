import { EditorView } from "@codemirror/view";
import { useEffect, useMemo, useRef } from "react";
import { EditorArea } from "./components/layout/EditorArea";
import { OutlinePanel } from "./components/layout/OutlinePanel";
import { SettingsPanel } from "./components/layout/SettingsPanel";
import { Sidebar } from "./components/layout/Sidebar";
import { StatusBar } from "./components/layout/StatusBar";
import { useAppStore } from "./stores/app-store";

function App() {
  const sidebarVisible = useAppStore((s) => s.sidebarVisible);
  const outlineVisible = useAppStore((s) => s.outlineVisible);
  const settingsVisible = useAppStore((s) => s.settingsVisible);
  const theme = useAppStore((s) => s.theme);
  const editorViewRef = useRef<EditorView | null>(null);

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
  }, [theme]);

  const gridCols = useMemo(() => {
    const cols = [];
    if (settingsVisible) cols.push("var(--sidebar-width)");
    else if (sidebarVisible) cols.push("var(--sidebar-width)");
    cols.push("1fr");
    if (outlineVisible) cols.push("var(--outline-width)");
    return cols.join(" ");
  }, [sidebarVisible, outlineVisible, settingsVisible]);

  const handleOutlineJump = (line: number) => {
    const view = editorViewRef.current;
    if (!view) return;
    const doc = view.state.doc;
    const pos = doc.line(line + 1).from;
    view.dispatch({
      selection: { anchor: pos, head: pos },
      scrollIntoView: true,
    });
    view.focus();
  };

  return (
    <div className="h-full flex flex-col" style={{ background: "var(--bg)", color: "var(--text)" }}>
      <div className="flex-1 grid overflow-hidden" style={{ gridTemplateColumns: gridCols }}>
        {settingsVisible ? <SettingsPanel /> : sidebarVisible ? <Sidebar /> : null}
        <EditorArea
          onEditorViewReady={(v) => {
            editorViewRef.current = v;
          }}
        />
        {outlineVisible && <OutlinePanel onJump={handleOutlineJump} />}
      </div>
      <StatusBar />
    </div>
  );
}

export default App;
