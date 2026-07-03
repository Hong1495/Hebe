import { Minus, Plus } from "lucide-react";
import { useAppStore } from "../../stores/app-store";

export function StatusBar() {
  const currentContent = useAppStore((s) => s.currentContent());
  const focusMode = useAppStore((s) => s.focusMode);
  const typewriterMode = useAppStore((s) => s.typewriterMode);
  const sourceMode = useAppStore((s) => s.sourceMode);
  const zoom = useAppStore((s) => s.zoom);
  const zoomIn = useAppStore((s) => s.zoomIn);
  const zoomOut = useAppStore((s) => s.zoomOut);
  const resetZoom = useAppStore((s) => s.resetZoom);
  const lineCount = currentContent ? currentContent.split("\n").length : 1;
  const wordCount = countMarkdownWords(currentContent);

  return (
    <div
      className="status-bar flex items-center justify-between px-2 text-xs select-none"
      style={{ color: "var(--text-secondary)" }}
    >
      <div className="status-cluster">
        <span className="status-meta">{lineCount} lines</span>
        <span className="status-meta">{wordCount} words</span>
      </div>
      <div className="status-cluster">
        {focusMode && <span className="status-pill">Focus</span>}
        {typewriterMode && <span className="status-pill">Typewriter</span>}
        {sourceMode && <span className="status-pill">Source</span>}
        <button
          type="button"
          className="status-icon-button"
          onClick={zoomOut}
          disabled={zoom <= 80}
          title="Zoom out"
        >
          <Minus size={13} />
        </button>
        <button
          type="button"
          className="status-zoom"
          onClick={resetZoom}
          disabled={zoom === 100}
          title="Actual size"
        >
          {zoom}%
        </button>
        <button
          type="button"
          className="status-icon-button"
          onClick={zoomIn}
          disabled={zoom >= 160}
          title="Zoom in"
        >
          <Plus size={13} />
        </button>
      </div>
    </div>
  );
}

function countMarkdownWords(content: string): number {
  const latinWords = content.match(/[\p{L}\p{N}]+(?:['’-][\p{L}\p{N}]+)*/gu) ?? [];
  const cjkChars =
    content.match(/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/gu) ??
    [];
  const cjkInLatinWords = latinWords
    .join("")
    .match(/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/gu);
  return latinWords.length + cjkChars.length - (cjkInLatinWords?.length ?? 0);
}
