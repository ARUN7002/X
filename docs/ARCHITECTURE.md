# X-MUX System Architecture

This document describes the system as actually implemented. Every component
listed here exists in code and runs real computation; there are no mock
scores, no random fallbacks and no simulated latency.

> X-MUX provides voice-integrity evidence to support security decisions. It
> does not replace human verification or guarantee detection.

---

## 1. Layer separation

X-MUX is split into three strictly separated layers. Responsibilities do not
leak across layers.

### Frontend (Next.js, deployed on Vercel) — *knows*

User-facing concerns only:

- user-friendly results, risk, synthetic-evidence display, speaker
  similarity, quality, confidence
- evidence summaries, status, recommended actions
- permissions and settings UI
- Live Monitor visualization

It never sees checkpoints, tensor shapes, sample-rate plumbing, filesystem
paths or database internals. All REST traffic goes through a server-side
proxy route (`src/app/api/xmux/[...path]/route.ts`) that forwards to
`XMUX_BACKEND_URL`; the browser only ever talks to the Next.js origin for
REST, and to the backend directly (path `/`) for Socket.IO.

### Backend (Python FastAPI + Socket.IO, separate host) — *knows*

ML and operational concerns:

- models, checkpoints, model versions and verified input/output contracts
- DSP, VAD, sample-rate conversion, tensor shapes and windowing
- Socket.IO sessions, buffering and latency measurement
- evidence fusion, risk engine, policy application
- SQLite persistence (analyses, voice profiles, events, settings)
- truthful health states and compute reporting (CPU vs GPU)

### Training workspace (offline, GPU host) — *knows*

- datasets, manifests, licenses and protocols
- augmentation pipelines
- experiments, checkpoints, metrics, calibration and model export

Training **never** runs on Vercel and **never** runs inside the serving
backend. The backend only loads a selected, verified artifact. The frontend
has no training UI.

```
┌───────────────┐  REST /api/xmux/* (server proxy)   ┌──────────────────┐
│   FRONTEND    │ ─────────────────────────────────▶ │     BACKEND      │
│  Next.js on   │  Socket.IO path "/" (browser WSS)  │ FastAPI+socketio │
│    Vercel     │ ─────────────────────────────────▶ │  + SQLite + ML   │
└───────────────┘                                     └────────▲─────────┘
                                                      artifacts│load
                                               ┌───────────────┴──────┐
                                               │ TRAINING (offline)   │
                                               │ GPU host · datasets  │
                                               │ eval · calibration   │
                                               │ export · registry    │
                                               └──────────────────────┘
```

---

## 2. Evidence pipeline (upload / microphone clip)

`backend/app/analysis.py::run_full_analysis` orchestrates the full pipeline:

```
audio bytes
  ↓ 1. validation      extension allow-list, 25 MB limit, generated storage id
  ↓ 2. decode          ffmpeg → 16 kHz mono float32 (untrusted input sandboxed in XMUX_TMP)
  ↓ 3. VAD             Silero VAD → speech ratio / status (gates expensive steps)
  ↓ 4. DSP             librosa/numpy/scipy: RMS, peak, ZCR, clipping, spectral
  │                    centroid/bandwidth/rolloff/flatness/flux, MFCC, F0,
  │                    jitter/shimmer approximations, SNR estimate
  ↓ 5. quality         duration/speech/SNR/clipping/band-limit → score + flags
  ↓ 6. AASIST-L        synthetic evidence on the verified 64,600-sample window(s)
  ↓ 7. ECAPA-TDNN      (only when a reference profile is selected) 192-dim
  │                    embedding → cosine similarity vs stored reference
  ↓ 8. fusion          risk from detection evidence only; quality → confidence;
  │                    INCONCLUSIVE / MODEL_UNAVAILABLE are first-class outcomes
  ↓ 9. risk + policy   thresholds → verdict (LOW/ELEVATED/HIGH RISK) and
  │                    recommended action (ALLOW/WARN/BLOCK; VERIFY when
  │                    inconclusive or unavailable)
  ↓ 10. report         structured evidence JSON → SQLite + response
```

