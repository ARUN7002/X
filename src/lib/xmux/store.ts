/**
 * X-MUX client state (zustand): navigation, live session, permissions.
 * Server state (health, reports, profiles, policy) is fetched on demand.
 */

"use client";

import { create } from "zustand";
import type {
  LiveAlert,
  LiveAnalysis,
  LiveEndSummary,
  LiveSessionInfo,
  MicState,
  ViewId,
} from "./types";
import { getLiveSocket } from "./socket";

export type PermissionKey =
  | "microphoneAccess"
  | "liveAudioCapture"
  | "liveMonitoring"
  | "voiceEnrollment"
  | "voiceProfileAccess"
  | "reportsAccess"
  | "notifications"
  | "rawAudioPersistence";

const PERMISSION_LABELS: Record<PermissionKey, string> = {
  microphoneAccess: "Microphone Access",
  liveAudioCapture: "Live Audio Capture",
  liveMonitoring: "Live Monitoring",
  voiceEnrollment: "Voice Enrollment",
  voiceProfileAccess: "Voice Profile Access",
  reportsAccess: "Reports",
  notifications: "Notifications",
  rawAudioPersistence: "Raw Audio Persistence",
};

export const permissionLabels = PERMISSION_LABELS;

const DEFAULT_PERMISSIONS: Record<PermissionKey, boolean> = {
  microphoneAccess: true,
  liveAudioCapture: true,
  liveMonitoring: true,
  voiceEnrollment: true,
  voiceProfileAccess: true,
  reportsAccess: true,
  notifications: true,
  rawAudioPersistence: false,
};

const PERMISSION_STORAGE_KEY = "xmux.permissions.v1";

function loadPermissions(): Record<PermissionKey, boolean> {
  if (typeof window === "undefined") return { ...DEFAULT_PERMISSIONS };
  try {
    const raw = window.localStorage.getItem(PERMISSION_STORAGE_KEY);
    if (raw) return { ...DEFAULT_PERMISSIONS, ...JSON.parse(raw) };
  } catch {
    /* ignore corrupted storage */
  }
  return { ...DEFAULT_PERMISSIONS };
}

function savePermissions(perms: Record<PermissionKey, boolean>) {
  try {
    window.localStorage.setItem(
      PERMISSION_STORAGE_KEY,
      JSON.stringify(perms),
    );
  } catch {
    /* storage unavailable */
  }
}

interface LiveState {
  socketConnected: boolean;
  active: boolean;
  sessionInfo: LiveSessionInfo | null;
  latest: LiveAnalysis | null;
  alerts: LiveAlert[];
  ended: LiveEndSummary | null;
  micState: MicState;
  elapsedSec: number;
}

interface XmuxStore {
  view: ViewId;
  setView: (v: ViewId) => void;

  permissions: Record<PermissionKey, boolean>;
  setPermission: (key: PermissionKey, allow: boolean) => void;

  live: LiveState;
  startLive: (profileId: string | null) => void;
  stopLive: () => void;
  setMicState: (s: MicState) => void;
  tickElapsed: () => void;
  resetLive: () => void;
}

let audio: {
  ctx: AudioContext;
  stream: MediaStream;
  worklet: AudioWorkletNode;
  source: MediaStreamAudioSourceNode;
  buffer: Float32Array[];
  buffered: number;
} | null = null;

const CHUNK_TARGET = 24000; // ~0.5 s at 48 kHz before rate conversion

