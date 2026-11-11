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
    expect(mocks.write).toHaveBeenCalledWith("/tmp/a.md", "edited", "original");
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

it("advances the saved baseline while preserving newer edits", async () => {
  mocks.write.mockImplementationOnce(async () => useAppStore.getState().updateActiveContent("newer"));
  expect(await saveTabAt(0)).toBe(true);
  expect(useAppStore.getState().tabs[0]).toMatchObject({ content: "newer", savedContent: "edited", dirty: true });
  await saveTabAt(0);
  expect(mocks.write).toHaveBeenLastCalledWith("/tmp/a.md", "newer", "edited");
});
it("attaches a newly saved path even when typing continues during the dialog", async () => {
  useAppStore.setState({ tabs: [{ id: "draft", path: null, content: "draft", savedContent: "", dirty: true }] });
  mocks.save.mockImplementation(async () => { useAppStore.getState().updateActiveContent("continued"); return "/tmp/new.md"; });
  await saveTabAt(0);
  expect(useAppStore.getState().tabs[0]).toMatchObject({ path: "/tmp/new.md", content: "continued", savedContent: "draft", dirty: true });
});
it("exposes background failures without marking the document saved", async () => {
  mocks.write.mockRejectedValue(new Error("CONFLICT: changed"));
  expect(await saveTabAt(0, { background: true })).toBe(false);
  expect(useAppStore.getState().tabs[0]).toMatchObject({ dirty: true, savedContent: "original", saveError: "CONFLICT: changed" });
  expect(mocks.message).not.toHaveBeenCalled();
});
it("serializes concurrent saves of the same document", async () => {
  let release!: () => void;
  mocks.write.mockImplementationOnce(() => new Promise<void>((resolve) => { release = resolve; }));
  const first = saveTabAt(0);
  useAppStore.getState().updateActiveContent("newer");
  const second = saveTabAt(0);
  expect(mocks.write).toHaveBeenCalledTimes(1);
  release();
  await Promise.all([first, second]);
  expect(mocks.write).toHaveBeenLastCalledWith("/tmp/a.md", "newer", "edited");
});
