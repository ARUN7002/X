"""POST /api/analyze — upload & microphone clip analysis (spec PART 26)."""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, File, Form, HTTPException, UploadFile

from ..analysis import run_full_analysis
from ..audio import AudioValidationError, decode_file, save_upload

router = APIRouter()


@router.post("/analyze")
async def analyze(
    file: UploadFile = File(...),
    source: str = Form("UPLOAD"),
    profileId: str | None = Form(None),
) -> dict[str, Any]:
    if source not in ("UPLOAD", "MICROPHONE"):
        source = "UPLOAD"
    label = file.filename or "audio"

    try:
        content = await file.read()
        if not content:
            raise AudioValidationError("empty file")
        stored = save_upload(content, file.filename)
        decoded = decode_file(stored)
    except AudioValidationError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=400, detail="invalid audio file") from exc

    result = run_full_analysis(
        wave=decoded.wave,
        sample_rate=decoded.sample_rate,
        source=source,
        label=label,
        profile_id=profileId,
    )
    return result
