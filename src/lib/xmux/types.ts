/**
 * X-MUX shared API contract (frontend mirror of backend schemas).
 *
 * This is the STABLE interface between frontend and backend: a future
 * fine-tuned AASIST-L checkpoint must change only the model artifact /
 * version metadata, never these shapes (spec PART 68).
 */

export type ViewId =
  | "analyze"
  | "live"
  | "profiles"
  | "reports"
  | "settings"
  | "health";

export type ComponentState =
  | "READY"
  | "DEGRADED"
  | "UNAVAILABLE"
  | "ERROR";

export type AnalysisStatus =
  | "COMPLETED"
  | "INCONCLUSIVE"
  | "ANALYSIS_FAILED"
  | "MODEL_UNAVAILABLE";

export type RecommendedAction =
  | "ALLOW"
  | "WARN"
  | "VERIFY"
  | "BLOCK"
  | "ESCALATE";

export interface ComponentHealth {
  component: string;
  state: ComponentState;
  note?: string | null;
  model?: string;
}

export interface ComputeInfo {
  device: string;
  gpu_available: boolean;
  cuda_available: boolean;
  gpu_name: string | null;
  pytorch_version?: string | null;
  note?: string;
}

export interface HealthResponse {
  status: "READY" | "DEGRADED" | "ERROR";
  components: Record<string, ComponentHealth>;
  compute: ComputeInfo;
  time: string;
}

export interface ModelInfo {
  component: string;
  model_name: string;
  model_family: string;
  model_version: string;
  checkpoint_identifier: string;
  sha256: string | null;
  input_sample_rate: number | null;
  input_window: string | null;
  output_semantics: string;
  source: string;
  loaded: boolean;
  inference_ready: boolean;
  device: string | null;
  note: string | null;
}

export interface SyntheticEvidence {
  available: boolean;
  evidence?: number;
  window_scores?: number[];
  window_starts_sec?: number[];
  window_std?: number;
  raw_protocol_scores?: number[];
  latency_ms?: number;
  model?: string;
  model_version?: string;
  score_semantics?: string;
}

export interface SpeakerEvidence {
  available: boolean;
  similarity?: number;
  model?: string;
  model_version?: string;
  latency_ms?: number;
  note?: string;
  profile_id?: string | null;
  profile_name?: string | null;
}

export interface QualityEvidence {
  available: boolean;
  score?: number;
  duration_sec?: number;
  speech_ratio?: number | null;
  silence_ratio?: number | null;
  snr_db?: number | null;
  clipping_ratio?: number;
  flags?: string[];
}

export interface ProsodyEvidence {
  available: boolean;
  f0_mean_hz?: number;
  f0_std_hz?: number;
  jitter_approx?: number;
  shimmer_approx?: number | null;
  voiced_ratio?: number;
}

export interface DspEvidence {
  available: boolean;
  rms_db?: number;
  peak?: number;
  zcr?: number;
  clipping_ratio?: number;
  spectral_centroid_hz?: number;
  spectral_bandwidth_hz?: number;
  spectral_rolloff_hz?: number;
  spectral_flatness?: number;
  spectral_flux?: number;
  mfcc_mean?: number[];
  prosody?: ProsodyEvidence;
}

export interface AnalysisResult {
  id: string;
  source: string;
  label?: string | null;
  status: AnalysisStatus;
  verdict: string;
  recommended_action: RecommendedAction | string;
  risk_score: number | null;
  confidence: number;
  audio: {
    duration_sec: number;
    sample_rate: number;
    channels: number;
  };
  speech_activity?: {
    available: boolean;
    speech_ratio?: number | null;
    status?: string;
    mean_probability?: number;
  };
  evidence: {
    synthetic: SyntheticEvidence;
    speaker: SpeakerEvidence;
    quality: QualityEvidence;
    prosody: ProsodyEvidence;
  };
  dsp: DspEvidence;
  risk_components?: Record<string, number>;
  policy?: {
    risk_warn: number;
    risk_high: number;
    speaker_threshold: number;
  };
  notes?: string[];
  model: {
    synthetic_detection?: string | null;
    speaker_verification?: string | null;
    speech_activity?: string | null;
  };
  meta: {
    analysis_ms: number;
    created_at: string;
    disclaimer: string;
  };
}

export interface ReportSummary {
  id: string;
  session_id: string | null;
  source: string;
  label: string | null;
  status: string;
  duration_sec: number | null;
  synthetic_evidence: number | null;
  speaker_similarity: number | null;
  audio_quality: number | null;
  confidence: number | null;
  risk_score: number | null;
  verdict: string;
  recommended_action: string;
  model_version: string | null;
  created_at: string;
}

export interface VoiceProfile {
  id: string;
  name: string;
  model: string;
  sample_count: number;
  duration_sec: number;
  created_at: string;
}

export interface Policy {
  risk_warn: number;
  risk_high: number;
  speaker_threshold: number;
  raw_audio_retention: boolean;
  retention_days: number;
  notifications_enabled: boolean;
}

export interface SettingsResponse {
  policy: Policy;
  models: ModelInfo[];
}

export interface LiveAnalysis {
  sessionId: string;
  t: number;
  speechStatus: string;
  speechRatio?: number | null;
  receiving: boolean;
  syntheticEvidence?: number | null;
  speakerSimilarity?: number | null;
  audioQuality?: number | null;
  confidence?: number | null;
  riskScore?: number | null;
  state: string;
  stateLabel: string;
  recommendedAction: string;
  status: string;
  verdict: string;
  latencyMs: number;
  trend: number[];
  modelsReady: {
    synthetic: boolean;
    speaker: boolean;
    vad: boolean;
  };
}

export interface LiveSessionInfo {
  sessionId: string;
  startedAt: number;
  profileId?: string | null;
  profileName?: string | null;
  models: { synthetic: boolean; speaker: boolean; vad: boolean };
  note?: string;
}

export interface LiveAlert {
  type: string;
  state: string;
  stateLabel: string;
  riskScore: number | null;
  recommendedAction: string;
  t: number;
  message: string;
}

export interface LiveEndSummary {
  sessionId: string;
  durationSec: number;
  chunksReceived?: number;
  finalState: string;
  alerts?: LiveAlert[];
}

export type MicState =
  | "READY"
  | "PERMISSION_REQUIRED"
  | "BLOCKED"
  | "UNAVAILABLE"
  | "ERROR";
