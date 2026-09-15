#!/bin/sh
# X-MUX backend development start (auto-reload).
# Production: uvicorn app.main:app --host 0.0.0.0 --port "${XMUX_PORT:-8765}"
cd "$(dirname "$0")" || exit 1
exec /home/z/.venv/bin/python3 -m uvicorn app.main:app \
  --host 0.0.0.0 --port "${XMUX_PORT:-8765}" --reload \
  --reload-dir app --log-level info
