/**
 * Mobile runtime config store — Zustand + SecureStore. Mirrors the
 * pattern in `apps/mobile/data/workspace-store.ts` (one record persisted
 * to SecureStore, sync getter for non-React consumers like ApiClient).
 *
 * Hydrate order (called once from `RuntimeConfigInitializer` in
 * `app/_layout.tsx`):
 *   1. Read raw JSON from SecureStore under `multica_runtime_config`.
 *   2. parseRuntimeConfig validates schema + URL shape.
 *   3. If parse succeeds → use parsed; else fall back to build-time URL.
 *   4. If SecureStore throws (rare: Android Keystore locked) → fall back
 *      to build-time URL with a warning, do NOT block startup.
 *
 * `hasUserChosenBackend` distinguishes "build-time fallback" from
 * "user explicitly picked something". `_layout.tsx` renders the Welcome
 * gate only while `status === "hydrated" && !hasUserChosenBackend` —
 * so users who upgrade from a build that only had env-based config
 * land on Welcome once (since their SecureStore is empty) but anyone
 * who already saved a self-host URL goes straight to Sign in.
 */
import { create } from "zustand";
import * as SecureStore from "expo-secure-store";
import {
  DEFAULT_RUNTIME_CONFIG,
  RUNTIME_CONFIG_SCHEMA_VERSION,
  getBuildTimeApiUrl,
  parseRuntimeConfig,
  serializeRuntimeConfig,
} from "./runtime-config";
import type { RuntimeConfig } from "./runtime-config";

const SECURE_STORE_KEY = "multica_runtime_config";

type Status = "idle" | "hydrating" | "hydrated";

interface State {
  status: Status;
  config: RuntimeConfig;
  /** True after the user (or Welcome's "Use Multica Cloud" button) explicitly
   *  chose a backend. False while the runtime config came from build-time env
   *  and the user has not visited Welcome. */
  hasUserChosenBackend: boolean;
  hydrate: () => Promise<void>;
  setApiUrl: (url: string) => Promise<void>;
  resetToDefault: () => Promise<void>;
}

const initialConfig = (): RuntimeConfig => ({
  schemaVersion: RUNTIME_CONFIG_SCHEMA_VERSION,
  apiUrl: getBuildTimeApiUrl(),
});

export const useRuntimeConfigStore = create<State>((set, get) => ({
  status: "idle",
  config: initialConfig(),
  hasUserChosenBackend: false,

  hydrate: async () => {
    if (get().status !== "idle") return;
    set({ status: "hydrating" });
    try {
      const raw = await SecureStore.getItemAsync(SECURE_STORE_KEY);
      if (!raw) {
        set({
          status: "hydrated",
          config: initialConfig(),
          hasUserChosenBackend: false,
        });
        return;
      }
      try {
        const parsed = parseRuntimeConfig(raw);
        set({
          status: "hydrated",
          config: parsed,
          hasUserChosenBackend: true,
        });
      } catch (parseErr) {
        // Corrupt SecureStore payload — fall back to build-time URL and
        // clear the bad record so the next hydrate is clean.
        console.warn(
          "[runtime-config] Stored payload failed to parse, falling back to build-time URL",
          parseErr,
        );
        await SecureStore.deleteItemAsync(SECURE_STORE_KEY).catch(() => {
          // Best-effort cleanup; failure here is non-fatal.
        });
        set({
          status: "hydrated",
          config: initialConfig(),
          hasUserChosenBackend: false,
        });
      }
    } catch (storeErr) {
      console.warn(
        "[runtime-config] SecureStore unavailable, falling back to build-time URL",
        storeErr,
      );
      set({
        status: "hydrated",
        config: initialConfig(),
        hasUserChosenBackend: false,
      });
    }
  },

  setApiUrl: async (url) => {
    const next = parseRuntimeConfig(
      JSON.stringify({
        schemaVersion: RUNTIME_CONFIG_SCHEMA_VERSION,
        apiUrl: url,
      }),
    );
    await SecureStore.setItemAsync(SECURE_STORE_KEY, serializeRuntimeConfig(next));
    set({ config: next, hasUserChosenBackend: true });
  },

  resetToDefault: async () => {
    await SecureStore.deleteItemAsync(SECURE_STORE_KEY).catch(() => {
      // Best-effort cleanup; absence is not an error.
    });
    set({
      config: {
        schemaVersion: RUNTIME_CONFIG_SCHEMA_VERSION,
        apiUrl: DEFAULT_RUNTIME_CONFIG.apiUrl,
      },
      hasUserChosenBackend: true,
    });
  },
}));

/** Sync helper for ApiClient / ws-client. Reads the current apiUrl
 *  without React. Returns build-time URL before hydrate completes —
 *  RuntimeConfigInitializer calls `api.setBaseUrl(...)` immediately
 *  after hydrate settles. */
export function getApiUrl(): string {
  return useRuntimeConfigStore.getState().config.apiUrl;
}