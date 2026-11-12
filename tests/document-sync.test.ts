import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useAppStore } from "../src/stores/app-store";
import { startDocumentSync } from "../src/lib/document-sync";
const mocks = vi.hoisted(() => ({ read: vi.fn(), write: vi.fn() }));
vi.mock("../src/lib/ipc", () => ({ isTauriRuntime: () => true, readMarkdownFile: mocks.read, writeMarkdownFile: mocks.write }));
vi.mock("@tauri-apps/plugin-dialog", () => ({ save: vi.fn(), message: vi.fn() }));
let stop: () => void;
beforeEach(() => {
  vi.useFakeTimers(); vi.resetAllMocks();
  mocks.read.mockResolvedValue("original"); mocks.write.mockResolvedValue(undefined);
  useAppStore.setState({ tabs: [
    { id: "a", path: "/a.md", content: "edited a", savedContent: "original", dirty: true },
    { id: "b", path: "/b.md", content: "edited b", savedContent: "original", dirty: true },
  ], activeTabIndex: 0 });
});
afterEach(() => { stop?.(); vi.useRealTimers(); });
it("saves inactive tabs even while another tab keeps receiving input", async () => {
  stop = startDocumentSync();
  await vi.advanceTimersByTimeAsync(2000);
  useAppStore.getState().updateActiveContent("typing a");
  await vi.advanceTimersByTimeAsync(1000);
  expect(mocks.write).toHaveBeenCalledWith("/b.md", "edited b", "original");
  expect(mocks.write).not.toHaveBeenCalledWith("/a.md", expect.anything(), expect.anything());
  await vi.advanceTimersByTimeAsync(2000);
  expect(mocks.write).toHaveBeenCalledWith("/a.md", "typing a", "original");
});
it("blocks autosave on external conflict without losing local edits", async () => {
  mocks.read.mockResolvedValue("external");
  stop = startDocumentSync();
  await vi.advanceTimersByTimeAsync(4000);
  expect(mocks.write).not.toHaveBeenCalled();
  expect(useAppStore.getState().tabs[0]).toMatchObject({ content: "edited a", dirty: true, saveError: expect.stringContaining("CONFLICT:") });
});
it("reloads a clean inactive tab by identity", async () => {
  useAppStore.getState().setTabContent(1, "original");
  mocks.read.mockImplementation(async (path: string) => path === "/b.md" ? "external b" : "original");
  stop = startDocumentSync();
  await vi.advanceTimersByTimeAsync(1);
  expect(useAppStore.getState().tabs[1]).toMatchObject({ id: "b", content: "external b", dirty: false });
});
it("cancels scheduled writes after explicit discard", async () => {
  stop = startDocumentSync();
  useAppStore.getState().discardTabChanges(0);
  useAppStore.getState().discardTabChanges(1);
  await vi.advanceTimersByTimeAsync(4000);
  expect(mocks.write).not.toHaveBeenCalled();
});
it("defers disk reload and autosave while IME composition is active", async () => {
  useAppStore.setState((state) => ({ tabs: state.tabs.map((tab) => ({ ...tab, composing: true })) }));
  stop = startDocumentSync();
  await vi.advanceTimersByTimeAsync(4000);
  expect(mocks.read).not.toHaveBeenCalled();
  expect(mocks.write).not.toHaveBeenCalled();
  useAppStore.setState((state) => ({ tabs: state.tabs.map((tab) => ({ ...tab, composing: false })) }));
  await vi.advanceTimersByTimeAsync(3000);
  expect(mocks.write).toHaveBeenCalledTimes(2);
});

it("does not save or dirty clean documents when presentation preferences change", async () => {
  useAppStore.getState().setTabContent(0, "original");
  useAppStore.getState().setTabContent(1, "original");
  const tabs = useAppStore.getState().tabs;
  stop = startDocumentSync();
  useAppStore.getState().setZoom(160);
  useAppStore.getState().toggleCodeWrap();
  useAppStore.getState().toggleSourceMode();
  useAppStore.getState().toggleOutline();
  useAppStore.getState().setOutlineWidth(320);
  await vi.advanceTimersByTimeAsync(4000);
  expect(useAppStore.getState().tabs).toEqual(tabs);
  expect(mocks.write).not.toHaveBeenCalled();
});
