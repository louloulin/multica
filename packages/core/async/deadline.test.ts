import { afterEach, describe, expect, it, vi } from "vitest";
import { DeadlineError, createDeadline, withTimeout } from "./deadline";

describe("createDeadline", () => {
  afterEach(() => vi.useRealTimers());

  it("aborts after the requested duration", () => {
    vi.useFakeTimers();
    const deadline = createDeadline(100);
    vi.advanceTimersByTime(100);
    expect(deadline.signal.aborted).toBe(true);
    expect(() => deadline.throwIfExpired()).toThrowError(
      expect.objectContaining({ reason: "timeout" }),
    );
    deadline.dispose();
  });

  it("preserves parent cancellation", () => {
    const parent = new AbortController();
    const deadline = createDeadline(1000, parent.signal);
    parent.abort();
    expect(() => deadline.throwIfExpired()).toThrowError(
      expect.objectContaining({ reason: "aborted" }),
    );
    deadline.dispose();
  });

  it("cleans up the timer after completion", async () => {
    vi.useFakeTimers();
    const clearTimeoutSpy = vi.spyOn(globalThis, "clearTimeout");
    await withTimeout(async () => "ok", 1000);
    expect(clearTimeoutSpy).toHaveBeenCalled();
  });

  it("rejects a pending operation at the deadline", async () => {
    vi.useFakeTimers();
    const promise = withTimeout(() => new Promise<never>(() => undefined), 100);
    const rejection = expect(promise).rejects.toEqual(
      expect.objectContaining({ name: "DeadlineError", reason: "timeout" }),
    );
    await vi.advanceTimersByTimeAsync(100);
    await rejection;
  });

  it("exposes a stable error type", () => {
    expect(new DeadlineError("timeout")).toBeInstanceOf(Error);
  });
});
