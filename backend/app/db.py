"""Backend-side SQLite persistence (spec PART 31).

SQLite lives with the long-running Python backend and is never treated as
Vercel storage. Only analysis results, derived embeddings, events and policy
settings are stored — raw audio is processed transiently and is NOT persisted
unless an explicit retention policy is enabled by the administrator.
"""

from __future__ import annotations

import json
import sqlite3
import threading
import time
import uuid
from pathlib import Path
from typing import Any

from .config import settings

_lock = threading.Lock()
_conn: sqlite3.Connection | None = None


def _now() -> str:
    return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())


def new_id(prefix: str) -> str:
    return f"{prefix}_{uuid.uuid4().hex[:16]}"


def get_db() -> sqlite3.Connection:
    global _conn
    with _lock:
        if _conn is None:
            Path(settings.xmux_db).parent.mkdir(parents=True, exist_ok=True)
            _conn = sqlite3.connect(settings.xmux_db, check_same_thread=False)
            _conn.row_factory = sqlite3.Row
            _conn.execute("PRAGMA journal_mode=WAL")
            _init_schema(_conn)
        return _conn


def _init_schema(conn: sqlite3.Connection) -> None:
    conn.executescript(
        """
        CREATE TABLE IF NOT EXISTS analyses (
            id TEXT PRIMARY KEY,
            session_id TEXT,
            source TEXT NOT NULL,
            label TEXT,
            status TEXT NOT NULL,
            duration_sec REAL,
            sample_rate INTEGER,
            synthetic_evidence REAL,
            speaker_similarity REAL,
            audio_quality REAL,
            confidence REAL,
            risk_score REAL,
            verdict TEXT,
            recommended_action TEXT,
            model_version TEXT,
            evidence_json TEXT,
            created_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_analyses_created ON analyses(created_at DESC);

        CREATE TABLE IF NOT EXISTS voice_profiles (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            model TEXT NOT NULL,
            embedding_json TEXT NOT NULL,
            sample_count INTEGER DEFAULT 1,
            duration_sec REAL DEFAULT 0,
            created_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS events (
            id TEXT PRIMARY KEY,
            session_id TEXT,
            type TEXT NOT NULL,
            message TEXT NOT NULL,
            data_json TEXT,
            created_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_events_created ON events(created_at DESC);

        CREATE TABLE IF NOT EXISTS app_settings (
            key TEXT PRIMARY KEY,
            value_json TEXT NOT NULL,
            updated_at TEXT NOT NULL
        );
        """
    )
    conn.commit()


def ping() -> bool:
    try:
        conn = get_db()
        with _lock:
            conn.execute("SELECT 1")
        return True
    except Exception:
        return False


# ---------------------------------------------------------------- analyses

def insert_analysis(row: dict[str, Any]) -> None:
    conn = get_db()
    with _lock:
        conn.execute(
            """INSERT INTO analyses (
                id, session_id, source, label, status, duration_sec, sample_rate,
                synthetic_evidence, speaker_similarity, audio_quality, confidence,
                risk_score, verdict, recommended_action, model_version,
                evidence_json, created_at
            ) VALUES (:id, :session_id, :source, :label, :status, :duration_sec,
                :sample_rate, :synthetic_evidence, :speaker_similarity, :audio_quality,
                :confidence, :risk_score, :verdict, :recommended_action, :model_version,
                :evidence_json, :created_at)""",
            row,
        )
        conn.commit()


def list_analyses(limit: int = 50) -> list[dict[str, Any]]:
    conn = get_db()
    with _lock:
        rows = conn.execute(
            """SELECT id, session_id, source, label, status, duration_sec,
                      synthetic_evidence, speaker_similarity, audio_quality,
                      confidence, risk_score, verdict, recommended_action,
                      model_version, created_at
               FROM analyses ORDER BY created_at DESC LIMIT ?""",
            (limit,),
        ).fetchall()
    return [dict(r) for r in rows]


