import { afterEach, describe, expect, it, vi } from "vitest";
import { scheduleUpdateChecks } from "../src/lib/update-schedule";
afterEach(() => vi.useRealTimers());
describe("update scheduling", () => {
  it("defers hidden checks, retries failures and cancels all scheduled work", async () => {
    vi.useFakeTimers();
    let visible = false;
    const check = vi.fn().mockResolvedValueOnce(false).mockResolvedValue(true);
    const remove = vi.fn();
    const stop = scheduleUpdateChecks(check, { now:Date.now, visible:()=>visible, later:setTimeout, cancel:clearTimeout, listen:()=>remove });
    await vi.advanceTimersByTimeAsync(3000);
    expect(check).not.toHaveBeenCalled();
    visible = true;
    await vi.advanceTimersByTimeAsync(60000);
    expect(check).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(60000);
    expect(check).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(30*60000);
    expect(check).toHaveBeenCalledTimes(3);
    stop();
    await vi.advanceTimersByTimeAsync(30*60000);
    expect(check).toHaveBeenCalledTimes(3);
    expect(remove).toHaveBeenCalledTimes(3);
  });
});
