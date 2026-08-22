// @vitest-environment node
import { describe, expect, it } from "vitest";
import { DEFAULT_RUNTIME_CONFIG } from "@/data/runtime-config";
import { shouldShowWelcome } from "./should-show-welcome";

describe("shouldShowWelcome", () => {
  const baseCloud = {
    status: "hydrated" as const,
    hasUserChosenBackend: false,
    config: {
      schemaVersion: 1 as const,
      apiUrl: DEFAULT_RUNTIME_CONFIG.apiUrl,
    },
  };

  it("shows Welcome when hydrated, not chosen, default URL", () => {
    expect(shouldShowWelcome(baseCloud)).toBe(true);
  });

  it("hides Welcome while hydrating", () => {
    expect(
      shouldShowWelcome({ ...baseCloud, status: "hydrating" }),
    ).toBe(false);
  });

  it("hides Welcome when still idle", () => {
    expect(shouldShowWelcome({ ...baseCloud, status: "idle" })).toBe(
      false,
    );
  });

  it("hides Welcome when user has already chosen a backend", () => {
    expect(
      shouldShowWelcome({ ...baseCloud, hasUserChosenBackend: true }),
    ).toBe(false);
  });

  it("hides Welcome when user has chosen a non-default URL", () => {
    expect(
      shouldShowWelcome({
        ...baseCloud,
        hasUserChosenBackend: true,
        config: {
          schemaVersion: 1,
          apiUrl: "https://self-host.example.com",
        },
      }),
    ).toBe(false);
  });
});