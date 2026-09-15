# X-MUX ML Backend

Python FastAPI + Socket.IO backend serving real voice-integrity inference:
AASIST-L (synthetic evidence), ECAPA-TDNN (speaker verification), Silero VAD
(speech activity), a real DSP/quality engine, evidence fusion, temporal live
analysis and backend-side SQLite persistence.

> X-MUX provides voice-integrity evidence to support security decisions. It
> does not replace human verification or guarantee detection.

Entry point: `uvicorn app.main:app --host 0.0.0.0 --port ${XMUX_PORT:-8765}`
(run from this `backend/` directory). The combined ASGI app serves Socket.IO
at path `/` and everything else through FastAPI.

---

## 1. Dependencies

```bash
# core runtime
pip install -r requirements.txt

# PyTorch — CPU-only host (development default):
pip install torch torchaudio --index-url https://download.pytorch.org/whl/cpu

# GPU host: install torch per your CUDA environment instead, e.g.
#   pip install torch torchaudio  (with the appropriate CUDA wheel index)

# ML extras
pip install speechbrain silero-vad
```

System requirement: **ffmpeg** on `PATH` (upload decoding).

## 2. Start commands

```bash
# development (auto-reload; sandbox helper with a fixed interpreter path):
./run_dev.sh

# production:
uvicorn app.main:app --host 0.0.0.0 --port ${XMUX_PORT:-8765}
```

Models load in a background thread at startup; the API is immediately
available and reports honest `UNAVAILABLE` states until each component's
real self-test passes.

## 3. Environment variables (backend subset)

| Variable | Default | Purpose |
|---|---|---|
| `XMUX_PORT` | `8765` | Listening port |
| `XMUX_DB` | `backend/data/xmux.db` | SQLite database path |
| `XMUX_AASIST_MODEL_PATH` | `backend/models/AASIST-L.pth` | Active AASIST-L checkpoint |
| `XMUX_MODELS_DIR` | `backend/models` | speechbrain / silero cache dir |
| `XMUX_TMP` | `/tmp/xmux` | Transient upload/decode directory |
| `XMUX_ALLOWED_ORIGINS` | *(empty)* | Comma-separated allowed origins (set in production) |
| `XMUX_ENV` | `development` | `production` tightens CORS behavior |
| `XMUX_MAX_UPLOAD_MB` | `25` | Upload size limit |
| `XMUX_MIN_DURATION_SEC` | `0.5` | Minimum audio duration |
| `XMUX_MAX_DURATION_SEC` | `120` | Maximum audio duration |

No secrets are required. See [docs/DEPLOYMENT.md](../docs/DEPLOYMENT.md) for
the full cross-stack table (including the two Vercel variables that point the
frontend at this backend).

## 4. Model artifacts

| Artifact | Location | Notes |
|---|---|---|
| AASIST-L checkpoint | `models/AASIST-L.pth` (via `XMUX_AASIST_MODEL_PATH`) | **Tracked in Git** (426,428 bytes; sha256 `814331d088032bb4c3fa61cc014789eadeed464209dd094ab3a2dd6ffbdce27a`; MIT, see `AASIST_LICENSE`) |
| ECAPA-TDNN | `models/ecapa/` (auto-download from `speechbrain/spkrec-ecapa-voxceleb`) | Cached under `XMUX_MODELS_DIR`; public, no token |
| Silero VAD | bundled by the `silero-vad` package | Auto-downloaded/cached on first start |

Verified AASIST-L contract: input 64,600 samples @ 16 kHz (~4.03 s); output
`(B, 2)` logits with bonafide = column 1 and spoof = column 0; X-MUX
synthetic evidence = `softmax(logits)[:, 0]` (uncalibrated). See
[docs/MODEL_CARD.md](../docs/MODEL_CARD.md).

## 5. API reference

### REST (mounted at `/api`)

