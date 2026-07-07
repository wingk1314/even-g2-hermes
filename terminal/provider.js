// Hermes provider — adapts Hermes Agent into the even-terminal bridge's
// provider interface.
//
// Mirrors the surface implemented by claude/provider.js + codex/provider.js:
//   listSessions(limit, cwd) -> Session[]
//   getSessionStatus(sessionId) -> "idle" | "busy"
//   getInfo() -> { account, model, version, provider }
//   getHistory(sessionId, limit) -> historyEntry[]
//   prompt(sessionId, text, cwd) -> { sessionId, provider }
//   respondPermission(sessionId, decision)
//   respondQuestion(sessionId, answer)
//   interrupt(sessionId)
//   getStatus(sessionId) -> { state, provider } | null

import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { execFile, spawn } from "node:child_process";

const HOME = homedir();
const HERMES_CONFIG = join(HOME, ".hermes", "config.yaml");
const MEMORY_FILE = join(HOME, ".hermes", "even-g2", "terminal", "memory.json");
const MEMORY_LIMIT = 5;

// ── Memory ──────────────────────────────────────────────────────────

function loadMemory() {
  try {
    return JSON.parse(readFileSync(MEMORY_FILE, "utf8"));
  } catch {
    return [];
  }
}

function saveMemory(exchanges) {
  const dir = join(HOME, ".hermes", "even-g2", "terminal");
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(MEMORY_FILE, JSON.stringify(exchanges.slice(-MEMORY_LIMIT), null, 2));
}

// ── System prompt ───────────────────────────────────────────────────

const SYSTEM_PROMPT =
  "You are Alita, Ricky's personal AI assistant running on a local Mac. " +
  "Your responses appear on a HUD in the Even Realities G2 smart glasses — " +
  "a 576×136px monochrome display. " +
  "Given the tiny display, provide SHORT, DIRECT answers — 1-2 sentences max. " +
  "Be practical and concise. Never leave a sentence unfinished.";

// ── Hermes session ──────────────────────────────────────────────────

export const HERMES_SYNTHETIC_SESSION_ID = "hermes-main";

export class HermesSession {
  emit;
  sessionId = HERMES_SYNTHETIC_SESSION_ID;
  _busy = false;
  busyEmitted = false;
  abortController = null;
  promptQueue = [];
  turnStartMs = 0;
  childProcess = null;

  constructor(emit) {
    this.emit = emit;
  }

  get id() { return this.sessionId; }
  get busy() { return this._busy; }
  get alive() { return true; }
  get status() { return this._busy ? "busy" : "idle"; }

  send(msg) {
    this.emit(this.sessionId, msg);
  }

  waitForId() {
    return Promise.resolve(this.sessionId);
  }

  onIdReady(cb) {
    queueMicrotask(() => cb(this.sessionId));
  }

  async start(_sessionId, _cwd) {
    // No-op; Hermes is always ready.
  }

  enqueue(text) {
    this.promptQueue.push(text);
    console.log(`[hermes-session] Enqueued prompt (queue size: ${this.promptQueue.length})`);
  }

  async run(text) {
    if (this._busy) {
      throw new Error("Session is busy");
    }
    this._busy = true;
    this.busyEmitted = true;
    this.turnStartMs = Date.now();

    this.send({ type: "status", state: "busy", sessionId: this.sessionId });

    // Build query with memory context
    const history = loadMemory();
    const parts = [];
    parts.push(`System: ${SYSTEM_PROMPT}`);
    for (const exchange of history) {
      parts.push(`User: ${exchange.user}`);
      parts.push(`Assistant: ${exchange.assistant}`);
    }
    parts.push(`User: ${text}`);
    const query = parts.join("\n");

    try {
      const reply = await this._callHermes(query);

      // Truncate for HUD
      let displayText = reply;
      if (displayText.length > 400) {
        const truncated = displayText.slice(0, 400);
        const lastPeriod = Math.max(
          truncated.lastIndexOf(". "),
          truncated.lastIndexOf("。"),
          truncated.lastIndexOf("! "),
          truncated.lastIndexOf("? ")
        );
        displayText = lastPeriod > 200
          ? truncated.slice(0, lastPeriod + 1)
          : truncated + "…";
      }

      this.send({ type: "text_delta", text: displayText });

      // Save to memory
      if (reply && !reply.startsWith("(")) {
        const memHistory = loadMemory();
        memHistory.push({ user: text, assistant: reply });
        saveMemory(memHistory);
      }

      this._finish(true, displayText);
    } catch (err) {
      console.error(`[hermes-session] run failed: ${err?.message || err}`);
      this.send({ type: "error", message: String(err?.message || err).slice(0, 500) });
      this._finish(false, String(err?.message || err));
    }
  }

