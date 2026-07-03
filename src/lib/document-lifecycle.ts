import { message, save } from "@tauri-apps/plugin-dialog";
import { type TabState, useAppStore } from "../stores/app-store";
import { isTauriRuntime, writeMarkdownFile } from "./ipc";
import { basename } from "./path";

const MARKDOWN_FILTERS = [{ name: "Markdown", extensions: ["md", "markdown", "mdx"] }];

type DirtyChoice = "save" | "discard" | "cancel";

export async function saveTabAt(index: number): Promise<boolean> {
  if (!isTauriRuntime()) return false;

  const tab = useAppStore.getState().tabs[index];
  if (!tab) return true;

  try {
    if (tab.path) {
      await writeMarkdownFile(tab.path, tab.content);
      const latest = useAppStore.getState().tabs[index];
      if (latest?.path === tab.path && latest.content === tab.content) {
        useAppStore.getState().markTabSaved(index);
      }
      return true;
    }

    const savePath = await save({
      filters: MARKDOWN_FILTERS,
      defaultPath: suggestedUntitledName(tab),
    });
    if (!savePath) return false;

    await writeMarkdownFile(savePath, tab.content);
    const latest = useAppStore.getState().tabs[index];
    if (latest?.content === tab.content) {
      useAppStore.getState().markTabSaved(index, savePath);
      useAppStore.getState().addRecentFile(savePath);
    }
    return true;
  } catch (error) {
    await showSaveError(error);
    return false;
  }
}

export async function saveActiveTab(): Promise<boolean> {
  return saveTabAt(useAppStore.getState().activeTabIndex);
}

export async function closeTabWithPrompt(index: number): Promise<boolean> {
  const tab = useAppStore.getState().tabs[index];
  if (!tab) return true;

  if (tab.dirty) {
    const choice = await askDirtyChoice(tab);
    if (choice === "cancel") return false;
    if (choice === "save") {
      if (!(await saveTabAt(index))) return false;
      if (useAppStore.getState().tabs[index]?.dirty) return false;
    }
  }

  useAppStore.getState().closeTab(index);
  return true;
}

export async function prepareWindowClose(): Promise<boolean> {
  let index = 0;
  while (index < useAppStore.getState().tabs.length) {
    const tab = useAppStore.getState().tabs[index];
    if (!tab?.dirty) {
      index += 1;
      continue;
    }

    useAppStore.getState().setActiveTab(index);
    const choice = await askDirtyChoice(tab);
    if (choice === "cancel") return false;
    if (choice === "save") {
      if (!(await saveTabAt(index))) return false;
      if (useAppStore.getState().tabs[index]?.dirty) return false;
    }
    if (choice === "discard") useAppStore.getState().discardTabChanges(index);
    index += 1;
  }

  return true;
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
