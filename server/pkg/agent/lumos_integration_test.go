//go:build agentintegration

package agent

import (
	"context"
	"io"
	"log/slog"
	"os"
	"os/exec"
	"strings"
	"testing"
	"time"
)

// TestLumosRealACPSmoke drives the installed `lumos acp` binary end to end:
// handshake, session/new, one prompt, and a terminal result. It is opt-in
// because it starts the real Lumos runtime, which reads the user's configured
// providers and may consume provider quota.
//
// Run it with:
//
//	LUMEN_RUN_REAL_AGENT_SMOKE=1 go test -tags=agentintegration ./pkg/agent \
//	  -run TestLumosRealACPSmoke -count=1 -v
//
// LUMEN_LUMOS_PATH overrides the binary (defaults to `lumos` on PATH).
func TestLumosRealACPSmoke(t *testing.T) {
	requireRealAgentSmoke(t)
	if testing.Short() {
		t.Skip("skipping real-binary smoke test in -short mode")
	}

	execPath := strings.TrimSpace(os.Getenv("LUMEN_LUMOS_PATH"))
	if execPath == "" {
		execPath = "lumos"
	}
	resolved, err := exec.LookPath(execPath)
	if err != nil {
		t.Skipf("lumos not found at %q: %v", execPath, err)
	}

	backend := &lumosBackend{
		cfg: Config{
			Logger:         slog.New(slog.NewTextHandler(io.Discard, nil)),
			ExecutablePath: resolved,
		},
	}

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Minute)
	defer cancel()

	sess, err := backend.Execute(ctx, "Reply with the single word: pong. Do not use any tools.", ExecOptions{
		Cwd: t.TempDir(),
	})
	if err != nil {
		t.Fatalf("Execute: %v", err)
	}

	var sawText bool
	timeout := time.After(5 * time.Minute)
	for {
		select {
		case msg, ok := <-sess.Messages:
			if !ok {
				sess.Messages = nil
				continue
			}
			if msg.Type == MessageText || msg.Type == MessageThinking {
				sawText = true
			}
		case res, ok := <-sess.Result:
			if !ok {
				t.Fatal("Result channel closed without a value")
			}
			t.Logf("status=%s session=%s duration=%dms output=%q error=%q",
				res.Status, res.SessionID, res.DurationMs, truncate(res.Output, 200), res.Error)
			if res.Status != "completed" {
				t.Fatalf("status = %q, want completed (error=%q)", res.Status, res.Error)
			}
			if res.SessionID == "" {
				t.Error("SessionID is empty; resume would be impossible for this run")
			}
			if !sawText && strings.TrimSpace(res.Output) == "" {
				t.Error("no assistant text reached the daemon")
			}
			return
		case <-timeout:
			t.Fatal("timed out waiting for the lumos session to finish")
		}
	}
}

func truncate(s string, n int) string {
	if len(s) <= n {
		return s
	}
	return s[:n] + "…"
}
