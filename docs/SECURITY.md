# X-MUX Security & Privacy Notes

This document describes the security-relevant behavior of the X-MUX
prototype as implemented, and states honestly what is **not** implemented.

> X-MUX provides voice-integrity evidence to support security decisions. It
> does not replace human verification or guarantee detection.

---

## 1. Upload validation (as implemented)

Every uploaded file is treated as untrusted input:

- **Extension allow-list** (defense in depth; ffmpeg performs the real
  check): `.wav .wave .mp3 .flac .ogg .oga .m4a .mp4 .webm .aac .opus .wma
  .aiff .aif`. Anything else is rejected with HTTP 400.
- **Hard size limit**: `XMUX_MAX_UPLOAD_MB` (default 25 MB). Oversized
  uploads are rejected before decoding.
- **Generated storage ids**: uploads are written into `XMUX_TMP` (default
  `/tmp/xmux`) under a fresh `uuid4().hex` + validated extension. **User
  filenames are never used as paths** — there is no path-traversal surface
  from filenames.
- **Decode of untrusted input is isolated**: decoding runs through `ffmpeg`
  as a subprocess (30 s probe timeout, 60 s decode timeout) into
  16 kHz mono float32 WAV, then read with `soundfile`. Decode failures
  return a clean 400-level error to the client — never a stack trace.
- **Duration bounds**: after decode, audio shorter than
  `XMUX_MIN_DURATION_SEC` (0.5 s) or longer than `XMUX_MAX_DURATION_SEC`
  (120 s) is rejected.
- Transient files are deleted immediately after decoding (see §5).

## 2. Rate limiting and authentication — NOT implemented (honest status)

This prototype has **no authentication, authorization or rate limiting**
built in. Any client that can reach the backend can submit analyses, enroll
profiles and change policy settings. Before any real deployment you must add
at the infrastructure or application layer:

- authenticated access to the frontend and backend (e.g. SSO/identity
  provider in front of both);
- per-user and per-IP rate limits on `POST /api/analyze`, `POST
  /api/profiles` and live sessions (these run real ML inference and are the
  expensive paths);
- protection for `PUT /api/settings` (policy changes affect verdicts);
- request body limits at the reverse proxy in addition to the application
  limit.

Treat these as deployment responsibilities, not features of this codebase.

## 3. CORS policy

- **Development** (`XMUX_ENV=development`, empty `XMUX_ALLOWED_ORIGINS`):
  any origin is allowed. This exists for local convenience only.
- **Production**: set `XMUX_ALLOWED_ORIGINS` to the exact Vercel origin(s),
  e.g. `XMUX_ALLOWED_ORIGINS=https://your-app.vercel.app`. The list applies
  to the FastAPI CORS middleware (REST) and is the reference for Socket.IO
  origin validation.
- With `XMUX_ENV=production` and **no** origins configured, the REST layer
  fails closed (no cross-origin access). Do not rely on this — configure the
  list explicitly.
- The REST surface exposed to browsers is only the Next.js origin
  (`/api/xmux/*` server-side proxy); the backend origin is additionally
  reachable directly and must be protected at the network/WAF level.

## 4. WebSocket origin validation (note)

The Socket.IO server is configured with `cors_allowed_origins="*"` at the
engine level (required by the sandbox gateway transport), while REST CORS is
tightened via the middleware above. **In production you should also enforce
origin checks for Socket.IO** — either at the reverse proxy (reject
non-`Origin`-matching WebSocket upgrades) or by wiring
`XMUX_ALLOWED_ORIGINS` into the `socketio.AsyncServer` configuration. This
is a known hardening item for the deployment operator.

## 5. Transient audio processing & privacy

- **Raw audio is not retained.** Uploaded files are written to `XMUX_TMP`
  only for the duration of decoding and are unlinked immediately after —
  before analysis results are returned.
- **Live buffers are in-memory only.** The 12-second rolling buffer lives in
  process memory and is discarded when the session ends.
- **What is persisted** (backend SQLite): analysis *results* (scores,
  verdicts, model version, evidence JSON), voice-profile *embeddings*
  (192-dimensional ECAPA vectors — derived features, **not** raw audio),
  event/audit records and application settings.
- An explicit `raw_audio_retention` policy flag exists in the settings
  schema and defaults to **off**; the current implementation processes
  transiently and does not write raw audio to disk regardless.
- Voice profiles contain biometric-derived data. Treat the database
  accordingly (access control, encryption at rest on the host, deletion on
  request) per your privacy obligations.

## 6. No secrets in Git

- The repository contains **no** secrets: no API keys, no tokens, no
  passwords. `.env` files are gitignored.
- Optional secrets (`HF_TOKEN`, `NVIDIA_API_KEY`) exist only as environment
  variables on the hosts that need them, set privately through the
  platform's secret store — never committed, never in `NEXT_PUBLIC_*`
  variables (which are embedded in the client bundle), never displayed in
  the UI. The active models are public and need no token at all.
- No secrets are required to build or run either deployment unit.

## 7. Path safety

- All upload paths are generated (`uuid4().hex`), stored under `XMUX_TMP`,
  and cleaned up after use.
- Model artifact paths come from server-side environment variables
  (`XMUX_AASIST_MODEL_PATH`, `XMUX_MODELS_DIR`), never from user input.
- Model metadata exposed through the API is a fixed, safe shape (name,
  version, sha256, input/output contract) — **filesystem paths are never
  exposed** to clients.

## 8. Failure safety

- If a model cannot load or run, components report `UNAVAILABLE`/`ERROR`
  and analyses return `MODEL_UNAVAILABLE` with **no fabricated scores**.
- Invalid input produces clean 400 responses; backend exceptions during
  prediction are logged server-side and never surface as fake data.
- The frontend proxy returns a friendly 502 when the backend is unreachable
  rather than hanging.
