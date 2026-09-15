/**
 * X-MUX live Socket.IO client.
 *
 * Sandbox development: connects through the local gateway using a
 * relative URL with the XTransformPort query (never a raw port URL).
 *
 * Production (Vercel): connects directly to the ML backend using
 * NEXT_PUBLIC_XMUX_LIVE_URL. The engine.io path is "/" in both
 * environments, so the Live Monitor contract is identical.
 */

import { io, type Socket } from "socket.io-client";

const LIVE_URL = process.env.NEXT_PUBLIC_XMUX_LIVE_URL ?? "";
const BACKEND_PORT = process.env.NEXT_PUBLIC_XMUX_BACKEND_PORT ?? "8765";

let socket: Socket | null = null;

export function getLiveSocket(): Socket {
  if (socket) return socket;
  const opts = {
    transports: ["websocket", "polling"],
    forceNew: true,
    reconnection: true,
    reconnectionAttempts: 8,
    reconnectionDelay: 1000,
    timeout: 10000,
  };
  if (LIVE_URL) {
    // Production: direct connection to the deployed backend root.
    socket = io(LIVE_URL, { ...opts, path: "/" });
  } else {
    // Sandbox: relative URL through the gateway (canonical pattern).
    socket = io(`/?XTransformPort=${BACKEND_PORT}`, opts);
  }
  return socket;
}

export function destroyLiveSocket(): void {
  if (socket) {
    socket.removeAllListeners();
    socket.disconnect();
    socket = null;
  }
}
