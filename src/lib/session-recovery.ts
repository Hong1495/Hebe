import type { TabState } from "../stores/app-store";

export const SESSION_KEY = "hebe.session.v1";

export function parseSession(
  raw: string | null,
): { tabs: TabState[]; activeTabIndex: number } | null {
  if (!raw) return null;
  const value = JSON.parse(raw);
  if (value.version !== 1 || !Array.isArray(value.tabs) || value.tabs.length === 0)
    throw new Error("Invalid recovery data");
  const ids = new Set<string>();
  for (const tab of value.tabs) {
    if (
      !tab ||
      typeof tab.id !== "string" ||
      ids.has(tab.id) ||
      (tab.path !== null && typeof tab.path !== "string") ||
      typeof tab.content !== "string" ||
      typeof tab.savedContent !== "string"
    )
      throw new Error("Invalid recovery tab");
    ids.add(tab.id);
  }
  return {
    tabs: value.tabs.map((tab: TabState) => ({
      ...tab,
      dirty: tab.content !== tab.savedContent,
      saveError: undefined,
      composing: false,
    })),
    activeTabIndex: Math.max(
      0,
      Math.min(
        value.tabs.length - 1,
        Number.isInteger(value.activeTabIndex) ? value.activeTabIndex : 0,
      ),
    ),
  };
}
