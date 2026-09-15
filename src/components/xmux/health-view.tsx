"use client";

import { useCallback, useEffect, useState } from "react";
import {
  Bell,
  Cpu,
  HeartPulse,
  Loader2,
  Mic,
  RefreshCw,
} from "lucide-react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { getHealth } from "@/lib/xmux/api";
import { queryMicPermission } from "@/lib/xmux/recorder";
import type { ComponentState, HealthResponse, MicState } from "@/lib/xmux/types";
import { StateBadge } from "./status-badge";

const COMPONENT_LABELS: Record<string, string> = {
  api: "API",
  audio_decoder: "Audio Decoder",
  dsp_engine: "DSP Engine",
  synthetic_detection: "Synthetic Detection",
  speaker_verification: "Speaker Verification",
  speech_activity: "Speech Activity",
  database: "Database",
  streaming: "Streaming",
};

const COMPONENT_DESCRIPTIONS: Record<string, string> = {
  api: "REST API service",
  audio_decoder: "Audio format decoding (ffmpeg + soundfile)",
  dsp_engine: "Signal feature computation",
  synthetic_detection: "Synthetic/spoof evidence model",
  speaker_verification: "Speaker embedding model",
  speech_activity: "Speech activity detection",
  database: "Backend persistence",
  streaming: "Live Socket.IO transport",
};

export function HealthView() {
  const [health, setHealth] = useState<HealthResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [micState, setMicState] = useState<MicState>("PERMISSION_REQUIRED");
  const [notifState, setNotifState] = useState<string>("default");

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      setHealth(await getHealth());
    } catch {
      setHealth(null);
    } finally {
      setLoading(false);
    }
    setMicState(await queryMicPermission());
    if (typeof Notification !== "undefined") {
      setNotifState(Notification.permission);
    }
  }, []);

  useEffect(() => {
    void refresh();
    const id = window.setInterval(() => void refresh(), 10000);
    return () => window.clearInterval(id);
  }, [refresh]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">System Health</h1>
          <p className="text-sm text-muted-foreground">
            Truthful component states. A component is READY only when its real
            check succeeds.
          </p>
        </div>
        <Button variant="outline" onClick={() => void refresh()} disabled={loading}>
          <RefreshCw className={`size-4 ${loading ? "animate-spin" : ""}`} aria-hidden />
          Refresh
        </Button>
      </div>

      {loading && !health ? (
        <div className="flex items-center gap-2 p-6 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" aria-hidden /> Checking
          components…
        </div>
      ) : !health ? (
        <Card className="border-red-200 dark:border-red-900">
          <CardContent className="p-4 text-sm">
            The backend health endpoint is unreachable. Analyses and live
            sessions cannot run until it is available.
          </CardContent>
        </Card>
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {Object.entries(health.components).map(([key, comp]) => (
              <Card key={key}>
                <CardContent className="p-4">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <p className="flex items-center gap-2 text-sm font-semibold">
                        <HeartPulse className="size-4 text-primary" aria-hidden />
                        {COMPONENT_LABELS[key] ?? key}
                      </p>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {COMPONENT_DESCRIPTIONS[key] ?? comp.model ?? ""}
                      </p>
                    </div>
                    <StateBadge state={comp.state as ComponentState} />
                  </div>
                  {comp.note && (
                    <p className="mt-2 rounded-md bg-muted px-2 py-1.5 text-xs text-muted-foreground">
                      {comp.note}
                    </p>
                  )}
                </CardContent>
              </Card>
            ))}
          </div>

          {/* Compute */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center gap-2 text-sm font-semibold">
                <Cpu className="size-4 text-primary" aria-hidden />
                Compute
              </CardTitle>
              <CardDescription>
                GPU acceleration is only reported when a CUDA device is
                actually visible to the ML runtime.
              </CardDescription>
            </CardHeader>
            <CardContent className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
              <Row
                label="Compute"
                value={health.compute.gpu_available ? "GPU available" : "CPU"}
              />
              <Row
                label="GPU"
                value={health.compute.gpu_name ?? "Not detected"}
              />
              <Row
                label="CUDA"
                value={health.compute.cuda_available ? "Available" : "Not available"}
              />
              <Row
                label="ML runtime"
                value={health.compute.pytorch_version ?? "not installed"}
              />
              {health.compute.note && (
                <p className="col-span-full text-xs text-muted-foreground">
                  {health.compute.note}
                </p>
              )}
            </CardContent>
          </Card>

          {/* Client states */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-semibold">Client States</CardTitle>
              <CardDescription>
                Browser-side capabilities checked on this device.
              </CardDescription>
            </CardHeader>
            <CardContent className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
              <div className="flex items-center justify-between gap-3">
                <span className="flex items-center gap-2">
                  <Mic className="size-4 text-muted-foreground" aria-hidden />
                  Microphone
                </span>
                <StateBadge state={micState} />
              </div>
              <div className="flex items-center justify-between gap-3">
                <span className="flex items-center gap-2">
                  <Bell className="size-4 text-muted-foreground" aria-hidden />
                  Notifications
                </span>
                <StateBadge
                  state={
                    notifState === "granted"
                      ? "READY"
                      : notifState === "denied"
                        ? "BLOCKED"
                        : "PERMISSION_REQUIRED"
                  }
                />
              </div>
            </CardContent>
          </Card>

          <p className="text-xs text-muted-foreground">
            Last checked {new Date(health.time).toLocaleTimeString()} ·
            refreshed automatically every 10 seconds.
          </p>
        </>
      )}
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-medium">{value}</span>
    </div>
  );
}
