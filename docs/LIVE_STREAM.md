# X-MUX Live Stream — How Live Analysis Works

This document describes the implemented live-monitoring path: browser
capture → Socket.IO transport → backend windowing → temporal decision →
alerts.

X-MUX live analysis is **near-real-time chunk analysis**: scores update
roughly once per second while speech is present. X-MUX does not claim
real-time or instant detection.

> X-MUX provides voice-integrity evidence to support security decisions. It
> does not replace human verification or guarantee detection.

---

## 1. Browser capture

- **Explicit permission only.** The microphone is never requested on page
  load. Starting a live session first checks the application-level
  permissions (Microphone Access, Live Audio Capture, Live Monitoring —
  configurable in Settings), then calls `getUserMedia` so the browser shows
  its own permission prompt. Possible UI states: `READY`,
  `PERMISSION_REQUIRED`, `BLOCKED`, `UNAVAILABLE`, `ERROR`.
- Capture constraints: mono, with `echoCancellation`, `noiseSuppression`
  and `autoGainControl` disabled so the analyzed signal stays as close to
  the source as possible.
- **AudioWorklet**: the stream feeds a `pcm-capture` AudioWorklet processor
  (`public/pcm-worklet.js`) running on the audio rendering thread. The
  worklet posts copied `Float32Array` chunks to the main thread.
- The main thread accumulates chunks until ~0.5 s of audio (24,000 samples
  at the browser's native rate, typically 48 kHz), converts Float32 → Int16
  PCM → base64, and emits it with the **browser's actual sample rate**, which
  is sent with every chunk.
- The audio graph is sinked through a zero-gain node so it stays alive in
  every browser without playing anything back.

## 2. Transport

- **Socket.IO** with engine.io path **`/`**, transports `["websocket",
  "polling"]`, auto-reconnection (8 attempts).
- Production: the browser connects directly to the backend via
  `NEXT_PUBLIC_XMUX_LIVE_URL`.
- Development sandbox: the browser connects to a relative URL
  (`/?XTransformPort=8765`) which the local gateway forwards to the backend —
  same path, same client code. The frontend auto-detects which mode to use.
- Chunks are `audio_chunk` events: `{ data: "<base64 Int16 PCM>",
  sampleRate: <number> }`.

## 3. Backend buffering

- Each socket maps to one `LiveSession` with a **12-second rolling buffer**
  (192,000 samples @ 16 kHz max; older audio is dropped as new audio
  arrives).
- **Real resampling to 16 kHz** happens server-side (polyphase resampling
  via `scipy.signal.resample_poly`) whenever the browser sample rate differs
  — the model always receives 16 kHz audio.
- Analysis runs at a **1 Hz cadence** (at most one analysis per second, and
  only once ≥1 s of audio is buffered).

## 4. The verified model window

The transport chunk size (~0.5 s) is **not** the model input size. AASIST-L
is only invoked when:

- the buffer holds at least the full verified window of **64,600 samples
  (~4.03 s @ 16 kHz)**, and
- the current speech ratio (Silero VAD over the buffer) is ≥ 0.5.

The model then receives **only the latest full 64,600-sample window** of the
rolling buffer (`prefer="latest"`, `max_windows=1`). Arbitrary tensor sizes
are never fed to the model — this preserves the checkpoint's verified input
contract. Consequences:

- No scores appear during the first ~4 seconds of speech (by design).
- Each score reflects the most recent ~4 s of audio, not the entire session.

When a reference profile is selected, ECAPA-TDNN additionally compares the
embedding of the last 8 s of buffered audio against the stored reference
embedding (cosine similarity).

## 5. Temporal smoothing and hysteresis

Per-window fused risk feeds a per-session `TemporalRiskEngine`:

- **EWMA smoothing** with α = 0.35 keeps the trend stable without hiding
  transitions.
- **Hysteresis state machine** over four states — escalation (moving to a
  worse state) requires the target state to persist for **2 consecutive
  windows**; de-escalation (moving to a better state) requires **4
  consecutive windows**. A single spurious window therefore cannot escalate
  the session, and brief dips cannot clear it:

  | State | Entered when EWMA risk… | Recommended action |
  |---|---|---|
  | `MONITORING` | stays below `risk_warn` (default 0.35) | `ALLOW` |
  | `SUSPICIOUS` | ≥ `risk_warn` for 2 consecutive windows | `WARN` |
  | `HIGH_RISK` | ≥ `risk_high` (default 0.65) for 2 consecutive windows | `VERIFY` |
  | `INTERVENTION` | ≥ 0.85 for 2 consecutive windows | `BLOCK` |

  Windows with no decision (no speech, model unavailable, inconclusive) do
  not move the EWMA or the state machine.

- The trend (last 60 EWMA values) is included in every `analysis` event and
  rendered as the Live Monitor chart.

## 6. Alerting policy

Alerts are **transition-driven, never periodic**:

- No alert is ever emitted while in `MONITORING`.
- An alert fires only when the state changes to `SUSPICIOUS` /
  `HIGH_RISK` / `INTERVENTION` — and only if at least **8 seconds** have
  passed since the previous alert (cooldown) and the new state differs from
  the last alerted state.
- Alert types: `WARNING` (entering `SUSPICIOUS`) or `SECURITY_ALERT`
  (entering `HIGH_RISK` / `INTERVENTION`).
- Every alert is persisted to the backend `events` table (audit trail).
- Browser notifications (if the user granted the Notification permission and
  enabled them in Settings) fire for `SECURITY_ALERT` only.

Session end emits an `ended` summary: duration, chunks received, final
state, final action and the alert list.

## 7. Latency expectations (honest)

- **CPU-only development sandbox**: measured typical per-window latency is
  **~1.0–1.5 s** (VAD + DSP + quality + AASIST-L on one 4.03 s window). The
  `latencyMs` field in each `analysis` event reports the actual measured
  value.
- **GPU hosts** are expected to be faster, but X-MUX does not claim any GPU
  latency figure — measure on your own deployment using the reported
  `latencyMs`.
- End-to-end alert delay ≈ window latency + smoothing/persistence
  requirements (2 consecutive windows for escalation) — i.e., several
  seconds of sustained evidence are required before an escalation alert.
  This is deliberate: one isolated window never triggers an intervention.

## 8. Production source note (no telecom interception)

Live analysis requires an audio source the operator is **already authorized
to capture**:

- the browser microphone (explicit user permission, as above), or
- an authorized media-infrastructure feed (e.g. conference audio routed into
  the analysis host by the infrastructure's owner).

A browser cannot intercept cellular or telephone calls, and X-MUX contains
no telephony interception functionality of any kind. Live monitoring must
comply with the consent and recording laws of your jurisdiction.
