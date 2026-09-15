# X-MUX Deployment Guide

X-MUX deploys as **two independent units**:

1. the **frontend** (Next.js) on Vercel — no Python, no torch, no SQLite;
2. the **backend** (FastAPI + Socket.IO + ML models) on a separate,
   long-running host with ffmpeg and a persistent volume.

Vercel never runs Python, never loads AASIST, never trains anything.

> X-MUX provides voice-integrity evidence to support security decisions. It
> does not replace human verification or guarantee detection.

---

## 1. Frontend deployment (Vercel)

| Setting | Value |
|---|---|
| Framework preset | Next.js |
| Root directory | Repository root |
| Build command | `next build` (default) |
| Output | Next.js default |
| Node/bun deps | `bun install` / lockfile as committed |

No Python dependency, no AASIST checkpoint and no SQLite file is required at
build time — the Vercel build only compiles the Next.js app.

### Environment variables (Vercel → Settings → Environment Variables)

| Variable | Environments | Value |
|---|---|---|
| `XMUX_BACKEND_URL` | Production, Preview | `https://YOUR-BACKEND-HOST.example.com` |
| `NEXT_PUBLIC_XMUX_LIVE_URL` | Production, Preview | `https://YOUR-BACKEND-HOST.example.com` |

- `XMUX_BACKEND_URL` is the **server-side** proxy target used by
  `src/app/api/xmux/[...path]/route.ts` (REST: health, analyze, reports,
  profiles, settings). It is not a secret and is never exposed to the browser.
- `NEXT_PUBLIC_XMUX_LIVE_URL` is the **browser-side** Socket.IO target used
  by `src/lib/xmux/socket.ts` (Live Monitor). It is client-visible by design
  — the backend's own CORS/origin policy is the enforcement point.
- Without `NEXT_PUBLIC_XMUX_LIVE_URL` set, the frontend falls back to the
  sandbox development pattern (`/?XTransformPort=8765` through a local
  gateway). **Production deployments must set it.**

### Sandbox vs production connection behavior

The frontend auto-detects its environment:

- **Development sandbox**: browser Socket.IO connects to a relative URL with
  a gateway query — `io('/?XTransformPort=8765')` — which the local Caddy
  gateway forwards to `localhost:8765`. An optional
  `NEXT_PUBLIC_XMUX_BACKEND_PORT` variable can override the `8765` default in
  this mode only.
- **Production**: with `NEXT_PUBLIC_XMUX_LIVE_URL` set, the browser connects
  directly to the deployed backend root with the same engine.io path `/`, so
  the Live Monitor contract is identical in both environments. No
  `XTransformPort` routing is used or required.

---

## 2. Backend deployment (separate host)

### Requirements

- Python **3.11+**
- `ffmpeg` on `PATH` (used to decode untrusted uploads)
- TCP ingress for `XMUX_PORT` (default 8765) with **real WebSocket support**
  (Socket.IO runs at path `/`; polling fallback exists but WebSocket is
  expected in production)
- A persistent volume for the database and model caches

### Install

```bash
cd backend
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt

# CPU-only host:
pip install torch torchaudio --index-url https://download.pytorch.org/whl/cpu
# GPU host: install torch per your CUDA environment instead.

pip install speechbrain silero-vad
```

### Run

```bash
uvicorn app.main:app --host 0.0.0.0 --port ${XMUX_PORT:-8765}
```

(From the repository root, use `uvicorn backend.app... ` is **not** valid —
run from inside `backend/`, or set the module path accordingly. The committed
`backend/run_dev.sh` is a development helper with auto-reload and a
sandbox-specific interpreter path; do not use it in production.)

### Model setup

- **AASIST-L**: `backend/models/AASIST-L.pth` ships in the repository
  (426,428 bytes, sha256
  `814331d088032bb4c3fa61cc014789eadeed464209dd094ab3a2dd6ffbdce27a`).
  Point `XMUX_AASIST_MODEL_PATH` at it (or at a future fine-tuned artifact).
- **ECAPA-TDNN** (`speechbrain/spkrec-ecapa-voxceleb`) and **Silero VAD**
  (`silero-vad` PyPI) download automatically on first start into
  `XMUX_MODELS_DIR` (default `backend/models/`). Both are public; no token is
  needed. Make sure `XMUX_MODELS_DIR` is on the persistent volume so the
  download survives restarts.

### Persistent volume

Mount a volume and point configuration at it, e.g.:

```
XMUX_DB=/mnt/xmux-data/xmux.db
XMUX_MODELS_DIR=/mnt/xmux-data/models
```

SQLite must live on the backend host's persistent disk — it is never used as
Vercel storage.

### CORS / allowed origins

Set the backend's allowed origins to your Vercel origin:

```
XMUX_ALLOWED_ORIGINS=https://your-app.vercel.app
XMUX_ENV=production
```

- `XMUX_ALLOWED_ORIGINS` is a comma-separated list applied to both the FastAPI
  CORS middleware and Socket.IO.
- In `XMUX_ENV=production` with no origins configured, the backend fails
  closed (no cross-origin access) — always set the list in production.
- In development (default `XMUX_ENV=development`, empty list) any origin is
  allowed for local convenience only.

### Health check

```
GET https://YOUR-BACKEND-HOST.example.com/api/health
```

Returns overall `READY`/`DEGRADED` plus per-component states (api,
audio_decoder, dsp_engine, database, streaming, the three ML components) and
the truthful `compute` block. Use this endpoint for load-balancer probes and
post-deploy validation. `GET /` returns basic service info.

---

## 3. Full environment variable table

