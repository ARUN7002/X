/**
 * X-MUX frontend API client.
 *
 * All requests use RELATIVE paths to this Next.js app; a server-side
 * proxy route forwards them to the ML backend (XMUX_BACKEND_URL in
 * production, local backend in development). The browser never talks
 * to the backend directly for REST calls.
 */

import type {
  AnalysisResult,
  HealthResponse,
  ReportSummary,
  SettingsResponse,
  VoiceProfile,
} from "./types";

const BASE = "/api/xmux";

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

async function parse(response: Response) {
  if (!response.ok) {
    let detail = `request failed (${response.status})`;
    try {
      const body = await response.json();
      if (body?.detail) detail = String(body.detail);
    } catch {
      /* keep default */
    }
    throw new ApiError(response.status, detail);
  }
  return response.json();
}

export async function getHealth(): Promise<HealthResponse> {
  return parse(await fetch(`${BASE}/health`, { cache: "no-store" }));
}

export async function analyzeAudio(
  file: Blob,
  filename: string,
  source: "UPLOAD" | "MICROPHONE",
  profileId?: string | null,
): Promise<AnalysisResult> {
  const form = new FormData();
  form.append("file", file, filename);
  form.append("source", source);
  if (profileId) form.append("profileId", profileId);
  return parse(await fetch(`${BASE}/analyze`, { method: "POST", body: form }));
}

export async function getReports(limit = 50): Promise<ReportSummary[]> {
  const data = await parse(
    await fetch(`${BASE}/reports?limit=${limit}`, { cache: "no-store" }),
  );
  return data.reports ?? [];
}

export async function getReport(id: string): Promise<AnalysisResult> {
  return parse(await fetch(`${BASE}/reports/${id}`, { cache: "no-store" }));
}

export async function deleteReport(id: string): Promise<void> {
  await parse(await fetch(`${BASE}/reports/${id}`, { method: "DELETE" }));
}

export async function getProfiles(): Promise<VoiceProfile[]> {
  const data = await parse(
    await fetch(`${BASE}/profiles`, { cache: "no-store" }),
  );
  return data.profiles ?? [];
}

export async function enrollProfile(
  file: Blob,
  name: string,
): Promise<VoiceProfile> {
  const form = new FormData();
  form.append("file", file, "enrollment.webm");
  form.append("name", name);
  return parse(
    await fetch(`${BASE}/profiles`, { method: "POST", body: form }),
  );
}

export async function deleteProfile(id: string): Promise<void> {
  await parse(await fetch(`${BASE}/profiles/${id}`, { method: "DELETE" }));
}

export async function getSettings(): Promise<SettingsResponse> {
  return parse(await fetch(`${BASE}/settings`, { cache: "no-store" }));
}

export async function putSettings(
  patch: Record<string, unknown>,
): Promise<SettingsResponse> {
  return parse(
    await fetch(`${BASE}/settings`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    }),
  );
}
