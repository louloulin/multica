# GitHub Pusher

Push files to a GitHub repository when `github.com` is unreachable but `api.github.com` works. The plugin author runs an HTTPS handler that holds the workspace-scoped token; calls route through Lumen's hook bridge.

## When to use it

- You have local edits that must land on a remote branch and `git push` keeps timing out to `github.com`.
- The repository is configured in plugin settings (`repo_owner`, `repo_name`, `default_branch`, committer identity) and the admin has granted `net:api.github.com`.
- The change fits in one commit (≤ 100 files, total content small enough for the timeout).

Do **not** use it for large diffs, binary uploads, multi-commit history rewrites, or anything that needs to be force-pushed — this plugin never sets `force: true`, refuses `update_only` violations, and is built for small, deliberate commits.

## Hooks

| Key | When to call | What it does |
| --- | --- | --- |
| `push_files` | You have one branch and a set of file paths → new content. | Creates the branch from `default_branch` if missing, then writes a tree, commit, and ref via the Git Database API. |
| `create_branch` | You want to set up the branch in advance (or confirm it exists) without pushing yet. | Creates the branch from `default_branch` (or `base_branch` if you pass one). Returns `created` or `exists`. |

## Order of operations

1. Call `create_branch` with `new_branch` if you want to be sure the branch exists before you push. Optional — `push_files` does this itself.
2. Call `push_files` with `branch`, `message`, and `files`. The `files` object maps POSIX-style paths to UTF-8 content. Paths must not start with `/` or contain `..` or `.` segments.
3. Read the response:
   - `status: "pushed"` → `commit_sha`, `commit_url`, `branch_created`, `files_added`, `files_updated`.
   - `status: "rejected"` → fix the `reason` and retry; do not retry blindly.
   - `status: "error"` → upstream GitHub API error; report the reason.

## Pushing as an agent

When you call `push_files` from a tool, your call returns the same JSON the handler returns. Surface that to the human in your final answer — they need the commit URL to verify.

The handler signs the work with the committer identity the admin configured; you do not need to pass one. Do not invent a committer on the agent side; it will be ignored.

## Pushing from the UI

The issue panel saves a draft to per-member storage so a half-typed push survives a refresh. Hit **Save draft** before you switch branches, and the next mount picks up where you left off. The push button uses `trigger: "ui"`, which lands as **the user** who clicked it, not as the plugin — same as the hello panel's comment button.

## Things to refuse

- Do not push secrets, even if the call site feels safe. The token is server-side; the path you push is in plaintext in transit.
- Do not push more than 100 files in one call — split the change into multiple commits.
- Do not push to a branch that looks like a default protected branch (`main`, `master`, `release/*`) unless the admin has confirmed the push is intentional; the plugin will not enforce that for you.
- Do not retry on `status: "error"` without reading the message; the GitHub API is rate-limited and will return 403 with `X-RateLimit-Remaining: 0` long before the call surfaces a timeout.

## Verified against

`server/internal/handler/plugin_example_test.go` will install this manifest when added to the example list and assert that the agent tool list contains `push_files` and `create_branch` exactly when their triggers declare `agent`.
