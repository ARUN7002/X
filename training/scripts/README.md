# Training Scripts — Planned Tooling (NOT YET IMPLEMENTED)

**Status: TO-BE-IMPLEMENTED plan.** The `.py` files below do **not** exist
yet. This directory intentionally contains only documentation — no fake
training code, no placeholder scripts that pretend to run, and no fabricated
results. Implement them on the offline GPU host when training begins.

All scripts are config-driven (see
[../configs/aasist-l-finetune.example.json](../configs/aasist-l-finetune.example.json))
and follow the workflow in [../README.md](../README.md).

---

## Planned scripts

### `build_manifest.py`
Build the dataset manifest (JSONL) from downloaded corpora.

- Input: dataset directories + a sources description (name, version,
  license, permitted use).
- Output: one manifest record per sample (`sample_id`, `source_dataset`,
  `speaker_id` if permitted, `label`, `generator_family` for spoofed,
  `language`, `sample_rate`, `codec`, `augmentation`, `split`).
- Responsibilities: license-field validation (refuse to include a dataset
  whose license record is missing), speaker-disjoint splitting where
  permitted, unseen-generator assignment, and manifest sha256 emission for
  reproducibility.

### `baseline_eval.py`
Run the **pretrained AASIST-L** on the frozen eval manifests before any
fine-tuning.

- Reports the §10 metric set on seen and unseen splits **separately**, with
  dataset + split + threshold + model version attached to every number.
- Records the checkpoint sha256 used.
- Purpose: establish the honest starting point and verify the pipeline
  end-to-end before spending GPU time.

### `finetune.py`
Fine-tune AASIST-L from the pretrained checkpoint.

- Reads the config (epochs, batch size, lr, weight decay, gradient
  accumulation, mixed precision, workers, checkpoint frequency, early
  stopping, seed, splits, augmentation).
- Applies the augmentation policy to both classes equally.
- Saves resumable checkpoints (model + optimizer + epoch + RNG state +
  config hash) into `../experiments/<run_id>/checkpoints/`.
- Supports `--resume <checkpoint>`.
- Early-stops on the frozen validation metric.

### `evaluate.py`
Evaluate any checkpoint on any manifest.

- Computes EER, ROC-AUC, F1, precision, recall, FPR, FNR, balanced accuracy
  and the confusion matrix; reports seen and unseen-generator splits
  separately (never combined).
- Live-behavior replay mode: simulated streaming windows → false alarm
  rate, miss rate, per-window latency, stability (state flapping) and
  abstention rate.

### `calibrate.py`
Fit score calibration (Platt or isotonic).

- Fits **only on held-out validation data**; refuses test data.
- Emits the calibrator parameters alongside the artifact and keeps raw vs
  calibrated scores separate from application risk.

### `export_checkpoint.py`
Export a validated checkpoint for serving.

- Primary format: PyTorch checkpoint (state dict + config metadata).
- Optional ONNX export, gated behind verified parity tests on a fixed probe
  set (outputs must match within tolerance before ONNX is accepted).

### `register_model.py`
Write a model-registry record for a candidate artifact.

- Fields: `model_name`, `version`, `status` (candidate/validated/active/
  retired), `type`, `checkpoint`, `sha256`, input/output contracts,
  validation metrics, unseen-generator metrics.
- The record is the input to the deliberate activation/rollback procedure
  (../README.md §14–15). Nothing is auto-deployed.

---

## Implementation rules

1. **Config-driven**: every hyperparameter, path and split comes from a
   committed config file; CLI flags only select the config and run mode.
2. **Deterministic where possible**: fixed seeds; manifest sha256 recorded
   with every result.
3. **Honest reporting**: metrics are written with dataset + split +
   threshold + model version; failures abort with non-zero exit codes
   rather than emitting partial/fake numbers.
4. **No network at serving time**: training scripts may download data on
   the training host only; the serving backend never runs them.
5. **GPU-aware, not GPU-brand-locked**: standard PyTorch APIs;
   `mixed_precision: "auto"` detects the accelerator.
