import { open } from "@tauri-apps/plugin-dialog";
import { ChevronUp, FileText, Folder, FolderOpen } from "lucide-react";
import { useEffect, useState } from "react";
import { type FileEntry, listDirectory, readMarkdownFile, revealInFinder } from "../../lib/ipc";
import { basename, dirname } from "../../lib/path";
import { useAppStore } from "../../stores/app-store";

export function Sidebar() {
  const folderPath = useAppStore((s) => s.folderPath);
  const currentFilePath = useAppStore((s) => s.currentFilePath());
  const openFile = useAppStore((s) => s.openFile);
  const setFolderPath = useAppStore((s) => s.setFolderPath);
  const [files, setFiles] = useState<FileEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const folderName = folderPath ? basename(folderPath) : "";

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
      const content = await readMarkdownFile(f.path);
      openFile(f.path, content);
    } catch (err) {
      console.error("Failed to open sidebar file:", f.path, err);
    }
  };

  const goUp = () => {
    if (!folderPath) return;
    const parent = dirname(folderPath) || "/";
    setFolderPath(parent);
  };

  const handleOpenFolder = async () => {
    try {
      const selected = await open({ directory: true, multiple: false });
      if (selected) setFolderPath(selected);
    } catch {
      // ignore cancelled dialogs
    }
  };

  return (
    <div className="side-panel h-full overflow-y-auto border-r select-none flex flex-col">
      <div className="panel-header shrink-0 sticky top-0 z-10">
        <span>
          Files
        </span>
        <button type="button" className="icon-button" onClick={handleOpenFolder} title="Open folder">
          <FolderOpen size={15} />
        </button>
      </div>

      {!folderPath ? (
        <div className="panel-empty">
          <FolderOpen size={28} />
          <p>No folder open</p>
          <button type="button" onClick={handleOpenFolder} className="secondary-button">
            Open Folder
          </button>
        </div>
      ) : (
        <>
          <div className="folder-strip">
            <button
              type="button"
              onClick={goUp}
              className="folder-up"
              title={folderPath}
            >
              <ChevronUp size={14} />
              <span>{folderName}</span>
            </button>
            <span>{files.length}</span>
          </div>

          {loading ? (
            <div className="panel-empty compact">Loading...</div>
          ) : files.length === 0 ? (
            <div className="panel-empty compact">Empty folder</div>
          ) : (
            <div className="flex-1 overflow-y-auto px-2 pb-2">
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
                  className={`file-row ${f.path === currentFilePath ? "is-active" : ""}`}
                  title={f.path}
                >
                  {f.is_dir ? <Folder size={15} /> : <FileText size={15} />}
                  <span>{f.name}</span>
                </button>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
