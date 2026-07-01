import { EditorView } from "@codemirror/view";
import { open, save } from "@tauri-apps/plugin-dialog";
import { readTextFile, stat, writeTextFile } from "@tauri-apps/plugin-fs";
import { useCallback, useEffect, useRef, useState } from "react";
import { exportDocument } from "../../lib/ipc";
import { useAppStore } from "../../stores/app-store";
import { HybridEditor } from "../editor/HybridEditor";
import { GlobalSearch } from "./GlobalSearch";
import { QuickOpen } from "./QuickOpen";
import { TabBar } from "./TabBar";

const AUTO_SAVE_DELAY = 3000;

interface Props {
  onEditorViewReady?: (view: EditorView) => void;
}

export function EditorArea({ onEditorViewReady }: Props) {
  const tabs = useAppStore((s) => s.tabs);
  const activeTabIndex = useAppStore((s) => s.activeTabIndex);
  const activeTab = tabs[activeTabIndex];
  const currentFilePath = activeTab?.path ?? null;
  const currentContent = activeTab?.content ?? "";

  const setFolderPath = useAppStore((s) => s.setFolderPath);
  const addRecentFile = useAppStore((s) => s.addRecentFile);
  const recentFiles = useAppStore((s) => s.recentFiles);
  const focusMode = useAppStore((s) => s.focusMode);
  const typewriterMode = useAppStore((s) => s.typewriterMode);
  const toggleFocusMode = useAppStore((s) => s.toggleFocusMode);
  const toggleTypewriterMode = useAppStore((s) => s.toggleTypewriterMode);
  const openNewTab = useAppStore((s) => s.openNewTab);
  const openFile = useAppStore((s) => s.openFile);
  const updateActiveContent = useAppStore((s) => s.updateActiveContent);
  const setTabContent = useAppStore((s) => s.setTabContent);

  const [quickOpenVisible, setQuickOpenVisible] = useState(false);
  const [globalSearchVisible, setGlobalSearchVisible] = useState(false);
  const editorViewRef = useRef<EditorView | null>(null);
  const dirtyRef = useRef(false);
  const autoSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleContentChange = useCallback(
    (content: string) => {
      updateActiveContent(content);
      dirtyRef.current = true;
    },
    [updateActiveContent],
  );

  // Auto-save
  useEffect(() => {
    if (!dirtyRef.current || !currentFilePath) return;
    if (autoSaveTimerRef.current) clearTimeout(autoSaveTimerRef.current);
    autoSaveTimerRef.current = setTimeout(async () => {
      try {
        await writeTextFile(currentFilePath, currentContent);
        dirtyRef.current = false;
      } catch {
        // silently can't save
      }
    }, AUTO_SAVE_DELAY);
    return () => {
      if (autoSaveTimerRef.current) clearTimeout(autoSaveTimerRef.current);
    };
  }, [currentContent, currentFilePath]);

  // File watching
  useEffect(() => {
    if (!currentFilePath) return;
    let lastMtime = 0;
    let cancelled = false;
    async function check() {
      if (cancelled) return;
      try {
        const info = await stat(currentFilePath!);
        const mtime = info.mtime?.getTime() ?? 0;
        if (lastMtime === 0) {
          lastMtime = mtime;
        } else if (mtime > lastMtime + 500 && !dirtyRef.current) {
          lastMtime = mtime;
          const content = await readTextFile(currentFilePath!);
          setTabContent(activeTabIndex, content);
        }
      } catch {
        // file may be deleted
      }
    }
    check();
    const interval = setInterval(check, 2000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [currentFilePath, activeTabIndex, setTabContent]);

  const handleOpenFile = useCallback(async () => {
    try {
      const selected = await open({
        multiple: false,
        filters: [
          { name: "Markdown", extensions: ["md", "markdown", "mdx", "mkd", "mkdn"] },
          { name: "All Files", extensions: ["*"] },
        ],
      });
      if (selected) {
        const content = await readTextFile(selected);
        openFile(selected, content);
        addRecentFile(selected);
        dirtyRef.current = false;
      }
    } catch (err) {
      console.error("Failed to open file:", err);
    }
  }, [openFile, addRecentFile]);

  const handleOpenFolder = useCallback(async () => {
    try {
      const selected = await open({ directory: true, multiple: false });
      if (selected) setFolderPath(selected);
    } catch (err) {
      console.error("Failed to open folder:", err);
    }
  }, [setFolderPath]);

  const handleSaveFile = useCallback(async () => {
    try {
      if (currentFilePath) {
        await writeTextFile(currentFilePath, currentContent);
        dirtyRef.current = false;
        return;
      }
      const savePath = await save({
        filters: [{ name: "Markdown", extensions: ["md", "markdown", "mdx"] }],
        defaultPath: "untitled.md",
      });
      if (savePath) {
        await writeTextFile(savePath, currentContent);
        openFile(savePath, currentContent);
        addRecentFile(savePath);
        dirtyRef.current = false;
      }
    } catch (err) {
      console.error("Failed to save file:", err);
    }
  }, [currentFilePath, currentContent, openFile, addRecentFile]);

  const handleExport = useCallback(
    async (format: "pdf" | "docx" | "html" | "epub") => {
      if (!currentFilePath) {
        await handleSaveFile();
        // Re-read path: handleSaveFile may have assigned a path via save-as
        const savedPath = useAppStore.getState().currentFilePath();
        if (!savedPath) return;
        try {
          const result = await exportDocument(currentContent, savedPath, format);
          console.log(`Exported to ${result}`);
        } catch (err) {
          console.error("Export failed:", err);
        }
        return;
      }
      try {
        const result = await exportDocument(currentContent, currentFilePath, format);
        console.log(`Exported to ${result}`);
      } catch (err) {
        console.error("Export failed:", err);
      }
    },
    [currentFilePath, currentContent, handleSaveFile],
  );

  return (
    <div className="h-full flex flex-col overflow-hidden">
      {/* Toolbar */}
      <div
        className="flex items-center gap-2 px-3 py-1.5 border-b shrink-0"
        style={{ borderColor: "var(--border)", background: "var(--surface)" }}
      >
        <button
          type="button"
          onClick={handleOpenFile}
          className="text-xs px-2 py-1 rounded hover:opacity-80 transition-opacity"
          style={{ color: "var(--text-secondary)" }}
        >
          Open
        </button>
        <button
          type="button"
          onClick={handleOpenFolder}
          className="text-xs px-2 py-1 rounded hover:opacity-80 transition-opacity"
          style={{ color: "var(--text-secondary)" }}
        >
          Folder
        </button>
        <button
          type="button"
          onClick={handleSaveFile}
          className="text-xs px-2 py-1 rounded hover:opacity-80 transition-opacity"
          style={{ color: "var(--text-secondary)" }}
        >
          Save
        </button>
        <div className="w-px h-4 mx-1" style={{ background: "var(--border)" }} />
        <span className="text-xs" style={{ color: "var(--text-secondary)" }}>
          Export:
        </span>
        {(["pdf", "docx", "html", "epub"] as const).map((fmt) => (
          <button
            key={fmt}
            type="button"
            onClick={() => handleExport(fmt)}
            className="text-xs px-1.5 py-0.5 rounded hover:opacity-80 transition-opacity"
            style={{ color: "var(--text-secondary)" }}
          >
            {fmt.toUpperCase()}
          </button>
        ))}
        <div className="w-px h-4 mx-1" style={{ background: "var(--border)" }} />
        <button
          type="button"
          onClick={toggleFocusMode}
          className="text-xs px-2 py-1 rounded hover:opacity-80 transition-opacity"
          style={{
            background: focusMode ? "var(--accent-bg)" : "transparent",
            color: focusMode ? "var(--accent)" : "var(--text-secondary)",
          }}
        >
          Focus
        </button>
        <button
          type="button"
          onClick={toggleTypewriterMode}
          className="text-xs px-2 py-1 rounded hover:opacity-80 transition-opacity"
          style={{
            background: typewriterMode ? "var(--accent-bg)" : "transparent",
            color: typewriterMode ? "var(--accent)" : "var(--text-secondary)",
          }}
        >
          Typewriter
        </button>
        <div className="flex-1" />
        <span className="text-xs" style={{ color: "var(--text-secondary)" }}>
          Cmd+Shift+F Search
        </span>
        <span className="text-xs ml-2" style={{ color: "var(--text-secondary)" }}>
          Cmd+P
        </span>
        {currentFilePath && (
          <span
            className="text-xs truncate max-w-[300px]"
            style={{ color: "var(--text-secondary)" }}
          >
            {currentFilePath.split("/").pop()}
          </span>
        )}
      </div>

      {/* Tab bar */}
      <TabBar />

      {/* Editor */}
      <div className="flex-1 overflow-hidden">
        {currentFilePath || currentContent ? (
          <HybridEditor
            mdPath={currentFilePath}
            key={`${activeTabIndex}-${activeTab?.path ?? "new"}`}
            initialContent={currentContent}
            onContentChange={handleContentChange}
            onOpenFile={handleOpenFile}
            onSaveFile={handleSaveFile}
            onQuickOpen={() => setQuickOpenVisible(true)}
            onGlobalSearch={() => setGlobalSearchVisible(true)}
            onEditorView={(v) => {
              editorViewRef.current = v;
              onEditorViewReady?.(v);
            }}
            focusMode={focusMode}
            typewriterMode={typewriterMode}
          />
        ) : (
          <div className="flex items-center justify-center h-full overflow-y-auto">
            <div className="text-center space-y-4 py-12">
              <h1 className="text-3xl font-bold" style={{ color: "var(--text-heading)" }}>
                Hebe
              </h1>
              <p style={{ color: "var(--text-secondary)" }}>
                A next-generation WYSIWYG Markdown editor
              </p>
              <div className="flex gap-3 justify-center">
                <button
                  type="button"
                  onClick={handleOpenFile}
                  className="px-4 py-2 rounded-lg text-sm font-medium text-white"
                  style={{ background: "var(--accent)" }}
                >
                  Open File
                </button>
                <button
                  type="button"
                  onClick={handleOpenFolder}
                  className="px-4 py-2 rounded-lg text-sm font-medium"
                  style={{ background: "var(--accent-bg)", color: "var(--accent)" }}
                >
                  Open Folder
                </button>
                <button
                  type="button"
                  onClick={() => openNewTab("# Untitled\n\n")}
                  className="px-4 py-2 rounded-lg text-sm font-medium"
                  style={{ background: "var(--accent-bg)", color: "var(--accent)" }}
                >
                  New Document
                </button>
              </div>

              {recentFiles.length > 0 && (
                <div className="pt-6">
                  <p className="text-xs mb-3" style={{ color: "var(--text-secondary)" }}>
                    Recent Files
                  </p>
                  <div className="flex flex-col gap-1 items-center">
                    {recentFiles.map((path) => (
                      <button
                        key={path}
                        type="button"
                        onClick={async () => {
                          try {
                            const content = await readTextFile(path);
                            openFile(path, content);
                            addRecentFile(path);
                          } catch {
                            // gone
                          }
                        }}
                        className="text-sm px-3 py-1 rounded hover:opacity-80 transition-opacity truncate max-w-[400px]"
                        style={{ color: "var(--text-secondary)" }}
                        title={path}
                      >
                        {path.split("/").pop()}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      <QuickOpen open={quickOpenVisible} onClose={() => setQuickOpenVisible(false)} />
      <GlobalSearch open={globalSearchVisible} onClose={() => setGlobalSearchVisible(false)} />
    </div>
  );
}
