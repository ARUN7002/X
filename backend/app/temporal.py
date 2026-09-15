"""Temporal analysis for live monitoring (spec PART 18).

R_t = f(synthetic evidence, speaker consistency, quality, previous risk)

- EWMA smoothing keeps the trend stable without hiding transitions.
- Hysteresis prevents constant state switching: a state must persist for
  N consecutive windows before transitions, and alerts fire only on
  meaningful transitions (never every few seconds).
"""

from __future__ import annotations

from typing import Any

from .fusion import _clamp

EWMA_ALPHA = 0.35          # smoothing strength
ENTER_PERSISTENCE = 2      # windows required to enter a worse state
EXIT_PERSISTENCE = 4       # windows required to leave for a better state

STATES = ["MONITORING", "SUSPICIOUS", "HIGH_RISK", "INTERVENTION"]

STATE_LABELS = {
    "MONITORING": "Monitoring",
    "SUSPICIOUS": "Suspicious",
    "HIGH_RISK": "High Risk",
    "INTERVENTION": "Intervention",
}

STATE_ACTIONS = {
    "MONITORING": "ALLOW",
    "SUSPICIOUS": "WARN",
    "HIGH_RISK": "VERIFY",
    "INTERVENTION": "BLOCK",
}


class TemporalRiskEngine:
    """Per-session temporal state machine."""

    def __init__(self, policy: dict[str, Any]) -> None:
        self.policy = policy
        self.ewma: float | None = None
        self.state = "MONITORING"
        self._candidate: str | None = None
        self._candidate_count = 0
        self.window_count = 0
        self.trend: list[float] = []

    def update(self, risk: float | None, confidence: float,
               speech_status: str) -> dict[str, Any]:
        """Feed one analysis window; returns the temporal decision."""
        self.window_count += 1

        if risk is None:
            # no decision this window (model unavailable / inconclusive)
            return self._emit(speech_status, risk=None, decided=False)

        # EWMA over per-window risk
        if self.ewma is None:
            self.ewma = risk
        else:
            self.ewma = EWMA_ALPHA * risk + (1 - EWMA_ALPHA) * self.ewma
        self.trend.append(round(self.ewma, 3))
        if len(self.trend) > 240:  # keep ~4 min of 1 Hz windows
            self.trend = self.trend[-240:]

        target = self._target_state()
        self._transition(target)
        return self._emit(speech_status, risk=round(self.ewma, 3), decided=True)

    # ------------------------------------------------------------------
    def _target_state(self) -> str:
        r = self.ewma if self.ewma is not None else 0.0
        warn = float(self.policy.get("risk_warn", 0.35))
        high = float(self.policy.get("risk_high", 0.65))
        if r >= 0.85:
            return "INTERVENTION"
        if r >= high:
            return "HIGH_RISK"
        if r >= warn:
            return "SUSPICIOUS"
        return "MONITORING"

    def _transition(self, target: str) -> None:
        current_idx = STATES.index(self.state)
        target_idx = STATES.index(target)
        if target == self.state:
            self._candidate = None
            self._candidate_count = 0
            return
        if target_idx > current_idx:
            # escalate quickly
            persistence = ENTER_PERSISTENCE
        else:
            # de-escalate slowly (hysteresis)
            persistence = EXIT_PERSISTENCE
        if self._candidate == target:
            self._candidate_count += 1
        else:
            self._candidate = target
            self._candidate_count = 1
        if self._candidate_count >= persistence:
            self.state = target
            self._candidate = None
            self._candidate_count = 0

    def _emit(self, speech_status: str, risk: float | None,
              decided: bool) -> dict[str, Any]:
        return {
            "state": self.state,
            "state_label": STATE_LABELS[self.state],
            "action": STATE_ACTIONS[self.state],
            "risk": risk,
            "decided": decided,
            "speech_status": speech_status,
            "window_count": self.window_count,
        }
