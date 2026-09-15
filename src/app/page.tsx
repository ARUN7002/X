"use client";

import { AppShell } from "@/components/xmux/app-shell";
import { AnalyzeView } from "@/components/xmux/analyze-view";
import { LiveView } from "@/components/xmux/live-view";
import { ProfilesView } from "@/components/xmux/profiles-view";
import { ReportsView } from "@/components/xmux/reports-view";
import { SettingsView } from "@/components/xmux/settings-view";
import { HealthView } from "@/components/xmux/health-view";
import { useXmux } from "@/lib/xmux/store";

export default function Home() {
  const view = useXmux((s) => s.view);

  return (
    <AppShell>
      {view === "analyze" && <AnalyzeView />}
      {view === "live" && <LiveView />}
      {view === "profiles" && <ProfilesView />}
      {view === "reports" && <ReportsView />}
      {view === "settings" && <SettingsView />}
      {view === "health" && <HealthView />}
    </AppShell>
  );
}
