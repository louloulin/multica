import "../global.css";

import { useEffect, useRef } from "react";
import { Stack, router } from "expo-router";
import { StatusBar } from "expo-status-bar";
import * as SystemUI from "expo-system-ui";
import { Platform } from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { KeyboardProvider } from "react-native-keyboard-controller";
import { QueryClientProvider, useQueryClient } from "@tanstack/react-query";
import { ThemeProvider } from "@react-navigation/native";
import { PortalHost } from "@rn-primitives/portal";
import { api } from "@/data/api";
import { queryClient } from "@/data/query-client";
import { useAuthStore } from "@/data/auth-store";
import { useWorkspaceStore } from "@/data/workspace-store";
import { useRuntimeConfigStore } from "@/data/runtime-config-store";
import { LightboxProvider, prewarmHighlighter } from "@/lib/markdown";
import { NAV_THEME } from "@/lib/theme";
import { getThemeColors, useColorScheme } from "@/lib/use-color-scheme";
import { shouldShowWelcome } from "@/lib/should-show-welcome";
import WelcomeScreen from "./(auth)/welcome";

// Kick off Shiki highlighter init at module load — fires once per process,
// finishes before the user navigates to any screen with a code block. If
// init fails (engine unavailable) the highlighter falls back to plain
// text; nothing here is allowed to throw.
prewarmHighlighter();

function AuthInitializer({ children }: { children: React.ReactNode }) {
  const initialize = useAuthStore((s) => s.initialize);
  const qc = useQueryClient();
  // Idempotent guard: 401 on multiple in-flight requests would otherwise
  // logout/navigate repeatedly during the same session-expire moment.
  const signingOutRef = useRef(false);

  useEffect(() => {
    // Wire 401 handling onto the shared ApiClient singleton. Must be set
    // before any request fires — initialize() below kicks off the first
    // getMe() call, so do this synchronously first.
    api.setOptions({
      onUnauthorized: () => {
        if (signingOutRef.current) return;
        signingOutRef.current = true;
        void (async () => {
          await useAuthStore.getState().logout();
          await useWorkspaceStore.getState().clear();
          qc.clear();
          router.replace("/login");
          // Reset on next tick so a fresh session can hit 401 again later
          // without being silently swallowed.
          setTimeout(() => {
            signingOutRef.current = false;
          }, 0);
        })();
      },
    });
    initialize();
  }, [initialize, qc]);

  return <>{children}</>;
}

/** Hydrates the runtime config store on mount, then keeps `api.baseUrl`
 *  in sync. Sits inside AuthInitializer so the ApiClient already has the
 *  correct base URL by the time the first getMe() call fires. */
function RuntimeConfigInitializer({ children }: { children: React.ReactNode }) {
  const hydrate = useRuntimeConfigStore((s) => s.hydrate);
  const status = useRuntimeConfigStore((s) => s.status);
  const apiUrl = useRuntimeConfigStore((s) => s.config.apiUrl);

  useEffect(() => {
    void hydrate();
  }, [hydrate]);

  useEffect(() => {
    if (status === "hydrated") api.setBaseUrl(apiUrl);
  }, [status, apiUrl]);

  return <>{children}</>;
}

export default function RootLayout() {
  const { colorScheme } = useColorScheme();
  const themeColors = getThemeColors(colorScheme);
  const status = useRuntimeConfigStore((s) => s.status);
  const hasUserChosenBackend = useRuntimeConfigStore(
    (s) => s.hasUserChosenBackend,
  );
  const config = useRuntimeConfigStore((s) => s.config);
  const showWelcome = shouldShowWelcome({
    status,
    hasUserChosenBackend,
    config,
  });

  useEffect(() => {
    if (Platform.OS !== "android") return;
    void SystemUI.setBackgroundColorAsync(themeColors.background).catch(() => {
      // No-op: theming should not fail app startup if the system call is unavailable.
    });
  }, [themeColors.background]);

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <KeyboardProvider>
          <QueryClientProvider client={queryClient}>
            <ThemeProvider value={NAV_THEME[colorScheme]}>
              <RuntimeConfigInitializer>
                <AuthInitializer>
                  <LightboxProvider>
                    <StatusBar
                      style={themeColors.statusBarStyle}
                      backgroundColor={
                        Platform.OS === "android" ? themeColors.background : undefined
                      }
                    />
                    {showWelcome ? (
                      <WelcomeScreen />
                    ) : (
                      <Stack screenOptions={{ headerShown: false }}>
                        <Stack.Screen name="index" />
                        <Stack.Screen name="(auth)" />
                        <Stack.Screen name="(app)" />
                      </Stack>
                    )}
                    <PortalHost />
                  </LightboxProvider>
                </AuthInitializer>
              </RuntimeConfigInitializer>
            </ThemeProvider>
          </QueryClientProvider>
        </KeyboardProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
