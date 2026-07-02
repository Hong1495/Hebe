import { create } from "zustand";

interface TabState {
  path: string | null; // null = unsaved new document
  content: string;
  dirty: boolean;
}

interface AppState {
  sidebarVisible: boolean;
  settingsVisible: boolean;
  outlineVisible: boolean;
  sidebarWidth: number;
  outlineWidth: number;
  focusMode: boolean;
  typewriterMode: boolean;
  theme: "light" | "dark" | "sepia";
  zoom: number;

  // Tab management
  tabs: TabState[];
  activeTabIndex: number;

  // Derived helpers
  currentFilePath: () => string | null;
  currentContent: () => string;

  // File management
  folderPath: string | null;
  recentFiles: string[];

  toggleSidebar: () => void;
  toggleSettings: () => void;
  toggleOutline: () => void;
  setSidebarWidth: (width: number) => void;
  setOutlineWidth: (width: number) => void;
  toggleFocusMode: () => void;
  toggleTypewriterMode: () => void;
  setTheme: (theme: "light" | "dark" | "sepia") => void;
  setZoom: (zoom: number) => void;
  resetZoom: () => void;
  zoomIn: () => void;
  zoomOut: () => void;

  // Tab operations
  openFile: (path: string, content: string) => void;
  openNewTab: (content?: string) => void;
  closeTab: (index: number) => boolean; // returns false if blocked (dirty + cancelled)
  setActiveTab: (index: number) => void;
  updateActiveContent: (content: string) => void;
  setTabContent: (index: number, content: string) => void; // set content without marking dirty
  setTabDirty: (index: number, dirty: boolean) => void;
  setActiveTabPath: (path: string) => void;
  moveTab: (from: number, to: number) => void;

  setFolderPath: (path: string | null) => void;
  addRecentFile: (path: string) => void;
  setRecentFiles: (paths: string[]) => void;
}

const readStoredTheme = (): AppState["theme"] => {
  if (typeof localStorage === "undefined") return "light";
  const value = localStorage.getItem("hebe.theme");
  return value === "dark" || value === "sepia" || value === "light" ? value : "light";
};

const readStoredRecentFiles = (): string[] => {
  if (typeof localStorage === "undefined") return [];
  try {
    const value = JSON.parse(localStorage.getItem("hebe.recentFiles") ?? "[]");
    return Array.isArray(value) ? value.filter((item) => typeof item === "string") : [];
  } catch {
    return [];
  }
};

const readStoredZoom = (): number => {
  if (typeof localStorage !== "undefined") {
    localStorage.removeItem("hebe.zoom");
    localStorage.removeItem("hebe.zoom.v2");
  }
  return 100;
};

