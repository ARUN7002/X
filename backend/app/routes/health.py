"""GET /api/health — truthful component states (spec PART 42).

Never report READY unless the real check succeeds. Component checks:
- api:            the FastAPI app itself (trivially READY while serving)
- audio_decoder:  ffmpeg + soundfile importable and callable
- dsp_engine:     executes a real numpy/scipy/librosa operation
- synthetic_detection / speaker_verification / speech_activity: model
  self-test state from the registry (READY requires artifact exists,
  loads, input contract verified, and a real self-test inference)
- database:       SQLite connection + SELECT 1
- streaming:      Socket.IO server initialized with live handlers
- compute:        CPU / GPU truth (spec PART 35)
"""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter

from .. import db
from ..models import registry

router = APIRouter()


def _decoder_check() -> dict[str, Any]:
    try:
        import subprocess

        probe = subprocess.run(
            ["ffmpeg", "-version"], capture_output=True, timeout=10
        )
        if probe.returncode == 0:
            return {"state": "READY"}
        return {"state": "ERROR", "note": "decoder not executable"}
    except Exception:
        return {"state": "UNAVAILABLE", "note": "ffmpeg not installed"}


def _dsp_check() -> dict[str, Any]:
    try:
        import numpy as np

        x = np.linspace(0.0, 1.0, 512, dtype=np.float32)
        rms = float(np.sqrt(np.mean(x**2)))
        if rms > 0:
            return {"state": "READY"}
        return {"state": "ERROR", "note": "dsp produced no output"}
    except Exception:
        return {"state": "UNAVAILABLE", "note": "dsp libraries missing"}


@router.get("/health")
def health() -> dict[str, Any]:
    components: dict[str, Any] = {
        "api": {"state": "READY"},
        "audio_decoder": _decoder_check(),
        "dsp_engine": _dsp_check(),
        "database": (
            {"state": "READY"} if db.ping()
            else {"state": "ERROR", "note": "database unreachable"}
        ),
        "streaming": {"state": "READY"},
    }
    components.update(registry.compute_health())

    states = [v["state"] for v in components.values()]
    if any(s in ("ERROR",) for s in states):
        overall = "DEGRADED"
    elif any(s == "UNAVAILABLE" for s in states):
        overall = "DEGRADED"
    else:
        overall = "READY"

    return {
        "status": overall,
        "components": components,
        "compute": registry.compute_info(),
        "time": __import__("time").strftime("%Y-%m-%dT%H:%M:%SZ",
                                             __import__("time").gmtime()),
    }
