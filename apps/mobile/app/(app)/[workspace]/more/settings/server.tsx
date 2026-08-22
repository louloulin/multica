/**
 * Settings → Backend subscreen — lets a signed-in user switch between
 * Multica Cloud and a self-hosted backend at runtime.
 *
 * Mirrors `apps/desktop/src/renderer/src/components/backend-settings-tab.tsx`
 * (desktop Settings tab). Differences are mobile-only:
 *   - Lives under `app/(app)/[workspace]/more/settings/server.tsx` so
 *     it inherits the standard Settings subscreen pattern (Stack push,
 *     title in body). Desktop uses an Electron Modal; mobile is a route.
 *   - Test connection uses an in-app `fetch(${url}/health)` with an
 *     AbortSignal timeout. The backend may not expose `/health` —
 *     that's fine, a 404 still counts as "reachable" for the user's
 *     intent ("the URL answers"), so we treat anything not throwing
 *     within 5s as reachable. Mirrors the desktop semantics.
 *   - Reset-to-cloud requires typing the literal "multica.ai" so a
 *     accidental tap on a destructive button doesn't wipe a working
 *     self-host configuration. Same guard as desktop.
 *
 * Saving the URL clears the auth token + workspace + query cache and
 * routes to `/login`. The previous JWT was issued by the old backend, so
 * keeping it around produces 401-loops on every subsequent fetch —
 * the AuthInitializer's `onUnauthorized` hook would eventually catch
 * that, but clearing proactively is cleaner.
 */
import { useState } from "react";
import { Alert, ScrollView, View } from "react-native";
import { router } from "expo-router";
import { useQueryClient } from "@tanstack/react-query";
import * as Haptics from "expo-haptics";
import { Text } from "@/components/ui/text";
import { TextField } from "@/components/ui/text-field";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { useAuthStore } from "@/data/auth-store";
import { useWorkspaceStore } from "@/data/workspace-store";
import {
  DEFAULT_RUNTIME_CONFIG,
  deriveAppUrl,
  deriveWsUrl,
  normalizeHttpUrl,
} from "@/data/runtime-config";
import { useRuntimeConfigStore } from "@/data/runtime-config-store";
import { api } from "@/data/api";
import { RUNTIME_CONFIG_STRINGS } from "@/lib/runtime-config-strings";

type TestResult = "idle" | "ok" | "fail";

const RESET_CONFIRM_TOKEN = "multica.ai";
const TEST_TIMEOUT_MS = 5_000;

