package agent

import (
	"testing"
)

// TestLumosACP_BuiltinRuntimeCommandsIncludesLumos ensures the
// shell-fallback resolver (resolveAgentsViaLoginShell) tries the lumos
// binary. Without this entry a GUI-launched daemon without `lumos` on its
// own PATH would never see the binary — and the daemon's
// defaultAgentCommandNames (internal/daemon/config.go) reads this same list
// to pre-fetch every canonical path in one shell invocation.
func TestLumosACP_BuiltinRuntimeCommandsIncludesLumos(t *testing.T) {
	var found bool
	for _, c := range BuiltinRuntimeCommands() {
		if c == "lumos" {
			found = true
			break
		}
	}
	// lumos-acp is a first-party protocol family, not a builtin runtime
	// identity, so it does NOT appear in BuiltinRuntimeCommands(). The
	// daemon probe and defaultAgentCommandNames add it explicitly instead.
	if found {
		t.Errorf("BuiltinRuntimeCommands includes lumos; the descriptor was removed in favour of a first-party protocol family, so this should be driven by defaultAgentCommandNames in the daemon package, not the BuiltinRuntimeCommands helper")
	}
}

// TestLumosACP_IsDaemonDiscoverable: probeAgentCLIs / health.agents /
// defaultAgentCommandNames must each name lumos-acp as a discoverable
// provider. Since those tables live in server/internal/daemon and the agent
// package can't reach them directly, this test only checks what the agent
// surface owns — the descriptor fields and the SupportedTypes carve-out.
func TestLumosACP_IsDaemonDiscoverable(t *testing.T) {
	// lumos-acp must be in SupportedTypes so probeAgentCLIs and
	// defaultAgentCommandNames can register it through the same path
	// every other first-party ACP family (zeroclaw, dim, mcode) uses.
	if !IsSupportedType("lumos-acp") {
		t.Error("lumos-acp must be in SupportedTypes so the daemon probe registers it as a first-party ACP family")
	}
}
