"use client";

import type { ComponentState, RecommendedAction } from "@/lib/xmux/types";
import { cn } from "@/lib/utils";

export function StateBadge({ state, className }: { state: ComponentState | string; className?: string }) {
  const map: Record<string, string> = {
    READY: "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300",
    DEGRADED: "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300",
    UNAVAILABLE: "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300",
    ERROR: "bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300",
    PERMISSION_REQUIRED: "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300",
    BLOCKED: "bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300",
    UNAVAILABLE_: "",
  };
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium whitespace-nowrap",
        map[state] ?? map.UNAVAILABLE,
        className,
      )}
    >
      <StateDot state={state} />
      {state.replace(/_/g, " ")}
    </span>
  );
}

export function StateDot({ state }: { state: string }) {
  const map: Record<string, string> = {
    READY: "bg-emerald-500",
    DEGRADED: "bg-amber-500",
    UNAVAILABLE: "bg-zinc-400",
    ERROR: "bg-red-500",
    BLOCKED: "bg-red-500",
    PERMISSION_REQUIRED: "bg-zinc-400",
  };
  return (
    <span
      aria-hidden
      className={cn("size-1.5 rounded-full", map[state] ?? "bg-zinc-400")}
    />
  );
}

export function verdictTone(verdict: string): string {
  switch (verdict) {
    case "LOW RISK":
      return "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300";
    case "ELEVATED RISK":
      return "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300";
    case "HIGH RISK":
      return "bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300";
    default:
      return "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300";
  }
}

export function VerdictBadge({ verdict }: { verdict: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-3 py-1 text-sm font-semibold",
        verdictTone(verdict),
      )}
    >
      {verdict}
    </span>
  );
}

const ACTION_TONES: Record<string, string> = {
  ALLOW: "bg-emerald-600 text-white",
  WARN: "bg-amber-500 text-white",
  VERIFY: "bg-amber-600 text-white",
  BLOCK: "bg-red-600 text-white",
  ESCALATE: "bg-red-700 text-white",
};

export function ActionBadge({ action }: { action: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-md px-2.5 py-1 text-xs font-semibold tracking-wide",
        ACTION_TONES[action] ?? "bg-zinc-600 text-white",
      )}
    >
      {action}
    </span>
  );
}

export function pct(v: number | null | undefined): string {
  if (v === null || v === undefined || Number.isNaN(v)) return "—";
  return `${Math.round(Math.max(0, Math.min(1, v)) * 100)}%`;
}

export function actionFromVerdict(verdict: string): RecommendedAction {
  switch (verdict) {
    case "LOW RISK":
      return "ALLOW";
    case "ELEVATED RISK":
      return "WARN";
    case "HIGH RISK":
      return "BLOCK";
    default:
      return "VERIFY";
  }
}
