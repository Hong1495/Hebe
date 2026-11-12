import { EditorView } from "@codemirror/view";
import { listen } from "@tauri-apps/api/event";
import { message, open, save } from "@tauri-apps/plugin-dialog";
import { useCallback, useEffect, useRef, useState } from "react";
import { saveActiveTab, saveTabAt } from "../../lib/document-lifecycle";
import { startDocumentSync } from "../../lib/document-sync";
import { prepareMarkdownForExport } from "../../lib/export-preprocess";
import {
  type ExportOptions,
  exportDocument,
  isTauriRuntime,
  readMarkdownFile,
} from "../../lib/ipc";
import { useAppStore } from "../../stores/app-store";
import { isMarkdownFormatCommand, runMarkdownFormatCommand } from "../editor/format-commands";
import { HybridEditor } from "../editor/HybridEditor";
import { insertImage } from "../editor/image-actions";
import { ExportDialog } from "./ExportDialog";

interface Props {
  onEditorViewReady?: (view: EditorView) => void;
}

export function EditorArea({ onEditorViewReady }: Props) {
  const [pdfExport, setPdfExport] = useState<{ content: string; path: string } | null>(null);
  const exporting = useRef(false);
  const tabs = useAppStore((s) => s.tabs);
  const activeTabIndex = useAppStore((s) => s.activeTabIndex);
  const activeTab = tabs[activeTabIndex];
  const currentFilePath = activeTab?.path ?? null;
  const currentContent = activeTab?.content ?? "";
  const recoveryError = useAppStore((s) => s.recoveryError);

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
  const focusMode = useAppStore((s) => s.focusMode);
  const typewriterMode = useAppStore((s) => s.typewriterMode);
  const codeWrap = useAppStore((s) => s.codeWrap);
  const sourceMode = useAppStore((s) => s.sourceMode);

  const editorViewRef = useRef<EditorView | null>(null);
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

  const exportSnapshot = async (
    snapshot: { content: string; path: string },
    format: "pdf" | "docx" | "html" | "epub",
    options?: ExportOptions,
  ) => {
    if (exporting.current) return;
    exporting.current = true;
    try {
      const outputPath = await save({
        defaultPath: snapshot.path.replace(/\.[^/.]+$/, "") + `.${format}`,
        filters: [{ name: format.toUpperCase(), extensions: [format] }],
      });
      if (!outputPath) return;
      const content = await prepareMarkdownForExport(snapshot.content);
      const result = await exportDocument(content, snapshot.path, format, outputPath, options);
      await message(`Exported to:\n${result}`, { title: "Export Complete" });
    } catch (error) {
      await message(String(error), { title: "Export Failed", kind: "error" });
    } finally {
      exporting.current = false;
    }
  };

  const handleExport = useCallback(
    async (format: "pdf" | "docx" | "html" | "epub") => {
      if (!isTauriRuntime()) return;
      const id = useAppStore.getState().tabs[useAppStore.getState().activeTabIndex]?.id;
      let tab = useAppStore.getState().tabs.find((item) => item.id === id);
      if (!tab) return;
      if (!tab.path) {
        if (!(await handleSaveFile())) return;
        tab = useAppStore.getState().tabs.find((item) => item.id === id);
      }
      if (!tab?.path) return;
      const snapshot = { content: tab.content, path: tab.path };
      if (format === "pdf") setPdfExport(snapshot);
      else await exportSnapshot(snapshot, format);
    },
    [handleSaveFile],
  );

  useEffect(() => startDocumentSync(), []);

  const reviewDiskVersion = async () => {
    if (!activeTab.path) return;
    try {
      const disk = await readMarkdownFile(activeTab.path);
      useAppStore.getState().openNewTab(disk);
    } catch (error) {
      await message(String(error), { title: "Cannot Read Disk Version", kind: "error" });
    }
  };
  const overwriteDisk = async () => {
    const choice = await message(
      "Replace the disk file with this tab's content? Consider saving a copy or reviewing the disk version first.",
      {
        title: "Replace Disk Version",
        kind: "warning",
        buttons: { yes: "Replace", no: "Cancel", cancel: "Cancel" },
      },
    );
    if (choice === "Replace" || choice === "Yes") {
      const index = useAppStore.getState().tabs.findIndex((tab) => tab.id === activeTab.id);
      if (index >= 0) await saveTabAt(index, { overwrite: true });
    }
  };

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
            case "insert-image":
              if (editorViewRef.current)
                await insertImage(editorViewRef.current, useAppStore.getState().currentFilePath());
              break;
            case "insert-toc":
              editorViewRef.current?.dispatch(
                editorViewRef.current.state.replaceSelection("\n[toc]\n"),
              );
              break;
            case "insert-footnote": {
              const view = editorViewRef.current;
              if (!view) break;
              let number = 1;
              while (view.state.doc.toString().includes(`[^${number}]`)) number++;
              const range = view.state.selection.main;
              view.dispatch({
                changes: [
                  { from: range.from, insert: `[^${number}]` },
                  { from: view.state.doc.length, insert: `\n\n[^${number}]: ` },
                ],
                scrollIntoView: true,
              });
              view.dispatch({ selection: { anchor: view.state.doc.length }, scrollIntoView: true });
              view.focus();
              break;
            }
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
      {pdfExport && (
        <ExportDialog
          onCancel={() => setPdfExport(null)}
          onExport={(options) => {
            const snapshot = pdfExport;
            setPdfExport(null);
            void exportSnapshot(snapshot, "pdf", options);
          }}
        />
      )}
      {recoveryError && (
        <div className="document-notice" role="alert">
          {recoveryError}
        </div>
      )}
      {activeTab.saveError && (
        <div className="document-notice" role="alert">
          <span>{activeTab.saveError}</span>
          <button onClick={() => void saveTabAt(activeTabIndex)}>Retry</button>
          <button onClick={() => void reviewDiskVersion()}>View disk copy</button>
          <button onClick={() => void saveTabAt(activeTabIndex, { copy: true })}>
            Save a copy
          </button>
          <button onClick={() => void overwriteDisk()}>Replace disk file…</button>
        </div>
      )}
      <div className="flex-1 overflow-hidden">
        <HybridEditor
          mdPath={currentFilePath}
          key={activeTab.id}
          documentId={activeTab.id}
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
          codeWrap={codeWrap}
          sourceMode={sourceMode}
        />
      </div>
    </div>
  );
}
