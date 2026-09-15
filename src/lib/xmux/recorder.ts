/**
 * Microphone clip recorder (for one-shot analysis and voice enrollment).
 *
 * Uses MediaRecorder with an explicit permission request — never
 * automatic (spec PART 28).
 */

import type { MicState } from "./types";

export interface MicRecorder {
  state: MicState;
  start: () => Promise<void>;
  stop: () => Promise<{ blob: Blob; durationSec: number }>;
  level: () => number;
}

export async function queryMicPermission(): Promise<MicState> {
  if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) {
    return "UNAVAILABLE";
  }
  try {
    const status = await navigator.permissions?.query({
      name: "microphone" as PermissionName,
    });
    if (status?.state === "granted") return "READY";
    if (status?.state === "denied") return "BLOCKED";
  } catch {
    /* permissions API unavailable — fall through to PERMISSION_REQUIRED */
  }
  return "PERMISSION_REQUIRED";
}

export function createMicRecorder(): MicRecorder {
  let recorder: MediaRecorder | null = null;
  let stream: MediaStream | null = null;
  let chunks: BlobPart[] = [];
  let startedAt = 0;
  let analyser: AnalyserNode | null = null;
  let audioCtx: AudioContext | null = null;
  let levelBuf: Uint8Array | null = null;
  let state: MicState = "PERMISSION_REQUIRED";

  return {
    get state() {
      return state;
    },
    async start() {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        state = "READY";
      } catch (err) {
        const name = (err as DOMException)?.name;
        if (name === "NotAllowedError" || name === "SecurityError") {
          state = "BLOCKED";
        } else if (name === "NotFoundError" || name === "OverconstrainedError") {
          state = "UNAVAILABLE";
        } else {
          state = "ERROR";
        }
        throw err;
      }
      audioCtx = new AudioContext();
      const source = audioCtx.createMediaStreamSource(stream);
      analyser = audioCtx.createAnalyser();
      analyser.fftSize = 512;
      source.connect(analyser);
      levelBuf = new Uint8Array(analyser.fftSize);

      const mime = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4"]
        .find((m) => typeof MediaRecorder !== "undefined" &&
          MediaRecorder.isTypeSupported(m));
      recorder = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
      chunks = [];
      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunks.push(e.data);
      };
      recorder.start(250);
      startedAt = Date.now();
    },
    stop() {
      return new Promise((resolve, reject) => {
        if (!recorder) {
          reject(new Error("recorder not started"));
          return;
        }
        recorder.onstop = () => {
          const type = recorder?.mimeType || "audio/webm";
          const blob = new Blob(chunks, { type });
          const durationSec = (Date.now() - startedAt) / 1000;
          stream?.getTracks().forEach((t) => t.stop());
          void audioCtx?.close();
          recorder = null;
          stream = null;
          analyser = null;
          resolve({ blob, durationSec });
        };
        recorder.stop();
      });
    },
    level() {
      if (!analyser || !levelBuf) return 0;
      analyser.getByteTimeDomainData(levelBuf as Uint8Array<ArrayBuffer>);
      let sum = 0;
      for (let i = 0; i < levelBuf.length; i++) {
        const v = (levelBuf[i] - 128) / 128;
        sum += v * v;
      }
      return Math.sqrt(sum / levelBuf.length);
    },
  };
}
