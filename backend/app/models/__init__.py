"""Model registry — the only place X-MUX components are constructed.

Loading happens in a background thread at startup so the API is
immediately available while models initialize. Health states remain
truthful (UNAVAILABLE while initializing; READY only after a real
self-test passes; ERROR on failure).
"""

from __future__ import annotations

import threading
from typing import Any

from .aasist import AASISTDetector
from .base import MLComponent, ModelInfo
from .ecapa import ECAPASpeakerVerifier
from .vad import SileroVAD


class ModelRegistry:
    def __init__(self) -> None:
        self.aasist = AASISTDetector()
        self.ecapa = ECAPASpeakerVerifier()
        self.vad = SileroVAD()
        self._started = False
        self._lock = threading.Lock()

    def start_background_load(self) -> None:
        with self._lock:
            if self._started:
                return
            self._started = True
        threading.Thread(target=self._load_all, daemon=True).start()

    def _load_all(self) -> None:
        # VAD first (tiny, unlocks gating), then AASIST, then ECAPA.
        for component in (self.vad, self.aasist, self.ecapa):
            try:
                component.load()
            except Exception:  # noqa: BLE001 — load() handles its own states
                pass

    def reload(self) -> None:
        """Re-load components (used when the active model path changes)."""
        for component in (self.vad, self.aasist, self.ecapa):
            try:
                component.load()
            except Exception:  # noqa: BLE001
                pass

    # ------------------------------------------------------------------ api
    def all_components(self) -> list[MLComponent]:
        return [self.aasist, self.ecapa, self.vad]

    def compute_health(self) -> dict[str, Any]:
        """Compute-agnostic health of every component."""
        components = {}
        for c in self.all_components():
            h = c.health()
            info = c.info()
            h["model"] = info.model_name
            components[h["component"]] = h
        return components

    def models_payload(self) -> list[dict[str, Any]]:
        return [c.info().public() for c in self.all_components()]

    def compute_info(self) -> dict[str, Any]:
        """Truthful compute report (spec PART 35)."""
        info: dict[str, Any] = {
            "device": "cpu",
            "gpu_available": False,
            "cuda_available": False,
            "gpu_name": None,
        }
        try:
            import torch

            info["pytorch_version"] = torch.__version__
            info["cuda_available"] = bool(torch.cuda.is_available())
            info["gpu_available"] = info["cuda_available"]
            if info["cuda_available"]:
                info["device"] = "cuda"
                info["gpu_name"] = torch.cuda.get_device_name(0)
            else:
                info["note"] = (
                    "CPU inference (no CUDA device visible to PyTorch). "
                    "GPU acceleration is not claimed."
                )
        except Exception:
            info["pytorch_version"] = None
            info["note"] = "ML runtime not installed on this host"
        return info


registry = ModelRegistry()