| Method & path | Description |
|---|---|
| `GET /api/health` | Overall status (`READY`/`DEGRADED`), per-component states, truthful compute info |
| `GET /` | Basic service info (Socket.IO at `/`) |
| `POST /api/analyze` | Multipart: `file` (audio), `source` (`UPLOAD`/`MICROPHONE`), optional `profileId` → full evidence report |
| `GET /api/reports?limit=N` | Recent analyses (default 50, max 200) |
| `GET /api/reports/{id}` | Full stored report incl. evidence JSON |
| `DELETE /api/reports/{id}` | Delete a report |
| `GET /api/profiles` | List voice profiles |
| `POST /api/profiles` | Enroll profile: multipart `file` (3–60 s) + `name` |
| `DELETE /api/profiles/{id}` | Delete a profile |
| `GET /api/settings` | Policy + safe model metadata (incl. checkpoint sha256) |
| `PUT /api/settings` | Update `risk_warn` / `risk_high` / `speaker_threshold` / retention flags (range-validated) |

Validation errors return HTTP 400 with a user-safe `detail`. Speaker model
unavailable → 503 on enrollment. Analysis never fabricates scores (see §7).

### Socket.IO (path `/`)

Client → server: `start {profileId?}`, `audio_chunk {data: base64 Int16 PCM,
sampleRate}`, `stop`.
Server → client: `status`, `session`, `analysis` (≈1 Hz windows), `alert`
(state transitions only, 8 s cooldown), `ended`, `error {code, message}`.

Live parameters: 12 s rolling buffer, 1 Hz cadence, AASIST-L only on the
latest full 64,600-sample window with speech ratio ≥ 0.5, EWMA α = 0.35,
hysteresis MONITORING → SUSPICIOUS → HIGH_RISK → INTERVENTION. Details:
[docs/LIVE_STREAM.md](../docs/LIVE_STREAM.md).

## 6. Health endpoint

`GET /api/health` checks — truthfully, never optimistically:

- `api`, `streaming` — serving state
- `audio_decoder` — ffmpeg executable check
- `dsp_engine` — a real numpy computation
- `database` — SQLite `SELECT 1`
- `synthetic_detection` / `speaker_verification` / `speech_activity` — model
  self-test states (READY requires the artifact to exist, load, match the
  verified I/O contract, and pass a real self-test inference)
- `compute` — actual device truth (CPU vs CUDA, PyTorch version, GPU name)

Overall status is `DEGRADED` if any component is not `READY`.

## 7. `verify_models.py`

A development verification script (not a unit-test suite) that loads all
three models and runs **real inference** on deterministic probes:

```bash
python verify_models.py
```

- Silero VAD on a chirp+noise probe and on silence
- AASIST-L on a 4 s chirp (verifies `(1,2)` logits) and on a short 2 s input
  (tile-padding path)
- ECAPA-TDNN on noise (verifies a 192-dim embedding and self-similarity ≈ 1)

Use it after installation and after every model artifact swap.

## 8. Failure states — never fake scores

- **`UNAVAILABLE`**: artifact or runtime missing on this host (e.g. torch
  not installed, checkpoint absent). Analyses return status
  `MODEL_UNAVAILABLE`, `risk_score: null`, recommended action `VERIFY`, with
  an explanatory note. **No score is substituted.**
- **`ERROR`**: load or self-test failed. Same no-fake-scores guarantee; the
  component's `note` carries the failure reason.
- **`INCONCLUSIVE`** (analysis-level): audio too short / insufficient
  speech / low confidence — `VERIFY` recommendation, risk withheld or
  flagged.
- Prediction exceptions are caught and logged; the component degrades
  truthfully instead of emitting data.

## 9. Development notes

- `run_dev.sh` hardcodes the sandbox venv interpreter
  (`/home/z/.venv/bin/python3`). Adjust for your machine or run uvicorn
  directly.
- SQLite runs in WAL mode; the `data/` directory is gitignored.
- `live_smoke_test.ts` (Node) drives a scripted live session against a
  running backend for end-to-end verification during development.
