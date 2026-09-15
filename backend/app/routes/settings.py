"""Settings API — server-side policy + safe model configuration view."""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter
from pydantic import BaseModel

from .. import db
from ..models import registry

router = APIRouter()


class PolicyPatch(BaseModel):
    risk_warn: float | None = None
    risk_high: float | None = None
    speaker_threshold: float | None = None
    raw_audio_retention: bool | None = None
    retention_days: int | None = None
    notifications_enabled: bool | None = None


@router.get("/settings")
def get_settings() -> dict[str, Any]:
    return {
        "policy": db.get_policy(),
        "models": registry.models_payload(),
    }


@router.put("/settings")
def put_settings(patch: PolicyPatch) -> dict[str, Any]:
    data = patch.model_dump(exclude_none=True)
    # validate ranges
    if "risk_warn" in data:
        data["risk_warn"] = max(0.05, min(0.95, float(data["risk_warn"])))
    if "risk_high" in data:
        data["risk_high"] = max(0.10, min(0.99, float(data["risk_high"])))
    if "risk_warn" in data and "risk_high" in data and \
            data["risk_high"] <= data["risk_warn"]:
        raise ValueError("risk_high must be greater than risk_warn")
    if "speaker_threshold" in data:
        data["speaker_threshold"] = max(-1.0, min(1.0, data["speaker_threshold"]))
    if "retention_days" in data:
        data["retention_days"] = max(1, min(3650, int(data["retention_days"])))
    policy = db.save_policy(data)
    return {"policy": policy}
