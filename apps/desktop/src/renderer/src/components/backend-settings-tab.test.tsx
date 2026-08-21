import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { I18nProvider } from "@multica/core/i18n/react";
import { RESOURCES } from "@multica/views/locales";
import { BackendSettingsTab } from "./backend-settings-tab";
import { DEFAULT_RUNTIME_CONFIG } from "../../../shared/runtime-config";

const mocks = vi.hoisted(() => ({
  updateRuntimeConfig: vi.fn(),
  isRuntimeConfigPresent: vi.fn(),
  clearRuntimeConfig: vi.fn(),
  requestAppRestart: vi.fn(),
}));

function setupDesktopApi(runtimeConfig = DEFAULT_RUNTIME_CONFIG) {
  Object.defineProperty(window, "desktopAPI", {
    configurable: true,
    value: {
      runtimeConfig: { ok: true, config: runtimeConfig },
      updateRuntimeConfig: mocks.updateRuntimeConfig,
      isRuntimeConfigPresent: mocks.isRuntimeConfigPresent,
      clearRuntimeConfig: mocks.clearRuntimeConfig,
      requestAppRestart: mocks.requestAppRestart,
    },
  });
}

function renderWithI18n(ui: React.ReactElement) {
  return render(<I18nProvider locale="en" resources={RESOURCES}>{ui}</I18nProvider>);
}

describe("BackendSettingsTab", () => {
  beforeEach(() => {
    mocks.updateRuntimeConfig.mockReset().mockResolvedValue({ ok: true });
    mocks.isRuntimeConfigPresent.mockReset().mockResolvedValue(true);
    mocks.clearRuntimeConfig.mockReset().mockResolvedValue({ ok: true });
    mocks.requestAppRestart.mockReset().mockResolvedValue({ ok: true });
  });

  it("pre-fills the form with the current config", async () => {
    setupDesktopApi({
      schemaVersion: 1,
      apiUrl: "https://api.example.com",
      wsUrl: "wss://api.example.com/ws",
      appUrl: "https://example.com",
    });
    renderWithI18n(<BackendSettingsTab />);

    const apiInput = screen.getByLabelText(/api url/i) as HTMLInputElement;
    await waitFor(() => {
      expect(apiInput.value).toBe("https://api.example.com");
    });
  });

  it("writes through updateRuntimeConfig on save", async () => {
    setupDesktopApi({
      schemaVersion: 1,
      apiUrl: "https://api.example.com",
      wsUrl: "wss://api.example.com/ws",
      appUrl: "https://example.com",
    });
    renderWithI18n(<BackendSettingsTab />);

    const apiInput = await screen.findByLabelText(/api url/i);
    fireEvent.change(apiInput, {
      target: { value: "https://api.selfhost.test" },
    });
    fireEvent.blur(apiInput);

    await waitFor(() => {
      expect(mocks.updateRuntimeConfig).toHaveBeenCalledWith(
        expect.objectContaining({
          schemaVersion: 1,
          apiUrl: "https://api.selfhost.test",
        }),
      );
    });
  });

  it("derives wsUrl and appUrl from apiUrl when no override is set", async () => {
    setupDesktopApi({
      schemaVersion: 1,
      apiUrl: "https://api.example.com",
      wsUrl: "wss://api.example.com/ws",
      appUrl: "https://example.com",
    });
    renderWithI18n(<BackendSettingsTab />);

    const apiInput = await screen.findByLabelText(/api url/i);
    fireEvent.change(apiInput, {
      target: { value: "https://api.selfhost.test" },
    });
    fireEvent.blur(apiInput);

    await waitFor(() => {
      expect(mocks.updateRuntimeConfig).toHaveBeenCalledWith({
        schemaVersion: 1,
        apiUrl: "https://api.selfhost.test",
        wsUrl: "wss://api.selfhost.test/ws",
        appUrl: "https://selfhost.test",
      });
    });
  });

  it("shows the reset confirmation disabled until the user types the keyword", async () => {
    setupDesktopApi();
    renderWithI18n(<BackendSettingsTab />);

    const resetButton = await screen.findByRole("button", { name: /reset to cloud/i });
    expect(resetButton).toBeDisabled();

    const confirmInput = screen.getByPlaceholderText("multica.ai");
    fireEvent.change(confirmInput, { target: { value: "multica.ai" } });

    expect(resetButton).not.toBeDisabled();

    fireEvent.click(resetButton);
    await waitFor(() => {
      expect(mocks.clearRuntimeConfig).toHaveBeenCalledOnce();
    });
  });
});