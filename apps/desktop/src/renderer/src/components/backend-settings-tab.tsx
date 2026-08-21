import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertCircle,
  Check,
  Globe,
  Loader2,
  RotateCcw,
} from "lucide-react";
import { Button } from "@multica/ui/components/ui/button";
import { Input } from "@multica/ui/components/ui/input";
import { useT } from "@multica/views/i18n";
import {
  SettingsCard,
  SettingsRow,
  SettingsSaveState,
  SettingsSection,
  SettingsTab,
} from "@multica/views/settings";
import {
  DEFAULT_RUNTIME_CONFIG,
  RUNTIME_CONFIG_SCHEMA_VERSION,
  deriveAppUrl,
  deriveWsUrl,
  type RuntimeConfig,
} from "../../../shared/runtime-config";
import { toast } from "sonner";
import { useAutoSave } from "@multica/views/settings";

// What the user is editing. Both overrides are normally empty — the form
// pre-fills them with the derived URL so the field shows the value that
// will actually be persisted, and blanks mean "use the derivation".
interface BackendDraft {
  apiUrl: string;
  webOverride: string;
  wsOverride: string;
}

function configToDraft(config: RuntimeConfig): BackendDraft {
  return {
    apiUrl: config.apiUrl,
    webOverride: config.appUrl === deriveAppUrl(config.apiUrl) ? "" : config.appUrl,
    wsOverride: config.wsUrl === deriveWsUrl(config.apiUrl) ? "" : config.wsUrl,
  };
}

function draftToConfig(draft: BackendDraft): RuntimeConfig {
  const apiUrl = draft.apiUrl.trim();
  const wsUrl = draft.wsOverride.trim() || deriveWsUrl(apiUrl);
  const appUrl = draft.webOverride.trim() || deriveAppUrl(apiUrl);
  return {
    schemaVersion: RUNTIME_CONFIG_SCHEMA_VERSION,
    apiUrl,
    wsUrl,
    appUrl,
  };
}

function draftsEqual(left: BackendDraft, right: BackendDraft): boolean {
  return (
    left.apiUrl.trim() === right.apiUrl.trim() &&
    left.webOverride.trim() === right.webOverride.trim() &&
    left.wsOverride.trim() === right.wsOverride.trim()
  );
}

type TestState =
  | { status: "idle" }
  | { status: "testing" }
  | { status: "ok" }
  | { status: "error"; message: string };

