package agent

import (
	"encoding/json"
	"io"
	"log/slog"
	"os/exec"
	"strings"
	"testing"
)

// TestLumosACP_IsFirstPartyProtocolFamily pins the migration-536 contract:
// lumos-acp is a first-party ACP protocol family in SupportedTypes, so the
// runtime_profile.protocol_family CHECK constraint accepts it for new rows.
// The runtime MUST route through New (not NewRuntime) — there is no
// BuiltinRuntimes descriptor entry, and the backend must NOT carry
// descriptor-override plumbing.
func TestLumosACP_IsFirstPartyProtocolFamily(t *testing.T) {
	if !IsSupportedType("lumos-acp") {
		t.Fatal("lumos-acp must be in SupportedTypes so runtime_profile.protocol_family accepts it for new rows")
	}

	backend, err := New("lumos-acp", Config{Logger: slog.Default()})
	if err != nil {
		t.Fatalf("New(lumos-acp): %v", err)
	}
	lb, ok := backend.(*lumosBackend)
	if !ok {
		t.Fatalf("New(lumos-acp) returned %T, want *lumosBackend", backend)
	}
	if IsBuiltinRuntime("lumos-acp") {
		t.Fatal("lumos-acp must NOT also be a BuiltinRuntimes entry; it is one or the other")
	}

	// The backend no longer carries descriptor-override plumbing: there is no
	// BuiltinRuntime applying defaults to it, so fields like
	// backendOverrideApplicator would only get in the way.
	if _, ok := any(lb).(backendOverrideApplicator); ok {
		t.Error("lumosBackend must not implement backendOverrideApplicator; the descriptor was removed in favour of a first-party protocol family")
	}

	// ResolveBackend dispatches via New (family) for first-party types, not
	// NewRuntime (runtime identity).
	resolved, err := ResolveBackend("lumos-acp", Config{Logger: slog.Default()})
	if err != nil {
		t.Fatalf("ResolveBackend(lumos-acp): %v", err)
	}
	if _, ok := resolved.(*lumosBackend); !ok {
		t.Fatalf("ResolveBackend returned %T, want *lumosBackend", resolved)
	}
}

// TestLumosACP_FamilyContractMirrorsZeroclaw: every surface that names
// lumos-acp as a protocol family (instead of a runtime identity) has to stay
// in lockstep with the migration whitelist and the SupportedTypes/New
// factories, just like zeroclaw.
func TestLumosACP_FamilyContractMirrorsZeroclaw(t *testing.T) {
	if LaunchHeader("lumos-acp") == "" {
		t.Error("LaunchHeader(lumos-acp) is empty; add it to launchHeaders")
	}
	if !IsSupportedType("lumos-acp") {
		t.Error("IsSupportedType(lumos-acp) = false; add lumos-acp to SupportedTypes")
	}
}

// TestLumosACP_BlockedArgsProtectTransport pins the launch argv: the ACP
// transport is selected by the bare `acp` subcommand. Custom args cannot
// drop `acp` or switch the binary to its TUI/server subcommands.
func TestLumosACP_BlockedArgsProtectTransport(t *testing.T) {
	got := filterCustomArgs(
		[]string{"acp", "tui", "gui", "server", "--version", "--help", "-h", "--verbose"},
		lumosBlockedArgs,
		slog.New(slog.NewTextHandler(io.Discard, nil)),
	)
	for _, blocked := range []string{"acp", "tui", "gui", "server", "--version", "--help", "-h"} {
		for _, arg := range got {
			if arg == blocked {
				t.Errorf("filterCustomArgs let %q through: %v", blocked, got)
			}
		}
	}
}

// TestLumosACP_MissingExecutableFailsClosed verifies a host without the
// lumos binary gets an actionable error rather than a panic or a silent
// no-op session.
func TestLumosACP_MissingExecutableFailsClosed(t *testing.T) {
	backend := &lumosBackend{
		cfg: Config{Logger: slog.Default(), ExecutablePath: "/definitely/not/lumos"},
	}
	_, err := backend.Execute(t.Context(), "hi", ExecOptions{})
	if err == nil {
		t.Fatal("Execute succeeded with a nonexistent executable; want an error")
	}
	if !strings.Contains(err.Error(), "lumos executable not found") {
		t.Errorf("error %q does not name the missing lumos executable", err)
	}
}

// TestLumosACP_RejectsUnparseableMcpConfig verifies the MCP translation
// fails closed before any process is spawned, mirroring traecli/grok/zeroclaw.
// The executable has to exist (the backend checks the path first), so we
// point at a real binary that is not a real lumos — the mcp_config error
// fires before anything is launched either way.
func TestLumosACP_RejectsUnparseableMcpConfig(t *testing.T) {
	execPath, err := exec.LookPath("sh")
	if err != nil {
		t.Skipf("no sh on PATH: %v", err)
	}
	backend := &lumosBackend{cfg: Config{Logger: slog.Default(), ExecutablePath: execPath}}
	_, err = backend.Execute(t.Context(), "hi", ExecOptions{
		McpConfig: json.RawMessage(`{"mcpServers": "not-an-object"}`),
	})
	if err == nil {
		t.Fatal("Execute accepted a malformed mcp_config; want an error")
	}
	if !strings.Contains(err.Error(), "invalid mcp_config") {
		t.Errorf("error %q does not report the mcp_config problem", err)
	}
}

// TestLumosACP_ModelSelectionIsNotAdvertised mirrors the ZeroClaw pattern
// (MUL-6511): the Lumos ACP server's do_set_config_option ignores the
// configId/value pair it receives, so sending session/setConfigOption{model=…}
// would return success and leave the user with a picker that does nothing.
// The runtime therefore opts out of ModelSelectionSupported.
func TestLumosACP_ModelSelectionIsNotAdvertised(t *testing.T) {
	if ModelSelectionSupported("lumos-acp") {
		t.Error("ModelSelectionSupported(lumos-acp) = true; Lumos's setConfigOption ignores the model value, so advertising model selection would surface an inert picker")
	}
	cat, err := ListModels(t.Context(), "lumos-acp", Command{Path: "/usr/bin/lumos"})
	if err != nil {
		t.Fatalf("ListModels(lumos-acp) error: %v", err)
	}
	if len(cat.Models) != 0 {
		t.Errorf("ListModels(lumos-acp) returned %d models, want empty (Lumos advertises no model catalog)", len(cat.Models))
	}
}
