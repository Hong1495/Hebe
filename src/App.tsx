import { invoke } from "@tauri-apps/api/core";
import { useAppUpdates } from "./lib/use-app-updates";
import { EditorView } from "@codemirror/view";
import { setTheme as setAppTheme } from "@tauri-apps/api/app";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { EditorArea } from "./components/layout/EditorArea";
import { OutlinePanel } from "./components/layout/OutlinePanel";
import { SettingsDialog } from "./components/layout/SettingsPanel";
import { StatusBar } from "./components/layout/StatusBar";
import { UpdateIndicator } from "./components/layout/UpdateIndicator";
import { TabBar } from "./components/layout/TabBar";
import { closeTabWithPrompt, prepareWindowClose } from "./lib/document-lifecycle";
import { hideMainWindow, isTauriRuntime, readMarkdownFile, takePendingOpenFiles } from "./lib/ipc";
import { useResolvedTheme } from "./lib/use-resolved-theme";
import { useAppStore } from "./stores/app-store";

const MARKDOWN_FILE_RE = /\.(md|markdown|mdx|mkd|mkdn)$/i;

const WINDOW_BACKGROUND: Record<"light" | "dark", string> = {
  light: "#ffffff",
  dark: "#1e1e1e",
};

async function setCheckedMenuItem(item: unknown, checked: boolean): Promise<void> {
  if (!item || typeof item !== "object" || !("setChecked" in item)) return;
  const checkItem = item as { setChecked: (checked: boolean) => Promise<void> };
  await checkItem.setChecked(checked);
}

