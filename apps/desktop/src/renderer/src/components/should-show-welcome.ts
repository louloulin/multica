import { DEFAULT_RUNTIME_CONFIG } from "../../../shared/runtime-config";

interface ShouldShowWelcomeInput {
  configPresent: boolean | null;
  apiUrl: string;
}

// Single source of truth for whether the first-launch Welcome gate should
// render. Returns true exactly when no `~/.multica/desktop.json` exists
// AND the active runtime config is the cloud default — i.e. the user
// opened the app for the first time and we haven't yet recorded a choice.
//
// `configPresent === null` means "still loading", which we treat as
// "don't show yet" so the gate doesn't flash on during the IPC roundtrip.
// Callers should render a placeholder until the IPC resolves.
export function shouldShowWelcome(input: ShouldShowWelcomeInput): boolean {
  return (
    input.configPresent === false &&
    input.apiUrl === DEFAULT_RUNTIME_CONFIG.apiUrl
  );
}
