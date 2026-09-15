"use client";

import { useEffect, useRef, useState } from "react";
import {
  AlertCircle,
  ArrowRight,
  FileUp,
  Loader2,
  Mic,
  Radio,
  Square,
  Upload,
} from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Progress } from "@/components/ui/progress";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { analyzeAudio, getProfiles } from "@/lib/xmux/api";
import { createMicRecorder, queryMicPermission } from "@/lib/xmux/recorder";
import { useXmux } from "@/lib/xmux/store";
import type { AnalysisResult, MicState, VoiceProfile } from "@/lib/xmux/types";
import { ResultPanel } from "./result-panel";
import { StateBadge } from "./status-badge";
import { cn } from "@/lib/utils";

export function AnalyzeView() {
  const [profiles, setProfiles] = useState<VoiceProfile[]>([]);
  const [profileId, setProfileId] = useState<string>("none");

  useEffect(() => {
    getProfiles()
      .then((p) => setProfiles(p))
      .catch(() => setProfiles([]));
  }, []);

  const selectedProfile =
    profileId === "none" ? null : (profileId ?? null);

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Analyze Voice</h1>
        <p className="text-sm text-muted-foreground">
          Upload a recording, capture from the microphone, or start a live
          session. Every score comes from real backend analysis.
        </p>
      </div>

      <Card>
        <CardContent className="p-4">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-3">
              <Label htmlFor="profile-select" className="text-sm text-muted-foreground">
                Reference voice profile
              </Label>
              <Select value={profileId} onValueChange={setProfileId}>
                <SelectTrigger id="profile-select" className="w-full sm:w-64">
                  <SelectValue placeholder="Select a profile" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">None (skip speaker check)</SelectItem>
                  {profiles.map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <p className="text-xs text-muted-foreground">
              Enroll profiles in{" "}
              <button
                className="text-primary underline-offset-2 hover:underline"
                onClick={() => useXmux.getState().setView("profiles")}
              >
                Voice Profiles
              </button>{" "}
              to measure speaker similarity.
            </p>
          </div>
        </CardContent>
      </Card>

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
            uploads. Permission is requested only when you press record.
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
            analysis.
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
