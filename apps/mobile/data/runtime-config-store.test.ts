// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  DEFAULT_RUNTIME_CONFIG,
  RUNTIME_CONFIG_SCHEMA_VERSION,
} from "./runtime-config";

const secureStoreState: { value: string | null; throwOnGet: boolean; throwOnSet: boolean } = {
  value: null,
  throwOnGet: false,
  throwOnSet: false,
};

vi.mock("expo-secure-store", () => ({
  getItemAsync: vi.fn(async (_key: string) => {
    if (secureStoreState.throwOnGet) throw new Error("keystore locked");
    return secureStoreState.value;
  }),
  setItemAsync: vi.fn(async (_key: string, value: string) => {
    if (secureStoreState.throwOnSet) throw new Error("write failed");
    secureStoreState.value = value;
  }),
  deleteItemAsync: vi.fn(async (_key: string) => {
    secureStoreState.value = null;
  }),
}));

// The store module reads getBuildTimeApiUrl() at import time via
// initialConfig(); mock the env so the build-time URL is deterministic.
const ORIGINAL_ENV = process.env.EXPO_PUBLIC_API_URL;
beforeEach(() => {
  delete process.env.EXPO_PUBLIC_API_URL;
  secureStoreState.value = null;
  secureStoreState.throwOnGet = false;
  secureStoreState.throwOnSet = false;
});
afterEach(() => {
  if (ORIGINAL_ENV === undefined) delete process.env.EXPO_PUBLIC_API_URL;
  else process.env.EXPO_PUBLIC_API_URL = ORIGINAL_ENV;
  vi.resetModules();
});

async function loadStore() {
  vi.resetModules();
  const mod = await import("./runtime-config-store");
  return mod.useRuntimeConfigStore;
}

describe("runtime-config-store", () => {
  it("hydrates to build-time URL when SecureStore is empty", async () => {
    process.env.EXPO_PUBLIC_API_URL = "https://staging.example.com";
    const useStore = await loadStore();
    const store = useStore.getState();
    expect(store.status).toBe("idle");
    await store.hydrate();
    const after = useStore.getState();
    expect(after.status).toBe("hydrated");
    expect(after.config.apiUrl).toBe("https://staging.example.com");
    expect(after.hasUserChosenBackend).toBe(false);
  });

  it("hydrates to DEFAULT when env is unset and SecureStore is empty", async () => {
    const useStore = await loadStore();
    await useStore.getState().hydrate();
    const after = useStore.getState();
    expect(after.config.apiUrl).toBe(DEFAULT_RUNTIME_CONFIG.apiUrl);
    expect(after.hasUserChosenBackend).toBe(false);
  });

  it("hydrates to SecureStore value when present and marks user-chosen", async () => {
    secureStoreState.value = JSON.stringify({
      schemaVersion: RUNTIME_CONFIG_SCHEMA_VERSION,
      apiUrl: "https://self-host.example.com",
    });
    const useStore = await loadStore();
    await useStore.getState().hydrate();
    const after = useStore.getState();
    expect(after.config.apiUrl).toBe("https://self-host.example.com");
    expect(after.hasUserChosenBackend).toBe(true);
  });

  it("falls back to build-time URL when SecureStore payload is corrupt", async () => {
    process.env.EXPO_PUBLIC_API_URL = "https://build-time.example.com";
    secureStoreState.value = "not-json{";
    const useStore = await loadStore();
    await useStore.getState().hydrate();
    const after = useStore.getState();
    expect(after.config.apiUrl).toBe("https://build-time.example.com");
    expect(after.hasUserChosenBackend).toBe(false);
  });

  it("falls back to build-time URL when SecureStore throws on getItem", async () => {
    process.env.EXPO_PUBLIC_API_URL = "https://build-time.example.com";
    secureStoreState.throwOnGet = true;
    const useStore = await loadStore();
    await useStore.getState().hydrate();
    const after = useStore.getState();
    expect(after.status).toBe("hydrated");
    expect(after.config.apiUrl).toBe("https://build-time.example.com");
    expect(after.hasUserChosenBackend).toBe(false);
  });

  it("setApiUrl persists, marks chosen, and is reflected by getApiUrl()", async () => {
    const useStore = await loadStore();
    await useStore.getState().hydrate();
    await useStore.getState().setApiUrl("https://new-self-host.example.com/");
    const after = useStore.getState();
    expect(after.config.apiUrl).toBe("https://new-self-host.example.com"); // trailing slash stripped
    expect(after.hasUserChosenBackend).toBe(true);
    expect(secureStoreState.value).toBeTruthy();
    expect(JSON.parse(secureStoreState.value!).apiUrl).toBe(
      "https://new-self-host.example.com",
    );
  });

  it("resetToDefault clears SecureStore, resets to DEFAULT, marks chosen", async () => {
    secureStoreState.value = JSON.stringify({
      schemaVersion: RUNTIME_CONFIG_SCHEMA_VERSION,
      apiUrl: "https://self-host.example.com",
    });
    const useStore = await loadStore();
    await useStore.getState().hydrate();
    expect(useStore.getState().hasUserChosenBackend).toBe(true);
    await useStore.getState().resetToDefault();
    const after = useStore.getState();
    expect(after.config.apiUrl).toBe(DEFAULT_RUNTIME_CONFIG.apiUrl);
    expect(after.hasUserChosenBackend).toBe(true);
    expect(secureStoreState.value).toBeNull();
  });

  it("hydrate is idempotent — second call is a no-op", async () => {
    const useStore = await loadStore();
    const first = useStore.getState().hydrate();
    const second = useStore.getState().hydrate();
    await Promise.all([first, second]);
    expect(useStore.getState().status).toBe("hydrated");
  });
});