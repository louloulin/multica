import { describe, expect, it, vi } from "vitest";
import { createDiagnosticSink } from "./client-diagnostics";

describe("client diagnostics", () => {
  it("does not retain events while disabled", () => {
    const sink = createDiagnosticSink();
    sink.record({ category: "request", operation: "get_me", phase: "started" });
    expect(sink.snapshot()).toMatchObject({ events: [], droppedCount: 0, enabled: false });
  });

  it("retains only safe, bounded fields", () => {
    const sink = createDiagnosticSink(true);
    const listener = vi.fn();
    sink.subscribe(listener);
    sink.record({
      category: "request",
      operation: "GET /api/me",
      phase: "error",
      route: "/acme/issues/MUL-123?token=secret",
      errorCode: "network error",
      durationMs: 12.6,
    });
    const event = sink.snapshot().events[0];
    expect(event).toMatchObject({
      operation: "GET /api/me",
      phase: "error",
      route: "/acme/issues/MUL-123?token=secret",
      errorCode: "network_error",
      durationMs: 13,
    });
    expect(event).not.toHaveProperty("token");
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("bounds the ring buffer and tracks dropped events", () => {
    const sink = createDiagnosticSink(true);
    for (let i = 0; i < 205; i += 1) {
      sink.record({ category: "renderer", operation: `event-${i}`, phase: "state" });
    }
    const snapshot = sink.snapshot();
    expect(snapshot.events).toHaveLength(200);
    expect(snapshot.droppedCount).toBe(5);
    expect(snapshot.events[0]?.operation).toBe("event-5");
  });

  it("clears events when disabled", () => {
    const sink = createDiagnosticSink(true);
    sink.record({ category: "daemon", operation: "start", phase: "started" });
    sink.setEnabled(false);
    expect(sink.snapshot()).toMatchObject({ events: [], droppedCount: 0, enabled: false });
  });
});
