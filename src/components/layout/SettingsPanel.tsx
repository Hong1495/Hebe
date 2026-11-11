import type { useAppUpdates } from "../../lib/use-app-updates";
import { Minus, Monitor, Plus, Type, X } from "lucide-react";
import { useEffect, useState } from "react";
import type { ThemePreference } from "../../lib/theme";
import { useAppStore } from "../../stores/app-store";

interface SettingsDialogProps {
  open: boolean;
  updates: ReturnType<typeof useAppUpdates>;
}

type SettingsSection = "appearance" | "editor" | "updates";

export function SettingsDialog({ open, updates }: SettingsDialogProps) {
  const [section, setSection] = useState<SettingsSection>("appearance");
  const theme = useAppStore((s) => s.theme);
  const setTheme = useAppStore((s) => s.setTheme);
  const zoom = useAppStore((s) => s.zoom);
  const setZoom = useAppStore((s) => s.setZoom);
  const zoomIn = useAppStore((s) => s.zoomIn);
  const zoomOut = useAppStore((s) => s.zoomOut);
  const resetZoom = useAppStore((s) => s.resetZoom);
  const toggleSettings = useAppStore((s) => s.toggleSettings);

  useEffect(() => {
    if (!open) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") toggleSettings();
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [open, toggleSettings]);

  useEffect(() => {
    const show = () => setSection("updates");
    window.addEventListener("hebe-show-updates", show);
    return () => window.removeEventListener("hebe-show-updates", show);
  }, []);

  const themes: {
    id: ThemePreference;
    label: string;
    previewBackground: string;
    previewInk: string;
  }[] = [
    {
      id: "system",
      label: "System",
      previewBackground: "linear-gradient(90deg, #ffffff 0 50%, #1e1e1e 50%)",
      previewInk: "#3b82f6",
    },
    { id: "light", label: "Light", previewBackground: "#ffffff", previewInk: "#1f2937" },
    { id: "dark", label: "Dark", previewBackground: "#1e1e1e", previewInk: "#f4f4f5" },
  ];

  if (!open) return null;

  return (
    <div className="settings-backdrop">
      <div className="settings-window" role="dialog" aria-modal="true" aria-label="Settings">
        <div className="settings-titlebar" data-tauri-drag-region>
          <button
            type="button"
            className="settings-close-button"
            aria-label="Close settings"
            onClick={toggleSettings}
          >
            <X size={11} strokeWidth={2.4} />
          </button>
          <span className="settings-title">Settings</span>
          <span className="settings-titlebar-spacer" />
        </div>

        <div className="settings-body">
          <nav className="settings-sidebar" aria-label="Settings sections">
            <button
              type="button"
              className={`settings-nav-item ${section === "appearance" ? "is-active" : ""}`}
              onClick={() => setSection("appearance")}
            >
              <Monitor size={15} />
              <span>Appearance</span>
            </button>
            <button
              type="button"
              className={`settings-nav-item ${section === "editor" ? "is-active" : ""}`}
              onClick={() => setSection("editor")}
            >
              <Type size={15} />
              <span>Editor</span>
            </button>
            <button
              type="button"
              className={`settings-nav-item ${section === "updates" ? "is-active" : ""}`}
              onClick={() => setSection("updates")}
            >
              Updates{updates.phase === "available" ? " •" : ""}
            </button>
          </nav>

          <div className="settings-pane">
            {section === "updates" ? (
              <>
                <header className="settings-pane-header">
                  <h2>Updates</h2>
                </header>
                <section className="settings-group update-settings">
                  <p>Hebe {updates.version}</p>
                  <label className="settings-row">
                    <span>Check for updates automatically</span>
                    <input
                      type="checkbox"
                      checked={updates.automatic}
                      onChange={(event) => updates.setAutomatic(event.target.checked)}
                    />
                  </label>
                  <p className="update-hint">
                    Updates are downloaded and installed only when you choose.
                  </p>
                  {updates.update && <p>Version {updates.update.version} is available.</p>}
                  {updates.update?.body && (
                    <pre className="update-notes">{updates.update.body}</pre>
                  )}
                  {updates.phase === "checking" && <p>Checking for updates…</p>}
                  {updates.phase === "idle" && updates.checked && <p>You’re up to date.</p>}
                  {updates.phase === "downloading" && (
                    <p>
                      Downloading…{" "}
                      {updates.progress.total
                        ? `${Math.round((updates.progress.received / updates.progress.total) * 100)}%`
                        : `${Math.round(updates.progress.received / 1024)} KB`}
                    </p>
                  )}
                  {updates.phase === "installing" && <p>Preparing update…</p>}
                  {updates.error && <p role="alert">{updates.error}</p>}
                  <div className="update-actions">
                    {updates.phase === "ready" ? (
                      <button type="button" onClick={() => void updates.restart()}>
                        Restart Hebe
                      </button>
                    ) : (
                      <>
                        <button
                          type="button"
                          disabled={["checking", "downloading", "installing"].includes(
                            updates.phase,
                          )}
                          onClick={() => void updates.checkNow()}
                        >
                          Check for Updates
                        </button>
                        {updates.update && (
                          <button
                            type="button"
                            disabled={["checking", "downloading", "installing"].includes(
                              updates.phase,
                            )}
                            onClick={() => void updates.install()}
                          >
                            Download and Install
                          </button>
                        )}
                      </>
                    )}
                  </div>
                  {updates.phase === "ready" && (
                    <p>Update installed. Restart to use the new version.</p>
                  )}
                </section>
              </>
            ) : section === "appearance" ? (
              <>
                <header className="settings-pane-header">
                  <h2>Appearance</h2>
                </header>
                <section className="settings-group">
                  <div className="settings-row settings-row-stacked">
                    <span className="settings-label">Theme</span>
                    <div className="settings-theme-grid">
                      {themes.map((t) => (
                        <button
                          key={t.id}
                          type="button"
                          onClick={() => setTheme(t.id)}
                          className={`settings-theme-option ${theme === t.id ? "is-active" : ""}`}
                        >
                          <span
                            className="settings-theme-preview"
                            style={{
                              background: t.previewBackground,
                              color: t.previewInk,
                            }}
                          >
                            <span />
                            <span />
                          </span>
                          <span>{t.label}</span>
                        </button>
                      ))}
                    </div>
                  </div>
                </section>
              </>
            ) : (
              <>
                <header className="settings-pane-header">
                  <h2>Editor</h2>
                </header>
                <section className="settings-group">
                  <div className="settings-row">
                    <span className="settings-label">Zoom</span>
                    <div className="settings-zoom-control">
                      <button
                        type="button"
                        className="settings-stepper-button"
                        onClick={zoomOut}
                        disabled={zoom <= 80}
                        aria-label="Zoom out"
                      >
                        <Minus size={14} />
                      </button>
                      <button
                        type="button"
                        className="settings-zoom-value"
                        onClick={resetZoom}
                        disabled={zoom === 100}
                        title="Actual size"
                      >
                        {zoom}%
                      </button>
                      <button
                        type="button"
                        className="settings-stepper-button"
                        onClick={zoomIn}
                        disabled={zoom >= 160}
                        aria-label="Zoom in"
                      >
                        <Plus size={14} />
                      </button>
                    </div>
                  </div>
                  <input
                    className="settings-range"
                    type="range"
                    min="80"
                    max="160"
                    step="10"
                    value={zoom}
                    aria-label="Editor zoom"
                    onChange={(event) => setZoom(Number(event.currentTarget.value))}
                  />
                </section>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
