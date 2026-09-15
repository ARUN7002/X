# X-MUX Training Workspace (OFFLINE, GPU host)

This directory is the **offline training workspace** for X-MUX. It documents
the complete fine-tuning workflow for a future X-MUX AASIST-L checkpoint and
holds its configuration. It contains **no training code yet** — the scripts
listed in [scripts/README.md](scripts/README.md) are a to-be-implemented plan.
Nothing here runs on Vercel; nothing here is required to serve the current
system.

**Hard rules:**

- Training **never runs on Vercel**. The frontend has no training UI.
- The serving backend only **loads** the selected artifact; it never trains.
- The production model is **never auto-replaced** after training — validate,
  compare, then activate deliberately (see §14).
- **Never commit datasets, checkpoints, experiment outputs or secrets to
  Git.**
- No metric is reported without the dataset + split + threshold + model
  version that produced it. No fabricated results.

> X-MUX provides voice-integrity evidence to support security decisions. It
> does not replace human verification or guarantee detection.

---

## 1. Dataset acquisition

Candidate corpora (**verify license and permitted use for YOUR deployment
before downloading any of them**):

| Category | Dataset | Notes |
|---|---|---|
| Spoofed | ASVspoof 2019 LA | The AASIST-L training distribution (logical access) |
| Spoofed | ASVspoof 2021 LA | Different channel/codecs; check current access terms |
| Spoofed | ASVspoof 5 | Larger, modern; check license & access |
| Spoofed | WaveFake | Generated adversarial audio; license check required |
| Spoofed | FakeAVCeleb | Audio-visual; audio subset usable; license check required |
| Spoofed | CodecFake | Codec-focused spoofed speech; license check required |
| Genuine | VCTK | Studio-quality genuine speech |
| Genuine | LibriTTS / LibriTTS-R | Cleaned LibriSpeech-derived speech |
| Genuine | Mozilla Common Voice | Check the specific release license |
| Genuine | VoxCeleb 1/2 | Check the specific release license and terms of use |

Rules:

- **Always verify the license and permitted use before downloading.** Terms
  change; the table above is a starting point, not permission.
- Download to `training/data/` (gitignored) or another offline location —
  **never commit datasets to Git**.
- Record the exact source URL, version/release and license of every dataset
  in the manifest metadata.
- If a dataset requires authentication, export an `HF_TOKEN` (or equivalent)
  **privately on the training host only** — never into the repository.

## 2. Licenses to verify

For every dataset, before use, confirm and record:

- the license (name, version, link);
- whether **commercial** and **redistribution** use is permitted;
- whether **speaker consent / personally identifiable data** restrictions
  apply (especially for VoxCeleb and Common Voice);
- whether **model training** on the data is an explicitly permitted use;
- attribution requirements that must accompany derived artifacts.

Keep a `LICENSES.md` note inside `training/data/` (gitignored, but backed up
privately) describing what was downloaded under which terms.

## 3. Dataset manifest format

Every sample enters training through a manifest (JSONL or CSV, one record
per sample):

```jsonc
{
  "sample_id": "asv19la_LA_0001.flac",
  "source_dataset": "asvspoof2019-la",
  "speaker_id": "LA_0001",          // only if the dataset license permits
  "label": "spoof",                  // "bonafide" | "spoof"
  "generator_family": "A17",         // synthetic only; null for bonafide
  "language": "en",
  "sample_rate": 16000,
  "codec": "flac",                   // storage/transport codec
  "augmentation": null,              // applied augmentation tag (see §6)
  "split": "train"                   // train | val | test | unseen_test
}
```

- `generator_family` is mandatory for spoofed samples — it drives the
  unseen-generator split (§5).
- `speaker_id` is included **only when the dataset license permits it**;
  otherwise it must be omitted or pseudonymized.
- Manifests are built by `scripts/build_manifest.py` (planned, §scripts) and
  versioned with the experiment config.

## 4. Train / validation / test splits

- **train**: fitting.
- **val** (validation): early stopping, hyperparameter selection, and
  **calibration fitting** (§11) — never used for training.
- **test** (seen generators): final reported metrics; used exactly once per
  model version.
