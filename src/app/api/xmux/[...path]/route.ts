/**
 * X-MUX server-side API proxy (spec PART 39).
 *
 * The browser only ever talks to this Next.js app (relative paths).
 * This route forwards REST calls to the ML backend:
 *   - production: XMUX_BACKEND_URL (external Python host; Vercel never
 *     spawns Python)
 *   - local development: http://127.0.0.1:8765
 *
 * Multipart uploads, JSON bodies, and all response codes pass through
 * unchanged. This keeps the backend URL server-side knowledge.
 */

import { NextRequest, NextResponse } from "next/server";

const BACKEND_URL = (
  process.env.XMUX_BACKEND_URL ?? "http://127.0.0.1:8765"
).replace(/\/+$/, "");

const HOP_BY_HOP = new Set([
  "connection",
  "keep-alive",
  "transfer-encoding",
  "upgrade",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "host",
  "content-length",
]);

async function forward(req: NextRequest, path: string[]) {
  const url = new URL(req.url);
  const target = `${BACKEND_URL}/api/${path.join("/")}${url.search}`;

  const headers = new Headers();
  req.headers.forEach((value, key) => {
    if (!HOP_BY_HOP.has(key.toLowerCase())) {
      headers.set(key, value);
    }
  });

  let body: ArrayBuffer | undefined;
  if (req.method !== "GET" && req.method !== "HEAD") {
    body = await req.arrayBuffer();
  }

  try {
    const upstream = await fetch(target, {
      method: req.method,
      headers,
      body,
      cache: "no-store",
      // @ts-expect-error -- duplex is required by undici for streamed bodies
      duplex: "half",
    });

    const respHeaders = new Headers();
    upstream.headers.forEach((value, key) => {
      if (!HOP_BY_HOP.has(key.toLowerCase())) {
        respHeaders.set(key, value);
      }
    });

    return new NextResponse(upstream.body, {
      status: upstream.status,
      headers: respHeaders,
    });
  } catch {
    return NextResponse.json(
      {
        detail:
          "The X-MUX analysis backend is not reachable. Please try again shortly.",
      },
      { status: 502 },
    );
  }
}

type RouteContext = { params: Promise<{ path: string[] }> };

export async function GET(req: NextRequest, ctx: RouteContext) {
  return forward(req, (await ctx.params).path);
}

export async function POST(req: NextRequest, ctx: RouteContext) {
  return forward(req, (await ctx.params).path);
}

export async function PUT(req: NextRequest, ctx: RouteContext) {
  return forward(req, (await ctx.params).path);
}

export async function DELETE(req: NextRequest, ctx: RouteContext) {
  return forward(req, (await ctx.params).path);
}

export async function PATCH(req: NextRequest, ctx: RouteContext) {
  return forward(req, (await ctx.params).path);
}
