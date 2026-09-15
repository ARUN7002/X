"""Real Socket.IO live analysis (spec PART 17, 18, 27).

Flow: browser microphone → audio chunks (base64 PCM over Socket.IO) →
backend session buffer → VAD → quality → DSP → AASIST-L (verified
64,600-sample window, never arbitrary tensor sizes) → ECAPA when a
reference profile exists → temporal fusion → Live Monitor events.

The transport chunk duration (~400 ms) is NOT the model input duration:
the AASIST-L window is always the verified 4.03 s input contract.
"""

from __future__ import annotations

import asyncio
import base64
import time
from typing import Any

import numpy as np

from . import db
from .dsp import compute_dsp
from .fusion import fuse_evidence
from .models.base import ensure_mono_f32, resample_to_16k
from .models import registry
from .quality import compute_quality
from .temporal import STATE_ACTIONS, TemporalRiskEngine

import socketio

RATE = 16000
BUFFER_SECONDS = 12.0          # rolling analysis buffer
ANALYZE_EVERY_SEC = 1.0        # window cadence
MODEL_WINDOW_SEC = 4.03        # verified AASIST-L input window
MIN_SPEECH_FOR_MODEL = 0.5     # skip AASIST when little speech buffered
ALERT_COOLDOWN_SEC = 8.0       # never spam alerts


class LiveSession:
    def __init__(self, session_id: str, profile_id: str | None,
                 policy: dict[str, Any]) -> None:
        self.id = session_id
        self.profile_id = profile_id
        self.policy = policy
        self.buffer = np.zeros(0, dtype=np.float32)
        self.engine = TemporalRiskEngine(policy)
        self.last_analysis_t = 0.0
        self.started_at = time.time()
        self.last_alert_t = 0.0
        self.receiving = False
        self.chunks_received = 0
        self.last_analysis: dict[str, Any] | None = None
        self.speech_status = "NO_AUDIO"
        self.alerts: list[dict[str, Any]] = []

    def append(self, pcm: np.ndarray, sample_rate: int) -> None:
        self.chunks_received += 1
        self.receiving = True
        mono = ensure_mono_f32(pcm)
        if sample_rate != RATE:
            mono = resample_to_16k(mono, sample_rate)
        self.buffer = np.concatenate([self.buffer, mono])
        max_samples = int(BUFFER_SECONDS * RATE)
        if self.buffer.size > max_samples:
            self.buffer = self.buffer[-max_samples:]

    def should_analyze(self) -> bool:
        now = time.time()
        return (now - self.last_analysis_t) >= ANALYZE_EVERY_SEC and \
            self.buffer.size >= RATE  # at least 1 s buffered

    def mark_analyzed(self) -> None:
        self.last_analysis_t = time.time()


_sessions: dict[str, LiveSession] = {}
_lock = asyncio.Lock()


def attach_live_handlers(sio: socketio.AsyncServer) -> None:
    """Register the Socket.IO events for live monitoring."""

    @sio.event
    async def connect(sid: str, environ: dict) -> None:
        await sio.emit("status", {"connected": True, "sid": sid}, to=sid)

    @sio.event
    async def disconnect(sid: str) -> None:
        session = _sessions.pop(sid, None)
        if session:
            await sio.emit(
                "ended",
                {"sessionId": session.id,
                 "durationSec": round(time.time() - session.started_at, 1),
                 "finalState": session.engine.state},
                to=sid,
            )

    @sio.on("start")
    async def _start(sid: str, data: dict | None) -> None:
        data = data or {}
        async with _lock:
            profile_id = data.get("profileId")
            ref_meta = db.get_profile(profile_id) if profile_id else None
            session = LiveSession(
                db.new_id("live"), profile_id, db.get_policy()
            )
            _sessions[sid] = session
        await sio.emit(
            "session",
            {
                "sessionId": session.id,
                "startedAt": session.started_at,
                "profileId": session.profile_id,
                "profileName": ref_meta["name"] if ref_meta else None,
                "models": {
                    "synthetic": registry.aasist.available(),
                    "speaker": registry.ecapa.available(),
                    "vad": registry.vad.available(),
                },
                "note": (
                    "Near-real-time chunk analysis: scores update roughly "
                    "once per second while speech is present."
                ),
            },
            to=sid,
        )

    @sio.on("audio_chunk")
    async def _chunk(sid: str, data: dict | None) -> None:
        data = data or {}
        session = _sessions.get(sid)
        if session is None:
            await sio.emit("error", {
                "code": "NOT_STARTED", "message": "session not started",
            }, to=sid)
            return
        try:
            raw = base64.b64decode(data.get("data", ""))
            pcm = np.frombuffer(raw, dtype=np.int16).astype(np.float32) / 32768.0
        except Exception:
            await sio.emit("error", {
                "code": "BAD_CHUNK", "message": "invalid audio chunk",
            }, to=sid)
            return
        sample_rate = int(data.get("sampleRate", RATE))
        session.append(pcm, sample_rate)

        if session.should_analyze():
            session.mark_analyzed()
            result = _analyze_window(session)
            await sio.emit("analysis", result, to=sid)
            alert = _maybe_alert(session, result)
            if alert:
                await sio.emit("alert", alert, to=sid)

    @sio.on("stop")
    async def _stop(sid: str, data: dict | None) -> None:
        session = _sessions.pop(sid, None)
        if session:
            summary = {
                "sessionId": session.id,
                "durationSec": round(time.time() - session.started_at, 1),
                "chunksReceived": session.chunks_received,
                "finalState": session.engine.state,
                "finalAction": STATE_ACTIONS[session.engine.state],
                "alerts": session.alerts,
            }
            db.insert_event(
                "SESSION_ENDED",
                f"Live session ended in state {session.engine.state}",
                session_id=session.id,
                data={"durationSec": summary["durationSec"],
                      "chunks": session.chunks_received},
            )
            await sio.emit("ended", summary, to=sid)

    async def _noop() -> None:  # keeps linters honest about async usage
        return None


