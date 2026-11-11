import { message, save } from "@tauri-apps/plugin-dialog";
import { type TabState, useAppStore } from "../stores/app-store";
import { isTauriRuntime, writeMarkdownFile } from "./ipc";
import { basename } from "./path";

const MARKDOWN_FILTERS = [{ name: "Markdown", extensions: ["md", "markdown", "mdx"] }];

type DirtyChoice = "save" | "discard" | "cancel";

const pendingSaves = new Map<string, Promise<boolean>>();
export const isTabSaving = (id: string) => pendingSaves.has(id);

export function setTabSaveError(id: string, error?: string) {
  useAppStore.setState((state) => ({
    tabs: state.tabs.map((tab) => (tab.id === id ? { ...tab, saveError: error } : tab)),
  }));
}

export async function saveTabAt(
  index: number,
  options: { background?: boolean; copy?: boolean; overwrite?: boolean } = {},
): Promise<boolean> {
  if (!isTauriRuntime() || (options.background && lifecycleBusy)) return false;
  const id = useAppStore.getState().tabs[index]?.id;
  if (!id) return true;
  const previous = pendingSaves.get(id);
  if (previous) {
    await previous;
    const nextIndex = tabIndex(id);
    if (nextIndex < 0) return true;
    return saveTabAt(nextIndex, options);
  }
  const operation = saveSnapshot(id, options);
  pendingSaves.set(id, operation);
  try {
    return await operation;
  } finally {
    pendingSaves.delete(id);
  }
}

async function saveSnapshot(
  id: string,
  options: { background?: boolean; copy?: boolean; overwrite?: boolean },
): Promise<boolean> {
  const tab = useAppStore.getState().tabs.find((item) => item.id === id);
  if (!tab) return true;
  try {
    let path = options.copy ? null : tab.path;
    if (!path) {
      if (options.background) return false;
      path = await save({ filters: MARKDOWN_FILTERS, defaultPath: suggestedUntitledName(tab) });
      if (!path) return false;
    }
    await writeMarkdownFile(
      path,
      tab.content,
      path === tab.path && !options.overwrite ? tab.savedContent : undefined,
    );
    const index = tabIndex(id);
    if (index >= 0) {
      useAppStore.getState().markTabSaved(index, path, tab.content);
      useAppStore.getState().addRecentFile(path);
    }
    return true;
  } catch (error) {
    setTabSaveError(id, error instanceof Error ? error.message : String(error));
    if (!options.background) await showSaveError(error);
    return false;
  }
}

export async function saveActiveTab(): Promise<boolean> {
  return saveTabAt(useAppStore.getState().activeTabIndex);
}

let lifecycleBusy = false;

function tabIndex(id: string): number {
  return useAppStore.getState().tabs.findIndex((tab) => tab.id === id);
}

async function settleTab(id: string): Promise<boolean> {
  await pendingSaves.get(id);
  let index = tabIndex(id);
  const tab = useAppStore.getState().tabs[index];
  if (!tab?.dirty) return true;
  useAppStore.getState().setActiveTab(index);
  const choice = await askDirtyChoice(tab);
  if (choice === "cancel") return false;
  await pendingSaves.get(id);
  index = tabIndex(id);
  if (index < 0) return true;
  if (choice === "save") {
    if (!(await saveTabAt(index))) return false;
    return !useAppStore.getState().tabs[tabIndex(id)]?.dirty;
  }
  useAppStore.getState().discardTabChanges(index);
  return true;
}

export async function closeTabWithPrompt(index: number): Promise<boolean> {
  if (lifecycleBusy) return false;
  const tab = useAppStore.getState().tabs[index];
  if (!tab) return true;
  lifecycleBusy = true;
  try {
    if (!(await settleTab(tab.id))) return false;
    const currentIndex = tabIndex(tab.id);
    if (currentIndex >= 0) useAppStore.getState().closeTab(currentIndex);
    return true;
  } finally {
    lifecycleBusy = false;
  }
}

export async function prepareWindowClose(): Promise<boolean> {
  if (lifecycleBusy) return false;
  lifecycleBusy = true;
  try {
    for (const tab of useAppStore.getState().tabs) {
      if (!(await settleTab(tab.id))) return false;
    }
    // Edits or a new tab may have arrived while a native dialog was open.
    return !useAppStore.getState().tabs.some((tab) => tab.dirty);
  } finally {
    lifecycleBusy = false;
  }
}

async function askDirtyChoice(tab: TabState): Promise<DirtyChoice> {
  const title = tabTitle(tab);
  if (!isTauriRuntime()) {
    return window.confirm(`Discard unsaved changes to "${title}"?`) ? "discard" : "cancel";
  }

  const result = await message(`Save changes to "${title}" before closing?`, {
    title: "Unsaved Changes",
    kind: "warning",
    buttons: { yes: "Save", no: "Discard", cancel: "Cancel" },
  });

  if (result === "Save" || result === "Yes") return "save";
  if (result === "Discard" || result === "No") return "discard";
  return "cancel";
}

function tabTitle(tab: TabState): string {
  if (tab.path) return basename(tab.path);
  return tab.content.trim() ? "Untitled" : "New Tab";
}

function suggestedUntitledName(tab: TabState): string {
  const firstHeading = tab.content.match(/^#\s+(.+)$/m)?.[1]?.trim();
  const baseName = firstHeading ? sanitizeFileStem(firstHeading) : "untitled";
  return `${baseName || "untitled"}.md`;
}

function sanitizeFileStem(value: string): string {
  return value
    .replace(/[\\/:*?"<>|]+/g, "-")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80);
}

async function showSaveError(error: unknown): Promise<void> {
  const detail = error instanceof Error ? error.message : String(error);
  await message(`Could not save the document.\n\n${detail}`, {
    title: "Save Failed",
    kind: "error",
  });
}
