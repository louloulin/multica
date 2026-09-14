// GitHub Pusher — issue panel surface.
//
// A sandboxed iframe with no credential. Everything it does routes through the
// host bridge: the host holds the user's session and rate limits the calls,
// the plugin author's server holds the GitHub token. This file holds neither.
//
// The surface lets a person compose a small push: pick files (or paste them
// inline), pick a branch, write a message, and dispatch. The hook does the
// real work — this file is the consent screen.

const pending = new Map();
const port = globalThis.__multicaPluginBridgePortV2;
let sequence = 0;

if (!(port instanceof MessagePort)) throw new Error("Multica surface bridge is unavailable");
delete globalThis.__multicaPluginBridgePortV2;
port.onmessage = (message) => {
  const payload = message.data;
  if (payload?.kind === "theme") return applyTheme(payload.theme);
  const entry = pending.get(payload?.id);
  if (!entry) return;
  pending.delete(payload.id);
  if (payload.ok) entry.resolve(payload.data);
  else entry.reject(new Error(payload.error));
};
port.start();

function applyTheme(theme) {
  for (const [name, value] of Object.entries(theme ?? {})) {
    document.documentElement.style.setProperty(name, value);
  }
}

function call(method, path, body) {
  const id = `r${++sequence}`;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    port.postMessage({ id, kind: "action", method, path, body });
  });
}

function resize() {
  port.postMessage({ id: `resize${Date.now()}`, kind: "ui.resize", height: document.body.scrollHeight + 16 });
}

const DRAFT_KEY = "github-pusher/draft";

function readDraft(value) {
  try { return JSON.parse(value); } catch { return null; }
}

async function start() {
  const root = document.getElementById("root");
  root.innerHTML = `
    <div style="padding:14px; display:grid; gap:12px; font-family:inherit">
      <header style="display:flex; align-items:baseline; justify-content:space-between; gap:8px">
        <strong>Push to GitHub</strong>
        <span id="target" style="color:var(--muted-foreground); font-size:12px"></span>
      </header>

      <label style="display:grid; gap:4px">
        <span style="font-size:12px; color:var(--muted-foreground)">Branch</span>
        <input id="branch" placeholder="feature/lum834-pi0911"
               style="padding:6px 8px; border:1px solid var(--border); border-radius:var(--radius,6px);
                      background:var(--background); color:var(--foreground)">
      </label>

      <label style="display:grid; gap:4px">
        <span style="font-size:12px; color:var(--muted-foreground)">Commit message</span>
        <textarea id="message" rows="3" placeholder="feat(scope): what changed"
                  style="padding:6px 8px; border:1px solid var(--border); border-radius:var(--radius,6px);
                         background:var(--background); color:var(--foreground); font-family:inherit"></textarea>
      </label>

      <label style="display:grid; gap:4px">
        <span style="font-size:12px; color:var(--muted-foreground)">Files — path:content, one per line. Use \\n for newlines.</span>
        <textarea id="files" rows="8" placeholder="docs/notes.md:## Notes"
                  style="padding:6px 8px; border:1px solid var(--border); border-radius:var(--radius,6px);
                         background:var(--background); color:var(--foreground); font-family:ui-monospace,monospace; font-size:12px"></textarea>
      </label>

      <label style="display:flex; gap:8px; align-items:center; font-size:12px">
        <input id="update-only" type="checkbox">
        <span>update_only — refuse to add files that don't exist yet</span>
      </label>

      <div style="display:flex; gap:8px">
        <button id="save-draft" style="padding:6px 10px">Save draft</button>
        <button id="push" style="padding:6px 12px; font-weight:600">Push</button>
      </div>

      <pre id="status" style="margin:0; color:var(--muted-foreground); white-space:pre-wrap; min-height:1.2em; font-size:12px"></pre>
    </div>
  `;

  const status = (text) => { root.querySelector("#status").textContent = text; resize(); };

  try {
    const context = await call("GET", "/context");
    root.querySelector("#target").textContent =
      context.config.repo_owner && context.config.repo_name
        ? `${context.config.repo_owner}/${context.config.repo_name}`
        : "(configure repo in plugin settings)";

    const stored = await call("GET", `/storage/user/${DRAFT_KEY}`).catch(() => null);
    const draft = stored?.value ? readDraft(stored.value) : null;
    if (draft) {
      root.querySelector("#branch").value = draft.branch ?? "";
      root.querySelector("#message").value = draft.message ?? "";
      root.querySelector("#files").value = draft.files ?? "";
      root.querySelector("#update-only").checked = Boolean(draft.updateOnly);
    }

    root.querySelector("#save-draft").onclick = async () => {
      const value = JSON.stringify({
        branch: root.querySelector("#branch").value,
        message: root.querySelector("#message").value,
        files: root.querySelector("#files").value,
        updateOnly: root.querySelector("#update-only").checked,
      });
      await call("PUT", `/storage/user/${DRAFT_KEY}`, { value });
      status("Draft saved.");
    };

    root.querySelector("#push").onclick = async () => {
      try {
        const lines = root.querySelector("#files").value.split("\n").map((line) => line.trim()).filter(Boolean);
        const files = {};
        for (const line of lines) {
          const colon = line.indexOf(":");
          if (colon < 0) throw new Error(`missing ':' on line: ${line}`);
          const path = line.slice(0, colon).trim();
          const content = line.slice(colon + 1).replace(/\\n/g, "\n");
          if (!path) throw new Error(`empty path on line: ${line}`);
          files[path] = content;
        }
        const input = {
          branch: root.querySelector("#branch").value.trim(),
          message: root.querySelector("#message").value,
          files,
          update_only: root.querySelector("#update-only").checked,
        };
        if (!input.branch) throw new Error("branch is required");
        if (!input.message.trim()) throw new Error("commit message is required");
        if (Object.keys(input.files).length === 0) throw new Error("at least one file is required");

        const issue = await call("GET", `/issues/${encodeURIComponent(context.issue.id)}`);
        status("Pushing via hook…");
        const result = await call("POST", `/hooks/push_files`, {
          trigger: "ui",
          issue_id: context.issue.id,
          input,
        });
        const summary = result.status === "pushed"
          ? `Pushed ${result.commit_sha.slice(0, 7)} to ${result.branch} — ${result.files_committed.length} file(s).\n${result.commit_url}`
          : `Rejected: ${result.reason}`;
        status(summary);
        // Record the outcome on the issue. ui/manual hooks post as the user.
        await call("POST", `/issues/${encodeURIComponent(issue.id)}/comments`, {
          content: `**GitHub Pusher** — ${summary.replace(/\n/g, "\n> ")}`,
        });
      } catch (error) {
        status(error.message);
      }
    };
  } catch (error) {
    status(error.message);
  }
  resize();
}

start();
