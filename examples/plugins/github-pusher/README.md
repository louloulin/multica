# GitHub Pusher

A Lumen plugin that pushes files to a GitHub repository **through the REST
API**, not over `git://github.com`. It exists for one reason: in some
networks, the host that reaches `api.github.com` cannot reach `github.com`.
Direct `git push` then fails before it can speak the protocol, and the only
way to land code is to replay it through the Git Database API (blobs → tree →
commit → ref).

The plugin holds the token on the plugin author's side, exactly like
`deploy-sentinel` holds its `sentinel_token`. The iframe has no credential
and cannot read it.

## What it contributes

| Contribution | Kind | What it does |
| --- | --- | --- |
| `github-pusher` | skill resource | Teaches the agent the order of operations and the things to refuse. |
| `push_files` | hook, `agent` + `manual` + `ui` | One push, one commit. Validates paths, creates the branch if missing, writes the tree, commit, and ref via the API. |
| `create_branch` | hook, `agent` + `manual` + `ui` | Creates a branch from `default_branch` (or `base_branch` if you pass one). Returns `created` or `exists`. |
| `pusher` | `issue_panel` surface | The human view. Lives in a sandboxed iframe, drafts to per-member storage, posts the outcome as a comment on the issue. |

## Security shape

The plugin author's handler verifies Lumen's signature, refuses replays,
holds the GitHub PAT, and refuses to log it. The iframe holds nothing — the
panel posts the outcome to the issue using the host's bridge call, so a
captured iframe state cannot reuse it.

The handler talks to `api.github.com` exclusively. It never opens a
connection to `github.com`, which is the entire point: the network failure
mode this plugin is built against usually leaves `api.github.com` reachable
while `github.com` is blocked.

## Running it locally

```bash
openssl req -x509 -newkey rsa:2048 -nodes -days 365 \
  -keyout dev-key.pem -out dev-cert.pem \
  -subj "/CN=127.0.0.1" -addext "subjectAltName=IP:127.0.0.1"

LUMEN_SIGNING_SECRET=whsec_... node server/handler.mjs      # :8790
```

Then point Lumen at it the same way `deploy-sentinel` does:

```bash
export LUMEN_PLUGIN_DIR=examples/plugins
export LUMEN_PLUGIN_DEV_ORIGINS=https://127.0.0.1:8790
export LUMEN_PLUGIN_DEV_CA=/path/to/dev-cert.pem
```

Fill in the plugin config (token, repo owner/name, default branch, committer
identity) and the hook is callable from the panel and from agents.

## Pushing from the panel

The panel mounts on an issue. Pick a branch, write a message, paste one
file per line in `path:content` form. The handler turns that into a single
commit and posts a comment back to the issue with the commit URL.

## Pushing from the agent

Call the `push_files` hook with:

```json
{
  "branch": "feature/lum834-pi0911",
  "message": "fix(pi): harden approval gate",
  "files": {
    "docs/notes.md": "## Notes\n\nUpdated."
  }
}
```

The handler returns the commit SHA and URL when it lands; otherwise a
structured `rejected` or `error` reason.

## Tested

The plugin manifest is shaped to plug into
`server/internal/handler/plugin_example_test.go`'s fixture set. Add this
manifest to the test's installation list and the existing assertions cover
it: skill lands in the skill table, `push_files` and `create_branch` show up
in the agent's tool list exactly when their triggers declare `agent`, and
the handler's `push_files` round-trip pushes one commit and reports the
SHA.
