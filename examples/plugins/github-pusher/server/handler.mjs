#!/usr/bin/env node
/**
 * GitHub Pusher — the plugin author's side of the wire.
 *
 * Lumen only ever sends this a signed POST. Everything security-relevant is
 * on this side: signature verification, replay rejection, and the GitHub
 * token. The token never crosses the host boundary into an iframe.
 *
 * Run:
 *   LUMEN_SIGNING_SECRET=whsec_... node handler.mjs
 *
 * Env:
 *   LUMEN_SIGNING_SECRET  — whsec_… shown once when an admin rotates the
 *                             plugin token in workspace settings. Required.
 *   PORT                    — port to listen on (default 8790).
 *   TLS_CERT / TLS_KEY      — paths to PEM files. Hook transport URLs must be
 *                             HTTPS, so a handler that only speaks HTTP cannot
 *                             be pointed at even in development.
 *
 * The handler talks to api.github.com (not github.com) because the network
 * conditions that motivate this plugin usually leave `github.com` blocked.
 */

import { createServer as createHTTPServer } from "node:http";
import { createServer as createHTTPSServer } from "node:https";
import { readFileSync } from "node:fs";
import { createHmac, timingSafeEqual } from "node:crypto";

const PORT = Number(process.env.PORT ?? 8790);
const SIGNING_SECRET = process.env.LUMEN_SIGNING_SECRET ?? "";
const REPLAY_WINDOW_SECONDS = 5 * 60;
const GITHUB_API = "https://api.github.com";

// ---------- signature / replay protection ----------

const seenSignatures = new Map();

function pruneSeen(now) {
  for (const [signature, at] of seenSignatures) {
    if (now - at > REPLAY_WINDOW_SECONDS * 1000) seenSignatures.delete(signature);
  }
}

function verifySignature(rawBody, headers) {
  if (!SIGNING_SECRET) return { ok: false, reason: "server has no signing secret configured" };
  const timestamp = headers["x-lumen-timestamp"];
  const presented = String(headers["x-lumen-signature"] ?? "").replace(/^v1=/, "");
  if (!timestamp || !presented) return { ok: false, reason: "missing signature headers" };

  const drift = Math.abs(Math.floor(Date.now() / 1000) - Number(timestamp));
  if (!Number.isFinite(drift) || drift > REPLAY_WINDOW_SECONDS) {
    return { ok: false, reason: "timestamp outside the replay window" };
  }

  const expected = createHmac("sha256", SIGNING_SECRET).update(`${timestamp}.${rawBody}`).digest("hex");
  const provided = Buffer.from(presented, "utf8");
  const computed = Buffer.from(expected, "utf8");
  if (provided.length !== computed.length || !timingSafeEqual(provided, computed)) {
    return { ok: false, reason: "signature mismatch" };
  }

  pruneSeen(Date.now());
  if (seenSignatures.has(presented)) return { ok: false, reason: "this request was already delivered" };
  seenSignatures.set(presented, Date.now());
  return { ok: true };
}

// ---------- input validation ----------

function badRequest(reply, reason) {
  return reply(400, { status: "rejected", reason });
}

function normalizePath(raw) {
  if (typeof raw !== "string" || raw.length === 0) return null;
  if (raw.startsWith("/") || raw.startsWith("\\")) return null;
  if (raw.split("/").some((segment) => segment === ".." || segment === ".")) return null;
  return raw.replace(/\\/g, "/");
}

function validateFiles(raw) {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return { ok: false, reason: "`files` must be an object mapping path -> string content" };
  }
  const files = {};
  for (const [path, content] of Object.entries(raw)) {
    const normalized = normalizePath(path);
    if (!normalized) return { ok: false, reason: `invalid path: ${path}` };
    if (typeof content !== "string") return { ok: false, reason: `content for ${normalized} is not a string` };
    files[normalized] = content;
  }
  const paths = Object.keys(files);
  if (paths.length === 0) return { ok: false, reason: "`files` must contain at least one entry" };
  if (paths.length > 100) return { ok: false, reason: "more than 100 files in one call; split the push" };
  return { ok: true, files };
}

// ---------- GitHub REST helper ----------

async function github(token, path, init = {}) {
  const response = await fetch(`${GITHUB_API}${path}`, {
    ...init,
    headers: {
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      Authorization: `Bearer ${token}`,
      ...(init.body ? { "Content-Type": "application/json" } : {}),
      ...(init.headers ?? {}),
    },
  });
  const text = await response.text();
  const body = text ? JSON.parse(text) : null;
  if (!response.ok) {
    const message = body?.message ?? `GitHub answered ${response.status}`;
    throw new Error(`GitHub ${response.status} ${path}: ${message}`);
  }
  return body;
}

