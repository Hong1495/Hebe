import Fuse from "fuse.js";
import { FileText, Loader2, Search } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { listMarkdownFiles, readMarkdownFile } from "../../lib/ipc";
import { basename, relativePath } from "../../lib/path";
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
  const [loading, setLoading] = useState(false);
  const [selectedIdx, setSelectedIdx] = useState(0);

  useEffect(() => {
    if (!open || !folderPath) {
      if (!open) setQuery("");
      if (!open) setFiles([]);
      setLoading(false);
      return;
    }
    setQuery("");
    setLoading(true);

    let cancelled = false;

    listMarkdownFiles(folderPath)
      .then((entries) => {
        if (!cancelled) {
          setFiles(entries.map((entry) => ({ name: entry.name, path: entry.path })));
        }
      })
      .catch(() => {
        if (!cancelled) setFiles([]);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
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
        const content = await readMarkdownFile(file.path);
        openFile(file.path, content);
        addRecentFile(file.path);
        onClose();
      } catch (err) {
        console.error("Failed to open quick file:", file.path, err);
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
      className="command-backdrop fixed inset-0 z-50 flex items-start justify-center pt-[18vh]"
      onClick={onClose}
    >
      <div
        className="command-panel w-[560px] max-h-[420px] overflow-hidden flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="command-input-row">
          <Search size={17} />
          <input
            autoFocus
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Open markdown file"
          />
          {loading && <Loader2 className="animate-spin" size={16} />}
        </div>
        <div className="flex-1 overflow-y-auto">
          {!folderPath ? (
            <div className="command-empty">Open a folder first</div>
          ) : loading ? (
            <div className="command-empty">Indexing files...</div>
          ) : results.length === 0 ? (
            <div className="command-empty">
              No files found
            </div>
          ) : (
            results.map(({ item }, idx) => (
              <button
                key={item.path}
                type="button"
                className={`command-result ${idx === selectedIdx ? "is-selected" : ""}`}
                onClick={() => handleSelect(item)}
                onMouseEnter={() => setSelectedIdx(idx)}
              >
                <FileText size={15} />
                <div className="command-result-stack">
                  <span className="command-result-title">{item.name}</span>
                  <span className="command-result-path">
                    {relativePath(item.path, folderPath ?? "") || basename(item.path)}
                  </span>
                </div>
              </button>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
