export type DeadlineReason = "timeout" | "aborted";

export class DeadlineError extends Error {
  readonly reason: DeadlineReason;

  constructor(reason: DeadlineReason, message = reason) {
    super(message);
    this.name = "DeadlineError";
    this.reason = reason;
  }
}

export interface Deadline {
  readonly signal: AbortSignal;
  readonly expiresAt: number;
  remainingMs(): number;
  throwIfExpired(): void;
  dispose(): void;
}

export function createDeadline(totalMs: number, parentSignal?: AbortSignal): Deadline {
  const controller = new AbortController();
  const expiresAt = Date.now() + Math.max(0, totalMs);
  let timedOut = false;
  let timer: ReturnType<typeof setTimeout> | undefined;

  const abort = () => {
    if (!controller.signal.aborted) controller.abort();
  };
  const onParentAbort = () => abort();
  if (parentSignal?.aborted) {
    abort();
  } else if (parentSignal) {
    parentSignal.addEventListener("abort", onParentAbort, { once: true });
  }

  timer = setTimeout(() => {
    timedOut = true;
    abort();
  }, Math.max(0, totalMs));

  return {
    signal: controller.signal,
    expiresAt,
    remainingMs: () => Math.max(0, expiresAt - Date.now()),
    throwIfExpired: () => {
      if (timedOut) throw new DeadlineError("timeout");
      if (parentSignal?.aborted) throw new DeadlineError("aborted");
      if (controller.signal.aborted) throw new DeadlineError("timeout");
    },
    dispose: () => {
      if (timer) clearTimeout(timer);
      timer = undefined;
      parentSignal?.removeEventListener("abort", onParentAbort);
    },
  };
}

export async function withTimeout<T>(
  operation: (signal: AbortSignal) => Promise<T>,
  totalMs: number,
  parentSignal?: AbortSignal,
): Promise<T> {
  const deadline = createDeadline(totalMs, parentSignal);
  let onAbort: (() => void) | undefined;
  try {
    const result = operation(deadline.signal);
    const timeout = new Promise<never>((_, reject) => {
      onAbort = () => {
        reject(
          new DeadlineError(
            parentSignal?.aborted ? "aborted" : "timeout",
          ),
        );
      };
      if (deadline.signal.aborted) onAbort();
      else deadline.signal.addEventListener("abort", onAbort, { once: true });
    });
    return await Promise.race([result, timeout]);
  } finally {
    if (onAbort) deadline.signal.removeEventListener("abort", onAbort);
    deadline.dispose();
  }
}
