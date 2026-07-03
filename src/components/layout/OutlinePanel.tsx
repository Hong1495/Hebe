import { Hash, ListTree } from "lucide-react";
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
    <div className="side-panel h-full overflow-y-auto border-l select-none">
      <div className="panel-header sticky top-0 z-10">
        <span>
          <ListTree size={14} />
          Outline
        </span>
        <span className="panel-count">{headings.length}</span>
      </div>

      {headings.length === 0 ? (
        <div className="panel-empty">
          <Hash size={28} />
          <p>No headings</p>
        </div>
      ) : (
        <nav className="outline-list">
          {headings.map((h, i) => (
            <button
              type="button"
              key={`${h.text}-${h.line}-${i}`}
              onClick={() => onJump?.(h.line)}
              className={`outline-row level-${Math.min(h.level, 6)}`}
              style={{
                paddingLeft: `${12 + indentForLevel(h.level)}px`,
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