def get_analysis(analysis_id: str) -> dict[str, Any] | None:
    """Return the FULL stored analysis (the evidence_json payload is the
    complete AnalysisResult captured at analysis time)."""
    conn = get_db()
    with _lock:
        row = conn.execute(
            "SELECT evidence_json FROM analyses WHERE id = ?", (analysis_id,)
        ).fetchone()
    if row is None or not row["evidence_json"]:
        return None
    try:
        evidence = json.loads(row["evidence_json"])
    except json.JSONDecodeError:
        return None
    evidence["id"] = analysis_id
    return evidence


def delete_analysis(analysis_id: str) -> bool:
    conn = get_db()
    with _lock:
        cur = conn.execute("DELETE FROM analyses WHERE id = ?", (analysis_id,))
        conn.commit()
    return cur.rowcount > 0


# ------------------------------------------------------------ voice profiles

def insert_profile(row: dict[str, Any]) -> None:
    conn = get_db()
    with _lock:
        conn.execute(
            """INSERT INTO voice_profiles (id, name, model, embedding_json,
                 sample_count, duration_sec, created_at)
               VALUES (:id, :name, :model, :embedding_json, :sample_count,
                 :duration_sec, :created_at)""",
            row,
        )
        conn.commit()


def list_profiles() -> list[dict[str, Any]]:
    conn = get_db()
    with _lock:
        rows = conn.execute(
            """SELECT id, name, model, sample_count, duration_sec, created_at
               FROM voice_profiles ORDER BY created_at DESC"""
        ).fetchall()
    return [dict(r) for r in rows]


def get_profile_embedding(profile_id: str) -> list[float] | None:
    conn = get_db()
    with _lock:
        row = conn.execute(
            "SELECT embedding_json FROM voice_profiles WHERE id = ?", (profile_id,)
        ).fetchone()
    if row is None:
        return None
    return json.loads(row["embedding_json"])


def delete_profile(profile_id: str) -> bool:
    conn = get_db()
    with _lock:
        cur = conn.execute("DELETE FROM voice_profiles WHERE id = ?", (profile_id,))
        conn.commit()
    return cur.rowcount > 0


# -------------------------------------------------------------------- events

def insert_event(event_type: str, message: str, session_id: str | None = None,
                 data: dict[str, Any] | None = None) -> None:
    conn = get_db()
    with _lock:
        conn.execute(
            """INSERT INTO events (id, session_id, type, message, data_json, created_at)
               VALUES (?, ?, ?, ?, ?, ?)""",
            (new_id("evt"), session_id, event_type, message,
             json.dumps(data) if data else None, _now()),
        )
        conn.commit()


def list_events(limit: int = 100) -> list[dict[str, Any]]:
    conn = get_db()
    with _lock:
        rows = conn.execute(
            "SELECT * FROM events ORDER BY created_at DESC LIMIT ?", (limit,)
        ).fetchall()
    out = []
    for r in rows:
        d = dict(r)
        d["data"] = json.loads(d.pop("data_json") or "null")
        out.append(d)
    return out


# ------------------------------------------------------------------ settings

DEFAULT_POLICY: dict[str, Any] = {
    # Operational policy thresholds (configurable; NOT validated EER points).
    "risk_warn": settings.risk_warn,
    "risk_high": settings.risk_high,
    "speaker_threshold": settings.speaker_threshold,
    # Privacy: raw audio is transient by default (spec PART 30).
    "raw_audio_retention": False,
    "retention_days": 30,
    "notifications_enabled": True,
}


def get_policy() -> dict[str, Any]:
    merged = dict(DEFAULT_POLICY)
    try:
        conn = get_db()
        with _lock:
            row = conn.execute(
                "SELECT value_json FROM app_settings WHERE key = 'policy'"
            ).fetchone()
        if row:
            merged.update(json.loads(row["value_json"]))
    except Exception:
        pass
    return merged


def save_policy(patch: dict[str, Any]) -> dict[str, Any]:
    current = get_policy()
    for key in DEFAULT_POLICY:
        if key in patch and patch[key] is not None:
            current[key] = patch[key]
    conn = get_db()
    with _lock:
        conn.execute(
            """INSERT INTO app_settings (key, value_json, updated_at)
               VALUES ('policy', ?, ?)
               ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json,
                                              updated_at = excluded.updated_at""",
            (json.dumps(current), _now()),
        )
        conn.commit()
    return current
