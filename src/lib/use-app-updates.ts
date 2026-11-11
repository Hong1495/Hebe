// Adapted from Hong1495/Bee (MIT); see THIRD_PARTY_NOTICES.md.
import { useCallback, useEffect, useRef, useState } from "react";
import { invoke, isTauri } from "@tauri-apps/api/core";
import { getVersion } from "@tauri-apps/api/app";
import { check, type Update } from "@tauri-apps/plugin-updater";
import { prepareWindowClose } from "./document-lifecycle";
import { listen } from "@tauri-apps/api/event";
import { useAppStore } from "../stores/app-store";
import { scheduleUpdateChecks } from "./update-schedule";

export type UpdatePhase =
  | "idle"
  | "checking"
  | "available"
  | "downloading"
  | "installing"
  | "ready"
  | "error";
const preference = "hebe-auto-update";
export function useAppUpdates() {
  const [automatic, setAutomatic] = useState(() => localStorage.getItem(preference) !== "false");
  const [version, setVersion] = useState("1.1.0");
  const [update, setUpdate] = useState<Update | null>(null);
  const [phase, setPhase] = useState<UpdatePhase>("idle");
  const [error, setError] = useState("");
  const [checked, setChecked] = useState(false);
  const [progress, setProgress] = useState({ received: 0, total: 0 });
  const resource = useRef<Update | null>(null);
  const busy = useRef(false);
  const installed = useRef(false);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    if (isTauri())
      void getVersion().then((v) => {
        if (mounted.current) setVersion(v);
      });
    return () => {
      mounted.current = false;
    };
  }, []);
  const checkNow = useCallback(async () => {
    if (!isTauri() || busy.current || installed.current) return null;
    busy.current = true;
    setPhase("checking");
    setError("");
    try {
      const next = await check({ timeout: 20000 });
      if (!mounted.current) {
        await next?.close();
        return null;
      }
      const old = resource.current;
      resource.current = next;
      setUpdate(next);
      setChecked(true);
      setPhase(next ? "available" : "idle");
      await old?.close();
      return true;
    } catch (e) {
      if (mounted.current) {
        setError(`Could not check for updates: ${String(e)}`);
        setPhase("error");
      }
      return false;
    } finally {
      busy.current = false;
    }
  }, []);
  useEffect(() => {
    localStorage.setItem(preference, String(automatic));
    if (!automatic || !isTauri()) return;
    return scheduleUpdateChecks(checkNow, {
      now: Date.now,
      visible: () => !document.hidden,
      later: (fn, ms) => window.setTimeout(fn, ms),
      cancel: (id) => window.clearTimeout(id),
      listen: (event, fn) => {
        const target = event === "visibilitychange" ? document : window;
        target.addEventListener(event, fn);
        return () => target.removeEventListener(event, fn);
      },
    });
  }, [automatic, checkNow]);
  const install = useCallback(async () => {
    const next = resource.current;
    if (!next || busy.current || installed.current) return;
    busy.current = true;
    setError("");
    setPhase("downloading");
    setProgress({ received: 0, total: 0 });
    let received = 0,
      total = 0,
      last = 0;
    try {
      await next.download(
        (event) => {
          if (event.event === "Started") {
            total = event.data.contentLength ?? 0;
          }
          if (event.event === "Progress") {
            received += event.data.chunkLength;
          }
          const now = performance.now();
          if (now - last > 100 || event.event !== "Progress") {
            last = now;
            setProgress({ received, total });
          }
        },
        { timeout: 120000 },
      );
      setPhase("installing");
      if (!(await prepareWindowClose())) {
        setPhase("available");
        return;
      }
      await next.install();
      installed.current = true;
      setPhase("ready");
    } catch (e) {
      setError(`Update failed: ${String(e)}`);
      setPhase("error");
    } finally {
      busy.current = false;
    }
  }, []);
  const restart = useCallback(async () => {
    if (!installed.current || busy.current) return;
    busy.current = true;
    try {
      if (await prepareWindowClose()) await invoke("restart_after_update");
    } catch (e) {
      setError(`Could not restart. Quit and reopen Hebe: ${String(e)}`);
    } finally {
      busy.current = false;
    }
  }, []);
  useEffect(() => {
    if (!isTauri()) return;
    let cancelled = false;
    let stop: (() => void) | undefined;
    void listen<string>("menu-action", (event) => {
      if (event.payload === "check-updates") {
        useAppStore.setState({ settingsVisible: true });
        window.dispatchEvent(new Event("hebe-show-updates"));
        void checkNow().then(() => {
          if (resource.current) {
            useAppStore.setState({ settingsVisible: false });
            window.dispatchEvent(new Event("hebe-show-update-popover"));
          }
        });
      }
    }).then((fn) => {
      if (cancelled) fn();
      else stop = fn;
    });
    return () => {
      cancelled = true;
      stop?.();
    };
  }, [checkNow]);
  return {
    automatic,
    setAutomatic,
    version,
    update,
    phase,
    error,
    checked,
    progress,
    checkNow,
    install,
    restart,
  };
}
