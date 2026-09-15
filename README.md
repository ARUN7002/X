# X-MUX — Voice-Integrity Analysis Platform

X-MUX is a voice-integrity and impersonation-risk analysis platform that
combines multiple evidence sources — synthetic-speech detection, speaker
verification, speech activity, signal analysis and audio-quality measurement —
to produce risk evidence and recommended actions for security operators.

X-MUX runs **real inference only**: every score shown in the UI originates
from an actual model or measurement. When a model cannot run, X-MUX reports
`MODEL_UNAVAILABLE` / `INCONCLUSIVE` instead of inventing a score.

> **Disclaimer**
>
> X-MUX provides voice-integrity evidence to support security decisions. It
> does not replace human verification or guarantee detection.

---

## What X-MUX does

- **Analyze Voice** — upload or record a short clip (0.5–120 s) and receive a
  structured evidence report: synthetic-speech evidence (AASIST-L), speaker
  similarity against an enrolled profile (ECAPA-TDNN), speech activity
  (Silero VAD), DSP features, audio quality, fused risk score, confidence and
  a recommended policy action (`ALLOW` / `WARN` / `VERIFY` / `BLOCK`).
- **Live Monitor** — near-real-time chunk analysis of a live audio source over
  Socket.IO: a 12-second rolling buffer is analyzed once per second, with
  temporal smoothing (EWMA) and a hysteresis state machine
  (`MONITORING → SUSPICIOUS → HIGH_RISK → INTERVENTION`) that alerts only on
  meaningful state transitions.
- **Voice Profiles** — enroll a reference speaker (3–60 s) and compare later
  audio against the stored embedding. Embeddings are stored, raw audio is not.
- **Reports** — every analysis is persisted in backend-side SQLite and can be
  reviewed or deleted.
- **Settings & System Health** — policy thresholds, application permissions,
  model metadata (with checkpoint sha256) and truthful component/compute
  health.

## What X-MUX does not do

- It does **not** claim to detect every AI voice, and it does not claim any
  accuracy percentage of its own. No X-MUX benchmark has been run.
- It is **not** a telecommunications interception tool. Live analysis
  processes audio that the operator is already authorized to capture (e.g. a
  browser microphone or an authorized media-infrastructure feed).
- It does **not** train models. Training happens offline in a separate GPU
  workspace ([training/](training/README.md)); the serving backend only loads
  a selected, verified checkpoint artifact.

---

## Architecture

```
                ┌──────────────────────────────┐
                │        FRONTEND (Vercel)     │
                │  Next.js single-page app     │
                │  Analyze · Live · Profiles · │
                │  Reports · Settings · Health │
                └──────┬───────────────┬───────┘
          REST /api/xmux/*       Socket.IO (path "/")
          (server-side proxy,    (browser → backend,
           via XMUX_BACKEND_URL)  NEXT_PUBLIC_XMUX_LIVE_URL)
                 HTTPS                      WSS
                     │                        │
                 ┌───▼────────────────────────▼───┐
                 │     BACKEND (separate host)    │
                 │  Python FastAPI + Socket.IO    │
                 │  ┌──────────────────────────┐  │
                 │  │ Evidence pipeline:       │  │
                 │  │ validation → decode →    │  │
                 │  │ VAD → DSP → quality →    │  │
                 │  │ AASIST-L → ECAPA-TDNN →  │  │
                 │  │ fusion → risk → policy   │  │
                 │  └──────────────────────────┘  │
                 │  SQLite (analyses, profiles,  │
                 │  events, settings)            │
                 └───────────────┬────────────────┘
                                 │ loads model artifacts
                 ┌───────────────▼────────────────┐
                 │  MODEL ARTIFACTS (on backend)  │
                 │  AASIST-L.pth  ECAPA cache     │
                 │  Silero VAD                    │
                 └───────────────▲────────────────┘
                                 │ produced by
                 ┌───────────────┴────────────────┐
                 │  TRAINING WORKSPACE (offline)  │
                 │  GPU host · datasets ·         │
                 │  augmentation · evaluation ·   │
                 │  calibration · export          │
                 │  (never runs on Vercel)        │
                 └────────────────────────────────┘
```

## Deployment model

| Layer | Technology | Where it runs | Notes |
|---|---|---|---|
| **Frontend** | Next.js (App Router, TypeScript, Tailwind, shadcn/ui) | Vercel | Static/SSR only. No Python, no torch, no SQLite at build time. REST calls go through a server-side proxy route. |
| **Backend** | Python FastAPI + python-socketio | Separate long-running host | Serves REST at `/api/*` and Socket.IO at path `/`. Requires ffmpeg. |
| **ML models** | AASIST-L, ECAPA-TDNN (speechbrain), Silero VAD | Backend host | Loaded at startup with real self-tests; truthful READY/UNAVAILABLE/ERROR states. |
| **Database** | SQLite | Backend host (`backend/data/xmux.db` by default) | Use a persistent volume in production. Never used as Vercel storage. |
| **Streaming** | Socket.IO (WebSocket) | Browser → backend | Path `/`; alerts fire only on state transitions with an 8 s cooldown. |
| **Training** | Offline workspace | GPU host | See [training/README.md](training/README.md). No training UI exists in the frontend. |