export const useAppStore = create<AppState>((set, get) => ({
  sidebarVisible: false,
  settingsVisible: false,
  outlineVisible: false,
  sidebarWidth: 256,
  outlineWidth: 232,
  focusMode: false,
  typewriterMode: false,
  theme: readStoredTheme(),
  zoom: readStoredZoom(),
  tabs: [{ path: null, content: "", dirty: false }],
  activeTabIndex: 0,
  folderPath: null,
  recentFiles: readStoredRecentFiles(),

  currentFilePath: () => {
    const { tabs, activeTabIndex } = get();
    return tabs[activeTabIndex]?.path ?? null;
  },
  currentContent: () => {
    const { tabs, activeTabIndex } = get();
    return tabs[activeTabIndex]?.content ?? "";
  },

  toggleSidebar: () => set((s) => ({ sidebarVisible: !s.sidebarVisible })),
  toggleSettings: () => set((s) => ({ settingsVisible: !s.settingsVisible })),
  toggleOutline: () => set((s) => ({ outlineVisible: !s.outlineVisible })),
  setSidebarWidth: (width) => set({ sidebarWidth: Math.min(420, Math.max(180, width)) }),
  setOutlineWidth: (width) => set({ outlineWidth: Math.min(360, Math.max(180, width)) }),
  toggleFocusMode: () => set((s) => ({ focusMode: !s.focusMode })),
  toggleTypewriterMode: () => set((s) => ({ typewriterMode: !s.typewriterMode })),
  setTheme: (theme) => {
    if (typeof localStorage !== "undefined") localStorage.setItem("hebe.theme", theme);
    set({ theme });
  },
  setZoom: (zoom) => {
    const nextZoom = Math.min(160, Math.max(80, Math.round(zoom / 10) * 10));
    set({ zoom: nextZoom });
  },
  resetZoom: () => get().setZoom(100),
  zoomIn: () => get().setZoom(get().zoom + 10),
  zoomOut: () => get().setZoom(get().zoom - 10),

  openFile: (path, content) =>
    set((s) => {
      const existingIdx = s.tabs.findIndex((t) => t.path === path);
      if (existingIdx >= 0) {
        return { activeTabIndex: existingIdx };
      }

      const activeTab = s.tabs[s.activeTabIndex];
      if (activeTab && !activeTab.path && !activeTab.dirty && !activeTab.content) {
        return {
          tabs: s.tabs.map((tab, index) =>
            index === s.activeTabIndex ? { path, content, dirty: false } : tab,
          ),
        };
      }

      const firstTab = s.tabs[0];
      if (s.tabs.length === 1 && !firstTab.path && !firstTab.dirty) {
        return {
          tabs: [{ path, content, dirty: false }],
          activeTabIndex: 0,
        };
      }
      return {
        tabs: [...s.tabs, { path, content, dirty: false }],
        activeTabIndex: s.tabs.length,
      };
    }),

  openNewTab: (content = "") =>
    set((s) => ({
      tabs: [...s.tabs, { path: null, content, dirty: false }],
      activeTabIndex: s.tabs.length,
    })),

  closeTab: (index) => {
    const s = get();
    const tab = s.tabs[index];
    if (tab?.dirty) {
      const confirmed = confirm("This tab has unsaved changes. Close anyway?");
      if (!confirmed) return false;
    }
    set((s) => {
      if (s.tabs.length <= 1) {
        return { tabs: [{ path: null, content: "", dirty: false }], activeTabIndex: 0 };
      }
      const newTabs = s.tabs.filter((_, i) => i !== index);
      const newIndex =
        index === s.activeTabIndex
          ? Math.min(index, newTabs.length - 1)
          : index < s.activeTabIndex
            ? s.activeTabIndex - 1
            : s.activeTabIndex;
      return { tabs: newTabs, activeTabIndex: newIndex };
    });
    return true;
  },

  setActiveTab: (index) =>
    set((s) => ({
      activeTabIndex: Math.min(Math.max(index, 0), s.tabs.length - 1),
    })),
  updateActiveContent: (content) =>
    set((s) => ({
      tabs: s.tabs.map((t, i) => (i === s.activeTabIndex ? { ...t, content, dirty: true } : t)),
    })),
  setTabContent: (index, content) =>
    set((s) => ({
      tabs: s.tabs.map((t, i) => (i === index ? { ...t, content } : t)),
    })),
  setTabDirty: (index, dirty) =>
    set((s) => ({
      tabs: s.tabs.map((t, i) => (i === index ? { ...t, dirty } : t)),
    })),
  setActiveTabPath: (path) =>
    set((s) => ({
      tabs: s.tabs.map((t, i) => (i === s.activeTabIndex ? { ...t, path, dirty: false } : t)),
    })),
  moveTab: (from, to) =>
    set((s) => {
      const newTabs = [...s.tabs];
      const [removed] = newTabs.splice(from, 1);
      newTabs.splice(to, 0, removed);
      const newIndex =
        s.activeTabIndex === from
          ? to
          : s.activeTabIndex > from && s.activeTabIndex <= to
            ? s.activeTabIndex - 1
            : s.activeTabIndex < from && s.activeTabIndex >= to
              ? s.activeTabIndex + 1
              : s.activeTabIndex;
      return { tabs: newTabs, activeTabIndex: newIndex };
    }),

  setFolderPath: (path) => set({ folderPath: path }),
  addRecentFile: (path) =>
    set((s) => {
      const filtered = s.recentFiles.filter((f) => f !== path);
      const recentFiles = [path, ...filtered].slice(0, 10);
      if (typeof localStorage !== "undefined") {
        localStorage.setItem("hebe.recentFiles", JSON.stringify(recentFiles));
      }
      return { recentFiles };
    }),
  setRecentFiles: (paths) => {
    const recentFiles = paths.slice(0, 10);
    if (typeof localStorage !== "undefined") {
      localStorage.setItem("hebe.recentFiles", JSON.stringify(recentFiles));
    }
    set({ recentFiles });
  },
}));
