/**
 * Mobile runtime backend URL config. Pure functions — no React, no
 * SecureStore. Mirrors `apps/desktop/src/shared/runtime-config.ts` but
 * keeps only `apiUrl` in the persisted shape; `wsUrl` and `appUrl` are
 * derived at read time via `deriveWsUrl` / `deriveAppUrl`. Desktop
 * persists three fields because its VITE_* env can override each one
 * independently; mobile has a single `EXPO_PUBLIC_API_URL` env, so
 * storing the other two would create a mental-model trap (Settings →
 * Backend only edits apiUrl, but the stored wsUrl/appUrl still has to
 * be ignored on read).
 *
 * Build-time fallback chain (consumed by `getBuildTimeApiUrl`):
 *   SecureStore (handled by runtime-config-store) →
 *   process.env.EXPO_PUBLIC_API_URL →
 *   DEFAULT_RUNTIME_CONFIG.apiUrl (cloud).
 */
export const RUNTIME_CONFIG_SCHEMA_VERSION = 1 as const;

export interface RuntimeConfig {
  schemaVersion: typeof RUNTIME_CONFIG_SCHEMA_VERSION;
  apiUrl: string;
}

export const DEFAULT_RUNTIME_CONFIG: RuntimeConfig = Object.freeze({
  schemaVersion: RUNTIME_CONFIG_SCHEMA_VERSION,
  apiUrl: "https://api.multica.ai",
});

export function getBuildTimeApiUrl(): string {
  return process.env.EXPO_PUBLIC_API_URL ?? DEFAULT_RUNTIME_CONFIG.apiUrl;
}

export function parseRuntimeConfig(raw: string): RuntimeConfig {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new Error(
      `Invalid runtime config JSON: ${err instanceof Error ? err.message : "parse failed"}`,
    );
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Invalid runtime config: expected a JSON object");
  }

  const obj = parsed as Record<string, unknown>;
  if (obj.schemaVersion !== RUNTIME_CONFIG_SCHEMA_VERSION) {
    throw new Error(
      `Unsupported runtime config schemaVersion: expected ${RUNTIME_CONFIG_SCHEMA_VERSION}`,
    );
  }

  const apiUrl = requiredString(obj.apiUrl, "apiUrl");
  const normalizedApiUrl = normalizeHttpUrl(apiUrl, "apiUrl");

  return {
    schemaVersion: RUNTIME_CONFIG_SCHEMA_VERSION,
    apiUrl: normalizedApiUrl,
  };
}

export function serializeRuntimeConfig(config: RuntimeConfig): string {
  return JSON.stringify(
    {
      schemaVersion: config.schemaVersion,
      apiUrl: config.apiUrl,
    },
    null,
    2,
  );
}

/** Mirror desktop's `deriveWsUrl` (apps/desktop/src/shared/runtime-config.ts:109-118).
 *  Switches http→ws / https→wss and appends /ws. Used by the ws-client and the
 *  Settings → Backend diagnostics row. */
export function deriveWsUrl(apiUrl: string): string {
  const url = new URL(apiUrl);
  if (url.protocol === "https:") url.protocol = "wss:";
  else if (url.protocol === "http:") url.protocol = "ws:";
  else throw new Error("apiUrl must use http or https");
  url.pathname = joinPath(url.pathname, "/ws");
  url.search = "";
  url.hash = "";
  return trimTrailingSlash(url.toString());
}

/** Mirror desktop's `deriveAppUrl` (apps/desktop/src/shared/runtime-config.ts:126-135).
 *  Strips a leading `api.` from the hostname when there are ≥3 labels
 *  (`api.multica.ai` → `multica.ai`). Short hosts / no leading label fall through
 *  untouched. */
export function deriveAppUrl(apiUrl: string): string {
  const url = new URL(apiUrl);
  url.pathname = "";
  url.search = "";
  url.hash = "";
  if (url.hostname.startsWith("api.") && url.hostname.split(".").length >= 3) {
    url.hostname = url.hostname.slice("api.".length);
  }
  return trimTrailingSlash(url.toString());
}

/** Re-export for UI input validation. Throws on non-http(s) URLs, empty
 *  strings, or unparseable input. Used by the Welcome gate + Settings subscreen
 *  before calling `setApiUrl`. */
export function normalizeHttpUrl(value: string, field: string): string {
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    throw new Error(`${field} must be a valid URL`);
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error(`${field} must use http or https`);
  }
  url.search = "";
  url.hash = "";
  return trimTrailingSlash(url.toString());
}

function requiredString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${field} must be a non-empty string`);
  }
  return value;
}

function joinPath(base: string, suffix: string): string {
  const normalizedBase = base.endsWith("/") ? base.slice(0, -1) : base;
  return `${normalizedBase}${suffix}`;
}

function trimTrailingSlash(value: string): string {
  return value.replace(/\/+$/, "");
}