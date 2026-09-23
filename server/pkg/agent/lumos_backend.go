package agent

import (
	"context"
	"fmt"
	"io"
	"os/exec"
	"strings"
	"sync"
	"sync/atomic"
	"time"
)

// lumosBlockedArgs are flags/subcommands Lumen owns and that user-configured
// custom_args must not override. `acp` selects the stdio ACP transport — it is
// the whole reason this runtime exists, so a custom_args entry that dropped it
// would leave the daemon talking JSON-RPC to a process that is not listening.
// `--version`/`--help` and the TUI subcommands (`tui`, `gui`, `server`) would
// likewise switch the binary out of the ACP channel.
var lumosBlockedArgs = map[string]blockedArgMode{
	"acp":       blockedStandalone,
	"tui":       blockedStandalone,
	"gui":       blockedStandalone,
	"server":    blockedStandalone,
	"--version": blockedStandalone,
	"--help":    blockedStandalone,
	"-h":        blockedStandalone,
}

// lumosBackend implements Backend by spawning `lumos acp` and speaking the
// upstream Agent Client Protocol (ACP) over stdin/stdout via the shared
// hermesClient.
//
// Lumos is the reference ACP agent for Lumen: its `lumos acp` subcommand
// (crates/lumos-acp/src/acp/, wired through crates/lumos-server/src/acp_runner.rs)
// is a native ACP server, not a bridge. That makes this backend the thinnest
// possible one — launch args, initialize, session/new-or-resume, prompt — and
// it inherits every capability the shared client already implements for the
// other ten ACP runtimes (grok, traecli, kimi, kiro, qoder, reasonix,
// zeroclaw, dim, mcode, qwenpaw): streaming updates, tool-call deferral,
// usage accumulation, MCP capability negotiation, permission bridging and
// resume-rejection classification.
//
// Protocol notes captured from the real Lumos implementation:
//
//   - initialize returns protocolVersion 1, loadSession:true,
//     promptCapabilities {image:true, audio:false, embeddedContext:true} and
//     sessionCapabilities {list, resume, close}. mcpCapabilities is
//     deliberately absent (the Rust comment says Lumos does not yet connect
//     per-session mcpServers), so filterACPMcpServersByCapability drops every
//     MCP server we send — the session still runs, just without MCP.
//   - Session methods are exactly session/new, session/load, session/resume,
//     session/prompt, session/setMode, session/setConfigOption, session/list,
//     session/close and authenticate. There is NO session/set_model and the
//     single advertised config option ("reasoning_effort") is accepted by
//     do_set_config_option but its value is not persisted — so model
//     selection is owned by the Lumos agent profile, like ZeroClaw. The
//     daemon therefore opts lumos-acp out of ModelSelectionSupported and
//     never sends session/setConfigOption{model=...}: doing so would
//     succeed on the wire and leave the user with a picker that does
//     nothing, the ZeroClaw anti-pattern called out in MUL-6511.
//   - session/update notification bodies carry the per-update object under
//     the v1 key `update` (the pre-v1 `sessionUpdate` key is accepted by
//     normalizeACPUpdate in hermes.go during Lumos's compatibility window).
type lumosBackend struct {
	cfg Config
}

// lumosReaderDrainGrace bounds how long we wait for the stdout/stderr readers
// after session/prompt returns. Mirrors traecli: Lumos may keep the process and
// its pipes open briefly after the prompt response, and the response — not the
// process exit — is the terminal signal.
var lumosReaderDrainGrace = 2 * time.Second

// lumosMessageStream serializes sends and the final close so a late stdout
// reader cannot send on a closed channel. Mirrors traecli/qoder/grok.
type lumosMessageStream struct {
	ch     chan Message
	mu     sync.Mutex
	closed bool
}

func newLumosMessageStream(size int) *lumosMessageStream {
	return &lumosMessageStream{ch: make(chan Message, size)}
}

func (s *lumosMessageStream) send(msg Message) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.closed {
		return
	}
	trySend(s.ch, msg)
}

func (s *lumosMessageStream) close() {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.closed {
		return
	}
	s.closed = true
	close(s.ch)
}

