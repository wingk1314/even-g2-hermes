#!/usr/bin/env python3
"""
Even G2 AI Proxy — replaces Even's built-in LLM with Hermes.

Accepts OpenAI-compatible chat completions from the Even AI app,
routes through `hermes chat -q`, returns the response.

G2 protocol (reverse-engineered):
  POST / (root, not /v1/chat/completions)
  Authorization: Bearer <token>
  x-openclaw-agent-id: main
  Content-Type: application/json
  {"model": "openclaw", "messages": [{"role": "user", "content": "..."}]}

Usage:
  PROXY_SECRET=your_secret python3 proxy.py

Config via env vars:
  PROXY_SECRET       — shared secret for auth (required)
  HERMES_PROXY_PORT  — listen port (default: 18790)
  HERMES_CHAT_BIN    — path to hermes binary (default: hermes)
  HERMES_MAX_CHARS   — max response chars for HUD (default: 400)
  HERMES_TIMEOUT     — max seconds per query (default: 25)
"""

import http.server
import json
import os
import subprocess
import sys
import threading
import time
import logging
from typing import Any, Dict, List, Optional

# ── Config ──────────────────────────────────────────────────────────
PROXY_SECRET = os.environ.get("PROXY_SECRET", "")
if not PROXY_SECRET:
    secret_file = os.path.join(os.path.dirname(__file__), ".proxy_secret")
    if os.path.exists(secret_file):
        PROXY_SECRET = open(secret_file).read().strip()
LISTEN_PORT = int(os.environ.get("HERMES_PROXY_PORT", "18790"))
HERMES_BIN = os.environ.get("HERMES_CHAT_BIN", "hermes")
MAX_CHARS = int(os.environ.get("HERMES_MAX_CHARS", "400"))
TIMEOUT = int(os.environ.get("HERMES_TIMEOUT", "25"))
MEMORY_LIMIT = 5

# ── Logging ─────────────────────────────────────────────────────────
logging.basicConfig(
    level=logging.INFO,
    format="[hermes-proxy] %(asctime)s %(message)s",
    datefmt="%H:%M:%S",
)
log = logging.getLogger("hermes-proxy")

# ── Rolling memory ──────────────────────────────────────────────────
MEMORY_FILE = os.path.expanduser("~/.hermes/even-g2/proxy/memory.json")
_memory_lock = threading.Lock()


def load_memory() -> List[Dict[str, str]]:
    try:
        with open(MEMORY_FILE, "r") as f:
            return json.load(f)
    except (FileNotFoundError, json.JSONDecodeError):
        return []


def save_memory(exchanges: List[Dict[str, str]]) -> None:
    os.makedirs(os.path.dirname(MEMORY_FILE), exist_ok=True)
    with open(MEMORY_FILE, "w") as f:
        json.dump(exchanges[-MEMORY_LIMIT:], f, indent=2)


# ── System prompt ───────────────────────────────────────────────────
SYSTEM_PROMPT = (
    "You are Alita, Ricky's personal AI assistant running on a local Mac. "
    "Your responses appear on a HUD in the Even Realities G2 smart glasses — "
    "a 576×136px monochrome display. "
    "Given the tiny display, provide SHORT, DIRECT answers — 1-2 sentences max. "
    "Be practical and concise. Never leave a sentence unfinished. "
    "If the question needs a longer answer, give the key point and suggest "
    "checking Telegram for details."
)


def build_hermes_query(messages: List[Dict[str, str]]) -> str:
    """Build a single query string from OpenAI messages + memory."""
    # Inject system prompt if not present
    has_system = any(m.get("role") == "system" for m in messages)
    if not has_system:
        messages = [{"role": "system", "content": SYSTEM_PROMPT}] + messages

    # Build context from memory
    with _memory_lock:
        history = load_memory()

    parts = []
    for exchange in history:
        parts.append(f"User: {exchange['user']}")
        parts.append(f"Assistant: {exchange['assistant']}")

    # Add current messages
    for m in messages:
        role = m.get("role", "user")
        content = m.get("content", "")
        if role == "system":
            parts.append(f"System: {content}")
        elif role == "user":
            parts.append(f"User: {content}")
        elif role == "assistant":
            parts.append(f"Assistant: {content}")

    return "\n".join(parts)


