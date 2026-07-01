import { useAppStore } from "../../stores/app-store";

export function SettingsPanel() {
  const theme = useAppStore((s) => s.theme);
  const setTheme = useAppStore((s) => s.setTheme);

  const themes: { id: "light" | "dark" | "sepia"; label: string; preview: string }[] = [
    { id: "light", label: "Light", preview: "#ffffff" },
    { id: "dark", label: "Dark", preview: "#1e1e1e" },
    { id: "sepia", label: "Sepia", preview: "#fbf0d9" },
  ];

  return (
    <div
      className="h-full overflow-y-auto border-r select-none"
      style={{ background: "var(--surface)", borderColor: "var(--border)" }}
    >
      <div className="px-4 py-3">
        <span
          className="text-xs font-semibold uppercase tracking-wider"
          style={{ color: "var(--text-secondary)" }}
        >
          Settings
        </span>
      </div>

      <div className="px-3 py-2">
        <p className="text-xs mb-2" style={{ color: "var(--text-secondary)" }}>
          Theme
        </p>
        <div className="flex gap-2">
          {themes.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setTheme(t.id)}
              className="flex-1 rounded-lg border-2 p-2 text-center text-xs transition-colors"
              style={{
                borderColor: theme === t.id ? "var(--accent)" : "var(--border)",
                background: t.preview,
                color: t.id === "dark" ? "#ccc" : "#333",
              }}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
