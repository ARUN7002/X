"use client";

import { useEffect, useState } from "react";
import { useTheme } from "next-themes";
import {
  Bell,
  Check,
  Cpu,
  Loader2,
  Lock,
  Monitor,
  Moon,
  Palette,
  Save,
  Settings2,
  ShieldCheck,
  Sun,
} from "lucide-react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { ChevronDown } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { getSettings, putSettings } from "@/lib/xmux/api";
import { permissionLabels, useXmux } from "@/lib/xmux/store";
import type { PermissionKey } from "@/lib/xmux/store";
import type { ModelInfo, Policy } from "@/lib/xmux/types";
import { StateBadge } from "./status-badge";
import { cn } from "@/lib/utils";

const PERMISSION_NOTES: Partial<Record<PermissionKey, string>> = {
  microphoneAccess: "Required for microphone recording and live sessions.",
  liveAudioCapture: "Streams browser microphone audio to the backend while a live session is active.",
  liveMonitoring: "Enables starting live sessions and the Live Monitor.",
  voiceEnrollment: "Allows creating new reference voice profiles.",
  voiceProfileAccess: "Allows analyses to compare against enrolled profiles.",
  reportsAccess: "Allows viewing stored analysis reports.",
  notifications: "Shows browser notifications for high-risk live alerts.",
  rawAudioPersistence: "Application-level retention preference. Audio is otherwise processed transiently.",
};

