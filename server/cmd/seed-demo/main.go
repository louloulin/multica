// Command seed-demo populates a fresh Lumen database with the canonical
// demo workspace ("Lumen Demo", slug "lumen-demo", prefix "LUM-") and a
// curated board of 20 issues spread across the four statuses a fresh
// workspace shows on its first board view: Backlog, Todo, In Progress,
// and Done.
//
// Run it once after `make migrate-up` against an empty target database:
//
//	go run ./cmd/seed-demo --email=admin@lumen.local --display-name="Admin"
//
// It is idempotent at the workspace level: re-running it with the same
// --email on a database that already contains "lumen-demo" prints the
// existing IDs and exits without inserting duplicates. The user is
// upserted by email; the workspace is matched by slug; issues are not
// re-inserted (they would collide on (workspace_id, number)).
package main

import (
	"context"
	"errors"
	"flag"
	"fmt"
	"log/slog"
	"os"
	"strings"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

const (
	demoWorkspaceName  = "Lumen Demo"
	demoWorkspaceSlug  = "lumen-demo"
	demoIssuePrefix    = "LUM"
	demoWorkspaceDesc  = "Canonical demo workspace: shows the Lumen board, agents, and skills in a realistic shape."
	demoWorkspaceEmail = "admin@lumen.local"
	demoWorkspaceOwner = "Lumen Admin"
)

// demoIssue is the canonical board used by the marketing site and the
// first-run onboarding tour. Keep the titles stable: third-party docs
// link to them by name.
type demoIssue struct {
	title    string
	status   string
	priority string
}

var demoIssues = []demoIssue{
	// Backlog (4) — parked ideas the team has not committed to yet.
	{"Evaluate Redis for caching layer", "backlog", "low"},
	{"Add CSV and PDF export for reports", "backlog", "none"},
	{"Mobile responsive optimization", "backlog", "medium"},
	{"Integrate Sentry error monitoring", "backlog", "low"},

	// Todo (5) — committed work, not started.
	{"Add end-to-end encryption for messages", "todo", "medium"},
	{"Create analytics dashboard for workspace activity", "todo", "medium"},
	{"Write API documentation with OpenAPI spec", "todo", "low"},
	{"Implement email notification preferences", "todo", "low"},
	{"Add dark mode support", "todo", "low"},

	// In Progress (5) — actively being worked on.
	{"Build WebSocket notification system", "in_progress", "high"},
	{"Integrate Stripe billing and subscriptions", "in_progress", "high"},
	{"Refactor API error handling middleware", "in_progress", "medium"},
	{"Add real-time collaborative editing", "in_progress", "high"},
	{"Implement role-based access control", "in_progress", "high"},

	// Done (5) — already shipped.
	{"Set up CI/CD pipeline with GitHub Actions", "done", "high"},
	{"Implement user authentication with OAuth", "done", "high"},
	{"Design and build component library", "done", "medium"},
	{"Set up database schema and migrations", "done", "high"},
	{"Build user settings and profile page", "done", "low"},
}

func main() {
	email := flag.String("email", demoWorkspaceEmail, "email of the demo workspace owner; created if missing")
	displayName := flag.String("display-name", demoWorkspaceOwner, "display name used when creating the owner user")
	dryRun := flag.Bool("dry-run", false, "print what would be inserted without writing")
	flag.Parse()

	if *email == "" {
		fmt.Fprintln(os.Stderr, "--email is required")
		os.Exit(2)
	}

	if err := run(*email, *displayName, *dryRun); err != nil {
		slog.Error("seed-demo failed", "error", err)
		os.Exit(1)
	}
}

func run(email, displayName string, dryRun bool) error {
	ctx := context.Background()

	pool, err := openPool(ctx)
	if err != nil {
		return fmt.Errorf("connect database: %w", err)
	}
	defer pool.Close()

	if dryRun {
		fmt.Printf("would upsert user email=%q display_name=%q\n", email, displayName)
		fmt.Printf("would ensure workspace slug=%q name=%q prefix=%q\n", demoWorkspaceSlug, demoWorkspaceName, demoIssuePrefix)
		fmt.Printf("would insert %d issues across statuses backlog/todo/in_progress/done\n", len(demoIssues))
		return nil
	}

	userID, err := upsertUser(ctx, pool, email, displayName)
	if err != nil {
		return fmt.Errorf("upsert user: %w", err)
	}
	slog.Info("user ready", "id", userID, "email", email)

	workspaceID, alreadyExisted, err := ensureWorkspace(ctx, pool)
	if err != nil {
		return fmt.Errorf("ensure workspace: %w", err)
	}
	if alreadyExisted {
		// Surface the existing IDs so an operator can verify the seed
		// before they hand the workspace to a teammate.
		fmt.Printf("workspace already exists: id=%s slug=%s\n", workspaceID, demoWorkspaceSlug)
		return nil
	}

	if err := addOwnerMember(ctx, pool, workspaceID, userID); err != nil {
		return fmt.Errorf("add owner member: %w", err)
	}
	if err := seedWorkspaceStatuses(ctx, pool, workspaceID); err != nil {
		return fmt.Errorf("seed statuses: %w", err)
	}
	if err := insertIssues(ctx, pool, workspaceID, userID); err != nil {
		return fmt.Errorf("insert issues: %w", err)
	}

	fmt.Printf("seeded Lumen Demo workspace: id=%s owner=%s issues=%d\n", workspaceID, userID, len(demoIssues))
	return nil
}

// openPool mirrors how the rest of the server reads DATABASE_URL: the
// env var wins, but a plain libpq URL also works.
func openPool(ctx context.Context) (*pgxpool.Pool, error) {
	dsn := os.Getenv("DATABASE_URL")
	if dsn == "" {
		return nil, errors.New("DATABASE_URL is not set")
	}
	cfg, err := pgxpool.ParseConfig(dsn)
	if err != nil {
		return nil, err
	}
	return pgxpool.NewWithConfig(ctx, cfg)
}

// upsertUser creates the owner if missing and returns the existing id
// otherwise. The display name only seeds new rows; we never overwrite a
// real user's chosen name.
func upsertUser(ctx context.Context, pool *pgxpool.Pool, email, displayName string) (string, error) {
	const q = `
INSERT INTO "user" (name, email)
VALUES ($1, $2)
ON CONFLICT (email) DO UPDATE SET email = EXCLUDED.email
RETURNING id`
	var id string
	if err := pool.QueryRow(ctx, q, displayName, email).Scan(&id); err != nil {
		return "", err
	}
	return id, nil
}

// ensureWorkspace creates "lumen-demo" if it does not exist and returns
// (id, false, nil). If the slug is already taken (most commonly because
// a developer ran seed-demo twice), it returns (id, true, nil) so the
// caller can short-circuit before inserting duplicate issues.
func ensureWorkspace(ctx context.Context, pool *pgxpool.Pool) (string, bool, error) {
	const existingQ = `SELECT id FROM workspace WHERE slug = $1`
	var id string
	err := pool.QueryRow(ctx, existingQ, demoWorkspaceSlug).Scan(&id)
	if err == nil {
		return id, true, nil
	}
	if !errors.Is(err, pgx.ErrNoRows) {
		return "", false, err
	}

	const insertQ = `
INSERT INTO workspace (name, slug, description, issue_prefix)
VALUES ($1, $2, $3, $4)
RETURNING id`
	if err := pool.QueryRow(ctx, insertQ, demoWorkspaceName, demoWorkspaceSlug, demoWorkspaceDesc, demoIssuePrefix).Scan(&id); err != nil {
		return "", false, err
	}
	return id, false, nil
}

// addOwnerMember binds the owner to the workspace. Matches the role the
// signup flow uses so the seeded user sees the same affordances as a
// freshly registered one.
func addOwnerMember(ctx context.Context, pool *pgxpool.Pool, workspaceID, userID string) error {
	const q = `
INSERT INTO member (workspace_id, user_id, role)
VALUES ($1, $2, 'owner')
ON CONFLICT (workspace_id, user_id) DO NOTHING`
	_, err := pool.Exec(ctx, q, workspaceID, userID)
	return err
}

// seedWorkspaceStatuses mirrors the catalog a freshly created workspace
// gets from the create handler, so the seeded board shows the same
// columns the onboarding tour describes.
func seedWorkspaceStatuses(ctx context.Context, pool *pgxpool.Pool, workspaceID string) error {
	const q = `
INSERT INTO issue_status (workspace_id, key, name, description, category, color, is_system, position)
VALUES
    ($1, 'backlog',     'Backlog',     'Parked. Assigning an issue here never starts an agent run.',         'unstarted',   '#6b7280', TRUE, 0),
    ($1, 'todo',        'Todo',        'Queued for work. Moving an issue here starts the assigned agent.',   'unstarted',   '#6b7280', TRUE, 1),
    ($1, 'in_progress', 'In Progress', 'Actively being worked on.',                                        'started',     '#f59e0b', TRUE, 2),
    ($1, 'in_review',   'In Review',   'Work delivered, waiting on human review. Finalizes the autopilot run.', 'started',     '#22c55e', TRUE, 3),
    ($1, 'done',        'Done',        'Completed.',                                                       'done',        '#3b82f6', TRUE, 4),
    ($1, 'blocked',     'Blocked',     'Stalled on an external dependency.',                               'started',     '#ef4444', TRUE, 5),
    ($1, 'cancelled',   'Cancelled',   'Decided not to do.',                                               'closed',      '#6b7280', TRUE, 6)
ON CONFLICT DO NOTHING`
	_, err := pool.Exec(ctx, q, workspaceID)
	return err
}

// insertIssues writes the demo board. position is recomputed per status
// so the board renders in the same top-to-bottom order the screenshot
// shows: within each column, earlier entries in demoIssues land on top.
func insertIssues(ctx context.Context, pool *pgxpool.Pool, workspaceID, userID string) error {
	const issueQ = `
INSERT INTO issue (
    workspace_id, title, status, priority, creator_type, creator_id,
    position, number
) VALUES ($1, $2, $3, $4, 'member', $5, $6,
    (SELECT issue_counter + 1 FROM workspace WHERE id = $1)
)
RETURNING number`

	const bumpCounterQ = `UPDATE workspace SET issue_counter = issue_counter + 1 WHERE id = $1`

	// Count issues per status as we walk the slice so earlier entries
	// in demoIssues end up at the top of their column (positions sort
	// DESC on the board). Go map iteration order is randomized, so a
	// map-based counter here would shuffle columns randomly.
	positionByStatus := map[string]int{}
	for _, issue := range demoIssues {
		count := positionByStatus[issue.status]
		// Higher count = higher position = closer to the top.
		position := float64(len(demoIssues) - count)
		positionByStatus[issue.status] = count + 1
		var number int
		if err := pool.QueryRow(ctx, issueQ, workspaceID, issue.title, issue.status, issue.priority, userID, position).Scan(&number); err != nil {
			return fmt.Errorf("insert %q: %w", issue.title, err)
		}
		if _, err := pool.Exec(ctx, bumpCounterQ, workspaceID); err != nil {
			return fmt.Errorf("bump issue_counter after %q: %w", issue.title, err)
		}
	}
	return nil
}

// Keep a small allocator so the file can grow without losing the lookup
// for slog-keyed fields that some teams grep for.
var _ = strings.TrimSpace
