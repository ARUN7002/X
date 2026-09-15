"""AASIST-L synthetic/spoof evidence detector (spec PART 2, PART 3).

Verified input/output contract (inspected in the official clovaai/aasist
repository, NOT guessed):

- Checkpoint: models/weights/AASIST-L.pth (85,306 parameters), MIT license,
  Copyright (c) 2021-present NAVER Corp. — architecture vendored from
  models/AASIST.py with its original license header intact.
- Input: raw float32 waveform, mono, 16 kHz (ASVspoof 2019 LA), fixed
  64,600 samples (~4.03 s). Short inputs are tile-repeated, long inputs
  are windowed (official eval truncates to the first 64,600 samples; we
  analyse up to ``max_windows`` evenly spaced windows and aggregate).
- Output: ``Model.forward`` returns ``(last_hidden, logits)`` with logits
  of shape (B, 2). Training labels map bonafide=1 / spoof=0, and the
  official evaluation scores ``logits[:, 1]`` as the BONAFIDE (positive
  class) score. Therefore:
    * synthetic evidence = softmax(logits)[..., 0]  (spoof column)
    * raw protocol score = logits[..., 1]           (bonafide logit)
- The softmax value is an UNCALIBRATED model score. It is surfaced as
  "Synthetic Evidence", never as a validated probability.

Reported baseline (from the official repo README, ASVspoof 2019 LA eval):
EER 0.99%, min t-DCF 0.0309. These are the authors' published numbers for
the checkpoint; they are NOT X-MUX's own measurements and are only cited
for reference in technical documentation.
"""

from __future__ import annotations

import time
from pathlib import Path
from typing import Any

import numpy as np

from ..config import settings
from .base import MLComponent, ModelInfo, ensure_mono_f32

# Exact model_config from config/AASIST-L.conf of the official repository.
AASIST_L_CONFIG: dict[str, Any] = {
    "architecture": "AASIST",
    "nb_samp": 64600,
    "first_conv": 128,
    "filts": [70, [1, 32], [32, 32], [32, 24], [24, 24]],
    "gat_dims": [24, 32],
    "pool_ratios": [0.4, 0.5, 0.7, 0.5],
    "temperatures": [2.0, 2.0, 100.0, 100.0],
}

INPUT_SAMPLE_RATE = 16000
WINDOW_SAMPLES = AASIST_L_CONFIG["nb_samp"]  # 64,600 samples (~4.03 s)