export function BackendSettingsTab() {
  const { t } = useT("settings");
  const initialConfig: RuntimeConfig = useMemo(() => {
    const rc = window.desktopAPI.runtimeConfig;
    return rc.ok ? rc.config : DEFAULT_RUNTIME_CONFIG;
  }, []);

  const [draft, setDraft] = useState<BackendDraft>(() =>
    configToDraft(initialConfig),
  );
  const [savedDraft, setSavedDraft] = useState<BackendDraft>(() =>
    configToDraft(initialConfig),
  );
  const [configPresent, setConfigPresent] = useState<boolean | null>(null);
  const [testState, setTestState] = useState<TestState>({ status: "idle" });
  const [resetBusy, setResetBusy] = useState(false);
  const [resetConfirmText, setResetConfirmText] = useState("");

  useEffect(() => {
    let mounted = true;
    void window.desktopAPI.isRuntimeConfigPresent().then((present) => {
      if (mounted) setConfigPresent(present);
    });
    return () => {
      mounted = false;
    };
  }, []);

  const savedConfig = useMemo(() => draftToConfig(savedDraft), [savedDraft]);

  const saveBackend = useCallback(
    async (next: BackendDraft): Promise<void> => {
      const config = draftToConfig(next);
      const result = await window.desktopAPI.updateRuntimeConfig(config);
      if (!result.ok) {
        throw new Error(result.error);
      }
      setSavedDraft(next);
      setConfigPresent(true);
    },
    [],
  );

  const autoSave = useAutoSave({
    value: draft,
    savedValue: savedDraft,
    onSave: saveBackend,
    onSuccess: () => {
      toast.success(t(($) => $.desktop.backend.saved_toast), {
        id: "settings-auto-save",
        duration: 10_000,
        action: {
          label: t(($) => $.desktop.backend.restart_now),
          onClick: () => {
            void window.desktopAPI.requestAppRestart();
          },
        },
      });
    },
    onError: (error: unknown) => {
      toast.error(
        error instanceof Error
          ? error.message
          : t(($) => $.desktop.backend.save_failed),
      );
    },
    isEqual: draftsEqual,
  });

  const handleTest = useCallback(async () => {
    const target = draftToConfig(draft).apiUrl;
    if (!target) return;
    setTestState({ status: "testing" });
    try {
      // The /api/config endpoint is the same one SELF_HOSTING.md exposes as
      // a public reachability probe. A 2xx is enough — we don't need the
      // payload, only confirmation that the URL serves Multica.
      const response = await fetch(`${target.replace(/\/+$/, "")}/api/config`, {
        method: "GET",
        headers: { Accept: "application/json" },
      });
      if (!response.ok) {
        setTestState({
          status: "error",
          message: `HTTP ${response.status}`,
        });
        return;
      }
      setTestState({ status: "ok" });
    } catch (err) {
      setTestState({
        status: "error",
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }, [draft]);

  const handleReset = useCallback(async () => {
    setResetBusy(true);
    try {
      const result = await window.desktopAPI.clearRuntimeConfig();
      if (!result.ok) {
        toast.error(
          t(($) => $.desktop.backend.reset_failed, { error: result.error }),
        );
        return;
      }
      setConfigPresent(false);
      setResetConfirmText("");
      const next = configToDraft(DEFAULT_RUNTIME_CONFIG);
      setDraft(next);
      setSavedDraft(next);
      toast.success(t(($) => $.desktop.backend.reset_toast), {
        id: "settings-auto-save",
        duration: 10_000,
        action: {
          label: t(($) => $.desktop.backend.restart_now),
          onClick: () => {
            void window.desktopAPI.requestAppRestart();
          },
        },
      });
    } finally {
      setResetBusy(false);
    }
  }, [t]);

  const showAdvanced = draft.webOverride.trim().length > 0 || draft.wsOverride.trim().length > 0;
  const resetConfirmed = resetConfirmText.trim() === "multica.ai";

  return (
    <SettingsTab
      title={t(($) => $.desktop.backend.title)}
      description={t(($) => $.desktop.backend.description)}
    >
      <SettingsCard>
        <SettingsRow
          label={t(($) => $.desktop.backend.api_url_label)}
          description={
            configPresent === false
              ? t(($) => $.desktop.backend.first_run_banner_body)
              : undefined
          }
        >
          <Input
            type="url"
            name="backend-api-url"
            autoComplete="off"
            spellCheck={false}
            value={draft.apiUrl}
            placeholder={t(($) => $.desktop.backend.api_url_placeholder)}
            aria-label={t(($) => $.desktop.backend.api_url_label)}
            onChange={(event) =>
              setDraft((prev) => ({ ...prev, apiUrl: event.target.value }))
            }
            onBlur={() => autoSave.flush()}
            size={undefined}
            className="font-mono"
          />
        </SettingsRow>

        <SettingsRow
          label={t(($) => $.desktop.backend.test_connection)}
          align="start"
          description={
            testState.status === "ok" ? (
              <span className="inline-flex items-center gap-1.5 text-success">
                <Check className="size-3.5" />
                {t(($) => $.desktop.backend.test_ok)}
              </span>
            ) : testState.status === "error" ? (
              <span className="inline-flex items-center gap-1.5 text-destructive">
                <AlertCircle className="size-3.5" />
                {t(($) => $.desktop.backend.test_failed, {
                  message: testState.message,
                })}
              </span>
            ) : (
              t(($) => $.desktop.backend.card_server_description)
            )
          }
        >
          <Button
            variant="outline"
            size="sm"
            onClick={handleTest}
            disabled={testState.status === "testing" || !draft.apiUrl.trim()}
          >
            {testState.status === "testing" ? (
              <>
                <Loader2 className="size-3.5 animate-spin" />
                {t(($) => $.desktop.backend.testing_connection)}
              </>
            ) : (
              t(($) => $.desktop.backend.test_connection)
            )}
          </Button>
        </SettingsRow>

        <SettingsRow
          label={t(($) => $.auto_save.saving).length === 0 ? "Save" : ""}
          description={t(($) => $.desktop.backend.card_server_description)}
        >
          <SettingsSaveState
            status={autoSave.status}
            savingLabel={t(($) => $.auto_save.saving)}
            savedLabel={t(($) => $.auto_save.saved)}
            errorLabel={t(($) => $.auto_save.failed)}
          />
        </SettingsRow>
      </SettingsCard>

      {showAdvanced ? (
        <SettingsSection
          title={t(($) => $.desktop.backend.web_url_label).includes("override") ? "Advanced overrides" : "Advanced"}
        >
          <SettingsCard>
            <SettingsRow
              label={t(($) => $.desktop.backend.web_url_label)}
            >
              <Input
                type="url"
                name="backend-web-url"
                autoComplete="off"
                spellCheck={false}
                value={draft.webOverride}
                placeholder={t(($) => $.desktop.backend.web_url_placeholder)}
                aria-label={t(($) => $.desktop.backend.web_url_label)}
                onChange={(event) =>
                  setDraft((prev) => ({ ...prev, webOverride: event.target.value }))
                }
                onBlur={() => autoSave.flush()}
                className="font-mono"
              />
            </SettingsRow>

            <SettingsRow
              label={t(($) => $.desktop.backend.ws_url_label)}
            >
              <Input
                type="url"
                name="backend-ws-url"
                autoComplete="off"
                spellCheck={false}
                value={draft.wsOverride}
                placeholder={t(($) => $.desktop.backend.ws_url_placeholder)}
                aria-label={t(($) => $.desktop.backend.ws_url_label)}
                onChange={(event) =>
                  setDraft((prev) => ({ ...prev, wsOverride: event.target.value }))
                }
                onBlur={() => autoSave.flush()}
                className="font-mono"
              />
            </SettingsRow>
          </SettingsCard>
        </SettingsSection>
      ) : null}

      <SettingsSection
        title="Diagnostics"
        description="URLs Multica Desktop is currently using. The derived values come from the API URL — set the override fields above to change them."
      >
        <SettingsCard>
          <div className="px-4 py-3 space-y-1.5">
            <DiagnosticsRow
              icon={<Globe className="size-3.5 text-muted-foreground" />}
              label="API"
              value={savedConfig.apiUrl}
            />
            <DiagnosticsRow
              icon={<Globe className="size-3.5 text-muted-foreground" />}
              label="Web"
              value={savedConfig.appUrl}
            />
            <DiagnosticsRow
              icon={<Globe className="size-3.5 text-muted-foreground" />}
              label="WebSocket"
              value={savedConfig.wsUrl}
            />
          </div>
        </SettingsCard>
      </SettingsSection>

      <SettingsSection
        title={t(($) => $.desktop.backend.reset_card_title)}
        description={t(($) => $.desktop.backend.reset_card_description)}
      >
        <SettingsCard>
          <SettingsRow
            label={t(($) => $.desktop.backend.reset_confirm_label)}
            align="start"
          >
            <div className="flex w-full flex-col gap-2 sm:w-96">
              <Input
                type="text"
                name="backend-reset-confirm"
                autoComplete="off"
                value={resetConfirmText}
                placeholder={t(($) => $.desktop.backend.reset_confirm_placeholder)}
                onChange={(event) => setResetConfirmText(event.target.value)}
              />
              <Button
                variant="destructive"
                size="sm"
                onClick={handleReset}
                disabled={!resetConfirmed || resetBusy}
              >
                {resetBusy ? (
                  <>
                    <Loader2 className="size-3.5 animate-spin" />
                    {t(($) => $.desktop.backend.reset_button_busy)}
                  </>
                ) : (
                  <>
                    <RotateCcw className="size-3.5" />
                    {t(($) => $.desktop.backend.reset_button)}
                  </>
                )}
              </Button>
            </div>
          </SettingsRow>
        </SettingsCard>
      </SettingsSection>
    </SettingsTab>
  );
}

function DiagnosticsRow({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
}) {
  return (
    <div className="grid grid-cols-[140px_minmax(0,1fr)] items-baseline gap-3 py-0.5">
      <span className="inline-flex items-center gap-1.5 text-caption text-muted-foreground">
        {icon}
        {label}
      </span>
      <span
        className="min-w-0 truncate font-mono text-caption"
        title={value}
      >
        {value}
      </span>
    </div>
  );
}