- **unseen_test** (unseen generators): see §5.
- Splits are speaker-disjoint where the dataset licenses allow speaker
  identity (no speaker appears in two splits).
- Splits are defined once, frozen in the config, and recorded by sha256 of
  the manifest so every reported metric is reproducible.

## 5. UNSEEN-GENERATOR split (mandatory)

Holding out generators — not just samples — is the only honest way to
estimate generalization to new TTS/VC systems:

- **Hold out at least 2 generator families entirely from training** (e.g.
  two ASVspoof 2019 LA attack types, or one WaveFake + one CodecFake family).
  They must not appear in `train` or `val`.
- Report **seen-generator** and **unseen-generator** results **separately**.
  **Never combine them into a single number.**
- Evaluation includes unseen-generator testing — this is a stated design
  goal of X-MUX; the numbers themselves are only claimed after they exist.

## 6. Augmentation strategy

Augment **both classes equally** so the model cannot learn
"clean = genuine, compressed = fake":

- additive noise (multiple SNRs, both classes),
- room reverberation / convolutional RIRs,
- resampling and sample-rate variation,
- speed/tempo perturbation,
- volume/gain variation,
- codec transcoding (Opus, G.711, AMR-like rates),
- band-limiting / low-pass filtering,
- clipping.

Recommended libraries: `torchaudio` transforms, `audiomentations`,
`pedalboard` (codecs).

Motivation from development: a genuine band-limited 1963 broadcast recording
produced a high synthetic-evidence score (false positive, single informal dev
observation — not a benchmark). Balanced band-limiting augmentation is the
countermeasure hypothesis to test. Every augmentation applied is recorded in
the manifest's `augmentation` field so results stay attributable.

## 7. Baseline reproduction (before any fine-tuning)

Before fine-tuning, run the **pretrained AASIST-L** on the frozen eval sets:

```bash
python scripts/baseline_eval.py --config configs/aasist-l-finetune.example.json
```

- Use the **fixed** eval manifest (same file for every future comparison).
- Record: model name + version, checkpoint sha256
  (`814331d088032bb4c3fa61cc014789eadeed464209dd094ab3a2dd6ffbdce27a` for
  the tracked pretrained checkpoint), dataset + splits, metric values and
  the decision threshold used.
- For reference only: the AASIST authors report EER 0.99 % / min t-DCF
  0.0309 on ASVspoof 2019 LA for this checkpoint — their published number,
  not an X-MUX measurement. Reproducing (or failing to reproduce) it on our
  fixed eval set is itself the first honest experiment.

## 8. Fine-tuning

Config-driven (see `configs/aasist-l-finetune.example.json`). All
hyperparameters live in the config, never in ad-hoc CLI edits:

- epochs, batch_size, learning_rate, weight_decay
- gradient_accumulation_steps, mixed_precision
- num_workers, checkpoint_frequency_epochs, early_stopping_patience
- seed, splits, augmentation settings, base checkpoint

Constraints:

- Start from the **pretrained AASIST-L** (sha256 above) — fine-tuning, not
  training from scratch.
- Lower learning rates (e.g. 1e-5) are typical for fine-tuning versus
  from-scratch training; tune on `val`.
- **GPU-aware but not GPU-brand-locked**: the workflow uses standard
  PyTorch; any CUDA-capable host works. `mixed_precision: "auto"` should
  detect the available accelerator.
- **Memory and duration depend on model, input length, batch size, precision,
  optimizer and the specific GPU — never promise exact VRAM or wall-clock
  figures.** Measure on your host.

## 9. Checkpointing + resume

- Save a checkpoint every `checkpoint_frequency_epochs` (default 1) into
  `experiments/<run_id>/checkpoints/` (gitignored).
- Each checkpoint stores: model state, optimizer state, epoch, RNG/seed
  state, config sha256 — enough to resume exactly.
- `scripts/finetune.py --resume <checkpoint>` continues a run
  (planned).
- Keep the best (by frozen `val` metric) and the last checkpoint; register
  the chosen one (§13).

## 10. Evaluation metrics

Offline, per dataset + split + threshold + model version:

- EER (equal error rate)
- ROC-AUC
- F1, precision, recall
- FPR (false positive rate), FNR (false negative rate)
- balanced accuracy
- confusion matrix

