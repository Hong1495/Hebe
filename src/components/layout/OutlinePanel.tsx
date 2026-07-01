import { useEffect, useMemo, useState } from "react";
import { getHeadingOutline, type Heading } from "../../lib/ipc";
import { useAppStore } from "../../stores/app-store";

interface OutlinePanelProps {
  onJump?: (line: number) => void;
}

export function OutlinePanel({ onJump }: OutlinePanelProps) {
  const currentContent = useAppStore((s) => s.currentContent());
  const [headings, setHeadings] = useState<Heading[]>([]);

  useEffect(() => {
    if (!currentContent) {
      setHeadings([]);
      return;
    }

    const timer = setTimeout(async () => {
      try {
        const result = await getHeadingOutline(currentContent);
        setHeadings(result);
      } catch {
        setHeadings([]);
      }
    }, 300);

    return () => clearTimeout(timer);
  }, [currentContent]);

  const indentForLevel = useMemo(() => (level: number) => Math.min(level - 1, 4) * 12, []);

  return (
    <div
      className="h-full overflow-y-auto border-l select-none"
      style={{
        background: "var(--surface)",
        borderColor: "var(--border)",
      }}
    >
      <div
        className="flex items-center justify-between px-4 py-3 sticky top-0 z-10"
        style={{ background: "var(--surface)" }}
      >
        <span
          className="text-xs font-semibold uppercase tracking-wider"
          style={{ color: "var(--text-secondary)" }}
        >
          Outline
        </span>
        <span className="text-xs" style={{ color: "var(--text-secondary)" }}>
          {headings.length}
        </span>
      </div>

      {headings.length === 0 ? (
        <div className="px-3 py-8 text-center">
          <p style={{ color: "var(--text-secondary)" }} className="text-sm">
            No headings yet
          </p>
        </div>
      ) : (
        <nav className="px-1 py-1">
          {headings.map((h, i) => (
            <button
              type="button"
              key={`${h.text}-${h.line}-${i}`}
              onClick={() => onJump?.(h.line)}
              className="w-full text-left px-3 py-1 rounded text-sm truncate transition-colors hover:opacity-80"
              style={{
                paddingLeft: `${12 + indentForLevel(h.level)}px`,
                color: h.level <= 2 ? "var(--text-heading)" : "var(--text-secondary)",
                fontSize: h.level === 1 ? "13px" : "12px",
                fontWeight: h.level <= 2 ? 500 : 400,
              }}
              title={h.text}
            >
              {h.text}
            </button>
          ))}
        </nav>
      )}
    </div>
  );
}
