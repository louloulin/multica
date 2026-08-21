import { useCallback, useState } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@multica/ui/components/ui/button";
import { Input } from "@multica/ui/components/ui/input";
import { MulticaIcon } from "@multica/ui/components/common/multica-icon";
import { DragStrip } from "@multica/views/platform";
import { useT } from "@multica/views/i18n";
import {
  DEFAULT_RUNTIME_CONFIG,
  RUNTIME_CONFIG_SCHEMA_VERSION,
  deriveAppUrl,
  deriveWsUrl,
  type RuntimeConfig,
} from "../../../shared/runtime-config";

interface WelcomeGateProps {
  onSaved?: () => void;
}

type SaveStatus =
  | { status: "idle" }
  | { status: "saving" }
  | { status: "error"; message: string };

function apiUrlToConfig(rawApiUrl: string): RuntimeConfig {
  const apiUrl = rawApiUrl.trim();
  return {
    schemaVersion: RUNTIME_CONFIG_SCHEMA_VERSION,
    apiUrl,
    wsUrl: deriveWsUrl(apiUrl),
    appUrl: deriveAppUrl(apiUrl),
  };
}

export function WelcomeGate({ onSaved }: WelcomeGateProps) {
  const { t } = useT("settings");
  const [showSelfHost, setShowSelfHost] = useState(false);
  const [apiUrl, setApiUrl] = useState("");
  const [saveStatus, setSaveStatus] = useState<SaveStatus>({ status: "idle" });

  const promptRestart = useCallback(() => {
    toast.success(t(($) => $.desktop.welcome.saved_toast), {
      id: "welcome-save",
      duration: 10_000,
      action: {
        label: t(($) => $.desktop.welcome.restart_now),
        onClick: () => {
          void window.desktopAPI.requestAppRestart();
        },
      },
    });
    onSaved?.();
  }, [t, onSaved]);

  const saveConfig = useCallback(
    async (config: RuntimeConfig): Promise<void> => {
      setSaveStatus({ status: "saving" });
      try {
        const result = await window.desktopAPI.updateRuntimeConfig(config);
        if (!result.ok) {
          setSaveStatus({ status: "error", message: result.error });
          toast.error(
            result.error ||
              t(($) => $.desktop.welcome.error_save),
          );
          return;
        }
        setSaveStatus({ status: "idle" });
        promptRestart();
      } catch (err) {
        const message =
          err instanceof Error ? err.message : String(err);
        setSaveStatus({ status: "error", message });
        toast.error(message);
      }
    },
    [promptRestart, t],
  );

  const handleUseCloud = useCallback(() => {
    void saveConfig(DEFAULT_RUNTIME_CONFIG);
  }, [saveConfig]);

  const handleSaveSelfHost = useCallback(() => {
    const trimmed = apiUrl.trim();
    if (!trimmed) return;
    try {
      void saveConfig(apiUrlToConfig(trimmed));
    } catch (err) {
      const message =
        err instanceof Error ? err.message : String(err);
      setSaveStatus({ status: "error", message });
      toast.error(message);
    }
  }, [apiUrl, saveConfig]);

  const selfHostSaveDisabled =
    saveStatus.status === "saving" || apiUrl.trim().length === 0;

  return (
    <div className="flex h-screen flex-col bg-background text-foreground">
      <DragStrip />
      <div className="flex min-h-0 flex-1 items-center justify-center px-6 py-10">
        <div className="w-full max-w-md rounded-lg border bg-card p-8 shadow-sm">
          <div className="flex flex-col items-center gap-3 text-center">
            <MulticaIcon bordered size="lg" />
            <h1 className="text-title font-semibold">
              {t(($) => $.desktop.welcome.title)}
            </h1>
            <p className="text-body text-muted-foreground">
              {t(($) => $.desktop.welcome.subtitle)}
            </p>
          </div>

          <div className="mt-8 flex flex-col gap-3">
            <Button
              onClick={handleUseCloud}
              disabled={saveStatus.status === "saving"}
              size="lg"
              className="w-full"
              data-testid="welcome-use-cloud"
            >
              {saveStatus.status === "saving" ? (
                <>
                  <Loader2 className="size-4 animate-spin" />
                  {t(($) => $.desktop.welcome.use_cloud_saving)}
                </>
              ) : (
                t(($) => $.desktop.welcome.use_cloud)
              )}
            </Button>

            {!showSelfHost ? (
              <Button
                variant="outline"
                size="lg"
                className="w-full"
                onClick={() => setShowSelfHost(true)}
                data-testid="welcome-connect-selfhost"
              >
                {t(($) => $.desktop.welcome.connect_selfhost)}
              </Button>
            ) : (
              <div className="rounded-md border bg-muted/30 p-4">
                <label
                  htmlFor="welcome-selfhost-url"
                  className="text-caption font-medium text-foreground"
                >
                  {t(($) => $.desktop.welcome.selfhost_label)}
                </label>
                <Input
                  id="welcome-selfhost-url"
                  type="url"
                  name="welcome-selfhost-url"
                  autoComplete="off"
                  spellCheck={false}
                  value={apiUrl}
                  placeholder={t(($) => $.desktop.welcome.selfhost_placeholder)}
                  aria-label={t(($) => $.desktop.welcome.selfhost_label)}
                  onChange={(event) => setApiUrl(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" && !selfHostSaveDisabled) {
                      event.preventDefault();
                      handleSaveSelfHost();
                    }
                  }}
                  className="mt-2 font-mono"
                  size={undefined}
                  data-testid="welcome-selfhost-input"
                />
                <Button
                  onClick={handleSaveSelfHost}
                  disabled={selfHostSaveDisabled}
                  size="sm"
                  className="mt-3 w-full"
                  data-testid="welcome-selfhost-save"
                >
                  {saveStatus.status === "saving" ? (
                    <>
                      <Loader2 className="size-3.5 animate-spin" />
                      {t(($) => $.desktop.welcome.selfhost_saving)}
                    </>
                  ) : (
                    t(($) => $.desktop.welcome.selfhost_save)
                  )}
                </Button>
              </div>
            )}
          </div>

          <p className="mt-6 text-center text-caption text-muted-foreground">
            {t(($) => $.desktop.welcome.footer_note)}
          </p>
        </div>
      </div>
    </div>
  );
}