def _analyze_window(session: LiveSession) -> dict[str, Any]:
    """Analyze the current buffer window and update temporal state."""
    t0 = time.perf_counter()
    wave = session.buffer
    vad = registry.vad.analyze(wave, RATE)
    session.speech_status = vad.get("status", "NO_AUDIO")
    dsp = compute_dsp(wave, RATE)
    quality = compute_quality(wave, RATE, vad, dsp)

    synthetic = None
    speech_ratio = vad.get("speech_ratio") or 0.0
    # AASIST-L only runs on a FULL verified 64,600-sample window of the
    # latest buffered audio (never arbitrary tensor sizes).
    if speech_ratio >= MIN_SPEECH_FOR_MODEL and wave.size >= int(RATE * MODEL_WINDOW_SEC):
        synthetic = registry.aasist.predict(wave, RATE, max_windows=1,
                                            prefer="latest")

    speaker = None
    if session.profile_id and speech_ratio >= MIN_SPEECH_FOR_MODEL:
        reference = db.get_profile_embedding(session.profile_id)
        if reference is not None:
            speaker = registry.ecapa.similarity(wave[-RATE * 8:], reference, RATE)

    fused = fuse_evidence(synthetic, speaker, quality, vad, session.policy)
    temporal = session.engine.update(
        fused["risk_score"], fused["confidence"], session.speech_status
    )
    latency_ms = round((time.perf_counter() - t0) * 1000.0, 1)

    result = {
        "sessionId": session.id,
        "t": round(time.time() - session.started_at, 1),
        "speechStatus": session.speech_status,
        "speechRatio": speech_ratio,
        "receiving": session.receiving,
        "syntheticEvidence": (synthetic or {}).get("evidence"),
        "speakerSimilarity": (speaker or {}).get("similarity"),
        "audioQuality": quality.get("score"),
        "confidence": fused["confidence"],
        "riskScore": temporal["risk"],
        "state": temporal["state"],
        "stateLabel": temporal["state_label"],
        "recommendedAction": temporal["action"],
        "status": fused["status"],
        "verdict": fused["verdict"],
        "latencyMs": latency_ms,
        "trend": session.engine.trend[-60:],
        "modelsReady": {
            "synthetic": registry.aasist.available(),
            "speaker": registry.ecapa.available(),
            "vad": registry.vad.available(),
        },
    }
    session.last_analysis = result
    return result


def _maybe_alert(session: LiveSession, result: dict[str, Any]) -> dict[str, Any] | None:
    """Alert only on meaningful state transitions with a cooldown."""
    state = result.get("state")
    if state in ("MONITORING",):
        return None
    now = time.time()
    if now - session.last_alert_t < ALERT_COOLDOWN_SEC:
        return None
    last = session.alerts[-1]["state"] if session.alerts else None
    if state == last:
        return None
    session.last_alert_t = now
    alert = {
        "type": "SECURITY_ALERT" if state in ("HIGH_RISK", "INTERVENTION")
                else "WARNING",
        "state": state,
        "stateLabel": result.get("stateLabel"),
        "riskScore": result.get("riskScore"),
        "recommendedAction": result.get("recommendedAction"),
        "t": result.get("t"),
        "message": _alert_message(state, result),
    }
    session.alerts.append(alert)
    db.insert_event(
        alert["type"],
        alert["message"],
        session_id=session.id,
        data={"state": state, "risk": result.get("riskScore")},
    )
    return alert


def _alert_message(state: str, result: dict[str, Any]) -> str:
    if state == "INTERVENTION":
        return (
            "Sustained high synthetic evidence during the live session. "
            "Recommended action: block and verify identity out-of-band."
        )
    if state == "HIGH_RISK":
        return (
            "High risk sustained in live audio. Recommended action: "
            "verify the speaker before proceeding."
        )
    return (
        "Elevated voice-integrity risk detected in live audio. "
        "Continue monitoring and verify if risk persists."
    )