| Variable | Location | Required | Example | Purpose | Secret? |
|---|---|---|---|---|---|
| `XMUX_BACKEND_URL` | Vercel (frontend) | Production: yes | `https://xmux-backend.example.com` | Server-side proxy target for `/api/xmux/*` REST calls | No |
| `NEXT_PUBLIC_XMUX_LIVE_URL` | Vercel (frontend) | Production: yes | `https://xmux-backend.example.com` | Browser Socket.IO target for Live Monitor (client-visible by design) | No |
| `XMUX_PORT` | Backend | No | `8765` | Backend listening port | No |
| `XMUX_DB` | Backend | No | `backend/data/xmux.db` (default) or a persistent-volume path | SQLite database path | No |
| `XMUX_AASIST_MODEL_PATH` | Backend | No | `backend/models/AASIST-L.pth` (default) | Active AASIST-L checkpoint | No |
| `XMUX_MODELS_DIR` | Backend | No | `backend/models` (default) | Cache directory for speechbrain / silero artifacts | No |
| `XMUX_TMP` | Backend | No | `/tmp/xmux` (default) | Transient upload/decode directory | No |
| `XMUX_ALLOWED_ORIGINS` | Backend | Production: yes | `https://your-app.vercel.app` | Comma-separated allowed frontend origins (CORS) | No |
| `XMUX_ENV` | Backend | No | `production` | Environment marker; `development` relaxes CORS to any origin | No |
| `XMUX_MAX_UPLOAD_MB` | Backend | No | `25` (default) | Maximum upload size in MB | No |
| `XMUX_MIN_DURATION_SEC` | Backend | No | `0.5` (default) | Minimum accepted audio duration (seconds) | No |
| `XMUX_MAX_DURATION_SEC` | Backend | No | `120` (default) | Maximum accepted audio duration (seconds) | No |
| `XMUX_DEMO_SAMPLE` | Backend | Optional | — | Reserved optional demo-sample path; not required by the current implementation | No |
| `HF_TOKEN` | Backend / training host | Optional | — | HuggingFace token — set privately **only if actually needed** (the active models are public and download without a token) | **Yes** |
| `NVIDIA_API_KEY` | Optional (external service) | Optional | — | Only if an external NVIDIA API service is actually used; the current implementation does not call one | **Yes** |

Notes:

- Secrets belong only in the platform's private environment-variable store —
  never in the repository, never in `NEXT_PUBLIC_*` (those are embedded in
  the client bundle), and never displayed in the UI.
- `NEXT_PUBLIC_XMUX_BACKEND_PORT` additionally exists as a development-only
  override for the sandbox gateway port (default `8765`); it is not used when
  `NEXT_PUBLIC_XMUX_LIVE_URL` is set.
- Policy thresholds (`risk_warn`, `risk_high`, `speaker_threshold`) are
  runtime application settings stored in the backend database and edited via
  `PUT /api/settings` — they are not environment variables.

---

## 4. Deployment validation checklist

Run before declaring a deployment ready:

**Build & repo**

- [ ] Next.js production build passes (`bun run build`).
- [ ] No Python dependency is required by the Vercel build.
- [ ] No AASIST loading is required by the Vercel build.
- [ ] No SQLite persistence is required by the Vercel build.
- [ ] No localhost production URL remains in deployed configuration.
- [ ] No sandbox-specific `XTransformPort` routing is required (only the
      `NEXT_PUBLIC_XMUX_LIVE_URL` direct connection is used).

**Backend**

- [ ] Backend starts independently on the host.
- [ ] `GET /api/health` responds and reports component states.
- [ ] AASIST-L loads (state `READY`, sha256 reported).
- [ ] ECAPA-TDNN loads (state `READY`).
- [ ] Silero VAD loads (state `READY`).
- [ ] Real inference verified (e.g. `python backend/verify_models.py`).
- [ ] Persistent volume mounted for `XMUX_DB` and `XMUX_MODELS_DIR`.

**Frontend ↔ backend**

- [ ] Frontend API proxy works with `XMUX_BACKEND_URL`.
- [ ] Live Socket.IO works with `NEXT_PUBLIC_XMUX_LIVE_URL`.
- [ ] CORS works from the Vercel origin (`XMUX_ALLOWED_ORIGINS` set).
- [ ] Upload works (valid file accepted, invalid file rejected with 400).
- [ ] Analyze Voice works end-to-end.
- [ ] Live Monitor works (session, per-second analysis, alerts on
      transitions only).
- [ ] Reports work (list, detail, delete).
- [ ] Settings work (policy read/update).
- [ ] System Health works (shows truthful compute: CPU or GPU).

**Safety**

- [ ] No secrets committed to the repository.
- [ ] Failure safety: with a model removed/unloaded, analyses return
      `MODEL_UNAVAILABLE` with no fabricated scores.

---

## 5. Operational notes

- **Scaling**: the backend holds live-session state in memory (one session
  per socket). For multi-instance deployments, use sticky sessions at the
  load balancer for Socket.IO, or run a single live-analysis instance.
- **TLS**: terminate HTTPS/WSS at the reverse proxy in front of uvicorn;
  `XMUX_ALLOWED_ORIGINS` must list the browser-facing origin.
- **Database backups**: back up the SQLite file (and WAL) on whatever
  schedule your incident-response policy requires.
- **Model updates**: see [MODEL_CARD.md](MODEL_CARD.md) §"Future fine-tuned
  X-MUX AASIST-L" — replace the artifact, restart, verify health. Rollback is
  pointing `XMUX_AASIST_MODEL_PATH` back to the previous checkpoint.
