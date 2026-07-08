# Even Realities G2 → Hermes Agent Integration

Connect your **Even Realities G2** smart glasses to **Hermes Agent** — a full AI assistant with tools, memory, and skills.

Three integration modes, from simple voice queries to a native glasses app.

## Quick Comparison

| Feature | AI Proxy | Terminal Mode | **Even Hub Plugin (Alita)** |
|---------|----------|---------------|----------------------------|
| Replaces Even's built-in AI | ✅ | ❌ | ✅ |
| Full Hermes tools | ❌ | ✅ | ✅ (via API) |
| Voice input | ❌ | ❌ | ✅ (glasses MIC) |
| Response delay | ~3-5s | ~60s | Real-time |
| Rich UI (lists, context) | ❌ | ❌ | ✅ |
| Smart replies | ❌ | ❌ | ✅ |
| Session continuity | ❌ | ❌ | ✅ |
| Setup | Auto (launchd) | Manual pairing | Web app hosting |
| Use case | Quick questions | Deep work (typing) | **Daily driver** |

**Recommendation:** The Even Hub Plugin (Alita) is the goal. Use AI Proxy as a fallback. Terminal Mode is deprecated.

---

## Mode 3: Even Hub Plugin — Alita (Recommended)

A native glasses app built with the Even Hub SDK. Runs in the Even App WebView, connects to Hermes over LAN.

### Architecture

```
┌─────────────────────────┐
│   Even App (iPhone)     │
│   ┌───────────────────┐ │
│   │  Alita Plugin      │ │◄── WebView (HTML/JS)
│   │  (index.html)      │ │    Uses even_hub_sdk
│   └───────┬───────────┘ │
│     BLE   │   BLE       │
│    ┌──────┴──┐ ┌────────┴──┐
│    │   G2    │ │    R1     │
│    │ 576×288 │ │   ring    │
│    └─────────┘ └───────────┘
└─────────────────────────┘
            │
            │ HTTP (LAN)
            ▼
    Mac:9191 (server.mjs)
            │
            ▼
    hermes chat -q -Q -t hermes-cli
```

### Features

- **Start screen** — Continue (resume last session) or New conversation
- **Smart replies** — 5 context-aware quick replies after each response
- **Voice input** — Glasses MIC capture (STT pipeline pending)
- **Session history** — Reads from Hermes SQLite database
- **Real-time responses** — No 60s polling delay

### Requirements

- **Node.js** ≥ 20.0.0
- **Hermes Agent** installed and configured (`hermes` CLI available)
- **Even Realities App** v2.0.0+ on iPhone
- **Even Hub CLI** — `npm i -g @evenrealities/evenhub-cli`
- **LAN access** — Mac and iPhone on same network (or Tailscale)

### Setup

```bash
# 1. Clone this repo
git clone https://github.com/wingk1314/even-g2-hermes.git
cd even-g2-hermes/plugin

# 2. Install dependencies
npm install

# 3. Update the API URL in index.html
#    Change `http://192.168.0.203:9191` to your Mac's IP
#    (Find it with: ipconfig getifaddr en0)

# 4. Update the whitelist in app.json
#    Replace `http://192.168.0.203:9191` with your Mac's IP

# 5. Start the API server
node server.mjs

# 6. Package the plugin
evenhub pack app.json . -o alita.ehpk

# 7. Upload to Even Hub
#    Go to hub.evenrealities.com → your project → Upload build
#    Select alita.ehpk
```

### Files

```
plugin/
├── app.json          # Plugin manifest (package_id, permissions, etc.)
├── index.html        # Glasses UI — start screen, chat, smart replies
├── server.mjs        # API proxy — wraps hermes CLI, serves icon
├── icon.png          # 24×24 monochrome app icon
├── package.json      # Node.js dependencies
└── README.md         # This file
```

### API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/health` | GET | Health check |
| `/icon.png` | GET | App icon (24×24 monochrome) |
| `/session-info` | GET | Last session topic (for start screen) |
| `/continue` | GET | Load previous session context + summary |
| `/chat` | POST | Send message, get response + smart replies |
| `/transcribe` | POST | Audio → text (STT, pending Whisper) |

### Icon Requirements

Per Even Hub design guidelines:

| Spec | Value |
|------|-------|
| Size | 24×24 px |
| Format | Monochrome/greyscale PNG |
| Store listing | Foreground + background layers required |
| Rules | No color, no noisy patterns, recognizable at a glance |

---

## Mode 1: AI Proxy (Fallback)

Routes the Even AI app's voice queries through Hermes instead of Even's cloud.

```
G2 glasses → Even Hub app → WiFi → Mac:18790 → hermes chat -q → HUD
```

### Setup

```bash
# The proxy starts automatically on boot via launchd.
# Manual start:
cd proxy
python3 proxy.py
```

**Configure Even Hub app:**
1. Open Even Hub → Add Agent
2. URL: `http://<YOUR_MAC_IP>:18790/`
3. Token: from `proxy/.proxy_secret`

### Files

```
proxy/
├── proxy.py          # OpenAI-format proxy server
├── .proxy_secret     # Auth token (chmod 600)
├── test_proxy.py     # Test script
└── proxy.log         # Logs (launchd)
```

---

## Mode 2: Terminal Mode (Deprecated)

Full Hermes access via even-terminal. Slow (60s polling), requires typing on phone.

```bash
# Start
terminal/start-terminal.sh --tailscale

# Pair from Even Hub → Terminal Mode → paste token
```

### Files

```
terminal/
├── provider.js           # Hermes provider for even-terminal
├── start-terminal.sh     # Startup script
└── patches/              # even-terminal patches
```

---

## Shared Config

| Item | Location |
|------|----------|
| Auth token | `proxy/.proxy_secret` |
| Hermes CLI | Must be in `$PATH` |
| SSL cert | `/private/etc/ssl/cert.pem` (macOS) |

## Network

| Scenario | Address |
|----------|---------|
| Same WiFi | `http://192.168.x.x:9191` |
| Tailscale | `http://100.x.x.x:9191` |

## Troubleshooting

| Issue | Fix |
|-------|-----|
| 401 errors | Check token matches `.proxy_secret` |
| No response on glasses | Verify Mac IP reachable from iPhone |
| Timeout | Increase timeout in `server.mjs` (default 30s) |
| `hermes` not found | Ensure Hermes CLI is in `$PATH` |
| SSL errors | `export SSL_CERT_FILE="/private/etc/ssl/cert.pem"` |
| Port conflict | `lsof -ti:9191 \| xargs kill -9` |

## License

MIT
