"""Evidence fusion, confidence and risk engine (spec PART 20, 21, 48).

Design principles (enforced):
- Model responsibilities stay separate; nothing is merged into a
  single "AI percentage".
- Risk is computed ONLY from defensible detection evidence:
  synthetic evidence (AASIST-L) and speaker mismatch (ECAPA cosine
  below the configured threshold). DSP/prosody/quality NEVER directly
  add risk — they modulate CONFIDENCE and can force INCONCLUSIVE.
- Detection determines evidence/risk; POLICY determines the action.
- Uncertainty is never converted into fake HIGH RISK; the INCONCLUSIVE,
  ANALYSIS FAILED and MODEL UNAVAILABLE outcomes are first-class.
"""

from __future__ import annotations

from typing import Any


def _clamp(x: float, lo: float = 0.0, hi: float = 1.0) -> float:
    return max(lo, min(hi, x))


def fuse_evidence(
    synthetic: dict[str, Any] | None,
    speaker: dict[str, Any] | None,
    quality: dict[str, Any] | None,
    vad: dict[str, Any] | None,
    policy: dict[str, Any],
) -> dict[str, Any]:
    """Fuse evidence layers into risk + confidence + policy action."""
    risk_warn = float(policy.get("risk_warn", 0.35))
    risk_high = float(policy.get("risk_high", 0.65))
    speaker_thr = float(policy.get("speaker_threshold", 0.25))

    synth_available = bool(synthetic and synthetic.get("available"))
    spk_available = bool(speaker and speaker.get("available"))
    quality_score = float((quality or {}).get("score", 0.5))
    quality_flags = set((quality or {}).get("flags", []))
    speech_ratio = (vad or {}).get("speech_ratio")

    # ------------------------------------------------------------- risk
    components: dict[str, float] = {}
    weights: dict[str, float] = {}

    if synth_available:
        components["synthetic"] = _clamp(float(synthetic["evidence"]))
        weights["synthetic"] = 0.75
    if spk_available:
        sim = float(speaker["similarity"])
        # mismatch grows as similarity drops below the threshold
        mismatch = _clamp((speaker_thr - sim) / max(speaker_thr + 1e-6, 0.1))
        components["speaker_mismatch"] = mismatch
        weights["speaker_mismatch"] = 0.25

    if components:
        total_w = sum(weights.values())
        risk = sum(components[k] * weights[k] for k in components) / total_w
    else:
        risk = None  # no detection evidence at all

    # -------------------------------------------------------- confidence
    confidence = 0.45  # neutral base
    confidence += 0.25 * quality_score
    if synth_available:
        # window agreement reduces uncertainty
        wstd = float(synthetic.get("window_std", 0.0))
        confidence += 0.20 * _clamp(1.0 - wstd * 2.0)
    if spk_available:
        confidence += 0.10
    if speech_ratio is not None:
        confidence += 0.05 * _clamp(speech_ratio / 0.6)
    if "VERY_SHORT" in quality_flags:
        confidence -= 0.15
    if "INSUFFICIENT_SPEECH" in quality_flags:
        confidence -= 0.20
    if "LOW_SNR" in quality_flags:
        confidence -= 0.10
    if "CLIPPING" in quality_flags:
        confidence -= 0.10
    if "BAND_LIMITED" in quality_flags:
        confidence -= 0.10
    confidence = round(_clamp(confidence), 3)

    # ------------------------------------------------------------ status
    forced_inconclusive = bool(
        {"INSUFFICIENT_SPEECH", "VERY_SHORT"} & quality_flags
    ) or (confidence < 0.30)

    if synth_available is False and not spk_available:
        status = "MODEL_UNAVAILABLE"
        verdict = "MODEL UNAVAILABLE"
        action = "VERIFY"
        risk_out = None
    elif forced_inconclusive:
        status = "INCONCLUSIVE"
        verdict = "INCONCLUSIVE"
        action = "VERIFY"
        risk_out = None if risk is None else round(risk, 3)
    else:
        status = "COMPLETED"
        risk_out = round(_clamp(risk if risk is not None else 0.0), 3)
        if risk_out < risk_warn:
            verdict = "LOW RISK"
            action = "ALLOW"
        elif risk_out < risk_high:
            verdict = "ELEVATED RISK"
            action = "WARN"
        else:
            verdict = "HIGH RISK"
            action = "BLOCK"

    return {
        "status": status,
        "verdict": verdict,
        "risk_score": risk_out,
        "recommended_action": action,
        "confidence": confidence,
        "risk_components": {k: round(v, 3) for k, v in components.items()},
        "policy": {
            "risk_warn": risk_warn,
            "risk_high": risk_high,
            "speaker_threshold": speaker_thr,
        },
        "notes": _fusion_notes(synth_available, spk_available,
                               forced_inconclusive, status, quality_flags),
    }


def _fusion_notes(synth: bool, spk: bool, forced: bool, status: str,
                  quality_flags: set[str] | None = None) -> list[str]:
    notes: list[str] = []
    if not synth:
        notes.append(
            "Synthetic evidence unavailable for this analysis; no spoof score "
            "was produced."
        )
    if not spk:
        notes.append(
            "Speaker similarity not evaluated (no reference profile selected "
            "or speaker model unavailable)."
        )
    if forced:
        notes.append(
            "Audio conditions or low confidence prevent a reliable decision; "
            "human verification is recommended."
        )
    if status == "MODEL_UNAVAILABLE":
        notes.append(
            "No detection model was available; this analysis cannot support "
            "an integrity decision."
        )
    if quality_flags and "BAND_LIMITED" in quality_flags:
        notes.append(
            "The audio is band-limited (narrow channel). Voice-integrity "
            "models are less reliable on band-limited channels; treat the "
            "result with extra caution."
        )
    return notes