class AASISTDetector(MLComponent):
    """SyntheticDetector implementation backed by pretrained AASIST-L."""

    component_name = "synthetic_detection"

    def __init__(self) -> None:
        super().__init__()
        self.model = None
        self.device = "cpu"
        self.checkpoint_path = settings.xmux_aasist_model_path
        self.checkpoint_sha256: str | None = None
        self._self_test_latency_ms: float | None = None

    # ------------------------------------------------------------- lifecycle
    def load(self) -> None:
        self._mark_loading()
        try:
            import torch  # imported lazily so the API can run without ML

            checkpoint = Path(self.checkpoint_path)
            if not checkpoint.is_file():
                self._mark_unavailable(
                    "synthetic detection checkpoint not present on this host"
                )
                return

            from . import aasist_arch

            state = torch.load(str(checkpoint), map_location="cpu")
            model = aasist_arch.Model(AASIST_L_CONFIG)
            model.load_state_dict(state)
            model.to(self.device)
            model.eval()

            # Real self-test: forward a deterministic probe and verify the
            # output contract before declaring the model ready.
            probe = np.linspace(-0.05, 0.05, WINDOW_SAMPLES, dtype=np.float32)
            t0 = time.perf_counter()
            with torch.no_grad():
                _, logits = model(torch.from_numpy(probe).unsqueeze(0))
            latency_ms = (time.perf_counter() - t0) * 1000.0
            logits = np.asarray(logits, dtype=np.float64)
            if logits.shape != (1, 2) or not np.isfinite(logits).all():
                self._mark_error("model self-test failed: unexpected output")
                return

            self.model = model
            from .base import sha256_of_file

            self.checkpoint_sha256 = sha256_of_file(self.checkpoint_path)
            self._self_test_latency_ms = round(latency_ms, 2)
            self._mark_ready()
        except ImportError as exc:
            self._mark_unavailable(
                f"ML runtime not installed on this host ({exc.name})"
            )
        except Exception as exc:  # noqa: BLE001 — surfaced as truthful state
            self._mark_error(f"model failed to load: {type(exc).__name__}")

    # ----------------------------------------------------------------- info
    def info(self) -> ModelInfo:
        return ModelInfo(
            component=self.component_name,
            model_name="AASIST-L",
            model_family="AASIST (integrated spectro-temporal graph attention)",
            model_version="pretrained-1.0.0",
            checkpoint_identifier="AASIST-L.pth",
            output_semantics=(
                "softmax(logits)[spoof] = synthetic evidence (uncalibrated); "
                "logits[bonafide] = raw protocol score (higher = more genuine)"
            ),
            source="clovaai/aasist pretrained checkpoint (ASVspoof 2019 LA)",
            loaded=self.available(),
            inference_ready=self.available(),
            sha256=self.checkpoint_sha256,
            input_sample_rate=INPUT_SAMPLE_RATE,
            input_window=f"{WINDOW_SAMPLES} samples (~4.03 s, 16 kHz)",
            device=self.device if self.available() else None,
            self_test_latency_ms=self._self_test_latency_ms,
            note=self.error_note,
        )

    # ---------------------------------------------------------------- predict
    def predict(self, wave: np.ndarray, sample_rate: int = 16000,
                max_windows: int = 5, prefer: str = "evenly"
                ) -> dict[str, Any] | None:
        """Compute synthetic evidence. Returns None when unavailable —
        the caller MUST treat that as INCONCLUSIVE / MODEL UNAVAILABLE and
        never substitute a score."""
        if not self.available() or self.model is None:
            return None
        try:
            import torch

            from .base import resample_to_16k

            w = resample_to_16k(ensure_mono_f32(wave), sample_rate)
            if w.size == 0:
                return None

            windows = self._select_windows(w, max_windows, prefer=prefer)
            if not windows:
                return None

            batch = np.stack([self._pad_to_window(win) for _, win in windows])
            t0 = time.perf_counter()
            with torch.no_grad():
                _, logits = self.model(torch.from_numpy(batch))
            latency_ms = (time.perf_counter() - t0) * 1000.0

            logits = np.asarray(logits, dtype=np.float64)
            # softmax over the 2 classes; column 0 = spoof (synthetic)
            shifted = logits - logits.max(axis=1, keepdims=True)
            exp = np.exp(shifted)
            probs = exp / exp.sum(axis=1, keepdims=True)
            p_spoof = probs[:, 0]

            return {
                "available": True,
                "evidence": float(np.clip(p_spoof.mean(), 0.0, 1.0)),
                "window_scores": [round(float(p), 4) for p in p_spoof],
                "window_starts_sec": [
                    round(s / INPUT_SAMPLE_RATE, 2) for s, _ in windows
                ],
                "window_std": float(np.clip(p_spoof.std(), 0.0, 1.0)),
                "raw_protocol_scores": [round(float(v), 4) for v in logits[:, 1]],
                "latency_ms": round(latency_ms, 2),
                "model": "AASIST-L",
                "model_version": "pretrained-1.0.0",
                "score_semantics": "uncalibrated softmax evidence",
            }
        except Exception:  # noqa: BLE001 — failure must not become fake data
            import logging

            logging.getLogger("xmux").exception(
                "AASIST-L predict failed; returning unavailable"
            )
            return None

    # -------------------------------------------------------------- helpers
    @staticmethod
    def _select_windows(w: np.ndarray, max_windows: int,
                        prefer: str = "evenly"
                        ) -> list[tuple[int, np.ndarray]]:
        """Analysis windows: evenly spaced for uploads, latest for live."""
        n = w.size
        if n <= WINDOW_SAMPLES:
            return [(0, w)]
        if prefer == "latest":
            return [(n - WINDOW_SAMPLES, w[-WINDOW_SAMPLES:])]
        count = min(max_windows, n // WINDOW_SAMPLES)
        if count <= 1:
            return [(0, w[:WINDOW_SAMPLES])]
        starts = np.linspace(0, n - WINDOW_SAMPLES, count).astype(int)
        return [(int(s), w[s : s + WINDOW_SAMPLES]) for s in starts]

    @staticmethod
    def _pad_to_window(x: np.ndarray) -> np.ndarray:
        """Replicates the official eval ``pad()``: tile-repeat short audio."""
        if x.size >= WINDOW_SAMPLES:
            return x[:WINDOW_SAMPLES]
        reps = int(WINDOW_SAMPLES / x.size) + 1
        return np.tile(x, reps)[:WINDOW_SAMPLES]
