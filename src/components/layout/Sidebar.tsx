import { readTextFile as tauriReadTextFile } from "@tauri-apps/plugin-fs";
import { useEffect, useState } from "react";
import { type FileEntry, listDirectory, revealInFinder } from "../../lib/ipc";
import { useAppStore } from "../../stores/app-store";

export function Sidebar() {
  const folderPath = useAppStore((s) => s.folderPath);
  const currentFilePath = useAppStore((s) => s.currentFilePath());
  const openFile = useAppStore((s) => s.openFile);
  const setFolderPath = useAppStore((s) => s.setFolderPath);
  const [files, setFiles] = useState<FileEntry[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!folderPath) {
      setFiles([]);
      return;
    }

    setLoading(true);
    listDirectory(folderPath)
      .then(setFiles)
      .catch(() => setFiles([]))
      .finally(() => setLoading(false));
  }, [folderPath]);

  const handleFileClick = async (f: FileEntry) => {
    if (f.is_dir) {
      setFolderPath(f.path);
      return;
    }
    if (f.path === currentFilePath) return;
    try {
      const content = await tauriReadTextFile(f.path);
      openFile(f.path, content);
    } catch {
      // skip unreadable files
    }
  };

  const goUp = () => {
    if (!folderPath) return;
    const parent = folderPath.split("/").slice(0, -1).join("/") || "/";
    setFolderPath(parent);
  };

  return (
    <div
      className="h-full overflow-y-auto border-r select-none flex flex-col"
      style={{ background: "var(--surface)", borderColor: "var(--border)" }}
    >
      <div
        className="flex items-center justify-between px-4 py-3 shrink-0 sticky top-0 z-10"
        style={{ background: "var(--surface)" }}
      >
        <span
          className="text-xs font-semibold uppercase tracking-wider"
          style={{ color: "var(--text-secondary)" }}
        >
          Files
        </span>
        <span className="text-xs" style={{ color: "var(--text-secondary)" }}>
          {files.length}
        </span>
      </div>

      {!folderPath ? (
        <div className="px-3 py-8 text-center">
          <p style={{ color: "var(--text-secondary)" }} className="text-sm">
            Open a folder to begin
          </p>
        </div>
      ) : (
        <>
          <div className="px-3 pb-1">
            <button
              type="button"
              onClick={goUp}
              className="text-xs px-2 py-0.5 rounded hover:opacity-80 transition-opacity inline-flex items-center gap-1"
              style={{ color: "var(--text-secondary)" }}
            >
              ← {folderPath.split("/").pop() || "/"}
            </button>
          </div>

          {loading ? (
            <div className="px-3 py-4 text-center">
              <span className="text-xs" style={{ color: "var(--text-secondary)" }}>
                Loading...
              </span>
            </div>
          ) : files.length === 0 ? (
            <div className="px-3 py-4 text-center">
              <span className="text-xs" style={{ color: "var(--text-secondary)" }}>
                Empty folder
              </span>
            </div>
          ) : (
            <div className="flex-1 overflow-y-auto px-1 pb-2">
              {files.map((f) => (
                <button
                  type="button"
                  key={f.path}
                  onClick={() => handleFileClick(f)}
                  onContextMenu={(e) => {
                    e.preventDefault();
                    const menu = document.createElement("div");
                    menu.style.cssText = `position:fixed;left:${e.clientX}px;top:${e.clientY}px;z-index:9999;background:var(--bg);border:1px solid var(--border);border-radius:8px;padding:4px;min-width:160px;box-shadow:0 4px 12px rgba(0,0,0,0.15);`;
                    const items: [string, () => void][] = [
                      ["Open", () => handleFileClick(f)],
                      ["Reveal in Finder", () => revealInFinder(f.path).catch(() => {})],
                    ];
                    items.forEach(([label, action]) => {
                      const btn = document.createElement("button");
                      btn.textContent = label;
                      btn.style.cssText =
                        "display:block;width:100%;text-align:left;padding:4px 8px;font-size:12px;border-radius:4px;border:none;background:transparent;color:var(--text);cursor:pointer;";
                      btn.onmouseenter = () => {
                        btn.style.background = "var(--accent-bg)";
                      };
                      btn.onmouseleave = () => {
                        btn.style.background = "transparent";
                      };
                      btn.onclick = () => {
                        action();
                        menu.remove();
                      };
                      menu.appendChild(btn);
                    });
                    document.body.appendChild(menu);
                    const closeMenu = () => menu.remove();
                    setTimeout(
                      () => document.addEventListener("click", closeMenu, { once: true }),
                      0,
                    );
                  }}
                  className="w-full text-left px-3 py-1 rounded text-sm truncate transition-colors hover:opacity-80"
                  style={{
                    color: f.path === currentFilePath ? "var(--accent)" : "var(--text-secondary)",
                    background: f.path === currentFilePath ? "var(--accent-bg)" : "transparent",
                    opacity: f.is_dir ? 0.7 : 1,
                  }}
                  title={f.path}
                >
                  <span className="mr-2 text-xs">{f.is_dir ? "📁" : "📄"}</span>
                  {f.name}
                </button>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
