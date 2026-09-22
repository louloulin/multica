import { describe, expect, it } from "vitest";
import { workspaceUrlHost } from "./workspace-url";

describe("workspaceUrlHost", () => {
  it("returns the host of a full app URL", () => {
    expect(workspaceUrlHost("https://lumen.example.com")).toBe(
      "lumen.example.com",
    );
  });

  it("ignores scheme, path, and trailing slash", () => {
    expect(workspaceUrlHost("https://lumen.example.com/")).toBe(
      "lumen.example.com",
    );
    expect(workspaceUrlHost("http://lumen.example.com/app/onboarding")).toBe(
      "lumen.example.com",
    );
  });

  it("preserves a non-default port", () => {
    expect(workspaceUrlHost("https://my.host:3000")).toBe("my.host:3000");
  });

  it("accepts a bare host without a scheme", () => {
    expect(workspaceUrlHost("lumen.example.com")).toBe("lumen.example.com");
    expect(workspaceUrlHost("lumen.example.com/path")).toBe(
      "lumen.example.com",
    );
  });

  it("falls back to the brand host when no app URL is configured", () => {
    expect(workspaceUrlHost("")).toBe("lumen.ai");
    expect(workspaceUrlHost("   ")).toBe("lumen.ai");
    expect(workspaceUrlHost(null)).toBe("lumen.ai");
    expect(workspaceUrlHost(undefined)).toBe("lumen.ai");
  });
});
