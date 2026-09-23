# Lumos ACP runtime

Lumen runs Lumos as a first-party ACP (Agent Client Protocol) runtime. The
integration path is the same shared `hermesClient` JSON-RPC transport that
drives Grok, Trae, Kimi, Kiro, Qoder, Dim, QwenPaw, ZeroClaw, MCode and
Hermes — only the binary, launch flags, blocked-flag policy and a few
backend-specific capabilities differ. Lumos is the reference first-party
runtime for ACP on the Lumen backend.

## Why Lumos

- ACP-native from the ground up: `lumos acp` is a JSON-RPC 2.0 stdio server
  that speaks the upstream Agent Client Protocol. The runtime does not
  require a custom bridge or compatibility layer.
- Capability surface matches the daemon's existing ACP transport: `initialize`,
  `session/new`, `session/load`, `session/resume`, `session/prompt`,
  `session/setMode`, `session/setConfigOption`, `session/list`,
  `session/close`, plus notifications on `session/update`. No
  `session/set_model` and no inline system-prompt channel — see
  *Capability gaps* below.
- A complete set of bundled skills, agent profiles, plugin runtime, A2A
  bridge and Pi-style ExtensionHost make Lumos the largest first-party
  capability surface in the Lumen ecosystem.

## Integration shape

- Family key: `lumos-acp`. First-party protocol family in
  `agent.SupportedTypes` (migration 536 widens
  `runtime_profile.protocol_family` to accept it).
- Binary: `lumos` on PATH or `LUMEN_LUMOS_PATH`. `LUMEN_LUMOS_ARGS` is
  reserved for the future once a use case lands; no env var currently
  drives a model knob because Lumos's model selection is owned by the
  Lumos agent profile, not a daemon-readable env var.
- Launch: `lumos acp` with `--help`, `--version`, `-h`, `tui`, `gui` and
  `server` blocked (see `lumosBlockedArgs`).
- Project skills: `.lumos/skills/` (per-task workdir). User skills:
  `~/.lumos/skills/` (overridable via `LUMOS_DATA_DIR`).
- AGENTS.md: lumos-acp reads `AGENTS.md` for runtime context delivery, the
  same way every other ACP family in the backend does.

## Capability gaps

- **No `session/set_model` and no usable `session/setConfigOption{model=…}`**
  — `do_set_config_option` ignores the `configId`/`value` pair it receives
  and just returns the static config-options list. The model is owned by
  the Lumos agent profile. The runtime opts out of
  `ModelSelectionSupported` so the UI never offers the override, and the
  backend does not send `session/setConfigOption{model=…}` even if a client
  sets `ExecOptions.Model`.
- **No `mcpCapabilities`** — Lumos advertises no per-session MCP server
  capability yet, so `filterACPMcpServersByCapability` drops every
  `mcpServers` entry on the wire. The session still runs, just without
  MCP. The MCP-config tab is hidden in the UI to match.
- **`session/load` and `session/resume` both replay history** — load
  additionally flushes retained messages back as `session/update`
  notifications. The shared ACP client's per-turn gate (`streamingCurrentTurn`)
  drops those out-of-turn chunks so a resume does not feed a prior answer
  back into the current turn's deliverable. The smoke test
  `TestLumosBackend_ResumeRejectionIsClassified` exercises the
  not-found path.
- **No reasoning-effort dial** — Lumos advertises a static
  `reasoning_effort` config option but the value the client sends is not
  persisted; `ThinkingControlSupported("lumos-acp")` is therefore false
  and the picker is hidden.

## Smoke testing

`TestLumosBackend_*` in `server/pkg/agent/lumos_*_test.go` runs a POSIX
stub of `lumos acp` (see `lumos_acp_fixture_unix_test.go`) through the
shared transport. The stub speaks the same shape as the real binary
(`initialize`, `session/new`, `session/load`, `session/prompt`,
`session/setConfigOption`, `-32601` for unknown methods).

Real-binary smoke (`LUMEN_RUN_REAL_AGENT_SMOKE=1`) is gated behind the
`agentintegration` tag and additionally guarded by `requireRealAgentSmoke`
so it never runs in default CI. To drive a real `lumos acp` end-to-end:

```
LUMEN_RUN_REAL_AGENT_SMOKE=1 \
  go test -tags=agentintegration ./pkg/agent \
    -run TestLumosRealACPSmoke -count=1 -v
```

The smoke spawns `lumos`, runs handshake → session/new → one prompt, and
asserts a terminal Result, a non-empty SessionID and at least one assistant
text/thinking message reaching the daemon. It will skip with a clear
message when no `lumos` binary is on PATH.

## Operational notes

- Lumos logs are mirrored through `[lumos:stderr]`; provider-error sniffing
  promotes a clean ACP `end_turn` response to `failed` when stderr or the
  final text block shows a terminal upstream-LLM error (mirrors Hermes /
  Kimi / Kiro / Qoder / Trae / ZeroClaw).
- The reader-drain grace is bounded by `lumosReaderDrainGrace` (2s). The
  prompt response — not the process exit — is the terminal signal, the
  same way Trae and Kimi are wired.
- MCP, reasoning-effort and model selection are deliberately not wired
  through. The corresponding UI affordances (MCP tab, picker) are
  removed rather than left inert.

## Related

- `server/pkg/agent/lumos_backend.go` — backend implementation.
- `server/pkg/agent/lumos_acp_fixture_unix_test.go` — POSIX stub used by
  the unit-test suite.
- `server/internal/daemon/agents_probe.go` — daemon probe.
- `server/internal/daemon/local_skills.go` — user skills root
  (honours `LUMOS_DATA_DIR`).
- `server/internal/daemon/execenv/runtime_config.go` — AGENTS.md injection.
