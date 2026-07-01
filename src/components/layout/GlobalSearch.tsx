import { readTextFile } from "@tauri-apps/plugin-fs";
import { useCallback, useState } from "react";
import { type SearchResult, searchFulltext } from "../../lib/ipc";
import { useAppStore } from "../../stores/app-store";

interface GlobalSearchProps {
  open: boolean;
  onClose: () => void;
}

export function GlobalSearch({ open, onClose }: GlobalSearchProps) {
  const folderPath = useAppStore((s) => s.folderPath);
  const openFile = useAppStore((s) => s.openFile);
  const addRecentFile = useAppStore((s) => s.addRecentFile);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [selectedIdx, setSelectedIdx] = useState(0);

  const handleSearch = useCallback(async () => {
    if (!folderPath || !query.trim()) return;
    setSearching(true);
    try {
      const r = await searchFulltext(folderPath, query.trim());
      setResults(r);
      setSelectedIdx(0);
    } catch {
      setResults([]);
    } finally {
      setSearching(false);
    }
  }, [folderPath, query]);

  const handleSelect = useCallback(
    async (r: SearchResult) => {
      try {
        const content = await readTextFile(r.path);
        openFile(r.path, content);
        addRecentFile(r.path);
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
        if (e.shiftKey) {
          handleSearch();
        } else if (results[selectedIdx]) {
          handleSelect(results[selectedIdx]);
        }
      } else if (e.key === "Escape") {
        onClose();
      }
    },
    [results, selectedIdx, handleSearch, handleSelect, onClose],
  );

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center pt-[15vh]"
      onClick={onClose}
      style={{ background: "rgba(0,0,0,0.3)" }}
    >
      <div
        className="w-[550px] max-h-[420px] rounded-xl shadow-2xl overflow-hidden flex flex-col"
        style={{ background: "var(--surface)", border: "1px solid var(--border)" }}
        onClick={(e) => e.stopPropagation()}
      >
        <div
          className="flex items-center gap-2 px-3 py-2 border-b"
          style={{ borderColor: "var(--border)" }}
        >
          <input
            autoFocus
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Search in folder... (Shift+Enter to search, Enter to open)"
            className="flex-1 text-sm outline-none"
            style={{ background: "transparent", color: "var(--text)" }}
          />
          <button
            type="button"
            onClick={handleSearch}
            className="text-xs px-2 py-1 rounded hover:opacity-80 transition-opacity"
            style={{ color: "var(--text-secondary)" }}
          >
            Search
          </button>
        </div>
        <div className="flex-1 overflow-y-auto">
          {!folderPath ? (
            <div
              className="px-4 py-8 text-center text-xs"
              style={{ color: "var(--text-secondary)" }}
            >
              Open a folder first to search
            </div>
          ) : searching ? (
            <div
              className="px-4 py-4 text-center text-xs"
              style={{ color: "var(--text-secondary)" }}
            >
              Searching...
            </div>
          ) : results.length === 0 && query ? (
            <div
              className="px-4 py-6 text-center text-xs"
              style={{ color: "var(--text-secondary)" }}
            >
              No results. Press Shift+Enter to search.
            </div>
          ) : (
            results.map((r, idx) => (
              <button
                key={r.path}
                type="button"
                className="w-full text-left px-4 py-2.5 border-b transition-colors"
                style={{
                  background: idx === selectedIdx ? "var(--accent-bg)" : "transparent",
                  borderColor: "var(--border)",
                }}
                onClick={() => handleSelect(r)}
                onMouseEnter={() => setSelectedIdx(idx)}
              >
                <div className="text-xs truncate" style={{ color: "var(--accent)" }}>
                  {r.path.split("/").pop()}
                </div>
                <div className="text-xs mt-0.5 truncate" style={{ color: "var(--text-secondary)" }}>
                  {r.snippet}
                </div>
              </button>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