export default function ServerSettingsScreen() {
  const config = useRuntimeConfigStore((s) => s.config);
  const hasUserChosenBackend = useRuntimeConfigStore(
    (s) => s.hasUserChosenBackend,
  );
  const qc = useQueryClient();
  const logout = useAuthStore((s) => s.logout);
  const clearWorkspace = useWorkspaceStore((s) => s.clear);

  const [draft, setDraft] = useState(config.apiUrl);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<TestResult>("idle");
  const [resetConfirm, setResetConfirm] = useState("");

  const onSave = async () => {
    let normalized: string;
    try {
      normalized = normalizeHttpUrl(draft, "apiUrl");
    } catch {
      Alert.alert(
        RUNTIME_CONFIG_STRINGS.settings.saveFailAlertTitle,
        RUNTIME_CONFIG_STRINGS.welcome.invalidUrl,
      );
      return;
    }
    setSaving(true);
    try {
      void Haptics.selectionAsync();
      await useRuntimeConfigStore.getState().setApiUrl(normalized);
      api.setBaseUrl(normalized);
      await clearWorkspace();
      await logout();
      qc.clear();
      router.replace("/login");
    } catch (err) {
      Alert.alert(
        RUNTIME_CONFIG_STRINGS.settings.saveFailAlertTitle,
        err instanceof Error ? err.message : "Unknown error",
      );
    } finally {
      setSaving(false);
    }
  };

  const onTest = async () => {
    let normalized: string;
    try {
      normalized = normalizeHttpUrl(draft, "apiUrl");
    } catch {
      setTestResult("fail");
      return;
    }
    setTesting(true);
    setTestResult("idle");
    try {
      const res = await fetch(`${normalized}/health`, {
        method: "GET",
        signal: AbortSignal.timeout(TEST_TIMEOUT_MS),
      });
      // Backend may not expose /health — any HTTP response means the URL
      // answered. Network errors / timeouts → fail.
      setTestResult(res.status >= 200 && res.status < 500 ? "ok" : "fail");
    } catch {
      setTestResult("fail");
    } finally {
      setTesting(false);
    }
  };

  const onReset = async () => {
    if (resetConfirm.trim() !== RESET_CONFIRM_TOKEN) return;
    setSaving(true);
    try {
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
      await useRuntimeConfigStore.getState().resetToDefault();
      api.setBaseUrl(DEFAULT_RUNTIME_CONFIG.apiUrl);
      await clearWorkspace();
      await logout();
      qc.clear();
      router.replace("/login");
    } finally {
      setSaving(false);
    }
  };

  return (
    <ScrollView
      className="flex-1 bg-background"
      contentContainerClassName="px-4 py-6 gap-8"
      keyboardShouldPersistTaps="handled"
    >
      <View className="gap-4">
        <View className="gap-1">
          <Text className="text-xs text-muted-foreground">
            {RUNTIME_CONFIG_STRINGS.settings.apiUrlLabel}
          </Text>
          <TextField
            value={draft}
            onChangeText={setDraft}
            placeholder={RUNTIME_CONFIG_STRINGS.settings.apiUrlPlaceholder}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="url"
            editable={!saving}
          />
        </View>

        <View className="flex-row gap-3">
          <Button
            variant="default"
            disabled={saving || draft.trim().length === 0}
            onPress={onSave}
          >
            <Text>
              {saving
                ? RUNTIME_CONFIG_STRINGS.settings.saving
                : RUNTIME_CONFIG_STRINGS.settings.save}
            </Text>
          </Button>
          <Button
            variant="secondary"
            disabled={testing || draft.trim().length === 0}
            onPress={onTest}
          >
            <Text>
              {testing
                ? RUNTIME_CONFIG_STRINGS.settings.testingConnection
                : RUNTIME_CONFIG_STRINGS.settings.testConnection}
            </Text>
          </Button>
        </View>
        {testResult === "ok" ? (
          <Text className="text-sm text-emerald-600 dark:text-emerald-400">
            {RUNTIME_CONFIG_STRINGS.settings.testOk}
          </Text>
        ) : null}
        {testResult === "fail" ? (
          <Text className="text-sm text-destructive">
            {RUNTIME_CONFIG_STRINGS.settings.testFail}
          </Text>
        ) : null}
      </View>

      <Separator />

      <View className="gap-2">
        <Text className="text-xs uppercase tracking-wider text-muted-foreground px-1">
          {RUNTIME_CONFIG_STRINGS.settings.diagnosticsHeading}
        </Text>
        <View className="rounded-md border border-border bg-card overflow-hidden">
          <DiagnosticRow
            label={RUNTIME_CONFIG_STRINGS.settings.diagnosticsApiUrlLabel}
            value={config.apiUrl}
          />
          <Separator />
          <DiagnosticRow
            label={RUNTIME_CONFIG_STRINGS.settings.diagnosticsWsUrlLabel}
            value={deriveWsUrl(config.apiUrl)}
          />
          <Separator />
          <DiagnosticRow
            label={RUNTIME_CONFIG_STRINGS.settings.diagnosticsAppUrlLabel}
            value={deriveAppUrl(config.apiUrl)}
          />
          <Separator />
          <DiagnosticRow
            label={RUNTIME_CONFIG_STRINGS.settings.diagnosticsSourceLabel}
            value={
              hasUserChosenBackend
                ? RUNTIME_CONFIG_STRINGS.settings.diagnosticsSourceSecureStore
                : RUNTIME_CONFIG_STRINGS.settings.diagnosticsSourceBuildTime
            }
          />
        </View>
      </View>

      <View className="gap-3 rounded-md border border-border bg-card p-4">
        <Text className="text-sm font-medium text-foreground">
          {RUNTIME_CONFIG_STRINGS.settings.resetHeading}
        </Text>
        <Text className="text-sm text-muted-foreground">
          {RUNTIME_CONFIG_STRINGS.settings.resetDescription}
        </Text>
        <TextField
          value={resetConfirm}
          onChangeText={setResetConfirm}
          placeholder={RUNTIME_CONFIG_STRINGS.settings.resetConfirmPlaceholder}
          autoCapitalize="none"
          autoCorrect={false}
          editable={!saving}
        />
        <Button
          variant="destructive"
          disabled={saving || resetConfirm.trim() !== RESET_CONFIRM_TOKEN}
          onPress={onReset}
        >
          <Text>
            {saving
              ? RUNTIME_CONFIG_STRINGS.settings.resetBusy
              : RUNTIME_CONFIG_STRINGS.settings.resetButton}
          </Text>
        </Button>
      </View>

      <Text className="text-xs text-muted-foreground">
        {RUNTIME_CONFIG_STRINGS.settings.description}
      </Text>
    </ScrollView>
  );
}

function DiagnosticRow({
  label,
  value,
}: {
  label: string;
  value: string;
}) {
  return (
    <View className="px-4 py-3 gap-1">
      <Text className="text-xs uppercase tracking-wider text-muted-foreground">
        {label}
      </Text>
      <Text className="text-sm font-medium text-foreground" selectable>
        {value}
      </Text>
    </View>
  );
}