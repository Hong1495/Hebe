import { readTextFile as tauriReadTextFile } from "@tauri-apps/plugin-fs";
import Fuse from "fuse.js";
import { useCallback, useEffect, useMemo, useState } from "react";
import { listDirectory } from "../../lib/ipc";
import { useAppStore } from "../../stores/app-store";

interface QuickOpenProps {
  open: boolean;
  onClose: () => void;
}

interface ScoredFile {
  name: string;
  path: string;
}

export function QuickOpen({ open, onClose }: QuickOpenProps) {
  const folderPath = useAppStore((s) => s.folderPath);
  const openFile = useAppStore((s) => s.openFile);
  const addRecentFile = useAppStore((s) => s.addRecentFile);
  const [query, setQuery] = useState("");
  const [files, setFiles] = useState<ScoredFile[]>([]);
  const [selectedIdx, setSelectedIdx] = useState(0);

  // Collect all markdown files recursively
  useEffect(() => {
    if (!open || !folderPath) {
      if (!open) setQuery("");
      return;
    }
    setQuery("");

    let cancelled = false;

    async function collect(dir: string): Promise<ScoredFile[]> {
      if (cancelled) return [];
      const result: ScoredFile[] = [];
      try {
        const entries = await listDirectory(dir);
        for (const e of entries) {
          if (cancelled) break;
          if (e.is_dir) {
            result.push(...(await collect(e.path)));
          } else if (/(?:\.md|\.markdown|\.mdx|\.mkd|\.mkdn)$/i.test(e.name)) {
            result.push({ name: e.name, path: e.path });
          }
        }
      } catch {
        // skip
      }
      return result;
    }

    collect(folderPath).then((r) => {
      if (!cancelled) setFiles(r);
    });

    return () => {
      cancelled = true;
    };
  }, [open, folderPath]);

  const fuse = useMemo(
    () =>
      new Fuse(files, {
        keys: ["name", "path"],
        threshold: 0.4,
        includeScore: true,
      }),
    [files],
  );

  const results = useMemo(() => {
    if (!query.trim()) return files.slice(0, 20).map((f) => ({ item: f }));
    return fuse.search(query).slice(0, 20);
  }, [query, files, fuse]);

  // Reset selection when results change
  useEffect(() => setSelectedIdx(0), [results]);

  const handleSelect = useCallback(
    async (file: ScoredFile) => {
      try {
        const content = await tauriReadTextFile(file.path);
        openFile(file.path, content);
        addRecentFile(file.path);
        onClose();
      } catch {
        // skip
      }
    },
    [openFile, addRecentFile, onClose],
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setSelectedIdx((i) => Math.min(i + 1, results.length - 1));
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setSelectedIdx((i) => Math.max(i - 1, 0));
      } else if (e.key === "Enter") {
        e.preventDefault();
        const selected = results[selectedIdx];
        if (selected) handleSelect(selected.item);
      } else if (e.key === "Escape") {
        onClose();
      }
    },
    [results, selectedIdx, handleSelect, onClose],
  );

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center pt-[20vh]"
      onClick={onClose}
      style={{ background: "rgba(0,0,0,0.3)" }}
    >
      <div
        className="w-[500px] max-h-[360px] rounded-xl shadow-2xl overflow-hidden flex flex-col"
        style={{ background: "var(--surface)", border: "1px solid var(--border)" }}
        onClick={(e) => e.stopPropagation()}
      >
        <input
          autoFocus
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Search files by name..."
          className="w-full px-4 py-3 text-sm border-b outline-none"
          style={{
            background: "transparent",
            color: "var(--text)",
            borderColor: "var(--border)",
          }}
        />
        <div className="flex-1 overflow-y-auto">
          {results.length === 0 ? (
            <div
              className="px-4 py-6 text-center text-xs"
              style={{ color: "var(--text-secondary)" }}
            >
              No files found
            </div>
          ) : (
            results.map(({ item }, idx) => (
              <button
                key={item.path}
                type="button"
                className="w-full text-left px-4 py-2 text-sm flex items-center gap-2 transition-colors"
                style={{
                  background: idx === selectedIdx ? "var(--accent-bg)" : "transparent",
                  color: idx === selectedIdx ? "var(--accent)" : "var(--text)",
                }}
                onClick={() => handleSelect(item)}
                onMouseEnter={() => setSelectedIdx(idx)}
              >
                <span className="text-xs shrink-0">📄</span>
                <span className="truncate">{item.name}</span>
                <span
                  className="text-xs truncate ml-auto opacity-50"
                  style={{ color: "var(--text-secondary)" }}
                >
                  {item.path.replace(folderPath ?? "", "").replace(/^\//, "")}
                </span>
              </button>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