def call_hermes(query: str) -> str:
    """Call hermes chat -q and return the response."""
    try:
        result = subprocess.run(
            [HERMES_BIN, "chat", "-q", query, "-Q"],
            capture_output=True,
            text=True,
            timeout=TIMEOUT,
            env={**os.environ, "TERM": "dumb"},
        )
        if result.returncode != 0:
            log.warning("hermes exited %d: %s", result.returncode, result.stderr[:200])
            return f"(Hermes error: exit {result.returncode})"

        response = result.stdout.strip()
        if not response:
            return "(empty response from Hermes)"

        # Truncate for HUD if needed
        if len(response) > MAX_CHARS:
            # Try to cut at sentence boundary
            truncated = response[:MAX_CHARS]
            last_period = max(truncated.rfind(". "), truncated.rfind("。"), truncated.rfind("! "), truncated.rfind("? "))
            if last_period > MAX_CHARS // 2:
                response = truncated[: last_period + 1]
            else:
                response = truncated + "…"

        return response

    except subprocess.TimeoutExpired:
        log.warning("hermes timed out after %ds", TIMEOUT)
        return "(thinking too hard — check Telegram for the full answer)"
    except FileNotFoundError:
        return "(hermes not found — check PATH)"
    except Exception as e:
        log.error("hermes call failed: %s", e)
        return f"(error: {e})"


# ── OpenAI format helpers ───────────────────────────────────────────

def format_openai_response(content: str, model: str = "openclaw") -> Dict[str, Any]:
    return {
        "id": "hermes-proxy-" + str(int(time.time())),
        "object": "chat.completion",
        "model": model,
        "choices": [
            {
                "index": 0,
                "message": {"role": "assistant", "content": content},
                "finish_reason": "stop",
            }
        ],
        "usage": {
            "prompt_tokens": 0,
            "completion_tokens": 0,
            "total_tokens": 0,
        },
    }


# ── HTTP Handler ────────────────────────────────────────────────────

class HermesProxyHandler(http.server.BaseHTTPRequestHandler):
    """Handles Even AI app requests, routes to Hermes."""

    def log_message(self, fmt: str, *args: Any) -> None:
        log.info("%s - %s", self.client_address[0], fmt % args)

    def _check_auth(self) -> bool:
        if not PROXY_SECRET:
            return True
        auth = self.headers.get("Authorization", "")
        if auth != f"Bearer {PROXY_SECRET}":
            self._send_json(401, {"error": "unauthorized"})
            return False
        return True

    def _send_json(self, code: int, data: Dict[str, Any]) -> None:
        body = json.dumps(data).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_POST(self) -> None:
        if not self._check_auth():
            return

        length = int(self.headers.get("Content-Length", 0))
        raw = self.rfile.read(length)

        try:
            data = json.loads(raw)
        except json.JSONDecodeError as e:
            log.warning("bad JSON: %s", e)
            self._send_json(400, {"error": "invalid JSON"})
            return

        messages = data.get("messages", [])
        original_model = data.get("model", "openclaw")
        log.info("request model=%s messages=%d", original_model, len(messages))

        # Build query and call Hermes
        query = build_hermes_query(messages)
        response_text = call_hermes(query)

        # Extract the user's last message for memory
        user_msg = ""
        for m in reversed(messages):
            if m.get("role") == "user":
                user_msg = m.get("content", "")
                break

        # Save to rolling memory
        if user_msg and response_text and not response_text.startswith("("):
            with _memory_lock:
                history = load_memory()
                history.append({"user": user_msg, "assistant": response_text})
                save_memory(history)

        # Return OpenAI format
        self._send_json(200, format_openai_response(response_text, original_model))

    def do_GET(self) -> None:
        """Models endpoint — required by Even AI app for discovery."""
        if not self._check_auth():
            return
        self._send_json(200, {"data": [{"id": "openclaw"}]})

    def do_OPTIONS(self) -> None:
        """CORS preflight."""
        self.send_response(204)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "POST, GET, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Authorization, Content-Type")
        self.end_headers()


# ── Main ────────────────────────────────────────────────────────────

def main() -> None:
    if not PROXY_SECRET:
        log.warning("PROXY_SECRET not set — auth disabled (anyone can query)")

    server = http.server.HTTPServer(("0.0.0.0", LISTEN_PORT), HermesProxyHandler)
    log.info("listening on :%d → hermes chat -q (timeout=%ds, max=%d chars)",
             LISTEN_PORT, TIMEOUT, MAX_CHARS)

    try:
        server.serve_forever()
    except KeyboardInterrupt:
        log.info("shutting down")
        server.shutdown()


if __name__ == "__main__":
    main()
