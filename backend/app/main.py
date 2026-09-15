"""X-MUX ML Backend — FastAPI + Socket.IO combined ASGI application.

Entrypoint: ``uvicorn app.main:app --host 0.0.0.0 --port ${XMUX_PORT:-8765}``

The Socket.IO engine is served at path ``/`` (required by the sandbox
gateway; in production the browser connects to the backend root
directly via NEXT_PUBLIC_XMUX_LIVE_URL). Everything else is FastAPI.
"""

from __future__ import annotations

import logging
from typing import Any

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from . import db
from .config import cors_origins, ensure_dirs, settings
from .live import attach_live_handlers
from .models import registry
from .routes import analyze, health, profiles, reports, settings as settings_route

log = logging.getLogger("xmux")

import socketio

from .config import allowed_origins_list

_origins = allowed_origins_list()
sio = socketio.AsyncServer(
    async_mode="asgi",
    # XMUX_ALLOWED_ORIGINS restricts both HTTP and Socket.IO CORS in
    # production; dev fallback is any-origin (sandbox gateway requirement).
    cors_allowed_origins=_origins if _origins else "*",
    socketio_path="/",
    ping_timeout=60,
    ping_interval=25,
)
attach_live_handlers(sio)

# ------------------------------------------------------------------ FastAPI
api = FastAPI(
    title="X-MUX ML Backend",
    version="1.0.0",
    description=(
        "Voice-integrity and impersonation-risk analysis backend. "
        "Every score originates from real computation."
    ),
)

origins = cors_origins()
if origins:
    api.add_middleware(
        CORSMiddleware,
        allow_origins=origins,
        allow_methods=["GET", "POST", "PUT", "DELETE", "OPTIONS"],
        allow_headers=["*"],
    )
else:
    api.add_middleware(
        CORSMiddleware,
        allow_origins=["*"],  # development only (XMUX_ENV != production)
        allow_methods=["GET", "POST", "PUT", "DELETE", "OPTIONS"],
        allow_headers=["*"],
    )

api.include_router(health.router, prefix="/api")
api.include_router(analyze.router, prefix="/api")
api.include_router(reports.router, prefix="/api")
api.include_router(profiles.router, prefix="/api")
api.include_router(settings_route.router, prefix="/api")


@api.on_event("startup")
async def _startup() -> None:
    ensure_dirs()
    db.get_db()
    registry.start_background_load()
    log.info("X-MUX backend starting: models loading in background")


@api.get("/")
async def root() -> dict[str, Any]:
    return {
        "service": "X-MUX ML Backend",
        "status": "ok",
        "socket_io": "path /",
    }


@api.exception_handler(ValueError)
async def _value_error_handler(request: Request, exc: ValueError):
    return JSONResponse(status_code=400, content={"detail": str(exc)})


# --------------------------------------------------- combined ASGI dispatch
class CombinedApp:
    """Route path '/' (and only '/') to the Socket.IO engine.

    The sandbox gateway forwards browser Socket.IO traffic as
    ``/?XTransformPort=8765``; in production the browser connects to the
    backend root with the same path, so both environments share the
    exact same client code.
    """

    def __init__(self, socketio_server, fastapi_app) -> None:
        self.sio = socketio_server
        self.api = fastapi_app

    async def __call__(self, scope, receive, send) -> None:
        if scope["type"] == "lifespan":
            # let FastAPI run its startup/shutdown handlers (model loading)
            await self.api(scope, receive, send)
            return
        path = scope.get("path", "")
        if path in ("/", ""):
            await self.sio.handle_request(scope, receive, send)
        else:
            await self.api(scope, receive, send)


app = CombinedApp(sio, api)
