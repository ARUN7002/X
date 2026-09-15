"""X-MUX backend configuration.

All deployment-specific values come from environment variables (spec PART 33).
Nothing here is a secret. Model paths are backend-side only and are never
exposed verbatim to normal users (only safe metadata leaves this process).
"""

from __future__ import annotations

import os
from pathlib import Path

from pydantic_settings import BaseSettings

BACKEND_DIR = Path(__file__).resolve().parent.parent


class Settings(BaseSettings):
    """Environment-driven configuration with truthful, boring defaults."""

    # Backend listening port (deployment provider may override).
    xmux_port: int = 8765

    # Backend-side SQLite database (persistent on a long-running host).
    xmux_db: str = str(BACKEND_DIR / "data" / "xmux.db")

    # Active AASIST-L checkpoint (replaceable with a future fine-tuned
    # X-MUX AASIST-L artifact without touching the API contract).
    xmux_aasist_model_path: str = str(BACKEND_DIR / "models" / "AASIST-L.pth")

    # Where speechbrain / silero artifacts are cached.
    xmux_models_dir: str = str(BACKEND_DIR / "models")

    # Temporary processing directory (transient audio, auto-cleaned).
    xmux_tmp: str = "/tmp/xmux"

    # Comma-separated allowed frontend origins for CORS (HTTP + Socket.IO).
    # Empty in local development permits any origin; production MUST set this.
    xmux_allowed_origins: str = ""

    # Upload limits / validation bounds (spec PART 43).
    xmux_max_upload_mb: int = 25
    xmux_min_duration_sec: float = 0.5
    xmux_max_duration_sec: float = 120.0

    # Operational policy defaults. These are *policy* thresholds, not claimed
    # validated EER operating points; they are configurable via /api/settings.
    risk_warn: float = 0.35
    risk_high: float = 0.65
    speaker_threshold: float = 0.25

    # Environment marker ("development" relaxes CORS to any origin).
    xmux_env: str = "development"

    class Config:
        env_file = None  # environment only; no .env parsing surprises


settings = Settings()

# Allowed audio extensions for upload validation (decode via ffmpeg).
ALLOWED_AUDIO_EXTENSIONS = {
    ".wav", ".wave", ".mp3", ".flac", ".ogg", ".oga", ".m4a",
    ".mp4", ".webm", ".aac", ".opus", ".wma", ".aiff", ".aif",
}


def allowed_origins_list() -> list[str]:
    """Parse XMUX_ALLOWED_ORIGINS; empty list means 'dev: allow any'."""
    raw = [o.strip() for o in settings.xmux_allowed_origins.split(",")]
    return [o for o in raw if o]


def cors_origins() -> list[str] | None:
    """Origins for CORS middleware. None => allow any (development only).

    In production XMUX_ALLOWED_ORIGINS must list the Vercel frontend origin
    (spec PART 41: never '*' in production without documented reason).
    """
    origins = allowed_origins_list()
    if origins:
        return origins
    if settings.xmux_env.lower() == "production":
        # Fail closed-ish: no origins configured in production -> only same-host.
        return []
    return None  # development: allow any


def ensure_dirs() -> None:
    """Create runtime directories."""
    Path(settings.xmux_db).parent.mkdir(parents=True, exist_ok=True)
    Path(settings.xmux_models_dir).mkdir(parents=True, exist_ok=True)
    Path(settings.xmux_tmp).mkdir(parents=True, exist_ok=True)
