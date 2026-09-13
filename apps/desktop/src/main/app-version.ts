import { app } from "electron";
import { execFile } from "node:child_process";

const GIT_VERSION_TIMEOUT_MS = 2_000;
let resolvedVersion: string | undefined;
let versionResolutionStarted = false;

/**
 * Resolve the running app version. In packaged builds this is the value
 * `electron-builder` baked into package.json via `extraMetadata.version`
 * (driven by `git describe` — see `apps/desktop/scripts/package.mjs`), so
 * `app.getVersion()` matches the GitHub Release tag exactly.
 *
 * In dev (`pnpm dev:desktop`) `app.getVersion()` only sees the static
 * `apps/desktop/package.json` value, which is "0.1.0" and never bumped —
 * the Settings → Updates panel and any other UI surfacing the version
 * would mislead developers into thinking they're running ancient builds.
 * Fall back to `git describe --tags --always --dirty` (same source the
 * packager uses) so dev shows e.g. `0.2.19-14-gabcdef-dirty`. If git is
 * unavailable for whatever reason, we just return the package.json value.
 */
export function getAppVersion(): string {
  if (resolvedVersion) return resolvedVersion;
  return app.getVersion();
}

export function resolveDevelopmentVersion(): void {
  if (app.isPackaged || versionResolutionStarted) return;
  versionResolutionStarted = true;
  const fallback = app.getVersion();
  execFile(
    "git",
    ["describe", "--tags", "--match", "v[0-9]*", "--always", "--dirty"],
    {
      cwd: app.getAppPath(),
      encoding: "utf-8",
      timeout: GIT_VERSION_TIMEOUT_MS,
      killSignal: "SIGKILL",
    },
    (_error, stdout) => {
      const raw = typeof stdout === "string" ? stdout.trim() : "";
      resolvedVersion = raw ? raw.replace(/^v/, "") : fallback;
    },
  );
}