### Fusion rules (enforced)

- Risk is computed **only** from defensible detection evidence: synthetic
  evidence (weight 0.75 when present) and speaker mismatch derived from ECAPA
  cosine similarity below the configured threshold (weight 0.25 when a
  reference exists).
- DSP/prosody/quality **never** add risk directly. They modulate
  **confidence** and can force `INCONCLUSIVE`.
- `VERY_SHORT` or `INSUFFICIENT_SPEECH` audio, or confidence below 0.30,
  forces `INCONCLUSIVE` with a "verify" recommendation.
- Model responsibilities stay separate; nothing is merged into a single
  "AI percentage".

### Outcome semantics

| Status | Meaning | Recommended action |
|---|---|---|
| `COMPLETED` | Detection evidence produced a decision | `ALLOW` / `WARN` / `BLOCK` |
| `INCONCLUSIVE` | Audio conditions prevent a reliable decision | `VERIFY` |
| `MODEL_UNAVAILABLE` | No detection model could run on this host | `VERIFY` (no scores are fabricated) |
| `ANALYSIS_FAILED` | Reserved for decode/validation failures (rejected earlier with HTTP 4xx) | — |

---

## 3. Live streaming architecture

Detailed walkthrough: [LIVE_STREAM.md](LIVE_STREAM.md). Summary:

```
browser microphone (explicit permission)
  → AudioWorklet PCM capture (public/pcm-worklet.js)
  → ~0.5 s Float32 chunks → Int16 PCM → base64
  → Socket.IO "audio_chunk" { data, sampleRate }   (path "/")
  → backend session: 12 s rolling buffer, real resampling to 16 kHz
  → 1 Hz analysis cadence
      VAD → DSP → quality →
      AASIST-L on the LATEST FULL 64,600-sample window (never arbitrary sizes)
      ECAPA on the last 8 s when a reference profile exists
  → per-window fusion
  → temporal engine: EWMA (α = 0.35) + hysteresis
      MONITORING → SUSPICIOUS → HIGH_RISK → INTERVENTION
  → "analysis" event every second; "alert" only on state transitions
      (8 s cooldown, one alert type per transition)
```

- Escalation requires 2 consecutive target-state windows; de-escalation
  requires 4 (hysteresis prevents flapping).
- `INTERVENTION` is reached when the EWMA risk reaches 0.85.
- The transport chunk duration (~0.5 s) is **not** the model input duration;
  the model always receives the verified 4.03 s window.

---

## 4. Model abstraction

All ML components implement the same lifecycle
(`backend/app/models/base.py`), so a future fine-tuned X-MUX AASIST-L
checkpoint replaces the pretrained one by changing **only the artifact**:

```
MLComponent
  ├─ load()     → truthful state transitions; real self-test before READY
  ├─ health()   → { component, state, note }
  ├─ info()     → ModelInfo (safe metadata: sha256, input contract, output
  │              semantics, source, version — never filesystem paths)
  └─ available() → True only when state == READY
```

- States: `READY`, `DEGRADED`, `UNAVAILABLE`, `ERROR`.
- Models load in a background thread at startup; the API is immediately
  available and reports honest `UNAVAILABLE` states while initializing.
- Each `load()` runs a **real self-test** (a deterministic probe waveform
  through the model with output-contract verification) before declaring
  `READY`. If the self-test fails, the component is `ERROR` and produces no
  scores.
- The active checkpoint is configurable via `XMUX_AASIST_MODEL_PATH`
  (default `backend/models/AASIST-L.pth`). ECAPA and Silero artifacts are
  auto-downloaded on first start into `XMUX_MODELS_DIR`.

Registry order at startup: Silero VAD (tiny, unlocks gating) → AASIST-L →
ECAPA-TDNN.

### Model swap path (future fine-tuned AASIST-L)

The REST/Socket.IO contract, frontend, Live Monitor, reports and risk engine
do **not** change when the model artifact changes:

1. Train offline in the training workspace (see
   [training/README.md](../training/README.md) §14).
