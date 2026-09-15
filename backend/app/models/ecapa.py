"""ECAPA-TDNN speaker verification (speechbrain/spkrec-ecapa-voxceleb).

Verified contract:
- Model: speechbrain/spkrec-ecapa-voxceleb (public HuggingFace, no token).
- Input: 16 kHz mono waveform (float32); internally normalized by the
  speechbrain encoder.
- Output: 192-dimensional L2-normalized speaker embedding. Speaker
  similarity between two utterances = cosine similarity of embeddings.
- ECAPA similarity is NOT synthetic probability; it only speaks to
  whether the voice matches a reference profile.
"""

from __future__ import annotations

import time
from typing import Any

import numpy as np

from ..config import settings
from .base import MLComponent, ModelInfo, ensure_mono_f32


class ECAPASpeakerVerifier(MLComponent):
    component_name = "speaker_verification"

    EMBEDDING_DIM = 192

    def __init__(self) -> None:
        super().__init__()
        self.model = None
        self.device = "cpu"
        self._self_test_latency_ms: float | None = None

    # ------------------------------------------------------------- lifecycle
    def load(self) -> None:
        self._mark_loading()
        try:
            import torch
            from pathlib import Path
            # speechbrain moved the module between versions — support both
            try:
                from speechbrain.inference.speakers import EncoderClassifier
            except ImportError:
                from speechbrain.inference.speaker import EncoderClassifier

            savedir = str(Path(settings.xmux_models_dir) / "ecapa")
            model = EncoderClassifier.from_hparams(
                source="speechbrain/spkrec-ecapa-voxceleb",
                savedir=savedir,
                run_opts={"device": self.device},
            )

            # Real self-test: embed a deterministic probe waveform.
            probe = np.linspace(-0.02, 0.02, 16000, dtype=np.float32)
            t0 = time.perf_counter()
            emb = model.encode_batch(
                torch.from_numpy(probe).unsqueeze(0)
            ).squeeze().cpu().numpy()
            latency_ms = (time.perf_counter() - t0) * 1000.0
            if emb.shape != (self.EMBEDDING_DIM,) or not np.isfinite(emb).all():
                self._mark_error("speaker model self-test failed")
                return

            self.model = model
            self._self_test_latency_ms = round(latency_ms, 2)
            self._mark_ready()
        except ImportError as exc:
            self._mark_unavailable(
                f"speaker verification runtime not installed ({exc.name})"
            )
        except Exception as exc:  # noqa: BLE001
            self._mark_error(f"speaker model failed to load: {type(exc).__name__}")

    # ----------------------------------------------------------------- info
    def info(self) -> ModelInfo:
        return ModelInfo(
            component=self.component_name,
            model_name="ECAPA-TDNN",
            model_family="speechbrain spkrec-ecapa-voxceleb",
            model_version="pretrained-1.0.0",
            checkpoint_identifier="spkrec-ecapa-voxceleb",
            output_semantics=(
                "192-dim L2-normalized speaker embedding; profile similarity "
                "is cosine similarity (1 = same voice, 0 = unrelated, "
                "negative = dissimilar)"
            ),
            source="speechbrain/spkrec-ecapa-voxceleb (HuggingFace, public)",
            loaded=self.available(),
            inference_ready=self.available(),
            input_sample_rate=16000,
            input_window="variable (>= 1 s recommended)",
            device=self.device if self.available() else None,
            self_test_latency_ms=self._self_test_latency_ms,
            note=self.error_note,
        )

    # ---------------------------------------------------------------- embed
    def embed(self, wave: np.ndarray, sample_rate: int = 16000
              ) -> np.ndarray | None:
        """Return the embedding, or None when unavailable/invalid."""
        if not self.available() or self.model is None:
            return None
        try:
            import torch

            from .base import resample_to_16k

            w = resample_to_16k(ensure_mono_f32(wave), sample_rate)
            if w.size < 1600:  # < 100 ms — not enough signal to embed
                return None
            with torch.no_grad():
                emb = self.model.encode_batch(
                    torch.from_numpy(w).unsqueeze(0)
                ).squeeze().cpu().numpy()
            emb = np.asarray(emb, dtype=np.float64).ravel()
            if emb.size != self.EMBEDDING_DIM or not np.isfinite(emb).all():
                return None
            norm = np.linalg.norm(emb)
            if norm <= 0:
                return None
            return emb / norm
        except Exception:  # noqa: BLE001
            return None

    def similarity(self, wave: np.ndarray, reference: np.ndarray,
                   sample_rate: int = 16000) -> dict[str, Any] | None:
        """Cosine similarity against a stored reference embedding."""
        emb = self.embed(wave, sample_rate)
        if emb is None or reference is None:
            return None
        ref = np.asarray(reference, dtype=np.float64).ravel()
        if ref.size != emb.size:
            return None
        ref_norm = np.linalg.norm(ref)
        if ref_norm <= 0:
            return None
        t0 = time.perf_counter()
        cos = float(np.dot(emb, ref / ref_norm))
        return {
            "available": True,
            "similarity": float(np.clip(cos, -1.0, 1.0)),
            "model": "ECAPA-TDNN",
            "model_version": "pretrained-1.0.0",
            "latency_ms": round((time.perf_counter() - t0) * 1000.0, 2),
        }
