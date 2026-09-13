export type DiagnosticCategory =
  | "request"
  | "daemon"
  | "ipc"
  | "renderer"
  | "realtime"
  | "polling"
  | "auth";

export type DiagnosticPhase =
  | "started"
  | "completed"
  | "timeout"
  | "error"
  | "state";

export interface ClientDiagnosticEvent {
  readonly category: DiagnosticCategory;
  readonly operation: string;
  readonly phase: DiagnosticPhase;
  readonly timestamp: number;
  readonly durationMs?: number;
  readonly attempt?: number;
  readonly statusCode?: number;
  readonly state?: string;
  readonly route?: string;
  readonly errorCode?: string;
}

export interface DiagnosticSnapshot {
  readonly events: readonly ClientDiagnosticEvent[];
  readonly droppedCount: number;
  readonly enabled: boolean;
}

export interface DiagnosticSink {
  record(event: Omit<ClientDiagnosticEvent, "timestamp"> & { timestamp?: number }): void;
  subscribe(listener: (event: ClientDiagnosticEvent) => void): () => void;
  snapshot(): DiagnosticSnapshot;
  clear(): void;
  setEnabled(enabled: boolean): void;
}

const MAX_EVENTS = 200;
const MAX_TEXT = 80;
const CATEGORIES = new Set<DiagnosticCategory>([
  "request",
  "daemon",
  "ipc",
  "renderer",
  "realtime",
  "polling",
  "auth",
]);
const PHASES = new Set<DiagnosticPhase>([
  "started",
  "completed",
  "timeout",
  "error",
  "state",
]);

function boundedText(value: string | undefined): string | undefined {
  if (!value) return undefined;
  return value.slice(0, MAX_TEXT);
}

function sanitizeEvent(
  event: Omit<ClientDiagnosticEvent, "timestamp"> & { timestamp?: number },
): ClientDiagnosticEvent | null {
  if (!CATEGORIES.has(event.category) || !PHASES.has(event.phase)) return null;
  if (typeof event.operation !== "string" || !event.operation.trim()) return null;
  const result: {
    category: DiagnosticCategory;
    operation: string;
    phase: DiagnosticPhase;
    timestamp: number;
    durationMs?: number;
    attempt?: number;
    statusCode?: number;
    state?: string;
    route?: string;
    errorCode?: string;
  } = {
    category: event.category,
    operation: boundedText(event.operation) ?? "unknown",
    phase: event.phase,
    timestamp: Number.isFinite(event.timestamp) ? Number(event.timestamp) : Date.now(),
  };
  if (Number.isFinite(event.durationMs)) result.durationMs = Math.max(0, Math.round(Number(event.durationMs)));
  if (Number.isInteger(event.attempt)) result.attempt = Math.max(0, Number(event.attempt));
  if (Number.isInteger(event.statusCode)) result.statusCode = Number(event.statusCode);
  result.state = boundedText(event.state);
  result.route = boundedText(event.route);
  result.errorCode = boundedText(event.errorCode)?.replace(/[^a-zA-Z0-9_.-]/g, "_");
  return result;
}

export function createDiagnosticSink(initialEnabled = false): DiagnosticSink {
  let enabled = initialEnabled;
  let droppedCount = 0;
  const events: ClientDiagnosticEvent[] = [];
  const listeners = new Set<(event: ClientDiagnosticEvent) => void>();

  return {
    record(input) {
      if (!enabled) return;
      const event = sanitizeEvent(input);
      if (!event) return;
      if (events.length >= MAX_EVENTS) {
        events.shift();
        droppedCount += 1;
      }
      events.push(event);
      for (const listener of listeners) listener(event);
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    snapshot() {
      return { events: [...events], droppedCount, enabled };
    },
    clear() {
      events.length = 0;
      droppedCount = 0;
    },
    setEnabled(next) {
      enabled = next;
      if (!next) {
        events.length = 0;
        droppedCount = 0;
      }
    },
  };
}

export const clientDiagnostics = createDiagnosticSink();
