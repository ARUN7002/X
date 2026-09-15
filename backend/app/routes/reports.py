"""Reports API (spec PART 44) — actual stored analyses, never fabricated."""

from __future__ import annotations

from fastapi import APIRouter, HTTPException

from .. import db

router = APIRouter()


@router.get("/reports")
def list_reports(limit: int = 50) -> dict:
    limit = max(1, min(limit, 200))
    return {"reports": db.list_analyses(limit)}


@router.get("/reports/{analysis_id}")
def get_report(analysis_id: str) -> dict:
    report = db.get_analysis(analysis_id)
    if report is None:
        raise HTTPException(status_code=404, detail="report not found")
    return report


@router.delete("/reports/{analysis_id}")
def delete_report(analysis_id: str) -> dict:
    if not db.delete_analysis(analysis_id):
        raise HTTPException(status_code=404, detail="report not found")
    return {"deleted": analysis_id}
