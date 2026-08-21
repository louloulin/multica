import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { I18nProvider } from "@multica/core/i18n/react";
import { RESOURCES } from "@multica/views/locales";
import { WelcomeGate } from "./welcome-gate";
import { DEFAULT_RUNTIME_CONFIG } from "../../../shared/runtime-config";

const mocks = vi.hoisted(() => ({
  updateRuntimeConfig: vi.fn(),
  isRuntimeConfigPresent: vi.fn(),
  requestAppRestart: vi.fn(),
}));

function setupDesktopApi(runtimeConfig = DEFAULT_RUNTIME_CONFIG) {
  Object.defineProperty(window, "desktopAPI", {
    configurable: true,
    value: {
      runtimeConfig: { ok: true, config: runtimeConfig },
      updateRuntimeConfig: mocks.updateRuntimeConfig,
      isRuntimeConfigPresent: mocks.isRuntimeConfigPresent,
      requestAppRestart: mocks.requestAppRestart,
    },
  });
}

function renderWithI18n(ui: React.ReactElement) {
  return render(
    <I18nProvider locale="en" resources={RESOURCES}>
      {ui}
    </I18nProvider>,
  );
}

describe("WelcomeGate", () => {
  beforeEach(() => {
    mocks.updateRuntimeConfig.mockReset().mockResolvedValue({ ok: true });
    mocks.isRuntimeConfigPresent.mockReset().mockResolvedValue(true);
    mocks.requestAppRestart.mockReset().mockResolvedValue({ ok: true });
  });

  afterEach(() => {
    // Each test redefines window.desktopAPI; drop the reference so the
    // next test's Object.defineProperty can replace it without "already
    // defined" warnings.
    delete (window as unknown as { desktopAPI?: unknown }).desktopAPI;
  });

  it("renders both choice buttons on first launch", () => {
    setupDesktopApi();
    renderWithI18n(<WelcomeGate />);

    expect(
      screen.getByTestId("welcome-use-cloud"),
    ).toBeInTheDocument();
    expect(
      screen.getByTestId("welcome-connect-selfhost"),
    ).toBeInTheDocument();
  });

  it("expands the self-hosted input when the user clicks Connect to self-hosted", () => {
    setupDesktopApi();
    renderWithI18n(<WelcomeGate />);

    fireEvent.click(screen.getByTestId("welcome-connect-selfhost"));

    expect(screen.getByTestId("welcome-selfhost-input")).toBeInTheDocument();
    expect(screen.getByTestId("welcome-selfhost-save")).toBeInTheDocument();
  });

  it("saves DEFAULT_RUNTIME_CONFIG when Use Multica Cloud is clicked", async () => {
    setupDesktopApi();
    renderWithI18n(<WelcomeGate />);

    fireEvent.click(screen.getByTestId("welcome-use-cloud"));

    await waitFor(() => {
      expect(mocks.updateRuntimeConfig).toHaveBeenCalledWith(
        DEFAULT_RUNTIME_CONFIG,
      );
    });
  });

  it("derives wsUrl and appUrl from the self-hosted apiUrl on save", async () => {
    setupDesktopApi();
    renderWithI18n(<WelcomeGate />);

    fireEvent.click(screen.getByTestId("welcome-connect-selfhost"));
    const input = screen.getByTestId("welcome-selfhost-input");
    fireEvent.change(input, {
      target: { value: "https://api.selfhost.test" },
    });
    fireEvent.click(screen.getByTestId("welcome-selfhost-save"));

    await waitFor(() => {
      expect(mocks.updateRuntimeConfig).toHaveBeenCalledWith({
        schemaVersion: 1,
        apiUrl: "https://api.selfhost.test",
        wsUrl: "wss://api.selfhost.test/ws",
        appUrl: "https://selfhost.test",
      });
    });
  });

  it("disables the self-host save button until a URL is typed", () => {
    setupDesktopApi();
    renderWithI18n(<WelcomeGate />);

    fireEvent.click(screen.getByTestId("welcome-connect-selfhost"));
    const saveButton = screen.getByTestId("welcome-selfhost-save");
    expect(saveButton).toBeDisabled();

    fireEvent.change(screen.getByTestId("welcome-selfhost-input"), {
      target: { value: "https://api.selfhost.test" },
    });

    expect(saveButton).not.toBeDisabled();
  });

  it("surfaces a save failure when updateRuntimeConfig rejects", async () => {
    mocks.updateRuntimeConfig.mockReset().mockResolvedValue({
      ok: false,
      error: "Permission denied",
    });
    setupDesktopApi();
    renderWithI18n(<WelcomeGate />);

    fireEvent.click(screen.getByTestId("welcome-use-cloud"));

    await waitFor(() => {
      expect(mocks.updateRuntimeConfig).toHaveBeenCalledOnce();
    });
    // Restart is not requested when the save fails.
    expect(mocks.requestAppRestart).not.toHaveBeenCalled();
  });
});
