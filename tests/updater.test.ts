import { act, create } from "react-test-renderer";
import { createElement } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useAppStore } from "../src/stores/app-store";
import { useAppUpdates } from "../src/lib/use-app-updates";
const mock = vi.hoisted(() => ({check:vi.fn(),prepare:vi.fn(),invoke:vi.fn(),listen:vi.fn()}));
vi.mock("@tauri-apps/api/core",()=>({isTauri:()=>true,invoke:mock.invoke}));
vi.mock("@tauri-apps/api/app",()=>({getVersion:async()=>"1.1.1"}));
vi.mock("@tauri-apps/api/event",()=>({listen:mock.listen}));
vi.mock("@tauri-apps/plugin-updater",()=>({check:mock.check}));
vi.mock("../src/lib/document-lifecycle",()=>({prepareWindowClose:mock.prepare}));
vi.mock("../src/lib/update-schedule",()=>({scheduleUpdateChecks:()=>()=>{}}));
beforeEach(()=>{
  vi.resetAllMocks();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT",true);
  vi.stubGlobal("localStorage",{getItem:()=>"false",setItem:vi.fn()});
  mock.prepare.mockResolvedValue(true);
  mock.listen.mockResolvedValue(() => {});
});
describe("signed update flow",()=>{
  it.each(["latest", "available", "offline"])("menu checks stay in the background: %s",async(result)=>{
    let state!:ReturnType<typeof useAppUpdates>;
    function Host(){state=useAppUpdates();return null;}
    const dispatchEvent=vi.fn();
    vi.stubGlobal("window",{dispatchEvent});
    const update={version:"1.2.0",close:vi.fn(),download:vi.fn(),install:vi.fn()};
    if(result === "offline")mock.check.mockRejectedValue(new Error("offline"));
    else mock.check.mockResolvedValue(result === "available" ? update : null);
    let root!:ReturnType<typeof create>;
    await act(async()=>{root=create(createElement(Host));});
    const onMenu=mock.listen.mock.calls.find(([name])=>name === "menu-action")![1];
    for(const settingsVisible of [false,true]){
      useAppStore.setState({settingsVisible});
      await act(async()=>{onMenu({payload:"check-updates"});});
      expect(useAppStore.getState().settingsVisible).toBe(settingsVisible);
      expect(dispatchEvent).not.toHaveBeenCalled();
    }
    expect(mock.check).toHaveBeenCalledTimes(2);
    expect(state.phase).toBe(result === "available" ? "available" : result === "offline" ? "error" : "idle");
    expect(update.download).not.toHaveBeenCalled();
    expect(update.install).not.toHaveBeenCalled();
    await act(async()=>root.unmount());
    vi.unstubAllGlobals();
  });
  it("checks without installing, supports retry, respects cancellation and guards restart",async()=>{
    let state!:ReturnType<typeof useAppUpdates>;
    function Host(){state=useAppUpdates();return null;}
    let root!:ReturnType<typeof create>;
    await act(async()=>{root=create(createElement(Host));});
    const update={version:"1.2.0",body:"Notes",close:vi.fn(),download:vi.fn().mockResolvedValue(undefined),install:vi.fn().mockResolvedValue(undefined)};
    mock.check.mockResolvedValue(update);
    await act(async()=>{await state.checkNow();});
    expect(state.phase).toBe("available");
    expect(update.download).not.toHaveBeenCalled();
    mock.prepare.mockResolvedValue(false);
    await act(async()=>{await state.install();});
    expect(update.install).not.toHaveBeenCalled();
    expect(state.phase).toBe("available");
    mock.prepare.mockResolvedValue(true);
  mock.listen.mockResolvedValue(() => {});
    update.download.mockRejectedValueOnce(new Error("offline"));
    await act(async()=>{await state.install();});
    expect(state.phase).toBe("error");
    await act(async()=>{await state.install();});
    expect(state.phase).toBe("ready");
    expect(update.install).toHaveBeenCalledTimes(1);
    mock.prepare.mockResolvedValue(false);
    await act(async()=>{await state.restart();});
    expect(mock.invoke).not.toHaveBeenCalled();
    mock.prepare.mockResolvedValue(true);
  mock.listen.mockResolvedValue(() => {});
    await act(async()=>{await state.restart();});
    expect(mock.invoke).toHaveBeenCalledWith("restart_after_update");
    await act(async()=>root.unmount());
  });
});