See [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) for full deployment instructions
and the complete environment-variable table.

---

## Quickstart

### Frontend

```bash
bun install
bun run dev          # http://localhost:3000
```

The frontend expects the backend to be reachable. In local development the
server-side proxy defaults to `http://127.0.0.1:8765`; set `XMUX_BACKEND_URL`
to override.

### Backend

Requirements: Python 3.11+, ffmpeg on `PATH`.

```bash
# 1) core dependencies
pip install -r backend/requirements.txt

# 2) PyTorch — CPU-only host (development):
pip install torch torchaudio --index-url https://download.pytorch.org/whl/cpu
#    On a GPU host, install torch per your CUDA environment instead.

# 3) ML extras used by the backend
pip install speechbrain silero-vad

# development (auto-reload):
./backend/run_dev.sh

# production:
cd backend
uvicorn app.main:app --host 0.0.0.0 --port ${XMUX_PORT:-8765}
```

On first start the backend downloads the ECAPA-TDNN and Silero VAD artifacts
into `backend/models/` (public HuggingFace / PyPI sources; no token needed).
`backend/models/AASIST-L.pth` ships with the repository.

Verify the install:

```bash
curl http://127.0.0.1:8765/api/health     # truthful component health
python backend/verify_models.py           # real inference self-checks
```

### Environment variables

| Variable | Location | Required | Example | Purpose | Secret? |
|---|---|---|---|---|---|
| `XMUX_BACKEND_URL` | Vercel (frontend) | Production | `https://xmux-backend.example.com` | Server-side proxy target for REST calls | No |
| `NEXT_PUBLIC_XMUX_LIVE_URL` | Vercel (frontend) | Production | `https://xmux-backend.example.com` | Browser Socket.IO target for Live Monitor (client-visible by design) | No |
| `XMUX_PORT` | Backend | No | `8765` | Backend listening port | No |
| `XMUX_DB` | Backend | No | `backend/data/xmux.db` | SQLite database path (use a persistent volume in production) | No |
| `XMUX_AASIST_MODEL_PATH` | Backend | No | `backend/models/AASIST-L.pth` | Active AASIST-L checkpoint | No |
| `XMUX_MODELS_DIR` | Backend | No | `backend/models` | Cache dir for speechbrain/silero artifacts | No |
| `XMUX_TMP` | Backend | No | `/tmp/xmux` | Transient upload/decode directory | No |
| `XMUX_ALLOWED_ORIGINS` | Backend | Production | `https://your-app.vercel.app` | Comma-separated CORS allow-list | No |
| `XMUX_ENV` | Backend | No | `production` | Environment marker; `development` relaxes CORS | No |
| `XMUX_MAX_UPLOAD_MB` | Backend | No | `25` | Upload size limit | No |
| `XMUX_MIN_DURATION_SEC` | Backend | No | `0.5` | Minimum accepted audio duration | No |
| `XMUX_MAX_DURATION_SEC` | Backend | No | `120` | Maximum accepted audio duration | No |
| `XMUX_DEMO_SAMPLE` | Backend | Optional | — | Reserved optional demo-sample path; not required by the current implementation | No |
| `HF_TOKEN` | Backend / training host | Optional | — | HuggingFace token — set privately **only if actually needed** (the active models are public and download without a token) | **Yes** |
| `NVIDIA_API_KEY` | Optional | Optional | — | Only if an external NVIDIA API service is actually used; the current implementation does not call one | **Yes** |

No secrets are required to run X-MUX. Policy thresholds
(`risk_warn`, `risk_high`, `speaker_threshold`) are runtime application
settings stored in the backend database, editable via `/api/settings`.

---

## Verified model facts (AASIST-L)

The following contract was verified against the vendored architecture and the
official `clovaai/aasist` checkpoint — not guessed:

- **Input**: raw float32 waveform, mono, 16 kHz, fixed **64,600 samples**
  (~4.03 s). Short inputs are tile-repeated (official eval padding); longer
  inputs are analyzed as up to 5 evenly spaced windows (uploads) or the
  latest full window (live).
- **Output**: `(B, 2)` logits. Training labels map `bonafide = 1`, `spoof = 0`:
  - official protocol score = `logits[:, 1]` (bonafide logit);
  - X-MUX **synthetic evidence** = `softmax(logits)[:, 0]` (spoof column),
    an **uncalibrated** model score surfaced as evidence, never as a
    validated probability.
- **Checkpoint**: `backend/models/AASIST-L.pth` (426,428 bytes),
  sha256 `814331d088032bb4c3fa61cc014789eadeed464209dd094ab3a2dd6ffbdce27a`.
