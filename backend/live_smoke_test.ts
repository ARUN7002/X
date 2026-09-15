/**
 * Live Socket.IO smoke test — streams a real wav file as PCM chunks
 * to the X-MUX backend and prints the analysis events it receives.
 */
import { io } from "socket.io-client";
import { readFileSync } from "fs";

const SOCKET_URL = process.argv[2] ?? "http://127.0.0.1:8765";
const WAV = process.argv[3] ?? "/tmp/human_clean.wav";

const socket = io(SOCKET_URL, {
  path: "/",
  transports: ["websocket", "polling"],
  forceNew: true,
});

// parse the wav (16-bit PCM 16k mono expected)
const buf = readFileSync(WAV);
const dataOffset = buf.indexOf("data");
const pcm = buf.subarray(dataOffset + 8);
const sampleRate = 16000;
console.log("pcm bytes:", pcm.length, "sampleRate:", sampleRate);

const CHUNK = 6400; // 400ms of int16 samples
let i = 0;
let analyses = 0;

socket.on("connect", () => {
  console.log("connected:", socket.id);
  socket.emit("start", { profileId: null });
});

socket.on("session", (info) => {
  console.log("session:", JSON.stringify(info));
  // stream the file at ~realtime pace
  const timer = setInterval(() => {
    if (i * CHUNK * 2 >= pcm.length) {
      clearInterval(timer);
      setTimeout(() => socket.emit("stop", {}), 1500);
      return;
    }
    const slice = pcm.subarray(i * CHUNK * 2, (i + 1) * CHUNK * 2);
    socket.emit("audio_chunk", {
      data: Buffer.from(slice).toString("base64"),
      sampleRate,
    });
    i++;
  }, 400);
});

socket.on("analysis", (a) => {
  analyses++;
  console.log(
    `analysis t=${a.t}s speech=${a.speechStatus} synth=${a.syntheticEvidence ?? "—"} ` +
    `quality=${a.audioQuality ?? "—"} risk=${a.riskScore ?? "—"} state=${a.state} ` +
    `action=${a.recommendedAction} latency=${a.latencyMs}ms`,
  );
});

socket.on("alert", (alert) => {
  console.log("ALERT:", JSON.stringify(alert));
});

socket.on("ended", (summary) => {
  console.log("ended:", JSON.stringify(summary));
  console.log("total analysis events:", analyses);
  process.exit(0);
});

socket.on("error", (e) => console.log("socket error:", e));
socket.on("connect_error", (e) => {
  console.log("connect_error:", e.message);
  process.exit(1);
});

setTimeout(() => {
  console.log("TIMEOUT — no end event");
  process.exit(1);
}, 30000);