export const useXmux = create<XmuxStore>((set, get) => ({
  view: "analyze",
  setView: (v) => set({ view: v }),

  permissions: DEFAULT_PERMISSIONS,
  setPermission: (key, allow) => {
    const next = { ...get().permissions, [key]: allow };
    savePermissions(next);
    set({ permissions: next });
  },

  live: {
    socketConnected: false,
    active: false,
    sessionInfo: null,
    latest: null,
    alerts: [],
    ended: null,
    micState: "PERMISSION_REQUIRED",
    elapsedSec: 0,
  },

  setMicState: (s) =>
    set((st) => ({ live: { ...st.live, micState: s } })),

  tickElapsed: () => {
    const { live } = get();
    if (live.active && live.sessionInfo) {
      set({
        live: {
          ...live,
          elapsedSec: Math.max(
            0,
            Math.round((Date.now() - live.sessionInfo.startedAt * 1000) / 1000),
          ),
        },
      });
    }
  },

  resetLive: () =>
    set({
      live: {
        socketConnected: false,
        active: false,
        sessionInfo: null,
        latest: null,
        alerts: [],
        ended: null,
        micState: "PERMISSION_REQUIRED",
        elapsedSec: 0,
      },
    }),

  startLive: async (profileId) => {
    const { permissions } = get();
    if (!permissions.microphoneAccess || !permissions.liveAudioCapture) {
      get().setMicState("BLOCKED");
      return;
    }
    try {
      // 1) socket
      const socket = getLiveSocket();
      const wire = () => {
        socket.on("session", (info: LiveSessionInfo) => {
          set((st) => ({
            live: { ...st.live, sessionInfo: info, active: true },
          }));
        });
        socket.on("analysis", (a: LiveAnalysis) => {
          set((st) => ({ live: { ...st.live, latest: a } }));
        });
        socket.on("alert", (alert: LiveAlert) => {
          set((st) => ({
            live: {
              ...st.live,
              alerts: [alert, ...st.live.alerts].slice(0, 50),
            },
          }));
          const enabled = get().permissions.notifications;
          if (
            enabled && typeof window !== "undefined" &&
            "Notification" in window &&
            Notification.permission === "granted" &&
            alert.type === "SECURITY_ALERT"
          ) {
            new Notification("X-MUX Security Alert", {
              body: alert.message,
            });
          }
        });
        socket.on("ended", (summary: LiveEndSummary) => {
          set((st) => ({ live: { ...st.live, ended: summary, active: false } }));
        });
        socket.on("error", (err: { message?: string }) => {
          if (err?.message) console.warn("live error:", err.message);
        });
        socket.on("disconnect", () => {
          set((st) => ({
            live: { ...st.live, socketConnected: false },
          }));
        });
        socket.on("connect", () => {
          set((st) => ({ live: { ...st.live, socketConnected: true } }));
        });
      };
      wire();
      socket.connect();

      // 2) microphone — explicit permission, never automatic
      get().setMicState("PERMISSION_REQUIRED");
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false,
        },
      });
      get().setMicState("READY");

      const ctx = new AudioContext();
      await ctx.audioWorklet.addModule("/pcm-worklet.js");
      const source = ctx.createMediaStreamSource(stream);
      const worklet = new AudioWorkletNode(ctx, "pcm-capture");

      const state = {
        ctx,
        stream,
        worklet,
        source,
        buffer: [] as Float32Array[],
        buffered: 0,
      };
      audio = state;

      worklet.port.onmessage = (ev: MessageEvent<Float32Array>) => {
        const chunk = ev.data;
        state.buffer.push(chunk);
        state.buffered += chunk.length;
        if (state.buffered >= CHUNK_TARGET) {
          const merged = new Float32Array(state.buffered);
          let off = 0;
          for (const c of state.buffer) {
            merged.set(c, off);
            off += c.length;
          }
          state.buffer = [];
          state.buffered = 0;
          // float32 -> int16 PCM -> base64
          const pcm = new Int16Array(merged.length);
          for (let i = 0; i < merged.length; i++) {
            const v = Math.max(-1, Math.min(1, merged[i]));
            pcm[i] = v < 0 ? v * 0x8000 : v * 0x7fff;
          }
          const bytes = new Uint8Array(pcm.buffer);
          let bin = "";
          const STEP = 0x8000;
          for (let i = 0; i < bytes.length; i += STEP) {
            bin += String.fromCharCode(
              ...Array.from(bytes.subarray(i, i + STEP)),
            );
          }
          socket.emit("audio_chunk", {
            data: btoa(bin),
            sampleRate: ctx.sampleRate,
          });
        }
      };

      source.connect(worklet);
      // worklet has no output destination — connect to a zero gain to keep
      // the graph alive in every browser
      const sink = ctx.createGain();
      sink.gain.value = 0;
      worklet.connect(sink);
      sink.connect(ctx.destination);

      socket.emit("start", { profileId });
    } catch (err) {
      const name = (err as DOMException)?.name;
      if (name === "NotAllowedError" || name === "SecurityError") {
        get().setMicState("BLOCKED");
      } else if (name === "NotFoundError" || name === "OverconstrainedError") {
        get().setMicState("UNAVAILABLE");
      } else {
        get().setMicState("ERROR");
      }
    }
  },

  stopLive: () => {
    const socket = getLiveSocket();
    socket.emit("stop", {});
    if (audio) {
      try {
        audio.worklet.port.close?.();
        audio.worklet.disconnect();
        audio.source.disconnect();
        audio.stream.getTracks().forEach((t) => t.stop());
        void audio.ctx.close();
      } catch {
        /* already closed */
      }
      audio = null;
    }
  },
}));

// rehydrate persisted permissions on client
if (typeof window !== "undefined") {
  const perms = loadPermissions();
  useXmux.setState({ permissions: perms });
}

// elapsed-time ticker
if (typeof window !== "undefined") {
  window.setInterval(() => {
    if (useXmux.getState().live.active) useXmux.getState().tickElapsed();
  }, 1000);
}
