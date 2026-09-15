"""X-MUX model abstraction (spec PART 3).

Every ML component implements the same lifecycle so a future fine-tuned
X-MUX AASIST-L checkpoint can replace the pretrained one by changing ONLY
the checkpoint path / model artifact — never the API contract.

Rules enforced across all components:
- If a model fails to load, its state is UNAVAILABLE (or ERROR) and no
  scores are produced. Never fabricate a fallback score.
- metadata() exposes safe, verified facts (sha256, input contract, output
  semantics). Filesystem paths stay backend-side.
"""

from __future__ import annotations

import abc
import hashlib
import threading
import time
from dataclasses import dataclass, field
from enum import Enum
from typing import Any

import numpy as np


class ComponentState(str, Enum):
    READY = "READY"
    DEGRADED = "DEGRADED"
    UNAVAILABLE = "UNAVAILABLE"
    ERROR = "ERROR"


def sha256_of_file(path: str, chunk_size: int = 1 << 20) -> str | None:
    """Hash a model artifact for registry/versioning purposes."""
    try:
        h = hashlib.sha256()
        with open(path, "rb") as f:
            while True:
                chunk = f.read(chunk_size)
                if not chunk:
                    break
                h.update(chunk)
        return h.hexdigest()
    except Exception:
        return None


@dataclass
class ModelInfo:
    """Safe model metadata (no filesystem paths, no secrets)."""

    component: str
    model_name: str
    model_family: str
    model_version: str
    checkpoint_identifier: str
    output_semantics: str
    source: str
    loaded: bool = False
    inference_ready: bool = False
    sha256: str | None = None
    input_sample_rate: int | None = None
    input_window: str | None = None
    device: str | None = None
    self_test_latency_ms: float | None = None
    note: str | None = None
    extra: dict[str, Any] = field(default_factory=dict)

    def public(self) -> dict[str, Any]:
        """The shape exposed through /api/models and technical evidence."""
        return {
            "component": self.component,
            "model_name": self.model_name,
            "model_family": self.model_family,
            "model_version": self.model_version,
            "checkpoint_identifier": self.checkpoint_identifier,
            "sha256": self.sha256,
            "input_sample_rate": self.input_sample_rate,
            "input_window": self.input_window,
            "output_semantics": self.output_semantics,
            "source": self.source,
            "loaded": self.loaded,
            "inference_ready": self.inference_ready,
            "device": self.device,
            "note": self.note,
        }


class MLComponent(abc.ABC):
    """Base lifecycle for every ML component in X-MUX."""

    component_name: str = "component"

    def __init__(self) -> None:
        self._lock = threading.Lock()
        self.state: ComponentState = ComponentState.UNAVAILABLE
        self.error_note: str | None = None
        self.loaded_at: float | None = None

    # ------------------------------------------------------------------ API
    @abc.abstractmethod
    def load(self) -> None:
        """Load model artifacts. Must set self.state truthfully."""

    @abc.abstractmethod
    def info(self) -> ModelInfo:
        """Return safe metadata for registries and health."""

    def health(self) -> dict[str, Any]:
        return {
            "component": self.component_name,
            "state": self.state.value,
            "note": self.error_note,
        }

    def available(self) -> bool:
        return self.state == ComponentState.READY

    # -------------------------------------------------------------- helpers
    def _mark_loading(self) -> None:
        self.state = ComponentState.UNAVAILABLE
        self.error_note = "initializing"

    def _mark_ready(self) -> None:
        self.state = ComponentState.READY
        self.error_note = None
        self.loaded_at = time.time()

    def _mark_unavailable(self, note: str) -> None:
        self.state = ComponentState.UNAVAILABLE
        self.error_note = note

    def _mark_error(self, note: str) -> None:
        self.state = ComponentState.ERROR
        self.error_note = note


def ensure_mono_f32(wave: np.ndarray) -> np.ndarray:
    """Coerce arbitrary waveform array to float32 mono."""
    w = np.asarray(wave, dtype=np.float32)
    if w.ndim == 2:
        if w.shape[0] < w.shape[1]:
            w = w.mean(axis=0)
        else:
            w = w.mean(axis=1)
    return np.ascontiguousarray(w.ravel())


def resample_to_16k(wave: np.ndarray, sr: int) -> np.ndarray:
    """Real resampling (polyphase) when the source rate differs from 16 kHz."""
    if sr == 16000 or sr <= 0 or wave.size == 0:
        return ensure_mono_f32(wave)
    try:
        from scipy.signal import resample_poly

        gcd = np.gcd(int(sr), 16000)
        return ensure_mono_f32(
            resample_poly(ensure_mono_f32(wave), 16000 // gcd, int(sr) // gcd)
        )
    except Exception:
        # Naive linear fallback — still a real transform, not a fake score.
        n_out = int(round(wave.size * 16000.0 / sr))
        x = np.linspace(0.0, wave.size - 1, n_out)
        return ensure_mono_f32(np.interp(x, np.arange(wave.size), wave.ravel()))
