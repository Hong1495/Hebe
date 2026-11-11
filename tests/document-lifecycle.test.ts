import { beforeEach, describe, expect, it, vi } from "vitest";
import { useAppStore } from "../src/stores/app-store";
import { closeTabWithPrompt, prepareWindowClose, saveTabAt } from "../src/lib/document-lifecycle";
const mocks = vi.hoisted(() => ({ message: vi.fn(), save: vi.fn(), write: vi.fn() }));
vi.mock("@tauri-apps/plugin-dialog", () => ({ message: mocks.message, save: mocks.save }));
vi.mock("../src/lib/ipc", () => ({ isTauriRuntime: () => true, writeMarkdownFile: mocks.write }));
beforeEach(() => {
  vi.resetAllMocks();
  useAppStore.setState({ tabs: [{ id: "a", path: "/tmp/a.md", content: "edited", savedContent: "original", dirty: true }], activeTabIndex: 0 });
  mocks.write.mockResolvedValue(undefined);
});
describe("document lifecycle", () => {
  it("blocks quit and restart when a save prompt is cancelled", async () => {
    mocks.message.mockResolvedValue("Cancel");
    expect(await prepareWindowClose()).toBe(false);
    expect(mocks.write).not.toHaveBeenCalled();
    expect(useAppStore.getState().tabs[0].content).toBe("edited");
  });
  it("saves dirty documents before approving quit", async () => {
    mocks.message.mockResolvedValue("Save");
    expect(await prepareWindowClose()).toBe(true);
    expect(mocks.write).toHaveBeenCalledWith("/tmp/a.md", "edited");
    expect(useAppStore.getState().tabs[0].dirty).toBe(false);
  });
  it("keeps a document open when saving fails", async () => {
    mocks.message.mockResolvedValue("Save");
    mocks.write.mockRejectedValue(new Error("disk full"));
    expect(await closeTabWithPrompt(0)).toBe(false);
    expect(useAppStore.getState().tabs[0].dirty).toBe(true);
  });
  it("tracks a save by identity while tabs are reordered", async () => {
    useAppStore.getState().openNewTab();
    mocks.write.mockImplementation(async () => useAppStore.getState().moveTab(0, 1));
    expect(await saveTabAt(0)).toBe(true);
    expect(useAppStore.getState().tabs[1]).toMatchObject({id:"a", dirty:false});
  });
  it("does not clear dirty state when content changes during saving", async () => {
    mocks.write.mockImplementation(async () => useAppStore.getState().updateActiveContent("newer"));
    mocks.message.mockResolvedValue("Save");
    expect(await prepareWindowClose()).toBe(false);
    expect(useAppStore.getState().tabs[0].content).toBe("newer");
  });
  it("discards explicitly and preserves the last saved content", async () => {
    mocks.message.mockResolvedValue("Discard");
    expect(await prepareWindowClose()).toBe(true);
    expect(useAppStore.getState().tabs[0].content).toBe("original");
  });
});
