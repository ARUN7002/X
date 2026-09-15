"""Silero VAD speech-activity detection.

Verified contract:
- Model: silero-vad PyPI package (bundled JIT artifact).
- Input: 16 kHz mono chunks (512-sample frames for streaming probability,
  arbitrary length for timestamp extraction).
- Output: per-chunk speech probability in [0, 1]; timestamps of speech
  regions. VAD is speech-activity detection ONLY — it is not a deepfake
  detector and never contributes to synthetic evidence directly.
"""

from __future__ import annotations

from typing import Any

import numpy as np

from .base import MLComponent, ModelInfo, ensure_mono_f32

FRAME_SAMPLES = 512  # 32 ms @ 16 kHz — Silero streaming frame size


class SileroVAD(MLComponent):
    component_name = "speech_activity"

    def __init__(self) -> None:
        super().__init__()
        self.model = None
        self.device = "cpu"

    # ------------------------------------------------------------- lifecycle
    def load(self) -> None:
        self._mark_loading()
        try:
            import torch
            from silero_vad import load_silero_vad

            model = load_silero_vad()
            model.eval()

            # Real self-test: silence then a probe frame.
            with torch.no_grad():
                silence_p = float(
                    model(torch.zeros(FRAME_SAMPLES), 16000).item()
                )
                probe_p = float(
                    model(
                        torch.from_numpy(
                            np.linspace(-0.3, 0.3, FRAME_SAMPLES, dtype=np.float32)
                        ),
                        16000,
                    ).item()
                )
            if not (np.isfinite(silence_p) and np.isfinite(probe_p)):
                self._mark_error("vad self-test failed")
                return
            self.model = model
            self._mark_ready()
        except ImportError as exc:
            self._mark_unavailable(
                f"speech activity runtime not installed ({exc.name})"
            )
        except Exception as exc:  # noqa: BLE001
            self._mark_error(f"vad failed to load: {type(exc).__name__}")

    # ----------------------------------------------------------------- info
    def info(self) -> ModelInfo:
        return ModelInfo(
            component=self.component_name,
            model_name="Silero VAD",
            model_family="silero-vad (JIT)",
            model_version="pretrained-1.0.0",
            checkpoint_identifier="silero_vad.jit",
            output_semantics=(
                "speech probability per 512-sample frame; timestamps mark "
                "speech regions (speech activity only, not spoof evidence)"
            ),
            source="snakers4/silero-vad via the silero-vad PyPI package",
            loaded=self.available(),
            inference_ready=self.available(),
            input_sample_rate=16000,
            input_window="512-sample frames (32 ms)",
            device=self.device if self.available() else None,
            note=self.error_note,
        )

    # ------------------------------------------------------------------ api
    def frame_probabilities(self, wave: np.ndarray, sample_rate: int = 16000
                            ) -> list[float]:
        """Per-frame speech probabilities (real model calls)."""
        if not self.available() or self.model is None:
            return []
        try:
            import torch

            from .base import resample_to_16k

            w = resample_to_16k(ensure_mono_f32(wave), sample_rate)
            probs: list[float] = []
            with torch.no_grad():
                for i in range(0, w.size - FRAME_SAMPLES + 1, FRAME_SAMPLES):
                    frame = torch.from_numpy(
                        np.ascontiguousarray(w[i : i + FRAME_SAMPLES])
                    )
                    probs.append(float(self.model(frame, 16000).item()))
            return probs
        except Exception:  # noqa: BLE001
            return []

    def analyze(self, wave: np.ndarray, sample_rate: int = 16000
                ) -> dict[str, Any]:
        """Speech ratio + status for an analysis window."""
        probs = self.frame_probabilities(wave, sample_rate)
        if not probs:
            return {
                "available": False,
                "speech_ratio": None,
                "status": "UNAVAILABLE",
            }
        speech_frames = sum(1 for p in probs if p >= 0.5)
        ratio = speech_frames / len(probs)
        if ratio >= 0.30:
            status = "SPEECH"
        elif ratio > 0.05:
            status = "PARTIAL"
        else:
            status = "SILENCE"
        return {
            "available": True,
            "speech_ratio": round(ratio, 3),
            "status": status,
            "mean_probability": round(sum(probs) / len(probs), 3),
        }
