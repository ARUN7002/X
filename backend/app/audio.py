"""Audio validation, decoding and standardization (spec PART 43).

Every upload is treated as untrusted input:
- extension allow-list (defense in depth; ffmpeg does the real check)
- hard size limit enforced while streaming to disk
- decoding happens on a generated storage id — user filenames are never
  used as paths (no path traversal surface)
- decode failures return a clean 400-level error, never a stack trace
"""

from __future__ import annotations

import subprocess
import uuid
from dataclasses import dataclass
from pathlib import Path

import numpy as np
import soundfile as sf

from .config import ALLOWED_AUDIO_EXTENSIONS, settings


class AudioValidationError(ValueError):
    """User-safe validation error (message may be shown to the user)."""


@dataclass
class DecodedAudio:
    wave: np.ndarray        # float32 mono
    sample_rate: int        # always 16000
    duration_sec: float
    source_format: str
    original_sample_rate: int | None


def _extension_ok(filename: str | None) -> bool:
    if not filename:
        return False
    ext = Path(filename).suffix.lower()
    return ext in ALLOWED_AUDIO_EXTENSIONS


def save_upload(content: bytes, filename: str | None) -> Path:
    """Stream bytes into XMUX_TMP under a generated id."""
    max_bytes = settings.xmux_max_upload_mb * 1024 * 1024
    if len(content) > max_bytes:
        raise AudioValidationError(
            f"file exceeds the {settings.xmux_max_upload_mb} MB limit"
        )
    if not _extension_ok(filename):
        raise AudioValidationError(
            "unsupported audio format (expected wav, mp3, flac, ogg, m4a, "
            "webm, aac, opus, wma or aiff)"
        )
    ext = Path(filename).suffix.lower()
    storage_id = f"{uuid.uuid4().hex}{ext}"
    dest = Path(settings.xmux_tmp) / storage_id
    dest.write_bytes(content)
    return dest


def decode_file(path: Path) -> DecodedAudio:
    """Decode any supported input to 16 kHz mono float32 via ffmpeg."""
    try:
        probe = subprocess.run(
            ["ffmpeg", "-hide_banner", "-i", str(path)],
            capture_output=True, text=True, timeout=30,
        )
        stderr = probe.stderr or ""
    except FileNotFoundError as exc:
        raise AudioValidationError("audio decoder unavailable") from exc

    # ffmpeg writes stream info on stderr when no output file is given
    if "Audio:" not in stderr:
        raise AudioValidationError("file does not contain an audio stream")
    if "192k" in stderr and "flac" in stderr.lower():
        pass  # nothing to infer — real checks happen during decode

    out_path = path.with_suffix(".dec.wav")
    try:
        result = subprocess.run(
            [
                "ffmpeg", "-hide_banner", "-loglevel", "error", "-y",
                "-i", str(path),
                "-ac", "1", "-ar", "16000", "-f", "wav",
                "-acodec", "pcm_f32le", str(out_path),
            ],
            capture_output=True, timeout=60,
        )
        if result.returncode != 0 or not out_path.exists():
            raise AudioValidationError("audio could not be decoded")
        wave, sr = sf.read(str(out_path), dtype="float32")
    except subprocess.TimeoutExpired as exc:
        raise AudioValidationError("audio decoding timed out") from exc
    except sf.LibsndfileError as exc:
        raise AudioValidationError("audio could not be decoded") from exc
    finally:
        try:
            out_path.unlink(missing_ok=True)
        except OSError:
            pass

    wave = np.asarray(wave, dtype=np.float32).ravel()
    if wave.size == 0:
        raise AudioValidationError("audio contains no samples")

    duration = wave.size / float(sr)
    if duration < settings.xmux_min_duration_sec:
        raise AudioValidationError(
            f"audio too short (minimum {settings.xmux_min_duration_sec:.1f} s)"
        )
    if duration > settings.xmux_max_duration_sec:
        raise AudioValidationError(
            f"audio too long (maximum {int(settings.xmux_max_duration_sec)} s)"
        )

    # remember the original rate when ffmpeg reported it
    original_sr: int | None = None
    for line in stderr.splitlines():
        if "Audio:" in line and "Hz" in line:
            try:
                original_sr = int(line.split("Hz")[0].strip().split()[-1])
            except (ValueError, IndexError):
                original_sr = None
            break

    try:
        path.unlink(missing_ok=True)  # transient processing (spec PART 30)
    except OSError:
        pass

    return DecodedAudio(
        wave=wave,
        sample_rate=sr,
        duration_sec=round(duration, 3),
        source_format=path.suffix.lower().lstrip("."),
        original_sample_rate=original_sr,
    )
