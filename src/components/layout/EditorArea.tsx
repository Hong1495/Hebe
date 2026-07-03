import { EditorView } from "@codemirror/view";
import { listen } from "@tauri-apps/api/event";
import { message, open } from "@tauri-apps/plugin-dialog";
import { useCallback, useEffect, useRef } from "react";
import { saveActiveTab } from "../../lib/document-lifecycle";
import {
  exportDocument,
  getFileMtime,
  isTauriRuntime,
  readMarkdownFile,
  writeMarkdownFile,
} from "../../lib/ipc";
import { useAppStore } from "../../stores/app-store";
import { isMarkdownFormatCommand, runMarkdownFormatCommand } from "../editor/format-commands";
import { HybridEditor } from "../editor/HybridEditor";

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
  const activeTabDirty = activeTab?.dirty ?? false;

  const addRecentFile = useAppStore((s) => s.addRecentFile);
  const toggleOutline = useAppStore((s) => s.toggleOutline);
  const toggleSettings = useAppStore((s) => s.toggleSettings);
  const toggleFocusMode = useAppStore((s) => s.toggleFocusMode);
  const toggleTypewriterMode = useAppStore((s) => s.toggleTypewriterMode);
  const toggleSourceMode = useAppStore((s) => s.toggleSourceMode);
  const zoomIn = useAppStore((s) => s.zoomIn);
  const zoomOut = useAppStore((s) => s.zoomOut);
  const resetZoom = useAppStore((s) => s.resetZoom);
  const openNewTab = useAppStore((s) => s.openNewTab);
  const openFile = useAppStore((s) => s.openFile);
  const updateActiveContent = useAppStore((s) => s.updateActiveContent);
  const setTabContent = useAppStore((s) => s.setTabContent);
  const markTabSaved = useAppStore((s) => s.markTabSaved);
  const focusMode = useAppStore((s) => s.focusMode);
  const typewriterMode = useAppStore((s) => s.typewriterMode);
  const sourceMode = useAppStore((s) => s.sourceMode);

  const editorViewRef = useRef<EditorView | null>(null);
  const autoSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const focusEditorSoon = useCallback(() => {
    window.setTimeout(() => editorViewRef.current?.focus(), 150);
  }, []);
  const handleContentChange = useCallback(
    (content: string) => {
      updateActiveContent(content);
    },
    [updateActiveContent],
  );

  const handleOpenFile = useCallback(async () => {
    if (!isTauriRuntime()) return;
    try {
      const selected = await open({
        multiple: false,
        filters: [
          { name: "Markdown", extensions: ["md", "markdown", "mdx", "mkd", "mkdn"] },
          { name: "All Files", extensions: ["*"] },
        ],
      });
      if (selected) {
        const filePath = Array.isArray(selected) ? selected[0] : selected;
        if (!filePath) return;
        const content = await readMarkdownFile(filePath);
        openFile(filePath, content);
        addRecentFile(filePath);
        focusEditorSoon();
      }
    } catch (err) {
      console.error("Failed to open file:", err);
    }
  }, [openFile, addRecentFile, focusEditorSoon]);

  const handleSaveFile = useCallback(async () => {
    if (!isTauriRuntime()) return;
    return saveActiveTab();
  }, []);

  const handleExport = useCallback(
    async (format: "pdf" | "docx" | "html" | "epub") => {
      if (!isTauriRuntime()) return;
      let exportPath = currentFilePath;
      if (!exportPath) {
        const saved = await handleSaveFile();
        if (!saved) return;
        exportPath = useAppStore.getState().currentFilePath();
      }
      if (!exportPath) return;

      try {
        const result = await exportDocument(
          useAppStore.getState().currentContent(),
          exportPath,
          format,
        );
        await message(`Exported to:\n${result}`, { title: "Export Complete" });
      } catch (err) {
        console.error("Export failed:", err);
        const detail = err instanceof Error ? err.message : String(err);
        await message(detail, { title: "Export Failed", kind: "error" });
      }
    },
    [currentFilePath, handleSaveFile],
  );

  // Auto-save
  useEffect(() => {
    if (!activeTabDirty || !currentFilePath) return;
    if (autoSaveTimerRef.current) clearTimeout(autoSaveTimerRef.current);
    const saveIndex = activeTabIndex;
    const savePath = currentFilePath;
    const saveContent = currentContent;
    autoSaveTimerRef.current = setTimeout(async () => {
      try {
        await writeMarkdownFile(savePath, saveContent);
        const latestTab = useAppStore.getState().tabs[saveIndex];
        if (latestTab?.path === savePath && latestTab.content === saveContent) {
          markTabSaved(saveIndex);
        }
      } catch {
        // silently can't save
      }
    }, AUTO_SAVE_DELAY);
    return () => {
      if (autoSaveTimerRef.current) clearTimeout(autoSaveTimerRef.current);
    };
  }, [activeTabDirty, activeTabIndex, currentContent, currentFilePath, markTabSaved]);

  // File watching
  useEffect(() => {
    if (!currentFilePath) return;
    let lastMtime = 0;
    let cancelled = false;
    const watchedPath = currentFilePath;
    const watchedIndex = activeTabIndex;
    async function check() {
      if (cancelled) return;
      try {
        const mtime = await getFileMtime(watchedPath);
        if (lastMtime === 0) {
          lastMtime = mtime;
        } else if (
          mtime > lastMtime + 500 &&
          useAppStore.getState().tabs[watchedIndex]?.path === watchedPath &&
          !useAppStore.getState().tabs[watchedIndex]?.dirty
        ) {
          lastMtime = mtime;
          const content = await readMarkdownFile(watchedPath);
          const latestTab = useAppStore.getState().tabs[watchedIndex];
          if (latestTab?.path === watchedPath && !latestTab.dirty) {
            setTabContent(watchedIndex, content);
          }
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

  useEffect(() => {
    if (!isTauriRuntime()) return;

    let unlisten: (() => void) | undefined;
    let cancelled = false;

    const setupListener = async () => {
      try {
        unlisten = await listen<string>("menu-action", async (event) => {
          if (cancelled) return;

          if (isMarkdownFormatCommand(event.payload)) {
            const view = editorViewRef.current;
            if (view) runMarkdownFormatCommand(view, event.payload);
            return;
          }

          switch (event.payload) {
            case "open-file":
              await handleOpenFile();
              break;
            case "new-document":
              openNewTab("");
              focusEditorSoon();
              break;
            case "save-file":
              await handleSaveFile();
              break;
            case "export-pdf":
              await handleExport("pdf");
              break;
            case "export-docx":
              await handleExport("docx");
              break;
            case "export-html":
              await handleExport("html");
              break;
            case "export-epub":
              await handleExport("epub");
              break;
            case "toggle-outline":
              toggleOutline();
              break;
            case "toggle-settings":
              toggleSettings();
              break;
            case "toggle-focus":
              toggleFocusMode();
              break;
            case "toggle-typewriter":
              toggleTypewriterMode();
              break;
            case "toggle-source":
              toggleSourceMode();
              break;
            case "zoom-in":
              zoomIn();
              break;
            case "zoom-out":
              zoomOut();
              break;
            case "zoom-reset":
              resetZoom();
              break;
          }
        });
        if (cancelled) {
          unlisten();
        }
      } catch {
        // ignore listener setup failure in non-runtime contexts
      }
    };

    void setupListener();

    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, [
    handleOpenFile,
    handleSaveFile,
    handleExport,
    openNewTab,
    focusEditorSoon,
    toggleOutline,
    toggleSettings,
    toggleFocusMode,
    toggleTypewriterMode,
    toggleSourceMode,
    zoomIn,
    zoomOut,
    resetZoom,
  ]);

  return (
    <div className="h-full flex flex-col overflow-hidden">
      <div className="flex-1 overflow-hidden">
        <HybridEditor
          mdPath={currentFilePath}
          key={`${activeTabIndex}-${activeTab?.path ?? "new"}-${sourceMode ? "source" : "hybrid"}`}
          initialContent={currentContent}
          onContentChange={handleContentChange}
          onNewDocument={() => openNewTab("")}
          onOpenFile={handleOpenFile}
          onSaveFile={handleSaveFile}
          onEditorView={(v) => {
            editorViewRef.current = v;
            onEditorViewReady?.(v);
          }}
          focusMode={focusMode}
          typewriterMode={typewriterMode}
          sourceMode={sourceMode}
        />
      </div>
    </div>
  );
}