- **License**: MIT, Copyright (c) 2021-present NAVER Corp. — see
  [backend/AASIST_LICENSE](backend/AASIST_LICENSE).
- **Authors' published baseline** (their number, *not* an X-MUX measurement):
  EER 0.99 %, min t-DCF 0.0309 on the ASVspoof 2019 LA eval set.

### Development observations (informal, single samples — NOT benchmarks)

Observed once on the development machine (CPU-only sandbox), kept honest and
unverified:

| Sample | Synthetic evidence | Outcome |
|---|---|---|
| Clean studio human speech | 0.162 | Low risk |
| flite TTS output | 1.000 | High risk |
| Band-limited 1963 broadcast recording (genuine) | 0.995 | **False positive** — band-limited audio now raises a `BAND_LIMITED` flag with a confidence penalty and caution note |

Typical per-window inference latency in the CPU-only dev sandbox is
**~1.0–1.5 s**. GPU hosts are expected to be faster, but no GPU latency is
claimed.

Full model documentation: [docs/MODEL_CARD.md](docs/MODEL_CARD.md).

---

## Repository layout

```
├── backend/                  # Python FastAPI + Socket.IO backend
│   ├── app/
│   │   ├── main.py           # combined ASGI app (FastAPI + Socket.IO at "/")
│   │   ├── config.py         # env-driven settings
│   │   ├── analysis.py       # evidence pipeline orchestrator
│   │   ├── fusion.py         # evidence fusion → risk/confidence/action
│   │   ├── temporal.py       # EWMA + hysteresis state machine
│   │   ├── live.py           # Socket.IO live sessions
│   │   ├── audio.py          # upload validation + ffmpeg decode
│   │   ├── dsp.py            # real DSP features (librosa/numpy/scipy)
│   │   ├── quality.py        # audio-quality engine
│   │   ├── db.py             # SQLite persistence
│   │   ├── models/           # AASIST-L, ECAPA, Silero VAD + abstraction
│   │   └── routes/           # health, analyze, reports, profiles, settings
│   ├── models/AASIST-L.pth   # tracked checkpoint (426 KB, MIT)
│   ├── verify_models.py      # real-inference verification script
│   ├── run_dev.sh            # development start (reload)
│   ├── requirements.txt
│   └── AASIST_LICENSE        # MIT license (NAVER Corp.)
├── docs/                     # this documentation set
├── training/                 # OFFLINE training workspace (GPU host)
│   ├── README.md             # 15-section workflow guide
│   ├── configs/              # fine-tuning config examples
│   ├── scripts/              # planned scripts (documented, not yet implemented)
│   ├── protocols/            # evaluation protocol definitions (planned)
│   ├── evaluation/           # metric implementations (planned)
│   ├── experiments/          # experiment outputs (gitignored)
│   └── export/               # exported artifacts (gitignored)
├── src/                      # Next.js frontend
│   ├── app/                  # single route + /api/xmux/[...path] proxy
│   ├── components/xmux/      # views: analyze, live, profiles, reports, …
│   └── lib/xmux/             # API client, socket client, types, store
└── public/pcm-worklet.js     # AudioWorklet PCM capture processor
```

Scaffold leftovers from the original Next.js template (`prisma/`, `db/`,
`examples/`, `download/`) are unused by X-MUX — the application database is
the backend-side SQLite, and the frontend does not use Prisma.

---

## Research claims policy

X-MUX documentation, UI and marketing copy **may** state:

- "X-MUX combines multiple evidence sources for voice-integrity analysis."
- "X-MUX is designed to improve robustness to previously unseen synthetic
  speech generators" (a design goal of the training workspace, pending future
  validated fine-tuning).
- "Fine-tuning uses diverse synthetic and bona-fide speech data."
- "Evaluation includes unseen-generator testing."

It **must not** state (unless a future independently validated result truly
supports the precise claim):

- "detects every AI voice"
- "100 % accurate" / any accuracy percentage for X-MUX itself
- "perfect detection"
- "guaranteed protection"

The only third-party accuracy figure that may be cited is the AASIST authors'
published baseline for the pretrained checkpoint (EER 0.99 %, min t-DCF 0.0309
on ASVspoof 2019 LA), always attributed to them, never presented as an X-MUX
measurement.

---

## Documentation

- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) — system architecture and
  evidence pipeline
- [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) — Vercel + backend deployment,
  environment variables, validation checklist
- [docs/LIVE_STREAM.md](docs/LIVE_STREAM.md) — how live analysis works
- [docs/SECURITY.md](docs/SECURITY.md) — upload validation, CORS, privacy
- [docs/MODEL_CARD.md](docs/MODEL_CARD.md) — model cards and swap procedure
- [docs/TRAINING.md](docs/TRAINING.md) — training overview (points to
  `training/README.md`)
- [backend/README.md](backend/README.md) — backend quickstart and API reference
- [training/README.md](training/README.md) — offline training workspace guide

---

*X-MUX — voice integrity evidence supports security decisions; it does not replace them.*