func (b *lumosBackend) Execute(ctx context.Context, prompt string, opts ExecOptions) (*Session, error) {
	execPath := b.cfg.ExecutablePath
	if execPath == "" {
		execPath = "lumos"
	}
	if _, err := exec.LookPath(execPath); err != nil {
		return nil, fmt.Errorf("lumos executable not found at %q: %w", execPath, err)
	}

	// Translate the agent's mcp_config (Claude-style object of objects) into
	// the array shape ACP session/new expects. Fail closed on malformed JSON so
	// the launch surfaces the real error instead of silently dropping every MCP
	// server.
	mcpServers, err := buildACPMcpServers(opts.McpConfig, b.cfg.Logger)
	if err != nil {
		return nil, fmt.Errorf("lumos: invalid mcp_config: %w", err)
	}

	timeout := opts.Timeout
	runCtx, cancel := runContext(ctx, timeout)

	lumosArgs := append(
		[]string{"acp"},
		filterCustomArgs(opts.CustomArgs, lumosBlockedArgs, b.cfg.Logger)...,
	)
	cmd := b.cfg.commandAt(execPath).exec(runCtx, lumosArgs...)
	hideAgentWindow(cmd)
	b.cfg.logAgentCommand(cmd, newAgentCommandLogArgs(lumosArgs,
		trustAgentCommandPositional(0, "acp"),
	))
	if opts.Cwd != "" {
		cmd.Dir = opts.Cwd
	}
	cmd.Env = buildEnv(b.cfg.Env)

	stdout, err := cmd.StdoutPipe()
	if err != nil {
		cancel()
		return nil, fmt.Errorf("lumos stdout pipe: %w", err)
	}
	stdin, err := cmd.StdinPipe()
	if err != nil {
		cancel()
		return nil, fmt.Errorf("lumos stdin pipe: %w", err)
	}
	// StderrPipe + an explicit copier give us a join point (stderrDone) that
	// fires before the failure-promotion decision; see the matching comment in
	// hermes.go for why the io.MultiWriter form races with stopReason=end_turn
	// under load.
	providerErr := newACPProviderErrorSniffer("lumos")
	stderr, err := cmd.StderrPipe()
	if err != nil {
		cancel()
		return nil, fmt.Errorf("lumos stderr pipe: %w", err)
	}

	if err := startOwnedProcessTree(cmd, b.cfg.Logger); err != nil {
		cancel()
		return nil, fmt.Errorf("start lumos: %w", err)
	}

	stderrSink := io.MultiWriter(newLogWriter(b.cfg.Logger, "[lumos:stderr] "), providerErr)
	stderrDone := make(chan struct{})
	go func() {
		defer close(stderrDone)
		_, _ = io.Copy(stderrSink, stderr)
	}()

	b.cfg.Logger.Info("lumos acp started", "pid", cmd.Process.Pid, "cwd", opts.Cwd)

	msgStream := newLumosMessageStream(256)
	resCh := make(chan Result, 1)

	// Lumos streams interim narration and the final answer as the same
	// agent_message_chunk type; the tracker keeps only the post-tool-call block
	// for Result.Output while retaining the full text for error detection.
	var deliverable acpDeliverableTracker
	var streamingCurrentTurn atomic.Bool

	promptDone := make(chan hermesPromptResult, 1)
	activity := make(chan struct{}, 1)

	c := &hermesClient{
		cfg:          b.cfg,
		stdin:        stdin,
		pending:      make(map[int]*pendingRPC),
		pendingTools: make(map[string]*pendingToolCall),
		acceptNotification: func(string) bool {
			return streamingCurrentTurn.Load()
		},
		onActivity: func() {
			select {
			case activity <- struct{}{}:
			default:
			}
		},
		onMessage: func(msg Message) {
			if !streamingCurrentTurn.Load() {
				return
			}
			deliverable.observe(msg)
			msgStream.send(msg)
		},
		onPromptDone: func(result hermesPromptResult) {
			if !streamingCurrentTurn.Load() {
				return
			}
			select {
			case promptDone <- result:
			default:
			}
		},
	}

	readerDone := make(chan struct{})
	go func() {
		defer close(readerDone)
		scanner := newAgentStreamScanner(stdout)
		for scanner.Scan() {
			line := strings.TrimSpace(scanner.Text())
			if line == "" {
				continue
			}
			c.handleLine(line)
		}
		c.closeAllPending(fmt.Errorf("lumos process exited"))
	}()

	go func() {
		defer cancel()
		defer msgStream.close()
		defer close(resCh)
		defer func() {
			stdin.Close()
			_ = cmd.Wait()
			releaseProcessGroup(cmd)
		}()

		startTime := time.Now()
		finalStatus := "completed"
		var finalError string
		var sessionID string
		// Set when the ACP runtime refuses the session we asked to resume.
		// Only that is curable by starting a fresh session, so handshake and
		// network failures below must leave it false.
		var resumeRejected bool
		effectiveModel := strings.TrimSpace(opts.Model)

		initResult, err := c.request(runCtx, "initialize", map[string]any{
			"protocolVersion": 1,
			"clientInfo": map[string]any{
				"name":    "lumen-agent-sdk",
				"version": "0.2.0",
			},
			"clientCapabilities": map[string]any{},
		})
		if err != nil {
			finalStatus = "failed"
			finalError = fmt.Sprintf("lumos initialize failed: %v", err)
			resCh <- Result{Status: finalStatus, Error: finalError, DurationMs: time.Since(startTime).Milliseconds()}
			return
		}

		// Lumos advertises no mcpCapabilities (it does not yet connect
		// per-session mcpServers), so this drops every MCP server we send.
		// The call is kept because the moment Lumos adds the capability the
		// servers start flowing with no Lumen-side change.
		mcpServers = filterACPMcpServersByCapability(mcpServers, extractACPMcpCapabilities(initResult), "lumos", b.cfg)

		cwd := opts.Cwd
		if cwd == "" {
			cwd = "."
		}

		if opts.ResumeSessionID != "" {
			// Lumos advertises loadSession:true, so resume goes through the
			// standard ACP session/load.
			result, err := c.request(runCtx, "session/load", map[string]any{
				"cwd":        cwd,
				"sessionId":  opts.ResumeSessionID,
				"mcpServers": mcpServers,
			})
			if err != nil {
				// A runtime that refuses the recorded id has to say so here:
				// without ResumeRejected the daemon reads the bare failure as
				// "checked, not a rejection", keeps the pointer and replays the
				// same dead session on every later turn (GH #8116).
				finalStatus, finalError, resumeRejected = classifyACPResumeFailure(
					runCtx, "lumos", "session/load", err, timeout, b.cfg.Logger)
				resCh <- Result{Status: finalStatus, Error: finalError, DurationMs: time.Since(startTime).Milliseconds(), ResumeRejected: resumeRejected}
				return
			}
			var changed bool
			sessionID, changed = resolveResumedSessionID(opts.ResumeSessionID, result)
			if changed {
				b.cfg.Logger.Warn("agent returned a different session id on resume — original was likely lost; continuing with the new id",
					"backend", "lumos",
					"requested", opts.ResumeSessionID,
					"actual", sessionID,
				)
			}
			if effectiveModel == "" {
				effectiveModel = extractACPCurrentModelID(result)
			}
		} else {
			result, err := c.request(runCtx, "session/new", map[string]any{
				"cwd":        cwd,
				"mcpServers": mcpServers,
			})
			if err != nil {
				finalStatus = "failed"
				finalError = fmt.Sprintf("lumos session/new failed: %v", err)
				resCh <- Result{Status: finalStatus, Error: finalError, DurationMs: time.Since(startTime).Milliseconds()}
				return
			}
			sessionID = extractACPSessionID(result)
			if sessionID == "" {
				finalStatus = "failed"
				finalError = "lumos session/new returned no session ID"
				resCh <- Result{Status: finalStatus, Error: finalError, DurationMs: time.Since(startTime).Milliseconds()}
				return
			}
			if effectiveModel == "" {
				effectiveModel = extractACPCurrentModelID(result)
			}
		}

		c.sessionID = sessionID
		b.cfg.Logger.Info("lumos session created", "session_id", sessionID)

		// opts.Model is intentionally not forwarded: Lumos's session/
		// setConfigOption accepts the value but never persists it, so sending
		// it would return success and leave the user with a picker that does
		// nothing. ModelSelectionSupported("lumos-acp") returns false so the
		// UI never offers the override in the first place; the guard here is
		// belt-and-braces for older clients that still set opts.Model.

		userText := prompt
		if opts.SystemPrompt != "" {
			userText = opts.SystemPrompt + "\n\n---\n\n" + prompt
		}

		streamingCurrentTurn.Store(true)
		_, err = c.request(runCtx, "session/prompt", map[string]any{
			"sessionId": sessionID,
			"prompt": []map[string]any{
				{"type": "text", "text": userText},
			},
		})
		if err != nil {
			if runCtx.Err() == context.DeadlineExceeded {
				finalStatus = "timeout"
				finalError = fmt.Sprintf("lumos timed out after %s", timeout)
			} else if runCtx.Err() == context.Canceled {
				finalStatus = "aborted"
				finalError = "execution cancelled"
			} else {
				finalStatus = "failed"
				finalError = fmt.Sprintf("lumos session/prompt failed: %v", err)
				if opts.ResumeSessionID != "" && isACPSessionNotFound(err) {
					b.cfg.Logger.Warn("resumed session not found at prompt time; clearing session id so the daemon retries fresh",
						"backend", "lumos",
						"session_id", sessionID,
					)
					sessionID = ""
					resumeRejected = true
				}
			}
		} else {
			select {
			case pr := <-promptDone:
				if pr.stopReason == "cancelled" {
					finalStatus = "aborted"
					finalError = "lumos cancelled the prompt"
				}
				c.mergeUsage(pr.usage)
			default:
			}
			waitForACPNotificationQuiescence(runCtx, activity, readerDone, acpNotificationQuietTime, lumosReaderDrainGrace)
		}

		duration := time.Since(startTime)
		b.cfg.Logger.Info("lumos finished", "pid", cmd.Process.Pid, "status", finalStatus, "duration", duration.Round(time.Millisecond).String())

		stdin.Close()
		cancel()

		// Lumos ACP may keep the process — and the stdout/stderr pipes — open
		// briefly after session/prompt returns. The prompt response is already
		// terminal, so bound the drain: wait for the stdout reader and the
		// stderr copier, but no longer than the grace window (CommandContext
		// cancellation tears the process down). Draining stderr is what makes
		// the provider-error promotion below see a terminal marker.
		drainCtx, drainCancel := context.WithTimeout(context.Background(), lumosReaderDrainGrace)
		select {
		case <-readerDone:
		case <-drainCtx.Done():
		}
		select {
		case <-stderrDone:
		case <-drainCtx.Done():
		}
		drainCancel()
		// Flip the gate before the defer closes msgStream; a late reader that
		// already passed the gate is serialized by lumosMessageStream so the
		// late send is dropped instead of panicking.
		streamingCurrentTurn.Store(false)

		finalOutput, providerErrorOutput := deliverable.result()

		// Promote completed→failed when stderr or the agent text stream show a
		// terminal upstream-LLM failure (HTTP 4xx / rate-limit / expired token).
		// Mirrors hermes/kimi/kiro/qoder/traecli.
		finalStatus, finalError = promoteACPResultOnProviderError(finalStatus, finalError, providerErrorOutput, providerErr)

		u := c.accumulatedUsage()

		var usageMap map[string]TokenUsage
		if acpUsagePresent(u) {
			model := effectiveModel
			if model == "" {
				model = "unknown"
			}
			usageMap = map[string]TokenUsage{model: u}
		}

		resCh <- Result{
			Status:         finalStatus,
			Output:         finalOutput,
			Error:          finalError,
			DurationMs:     duration.Milliseconds(),
			SessionID:      sessionID,
			ResumeRejected: resumeRejected,
			Usage:          usageMap,
		}
	}()

	return &Session{Messages: msgStream.ch, Result: resCh}, nil
}
