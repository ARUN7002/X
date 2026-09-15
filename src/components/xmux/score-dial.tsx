"use client";

import { cn } from "@/lib/utils";

interface ScoreDialProps {
  label: string;
  value: number | null | undefined; // 0..1
  hint?: string;
  tone?: "risk" | "quality" | "neutral" | "similarity";
  size?: "sm" | "md";
}

function toneColor(tone: ScoreDialProps["tone"], v: number): string {
  if (tone === "quality") {
    return v >= 0.7 ? "stroke-emerald-500" : v >= 0.45 ? "stroke-amber-500" : "stroke-red-500";
  }
  if (tone === "similarity") {
    return v >= 0.5 ? "stroke-emerald-500" : v >= 0.25 ? "stroke-amber-500" : "stroke-red-500";
  }
  if (tone === "risk") {
    return v >= 0.65 ? "stroke-red-500" : v >= 0.35 ? "stroke-amber-500" : "stroke-emerald-500";
  }
  // neutral / AI likelihood: zinc dial so we never imply certainty
  return "stroke-primary";
}

export function ScoreDial({ label, value, hint, tone = "neutral", size = "md" }: ScoreDialProps) {
  const dimension = size === "sm" ? 72 : 96;
  const strokeWidth = size === "sm" ? 6 : 8;
  const radius = (dimension - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const has = typeof value === "number" && !Number.isNaN(value);
  const v = has ? Math.max(0, Math.min(1, value as number)) : 0;
  const dash = has ? circumference * v : 0;

  return (
    <div
      className="flex flex-col items-center gap-1.5 rounded-lg border bg-card p-3 text-center"
      aria-label={`${label}: ${has ? `${Math.round(v * 100)}%` : "unavailable"}`}
    >
      <div className="relative" style={{ width: dimension, height: dimension }}>
        <svg width={dimension} height={dimension} className="-rotate-90">
          <circle
            cx={dimension / 2}
            cy={dimension / 2}
            r={radius}
            className="stroke-muted"
            strokeWidth={strokeWidth}
            fill="none"
          />
          {has && (
            <circle
              cx={dimension / 2}
              cy={dimension / 2}
              r={radius}
              className={cn("transition-[stroke-dasharray] duration-500", toneColor(tone, v))}
              strokeWidth={strokeWidth}
              fill="none"
              strokeLinecap="round"
              strokeDasharray={`${dash} ${circumdash(circumference, dash)}`}
            />
          )}
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className={cn("font-semibold tabular-nums", size === "sm" ? "text-lg" : "text-2xl")}>
            {has ? Math.round(v * 100) : "—"}
          </span>
          {has && <span className="text-[10px] text-muted-foreground">/ 100</span>}
        </div>
      </div>
      <div className="text-xs font-medium leading-tight">{label}</div>
      {hint && <div className="text-[10px] text-muted-foreground leading-tight">{hint}</div>}
    </div>
  );
}

function circumdash(circumference: number, dash: number): number {
  return Math.max(0.01, circumference - dash);
}
