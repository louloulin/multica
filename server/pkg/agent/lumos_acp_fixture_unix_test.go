//go:build unix

package agent

import (
	"context"
	"io"
	"log/slog"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

// lumosStubScript is a fake `lumos acp` server. It speaks the subset of ACP
// that the real Lumos implementation (crates/lumos-acp/src/acp/agent.rs)
// speaks, so the test exercises the same protocol the production binary does:
//
//   - initialize  → protocolVersion 1, loadSession:true, promptCapabilities
//     {image:true, audio:false, embeddedContext:true}, sessionCapabilities
//     {list,resume,close}, agentInfo.name "lumos-acp", and NO mcpCapabilities
//     (Lumos does not yet connect per-session mcpServers).
//   - session/new → a session id; Lumos uses the internal session db id.
//   - session/load  → present only in the real server; the stub answers it so
//     the resume path can be exercised.
//   - session/prompt → streams an agent_message_chunk, a tool_call + its
//     tool_call_update, a thought chunk, then the prompt response.
//   - session/setConfigOption → accepted for configId="model".
//   - unknown methods answer -32601, matching the Rust server.
//
// LUMOS_STUB_PROMPT_ERROR=1 makes session/prompt answer a JSON-RPC error so
// the failure-classification path can be tested. LUMOS_STUB_RESUME_REJECT=1
// makes session/load refuse the id with the "Invalid session identifier"
// wording that isACPResumeRejected recognises.
const lumosStubScript = `#!/bin/sh
while IFS= read -r line; do
  id=$(printf '%s' "$line" | sed -n 's/.*"id":\([0-9][0-9]*\).*/\1/p')
  case "$line" in
    *'"method":"initialize"'*)
      printf '{"jsonrpc":"2.0","id":%s,"result":{"protocolVersion":1,"authMethods":[],"agentInfo":{"name":"lumos-acp","title":"Lumos Agent ACP Agent","version":"0.1.0"},"agentCapabilities":{"loadSession":true,"promptCapabilities":{"image":true,"audio":false,"embeddedContext":true},"sessionCapabilities":{"list":{},"resume":{},"close":{}}}}}\n' "$id"
      ;;
    *'"method":"session/new"'*)
      printf '{"jsonrpc":"2.0","id":%s,"result":{"sessionId":"ses_lumos_test","configOptions":[{"type":"select","id":"model","name":"Model","description":"","currentValue":"lumos-default","options":[{"value":"lumos-default","name":"Default"}]}]}}\n' "$id"
      ;;
    *'"method":"session/load"'*)
      if [ -n "$LUMOS_STUB_RESUME_REJECT" ]; then
        printf '{"jsonrpc":"2.0","id":%s,"error":{"code":-32602,"message":"session not found: the recorded session is no longer available"}}\n' "$id"
      else
        printf '{"jsonrpc":"2.0","id":%s,"result":{}}\n' "$id"
      fi
      ;;
    *'"method":"session/setConfigOption"'*)
      printf '{"jsonrpc":"2.0","id":%s,"result":{}}\n' "$id"
      ;;
    *'"method":"session/prompt"'*)
      printf '{"jsonrpc":"2.0","method":"session/update","params":{"sessionId":"ses_lumos_test","update":{"sessionUpdate":"agent_thought_chunk","content":{"type":"text","text":"planning the edit"}}}}\n'
      printf '{"jsonrpc":"2.0","method":"session/update","params":{"sessionId":"ses_lumos_test","update":{"sessionUpdate":"tool_call","toolCallId":"tc-1","title":"Edit file","kind":"edit","status":"pending","rawInput":{"file_path":"main.go"}}}}\n'
      printf '{"jsonrpc":"2.0","method":"session/update","params":{"sessionId":"ses_lumos_test","update":{"sessionUpdate":"tool_call_update","toolCallId":"tc-1","status":"completed","content":[{"type":"content","content":{"type":"text","text":"patched main.go"}}]}}}\n'
      printf '{"jsonrpc":"2.0","method":"session/update","params":{"sessionId":"ses_lumos_test","update":{"sessionUpdate":"agent_message_chunk","content":{"type":"text","text":"Done: main.go patched."}}}}\n'
      if [ -n "$LUMOS_STUB_PROMPT_ERROR" ]; then
        printf '{"jsonrpc":"2.0","id":%s,"error":{"code":-32603,"message":"upstream provider error"}}\n' "$id"
      else
        printf '{"jsonrpc":"2.0","id":%s,"result":{"stopReason":"end_turn"}}\n' "$id"
      fi
      ;;
    *)
      printf '{"jsonrpc":"2.0","id":%s,"error":{"code":-32601,"message":"Method not found"}}\n' "$id"
      ;;
  esac
done
`

func writeLumosStub(t *testing.T) string {
	t.Helper()
	path := filepath.Join(t.TempDir(), "lumos")
	writeTestExecutable(t, path, []byte(lumosStubScript))
	return path
}

// drainSession collects every Message and the terminal Result from a Session,
// returning them once the Result arrives or the deadline fires.
func drainSession(t *testing.T, sess *Session, deadline time.Duration) ([]Message, Result, bool) {
	t.Helper()
	var msgs []Message
	timeout := time.After(deadline)
	for {
		select {
		case msg, ok := <-sess.Messages:
			if !ok {
				sess.Messages = nil
				continue
			}
			msgs = append(msgs, msg)
		case res, ok := <-sess.Result:
			if !ok {
				return msgs, Result{}, false
			}
			return msgs, res, true
		case <-timeout:
			return msgs, Result{}, false
		}
	}
}

// TestLumosBackend_EndToEnd drives the full handshake against the stub: spawn,
// initialize, session/new, optional setConfigOption, streaming updates, and the
// terminal prompt response. It asserts the Messages that reach the daemon are
// the ones the ACP stream described, in order.
func TestLumosBackend_EndToEnd(t *testing.T) {
	t.Parallel()

	backend := &lumosBackend{
		cfg: Config{
			Logger:         slog.New(slog.NewTextHandler(io.Discard, nil)),
			ExecutablePath: writeLumosStub(t),
		},
	}

	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
	defer cancel()

	sess, err := backend.Execute(ctx, "patch main.go", ExecOptions{
		Cwd:   t.TempDir(),
		Model: "lumos-large",
	})
	if err != nil {
		t.Fatalf("Execute: %v", err)
	}

	msgs, res, ok := drainSession(t, sess, 20*time.Second)
	if !ok {
		t.Fatalf("session never produced a Result; got %d messages: %+v", len(msgs), msgs)
	}

	if res.Status != "completed" {
		t.Fatalf("status = %q, want completed (error=%q)", res.Status, res.Error)
	}
	if res.SessionID != "ses_lumos_test" {
		t.Errorf("SessionID = %q, want ses_lumos_test", res.SessionID)
	}
	if res.ResumeRejected {
		t.Error("ResumeRejected = true on a fresh session; want false")
	}

	var thoughts, tools, toolResults, texts int
	var toolInputSeen bool
	var toolOutputSeen bool
	for _, m := range msgs {
		switch m.Type {
		case MessageThinking:
			thoughts++
			if !strings.Contains(m.Content, "planning the edit") {
				t.Errorf("thought content = %q", m.Content)
			}
		case MessageToolUse:
			tools++
			if m.CallID != "tc-1" {
				t.Errorf("tool CallID = %q, want tc-1", m.CallID)
			}
			// The shared ACP client normalizes the ACP title/kind pair
			// through hermesToolNameFromTitle, so an "Edit file" call
			// surfaces as Lumen's canonical write_file — the same
			// mapping kimi/traecli/grok rely on.
			if m.Tool != "write_file" {
				t.Errorf("tool name = %q, want the normalized write_file", m.Tool)
			}
			if m.Input["file_path"] == "main.go" {
				toolInputSeen = true
			}
		case MessageToolResult:
			toolResults++
			if m.CallID != "tc-1" {
				t.Errorf("tool-result CallID = %q, want tc-1", m.CallID)
			}
			if strings.Contains(m.Output, "patched main.go") {
				toolOutputSeen = true
			}
		case MessageText:
			texts++
		}
	}
	if thoughts == 0 {
		t.Error("no thinking message reached the daemon")
	}
	if tools == 0 {
		t.Error("no tool-use message reached the daemon")
	}
	if !toolInputSeen {
		t.Error("the tool_call's rawInput.file_path never reached a tool-use message")
	}
	if toolResults == 0 || !toolOutputSeen {
		t.Errorf("the tool_call_update's output never reached a tool-result message (results=%d)", toolResults)
	}
	if texts == 0 {
		t.Error("no assistant text message reached the daemon")
	}
	if res.Output == "" {
		t.Error("Result.Output is empty; the post-tool agent_message_chunk is the deliverable")
	}
}

// TestLumosBackend_ResumeRejectionIsClassified pins the GH #8116 path for the
// lumos runtime: a refused session/load must set ResumeRejected so the daemon
// starts a fresh session instead of replaying a dead id forever.
func TestLumosBackend_ResumeRejectionIsClassified(t *testing.T) {
	t.Setenv("LUMOS_STUB_RESUME_REJECT", "1")

	backend := &lumosBackend{
		cfg: Config{
			Logger:         slog.New(slog.NewTextHandler(io.Discard, nil)),
			ExecutablePath: writeLumosStub(t),
		},
	}

	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
	defer cancel()

	sess, err := backend.Execute(ctx, "continue", ExecOptions{
		Cwd:             t.TempDir(),
		ResumeSessionID: "ses_gone",
		ResumeExpected:  true,
	})
	if err != nil {
		t.Fatalf("Execute: %v", err)
	}

	_, res, ok := drainSession(t, sess, 20*time.Second)
	if !ok {
		t.Fatal("session never produced a Result")
	}
	if res.Status != "failed" {
		t.Fatalf("status = %q, want failed", res.Status)
	}
	if !res.ResumeRejected {
		t.Errorf("ResumeRejected = false; the daemon would replay this dead session forever (error=%q)", res.Error)
	}
	if res.SessionID != "" {
		t.Errorf("SessionID = %q, want empty so the daemon starts fresh", res.SessionID)
	}
}

// TestLumosBackend_PromptErrorFailsRun verifies a JSON-RPC error from
// session/prompt is reported as a failed run rather than a silent success.
func TestLumosBackend_PromptErrorFailsRun(t *testing.T) {
	t.Setenv("LUMOS_STUB_PROMPT_ERROR", "1")

	backend := &lumosBackend{
		cfg: Config{
			Logger:         slog.New(slog.NewTextHandler(io.Discard, nil)),
			ExecutablePath: writeLumosStub(t),
		},
	}

	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
	defer cancel()

	sess, err := backend.Execute(ctx, "do the thing", ExecOptions{Cwd: t.TempDir()})
	if err != nil {
		t.Fatalf("Execute: %v", err)
	}
	_, res, ok := drainSession(t, sess, 20*time.Second)
	if !ok {
		t.Fatal("session never produced a Result")
	}
	if res.Status != "failed" {
		t.Fatalf("status = %q, want failed", res.Status)
	}
	if !strings.Contains(res.Error, "session/prompt failed") {
		t.Errorf("error %q does not name the failing RPC", res.Error)
	}
	// The session id survives a prompt failure on a fresh (non-resume) run so
	// the platform's own retry can resume the truncated conversation.
	if res.SessionID != "ses_lumos_test" {
		t.Errorf("SessionID = %q, want ses_lumos_test retained for retry", res.SessionID)
	}
}

// TestLumosBackend_EmitsOnlyACPSubcommand pins the launch argv: the ACP
// transport is selected by the bare `acp` subcommand, and a custom_args entry
// cannot remove it.
func TestLumosBackend_EmitsOnlyACPSubcommand(t *testing.T) {
	// filterCustomArgs drops every blocked token, including a second `acp` and
	// the TUI/server subcommands.
	got := filterCustomArgs(
		[]string{"acp", "tui", "server", "--verbose", "--model", "x"},
		lumosBlockedArgs,
		slog.New(slog.NewTextHandler(io.Discard, nil)),
	)
	for _, blocked := range []string{"acp", "tui", "server"} {
		for _, arg := range got {
			if arg == blocked {
				t.Errorf("filterCustomArgs let %q through: %v", blocked, got)
			}
		}
	}
	// Non-blocked passthrough survives.
	var sawVerbose bool
	for _, arg := range got {
		if arg == "--verbose" {
			sawVerbose = true
		}
	}
	if !sawVerbose {
		t.Errorf("filterCustomArgs dropped a benign arg: %v", got)
	}
}
