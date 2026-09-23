package agent

import "testing"

// TestLumosACP_RuntimeProtocolFamilyResolves pins the migration-536 contract
// the create-profile handler relies on: lumos-acp is in SupportedTypes, so
// RuntimeProtocolFamily("lumos-acp") returns ("lumos-acp", true) without
// falling through to BuiltinRuntimeByID. The DB CHECK constraint then accepts
// the value as a first-party protocol family.
func TestLumosACP_RuntimeProtocolFamilyResolves(t *testing.T) {
	family, ok := RuntimeProtocolFamily("lumos-acp")
	if !ok {
		t.Fatalf("RuntimeProtocolFamily(lumos-acp) = not-supported; the create-profile handler would reject it")
	}
	if family != "lumos-acp" {
		t.Fatalf("family = %q, want lumos-acp", family)
	}
}

// TestLumosACP_NotBuiltinRuntimeIdentity: lumos-acp is a protocol family,
// not a builtin runtime identity. The descriptor that used to make it a
// runtime identity was removed when migration 536 promoted it to a
// first-party family; runtime identities (e.g. omp) co-exist with their
// protocol family on the BuiltinRuntimeByID table, but lumos-acp no longer
// does.
func TestLumosACP_NotBuiltinRuntimeIdentity(t *testing.T) {
	if IsBuiltinRuntime("lumos-acp") {
		t.Fatal("lumos-acp is a first-party protocol family; the descriptor entry was removed")
	}
	if _, ok := BuiltinRuntimeByID("lumos-acp"); ok {
		t.Error("BuiltinRuntimeByID(lumos-acp) returned a descriptor; the lumos-acp entry was removed from BuiltinRuntimes")
	}
}
