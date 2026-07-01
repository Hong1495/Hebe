import { useAppStore } from "../../stores/app-store";

export function StatusBar() {
  const currentFilePath = useAppStore((s) => s.currentFilePath());
  const focusMode = useAppStore((s) => s.focusMode);
  const typewriterMode = useAppStore((s) => s.typewriterMode);
  const toggleSettings = useAppStore((s) => s.toggleSettings);

  return (
    <div
      className="flex items-center justify-between px-3 py-1 text-xs border-t select-none"
      style={{
        background: "var(--surface)",
        borderColor: "var(--border)",
        color: "var(--text-secondary)",
      }}
    >
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={toggleSettings}
          className="hover:opacity-80 transition-opacity"
        >
          ⚙
        </button>
        <span>{currentFilePath ?? "Untitled"}</span>
        {currentFilePath && (
          <span className="w-2 h-2 rounded-full" style={{ background: "var(--accent)" }} />
        )}
      </div>
      <div className="flex items-center gap-3">
        {focusMode && (
          <span
            className="px-1.5 py-0.5 rounded text-xs"
            style={{ background: "var(--accent-bg)", color: "var(--accent)" }}
          >
            Focus
          </span>
        )}
        {typewriterMode && (
          <span
            className="px-1.5 py-0.5 rounded text-xs"
            style={{ background: "var(--accent-bg)", color: "var(--accent)" }}
          >
            Typewriter
          </span>
        )}
        <span>UTF-8</span>
        <span>Markdown</span>
      </div>
    </div>
  );
}
