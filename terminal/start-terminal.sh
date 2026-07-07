#!/bin/bash
# Even G2 Terminal Mode — starts even-terminal with Hermes provider
#
# Usage:
#   ./start-terminal.sh              # LAN mode (default)
#   ./start-terminal.sh --tailscale  # Tailscale mode (remote access)
#   ./start-terminal.sh --port 3457  # Custom port

set -euo pipefail

PROXY_SECRET=*** ~/.hermes/even-g2/.proxy_secret)
UPSTREAM="/Users/lwk/.hermes/node/lib/node_modules/@evenrealities/even-terminal"
EVEN_TERMINAL="$UPSTREAM/dist/index.js"
PORT="${HERMES_TERMINAL_PORT:-3457}"

# Add node to PATH
export PATH="/Users/lwk/.hermes/node/bin:$PATH"

echo "=== Even G2 Terminal Mode (Hermes) ==="
echo "Port: $PORT"
echo "Provider: hermes (via hermes chat -q)"
echo ""

# Start even-terminal with hermes provider
exec node "$EVEN_TERMINAL" \
    --port "$PORT" \
    --token "$PROXY_SECRET" \
    "$@" \
    2>&1 | tee ~/.hermes/even-g2/terminal/terminal.log