// ---------- core: push files via the Git Database API ----------

async function getRefSha(token, owner, repo, ref) {
  const data = await github(token, `/repos/${owner}/${repo}/git/ref/${encodeURIComponent(ref)}`);
  return data?.object?.sha ?? null;
}

async function getCommit(token, owner, repo, sha) {
  return github(token, `/repos/${owner}/${repo}/git/commits/${sha}`);
}

async function ensureBranch({ token, owner, repo, branch, baseBranch }) {
  // Tries refs/heads/<branch>; 404 means the branch does not yet exist and we
  // need to create it from baseBranch. The branch must not already be a tag.
  try {
    return { branch, created: false, sha: await getRefSha(token, owner, repo, `heads/${branch}`) };
  } catch (error) {
    if (!String(error.message).includes(" 404 ")) throw error;
  }
  const baseSha = await getRefSha(token, owner, repo, `heads/${baseBranch}`);
  await github(token, `/repos/${owner}/${repo}/git/refs`, {
    method: "POST",
    body: JSON.stringify({ ref: `refs/heads/${branch}`, sha: baseSha }),
  });
  return { branch, created: true, sha: baseSha };
}

async function createBlob({ token, owner, repo, content }) {
  const blob = await github(token, `/repos/${owner}/${repo}/git/blobs`, {
    method: "POST",
    body: JSON.stringify({ content, encoding: "utf-8" }),
  });
  return blob.sha;
}

async function buildTree({ token, owner, repo, baseTreeSha, entries }) {
  const body = {
    base_tree: baseTreeSha,
    tree: entries.map((entry) => ({
      path: entry.path,
      mode: "100644",
      type: "blob",
      sha: entry.sha,
    })),
  };
  return github(token, `/repos/${owner}/${repo}/git/trees`, {
    method: "POST",
    body: JSON.stringify(body),
  });
}

async function createCommit({ token, owner, repo, message, treeSha, parentSha, committer }) {
  const body = {
    message,
    tree: treeSha,
    parents: [parentSha],
    committer,
    author: committer,
  };
  return github(token, `/repos/${owner}/${repo}/git/commits`, {
    method: "POST",
    body: JSON.stringify(body),
  });
}

async function updateRef({ token, owner, repo, branch, sha }) {
  return github(token, `/repos/${owner}/${repo}/git/refs/${encodeURIComponent(`heads/${branch}`)}`, {
    method: "PATCH",
    body: JSON.stringify({ sha, force: false }),
  });
}

async function getTreeRecursive({ token, owner, repo, sha }) {
  return github(token, `/repos/${owner}/${repo}/git/trees/${sha}?recursive=1`);
}

async function pushFiles(input, config) {
  const { github_token: token, repo_owner: owner, repo_name: repo, default_branch: defaultBranch,
          default_committer_name: name, default_committer_email: email } = config;
  if (!token || !owner || !repo || !defaultBranch || !name || !email) {
    return { status: "rejected", reason: "github_token, repo_owner, repo_name, default_branch, default_committer_name, default_committer_email are all required" };
  }

  const { branch, message, files, updateOnly } = input;
  if (typeof branch !== "string" || branch.length === 0) return { status: "rejected", reason: "`branch` is required" };
  if (branch.startsWith("refs/")) return { status: "rejected", reason: "`branch` must be a short branch name, not a full ref" };
  if (typeof message !== "string" || message.trim().length === 0) return { status: "rejected", reason: "`message` is required" };

  const validated = validateFiles(files);
  if (!validated.ok) return { status: "rejected", reason: validated.reason };

  const baseBranch = input.base_branch || defaultBranch;
  const ensured = await ensureBranch({ token, owner, repo, branch, baseBranch });
  const parentCommit = await getCommit(token, owner, repo, ensured.sha);
  const parentTreeSha = parentCommit.treeSha;

  // When `update_only` is set, refuse to add or remove files: every provided
  // path must already be in the parent tree, and the resulting tree must not
  // shrink the file count by removing anything not in the input set.
  const existing = await getTreeRecursive({ token, owner, repo, sha: parentTreeSha });
  const existingPaths = new Set(existing.tree.filter((entry) => entry.type === "blob").map((entry) => entry.path));
  const requestedPaths = new Set(Object.keys(validated.files));

  if (updateOnly) {
    for (const path of requestedPaths) {
      if (!existingPaths.has(path)) {
        return { status: "rejected", reason: `update_only: ${path} is not yet in the repository; add it in a non-update push first` };
      }
    }
  }

  const entries = [];
  for (const [path, content] of Object.entries(validated.files)) {
    const sha = await createBlob({ token, owner, repo, content });
    entries.push({ path, sha });
  }

  const tree = await buildTree({ token, owner, repo, baseTreeSha: parentTreeSha, entries });
  const committer = { name, email };
  const commit = await createCommit({
    token, owner, repo,
    message: message.trim(),
    treeSha: tree.sha,
    parentSha: ensured.sha,
    committer,
  });
  await updateRef({ token, owner, repo, branch, sha: commit.sha });

  return {
    status: "pushed",
    branch,
    branch_created: ensured.created,
    base_branch: baseBranch,
    commit_sha: commit.sha,
    commit_url: `https://github.com/${owner}/${repo}/commit/${commit.sha}`,
    files_committed: entries.map((entry) => entry.path),
    files_added: entries
      .map((entry) => entry.path)
      .filter((path) => !existingPaths.has(path)),
    files_updated: entries
      .map((entry) => entry.path)
      .filter((path) => existingPaths.has(path)),
    update_only: Boolean(updateOnly),
  };
}

