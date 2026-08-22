// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
  DEFAULT_RUNTIME_CONFIG,
  RUNTIME_CONFIG_SCHEMA_VERSION,
  deriveAppUrl,
  deriveWsUrl,
  normalizeHttpUrl,
  parseRuntimeConfig,
  serializeRuntimeConfig,
  type RuntimeConfig,
} from "./runtime-config";

describe("runtime-config", () => {
  describe("parseRuntimeConfig", () => {
    it("round-trips with serializeRuntimeConfig", () => {
      const input: RuntimeConfig = {
        schemaVersion: RUNTIME_CONFIG_SCHEMA_VERSION,
        apiUrl: "https://api.example.com",
      };
      const parsed = parseRuntimeConfig(serializeRuntimeConfig(input));
      expect(parsed).toEqual(input);
    });

    it("normalizes trailing slashes", () => {
      const parsed = parseRuntimeConfig(
        JSON.stringify({
          schemaVersion: RUNTIME_CONFIG_SCHEMA_VERSION,
          apiUrl: "https://api.example.com/",
        }),
      );
      expect(parsed.apiUrl).toBe("https://api.example.com");
    });

    it("strips query string and hash", () => {
      const parsed = parseRuntimeConfig(
        JSON.stringify({
          schemaVersion: RUNTIME_CONFIG_SCHEMA_VERSION,
          apiUrl: "https://api.example.com/v1/?token=x#frag",
        }),
      );
      expect(parsed.apiUrl).toBe("https://api.example.com/v1");
    });

    it("rejects unknown schemaVersion", () => {
      expect(() =>
        parseRuntimeConfig(JSON.stringify({ schemaVersion: 99, apiUrl: "https://x" })),
      ).toThrow(/schemaVersion/);
    });

    it("rejects empty apiUrl", () => {
      expect(() =>
        parseRuntimeConfig(
          JSON.stringify({ schemaVersion: RUNTIME_CONFIG_SCHEMA_VERSION, apiUrl: "   " }),
        ),
      ).toThrow(/apiUrl/);
    });

    it("rejects non-http(s) protocol", () => {
      expect(() =>
        parseRuntimeConfig(
          JSON.stringify({
            schemaVersion: RUNTIME_CONFIG_SCHEMA_VERSION,
            apiUrl: "ftp://api.example.com",
          }),
        ),
      ).toThrow(/http or https/);
    });

    it("rejects malformed JSON", () => {
      expect(() => parseRuntimeConfig("not json")).toThrow(/Invalid runtime config JSON/);
    });

    it("rejects non-object payloads", () => {
      expect(() => parseRuntimeConfig(JSON.stringify("https://x"))).toThrow(
        /expected a JSON object/,
      );
    });

    it("accepts tailscale-style http URL with port", () => {
      const parsed = parseRuntimeConfig(
        JSON.stringify({
          schemaVersion: RUNTIME_CONFIG_SCHEMA_VERSION,
          apiUrl: "http://congvc-x99.tailnet.ts.net:18443",
        }),
      );
      expect(parsed.apiUrl).toBe("http://congvc-x99.tailnet.ts.net:18443");
    });

    it("ignores wsUrl/appUrl fields if present (legacy desktop schema compatibility)", () => {
      const parsed = parseRuntimeConfig(
        JSON.stringify({
          schemaVersion: RUNTIME_CONFIG_SCHEMA_VERSION,
          apiUrl: "https://api.example.com",
          wsUrl: "wss://api.example.com/ws",
          appUrl: "https://example.com",
        }),
      );
      expect(parsed).toEqual({
        schemaVersion: RUNTIME_CONFIG_SCHEMA_VERSION,
        apiUrl: "https://api.example.com",
      });
    });
  });

  describe("normalizeHttpUrl", () => {
    it("trims whitespace", () => {
      expect(normalizeHttpUrl("  https://x  ", "apiUrl")).toBe("https://x");
    });

    it("rejects garbage", () => {
      expect(() => normalizeHttpUrl("not a url", "apiUrl")).toThrow(/valid URL/);
    });

    it("rejects ws:// at the input boundary", () => {
      expect(() => normalizeHttpUrl("ws://x", "apiUrl")).toThrow(/http or https/);
    });
  });

  describe("deriveWsUrl", () => {
    it("https → wss + /ws", () => {
      expect(deriveWsUrl("https://api.example.com")).toBe("wss://api.example.com/ws");
    });

    it("http → ws + /ws", () => {
      expect(deriveWsUrl("http://localhost:8080")).toBe("ws://localhost:8080/ws");
    });

    it("appends /ws without doubling the trailing slash", () => {
      expect(deriveWsUrl("https://api.example.com/")).toBe("wss://api.example.com/ws");
    });

    it("rejects non-http(s)", () => {
      expect(() => deriveWsUrl("ftp://x")).toThrow(/http or https/);
    });
  });

  describe("deriveAppUrl", () => {
    it("strips leading api. for ≥3-label hostnames", () => {
      expect(deriveAppUrl("https://api.multica.ai")).toBe("https://multica.ai");
      expect(deriveAppUrl("https://api.test.multica.ai")).toBe("https://test.multica.ai");
    });

    it("leaves hosts without leading api. untouched", () => {
      expect(deriveAppUrl("https://multica.ai")).toBe("https://multica.ai");
    });

    it("leaves short two-label hosts untouched (api.local would be wrong)", () => {
      expect(deriveAppUrl("http://localhost:8080")).toBe("http://localhost:8080");
    });

    it("strips pathname / query / hash", () => {
      expect(deriveAppUrl("https://api.example.com/v1?q=1#x")).toBe(
        "https://example.com",
      );
    });
  });

  describe("DEFAULT_RUNTIME_CONFIG", () => {
    it("points at cloud", () => {
      expect(DEFAULT_RUNTIME_CONFIG.apiUrl).toBe("https://api.multica.ai");
      expect(DEFAULT_RUNTIME_CONFIG.schemaVersion).toBe(RUNTIME_CONFIG_SCHEMA_VERSION);
    });
  });
});