# X-MUX Training — Overview

All training documentation and workspace scaffolding lives in the dedicated
offline workspace: **[training/README.md](../training/README.md)**.

## Summary of the offline workflow

Training is an **offline, GPU-host activity**, completely separated from the
serving stack:

1. **Acquire & license-check datasets** (spoofed + genuine corpora; verify
   every license before downloading; never commit datasets to Git).
2. **Build manifests** with a fixed schema (sample id, source dataset,
   label, generator family, language, sample rate, codec, augmentation,
   split).
3. **Define splits** including a mandatory **unseen-generator hold-out** of
   at least two generator families, reported separately from seen-generator
   results (never combined).
4. **Augment both classes equally** (noise, reverb, resampling, speed,
   volume, codecs, band-limiting, clipping, RIRs) to prevent
   "clean = genuine, compressed = fake" shortcuts.
5. **Reproduce the baseline**: run the pretrained AASIST-L on a fixed eval
   set and record metrics before any fine-tuning.
6. **Fine-tune** from config files (hyperparameters, augmentation, splits,
   seeds); checkpoint and resume safely.
7. **Evaluate** with EER / ROC-AUC / F1 / precision / recall / FPR / FNR /
   balanced accuracy / confusion matrix — every metric reported with
   dataset, split, threshold and model version.
8. **Calibrate** (Platt or isotonic) on held-out validation data only.
9. **Export** the PyTorch checkpoint, register it with full metadata.
10. **Deploy** by copying the artifact to the backend, pointing
    `XMUX_AASIST_MODEL_PATH` at it, restarting, and verifying health.
11. **Roll back** by pointing back to the previous checkpoint.

## What must never happen

- Training **never runs on Vercel**. The frontend has no training UI.
- The serving backend only **loads** the selected artifact; it never
    retrains, never auto-replaces the production model, and never downloads
    datasets.
- No training results, metrics or accuracy claims are published without a
  validated evaluation behind them.

See [training/README.md](../training/README.md) for the complete 15-section
guide, [training/configs/](../training/configs/) for the fine-tuning config
example, and [training/scripts/README.md](../training/scripts/README.md) for
the planned tooling.
