# seed-demo

Seeds a fresh Lumen database with the canonical demo workspace:

| Field        | Value          |
|--------------|----------------|
| Name         | Lumen Demo     |
| Slug         | `lumen-demo`   |
| Issue prefix | `LUM`          |
| Owner        | `--email` arg  |
| Issues       | 20 across Backlog / Todo / In Progress / Done |

Use it after a `make db-reset` (or any time the local DB has been wiped)
to get a workspace that matches the screenshots in the docs and the
landing page.

## Usage

```sh
# Default: creates admin@lumen.local + Lumen Demo with 19 issues.
go run ./cmd/seed-demo

# Custom owner email and display name.
go run ./cmd/seed-demo --email=you@example.com --display-name="You"

# Inspect what would happen without writing.
go run ./cmd/seed-demo --dry-run
```

It reads `DATABASE_URL` from the environment, same as the server.

## Idempotency

The workspace is matched by slug. Re-running with the same database is a
no-op: the binary prints the existing IDs and exits. The user is upserted
by email; issues are not re-inserted (they would collide on
`(workspace_id, number)`).

## When NOT to use this

- Production databases. The seed inserts rows a real signup would never
  produce; there is no audit-trail hook and no email-verification step.
- Databases with existing user data. The user upsert is keyed on email
  and will silently reuse any account with that email — verify with
  `--dry-run` first.
