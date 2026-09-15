"""Quality engine (spec PART 47).

Quality measures the RELIABILITY of the analysis, not the authenticity
of the voice. It feeds confidence and can force INCONCLUSIVE when the
audio cannot support a decision. All values are measured, never
fabricated.
"""

from __future__ import annotations

from typing import Any

import numpy as np

from .dsp import estimate_snr


def compute_quality(wave: np.ndarray, sample_rate: int,
                    vad_result: dict[str, Any],
                    dsp_result: dict[str, Any]) -> dict[str, Any]:
    """Derive an audio-quality block from real measurements."""
    duration = wave.size / float(sample_rate)
    speech_ratio = vad_result.get("speech_ratio")
    snr_db = estimate_snr(wave)

    clipping = float(dsp_result.get("clipping_ratio", 0.0) or 0.0)
    silence_ratio = (
        round(1.0 - float(speech_ratio), 3)
        if speech_ratio is not None else None
    )

    # Band-limiting: when usable speech energy rolls off below the
    # telephone band (~3.4 kHz), anti-spoofing reliability is reduced —
    # countermeasures are known to confuse channel effects with synthesis.
    rolloff = dsp_result.get("spectral_rolloff_hz")
    band_limited = (
        rolloff is not None and speech_ratio is not None
        and speech_ratio > 0.15 and float(rolloff) < 3400.0
    )

    # Quality sub-scores in [0, 1]:
    #  - duration adequacy (>= 3 s is comfortable for a 4 s model window)
    dur_score = float(np.clip((duration - 0.5) / 2.5, 0.0, 1.0))
    #  - speech content
    sp_score = float(np.clip(speech_ratio / 0.6, 0.0, 1.0)) \
        if speech_ratio is not None else 0.5
    #  - noise (SNR below ~5 dB is poor; above ~25 dB is great)
    snr_score = float(np.clip((snr_db - 5.0) / 20.0, 0.0, 1.0)) \
        if snr_db is not None else 0.5
    #  - clipping penalty
    clip_score = float(np.clip(1.0 - clipping * 20.0, 0.0, 1.0))
    #  - bandwidth penalty for band-limited channels
    band_score = 0.75 if band_limited else 1.0

    overall = round(
        0.28 * dur_score + 0.28 * sp_score + 0.22 * snr_score
        + 0.12 * clip_score + 0.10 * band_score,
        3,
    )

    flags: list[str] = []
    if duration < 1.0:
        flags.append("VERY_SHORT")
    if speech_ratio is not None and speech_ratio < 0.15:
        flags.append("INSUFFICIENT_SPEECH")
    if snr_db is not None and snr_db < 5.0:
        flags.append("LOW_SNR")
    if clipping > 0.01:
        flags.append("CLIPPING")
    if band_limited:
        flags.append("BAND_LIMITED")

    return {
        "available": True,
        "score": overall,
        "duration_sec": round(duration, 2),
        "speech_ratio": speech_ratio,
        "silence_ratio": silence_ratio,
        "snr_db": round(snr_db, 1) if snr_db is not None else None,
        "clipping_ratio": round(clipping, 5),
        "flags": flags,
    }
