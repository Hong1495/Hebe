import { FileText, Loader2, Search } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { readMarkdownFile, type SearchResult, searchFulltext } from "../../lib/ipc";
import { basename } from "../../lib/path";
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

  useEffect(() => {
    if (!open) {
      setQuery("");
      setResults([]);
      setSearching(false);
      return;
    }

    if (!folderPath || !query.trim()) {
      setResults([]);
      setSearching(false);
      return;
    }

    let cancelled = false;
    const searchQuery = query.trim();
    const timer = setTimeout(async () => {
      setSearching(true);
      try {
        const r = await searchFulltext(folderPath, searchQuery);
        if (!cancelled) {
          setResults(r);
          setSelectedIdx(0);
        }
      } catch {
        if (!cancelled) setResults([]);
      } finally {
        if (!cancelled) setSearching(false);
      }
    }, 250);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [folderPath, open, query]);

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
        const content = await readMarkdownFile(r.path);
        openFile(r.path, content);
        addRecentFile(r.path);
        onClose();
      } catch (err) {
        console.error("Failed to open search result:", r.path, err);
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
        if (results[selectedIdx]) {
          handleSelect(results[selectedIdx]);
        }
      } else if (e.key === "Escape") {
        onClose();
      }
    },
    [results, selectedIdx, handleSelect, onClose],
  );

  if (!open) return null;

  return (
    <div
      className="command-backdrop fixed inset-0 z-50 flex items-start justify-center pt-[15vh]"
      onClick={onClose}
    >
      <div
        className="command-panel w-[620px] max-h-[480px] overflow-hidden flex flex-col"
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
            placeholder="Search in folder"
          />
          {searching && <Loader2 className="animate-spin" size={16} />}
          <button
            type="button"
            onClick={handleSearch}
            className="toolbar-chip"
          >
            Search
          </button>
        </div>
        <div className="flex-1 overflow-y-auto">
          {!folderPath ? (
            <div className="command-empty">
              Open a folder first to search
            </div>
          ) : searching ? (
            <div className="command-empty">
              Searching...
            </div>
          ) : results.length === 0 && query ? (
            <div className="command-empty">
              No results
            </div>
          ) : (
            results.map((r, idx) => (
              <button
                key={r.path}
                type="button"
                className={`command-result command-result-tall ${
                  idx === selectedIdx ? "is-selected" : ""
                }`}
                onClick={() => handleSelect(r)}
                onMouseEnter={() => setSelectedIdx(idx)}
              >
                <FileText size={15} />
                <div className="command-result-stack">
                  <div className="command-result-title">
                    {basename(r.path)}
                  </div>
                  <div className="command-result-snippet">
                    {r.snippet}
                  </div>
                </div>
              </button>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
