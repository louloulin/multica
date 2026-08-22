/**
 * i18n-ready namespace for the runtime backend URL flow (Welcome gate +
 * Settings → Backend subscreen). Mirrors the desktop fluent keys
 * (`desktop.welcome.*`, `desktop.backend.*`) so a future mobile i18n
 * migration can adopt the same names without renaming every call site.
 *
 * English-only by design — apps/mobile/CLAUDE.md confirms mobile has no
 * i18n infrastructure yet ("hardcoded English (mobile has no i18n infra
 * yet)"). When i18n lands, replace each const with a `t("...")` lookup
 * inside the component; the namespace shape is already compatible.
 */
export const RUNTIME_CONFIG_STRINGS = {
  welcome: {
    title: "Welcome to Multica",
    subtitle: "Choose how you want to connect.",
    useCloud: "Use Multica Cloud",
    useCloudBusy: "Connecting...",
    selfHostHeading: "Connect to a self-hosted instance",
    selfHostLabel: "Backend URL",
    selfHostPlaceholder: "https://api.your-multica.example",
    selfHostConnect: "Connect",
    selfHostBusy: "Connecting...",
    invalidUrl: "Enter a valid http(s) URL.",
    footerNote: "You can change this later in Settings → Backend.",
  },
  settings: {
    title: "Backend",
    description:
      "Switch between Multica Cloud and a self-hosted instance. Saving will sign you out of your current session.",
    apiUrlLabel: "Backend URL",
    apiUrlPlaceholder: "https://api.your-multica.example",
    save: "Save",
    saving: "Saving...",
    testConnection: "Test connection",
    testingConnection: "Testing...",
    testOk: "Reachable.",
    testFail: "Could not reach this URL.",
    resetHeading: "Reset to Multica Cloud",
    resetDescription:
      "Switch the app back to Multica Cloud and sign out of your current session.",
    resetConfirmLabel: 'Type "multica.ai" to confirm',
    resetConfirmPlaceholder: "multica.ai",
    resetButton: "Reset to Multica Cloud",
    resetBusy: "Resetting...",
    diagnosticsHeading: "Diagnostics",
    diagnosticsApiUrlLabel: "Current backend",
    diagnosticsWsUrlLabel: "WebSocket URL",
    diagnosticsAppUrlLabel: "Web URL",
    diagnosticsSourceLabel: "Config source",
    diagnosticsSourceSecureStore: "Saved on this device",
    diagnosticsSourceBuildTime: "Build-time fallback",
    saveFailAlertTitle: "Could not save",
  },
} as const;