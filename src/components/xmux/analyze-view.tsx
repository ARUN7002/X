"use client";

import { useEffect, useRef, useState } from "react";
import {
  AlertCircle,
  ArrowRight,
  AudioLines,
  CheckCircle2,
  FileUp,
  Loader2,
  Mic,
  Radio,
  Square,
  Upload,
  UserRound,
  XCircle,
} from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { analyzeAudio, enrollProfile, getProfiles } from "@/lib/xmux/api";
import { createMicRecorder, queryMicPermission } from "@/lib/xmux/recorder";
import { useXmux } from "@/lib/xmux/store";
import type { AnalysisResult, MicState, VoiceProfile } from "@/lib/xmux/types";
import { ResultPanel } from "./result-panel";
import { StateBadge } from "./status-badge";
import { cn } from "@/lib/utils";

const MIN_REF_SEC = 3;

export function AnalyzeView() {
  const [profiles, setProfiles] = useState<VoiceProfile[]>([]);
  const [profileId, setProfileId] = useState<string>("none");

  const refreshProfiles = (selectId?: string) => {
    getProfiles()
      .then((p) => {
        setProfiles(p);
        if (selectId) setProfileId(selectId);
      })
      .catch(() => setProfiles([]));
  };

  useEffect(() => {
    refreshProfiles();
  }, []);

  const selectedProfile = profileId === "none" ? null : profileId;
  const activeProfile = profiles.find((p) => p.id === profileId) ?? null;

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Analyze Voice</h1>
        <p className="text-sm text-muted-foreground">
          Register the person&apos;s own voice as a reference, then analyze any
          recording or live stream and compare it against that reference. Every
          score comes from real backend analysis.
        </p>
      </div>

      <ReferenceVoiceCard
        profiles={profiles}
        profileId={profileId}
        activeProfile={activeProfile}
        onChange={setProfileId}
        onEnrolled={refreshProfiles}
      />

      <div className="flex items-center gap-2 pt-1">
        <AudioLines className="size-4 text-primary" aria-hidden />
        <h2 className="text-sm font-semibold tracking-tight">
          Analyze a voice &amp; compare against the reference
        </h2>
      </div>

      <Tabs defaultValue="upload">
        <TabsList className="grid w-full grid-cols-3">
          <TabsTrigger value="upload">Upload Audio</TabsTrigger>
          <TabsTrigger value="microphone">Microphone</TabsTrigger>
          <TabsTrigger value="live">Live Stream</TabsTrigger>
        </TabsList>
        <TabsContent value="upload" className="mt-4">
          <UploadTab selectedProfile={selectedProfile} />
        </TabsContent>
        <TabsContent value="microphone" className="mt-4">
          <MicrophoneTab selectedProfile={selectedProfile} />
        </TabsContent>
        <TabsContent value="live" className="mt-4">
          <LiveTab selectedProfile={selectedProfile} />
        </TabsContent>
      </Tabs>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Step 1 — Reference voice registration (record / upload / pick)     */
/* ------------------------------------------------------------------ */

function ReferenceVoiceCard({
  profiles,
  profileId,
  activeProfile,
  onChange,
  onEnrolled,
}: {
  profiles: VoiceProfile[];
  profileId: string;
  activeProfile: VoiceProfile | null;
  onChange: (id: string) => void;
  onEnrolled: (selectId?: string) => void;
}) {
  const [phase, setPhase] = useState<"idle" | "recording" | "enrolling">("idle");
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [seconds, setSeconds] = useState(0);
  const [level, setLevel] = useState(0);
  const [micState, setMicState] = useState<MicState>("PERMISSION_REQUIRED");
  const [enrollSource, setEnrollSource] = useState<"MIC" | "UPLOAD">("MIC");
  const fileInputRef = useRef<HTMLInputElement>(null);
  const recorderRef = useRef<ReturnType<typeof createMicRecorder> | null>(null);
  const timerRef = useRef<number | null>(null);
  const levelTimer = useRef<number | null>(null);
  const permissions = useXmux((s) => s.permissions);
  const { toast } = useToast();

  useEffect(() => {
    return () => {
      if (timerRef.current) window.clearInterval(timerRef.current);
      if (levelTimer.current) window.clearInterval(levelTimer.current);
    };
  }, []);

  const enrollAllowed = permissions.voiceEnrollment;

  const finishEnroll = async (blob: Blob, label: string) => {
    setPhase("enrolling");
    setError(null);
    try {
      const profile = await enrollProfile(
        blob,
        (name.trim() || "My Reference Voice").slice(0, 80),
      );
      onEnrolled(profile.id);
      setPhase("idle");
      setName("");
      toast({
        title: "Reference voice registered",
        description: `${label} — “${profile.name}” is now the active reference.`,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : "registration failed";
      setError(
        message.includes("too short")
          ? "The reference recording was too short — speak naturally for at least 3 seconds (3–60 s allowed)."
          : message.includes("too long")
            ? "The reference audio is too long — keep it under 60 seconds."
            : message,
      );
      setPhase("idle");
    }
  };

  const startRecording = async () => {
    setError(null);
    const recorder = createMicRecorder();
    recorderRef.current = recorder;
    try {
      await recorder.start();
      setMicState("READY");
      setPhase("recording");
      setSeconds(0);
      timerRef.current = window.setInterval(
        () => setSeconds((s) => s + 1),
        1000,
      );
      levelTimer.current = window.setInterval(() => {
        setLevel(recorder.level());
      }, 100);
    } catch {
      setMicState(recorder.state);
      setPhase("idle");
      setError(
        recorder.state === "BLOCKED"
          ? "Microphone permission was denied. Allow access in your browser settings and try again."
          : recorder.state === "UNAVAILABLE"
            ? "No microphone was found on this device. Upload a reference audio file instead."
            : "The microphone could not be started. Upload a reference audio file instead.",
      );
    }
  };

  const stopRecording = async () => {
    const recorder = recorderRef.current;
    if (!recorder) return;
    if (timerRef.current) window.clearInterval(timerRef.current);
    if (levelTimer.current) window.clearInterval(levelTimer.current);
    setLevel(0);
    try {
      const { blob, durationSec } = await recorder.stop();
      if (blob.size === 0) {
        setPhase("idle");
        setError("No audio was captured. Please try again.");
        return;
      }
      if (durationSec < MIN_REF_SEC) {
        setPhase("idle");
        setError(
          `The reference recording was too short (${durationSec.toFixed(1)} s). Speak naturally for at least ${MIN_REF_SEC} seconds.`,
        );
        return;
      }
      setEnrollSource("MIC");
      await finishEnroll(blob, "Microphone recording");
    } catch (err) {
      setPhase("idle");
      setError(err instanceof Error ? err.message : "registration failed");
    }
  };

  const uploadReference = async (file: File) => {
    setEnrollSource("UPLOAD");
    await finishEnroll(file, `Uploaded “${file.name}”`);
  };

  /* ---- active reference registered (either fresh or from the list) */
  if (activeProfile) {
    return (
      <Card className="border-primary/40">
        <CardHeader className="pb-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <CardTitle className="flex items-center gap-2 text-base">
              <CheckCircle2 className="size-4.5 text-primary" aria-hidden />
              Reference Voice — Active
            </CardTitle>
            <Badge variant="secondary" className="font-normal">
              Step 1 of 2 · done
            </Badge>
          </div>
          <CardDescription>
            Voices analyzed below are compared against this reference.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-col gap-3 rounded-lg border bg-muted/40 p-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-3">
              <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-primary/10">
                <UserRound className="size-5 text-primary" aria-hidden />
              </span>
              <div className="min-w-0">
                <p className="truncate text-sm font-medium">{activeProfile.name}</p>
                <p className="text-xs text-muted-foreground">
                  {activeProfile.duration_sec.toFixed(1)} s reference ·{" "}
                  {activeProfile.model} · enrolled{" "}
                  {new Date(activeProfile.created_at).toLocaleString()}
                </p>
              </div>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={() => onChange("none")}
            >
              <XCircle className="size-4" aria-hidden />
              Use a different reference
            </Button>
          </div>

          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-3">
              <Label
                htmlFor="ref-profile-select"
                className="shrink-0 text-sm text-muted-foreground"
              >
                Saved profile
              </Label>
              <Select value={profileId} onValueChange={onChange}>
                <SelectTrigger id="ref-profile-select" className="w-full sm:w-64">
                  <SelectValue placeholder="Select a profile" />
                </SelectTrigger>
                <SelectContent>
                  {profiles.map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <p className="text-xs text-muted-foreground">
              Manage enrolled voices in{" "}
              <button
                className="text-primary underline-offset-2 hover:underline"
                onClick={() => useXmux.getState().setView("profiles")}
              >
                Voice Profiles
              </button>
              .
            </p>
          </div>
        </CardContent>
      </Card>
    );
  }

  /* ---- no reference yet: register one */
  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle className="flex items-center gap-2 text-base">
            <AudioLines className="size-4.5 text-primary" aria-hidden />
            Reference Voice
          </CardTitle>
          <Badge variant="secondary" className="font-normal">
            Step 1 of 2
          </Badge>
        </div>
        <CardDescription>
          Record or upload the person&apos;s own voice once. Every analysis is
          then compared against this reference to check whether it is the same
          speaker.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {!enrollAllowed && (
          <Alert>
            <AlertCircle className="size-4" aria-hidden />
            <AlertTitle>Voice enrollment is disabled</AlertTitle>
            <AlertDescription>
              Enable “Voice Enrollment” in Settings to register a reference
              voice, or pick an existing profile below.
            </AlertDescription>
          </Alert>
        )}

        {phase === "recording" ? (
          <div className="space-y-3 rounded-lg border p-3">
            <div className="flex flex-wrap items-center gap-3">
              <span className="relative flex size-2.5">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-destructive/60" />
                <span className="relative inline-flex size-2.5 rounded-full bg-destructive" />
              </span>
              <span className="font-mono text-sm tabular-nums">
                {Math.floor(seconds / 60)}:{String(seconds % 60).padStart(2, "0")}
              </span>
              <span className="text-xs text-muted-foreground">
                recording reference · speak naturally for 3–60 s
              </span>
            </div>
            <div className="flex items-end gap-1 h-8" aria-hidden>
              {Array.from({ length: 28 }).map((_, i) => {
                const h = Math.min(
                  1,
                  level * 3 + Math.abs(Math.sin(i * 0.9 + seconds)) * level * 2,
                );
                return (
                  <span
                    key={i}
                    className="w-1.5 rounded-full bg-primary/70 transition-[height] duration-100"
                    style={{ height: `${Math.max(4, h * 32)}px` }}
                  />
                );
              })}
            </div>
            <div className="flex items-center gap-2">
              <Button
                variant="destructive"
                onClick={stopRecording}
                disabled={seconds < 1}
              >
                <Square className="size-4" aria-hidden />
                Stop &amp; Save Reference
              </Button>
              <StateBadge state="READY" />
              {seconds < MIN_REF_SEC && (
                <span className="text-xs text-muted-foreground">
                  keep going… minimum {MIN_REF_SEC} s
                </span>
              )}
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            <div className="grid gap-2 sm:grid-cols-[1fr_auto_auto]">
              <div className="grid gap-1.5">
                <Label htmlFor="ref-name" className="text-xs text-muted-foreground">
                  Reference name
                </Label>
                <Input
                  id="ref-name"
                  placeholder="e.g. My Voice"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  maxLength={80}
                  disabled={phase === "enrolling" || !enrollAllowed}
                />
              </div>
              <div className="grid gap-1.5 sm:pt-0">
                <span className="text-xs text-muted-foreground invisible sm:block">
                  &nbsp;
                </span>
                <Button
                  onClick={startRecording}
                  disabled={phase === "enrolling" || !enrollAllowed}
                >
                  <Mic className="size-4" aria-hidden />
                  Record My Voice
                </Button>
              </div>
              <div className="grid gap-1.5">
                <span className="text-xs text-muted-foreground invisible sm:block">
                  &nbsp;
                </span>
                <Button
                  variant="outline"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={phase === "enrolling" || !enrollAllowed}
                >
                  <Upload className="size-4" aria-hidden />
                  Upload Reference
                </Button>
              </div>
            </div>
            <input
              ref={fileInputRef}
              type="file"
              accept=".wav,.wave,.mp3,.flac,.ogg,.oga,.m4a,.mp4,.webm,.aac,.opus,.wma,.aiff,.aif,audio/*"
              className="sr-only"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) void uploadReference(file);
                e.target.value = "";
              }}
            />
            <p className="text-xs text-muted-foreground">
              WAV, MP3, FLAC, OGG, M4A, WEBM · 3–60 s of natural speech · only a
              speaker embedding is stored, never the audio itself.
            </p>
          </div>
        )}

        {phase === "enrolling" && (
          <div className="space-y-2 rounded-lg border p-3">
            <p className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" aria-hidden />
              {enrollSource === "MIC"
                ? "Saving reference voice — extracting speaker embedding (ECAPA-TDNN)…"
                : "Uploading reference — extracting speaker embedding (ECAPA-TDNN)…"}
            </p>
            <Progress value={undefined} className="h-1.5" />
          </div>
        )}

        {error && (
          <Alert variant="destructive">
            <AlertCircle className="size-4" aria-hidden />
            <AlertTitle>Reference registration failed</AlertTitle>
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        {profiles.length > 0 && (
          <div className="flex flex-col gap-2 border-t pt-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-3">
              <Label
                htmlFor="saved-ref-select"
                className="shrink-0 text-sm text-muted-foreground"
              >
                Or pick a saved profile
              </Label>
              <Select value="none" onValueChange={onChange}>
                <SelectTrigger id="saved-ref-select" className="w-full sm:w-64">
                  <SelectValue placeholder="Select a profile" />
                </SelectTrigger>
                <SelectContent>
                  {profiles.map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <p className="text-xs text-muted-foreground">
              {micState === "BLOCKED" || micState === "UNAVAILABLE"
                ? "Microphone unavailable — upload a file or pick a saved profile."
                : "References are reusable across analyses and live sessions."}
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

/* ------------------------------------------------------------------ */
/* Step 2 — analyze & compare                                         */
/* ------------------------------------------------------------------ */

function UploadTab({ selectedProfile }: { selectedProfile: string | null }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<AnalysisResult | null>(null);
  const [dragging, setDragging] = useState(false);
  const { toast } = useToast();

  const run = async (file: File) => {
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const r = await analyzeAudio(file, file.name, "UPLOAD", selectedProfile);
      setResult(r);
      toast({
        title: "Analysis complete",
        description: `Verdict: ${r.verdict}`,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : "analysis failed";
      setError(message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4">
      <Card
        className={cn(
          "border-dashed transition-colors",
          dragging && "border-primary bg-primary/5",
        )}
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          const file = e.dataTransfer.files?.[0];
          if (file) void run(file);
        }}
      >
        <CardContent className="flex flex-col items-center gap-4 p-8 text-center">
          <span className="flex size-12 items-center justify-center rounded-full bg-primary/10">
            <FileUp className="size-6 text-primary" aria-hidden />
          </span>
          <div>
            <p className="font-medium">Drag & drop an audio file, or browse</p>
            <p className="mt-1 text-sm text-muted-foreground">
              WAV, MP3, FLAC, OGG, M4A, WEBM, AAC · up to 25 MB · 0.5–120 s ·
              processed transiently
              {selectedProfile
                ? " · compared against the active reference"
                : ""}
            </p>
          </div>
          <input
            ref={inputRef}
            type="file"
            accept=".wav,.wave,.mp3,.flac,.ogg,.oga,.m4a,.mp4,.webm,.aac,.opus,.wma,.aiff,.aif,audio/*"
            className="sr-only"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void run(file);
              e.target.value = "";
            }}
          />
          <Button onClick={() => inputRef.current?.click()} disabled={busy}>
            <Upload className="size-4" aria-hidden />
            Choose audio file
          </Button>
        </CardContent>
      </Card>

      {busy && (
        <Card>
          <CardContent className="space-y-2 p-4">
            <p className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" aria-hidden />
              Analyzing audio — decoding, speech activity, signal features and
              model inference…
            </p>
            <Progress value={undefined} className="h-1.5" />
          </CardContent>
        </Card>
      )}

      {error && (
        <Alert variant="destructive">
          <AlertCircle className="size-4" aria-hidden />
          <AlertTitle>Analysis failed</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {result && <ResultPanel result={result} />}
    </div>
  );
}

function MicrophoneTab({ selectedProfile }: { selectedProfile: string | null }) {
  const [micState, setMicState] = useState<MicState>("PERMISSION_REQUIRED");
  const [recording, setRecording] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const [level, setLevel] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<AnalysisResult | null>(null);
  const recorderRef = useRef<ReturnType<typeof createMicRecorder> | null>(null);
  const timerRef = useRef<number | null>(null);
  const levelTimer = useRef<number | null>(null);

  useEffect(() => {
    void queryMicPermission().then(setMicState);
    return () => {
      if (timerRef.current) window.clearInterval(timerRef.current);
      if (levelTimer.current) window.clearInterval(levelTimer.current);
    };
  }, []);

  const start = async () => {
    setError(null);
    setResult(null);
    const recorder = createMicRecorder();
    recorderRef.current = recorder;
    try {
      await recorder.start();
      setMicState("READY");
      setRecording(true);
      setSeconds(0);
      timerRef.current = window.setInterval(
        () => setSeconds((s) => s + 1),
        1000,
      );
      levelTimer.current = window.setInterval(() => {
        setLevel(recorder.level());
      }, 100);
    } catch {
      setMicState(recorder.state);
      setError(
        recorder.state === "BLOCKED"
          ? "Microphone permission was denied. Allow access in your browser settings and try again."
          : recorder.state === "UNAVAILABLE"
            ? "No microphone was found on this device."
            : "The microphone could not be started.",
      );
    }
  };

  const stop = async () => {
    const recorder = recorderRef.current;
    if (!recorder) return;
    if (timerRef.current) window.clearInterval(timerRef.current);
    if (levelTimer.current) window.clearInterval(levelTimer.current);
    setRecording(false);
    setLevel(0);
    try {
      const { blob } = await recorder.stop();
      if (blob.size === 0) {
        setError("No audio was captured. Please try again.");
        return;
      }
      setBusy(true);
      const r = await analyzeAudio(blob, "microphone.webm", "MICROPHONE", selectedProfile);
      setResult(r);
    } catch (err) {
      const message = err instanceof Error ? err.message : "analysis failed";
      if (message.includes("too short")) {
        setError("The recording was too short. Speak for at least one second.");
      } else {
        setError(message);
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="flex items-center gap-2 text-base">
              <Mic className="size-4.5 text-primary" aria-hidden />
              Microphone Recording
            </CardTitle>
            <StateBadge state={recording ? "READY" : micState} />
          </div>
          <CardDescription>
            Records a clip, then analyzes it with the same evidence pipeline as
            uploads{selectedProfile ? " and compares it against the active reference" : ""}.
            Permission is requested only when you press record.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center gap-3">
            {recording ? (
              <Button variant="destructive" onClick={stop}>
                <Square className="size-4" aria-hidden />
                Stop & Analyze
              </Button>
            ) : (
              <Button onClick={start} disabled={busy}>
                <Mic className="size-4" aria-hidden />
                {micState === "PERMISSION_REQUIRED"
                  ? "Allow Microphone & Record"
                  : "Record"}
              </Button>
            )}
            {recording && (
              <span className="font-mono text-sm tabular-nums">
                {Math.floor(seconds / 60)}:{String(seconds % 60).padStart(2, "0")}
              </span>
            )}
            {busy && <Loader2 className="size-4 animate-spin text-muted-foreground" aria-hidden />}
          </div>
          <div className="flex items-end gap-1 h-8" aria-hidden>
            {Array.from({ length: 24 }).map((_, i) => {
              const h = recording
                ? Math.min(1, level * 3 + Math.abs(Math.sin(i * 0.9 + seconds)) * level * 2)
                : 0.04;
              return (
                <span
                  key={i}
                  className="w-1.5 rounded-full bg-primary/70 transition-[height] duration-100"
                  style={{ height: `${Math.max(4, h * 32)}px` }}
                />
              );
            })}
          </div>
        </CardContent>
      </Card>

      {error && (
        <Alert variant="destructive">
          <AlertCircle className="size-4" aria-hidden />
          <AlertTitle>Recording problem</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {result && <ResultPanel result={result} />}
    </div>
  );
}

function LiveTab({ selectedProfile }: { selectedProfile: string | null }) {
  const live = useXmux((s) => s.live);
  const startLive = useXmux((s) => s.startLive);
  const stopLive = useXmux((s) => s.stopLive);
  const setView = useXmux((s) => s.setView);

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <Radio className="size-4.5 text-primary" aria-hidden />
            Live Stream Monitoring
          </CardTitle>
          <CardDescription>
            Streams browser microphone audio over a real Socket.IO connection.
            The backend buffers audio, tracks speech activity, and runs the
            evidence pipeline on rolling windows — near-real-time chunk
            analysis{selectedProfile ? " with continuous speaker comparison against the active reference" : ""}.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap items-center gap-3">
            {live.active ? (
              <Button variant="destructive" onClick={stopLive}>
                <Square className="size-4" aria-hidden />
                Stop Live Session
              </Button>
            ) : (
              <Button
                onClick={() => {
                  if (!useXmux.getState().permissions.liveMonitoring) {
                    useXmux.getState().setView("settings");
                    return;
                  }
                  void startLive(selectedProfile);
                }}
              >
                <Radio className="size-4" aria-hidden />
                Start Live Session
              </Button>
            )}
            <Button variant="outline" onClick={() => setView("live")}>
              Open Live Monitor
              <ArrowRight className="size-4" aria-hidden />
            </Button>
            {live.active && live.latest && (
              <span className="text-sm text-muted-foreground">
                Current state:{" "}
                <strong className="text-foreground">{live.latest.stateLabel}</strong>
                {live.latest.riskScore !== null && live.latest.riskScore !== undefined && (
                  <> · risk {Math.round(live.latest.riskScore * 100)}%</>
                )}
                {live.latest.speakerSimilarity !== null &&
                  live.latest.speakerSimilarity !== undefined && (
                  <>
                    {" "}· speaker match{" "}
                    {Math.round(live.latest.speakerSimilarity * 100)}%
                  </>
                )}
              </span>
            )}
          </div>
          <p className="text-xs text-muted-foreground">
            Prototype source: browser microphone. In production, live streams
            are expected to arrive from authorized communication or telephony
            infrastructure — a browser cannot and does not intercept phone
            calls.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