export function SettingsView() {
  const { theme, setTheme } = useTheme();
  const permissions = useXmux((s) => s.permissions);
  const setPermission = useXmux((s) => s.setPermission);
  const [policy, setPolicy] = useState<Policy | null>(null);
  const [models, setModels] = useState<ModelInfo[]>([]);
  const [saving, setSaving] = useState(false);
  const [notifPermission, setNotifPermission] = useState<string>("default");
  const { toast } = useToast();

  useEffect(() => {
    getSettings()
      .then((s) => {
        setPolicy(s.policy);
        setModels(s.models);
      })
      .catch(() => {
        setPolicy(null);
        setModels([]);
      });
    if (typeof Notification !== "undefined") {
      setNotifPermission(Notification.permission);
    }
  }, []);

  const savePolicy = async () => {
    if (!policy) return;
    setSaving(true);
    try {
      const res = await putSettings({
        risk_warn: policy.risk_warn,
        risk_high: policy.risk_high,
        speaker_threshold: policy.speaker_threshold,
        raw_audio_retention: policy.raw_audio_retention,
        retention_days: policy.retention_days,
        notifications_enabled: policy.notifications_enabled,
      });
      setPolicy(res.policy);
      toast({ title: "Analysis policy saved" });
    } catch (err) {
      toast({
        title: "Could not save policy",
        description: err instanceof Error ? err.message : undefined,
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Settings</h1>
        <p className="text-sm text-muted-foreground">
          Appearance, application permissions, analysis policy and model
          configuration.
        </p>
      </div>

      {/* Appearance */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <Palette className="size-4.5 text-primary" aria-hidden />
            Appearance
          </CardTitle>
        </CardHeader>
        <CardContent>
          <RadioGroup
            value={theme ?? "system"}
            onValueChange={setTheme}
            className="flex flex-wrap gap-4"
          >
            <ThemeOption value="light" icon={Sun} label="Light" />
            <ThemeOption value="dark" icon={Moon} label="Dark" />
            <ThemeOption value="system" icon={Monitor} label="System" />
          </RadioGroup>
        </CardContent>
      </Card>

      {/* Application permissions */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <Lock className="size-4.5 text-primary" aria-hidden />
            Application Permissions
          </CardTitle>
          <CardDescription>
            Application policy only — it cannot override the operating system
            or browser permissions.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-1">
          {(Object.keys(permissionLabels) as PermissionKey[]).map((key) => (
            <div
              key={key}
              className="flex items-center justify-between gap-4 rounded-lg px-2 py-2.5 hover:bg-muted/50"
            >
              <div className="min-w-0">
                <Label htmlFor={`perm-${key}`} className="text-sm font-medium">
                  {permissionLabels[key]}
                </Label>
                {PERMISSION_NOTES[key] && (
                  <p className="text-xs text-muted-foreground">
                    {PERMISSION_NOTES[key]}
                  </p>
                )}
              </div>
              <Switch
                id={`perm-${key}`}
                checked={permissions[key]}
                onCheckedChange={(v) => setPermission(key, v)}
                aria-label={`${permissionLabels[key]}: ${permissions[key] ? "Allow" : "Block"}`}
              />
            </div>
          ))}
          {permissions.notifications && notifPermission === "default" && (
            <div className="mt-2 flex items-center justify-between gap-4 rounded-lg border border-dashed px-3 py-2.5">
              <div>
                <p className="text-sm font-medium">Browser notifications</p>
                <p className="text-xs text-muted-foreground">
                  The browser has not yet been asked for notification
                  permission.
                </p>
              </div>
              <Button
                size="sm"
                variant="outline"
                onClick={async () => {
                  if (typeof Notification !== "undefined") {
                    const p = await Notification.requestPermission();
                    setNotifPermission(p);
                  }
                }}
              >
                <Bell className="size-4" aria-hidden />
                Ask
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Analysis policy (server) */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <Settings2 className="size-4.5 text-primary" aria-hidden />
            Analysis Policy
          </CardTitle>
          <CardDescription>
            Operational thresholds used by the risk engine. These are
            configurable policy values, not validated calibration points.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {policy ? (
            <>
              <PolicySlider
                label="Warn threshold"
                description="Risk at or above this level is marked ELEVATED RISK."
                value={policy.risk_warn}
                onChange={(v) => setPolicy({ ...policy, risk_warn: v[0] })}
              />
              <PolicySlider
                label="High risk threshold"
                description="Risk at or above this level is marked HIGH RISK."
                value={policy.risk_high}
                onChange={(v) => setPolicy({ ...policy, risk_high: v[0] })}
              />
              <PolicySlider
                label="Speaker similarity threshold"
                description="Cosine similarity below this value counts as a speaker mismatch."
                value={policy.speaker_threshold}
                min={-1}
                max={1}
                step={0.05}
                format={(v) => v.toFixed(2)}
                onChange={(v) => setPolicy({ ...policy, speaker_threshold: v[0] })}
              />
              <div className="flex flex-wrap items-center justify-between gap-4 rounded-lg border border-dashed p-3">
                <div>
                  <p className="text-sm font-medium">Raw audio retention</p>
                  <p className="text-xs text-muted-foreground">
                    When off (recommended), audio is processed transiently and
                    only derived evidence is stored.
                  </p>
                </div>
                <Switch
                  checked={policy.raw_audio_retention}
                  onCheckedChange={(v) => setPolicy({ ...policy, raw_audio_retention: v })}
                  aria-label="Raw audio retention"
                />
              </div>
              <div className="flex justify-end">
                <Button onClick={savePolicy} disabled={saving}>
                  {saving ? (
                    <Loader2 className="size-4 animate-spin" aria-hidden />
                  ) : (
                    <Save className="size-4" aria-hidden />
                  )}
                  Save Policy
                </Button>
              </div>
            </>
          ) : (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" aria-hidden />
              Loading policy from backend…
            </div>
          )}
        </CardContent>
      </Card>

      {/* Model configuration */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <Cpu className="size-4.5 text-primary" aria-hidden />
            Model Configuration
          </CardTitle>
          <CardDescription>
            Read-only model status and versions. Technical details are shown
            here only — the dashboard stays simple.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          {models.length === 0 ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" aria-hidden />
              Loading model configuration…
            </div>
          ) : (
            models.map((m) => (
              <Collapsible key={m.component}>
                <div className="rounded-lg border px-3 py-2.5">
                  <CollapsibleTrigger className="flex w-full items-center justify-between gap-3 text-left">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-medium">{componentLabel(m.component)}</span>
                      <StateBadge state={m.inference_ready ? "READY" : "UNAVAILABLE"} />
                    </div>
                    <ChevronDown className="size-4 text-muted-foreground" aria-hidden />
                  </CollapsibleTrigger>
                  <CollapsibleContent>
                    <div className="mt-3 space-y-1.5 border-t pt-3 text-xs text-muted-foreground">
                      <InfoRow label="Model" value={`${m.model_name} (${m.model_version})`} />
                      <InfoRow label="Checkpoint" value={m.checkpoint_identifier} />
                      {m.sha256 && (
                        <InfoRow label="SHA-256" value={`${m.sha256.slice(0, 16)}…`} />
                      )}
                      {m.input_sample_rate && (
                        <InfoRow
                          label="Input"
                          value={`${m.input_sample_rate} Hz · ${m.input_window ?? "variable"}`}
                        />
                      )}
                      <InfoRow label="Output semantics" value={m.output_semantics} />
                      <InfoRow label="Source" value={m.source} />
                      {m.device && <InfoRow label="Device" value={m.device} />}
                      {m.note && <InfoRow label="Status note" value={m.note} />}
                    </div>
                  </CollapsibleContent>
                </div>
              </Collapsible>
            ))
          )}
          <div className="rounded-lg border px-3 py-2.5">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium">Transcription</span>
              <StateBadge state="UNAVAILABLE" />
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              Optional component (Whisper) — not enabled in this deployment.
            </p>
          </div>
        </CardContent>
      </Card>

      {/* Privacy */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <ShieldCheck className="size-4.5 text-primary" aria-hidden />
            Privacy
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm text-muted-foreground">
          <p>
            Audio is processed transiently: uploaded files are decoded,
            analyzed and deleted within the request. Only derived evidence
            (scores, features, verdicts) is stored.
          </p>
          <p>
            Voice profiles store a speaker embedding — a mathematical
            representation — not the raw enrollment audio.
          </p>
          <p>
            Retention of stored reports and events follows the retention
            policy configured by the administrator.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}

function ThemeOption({
  value,
  icon: Icon,
  label,
}: {
  value: string;
  icon: React.ElementType;
  label: string;
}) {
  return (
    <Label
      className={cn(
        "flex min-h-11 cursor-pointer items-center gap-2 rounded-lg border px-4 py-2 text-sm font-medium has-[:checked]:border-primary has-[:checked]:bg-primary/5",
      )}
    >
      <RadioGroupItem value={value} />
      <Icon className="size-4" aria-hidden />
      {label}
    </Label>
  );
}

function PolicySlider({
  label,
  description,
  value,
  onChange,
  min = 0,
  max = 1,
  step = 0.05,
  format,
}: {
  label: string;
  description: string;
  value: number;
  onChange: (v: number[]) => void;
  min?: number;
  max?: number;
  step?: number;
  format?: (v: number) => string;
}) {
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <Label className="text-sm font-medium">{label}</Label>
        <span className="rounded-md bg-muted px-2 py-0.5 text-xs font-mono tabular-nums">
          {format ? format(value) : `${Math.round(value * 100)}%`}
        </span>
      </div>
      <Slider
        value={[value]}
        min={min}
        max={max}
        step={step}
        onValueChange={onChange}
        aria-label={label}
      />
      <p className="text-xs text-muted-foreground">{description}</p>
    </div>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-4">
      <span className="shrink-0">{label}</span>
      <span className="text-right font-mono text-[11px] leading-relaxed text-foreground/80">
        {value}
      </span>
    </div>
  );
}

function componentLabel(component: string): string {
  switch (component) {
    case "synthetic_detection":
      return "Synthetic Detection";
    case "speaker_verification":
      return "Speaker Verification";
    case "speech_activity":
      return "Speech Activity";
    default:
      return component;
  }
}

export { Check };
