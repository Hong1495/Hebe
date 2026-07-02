import { EditorView } from "@codemirror/view";
import { listen } from "@tauri-apps/api/event";
import { open, save } from "@tauri-apps/plugin-dialog";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  exportDocument,
  getFileMtime,
  isTauriRuntime,
  readMarkdownFile,
  writeMarkdownFile,
} from "../../lib/ipc";
import { useAppStore } from "../../stores/app-store";
import { HybridEditor } from "../editor/HybridEditor";
import { GlobalSearch } from "./GlobalSearch";
import { QuickOpen } from "./QuickOpen";

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

  const setFolderPath = useAppStore((s) => s.setFolderPath);
  const addRecentFile = useAppStore((s) => s.addRecentFile);
  const toggleSidebar = useAppStore((s) => s.toggleSidebar);
  const toggleOutline = useAppStore((s) => s.toggleOutline);
  const toggleSettings = useAppStore((s) => s.toggleSettings);
  const toggleFocusMode = useAppStore((s) => s.toggleFocusMode);
  const toggleTypewriterMode = useAppStore((s) => s.toggleTypewriterMode);
  const zoomIn = useAppStore((s) => s.zoomIn);
  const zoomOut = useAppStore((s) => s.zoomOut);
  const resetZoom = useAppStore((s) => s.resetZoom);
  const openNewTab = useAppStore((s) => s.openNewTab);
  const openFile = useAppStore((s) => s.openFile);
  const updateActiveContent = useAppStore((s) => s.updateActiveContent);
  const setTabContent = useAppStore((s) => s.setTabContent);
  const setTabDirty = useAppStore((s) => s.setTabDirty);
  const setActiveTabPath = useAppStore((s) => s.setActiveTabPath);
  const focusMode = useAppStore((s) => s.focusMode);
  const typewriterMode = useAppStore((s) => s.typewriterMode);

  const [quickOpenVisible, setQuickOpenVisible] = useState(false);
  const [globalSearchVisible, setGlobalSearchVisible] = useState(false);
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

  const handleOpenFolder = useCallback(async () => {
    if (!isTauriRuntime()) return;
    try {
      const selected = await open({ directory: true, multiple: false });
      if (selected) setFolderPath(selected);
    } catch (err) {
      console.error("Failed to open folder:", err);
    }
  }, [setFolderPath]);

  const handleSaveFile = useCallback(async () => {
    if (!isTauriRuntime()) return;
    try {
      if (currentFilePath) {
        const saveIndex = activeTabIndex;
        const savePath = currentFilePath;
        const saveContent = currentContent;
        await writeMarkdownFile(savePath, saveContent);
        const latestTab = useAppStore.getState().tabs[saveIndex];
        if (latestTab?.path === savePath && latestTab.content === saveContent) {
          setTabDirty(saveIndex, false);
        }
        return;
      }
      const savePath = await save({
        filters: [{ name: "Markdown", extensions: ["md", "markdown", "mdx"] }],
        defaultPath: "untitled.md",
      });
      if (savePath) {
        await writeMarkdownFile(savePath, currentContent);
        setActiveTabPath(savePath);
        addRecentFile(savePath);
      }
    } catch (err) {
      console.error("Failed to save file:", err);
    }
  }, [
    activeTabIndex,
    currentFilePath,
    currentContent,
    setTabDirty,
    setActiveTabPath,
    addRecentFile,
  ]);

  const handleExport = useCallback(
    async (format: "pdf" | "docx" | "html" | "epub") => {
      if (!isTauriRuntime()) return;
      if (!currentFilePath) {
        await handleSaveFile();
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
          setTabDirty(saveIndex, false);
        }
      } catch {
        // silently can't save
      }
    }, AUTO_SAVE_DELAY);
    return () => {
      if (autoSaveTimerRef.current) clearTimeout(autoSaveTimerRef.current);
    };
  }, [activeTabDirty, activeTabIndex, currentContent, currentFilePath, setTabDirty]);

  // File watching
  useEffect(() => {
    if (!currentFilePath) return;
    let lastMtime = 0;
    let cancelled = false;
    async function check() {
      if (cancelled) return;
      try {
        const mtime = await getFileMtime(currentFilePath!);
        if (lastMtime === 0) {
          lastMtime = mtime;
        } else if (mtime > lastMtime + 500 && !useAppStore.getState().tabs[activeTabIndex]?.dirty) {
          lastMtime = mtime;
          const content = await readMarkdownFile(currentFilePath!);
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

  useEffect(() => {
    if (!isTauriRuntime()) return;

    let unlisten: (() => void) | undefined;
    let cancelled = false;

    const setupListener = async () => {
      try {
        unlisten = await listen<string>("menu-action", async (event) => {
          if (cancelled) return;

          switch (event.payload) {
            case "open-file":
              await handleOpenFile();
              break;
            case "open-folder":
              await handleOpenFolder();
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
            case "quick-open":
              setQuickOpenVisible(true);
              break;
            case "global-search":
              setGlobalSearchVisible(true);
              break;
            case "toggle-sidebar":
              toggleSidebar();
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
    handleOpenFolder,
    handleSaveFile,
    handleExport,
    openNewTab,
    focusEditorSoon,
    toggleSidebar,
    toggleOutline,
    toggleSettings,
    toggleFocusMode,
    toggleTypewriterMode,
    zoomIn,
    zoomOut,
    resetZoom,
  ]);

  return (
    <div className="h-full flex flex-col overflow-hidden">
      <div className="flex-1 overflow-hidden">
        <HybridEditor
          mdPath={currentFilePath}
          key={`${activeTabIndex}-${activeTab?.path ?? "new"}`}
          initialContent={currentContent}
          onContentChange={handleContentChange}
          onNewDocument={() => openNewTab("")}
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
      </div>

      <QuickOpen open={quickOpenVisible} onClose={() => setQuickOpenVisible(false)} />
      <GlobalSearch open={globalSearchVisible} onClose={() => setGlobalSearchVisible(false)} />
    </div>
  );
}
