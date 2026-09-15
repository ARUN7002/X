"""Real DSP engine (spec PART 46).

All features below are computed from the actual waveform with
NumPy/SciPy/librosa. They are SUPPORTING evidence and reliability
context only — no single DSP feature is ever interpreted as
"this is AI" (that claim would require a validated model).
"""

from __future__ import annotations

from typing import Any

import numpy as np

from .models.base import ensure_mono_f32


def compute_dsp(wave: np.ndarray, sample_rate: int = 16000) -> dict[str, Any]:
    """Compute the DSP feature block for a waveform."""
    w = ensure_mono_f32(wave)
    n = w.size
    out: dict[str, Any] = {"available": False}
    if n < 512 or sample_rate <= 0:
        return out
    try:
        import librosa

        # --- time-domain -------------------------------------------------
        peak = float(np.max(np.abs(w)))
        rms = float(np.sqrt(np.mean(w**2)))
        rms_db = float(20.0 * np.log10(max(rms, 1e-10)))
        zcr = float(np.mean(np.abs(np.diff(np.signbit(w))) > 0))

        # clipping: fraction of samples at/above 98% of peak when peak ~ full scale
        clipping_ratio = float(np.mean(np.abs(w) >= 0.98)) if peak >= 0.99 else 0.0

        # --- spectral (FFT / STFT) ----------------------------------------
        cent = float(np.mean(librosa.feature.spectral_centroid(y=w, sr=sample_rate)))
        bandwidth = float(
            np.mean(librosa.feature.spectral_bandwidth(y=w, sr=sample_rate))
        )
        rolloff = float(np.mean(librosa.feature.spectral_rolloff(
            y=w, sr=sample_rate, roll_percent=0.85)))
        flatness = float(np.mean(librosa.feature.spectral_flatness(y=w)))
        flux = float(np.mean(librosa.onset.onset_strength(y=w, sr=sample_rate)))

        # --- cepstral ------------------------------------------------------
        mfcc = librosa.feature.mfcc(y=w, sr=sample_rate, n_mfcc=13)
        mfcc_mean = [round(float(v), 2) for v in np.mean(mfcc, axis=1)]

        # --- pitch / prosody ----------------------------------------------
        f0, voiced_flag, _ = librosa.pyin(
            w, fmin=60, fmax=400, sr=sample_rate, frame_length=1024
        )
        voiced_f0 = f0[~np.isnan(f0)] if f0 is not None else np.array([])
        n_voiced = int(np.sum(voiced_flag)) if voiced_flag is not None else 0
        n_frames = int(len(voiced_flag)) if voiced_flag is not None else 0

        prosody: dict[str, Any] = {"available": False}
        if voiced_f0.size >= 3:
            f0_mean = float(np.mean(voiced_f0))
            f0_std = float(np.std(voiced_f0))
            # cycle-to-cycle perturbation approximations computed from the
            # F0 contour and per-frame amplitude (documented approximations,
            # not clinical-grade jitter/shimmer)
            periods = 1.0 / voiced_f0
            jit = float(np.mean(np.abs(np.diff(periods))) /
                        max(np.mean(periods), 1e-9))
            frame_amp = np.sqrt(np.mean(
                librosa.util.frame(w, frame_length=1024, hop_length=256) ** 2,
                axis=0))
            frame_amp = frame_amp[: len(voiced_f0)]
            if frame_amp.size >= 3 and np.mean(frame_amp) > 1e-8:
                shim = float(np.mean(np.abs(np.diff(frame_amp))) /
                             max(np.mean(frame_amp), 1e-9))
            else:
                shim = None
            prosody = {
                "available": True,
                "f0_mean_hz": round(f0_mean, 1),
                "f0_std_hz": round(f0_std, 1),
                "jitter_approx": round(float(np.clip(jit, 0, 1)), 4),
                "shimmer_approx": (round(float(np.clip(shim, 0, 1)), 4)
                                   if shim is not None else None),
                "voiced_ratio": round(n_voiced / max(n_frames, 1), 3),
            }

        out = {
            "available": True,
            "rms_db": round(rms_db, 1),
            "peak": round(peak, 4),
            "zcr": round(zcr, 4),
            "clipping_ratio": round(clipping_ratio, 5),
            "spectral_centroid_hz": round(cent, 1),
            "spectral_bandwidth_hz": round(bandwidth, 1),
            "spectral_rolloff_hz": round(rolloff, 1),
            "spectral_flatness": round(flatness, 4),
            "spectral_flux": round(flux, 3),
            "mfcc_mean": mfcc_mean,
            "prosody": prosody,
        }
        return out
    except Exception:
        return {"available": False}


def estimate_snr(wave: np.ndarray, speech_mask: np.ndarray | None = None) -> float | None:
    """Segmental SNR estimate using VAD-aware noise floor.

    Noise power is estimated from non-speech (or quietest 20%) frames;
    signal power from speech frames. Returns dB or None if not estimable.
    """
    w = ensure_mono_f32(wave)
    if w.size < 3200:
        return None
    frame = 512
    hop = 512
    n_frames = (w.size - frame) // hop + 1
    if n_frames < 8:
        return None
    powers = np.array([
        np.mean(w[i * hop : i * hop + frame] ** 2) for i in range(n_frames)
    ])
    if speech_mask is not None and len(speech_mask) >= n_frames:
        speech_p = powers[speech_mask[:n_frames] > 0]
        noise_p = powers[speech_mask[:n_frames] == 0]
        if speech_p.size < 4 or noise_p.size < 4:
            noise_p = np.sort(powers)[: max(n_frames // 5, 4)]
            speech_p = np.sort(powers)[-(n_frames // 2 or 4):]
    else:
        order = np.argsort(powers)
        noise_p = powers[order[: max(n_frames // 5, 4)]]
        speech_p = powers[order[-(n_frames // 2 or 4):]]
    noise = float(np.mean(noise_p))
    signal = float(np.mean(speech_p))
    if noise <= 1e-12 or signal <= noise:
        return 0.0
    return float(10.0 * np.log10(signal / noise))