function App() {
  const updates = useAppUpdates();
  const [updateOpen, setUpdateOpen] = useState(false);
  const outlineVisible = useAppStore((s) => s.outlineVisible);
  const settingsVisible = useAppStore((s) => s.settingsVisible);
  const outlineWidth = useAppStore((s) => s.outlineWidth);
  const setOutlineWidth = useAppStore((s) => s.setOutlineWidth);
  const openFile = useAppStore((s) => s.openFile);
  const addRecentFile = useAppStore((s) => s.addRecentFile);
  const recentFiles = useAppStore((s) => s.recentFiles);
  const setRecentFiles = useAppStore((s) => s.setRecentFiles);
  const theme = useAppStore((s) => s.theme);
  const resolvedTheme = useResolvedTheme(theme);
  const zoom = useAppStore((s) => s.zoom);
  const focusMode = useAppStore((s) => s.focusMode);
  const typewriterMode = useAppStore((s) => s.typewriterMode);
  const sourceMode = useAppStore((s) => s.sourceMode);
  const editorViewRef = useRef<EditorView | null>(null);
  const windowCloseInProgressRef = useRef(false);

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", resolvedTheme);
    document.documentElement.style.colorScheme = resolvedTheme;
    if (!isTauriRuntime()) return;
    try {
      const nativeTheme = theme === "system" ? null : resolvedTheme;
      const currentWindow = getCurrentWindow();
      void Promise.allSettled([
        currentWindow.setTheme(nativeTheme),
        currentWindow.setBackgroundColor(WINDOW_BACKGROUND[resolvedTheme]),
        setAppTheme(nativeTheme),
      ]);
    } catch {
      // ignore unsupported window theme calls
    }
  }, [theme, resolvedTheme]);

  useEffect(() => {
    document.documentElement.style.setProperty("--editor-zoom", String(zoom / 100));
  }, [zoom]);

  useEffect(() => {
    let cancelled = false;

    const restoreRecentFile = async () => {
      for (const filePath of recentFiles) {
        try {
          const content = await readMarkdownFile(filePath);
          if (cancelled) return;
          const { tabs, activeTabIndex } = useAppStore.getState();
          const activeTab = tabs[activeTabIndex];
          if (tabs.length !== 1 || activeTab?.path || activeTab?.dirty || activeTab?.content) {
            return;
          }
          openFile(filePath, content);
          addRecentFile(filePath);
          return;
        } catch {
          // Try the next recent file.
        }
      }

      if (!cancelled && recentFiles.length > 0) {
        setRecentFiles([]);
      }
    };

    void restoreRecentFile();

    return () => {
      cancelled = true;
    };
  }, []);

  const openMarkdownFiles = useCallback(async (paths: string[], isCancelled: () => boolean) => {
    const markdownPaths = paths.filter((path) => MARKDOWN_FILE_RE.test(path));
    for (const filePath of markdownPaths) {
      try {
        const content = await readMarkdownFile(filePath);
        if (isCancelled()) return;
        useAppStore.getState().openFile(filePath, content);
        useAppStore.getState().addRecentFile(filePath);
      } catch (err) {
        console.error("Failed to open file:", filePath, err);
      }
    }
  }, []);

  useEffect(() => {
    if (!isTauriRuntime()) return;
    let cancelled = false;
    let unlisten: (() => void) | undefined;

    let currentWindow: ReturnType<typeof getCurrentWindow>;
    try {
      currentWindow = getCurrentWindow();
    } catch {
      return;
    }

    currentWindow
      .onDragDropEvent(async (event) => {
        if (event.payload.type !== "drop") return;
        await openMarkdownFiles(event.payload.paths, () => cancelled);
      })
      .then((stop) => {
        if (cancelled) {
          stop();
          return;
        }
        unlisten = stop;
      })
      .catch(() => {
        // ignore in non-tauri contexts
      });

    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, [openMarkdownFiles]);

  useEffect(() => {
    if (!isTauriRuntime()) return;
    let cancelled = false;
    let unlisten: (() => void) | undefined;

    const setupCloseListener = async () => {
      try {
        unlisten = await getCurrentWindow().onCloseRequested(async (event) => {
          event.preventDefault();
          if (cancelled || windowCloseInProgressRef.current) return;
          windowCloseInProgressRef.current = true;
          try {
            if (await prepareWindowClose()) {
              try {
                await hideMainWindow();
              } catch {
                await getCurrentWindow().hide();
              }
            }
          } finally {
            windowCloseInProgressRef.current = false;
          }
        });
      } catch {
        // ignore listener setup failure in non-runtime contexts
      }
    };

    void setupCloseListener();

    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, []);

  useEffect(() => {
    if (!isTauriRuntime()) return;
    let cancelled = false;
    let stop: (() => void) | undefined;
    void listen("request-quit", async () => {
      if (windowCloseInProgressRef.current) return;
      windowCloseInProgressRef.current = true;
      try {
        if (await prepareWindowClose()) await invoke("quit_app");
      } finally {
        windowCloseInProgressRef.current = false;
      }
    }).then((unlisten) => {
      if (cancelled) unlisten();
      else stop = unlisten;
    });
    return () => {
      cancelled = true;
      stop?.();
    };
  }, []);

  useEffect(() => {
    if (!isTauriRuntime()) return;
    let cancelled = false;

    const syncMenuChecks = async () => {
      try {
        const { Menu } = await import("@tauri-apps/api/menu");
        const menu = await Menu.default();
        const items = await Promise.all([
          menu.get("toggle-outline"),
          menu.get("toggle-focus"),
          menu.get("toggle-typewriter"),
          menu.get("toggle-source"),
        ]);
        if (cancelled) return;
        await Promise.all([
          setCheckedMenuItem(items[0], outlineVisible),
          setCheckedMenuItem(items[1], focusMode),
          setCheckedMenuItem(items[2], typewriterMode),
          setCheckedMenuItem(items[3], sourceMode),
        ]);
      } catch {
        // menu state sync is best-effort
      }
    };

    void syncMenuChecks();

    return () => {
      cancelled = true;
    };
  }, [outlineVisible, focusMode, typewriterMode, sourceMode]);

  useEffect(() => {
    if (!isTauriRuntime()) return;
    let cancelled = false;
    let unlisten: (() => void) | undefined;

    const setupOpenListener = async () => {
      try {
        unlisten = await listen<string[]>("open-files", async (event) => {
          await openMarkdownFiles(event.payload, () => cancelled);
        });
        const pending = await takePendingOpenFiles();
        await openMarkdownFiles(pending, () => cancelled);
      } catch {
        // ignore listener setup failure in non-runtime contexts
      }
    };

    void setupOpenListener();

    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, [openMarkdownFiles]);

  const gridCols = useMemo(() => {
    const cols = [];
    cols.push("minmax(0, 1fr)");
    if (outlineVisible) cols.push("4px", `${outlineWidth}px`);
    return cols.join(" ");
  }, [outlineVisible, outlineWidth]);

  const beginOutlineResize = (startX: number) => {
    const initialWidth = outlineWidth;

    const handleMove = (event: MouseEvent) => {
      const delta = event.clientX - startX;
      setOutlineWidth(initialWidth - delta);
    };

    const handleUp = () => {
      document.body.classList.remove("is-resizing-panel");
      window.removeEventListener("mousemove", handleMove);
      window.removeEventListener("mouseup", handleUp);
    };

    document.body.classList.add("is-resizing-panel");
    window.addEventListener("mousemove", handleMove);
    window.addEventListener("mouseup", handleUp);
  };

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
    <div className="app-shell" style={{ background: "var(--bg)", color: "var(--text)" }}>
      <UpdateIndicator updater={updates} open={updateOpen} setOpen={setUpdateOpen} />
      <TabBar onCloseTab={(index) => closeTabWithPrompt(index)} />
      <div className="app-body" style={{ gridTemplateColumns: gridCols }}>
        <div className="app-main">
          <EditorArea
            onEditorViewReady={(v) => {
              editorViewRef.current = v;
            }}
          />
        </div>
        {outlineVisible && (
          <div
            className="panel-resizer panel-resizer-right"
            onMouseDown={(event) => beginOutlineResize(event.clientX)}
          />
        )}
        {outlineVisible && (
          <div className="app-rail">
            <OutlinePanel onJump={handleOutlineJump} />
          </div>
        )}
      </div>
      <SettingsDialog open={settingsVisible} updates={updates} />
      <StatusBar />
    </div>
  );
}

export default App;
