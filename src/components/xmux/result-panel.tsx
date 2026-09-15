"use client";

import { useState } from "react";
import {
  Activity,
  ChevronDown,
  Cpu,
  FileAudio2,
  Gauge,
  Mic,
  ShieldAlert,
  ShieldCheck,
  Upload,
  UserCheck,
  UserX,
} from "lucide-react";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ScoreDial } from "./score-dial";
import { ActionBadge, VerdictBadge, pct } from "./status-badge";
import type { AnalysisResult } from "@/lib/xmux/types";
import { cn } from "@/lib/utils";

function fmt(v: number | null | undefined, digits = 1, suffix = ""): string {
  if (v === null || v === undefined || Number.isNaN(v)) return "—";
  return `${v.toFixed(digits)}${suffix}`;
}

const SOURCE_ICONS: Record<string, React.ElementType> = {
  MICROPHONE: Mic,
  LIVE: Activity,
};

export function ResultPanel({ result }: { result: AnalysisResult }) {
  const syn = result.evidence.synthetic;
  const spk = result.evidence.speaker;
  const q = result.evidence.quality;
  const prosody = result.evidence.prosody;
  const [techOpen, setTechOpen] = useState(false);
  const SourceIcon = SOURCE_ICONS[result.source] ?? Upload;

  const speakerThreshold = result.policy?.speaker_threshold ?? 0.25;
  const riskWarn = result.policy?.risk_warn ?? 0.35;
  const similarity = spk.similarity ?? 0;
  const isMatch = similarity >= speakerThreshold;
  const synthEvidence = syn.evidence ?? 0;
  const synthHigh = syn.available && synthEvidence >= riskWarn;

  const statusExplain: Record<string, string> = {
    INCONCLUSIVE:
      "Audio conditions or model confidence did not support a reliable decision. Human verification is recommended.",
    MODEL_UNAVAILABLE:
      "The detection model was not available for this analysis, so no integrity decision could be made.",
    ANALYSIS_FAILED:
      "The analysis could not be completed. Please retry with a different audio file.",
  };

  return (
    <div className="space-y-4">
      {/* Verdict header */}
      <Card>
        <CardContent className="p-4 sm:p-6">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="flex items-center gap-3 min-w-0">
              <span className="flex size-11 shrink-0 items-center justify-center rounded-full bg-muted">
                <SourceIcon className="size-5 text-muted-foreground" aria-hidden />
              </span>
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <VerdictBadge verdict={result.verdict} />
                  <ActionBadge action={result.recommended_action} />
                </div>
                <p className="mt-1.5 truncate text-sm text-muted-foreground">
                  {result.label ?? "audio"} · {fmt(result.audio.duration_sec)} s ·{" "}
                  {(result.audio.sample_rate / 1000).toFixed(0)} kHz
                </p>
              </div>
            </div>
            <div className="text-right">
              <p className="text-xs text-muted-foreground">Analysis Confidence</p>
              <p className="text-2xl font-semibold tabular-nums">
                {pct(result.confidence)}
              </p>
            </div>
          </div>
          {statusExplain[result.status] && (
            <p className="mt-4 rounded-md bg-muted px-3 py-2 text-sm text-muted-foreground">
              {statusExplain[result.status]}
            </p>
          )}
        </CardContent>
      </Card>

      {/* Reference voice comparison verdict */}
      {spk.available && (
        <Card
          className={cn(
            "border",
            isMatch ? "border-primary/40 bg-primary/5" : "border-destructive/40 bg-destructive/5",
          )}
        >
          <CardContent className="p-4 sm:p-6">
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div className="flex items-center gap-3 min-w-0">
                <span
                  className={cn(
                    "flex size-11 shrink-0 items-center justify-center rounded-full",
                    isMatch ? "bg-primary/15" : "bg-destructive/15",
                  )}
                >
                  {isMatch ? (
                    <UserCheck className="size-5 text-primary" aria-hidden />
                  ) : (
                    <UserX className="size-5 text-destructive" aria-hidden />
                  )}
                </span>
                <div className="min-w-0">
                  <p
                    className={cn(
                      "text-base font-semibold",
                      isMatch ? "text-primary" : "text-destructive",
                    )}
                  >
                    {isMatch ? "SAME SPEAKER AS REFERENCE" : "DIFFERENT SPEAKER THAN REFERENCE"}
                  </p>
                  <p className="mt-0.5 text-sm text-muted-foreground">
                    Compared against “{spk.profile_name ?? "reference voice"}” — similarity{" "}
                    <strong className="text-foreground tabular-nums">
                      {pct(spk.similarity)}
                    </strong>{" "}
                    vs threshold {pct(speakerThreshold)}
                  </p>
                </div>
              </div>
              <div className="text-right">
                <p className="text-xs text-muted-foreground">Speaker Match</p>
                <p
                  className={cn(
                    "text-2xl font-semibold tabular-nums",
                    isMatch ? "text-primary" : "text-destructive",
                  )}
                >
                  {pct(spk.similarity)}
                </p>
              </div>
            </div>
            <p className="mt-4 rounded-md bg-background/80 px-3 py-2 text-sm text-muted-foreground">
              <span className="font-medium text-foreground">Interpretation: </span>
              {isMatch && synthHigh
                ? "The analyzed voice closely matches the reference speaker, but strong synthetic-speech evidence was detected — a pattern consistent with a voice-cloning attempt of the reference person."
                : isMatch && !synthHigh
                  ? "The analyzed voice matches the reference speaker, and no significant synthetic-speech evidence was detected."
                  : !isMatch && synthHigh
                    ? "The analyzed voice does not match the reference speaker and shows synthetic-speech characteristics."
                    : "The analyzed voice does not match the reference — most likely a different human speaker than the reference."}
            </p>
          </CardContent>
        </Card>
      )}

      {/* Score dials */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        <ScoreDial
          label="AI Likelihood"
          value={syn.available ? (syn.evidence ?? null) : null}
          hint={syn.available ? "Synthetic evidence" : "Unavailable"}
        />
        <ScoreDial
          label="Speaker Similarity"
          value={spk.available ? (spk.similarity ?? null) : null}
          tone="similarity"
          hint={
            spk.available
              ? `vs “${(spk.profile_name ?? "reference").slice(0, 18)}”`
              : "No reference selected"
          }
        />
        <ScoreDial
          label="Audio Quality"
          value={q.available ? (q.score ?? null) : null}
          tone="quality"
          hint={q.available ? "Analysis reliability" : "Unavailable"}
        />
        <ScoreDial
          label="Confidence"
          value={result.confidence}
          tone="quality"
          hint="Decision confidence"
        />
        <ScoreDial
          label="Risk Score"
          value={result.risk_score}
          tone="risk"
          hint={
            result.risk_score === null ? "Not assessed" : "Policy thresholds apply"
          }
        />
      </div>

      {/* Evidence cards */}
      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-sm font-semibold">
              <ShieldAlert className="size-4 text-primary" aria-hidden />
              Synthetic Evidence
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            {syn.available ? (
              <>
                <Row label="AI likelihood" value={pct(syn.evidence)} />
                <Row label="Model" value={syn.model ?? "—"} />
                <Row label="Windows analyzed" value={String(syn.window_scores?.length ?? 0)} />
                <Row label="Inference time" value={fmt(syn.latency_ms, 0, " ms")} />
                <Row
                  label="Window agreement"
                  value={
                    syn.window_std !== undefined
                      ? syn.window_std < 0.15
                        ? "Consistent"
                        : "Variable"
                      : "—"
                  }
                />
                <p className="pt-1 text-xs text-muted-foreground">
                  Uncalibrated model evidence — not a validated probability.
                  Operational thresholds are configurable in Settings.
                </p>
              </>
            ) : (
              <p className="text-muted-foreground">
                Synthetic detection was unavailable for this analysis. No score
                was produced or estimated.
              </p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-sm font-semibold">
              <UserCheck className="size-4 text-primary" aria-hidden />
              Speaker Consistency
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            {spk.available ? (
              <>
                <Row label="Similarity" value={pct(spk.similarity)} />
                <Row label="Speaker verdict" value={isMatch ? "Match (same speaker)" : "Mismatch (different speaker)"} />
                <Row label="Reference profile" value={spk.profile_name ?? spk.profile_id ?? "—"} />
                <Row label="Match threshold" value={pct(speakerThreshold)} />
                <Row label="Model" value={spk.model ?? "—"} />
                <Row label="Inference time" value={fmt(spk.latency_ms, 0, " ms")} />
                <p className="pt-1 text-xs text-muted-foreground">
                  Cosine similarity against the enrolled reference voice. This
                  is not a synthetic-voice probability.
                </p>
              </>
            ) : (
              <p className="text-muted-foreground">
                {spk.note ?? "Speaker similarity not evaluated for this analysis."}
              </p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-sm font-semibold">
              <Gauge className="size-4 text-primary" aria-hidden />
              Audio Quality
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <Row label="Quality score" value={q.available ? pct(q.score) : "—"} />
            <Row label="Duration" value={fmt(q.duration_sec, 1, " s")} />
            <Row label="Speech ratio" value={pct(q.speech_ratio)} />
            <Row label="Silence ratio" value={pct(q.silence_ratio)} />
            <Row label="Noise (SNR)" value={fmt(q.snr_db, 1, " dB")} />
            <Row label="Clipping" value={pct(q.clipping_ratio)} />
            {q.flags && q.flags.length > 0 && (
              <div className="flex flex-wrap gap-1.5 pt-1">
                {q.flags.map((f) => (
                  <Badge key={f} variant="outline" className="text-[10px]">
                    {f.replace(/_/g, " ")}
                  </Badge>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-sm font-semibold">
              <FileAudio2 className="size-4 text-primary" aria-hidden />
              Speech Behavior (Prosody)
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            {prosody.available ? (
              <>
                <Row label="F0 mean" value={fmt(prosody.f0_mean_hz, 1, " Hz")} />
                <Row label="F0 variation" value={fmt(prosody.f0_std_hz, 1, " Hz")} />
                <Row label="Jitter (approx.)" value={fmt(prosody.jitter_approx, 3)} />
                <Row label="Shimmer (approx.)" value={fmt(prosody.shimmer_approx, 3)} />
                <Row label="Voiced ratio" value={pct(prosody.voiced_ratio)} />
                <p className="pt-1 text-xs text-muted-foreground">
                  Supporting speech-behavior context only — no single prosody
                  feature determines authenticity.
                </p>
              </>
            ) : (
              <p className="text-muted-foreground">
                Not enough voiced speech to compute prosody features.
              </p>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Notes */}
      {result.notes && result.notes.length > 0 && (
        <Card>
          <CardContent className="p-4">
            <ul className="space-y-1.5 text-sm text-muted-foreground">
              {result.notes.map((n, i) => (
                <li key={i} className="flex gap-2">
                  <span aria-hidden>•</span>
                  {n}
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      {/* Technical evidence */}
      <Collapsible open={techOpen} onOpenChange={setTechOpen}>
        <Card>
          <CollapsibleTrigger className="flex w-full items-center justify-between p-4 text-left">
            <span className="flex items-center gap-2 text-sm font-semibold">
              <Cpu className="size-4 text-primary" aria-hidden />
              Technical Evidence
            </span>
            <ChevronDown
              className={`size-4 text-muted-foreground transition-transform ${techOpen ? "rotate-180" : ""}`}
              aria-hidden
            />
          </CollapsibleTrigger>
          <CollapsibleContent>
            <CardContent className="space-y-4 border-t pt-4 text-sm">
              <div className="grid gap-x-6 gap-y-2 sm:grid-cols-2">
                <Row label="RMS level" value={fmt(result.dsp.rms_db, 1, " dB")} />
                <Row label="Peak" value={fmt(result.dsp.peak, 3)} />
                <Row label="ZCR" value={fmt(result.dsp.zcr, 4)} />
                <Row label="Spectral centroid" value={fmt(result.dsp.spectral_centroid_hz, 0, " Hz")} />
                <Row label="Spectral bandwidth" value={fmt(result.dsp.spectral_bandwidth_hz, 0, " Hz")} />
                <Row label="Spectral rolloff" value={fmt(result.dsp.spectral_rolloff_hz, 0, " Hz")} />
                <Row label="Spectral flatness" value={fmt(result.dsp.spectral_flatness, 4)} />
                <Row label="Spectral flux" value={fmt(result.dsp.spectral_flux, 2)} />
              </div>
              {result.dsp.mfcc_mean && result.dsp.mfcc_mean.length > 0 && (
                <div>
                  <p className="mb-1.5 text-xs font-medium text-muted-foreground">MFCC means</p>
                  <div className="flex flex-wrap gap-1">
                    {result.dsp.mfcc_mean.map((m, i) => (
                      <Badge key={i} variant="secondary" className="font-mono text-[10px]">
                        {i + 1}: {m.toFixed(1)}
                      </Badge>
                    ))}
                  </div>
                </div>
              )}
              <div className="grid gap-x-6 gap-y-2 sm:grid-cols-2">
                <Row label="Speech activity" value={result.model.speech_activity ?? "unavailable"} />
                <Row label="Speech status" value={result.speech_activity?.status ?? "—"} />
                <Row label="Synthetic detection" value={result.model.synthetic_detection ?? "unavailable"} />
                <Row label="Speaker verification" value={result.model.speaker_verification ?? "not used"} />
                {syn.raw_protocol_scores && syn.raw_protocol_scores.length > 0 && (
                  <Row
                    label="Raw protocol scores"
                    value={syn.raw_protocol_scores.map((s) => s.toFixed(2)).join(", ")}
                  />
                )}
                <Row label="Analysis time" value={fmt(result.meta.analysis_ms, 0, " ms")} />
              </div>
              {result.policy && (
                <p className="text-xs text-muted-foreground">
                  Operational policy — warn ≥ {pct(result.policy.risk_warn)},
                  high ≥ {pct(result.policy.risk_high)}, speaker threshold{" "}
                  {result.policy.speaker_threshold.toFixed(2)}. These are
                  configurable thresholds, not validated calibration points.
                </p>
              )}
            </CardContent>
          </CollapsibleContent>
        </Card>
      </Collapsible>

      <p className="flex items-start gap-2 text-xs text-muted-foreground">
        <ShieldCheck className="mt-0.5 size-3.5 shrink-0" aria-hidden />
        {result.meta.disclaimer}
      </p>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-medium tabular-nums">{value}</span>
    </div>
  );
}