// ---------- HTTP transport ----------

function tlsOptions() {
  const cert = process.env.TLS_CERT ?? "dev-cert.pem";
  const key = process.env.TLS_KEY ?? "dev-key.pem";
  try {
    return { cert: readFileSync(cert), key: readFileSync(key) };
  } catch (error) {
    console.error(`Could not read ${cert} / ${key}: ${error.message}`);
    console.error("Generate one with: openssl req -x509 -newkey rsa:2048 -nodes -days 365 -keyout dev-key.pem -out dev-cert.pem -subj '/CN=127.0.0.1' -addext 'subjectAltName=IP:127.0.0.1'");
    process.exit(1);
  }
}

const createServer = process.env.TLS_CERT && process.env.TLS_KEY
  ? (handler) => createHTTPServer(tlsOptions(), handler)
  : createHTTPServer;

const server = createServer(async (req, res) => {
  if (req.method !== "POST") {
    res.writeHead(405, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "method not allowed" }));
    return;
  }

  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const rawBody = Buffer.concat(chunks).toString("utf8");

  const reply = (status, payload) => {
    res.writeHead(status, { "Content-Type": "application/json" });
    res.end(JSON.stringify(payload));
  };

  const verified = verifySignature(rawBody, req.headers);
  if (!verified.ok) {
    console.warn(`refused ${req.url}: ${verified.reason}`);
    return reply(401, { error: verified.reason });
  }

  let payload;
  try {
    payload = JSON.parse(rawBody || "{}");
  } catch {
    return reply(400, { error: "body is not valid JSON" });
  }

  const { hook_key: hookKey, input = {}, config = {} } = payload;

  try {
    switch (hookKey) {
      case "push_files": {
        const result = await pushFiles(input, config);
        return reply(result.status === "pushed" ? 200 : 422, result);
      }
      case "create_branch": {
        if (typeof input.new_branch !== "string" || input.new_branch.length === 0) {
          return reply(400, { status: "rejected", reason: "`new_branch` is required" });
        }
        if (input.new_branch.startsWith("refs/")) {
          return reply(400, { status: "rejected", reason: "`new_branch` must be a short branch name, not a full ref" });
        }
        const baseBranch = input.base_branch || config.default_branch;
        if (!config.github_token || !config.repo_owner || !config.repo_name || !baseBranch) {
          return reply(400, { status: "rejected", reason: "github_token, repo_owner, repo_name, default_branch are required" });
        }
        const ensured = await ensureBranch({
          token: config.github_token,
          owner: config.repo_owner,
          repo: config.repo_name,
          branch: input.new_branch,
          baseBranch,
        });
        return reply(200, { status: ensured.created ? "created" : "exists", branch: input.new_branch, base_branch: baseBranch });
      }
      default:
        return reply(404, { error: `unknown hook ${hookKey}` });
    }
  } catch (error) {
    console.error(`${hookKey} failed:`, error.message);
    return reply(502, { status: "error", reason: error.message });
  }
});

server.listen(PORT, () => {
  console.log(`GitHub Pusher listening on ${process.env.TLS_CERT ? "https" : "http"}://0.0.0.0:${PORT}`);
  if (!SIGNING_SECRET) {
    console.warn("LUMEN_SIGNING_SECRET is not set — every request will be refused.");
  }
});