Live-behavior evaluation (on replayed/simulated live streams, still offline):

- false alarm rate (alerts on genuine live audio)
- miss rate (no alert on spoofed live audio)
- latency per window
- stability (state flapping count)
- abstention rate (INCONCLUSIVE / MODEL_UNAVAILABLE windows)

Every reported metric must carry: dataset, split (seen/unseen), decision
threshold, and model version. No metric is published without a real run
behind it.

## 11. Calibration

- Fit **Platt scaling or isotonic regression on held-out validation data
  only** — never on test data, never on training data.
- Calibration leakage check: the calibration set must be disjoint from the
  test set.
- Keep three quantities **separate and labeled**:
  1. **raw score** (model logit / softmax),
  2. **calibrated score** (post-calibration probability),
  3. **application risk** (X-MUX fusion output after thresholds/policy).
- The current serving model is **uncalibrated**; calibration happens here,
  offline, before any fine-tuned artifact is activated.

## 12. Export

- **Primary format: PyTorch checkpoint** (state dict + config), loaded
  directly by the backend via `XMUX_AASIST_MODEL_PATH`.
- **ONNX only after verified parity**: export, then run parity tests
  (identical outputs within tolerance on a fixed probe set) before an ONNX
  artifact may be considered equivalent. Until then, ONNX is experimental.
- Exported artifacts go to `training/export/` (gitignored) and are
  distributed out-of-band to the backend host.

## 13. Model versioning + registry

Every artifact considered for deployment gets a registry record (JSON,
committed under `protocols/` or stored in the experiment tracker):

```jsonc
{
  "model_name": "X-MUX AASIST-L",
  "version": "finetune-0.1.0",
  "status": "candidate",            // candidate | validated | active | retired
  "type": "synthetic_speech_detector",
  "checkpoint": "xmux-aasist-l-finetune-0.1.0.pth",
  "sha256": "<artifact hash>",
  "input_contract": "float32 mono 16 kHz, 64,600 samples (~4.03 s)",
  "output_contract": "(B,2) logits; evidence = softmax col 0 (spoof); protocol score = col 1 (bonafide)",
  "validation_metrics": { /* seen-split, with dataset+threshold */ },
  "unseen_metrics": { /* unseen-generator split, reported separately */ }
}
```

The currently **active** model remains the pretrained AASIST-L
(`pretrained-1.0.0`, sha256 `814331d0…`) until a validated candidate is
deliberately activated.

## 14. Deployment (activating a trained artifact)

1. Validate the candidate (§10, §11): seen + unseen metrics, calibration,
   live-behavior replay.
2. Compare against the current active model on the **same frozen eval
   sets**.
3. Export the PyTorch checkpoint (§12) and register it (§13).
4. Copy the artifact to the backend host's models directory.
5. Set `XMUX_AASIST_MODEL_PATH` to the new artifact.
6. Restart the backend.
7. Verify: `GET /api/health` → `synthetic_detection` `READY` (the load-time
   self-test re-runs automatically), then confirm a **real inference**
   through the full pipeline (e.g. `python backend/verify_models.py`, then
   an upload through `/api/analyze`).
8. The API contract, frontend, reports and risk engine are unchanged — only
   the artifact and its version metadata change.

**Never auto-activate.** A human operator performs and records steps 4–7.

## 15. Rollback

- Point `XMUX_AASIST_MODEL_PATH` back to the previous checkpoint (e.g. the
  tracked `backend/models/AASIST-L.pth`) and restart.
- Verify health returns to `READY` and a real inference passes.
- Stored reports keep their `model_version`, so history remains attributable
  to the artifact that produced it.

---

## Directory layout

```
training/
├── README.md          # this guide
├── configs/           # fine-tuning configurations (committed)
├── scripts/           # planned tooling — see scripts/README.md (NOT yet implemented)
├── protocols/         # evaluation protocol definitions (planned)
├── evaluation/        # metric implementations (planned)
├── experiments/       # run outputs — gitignored content, .gitkeep placeholder only
├── export/            # exported artifacts — gitignored content, .gitkeep placeholder only
└── data/              # datasets — gitignored, never committed (create on demand)
```
