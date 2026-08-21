import { app } from "electron";
import { mkdir, readFile, writeFile, unlink } from "fs/promises";
import { existsSync } from "fs";
import { dirname, join } from "path";
import {
  DEFAULT_RUNTIME_CONFIG,
  parseRuntimeConfig,
  runtimeConfigFromDevEnv,
  serializeRuntimeConfig,
  type RuntimeConfig,
  type RuntimeConfigEnv,
  type RuntimeConfigResult,
} from "../shared/runtime-config";

export async function loadRuntimeConfig(options: {
  isDev: boolean;
  env: RuntimeConfigEnv;
  configPath?: string;
}): Promise<RuntimeConfigResult> {
  if (options.isDev) {
    try {
      return { ok: true, config: runtimeConfigFromDevEnv(options.env) };
    } catch (err) {
      return { ok: false, error: { message: errorMessage(err) } };
    }
  }

  const configPath = options.configPath ?? desktopConfigPath();
  try {
    const raw = await readFile(configPath, "utf-8");
    return { ok: true, config: parseRuntimeConfig(raw) };
  } catch (err) {
    if (isMissingFileError(err)) {
      return { ok: true, config: { ...DEFAULT_RUNTIME_CONFIG } };
    }
    return {
      ok: false,
      error: {
        message: `Invalid ${configPath}: ${errorMessage(err)}`,
      },
    };
  }
}

export function desktopConfigPath(): string {
  return join(app.getPath("home"), ".multica", "desktop.json");
}

/**
 * Persist a runtime config to disk. Validates by re-parsing the serialized
 * form so the renderer never sees a malformed file next launch. Throws on
 * filesystem errors; the IPC handler converts those into a rejected promise
 * with the original message so the renderer can surface it inline.
 */
export async function saveRuntimeConfig(
  config: RuntimeConfig,
  options?: { configPath?: string },
): Promise<void> {
  const configPath = options?.configPath ?? desktopConfigPath();
  // Round-trip through the parser before hitting disk: catches any drift
  // between `serializeRuntimeConfig` and `parseRuntimeConfig`, and rejects
  // shapes the parser would have refused (e.g. missing apiUrl).
  const serialized = serializeRuntimeConfig(parseRuntimeConfig(JSON.stringify(config)));
  await mkdir(dirname(configPath), { recursive: true });
  await writeFile(configPath, serialized, "utf-8");
}

export async function clearRuntimeConfig(options?: {
  configPath?: string;
}): Promise<void> {
  const configPath = options?.configPath ?? desktopConfigPath();
  try {
    await unlink(configPath);
  } catch (err) {
    if (isMissingFileError(err)) return;
    throw err;
  }
}

export function isRuntimeConfigPresent(options?: {
  configPath?: string;
}): boolean {
  const configPath = options?.configPath ?? desktopConfigPath();
  return existsSync(configPath);
}

function isMissingFileError(err: unknown): boolean {
  return Boolean(
    err &&
      typeof err === "object" &&
      "code" in err &&
      (err as NodeJS.ErrnoException).code === "ENOENT",
  );
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export type { RuntimeConfig, RuntimeConfigResult };
