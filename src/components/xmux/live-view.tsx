"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Activity,
  Clock,
  MicOff,
  Radio,
  ShieldAlert,
  Square,
  Timer,
} from "lucide-react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  LineChart,
  Line,
  YAxis,
  XAxis,
  ResponsiveContainer,
  Tooltip,
  ReferenceLine,
  CartesianGrid,
} from "recharts";
import { getProfiles } from "@/lib/xmux/api";
import { useXmux } from "@/lib/xmux/store";
import type { VoiceProfile } from "@/lib/xmux/types";
import { ScoreDial } from "./score-dial";
import { ActionBadge, StateBadge, StateDot, pct } from "./status-badge";
import { cn } from "@/lib/utils";

function fmtElapsed(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

export function LiveView() {
  const live = useXmux((s) => s.live);
  const startLive = useXmux((s) => s.startLive);
  const stopLive = useXmux((s) => s.stopLive);
  const resetLive = useXmux((s) => s.resetLive);
  const permissions = useXmux((s) => s.permissions);
  const [profiles, setProfiles] = useState<VoiceProfile[]>([]);
  const [profileId, setProfileId] = useState<string>("none");

  useEffect(() => {
    getProfiles()
      .then(setProfiles)
      .catch(() => setProfiles([]));
  }, []);

  const trendData = useMemo(() => {
    const trend = live.latest?.trend ?? [];
    return trend.map((v, i) => ({ i, risk: Math.round(v * 100) }));
  }, [live.latest?.trend]);

  const policyWarn = 35;
  const policyHigh = 65;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Live Monitor</h1>
          <p className="text-sm text-muted-foreground">
            Real-time voice-integrity monitoring over Socket.IO.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {live.active ? (
            <Button variant="destructive" onClick={stopLive}>
              <Square className="size-4" aria-hidden />
              Stop Session
            </Button>
          ) : (
            <Button
              onClick={() => {
                if (!permissions.liveMonitoring || !permissions.microphoneAccess) {
                  useXmux.getState().setView("settings");
                  return;
                }
                void startLive(profileId === "none" ? null : profileId);
              }}
            >
              <Radio className="size-4" aria-hidden />
              Start Live Session
            </Button>
          )}
          {!live.active && (live.ended || live.latest) && (
            <Button variant="outline" onClick={resetLive}>
              Reset
            </Button>
          )}
        </div>
      </div>

      {/* Session header */}
      <Card>
        <CardContent className="grid grid-cols-2 gap-4 p-4 sm:grid-cols-3 lg:grid-cols-6">
          <Meta
            icon={Activity}
            label="Connection"
            value={
              <span className="flex items-center gap-1.5">
                <StateDot
                  state={live.socketConnected ? "READY" : "UNAVAILABLE"}
                />
                {live.socketConnected ? "Connected" : "Offline"}
              </span>
            }
          />
          <Meta
            icon={Radio}
            label="Audio Source"
            value="Browser Microphone"
          />
          <Meta
            icon={Timer}
            label="Audio Receiving"
            value={live.active ? (live.latest?.receiving ? "Yes" : "Waiting") : "No"}
          />
          <Meta
            icon={MicOff}
            label="Speech Status"
            value={live.latest?.speechStatus ?? "—"}
          />
          <Meta
            icon={Clock}
            label="Elapsed"
            value={live.active ? fmtElapsed(live.elapsedSec) : "—"}
          />
          <Meta
            icon={Activity}
            label="Session"
            value={live.sessionInfo ? live.sessionInfo.sessionId.slice(0, 12) : "—"}
          />
        </CardContent>
      </Card>

      {/* profile selector */}
      <Card>
        <CardContent className="flex flex-wrap items-center gap-3 p-4">
          <span className="text-sm text-muted-foreground">Reference profile</span>
          <Select
            value={profileId}
            onValueChange={setProfileId}
            disabled={live.active}
          >
            <SelectTrigger className="w-full sm:w-64">
              <SelectValue />
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
          {live.active && (
            <span className="text-xs text-muted-foreground">
              Stop the session to change the reference profile.
            </span>
          )}
        </CardContent>
      </Card>

      {!live.active && !live.latest ? (
        <EmptyMonitor />
      ) : (
        <>
          {/* Score row */}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
            <ScoreDial
              label="AI Likelihood"
              value={live.latest?.syntheticEvidence ?? null}
              hint={live.latest?.modelsReady.synthetic ? "Synthetic evidence" : "Model unavailable"}
            />
            <ScoreDial
              label="Speaker Similarity"
              value={live.latest?.speakerSimilarity ?? null}
              tone="similarity"
              hint={profileId !== "none" ? "vs reference" : "No profile"}
            />
            <ScoreDial
              label="Audio Quality"
              value={live.latest?.audioQuality ?? null}
              tone="quality"
              hint="Window reliability"
            />
            <ScoreDial
              label="Confidence"
              value={live.latest?.confidence ?? null}
              tone="quality"
              hint="Decision confidence"
            />
            <ScoreDial
              label="Risk Score"
              value={live.latest?.riskScore ?? null}
              tone="risk"
              hint="Smoothed (EWMA)"
            />
          </div>

          {/* State + action */}
          {live.latest && (
            <Card>
              <CardContent className="flex flex-wrap items-center justify-between gap-3 p-4">
                <div className="flex items-center gap-3">
                  <span className="text-sm text-muted-foreground">Current Analysis</span>
                  <span
                    className={cn(
                      "rounded-full px-3 py-1 text-sm font-semibold",
                      live.latest.state === "MONITORING"
                        ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300"
                        : live.latest.state === "SUSPICIOUS"
                          ? "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300"
                          : "bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300",
                    )}
                  >
                    {live.latest.stateLabel}
                  </span>
                  <ActionBadge action={live.latest.recommendedAction} />
                </div>
                <div className="text-sm text-muted-foreground">
                  Verdict: <span className="font-medium text-foreground">{live.latest.verdict}</span>
                  {" · "}Latency {Math.round(live.latest.latencyMs)} ms
                  {" · "}Windows {live.latest.trend.length}
                </div>
              </CardContent>
            </Card>
          )}

          {/* Risk trend */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-semibold">Risk Trend</CardTitle>
              <CardDescription>
                Smoothed risk over the analysis windows (1 Hz). Reference lines
                show the configured warn / high policy thresholds.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {trendData.length >= 2 ? (
                <div className="h-56 w-full">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={trendData} margin={{ top: 8, right: 8, bottom: 0, left: -18 }}>
                      <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                      <XAxis dataKey="i" tick={{ fontSize: 10 }} className="text-muted-foreground" />
                      <YAxis domain={[0, 100]} tick={{ fontSize: 10 }} className="text-muted-foreground" />
                      <Tooltip
                        formatter={(v) => [`${v}%`, "Risk"]}
                        labelFormatter={(i) => `window ${i}`}
                        contentStyle={{ fontSize: 12 }}
                      />
                      <ReferenceLine y={policyWarn} stroke="#f59e0b" strokeDasharray="4 4" />
                      <ReferenceLine y={policyHigh} stroke="#ef4444" strokeDasharray="4 4" />
                      <Line
                        type="monotone"
                        dataKey="risk"
                        stroke="var(--color-chart-1)"
                        strokeWidth={2}
                        dot={false}
                        isAnimationActive={false}
                      />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              ) : (
                <p className="py-8 text-center text-sm text-muted-foreground">
                  Waiting for at least two analysis windows…
                </p>
              )}
            </CardContent>
          </Card>

          {/* Alerts / timeline */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center gap-2 text-sm font-semibold">
                <ShieldAlert className="size-4 text-primary" aria-hidden />
                Timeline & Alerts
              </CardTitle>
              <CardDescription>
                Alerts fire only on meaningful state transitions.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {live.alerts.length === 0 ? (
                <p className="py-4 text-center text-sm text-muted-foreground">
                  No alerts — no state transitions have occurred.
                </p>
              ) : (
                <ScrollArea className="xmux-scroll max-h-72 pr-3">
                  <ul className="space-y-2">
                    {live.alerts.map((a, i) => (
                      <li
                        key={i}
                        className={cn(
                          "flex items-start gap-3 rounded-lg border p-3",
                          a.type === "SECURITY_ALERT"
                            ? "border-red-200 bg-red-50 dark:border-red-900 dark:bg-red-950/40"
                            : "border-amber-200 bg-amber-50 dark:border-amber-900 dark:bg-amber-950/40",
                        )}
                      >
                        <span className="mt-0.5">
                          <StateBadge state={a.type === "SECURITY_ALERT" ? "ERROR" : "DEGRADED"} />
                        </span>
                        <div className="min-w-0 flex-1">
                          <p className="text-sm">{a.message}</p>
                          <p className="mt-1 text-xs text-muted-foreground">
                            {fmtElapsed(Math.round(a.t))} · risk{" "}
                            {a.riskScore !== null && a.riskScore !== undefined
                              ? pct(a.riskScore)
                              : "—"}{" "}
                            · recommended action {a.recommendedAction}
                          </p>
                        </div>
                      </li>
                    ))}
                  </ul>
                </ScrollArea>
              )}
            </CardContent>
          </Card>

          {live.ended && !live.active && (
            <Card>
              <CardContent className="p-4">
                <p className="text-sm">
                  Session ended — final state{" "}
                  <strong>{live.ended.finalState.replace(/_/g, " ")}</strong> after{" "}
                  {fmtElapsed(Math.round(live.ended.durationSec))}. A summary
                  has been recorded in the backend event log.
                </p>
              </CardContent>
            </Card>
          )}
        </>
      )}

      {live.micState === "BLOCKED" && (
        <Card className="border-red-200 dark:border-red-900">
          <CardContent className="p-4 text-sm">
            Microphone access is blocked — either by browser permission or by
            the application policy in Settings. Live capture will not start
            until it is allowed.
          </CardContent>
        </Card>
      )}

      {(live.micState === "UNAVAILABLE" || live.micState === "ERROR") && (
        <Card className="border-amber-200 dark:border-amber-900">
          <CardContent className="p-4 text-sm">
            No microphone is available on this device, so live capture could
            not start. Analyses of uploaded files and recorded clips still
            work without a microphone.
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function Meta({
  icon: Icon,
  label,
  value,
}: {
  icon: React.ElementType;
  label: string;
  value: React.ReactNode;
}) {
  return (
    <div className="space-y-1">
      <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <Icon className="size-3.5" aria-hidden />
        {label}
      </p>
      <p className="text-sm font-medium">{value}</p>
    </div>
  );
}

function EmptyMonitor() {
  return (
    <Card>
      <CardContent className="flex flex-col items-center gap-3 p-10 text-center">
        <span className="flex size-12 items-center justify-center rounded-full bg-muted">
          <Radio className="size-6 text-muted-foreground" aria-hidden />
        </span>
        <p className="font-medium">No live session yet</p>
        <p className="max-w-md text-sm text-muted-foreground">
          Start a session to stream microphone audio to the X-MUX backend.
          Speech status, evidence scores, risk trend and alerts will appear
          here as they are computed — nothing is simulated.
        </p>
      </CardContent>
    </Card>
  );
}
