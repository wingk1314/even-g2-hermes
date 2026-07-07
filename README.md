# Even Realities G2 → Hermes Bridge

Two integration modes for connecting Even Realities G2 smart glasses to Hermes Agent.

## Mode 1: AI Proxy (replaces Even's built-in LLM)

Routes the Even AI app's voice queries through Hermes instead of Even's cloud.

```
G2 glasses → Even Hub app (iPhone) → WiFi/Tailscale → Mac :18790 → hermes chat -q → response → HUD
```

### Setup

The proxy starts automatically on boot via launchd. No manual steps needed.

**Manual start:**
```bash
cd ~/.hermes/even-g2/proxy
python3 proxy.py
```

**Configure Even Hub app:**
1. Open Even Hub → Add Agent
2. Name: `Alita` (or whatever)
3. URL: `http://<YOUR_MAC_IP>:18790/` (or Tailscale IP for remote)
4. Token: the secret from `~/.hermes/even-g2/proxy/.proxy_secret`
5. Save and select the agent

**How it works:**
- Accepts OpenAI-format POST at `/` (what the G2 app sends)
- Validates Bearer token
- Calls `hermes chat -q` with the query + 5-exchange rolling memory
- Returns response in OpenAI format, truncated to 400 chars for HUD
- 25-second timeout (G2 gives up after ~30s)

**Files:**
```
~/.hermes/even-g2/proxy/
├── proxy.py              # The proxy server
├── .proxy_secret         # Auth token (chmod 600)
├── memory.json           # Rolling 5-exchange memory
├── test_proxy.py         # Test script
└── proxy.log             # Logs (when run via launchd)
```

---

## Mode 2: Terminal Mode (full Hermes access)

Gives the glasses full terminal-level access to Hermes — tools, memory, skills, everything.

```
G2 glasses → Even Hub Terminal Mode → WiFi/Tailscale → Mac :3457 → even-terminal → hermes chat -q → response → HUD
```

### Setup

```bash
# Start terminal mode (run manually — needs pairing)
~/.hermes/even-g2/terminal/start-terminal.sh --tailscale
```

**Pair from Even Hub:**
1. Open Even Hub → Terminal Mode
2. Scan for hosts — you should see the bridge
3. Tap to pair, paste the token from `~/.hermes/even-g2/proxy/.proxy_secret`
4. Send a voice command from the glasses

**How it works:**
- even-terminal runs on port 3457 with the Hermes provider
- Hermes provider spawns `hermes chat -q` per query
- Full tool access (terminal, file, web, memory, skills)
- Responses truncated to 400 chars for HUD display
- Rolling 5-exchange memory for context

**Files:**
```
~/.hermes/even-g2/terminal/
├── provider.js           # Hermes provider (installed into even-terminal)
├── start-terminal.sh     # Startup script
├── memory.json           # Rolling memory
└── terminal.log          # Logs
```

---

## Shared Secret

Both modes use the same auth token:
```bash
cat ~/.hermes/even-g2/proxy/.proxy_secret
```

This is the token you enter in the Even Hub app when pairing.

## Network Access

**Same WiFi:** Use your Mac's local IP (e.g. `192.168.x.x`)
**Remote (Tailscale):** Use your Mac's Tailscale IP (e.g. `100.x.x.x`)

## Which Mode to Use?

| Feature | AI Proxy | Terminal Mode |
|---------|----------|---------------|
| Replaces Even's built-in AI | ✅ | ❌ |
| Full Hermes tools | ❌ | ✅ |
| Memory/skills access | Rolling 5-exchange only | Full MemOS |
| Setup difficulty | Auto (launchd) | Manual pairing |
| Use case | Quick questions on the go | Deep work, coding, research |
| Response time | ~3-5s | ~5-15s |

**Recommendation:** Use AI Proxy for daily quick questions (weather, reminders, quick facts). Switch to Terminal Mode when you need Hermes to do actual work (file edits, web research, running commands).

## Troubleshooting

| Issue | Fix |
|-------|-----|
| Proxy returns 401 | Check token in `.proxy_secret` matches what you entered in Even Hub |
| No response on HUD | Check Mac IP is reachable from iPhone (ping it) |
| "thinking" spinner never resolves | Hermes might be slow — check `hermes status` |
| Terminal mode shows "0 sessions" | This is cosmetic — the session is there, Even App just filters by provider name |
| Timeout on complex queries | Proxy has 25s limit — for long tasks, use Terminal Mode instead |
