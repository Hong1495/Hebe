// Adapted from Hong1495/Bee (MIT); see THIRD_PARTY_NOTICES.md.
import { useEffect, useRef, useState, type CSSProperties } from "react";
import { ArrowDown, X } from "lucide-react";
import { invoke, isTauri } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import type { useAppUpdates } from "../../lib/use-app-updates";
type Updater = ReturnType<typeof useAppUpdates>;
export function UpdateIndicator({
  updater,
  open,
  setOpen,
}: {
  updater: Updater;
  open: boolean;
  setOpen: (open: boolean) => void;
}) {
  const [position, setPosition] = useState<{ left: number; top: number; size: number } | null>(
    isTauri() ? null : { left: 91, top: 22, size: 12 },
  );
  const panel = useRef<HTMLDivElement>(null),
    button = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!updater.update || !isTauri()) return;
    let cancelled = false;
    let dispose: (() => void) | undefined;
    const measure = () =>
      void invoke<typeof position>("update_indicator_position")
        .then((value) => {
          if (!cancelled) setPosition(value);
        })
        .catch(() => {});
    measure();
    void getCurrentWindow()
      .onResized(measure)
      .then((fn) => {
        if (cancelled) fn();
        else dispose = fn;
      });
    return () => {
      cancelled = true;
      dispose?.();
    };
  }, [!!updater.update]);
  useEffect(() => {
    if (!open) return;
    panel.current?.querySelector<HTMLButtonElement>("button")?.focus();
    const dismiss = (e: PointerEvent) => {
      if (!panel.current?.contains(e.target as Node) && !button.current?.contains(e.target as Node))
        setOpen(false);
    };
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        setOpen(false);
        button.current?.focus();
      }
    };
    document.addEventListener("pointerdown", dismiss);
    document.addEventListener("keydown", key, true);
    return () => {
      document.removeEventListener("pointerdown", dismiss);
      document.removeEventListener("keydown", key, true);
    };
  }, [open, setOpen]);
  if (!updater.update) return null;
  const busy = ["checking", "downloading", "installing"].includes(updater.phase);
  const percent = updater.progress.total
    ? Math.min(100, Math.round((updater.progress.received / updater.progress.total) * 100))
    : null;
  return (
    <>
      {position && (
        <button
          ref={button}
          className="update-indicator"
          style={
            {
              left: position.left,
              top: position.top,
              width: position.size,
              height: position.size,
            } as CSSProperties
          }
          title={`Hebe ${updater.update.version} update available`}
          aria-label="View software update"
          aria-haspopup="dialog"
          aria-expanded={open}
          onClick={() => setOpen(!open)}
        >
          <ArrowDown aria-hidden="true" />
        </button>
      )}
      {open && (
        <div
          ref={panel}
          className="update-popover"
          role="dialog"
          aria-modal="false"
          aria-label="Software update"
          style={{
            left: Math.max(12, (position?.left ?? 91) - 12),
            top: (position?.top ?? 22) + (position?.size ?? 12) + 12,
          }}
        >
          <header>
            <strong>Hebe {updater.update.version}</strong>
            <button aria-label="Close update panel" onClick={() => setOpen(false)}>
              <X size={14} />
            </button>
          </header>
          <p className="update-subtitle">
            {updater.phase === "ready"
              ? "Update installed. Restart to finish."
              : "A new version is available"}
          </p>
          {updater.update.body && <div className="update-notes">{updater.update.body}</div>}
          {busy && (
            <div role="status">
              <progress
                max={100}
                value={updater.phase === "installing" ? 100 : (percent ?? undefined)}
              />
              <p>
                {updater.phase === "installing"
                  ? "Installing…"
                  : `Downloading${percent === null ? "…" : ` ${percent}%`}`}
              </p>
            </div>
          )}
          {updater.error && (
            <p className="settings-error" role="alert">
              {updater.error}
            </p>
          )}
          <button
            className="dark-button update-action"
            disabled={busy}
            onClick={() => void (updater.phase === "ready" ? updater.restart() : updater.install())}
          >
            {updater.phase === "ready"
              ? "Restart Hebe"
              : busy
                ? "Updating…"
                : updater.phase === "error"
                  ? "Retry download and install"
                  : "Download and install"}
          </button>
        </div>
      )}
    </>
  );
}