  _callHermes(query) {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        if (this.childProcess) {
          this.childProcess.kill("SIGTERM");
        }
        resolve("(thinking too hard — check Telegram for the full answer)");
      }, 25000);

      this.childProcess = spawn("hermes", ["chat", "-q", query, "-Q"], {
        env: { ...process.env, TERM: "dumb" },
        stdio: ["pipe", "pipe", "pipe"],
      });

      let stdout = "";
      let stderr = "";

      this.childProcess.stdout.on("data", (chunk) => {
        stdout += chunk.toString();
      });

      this.childProcess.stderr.on("data", (chunk) => {
        stderr += chunk.toString();
      });

      this.childProcess.on("close", (code) => {
        clearTimeout(timeout);
        this.childProcess = null;
        if (code === 0 || stdout.trim()) {
          resolve(stdout.trim() || "(empty response)");
        } else {
          reject(new Error(`hermes exited ${code}: ${stderr.slice(0, 200)}`));
        }
      });

      this.childProcess.on("error", (err) => {
        clearTimeout(timeout);
        this.childProcess = null;
        reject(err);
      });
    });
  }

  _finish(success, text, opts = {}) {
    this._busy = false;
    if (!opts.skipResultEvent) {
      this.send({
        type: "result",
        success,
        text,
        sessionId: this.sessionId,
        costUsd: 0,
        provider: "hermes",
        turns: 1,
        durationMs: Date.now() - this.turnStartMs,
        inputTokens: 0,
        outputTokens: 0,
      });
    }
    if (this.promptQueue.length > 0) {
      const next = this.promptQueue.shift();
      console.log(`[hermes-session] Dispatching queued prompt (remaining: ${this.promptQueue.length})`);
      this.send({ type: "user_prompt", text: next });
      this.run(next).catch((err) => {
        console.error(`[hermes-session] queued run failed: ${err?.message || err}`);
      });
    } else {
      this.send({ type: "status", state: "idle", sessionId: this.sessionId });
    }
  }

  respondPermission(decision) {
    console.warn("[hermes-session] respondPermission called — not wired in v1");
  }

  respondQuestion(answer) {
    console.warn("[hermes-session] respondQuestion called — not wired in v1");
  }

  interrupt() {
    if (this.childProcess) {
      this.childProcess.kill("SIGTERM");
    }
    if (this.abortController) {
      try { this.abortController.abort(); } catch {}
    }
  }

  async close() {
    this.interrupt();
    this.promptQueue.length = 0;
    this._busy = false;
  }
}

// ── Provider ────────────────────────────────────────────────────────

function readHermesConfig() {
  try {
    return readFileSync(HERMES_CONFIG, "utf8");
  } catch {
    return null;
  }
}

export function createHermesProvider(emit) {
  let session = null;

  function ensureSession() {
    if (!session) session = new HermesSession(emit);
    return session;
  }

  async function prompt(_sessionId, text, _cwd) {
    const s = ensureSession();
    emit(HERMES_SYNTHETIC_SESSION_ID, { type: "user_prompt", text });
    if (s.busy) {
      s.enqueue(text);
    } else {
      s.run(text).catch((err) => {
        console.error(`[hermes-provider] run failed: ${err?.message || err}`);
      });
    }
    return { sessionId: HERMES_SYNTHETIC_SESSION_ID, provider: "hermes" };
  }

  function respondPermission(_sessionId, decision) {
    ensureSession().respondPermission(decision);
  }

  function respondQuestion(_sessionId, answer) {
    ensureSession().respondQuestion(answer);
  }

  function interrupt(_sessionId) {
    if (session) session.interrupt();
  }

  function getStatus(_sessionId) {
    if (!session) return null;
    return { state: session.status, provider: "hermes" };
  }

  async function getSessionStatus(_sessionId) {
    if (!session) return "idle";
    return session.status;
  }

  async function listSessions(_limit, _cwd) {
    // Report provider as "claude" — Even App filters sessions by
    // provider==="claude" client-side. Reporting "hermes" makes the
    // UI show "0 sessions".
    return [
      {
        id: HERMES_SYNTHETIC_SESSION_ID,
        title: "Alita (Hermes)",
        timestamp: new Date().toISOString(),
        cwd: HOME,
        provider: "claude",
        status: session ? session.status : "idle",
      },
    ];
  }

  async function getInfo() {
    return {
      account: { surface: "hermes-main", sessionKey: "default" },
      model: "mimo-v2.5",
      version: "1.0.0",
      provider: "hermes",
    };
  }

  async function getHistory(_sessionId, limit) {
    // Return memory as history for HUD display
    const mem = loadMemory();
    return mem.slice(-(typeof limit === "number" ? limit : 50)).flatMap((e) => [
      { role: "user", content: e.user, timestamp: new Date().toISOString() },
      { role: "assistant", content: e.assistant, timestamp: new Date().toISOString() },
    ]);
  }

  return {
    listSessions,
    getSessionStatus,
    getInfo,
    getHistory,
    prompt,
    respondPermission,
    respondQuestion,
    interrupt,
    getStatus,
  };
}
