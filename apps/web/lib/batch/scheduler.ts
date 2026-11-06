/**
 * A loop that looks again after the interval the settings give *now* (verikora#240): an administrator changing it, or turning it
 * off (0), is obeyed at the next look, no restart. Never two runs at once, never keeps the process alive, one failure never ends it.
 */
export interface Scheduler {
  stop(): void;
}

export function startScheduler(options: {
  seconds: () => Promise<number>;
  run: () => Promise<unknown>;
  onError?: (error: unknown) => void;
  idleSeconds?: number;
}): Scheduler {
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  // @fixed: how often an off switch is looked at again — the loop still reads the setting, it just sleeps meanwhile
  const idle = options.idleSeconds ?? 60;
  const next = async (): Promise<void> => {
    let seconds = 0;
    try {
      seconds = await options.seconds();
    } catch (error) {
      options.onError?.(error);
    }
    if (stopped) return;
    timer = setTimeout(
      async () => {
        if (stopped) return;
        if (seconds > 0) {
          try {
            await options.run();
          } catch (error) {
            options.onError?.(error);
          }
        }
        void next();
      },
      (seconds > 0 ? seconds : idle) * 1000,
    );
    timer.unref?.();
  };
  void next();
  return {
    stop() {
      stopped = true;
      if (timer) clearTimeout(timer);
    },
  };
}
