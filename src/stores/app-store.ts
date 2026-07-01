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
  focusMode: boolean;
  typewriterMode: boolean;
  theme: "light" | "dark" | "sepia";

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
  toggleFocusMode: () => void;
  toggleTypewriterMode: () => void;
  setTheme: (theme: "light" | "dark" | "sepia") => void;

  // Tab operations
  openFile: (path: string, content: string) => void;
  openNewTab: (content?: string) => void;
  closeTab: (index: number) => boolean; // returns false if blocked (dirty + cancelled)
  setActiveTab: (index: number) => void;
  updateActiveContent: (content: string) => void;
  setTabContent: (index: number, content: string) => void; // set content without marking dirty
  setTabDirty: (index: number, dirty: boolean) => void;
  moveTab: (from: number, to: number) => void;

  setFolderPath: (path: string | null) => void;
  addRecentFile: (path: string) => void;
}

export const useAppStore = create<AppState>((set, get) => ({
  sidebarVisible: true,
  settingsVisible: false,
  outlineVisible: true,
  focusMode: false,
  typewriterMode: false,
  theme: "light",
  tabs: [{ path: null, content: "", dirty: false }],
  activeTabIndex: 0,
  folderPath: null,
  recentFiles: [],

  currentFilePath: () => {
    const { tabs, activeTabIndex } = get();
    return tabs[activeTabIndex]?.path ?? null;
  },
  currentContent: () => {
    const { tabs, activeTabIndex } = get();
    return tabs[activeTabIndex]?.content ?? "";
  },

  toggleSidebar: () => set((s) => ({ sidebarVisible: !s.sidebarVisible })),
  toggleSettings: () =>
    set((s) => ({
      settingsVisible: !s.settingsVisible,
      sidebarVisible: s.settingsVisible ? true : false,
    })),
  toggleOutline: () => set((s) => ({ outlineVisible: !s.outlineVisible })),
  toggleFocusMode: () => set((s) => ({ focusMode: !s.focusMode })),
  toggleTypewriterMode: () => set((s) => ({ typewriterMode: !s.typewriterMode })),
  setTheme: (theme) => set({ theme }),

  openFile: (path, content) =>
    set((s) => {
      // Check if file is already open in a tab
      const existingIdx = s.tabs.findIndex((t) => t.path === path);
      if (existingIdx >= 0) {
        return { activeTabIndex: existingIdx };
      }
      // Replace placeholder tab if it's untouched
      const placeholder = s.tabs[0];
      if (s.tabs.length === 1 && !placeholder.path && !placeholder.dirty) {
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
      const newIndex = Math.min(index, newTabs.length - 1);
      return { tabs: newTabs, activeTabIndex: newIndex };
    });
    return true;
  },

  setActiveTab: (index) => set({ activeTabIndex: index }),
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
      return { recentFiles: [path, ...filtered].slice(0, 10) };
    }),
}));
