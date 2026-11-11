import { useAppStore } from "../stores/app-store";
import { isTabSaving, saveTabAt, setTabSaveError } from "./document-lifecycle";
import { isTauriRuntime, readMarkdownFile } from "./ipc";

export function startDocumentSync() {
  if (!isTauriRuntime()) return () => {};
  let stopped = false;
  let checking = false;
  const timers = new Map<string, { content: string; timer: ReturnType<typeof setTimeout> }>();
  const schedule = () => {
    const { tabs } = useAppStore.getState();
    for (const [id, pending] of timers) {
      const tab = tabs.find((item) => item.id === id);
      if (!tab || !tab.dirty || tab.composing || tab.saveError || tab.content !== pending.content) {
        clearTimeout(pending.timer);
        timers.delete(id);
      }
    }
    for (const tab of tabs) {
      if (!tab.path || !tab.dirty || tab.composing || tab.saveError || timers.has(tab.id)) continue;
      const timer = setTimeout(async () => {
        timers.delete(tab.id);
        if (stopped) return;
        const index = useAppStore.getState().tabs.findIndex((item) => item.id === tab.id);
        if (index >= 0) await saveTabAt(index, { background: true });
        if (!stopped) schedule();
      }, 3000);
      timers.set(tab.id, { content: tab.content, timer });
    }
  };
  const check = async () => {
    if (checking || stopped) return;
    checking = true;
    try {
      for (const snapshot of useAppStore.getState().tabs) {
        if (!snapshot.path || snapshot.composing || isTabSaving(snapshot.id)) continue;
        try {
          const disk = await readMarkdownFile(snapshot.path);
          if (stopped || isTabSaving(snapshot.id)) continue;
          const { tabs, setTabContent } = useAppStore.getState();
          const index = tabs.findIndex((tab) => tab.id === snapshot.id);
          const latest = tabs[index];
          if (
            !latest ||
            latest.composing ||
            latest.path !== snapshot.path ||
            latest.savedContent !== snapshot.savedContent
          )
            continue;
          if (disk !== latest.savedContent) {
            if (latest.dirty)
              setTabSaveError(
                latest.id,
                "CONFLICT: The file changed outside Hebe. Your edits are preserved.",
              );
            else setTabContent(index, disk);
          }
        } catch (error) {
          if (!stopped && !isTabSaving(snapshot.id))
            setTabSaveError(snapshot.id, `Cannot read the disk file: ${String(error)}`);
        }
      }
    } finally {
      checking = false;
    }
  };
  const unsubscribe = useAppStore.subscribe(schedule);
  schedule();
  void check();
  const poll = setInterval(() => void check(), 2000);
  return () => {
    stopped = true;
    unsubscribe();
    clearInterval(poll);
    for (const pending of timers.values()) clearTimeout(pending.timer);
  };
}
