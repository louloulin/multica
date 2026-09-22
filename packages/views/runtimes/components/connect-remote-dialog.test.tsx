import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { I18nProvider } from "@lumen/core/i18n/react";
import { configStore } from "@lumen/core/config";
import enCommon from "../../locales/en/common.json";
import enRuntimes from "../../locales/en/runtimes.json";
import { ConnectRemoteDialog } from "./connect-remote-dialog";

const TEST_RESOURCES = { en: { common: enCommon, runtimes: enRuntimes } };

vi.mock("@lumen/core/hooks", () => ({
  useWorkspaceId: () => "ws-test",
}));

vi.mock("@lumen/core/paths", () => ({
  paths: {
    workspace: () => ({
      agents: () => "/agents",
      runtimeDetail: () => "/runtimes/rt-test",
    }),
  },
  useWorkspaceSlug: () => "workspace-test",
}));

const wsEventState = vi.hoisted(() => ({
  handler: null as ((payload: unknown) => void) | null,
}));

vi.mock("@lumen/core/realtime", () => ({
  useWSEvent: (_event: string, handler: (payload: unknown) => void) => {
    wsEventState.handler = handler;
  },
}));

vi.mock("../../navigation", () => ({
  useNavigation: () => ({ push: vi.fn() }),
}));

function resetConfigStore() {
  configStore.setState({
    cdnDomain: "",
    allowSignup: true,
    googleClientId: "",
    daemonServerUrl: "",
    daemonAppUrl: "",
    workspaceCreationDisabled: false,
  });
}

function renderDialog(config?: {
  daemonServerUrl?: string;
  daemonAppUrl?: string;
}) {
  resetConfigStore();
  if (config) {
    configStore.getState().setDaemonConfig(config);
  }
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <I18nProvider locale="en" resources={TEST_RESOURCES}>
        <ConnectRemoteDialog onClose={vi.fn()} />
      </I18nProvider>
    </QueryClientProvider>,
  );
}

describe("ConnectRemoteDialog", () => {
  beforeEach(() => {
    wsEventState.handler = null;
  });

  it("uses cloud setup commands by default", () => {
    const { baseElement } = renderDialog();

    expect(baseElement).toHaveTextContent("lumen setup");
    expect(baseElement).not.toHaveTextContent("lumen setup self-host");
    expect(baseElement).toHaveTextContent(
      "lumen config set server_url https://api.lumen.ai",
    );
    expect(baseElement).toHaveTextContent(
      "lumen config set app_url https://lumen.ai",
    );
  });

  it("uses self-host daemon URLs from runtime config", () => {
    const { baseElement } = renderDialog({
      daemonServerUrl: "https://api.example.com/",
      daemonAppUrl: "https://app.example.com/",
    });

    expect(baseElement).toHaveTextContent(
      "lumen setup self-host --server-url https://api.example.com --app-url https://app.example.com",
    );
    expect(baseElement).toHaveTextContent(
      "lumen config set server_url https://api.example.com",
    );
    expect(baseElement).toHaveTextContent(
      "lumen config set app_url https://app.example.com",
    );
  });

  it("transitions from setup instructions to the connected state", async () => {
    const { baseElement } = renderDialog();

    expect(baseElement).toHaveTextContent("lumen setup");
    act(() => {
      wsEventState.handler?.({ runtime_id: "rt-test" });
    });

    await waitFor(() => {
      expect(screen.getByText("Computer connected")).toBeInTheDocument();
      expect(
        screen.getByRole("button", { name: "Create an agent" }),
      ).toBeInTheDocument();
    });
    expect(baseElement).not.toHaveTextContent("lumen setup");
  });
});
