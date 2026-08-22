/**
 * Welcome-gate decision. Mirror of
 * `apps/desktop/src/renderer/src/components/should-show-welcome.ts` —
 * the Welcome screen renders only when the runtime config store has
 * hydrated AND the user has not yet explicitly chosen a backend
 * (SecureStore is empty). Otherwise they go straight to the normal
 * sign-in / app stack.
 *
 * Intentionally a pure function so `_layout.tsx` can decide without
 * needing access to React context.
 */
import type { RuntimeConfig } from "@/data/runtime-config";

export interface ShouldShowWelcomeInput {
  status: "idle" | "hydrating" | "hydrated";
  hasUserChosenBackend: boolean;
  config: RuntimeConfig;
}

export function shouldShowWelcome(input: ShouldShowWelcomeInput): boolean {
  if (input.status !== "hydrated") return false;
  if (input.hasUserChosenBackend) return false;
  return true;
}