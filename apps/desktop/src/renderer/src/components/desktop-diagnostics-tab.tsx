import { useCallback, useEffect, useMemo, useState } from "react";
import { Bug, Copy, Trash2 } from "lucide-react";
import { clientDiagnostics, type ClientDiagnosticEvent } from "@lumen/core/diagnostics";
import { defaultStorage } from "@lumen/core/platform";
import { Button } from "@lumen/ui/components/ui/button";
import { Switch } from "@lumen/ui/components/ui/switch";
import { SettingsCard, SettingsRow, SettingsSection, SettingsTab } from "@lumen/views/settings";
import { useT } from "@lumen/views/i18n";
import { toast } from "sonner";

const DEBUG_STORAGE_KEY = "lumen:desktop-debug:v1";
const MAX_RENDERED_EVENTS = 200;

type DebugPreference = { version: 1; debugEnabled: boolean };

function readPreference(): boolean {
  try {
    const raw = defaultStorage.getItem(DEBUG_STORAGE_KEY);
    if (!raw) return false;
    const value = JSON.parse(raw) as Partial<DebugPreference>;
    return value.version === 1 && value.debugEnabled === true;
  } catch {
    return false;
  }
}

function writePreference(debugEnabled: boolean): void {
  defaultStorage.setItem(
    DEBUG_STORAGE_KEY,
    JSON.stringify({ version: 1, debugEnabled } satisfies DebugPreference),
  );
}

function mergeEvents(
  localEvents: readonly ClientDiagnosticEvent[],
  mainEvents: readonly ClientDiagnosticEvent[],
): ClientDiagnosticEvent[] {
  return [...localEvents, ...mainEvents]
    .sort((left, right) => right.timestamp - left.timestamp)
    .slice(0, MAX_RENDERED_EVENTS);
}

export function DesktopDiagnosticsTab() {
  const { t } = useT("settings");
  const [enabled, setEnabled] = useState(false);
  const [events, setEvents] = useState<readonly ClientDiagnosticEvent[]>([]);
  const [mainDroppedCount, setMainDroppedCount] = useState(0);
  const [category, setCategory] = useState<"all" | ClientDiagnosticEvent["category"]>("all");

  const refreshMain = useCallback(async () => {
    const snapshot = await window.desktopAPI.getDiagnostics();
    setMainDroppedCount(snapshot.droppedCount);
    setEnabled(snapshot.enabled || readPreference());
    setEvents((current) => mergeEvents(current, snapshot.events));
  }, []);

  useEffect(() => {
    const initialEnabled = readPreference();
    setEnabled(initialEnabled);
    clientDiagnostics.setEnabled(initialEnabled);
    void window.desktopAPI.setDiagnosticsEnabled(initialEnabled);
    void refreshMain();

    const unsubscribeLocal = clientDiagnostics.subscribe((event) => {
      setEvents((current) => mergeEvents([event, ...current], []));
    });
    const unsubscribeMain = window.desktopAPI.onDiagnosticEvent((event) => {
      setEvents((current) => mergeEvents(current, [event]));
    });
    return () => {
      unsubscribeLocal();
      unsubscribeMain();
    };
  }, [refreshMain]);

  const filteredEvents = useMemo(
    () =>
      category === "all"
        ? events
        : events.filter((event) => event.category === category),
    [category, events],
  );

  const activeOperations = useMemo(() => {
    const latest = new Map<string, ClientDiagnosticEvent>();
    for (const event of [...events].reverse()) latest.set(event.operation, event);
    return [...latest.values()]
      .filter((event) => event.phase === "started")
      .map((event) => event.operation);
  }, [events]);

  const setDebugEnabled = useCallback(async (next: boolean) => {
    writePreference(next);
    setEnabled(next);
    clientDiagnostics.setEnabled(next);
    await window.desktopAPI.setDiagnosticsEnabled(next);
    if (!next) {
      setEvents([]);
      setMainDroppedCount(0);
    }
  }, []);

  const clearEvents = useCallback(async () => {
    clientDiagnostics.clear();
    await window.desktopAPI.clearDiagnostics();
    setEvents([]);
    setMainDroppedCount(0);
  }, []);

  const copyEvents = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(JSON.stringify(filteredEvents, null, 2));
      toast.success(t(($) => $.desktop.diagnostics.copied));
    } catch {
      toast.error(t(($) => $.desktop.diagnostics.copy_failed));
    }
  }, [filteredEvents, t]);

  return (
    <SettingsTab
      title={t(($) => $.desktop.diagnostics.title)}
      description={t(($) => $.desktop.diagnostics.description)}
    >
      <SettingsCard>
        <SettingsRow
          label={t(($) => $.desktop.diagnostics.enable_label)}
          description={t(($) => $.desktop.diagnostics.enable_description)}
        >
          <Switch
            aria-label={t(($) => $.desktop.diagnostics.enable_label)}
            checked={enabled}
            onCheckedChange={(next) => void setDebugEnabled(next)}
          />
        </SettingsRow>
      </SettingsCard>

      <SettingsSection
        title={t(($) => $.desktop.diagnostics.events_title)}
        description={t(($) => $.desktop.diagnostics.events_description)}
        action={
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={() => void copyEvents()} disabled={!filteredEvents.length}>
              <Copy className="mr-1.5 size-3.5" />
              {t(($) => $.desktop.diagnostics.copy)}
            </Button>
            <Button variant="outline" size="sm" onClick={() => void clearEvents()} disabled={!events.length}>
              <Trash2 className="mr-1.5 size-3.5" />
              {t(($) => $.desktop.diagnostics.clear)}
            </Button>
          </div>
        }
      >
        <SettingsCard>
          <div className="flex flex-wrap items-center gap-3 px-4 py-3">
            <Bug className="size-4 text-muted-foreground" aria-hidden="true" />
            <select
              className="h-8 rounded-md border border-input bg-background px-2 text-caption"
              aria-label={t(($) => $.desktop.diagnostics.filter)}
              value={category}
              onChange={(event) => setCategory(event.target.value as typeof category)}
            >
              <option value="all">{t(($) => $.desktop.diagnostics.all_categories)}</option>
              {(["request", "daemon", "ipc", "renderer", "realtime", "polling", "auth"] as const).map((item) => (
                <option key={item} value={item}>{item}</option>
              ))}
            </select>
            <span className="text-caption text-muted-foreground">
              {t(($) => $.desktop.diagnostics.event_count, { count: filteredEvents.length })}
            </span>
            <span className="text-caption text-muted-foreground">
              {t(($) => $.desktop.diagnostics.dropped_count, { count: mainDroppedCount })}
            </span>
          </div>
          {activeOperations.length > 0 && (
            <div className="border-t border-surface-border px-4 py-3 text-caption text-muted-foreground">
              {t(($) => $.desktop.diagnostics.active_operations)}: {activeOperations.join(", ")}
            </div>
          )}
          <div className="max-h-[32rem] overflow-auto border-t border-surface-border">
            {filteredEvents.length === 0 ? (
              <p className="px-4 py-8 text-center text-caption text-muted-foreground">
                {enabled ? t(($) => $.desktop.diagnostics.empty) : t(($) => $.desktop.diagnostics.disabled)}
              </p>
            ) : (
              <pre className="p-4 text-[11px] leading-5 text-muted-foreground">{JSON.stringify(filteredEvents, null, 2)}</pre>
            )}
          </div>
        </SettingsCard>
      </SettingsSection>
    </SettingsTab>
  );
}
