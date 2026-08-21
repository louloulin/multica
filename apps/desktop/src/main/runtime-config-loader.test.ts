// @vitest-environment node
import { mkdtemp, writeFile, readFile } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";
import { describe, expect, it, vi } from "vitest";

// The module under test imports `electron`'s `app` to derive the default
// `~/.multica/desktop.json` path. In a unit-test environment Electron's
// binary isn't installed, so its CJS index throws at require-time. Stub
// just enough of the surface area the loader actually uses.
vi.mock("electron", () => ({
  app: {
    getPath: (name: string) => {
      if (name === "home") return process.env.HOME ?? "/tmp";
      throw new Error(`Unexpected getPath(${name}) in test`);
    },
  },
}));

import {
  clearRuntimeConfig,
  isRuntimeConfigPresent,
  loadRuntimeConfig,
  saveRuntimeConfig,
} from "./runtime-config-loader";
import { parseRuntimeConfig, serializeRuntimeConfig } from "../shared/runtime-config";

describe("loadRuntimeConfig", () => {
  it("uses dev env and ignores desktop.json during electron-vite dev", async () => {
    const dir = await mkdtemp(join(tmpdir(), "multica-desktop-config-"));
    const configPath = join(dir, "desktop.json");
    await writeFile(
      configPath,
      JSON.stringify({ schemaVersion: 1, apiUrl: "https://prod.example.com" }),
    );

    await expect(
      loadRuntimeConfig({
        isDev: true,
        configPath,
        env: {
          apiUrl: "http://localhost:8080",
          wsUrl: "ws://localhost:8080/ws",
          appUrl: "http://localhost:3000",
        },
      }),
    ).resolves.toEqual({
      ok: true,
      config: {
        schemaVersion: 1,
        apiUrl: "http://localhost:8080",
        wsUrl: "ws://localhost:8080/ws",
        appUrl: "http://localhost:3000",
      },
    });
  });

  it("uses cloud defaults when packaged config is absent", async () => {
    const dir = await mkdtemp(join(tmpdir(), "multica-desktop-config-"));
    await expect(
      loadRuntimeConfig({
        isDev: false,
        configPath: join(dir, "missing.json"),
        env: {},
      }),
    ).resolves.toEqual({
      ok: true,
      config: {
        schemaVersion: 1,
        apiUrl: "https://api.multica.ai",
        wsUrl: "wss://api.multica.ai/ws",
        appUrl: "https://multica.ai",
      },
    });
  });

  it("parses a valid packaged desktop.json", async () => {
    const dir = await mkdtemp(join(tmpdir(), "multica-desktop-config-"));
    const configPath = join(dir, "desktop.json");
    await writeFile(
      configPath,
      JSON.stringify({ schemaVersion: 1, apiUrl: "https://api.example.com" }),
    );

    await expect(
      loadRuntimeConfig({ isDev: false, configPath, env: {} }),
    ).resolves.toEqual({
      ok: true,
      config: {
        schemaVersion: 1,
        apiUrl: "https://api.example.com",
        wsUrl: "wss://api.example.com/ws",
        appUrl: "https://example.com",
      },
    });
  });

  it("fails closed when packaged desktop.json is invalid", async () => {
    const dir = await mkdtemp(join(tmpdir(), "multica-desktop-config-"));
    const configPath = join(dir, "desktop.json");
    await writeFile(configPath, "{");

    const result = await loadRuntimeConfig({ isDev: false, configPath, env: {} });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.message).toContain(configPath);
      expect(result.error.message).toContain("Invalid desktop runtime config JSON");
    }
  });
});

describe("saveRuntimeConfig + parse round-trip", () => {
  it("writes a file that parses back to the same shape", async () => {
    const dir = await mkdtemp(join(tmpdir(), "multica-desktop-config-"));
    const configPath = join(dir, "nested", "desktop.json");
    const config = {
      schemaVersion: 1 as const,
      apiUrl: "https://api.example.com",
      wsUrl: "wss://api.example.com/ws",
      appUrl: "https://example.com",
    };

    await saveRuntimeConfig(config, { configPath });

    const written = await readFile(configPath, "utf-8");
    expect(parseRuntimeConfig(written)).toEqual(config);
    // The serializer should be the same one `loadRuntimeConfig` would write
    // — guaranteeing the next launch re-loads the exact same config.
    expect(serializeRuntimeConfig(config)).toBe(written);
  });

  it("creates the parent directory if missing", async () => {
    const dir = await mkdtemp(join(tmpdir(), "multica-desktop-config-"));
    const configPath = join(dir, "deep", "down", "desktop.json");
    await saveRuntimeConfig(
      {
        schemaVersion: 1,
        apiUrl: "https://api.example.com",
        wsUrl: "wss://api.example.com/ws",
        appUrl: "https://example.com",
      },
      { configPath },
    );
    const raw = await readFile(configPath, "utf-8");
    expect(JSON.parse(raw).apiUrl).toBe("https://api.example.com");
  });

  it("rejects an unsaveable shape before touching disk", async () => {
    const dir = await mkdtemp(join(tmpdir(), "multica-desktop-config-"));
    const configPath = join(dir, "desktop.json");
    await expect(
      saveRuntimeConfig(
        // Missing wsUrl / appUrl is fine — they derive. Missing apiUrl isn't.
        {
          schemaVersion: 1,
          apiUrl: "",
          wsUrl: "",
          appUrl: "",
        } as never,
        { configPath },
      ),
    ).rejects.toThrow();
    expect(isRuntimeConfigPresent({ configPath })).toBe(false);
  });
});

describe("isRuntimeConfigPresent", () => {
  it("returns false when no file exists", async () => {
    const dir = await mkdtemp(join(tmpdir(), "multica-desktop-config-"));
    expect(isRuntimeConfigPresent({ configPath: join(dir, "missing.json") })).toBe(false);
  });

  it("returns true after saveRuntimeConfig", async () => {
    const dir = await mkdtemp(join(tmpdir(), "multica-desktop-config-"));
    const configPath = join(dir, "desktop.json");
    await saveRuntimeConfig(
      {
        schemaVersion: 1,
        apiUrl: "https://api.example.com",
        wsUrl: "wss://api.example.com/ws",
        appUrl: "https://example.com",
      },
      { configPath },
    );
    expect(isRuntimeConfigPresent({ configPath })).toBe(true);
  });
});

describe("clearRuntimeConfig", () => {
  it("removes the file when present", async () => {
    const dir = await mkdtemp(join(tmpdir(), "multica-desktop-config-"));
    const configPath = join(dir, "desktop.json");
    await saveRuntimeConfig(
      {
        schemaVersion: 1,
        apiUrl: "https://api.example.com",
        wsUrl: "wss://api.example.com/ws",
        appUrl: "https://example.com",
      },
      { configPath },
    );
    await clearRuntimeConfig({ configPath });
    expect(isRuntimeConfigPresent({ configPath })).toBe(false);
  });

  it("is a no-op when the file is already absent", async () => {
    const dir = await mkdtemp(join(tmpdir(), "multica-desktop-config-"));
    await expect(
      clearRuntimeConfig({ configPath: join(dir, "missing.json") }),
    ).resolves.toBeUndefined();
  });
});
