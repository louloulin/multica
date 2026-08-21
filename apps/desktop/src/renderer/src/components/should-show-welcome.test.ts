// @vitest-environment node
import { describe, expect, it } from "vitest";
import { DEFAULT_RUNTIME_CONFIG } from "../../../shared/runtime-config";
import { shouldShowWelcome } from "./should-show-welcome";

describe("shouldShowWelcome", () => {
  it("returns true when no config file exists and apiUrl is the cloud default", () => {
    expect(
      shouldShowWelcome({
        configPresent: false,
        apiUrl: DEFAULT_RUNTIME_CONFIG.apiUrl,
      }),
    ).toBe(true);
  });

  it("returns false when a config file already exists", () => {
    expect(
      shouldShowWelcome({
        configPresent: true,
        apiUrl: DEFAULT_RUNTIME_CONFIG.apiUrl,
      }),
    ).toBe(false);
  });

  it("returns false when the user has already pointed at a self-host backend", () => {
    expect(
      shouldShowWelcome({
        configPresent: false,
        apiUrl: "https://api.selfhost.test",
      }),
    ).toBe(false);
  });

  it("returns false while configPresent is still loading", () => {
    expect(
      shouldShowWelcome({
        configPresent: null,
        apiUrl: DEFAULT_RUNTIME_CONFIG.apiUrl,
      }),
    ).toBe(false);
  });
});
