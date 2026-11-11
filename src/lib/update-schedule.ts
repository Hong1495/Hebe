// Adapted from Hong1495/Bee (MIT); see THIRD_PARTY_NOTICES.md.
// One scheduler per enabled preference. Retry failed checks quickly and check
// when returning to the app, without issuing requests on every focus event.
export function scheduleUpdateChecks(
  check: () => Promise<boolean | null>,
  env: {
    now: () => number;
    visible: () => boolean;
    later: (fn: () => void, ms: number) => ReturnType<typeof setTimeout>;
    cancel: (id: ReturnType<typeof setTimeout>) => void;
    listen: (event: "focus" | "online" | "visibilitychange", fn: () => void) => () => void;
  },
) {
  let stopped = false,
    running = false,
    lastAttempt = -Infinity,
    lastSuccess = -Infinity;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const clear = () => {
    if (timer !== undefined) env.cancel(timer);
    timer = undefined;
  };
  const plan = (ms: number) => {
    clear();
    if (!stopped) timer = env.later(() => void run(), ms);
  };
  const run = async () => {
    if (stopped || running) return;
    if (!env.visible()) {
      plan(60000);
      return;
    }
    running = true;
    lastAttempt = env.now();
    let success: boolean | null = false;
    try {
      success = await check();
    } catch {
      /* Schedule a retry instead of an unhandled rejection. */
    } finally {
      running = false;
    }
    if (stopped) return;
    if (success === true) lastSuccess = env.now();
    plan(success === true ? 30 * 60000 : 60000);
  };
  const resume = () => {
    if (env.visible() && env.now() - lastAttempt >= 60000 && env.now() - lastSuccess >= 5 * 60000)
      void run();
  };
  const remove = [
    env.listen("focus", resume),
    env.listen("online", resume),
    env.listen("visibilitychange", resume),
  ];
  plan(3000);
  return () => {
    stopped = true;
    clear();
    remove.forEach((fn) => fn());
  };
}