2. Copy the exported checkpoint into the backend models dir.
3. Set `XMUX_AASIST_MODEL_PATH` to the new artifact.
4. Restart the backend; `GET /api/health` must show `synthetic_detection`
   `READY` (self-test re-runs automatically on load).
5. Rollback = point `XMUX_AASIST_MODEL_PATH` back to the previous checkpoint
   and restart.

Only the model artifact / version metadata changes; `ModelInfo.model_version`
and the stored `model_version` in reports identify which checkpoint produced
each analysis.

---

## 5. API contract summary

### REST (proxied through the Next.js server at `/api/xmux/*`)

| Method & path | Purpose |
|---|---|
| `GET /api/health` | Overall + per-component health, compute truth (CPU/GPU) |
| `POST /api/analyze` | Multipart upload (`file`, `source` ∈ UPLOAD/MICROPHONE, optional `profileId`) → full evidence report |
| `GET /api/reports?limit=` | Recent analyses (summaries) |
| `GET /api/reports/{id}` | Full stored evidence for one analysis |
| `DELETE /api/reports/{id}` | Delete a report |
| `GET /api/profiles` | List voice profiles |
| `POST /api/profiles` | Enroll a profile (3–60 s audio, `name` form field) |
| `DELETE /api/profiles/{id}` | Delete a profile |
| `GET /api/settings` | Policy + safe model metadata (incl. sha256) |
| `PUT /api/settings` | Update policy thresholds (validated ranges) |

Errors: validation failures return HTTP 400 with a user-safe `detail`;
backend unreachable → the proxy returns 502 with a friendly message.

### Socket.IO (path `/`)

Client → server:

| Event | Payload | Purpose |
|---|---|---|
| `start` | `{ profileId?: string }` | Begin a live session |
| `audio_chunk` | `{ data: base64 Int16 PCM, sampleRate: number }` | Stream audio |
| `stop` | `{}` | End the session |

Server → client:

| Event | Payload | Purpose |
|---|---|---|
| `status` | `{ connected, sid }` | On connect |
| `session` | `{ sessionId, startedAt, profileId, models{...}, note }` | Session opened; `note` states near-real-time expectations |
| `analysis` | per-window result (risk, state, trend, latency, evidence) | ~1 Hz while speech is present |
| `alert` | `{ type: SECURITY_ALERT/WARNING, state, riskScore, recommendedAction, t, message }` | Only on meaningful transitions |
| `ended` | `{ sessionId, durationSec, chunksReceived, finalState, alerts }` | Session summary |
| `error` | `{ code, message }` | e.g. `NOT_STARTED`, `BAD_CHUNK` |

The shared TypeScript contract lives in `src/lib/xmux/types.ts` and is the
stable interface between frontend and backend.

---

## 6. Inconclusive and failure handling

X-MUX never converts uncertainty into fake risk:

- AASIST-L returns `None` when unavailable → analysis status becomes
  `MODEL_UNAVAILABLE`, risk is `null`, action is `VERIFY`, and the report
  carries an explicit note. No score is substituted.
- Predict failures inside a component are caught and logged; the component
  degrades to `UNAVAILABLE`/`ERROR` rather than emitting data.
- Live windows with insufficient speech skip the model entirely; the temporal
  engine records a non-decided window instead of a zero score.
- `/api/health` reports per-component truth and an overall `DEGRADED` status
  when any component is not `READY`.

---

## 7. Persistence

Backend-side SQLite (`XMUX_DB`, default `backend/data/xmux.db`, WAL mode):

- `analyses` — result summaries + full evidence JSON + `model_version`
- `voice_profiles` — name, model, 192-dim embedding JSON (never raw audio)
- `events` — session/alert audit trail
- `app_settings` — runtime policy (thresholds, retention flags)

Raw audio is processed transiently in `XMUX_TMP` and deleted after decoding
(see [SECURITY.md](SECURITY.md)).

---

## 8. Compute honesty

`GET /api/health` includes a `compute` block reporting the actual runtime:
device (`cpu`/`cuda`), CUDA availability, PyTorch version and GPU name when
present. The development sandbox runs CPU-only and says so; GPU acceleration
is never claimed where it does not exist.
