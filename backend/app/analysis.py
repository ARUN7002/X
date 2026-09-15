"""Analysis pipeline orchestrator.

AUDIO → validation → decoding → standardization → quality → VAD → DSP →
synthetic evidence (AASIST-L) → speaker consistency (ECAPA, optional) →
evidence fusion → confidence → risk → policy action → report/DB.
"""

from __future__ import annotations

import time
from typing import Any

import numpy as np

from . import db
from .config import settings
from .dsp import compute_dsp
from .fusion import fuse_evidence
from .models.base import ensure_mono_f32
from .models import registry
from .quality import compute_quality


def run_full_analysis(
    wave: np.ndarray,
    sample_rate: int,
    source: str,
    label: str | None,
    profile_id: str | None = None,
    session_id: str | None = None,
) -> dict[str, Any]:
    """Run the complete evidence pipeline on a decoded waveform."""
    t_start = time.perf_counter()
    from .models.base import resample_to_16k

    wave = resample_to_16k(ensure_mono_f32(wave), sample_rate)
    sample_rate = 16000
    policy = db.get_policy()

    # 1) speech activity (VAD) — gates expensive analysis
    vad_result = registry.vad.analyze(wave, sample_rate)

    # 2) DSP features
    dsp_result = compute_dsp(wave, sample_rate)

    # 3) quality (uses VAD + DSP measurements)
    quality_result = compute_quality(wave, sample_rate, vad_result, dsp_result)

    # 4) synthetic evidence (AASIST-L)
    synthetic = registry.aasist.predict(wave, sample_rate)

    # 5) speaker consistency (ECAPA) — only when a reference exists
    speaker: dict[str, Any] | None = None
    profile_name = None
    if profile_id:
        reference = db.get_profile_embedding(profile_id)
        ref_meta = db.get_profile(profile_id)
        if reference is None:
            speaker = {"available": False,
                       "note": "reference profile not found"}
        else:
            sim = registry.ecapa.similarity(wave, reference, sample_rate)
            if sim is None:
                speaker = {"available": False,
                           "note": "speaker model unavailable or audio too short"}
            else:
                speaker = sim
                profile_name = ref_meta["name"] if ref_meta else profile_id
    else:
        speaker = {"available": False,
                   "note": "no reference profile selected"}

    # 6) fusion → risk / confidence / action
    fused = fuse_evidence(synthetic, speaker, quality_result, vad_result, policy)

    latency_ms = round((time.perf_counter() - t_start) * 1000.0, 1)

    analysis_id = db.new_id("an")
    evidence = {
        "id": analysis_id,
        "source": source,
        "label": label,
        "status": fused["status"],
        "verdict": fused["verdict"],
        "recommended_action": fused["recommended_action"],
        "risk_score": fused["risk_score"],
        "confidence": fused["confidence"],
        "audio": {
            "duration_sec": round(wave.size / float(sample_rate), 2),
            "sample_rate": sample_rate,
            "channels": 1,
        },
        "speech_activity": vad_result,
        "evidence": {
            "synthetic": synthetic if synthetic else {"available": False},
            "speaker": {
                **(speaker or {}),
                "profile_id": profile_id if profile_name else None,
                "profile_name": profile_name,
            },
            "quality": quality_result,
            "prosody": dsp_result.get("prosody", {"available": False}),
        },
        "dsp": dsp_result,
        "risk_components": fused["risk_components"],
        "policy": fused["policy"],
        "notes": fused["notes"],
        "model": {
            "synthetic_detection": (
                "AASIST-L" if synthetic else "unavailable"),
            "speaker_verification": (
                "ECAPA-TDNN" if (speaker or {}).get("available") else None),
            "speech_activity": "Silero VAD" if vad_result.get("available") else None,
        },
        "meta": {
            "analysis_ms": latency_ms,
            "created_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
            "disclaimer": (
                "X-MUX provides voice-integrity evidence to support security "
                "decisions. It does not replace human verification or "
                "guarantee detection."
            ),
        },
    }

    db.insert_analysis({
        "id": analysis_id,
        "session_id": session_id,
        "source": source,
        "label": label,
        "status": fused["status"],
        "duration_sec": evidence["audio"]["duration_sec"],
        "sample_rate": sample_rate,
        "synthetic_evidence": (synthetic or {}).get("evidence"),
        "speaker_similarity": (speaker or {}).get("similarity"),
        "audio_quality": quality_result.get("score"),
        "confidence": fused["confidence"],
        "risk_score": fused["risk_score"],
        "verdict": fused["verdict"],
        "recommended_action": fused["recommended_action"],
        "model_version": "AASIST-L pretrained-1.0.0"
                         if synthetic else None,
        "evidence_json": _json_dumps(evidence),
        "created_at": evidence["meta"]["created_at"],
    })

    return evidence


def _json_dumps(obj: Any) -> str:
    import json

    class Enc(json.JSONEncoder):
        def default(self, o: Any) -> Any:  # noqa: D102
            if isinstance(o, (np.floating, np.integer)):
                return o.item()
            if isinstance(o, np.ndarray):
                return o.tolist()
            return super().default(o)

    return json.dumps(obj, cls=Enc)
