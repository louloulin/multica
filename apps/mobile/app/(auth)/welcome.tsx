/**
 * First-launch Welcome gate.
 *
 * Mirrors the desktop `welcome-gate.tsx`: a single full-screen route
 * that asks the user to choose between Multica Cloud and a self-hosted
 * instance before any auth/network call lands.
 *
 * This file lives under `app/(auth)/` for namespace hygiene but is
 * actually rendered by `app/_layout.tsx` *before* the `<Stack>` is
 * mounted (via the `shouldShowWelcome` gate), so it doesn't participate
 * in expo-router's navigation — there's no back button, no deep-link
 * entry, no auth-group stack. That matches the desktop semantics where
 * the gate is a one-shot modal, not a normal route.
 *
 * Mobile has no i18n infrastructure (apps/mobile/CLAUDE.md) so strings
 * are hardcoded English in `lib/runtime-config-strings.ts`. Swapping in
 * a `t(...)` lookup there is the only change needed when i18n lands.
 */
import { useState } from "react";
import {
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import * as Haptics from "expo-haptics";
import { router } from "expo-router";
import { Text } from "@/components/ui/text";
import { TextField } from "@/components/ui/text-field";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { MulticaLogo } from "@/components/brand/multica-logo";
import {
  DEFAULT_RUNTIME_CONFIG,
  normalizeHttpUrl,
} from "@/data/runtime-config";
import { useRuntimeConfigStore } from "@/data/runtime-config-store";
import { api } from "@/data/api";
import { RUNTIME_CONFIG_STRINGS } from "@/lib/runtime-config-strings";

export default function WelcomeScreen() {
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const chooseCloud = async () => {
    setBusy(true);
    try {
      void Haptics.selectionAsync();
      await useRuntimeConfigStore.getState().resetToDefault();
      api.setBaseUrl(DEFAULT_RUNTIME_CONFIG.apiUrl);
      router.replace("/login");
    } finally {
      setBusy(false);
    }
  };

  const connectSelfHost = async () => {
    setError(null);
    let normalized: string;
    try {
      normalized = normalizeHttpUrl(draft, "apiUrl");
    } catch {
      setError(RUNTIME_CONFIG_STRINGS.welcome.invalidUrl);
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      return;
    }
    setBusy(true);
    try {
      void Haptics.selectionAsync();
      await useRuntimeConfigStore.getState().setApiUrl(normalized);
      api.setBaseUrl(normalized);
      router.replace("/login");
    } finally {
      setBusy(false);
    }
  };

  return (
    <SafeAreaView className="flex-1 bg-background">
      <KeyboardAvoidingView
        className="flex-1"
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <ScrollView
          contentContainerClassName="px-6 py-10 gap-8"
          keyboardShouldPersistTaps="handled"
        >
          <View className="items-center gap-3">
            <MulticaLogo size={40} />
            <Text className="text-2xl font-semibold text-foreground text-center">
              {RUNTIME_CONFIG_STRINGS.welcome.title}
            </Text>
            <Text className="text-sm text-muted-foreground text-center">
              {RUNTIME_CONFIG_STRINGS.welcome.subtitle}
            </Text>
          </View>

          <View className="gap-3">
            <Button
              size="lg"
              variant="default"
              disabled={busy}
              onPress={chooseCloud}
            >
              <Text>
                {busy
                  ? RUNTIME_CONFIG_STRINGS.welcome.useCloudBusy
                  : RUNTIME_CONFIG_STRINGS.welcome.useCloud}
              </Text>
            </Button>
          </View>

          <View className="flex-row items-center gap-3">
            <Separator className="flex-1" />
            <Text className="text-xs uppercase tracking-wider text-muted-foreground">
              or
            </Text>
            <Separator className="flex-1" />
          </View>

          <View className="gap-3">
            <Text className="text-sm font-medium text-foreground">
              {RUNTIME_CONFIG_STRINGS.welcome.selfHostHeading}
            </Text>
            <View className="gap-1.5">
              <Text className="text-xs text-muted-foreground">
                {RUNTIME_CONFIG_STRINGS.welcome.selfHostLabel}
              </Text>
              <TextField
                value={draft}
                onChangeText={setDraft}
                placeholder={RUNTIME_CONFIG_STRINGS.welcome.selfHostPlaceholder}
                autoCapitalize="none"
                autoCorrect={false}
                keyboardType="url"
                returnKeyType="go"
                onSubmitEditing={connectSelfHost}
                editable={!busy}
                invalid={!!error}
              />
            </View>
            {error ? (
              <Text className="text-sm text-destructive">{error}</Text>
            ) : null}
            <Button
              size="lg"
              variant="secondary"
              disabled={busy || draft.trim().length === 0}
              onPress={connectSelfHost}
            >
              <Text>
                {busy
                  ? RUNTIME_CONFIG_STRINGS.welcome.selfHostBusy
                  : RUNTIME_CONFIG_STRINGS.welcome.selfHostConnect}
              </Text>
            </Button>
          </View>

          <Text className="text-xs text-muted-foreground text-center">
            {RUNTIME_CONFIG_STRINGS.welcome.footerNote}
          </Text>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}