"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { useTheme } from "next-themes";
import {
  Activity,
  FileText,
  Fingerprint,
  HeartPulse,
  Moon,
  Settings,
  Sun,
  Waves,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useXmux } from "@/lib/xmux/store";
import { getHealth } from "@/lib/xmux/api";
import type { ViewId } from "@/lib/xmux/types";
import { StateDot } from "./status-badge";

const NAV: { id: ViewId; label: string; icon: React.ElementType }[] = [
  { id: "analyze", label: "Analyze Voice", icon: Waves },
  { id: "live", label: "Live Monitor", icon: Activity },
  { id: "profiles", label: "Voice Profiles", icon: Fingerprint },
  { id: "reports", label: "Reports", icon: FileText },
  { id: "settings", label: "Settings", icon: Settings },
  { id: "health", label: "System Health", icon: HeartPulse },
];

const emptySubscribe = () => () => {};

export function AppShell({ children }: { children: React.ReactNode }) {
  const view = useXmux((s) => s.view);
  const setView = useXmux((s) => s.setView);
  const { theme, setTheme, resolvedTheme } = useTheme();
  // hydration-safe mounted flag without setState-in-effect
  const mounted = useSyncExternalStore(
    emptySubscribe,
    () => true,
    () => false,
  );
  const [systemStatus, setSystemStatus] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const poll = async () => {
      try {
        const health = await getHealth();
        if (!cancelled) setSystemStatus(health.status);
      } catch {
        if (!cancelled) setSystemStatus("ERROR");
      }
    };
    void poll();
    const id = window.setInterval(poll, 15000);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, []);

  return (
    <div className="min-h-screen flex flex-col bg-background text-foreground">
      <header className="sticky top-0 z-40 border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80">
        <div className="mx-auto flex h-14 max-w-6xl items-center gap-3 px-4">
          <Link
            href="/"
            className="flex items-center gap-2.5"
            aria-label="X-MUX home"
          >
            <span className="flex size-8 items-center justify-center rounded-lg bg-primary text-primary-foreground">
              <Waves className="size-4.5" aria-hidden />
            </span>
            <span className="flex flex-col leading-none">
              <span className="text-base font-bold tracking-tight">X-MUX</span>
              <span className="text-[11px] text-muted-foreground">Voice Integrity</span>
            </span>
          </Link>
          <div className="ml-auto flex items-center gap-2">
            {systemStatus && (
              <span
                className="hidden sm:inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs text-muted-foreground"
                title={`System status: ${systemStatus}`}
              >
                <StateDot state={systemStatus === "READY" ? "READY" : "DEGRADED"} />
                System {systemStatus === "READY" ? "Ready" : "Degraded"}
              </span>
            )}
            <Button
              variant="ghost"
              size="icon"
              aria-label="Toggle theme"
              onClick={() => setTheme(resolvedTheme === "dark" ? "light" : "dark")}
            >
              {mounted && theme !== undefined ? (
                resolvedTheme === "dark" ? <Sun className="size-4.5" /> : <Moon className="size-4.5" />
              ) : (
                <Moon className="size-4.5 opacity-0" />
              )}
            </Button>
          </div>
        </div>
        {/* mobile tab bar */}
        <nav aria-label="Main navigation" className="md:hidden">
          <div className="xmux-scroll flex gap-1 overflow-x-auto px-2 pb-2">
            {NAV.map((item) => (
              <button
                key={item.id}
                onClick={() => setView(item.id)}
                className={cn(
                  "inline-flex min-h-9 items-center gap-1.5 whitespace-nowrap rounded-full px-3 py-1.5 text-xs font-medium transition-colors",
                  view === item.id
                    ? "bg-primary text-primary-foreground"
                    : "bg-muted text-muted-foreground hover:text-foreground",
                )}
              >
                <item.icon className="size-3.5" aria-hidden />
                {item.label}
              </button>
            ))}
          </div>
        </nav>
      </header>

      <div className="mx-auto flex w-full max-w-6xl flex-1 gap-6 px-4 py-6">
        <aside className="hidden md:block" aria-label="Sidebar">
          <nav className="sticky top-20 flex w-52 flex-col gap-1">
            {NAV.map((item) => (
              <button
                key={item.id}
                onClick={() => setView(item.id)}
                aria-current={view === item.id ? "page" : undefined}
                className={cn(
                  "flex min-h-11 items-center gap-3 rounded-lg px-3 text-sm font-medium transition-colors",
                  view === item.id
                    ? "bg-primary/10 text-primary"
                    : "text-muted-foreground hover:bg-muted hover:text-foreground",
                )}
              >
                <item.icon className="size-4.5 shrink-0" aria-hidden />
                {item.label}
              </button>
            ))}
          </nav>
        </aside>
        <main className="min-w-0 flex-1 pb-6">{children}</main>
      </div>

      <footer className="mt-auto border-t bg-background">
        <div className="mx-auto max-w-6xl px-4 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
          <p className="text-center text-xs text-muted-foreground">
            X-MUX — voice integrity evidence supports security decisions; it does not replace them.
          </p>
        </div>
      </footer>
    </div>
  );
}
