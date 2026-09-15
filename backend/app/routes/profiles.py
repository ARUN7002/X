"""Voice profile enrollment API (speaker verification references)."""

from __future__ import annotations

import time
from typing import Any

from fastapi import APIRouter, File, Form, HTTPException, UploadFile

from .. import db
from ..audio import AudioValidationError, decode_file, save_upload
from ..models import registry

router = APIRouter()

MIN_ENROLL_SEC = 3.0
MAX_ENROLL_SEC = 60.0


@router.get("/profiles")
def list_profiles() -> dict:
    return {"profiles": db.list_profiles()}


@router.post("/profiles")
async def enroll(
    file: UploadFile = File(...),
    name: str = Form("Voice Profile"),
) -> dict[str, Any]:
    name = (name or "Voice Profile").strip()[:80] or "Voice Profile"

    if not registry.ecapa.available():
        raise HTTPException(
            status_code=503,
            detail="Speaker verification model unavailable on this host",
        )

    try:
        content = await file.read()
        stored = save_upload(content, file.filename)
        decoded = decode_file(stored)
    except AudioValidationError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=400, detail="invalid audio file") from exc

    if decoded.duration_sec < MIN_ENROLL_SEC:
        raise HTTPException(
            status_code=400,
            detail=(f"enrollment audio too short "
                    f"({decoded.duration_sec:.1f} s, minimum {MIN_ENROLL_SEC:.0f} s)"),
        )
    if decoded.duration_sec > MAX_ENROLL_SEC:
        raise HTTPException(
            status_code=400,
            detail=f"enrollment audio too long (maximum {MAX_ENROLL_SEC:.0f} s)",
        )

    embedding = registry.ecapa.embed(decoded.wave, decoded.sample_rate)
    if embedding is None:
        raise HTTPException(
            status_code=422,
            detail="could not extract a speaker embedding from this audio",
        )

    import json

    profile_id = db.new_id("vp")
    db.insert_profile({
        "id": profile_id,
        "name": name,
        "model": "ECAPA-TDNN pretrained-1.0.0",
        "embedding_json": json.dumps([round(float(v), 6) for v in embedding]),
        "sample_count": 1,
        "duration_sec": decoded.duration_sec,
        "created_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
    })
    return {
        "id": profile_id,
        "name": name,
        "model": "ECAPA-TDNN pretrained-1.0.0",
        "sample_count": 1,
        "duration_sec": decoded.duration_sec,
        "created_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
    }


@router.delete("/profiles/{profile_id}")
def delete_profile(profile_id: str) -> dict:
    if not db.delete_profile(profile_id):
        raise HTTPException(status_code=404, detail="profile not found")
    return {"deleted": profile_id}
