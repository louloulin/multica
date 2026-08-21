# Self-Hosting — Desktop Client

This document covers the desktop client side of a self-hosted Multica
deployment. For the server install, see [SELF_HOSTING.md](SELF_HOSTING.md).

## What the desktop client needs

The desktop app reaches Multica through three URLs:

| URL | Purpose |
| --- | --- |
| `apiUrl` | REST API used for queries, mutations, and `/api/config`. |
| `appUrl` | Web app loaded inside the Electron renderer (for issue boards, settings, etc.). |
| `wsUrl` | WebSocket endpoint for realtime updates. |

The desktop bundles one binary that serves both Multica Cloud and self-host
deployments — there is no separate self-host build. Switching which backend it
points at is a runtime config change, not an install-time decision.

## First-launch Welcome

When Multica Desktop starts for the first time and `~/.multica/desktop.json`
does not exist yet, it shows a **Welcome** screen before the renderer mounts
anything else (login page, workspace list, settings). Pick one:

- **Use Multica Cloud** — saves the default Cloud configuration so the next
  launch skips Welcome and goes straight to the login page.
- **Connect to self-hosted** — paste your API URL; Desktop derives
  `appUrl` / `wsUrl` automatically and asks you to restart.

There is no skip option. The choice persists to `~/.multica/desktop.json` —
the file's existence (and matching the Cloud default if it was the
Cloud-choice write) is what keeps Welcome from re-firing on subsequent
launches. Returning users with an existing config never see this screen.

You can change the choice any time from **Settings → Backend** (see below),
including a destructive **Reset to cloud** action that deletes the file.

## Configure via Settings → Backend (recommended for changes after first launch)

1. Open Multica Desktop.
2. Open **Settings → Backend**.
3. Paste your API URL (for example `https://api.example.com`).
4. Click **Save**.
5. Click **Restart now** in the toast that appears.

Desktop writes `~/.multica/desktop.json`, derives `appUrl` and `wsUrl`
automatically, and asks you to restart. The full URL round-trip and override
fields are documented in the
[user docs](https://multica.ai/docs/desktop-app#connecting-to-a-self-hosted-instance).

### How the derivation works

- `wsUrl` — swap the `apiUrl` scheme (`http → ws`, `https → wss`) and append
  `/ws`. `https://api.example.com` becomes `wss://api.example.com/ws`.
- `appUrl` — strip the `api.` prefix when the host starts with `api.` and has at
  least three labels (`api.example.com → example.com`); otherwise it stays the
  same as `apiUrl`. Hosts with only two labels (`api.local`) keep their prefix
  because there is nothing else to fall back to.

Override `appUrl` / `wsUrl` from the same panel only when your deployment
doesn't match the `api.<host>` convention — for example, when the web app and
the API live on different domains, or when WebSocket is deployed on its own
subdomain.

### "Reset to cloud"

The same panel has a destructive **Reset to cloud** action. It requires typing
the keyword `multica.ai` to confirm, deletes `~/.multica/desktop.json`, and asks
the desktop client to restart. Use this to return to the default Cloud
configuration without uninstalling.

## Configure by hand (headless or scripted installs)

For installs without a UI (Linux servers, fleet provisioning, Kiosk mode), edit
the config file directly. The location depends on the OS — if your home
directory has been moved or redirected, use its actual path:

| Platform | Path |
| --- | --- |
| macOS | `/Users/<you>/.multica/desktop.json` |
| Linux | `/home/<you>/.multica/desktop.json` |
| Windows | `C:\Users\<you>\.multica\desktop.json` |

Minimal config — only `apiUrl` is required; the other two are derived:

```json
{
  "schemaVersion": 1,
  "apiUrl": "https://api.example.com"
}
```

Full config with explicit overrides for non-`api.<host>` deployments:

```json
{
  "schemaVersion": 1,
  "apiUrl": "https://api.example.com",
  "appUrl": "https://app.example.com",
  "wsUrl": "wss://ws.example.com/socket"
}
```

`apiUrl` must use `http` or `https`. Restart the app after saving — the file is
read once at startup.

### Schema versioning

The `schemaVersion` field lets the desktop client refuse unknown shapes
forward-compatibly. Today only `1` is accepted. Bumping it is a breaking change
to the desktop client and must be coordinated with a release that knows how to
read the new shape.

### Failure modes

The two failure modes look different, which is the fastest way to tell them
apart:

- **File not found** (wrong directory, or a filename that isn't exactly
  `desktop.json`) — the desktop uses the default Cloud configuration and shows
  no error. If Desktop still reports a Cloud address and no configuration
  error, the file is not where Desktop is looking.
- **File found but invalid JSON, version, or URLs** — Desktop shows a
  configuration error and does not fall back to Cloud.

Delete the file and restart (or click **Reset to cloud** in Settings → Backend)
to return to the default Cloud configuration.

### Not the CLI config

`~/.multica/desktop.json` is **not** the CLI's `~/.multica/config.json`, and
the key names differ: the CLI uses `server_url`, Desktop uses `apiUrl`. Desktop
never reads the CLI's config — it manages a separate daemon profile under
`~/.multica/profiles/desktop-<host>/`. Editing `config.json` does not change
which server Desktop connects to.

## Network reachability

Desktop can only connect to addresses reachable from both the renderer process
and the executing machine. That means:

- The API URL must be reachable over plain HTTP/HTTPS, not just inside the LAN.
- WebSocket upgrades must succeed — if your reverse proxy doesn't proxy
  WebSocket, Desktop cannot establish a realtime connection even if the REST
  API works.
- If a remote self-hosted instance doesn't use HTTPS, browsers refuse to
  establish secure contexts inside the Electron renderer. See the
  [self-host quickstart](SELF_HOSTING.md#step-4--verify--start-using) for the
  full TLS / proxy configuration.

## What is and isn't switched at runtime

Today, switching the desktop to a self-hosted instance is a **restart-bound**
change. The runtime config is read once when the app starts, and the underlying
`ApiClient` / `WSClient` are bound to the loaded URLs for the lifetime of the
process. That is a deliberate choice: hot-swapping those clients mid-session
would require refactoring the connection lifecycle. Save + restart is the
documented path; anything else (multi-profile switcher, profile pill in the
sidebar, etc.) is on the roadmap but not in this release.

The bundled CLI binary is the same for both Cloud and self-host — only the API
URL changes. The CLI's own bootstrap step (`cli-bootstrap.ts`) continues to pull
from the upstream `multica-ai/multica` releases channel, which is fine for
self-host: the CLI binary is identical, and Desktop already passes the
configured server URL when invoking `multica daemon`.
