"""Real inference verification test for X-MUX backend models.

Generates test audio, loads all three models, and runs REAL inference:
- Silero VAD on a tone + noise burst
- AASIST-L on a 4 s chirp (must produce logits shape (1,2))
- ECAPA on noise (must produce a 192-dim embedding)

This is a development verification script, not a unit test suite.
"""

import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import numpy as np


def main() -> None:
    print("=== X-MUX real inference verification ===\n")

    sr = 16000
    # deterministic probe: speech-band chirp + amplitude envelope
    t = np.arange(int(sr * 4.04)) / sr
    envelope = 0.5 * (1 + np.sin(2 * np.pi * 0.7 * t))
    chirp = 0.3 * np.sin(2 * np.pi * (150 + 120 * t) * t) * envelope
    noise = 0.02 * np.random.default_rng(42).standard_normal(chirp.shape)
    probe = (chirp + noise).astype(np.float32)

    # silence probe for VAD
    silence = np.zeros(sr, dtype=np.float32)

    # ---- Silero VAD ------------------------------------------------------
    print("[1/3] Silero VAD...")
    from app.models.vad import SileroVAD

    vad = SileroVAD()
    vad.load()
    print("   state:", vad.state.value, "| note:", vad.error_note)
    if vad.available():
        r_probe = vad.analyze(probe, sr)
        r_sil = vad.analyze(silence, sr)
        print("   probe:", r_probe)
        print("   silence:", r_sil)
    print()

    # ---- AASIST-L --------------------------------------------------------
    print("[2/3] AASIST-L...")
    from app.models.aasist import AASISTDetector

    aasist = AASISTDetector()
    t0 = time.perf_counter()
    aasist.load()
    load_s = time.perf_counter() - t0
    print(f"   load time: {load_s:.2f}s | state: {aasist.state.value} | note: {aasist.error_note}")
    info = aasist.info()
    print("   sha256:", (info.sha256 or "")[:16], "…")
    print("   self-test latency:", info.self_test_latency_ms, "ms")
    if aasist.available():
        t0 = time.perf_counter()
        result = aasist.predict(probe, sr)
        dt = (time.perf_counter() - t0) * 1000
        print(f"   predict: {result} | {dt:.0f}ms")
        # also test short input (tile-padding path)
        short = aasist.predict(probe[: sr * 2], sr)
        print("   short (2s) input evidence:", short["evidence"] if short else None)
    print()

    # ---- ECAPA -----------------------------------------------------------
    print("[3/3] ECAPA-TDNN...")
    from app.models.ecapa import ECAPASpeakerVerifier

    ecapa = ECAPASpeakerVerifier()
    t0 = time.perf_counter()
    ecapa.load()
    load_s = time.perf_counter() - t0
    print(f"   load time: {load_s:.2f}s | state: {ecapa.state.value} | note: {ecapa.error_note}")
    if ecapa.available():
        emb = ecapa.embed(probe, sr)
        print("   embedding dim:", emb.shape if emb is not None else None)
        if emb is not None:
            sim_same = ecapa.similarity(probe, emb, sr)
            print("   self-similarity (should be ~1.0):", sim_same)
    print()

    print("=== verification complete ===")


if __name__ == "__main__":
    main()
