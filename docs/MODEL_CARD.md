# X-MUX Model Card — Active Models

This card documents the models actually loaded by the X-MUX backend at the
time of writing. Every fact below was verified against the vendored code and
artifacts; nothing is projected or promised.

> X-MUX provides voice-integrity evidence to support security decisions. It
> does not replace human verification or guarantee detection.

---

## 1. AASIST-L (synthetic / spoof evidence) — ACTIVE

| Field | Value |
|---|---|
| Model name | AASIST-L |
| Version | `pretrained-1.0.0` |
| Component | `synthetic_detection` |
| Source | `clovaai/aasist` official pretrained checkpoint (ASVspoof 2019 LA) |
| Architecture | AASIST — end-to-end integrated spectro-temporal graph attention network (vendored in `backend/app/models/aasist_arch.py`) |
| Checkpoint | `backend/models/AASIST-L.pth`, 426,428 bytes |
| Checkpoint sha256 | `814331d088032bb4c3fa61cc014789eadeed464209dd094ab3a2dd6ffbdce27a` |
| License | MIT, Copyright (c) 2021-present NAVER Corp. — full text in [backend/AASIST_LICENSE](../backend/AASIST_LICENSE) |
| Device | CPU in the development sandbox (reported truthfully per host via `/api/health`) |

### Purpose

Produce **synthetic-speech / spoof evidence** — an indication of how the
model's ASVspoof-trained decision function responds to the audio. It is
X-MUX's only synthetic-detection signal. It is **not** a speaker-recognition
model and is never used as one.

### Input contract (verified from the official implementation)

- Raw float32 waveform, mono, **16 kHz**.
- Fixed window of **64,600 samples (~4.03 s)**.
- Shorter audio is tile-repeated to the window (the official evaluation
  padding rule); longer audio is windowed — uploads analyze up to 5 evenly
  spaced windows and aggregate; live analysis uses only the latest full
  window.

### Output contract (verified from the official implementation)

- `forward` returns `(last_hidden, logits)` with logits of shape **(B, 2)**.
- Training labels map **bonafide = column 1, spoof = column 0**. Therefore:
  - the official ASVspoof protocol score is `logits[:, 1]` (bonafide logit;
    higher = more genuine);
  - X-MUX **synthetic evidence** = `softmax(logits)[:, 0]` (spoof column).
- The softmax value is an **uncalibrated model score**. X-MUX has performed
  **no Platt or isotonic calibration** on it. It is surfaced as "Synthetic
  Evidence", never as a validated probability.

### Authors' published baseline (their measurement, not X-MUX's)

The AASIST repository reports, for this checkpoint on the ASVspoof 2019 LA
evaluation set: **EER 0.99 %, min t-DCF 0.0309**. These are the model
authors' published numbers and are cited for reference only. **X-MUX has run
no benchmark of its own and claims no accuracy figure.**

### Known limitations

- Trained on **ASVspoof 2019 LA** (logical-access vocoder attacks:
  waveform-filtering TTS/VC systems of that era). Generalization to
  modern/unseen neural TTS and voice-conversion systems is **unmeasured**
  in X-MUX.
- **Band-limited / degraded genuine audio can produce false positives.**
  During development, a genuine band-limited 1963 broadcast recording
  (64 kb/s MP3) scored synthetic evidence 0.995 — an observed false
  positive on a single sample (informal dev observation, not a benchmark).
  X-MUX consequently raises a `BAND_LIMITED` quality flag, reduces
  confidence and appends a caution note on such audio.
- Uncalibrated scores must not be read as probabilities.

### Intended use

- Producing voice-integrity **evidence** for security operators, alongside
  speaker similarity, quality and confidence signals.
- Supporting human verification workflows with structured reports and
  near-real-time live monitoring.

### Out-of-scope uses

- Any claim of detecting every AI voice or guaranteed detection.
- Stand-alone, unreviewed automated decisions (blocking, legal or forensic
  conclusions) without human verification.
- Speaker identification (use ECAPA-TDNN evidence instead).
- Interception of communications.

---

## 2. ECAPA-TDNN (speaker verification) — ACTIVE

| Field | Value |
|---|---|
| Model name | ECAPA-TDNN |
| Version | `pretrained-1.0.0` |
| Component | `speaker_verification` |
| Source | `speechbrain/spkrec-ecapa-voxceleb` (public HuggingFace; downloads on first start, cached under `XMUX_MODELS_DIR/ecapa`) |
| Input | 16 kHz mono waveform (≥ 1 s recommended; ≥ 100 ms enforced) |
| Output | **192-dimensional L2-normalized speaker embedding** |

### Purpose

Speaker **consistency** evidence: whether the analyzed voice matches an
enrolled reference profile. Similarity is **cosine similarity** between
embeddings (1 = same voice, 0 = unrelated, negative = dissimilar). A
similarity below the configured `speaker_threshold` (default 0.25) contributes
**speaker-mismatch risk** in fusion; the similarity itself is also shown in
reports.

### Important

ECAPA-TDNN is **not a synthetic-voice detector**. A perfect similarity score
says nothing about whether the voice is synthetic; it only speaks to voice
matching. Synthetic evidence comes exclusively from AASIST-L.

---

## 3. Silero VAD (speech activity) — ACTIVE

| Field | Value |
|---|---|
| Model name | Silero VAD |
| Version | `pretrained-1.0.0` |
| Component | `speech_activity` |
| Source | `silero-vad` PyPI package (bundled JIT artifact) |
| Input | 16 kHz mono, 512-sample frames (32 ms) |
| Output | Per-frame speech probability in [0, 1] |

### Purpose

Speech-activity detection **only**: speech ratio and status (`SPEECH` /
`PARTIAL` / `SILENCE` / `UNAVAILABLE`) used to gate expensive analysis, feed
the quality engine, and drive live-session speech status. It is not a
deepfake detector and never contributes to synthetic evidence.

---

## 4. Future fine-tuned X-MUX AASIST-L — swap procedure

The system is designed so a fine-tuned checkpoint replaces the pretrained one
**without changing the frontend, the API contract, reports, the risk engine
or settings**. Only the artifact (and its version metadata) changes:

1. Produce a fine-tuned artifact offline in the
   [training workspace](../training/README.md) (config-driven; see
   `training/configs/aasist-l-finetune.example.json`).
2. Validate it: fixed-eval-set metrics, **seen vs unseen-generator splits
   reported separately**, calibration fitted on validation data only.
3. Export the PyTorch checkpoint and register it (name, version, sha256,
   input/output contract, validation and unseen metrics) in the model
   registry records.
4. Copy the artifact onto the backend host's models directory.
5. Set `XMUX_AASIST_MODEL_PATH` to the new artifact.
6. Restart the backend. On load, the detector re-verifies the input/output
   contract with a real self-test probe; `GET /api/health` must report
   `synthetic_detection` as `READY`, and a real analysis must be confirmed
   (e.g. `python backend/verify_models.py`).
7. Verify a real inference through the full pipeline (upload → report).

**Rollback**: point `XMUX_AASIST_MODEL_PATH` back to the previous checkpoint
(e.g. the tracked `backend/models/AASIST-L.pth`) and restart. Reports store
`model_version`, so historical analyses remain attributable to the artifact
that produced them.

The backend must never auto-replace the production model after training;
activation is a deliberate, validated operator action.
