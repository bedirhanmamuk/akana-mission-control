"""HTTP + WebSocket sunucusu. Arayüz dosyalarını da aynı adresten sunar (http://127.0.0.1:8000).

Uç noktalar
    GET  /api/status            oturum ve alıcı durumu
    GET  /api/ports             bilgisayardaki seri portlar (Windows/macOS/Linux)
    GET  /api/recordings        kayıtlar (manifest bilgisiyle)
    GET  /api/recordings/{ad}/verify   ham dosyaların SHA-256 doğrulaması
    POST /api/source            {"mode":"sim"} | {"mode":"serial","ports":{"main":"COM5",...},"baud":9600}
                                | {"mode":"replay","name":"...","speed":1}
    POST /api/replay            {"action":"pause"|"resume"|"speed"|"seek", "speed":2, "t":120}
    WS   /ws                    hello, pkts, log, status, clock, t0, reset mesajları (yalnızca sunucudan istemciye)

Komut yoktur: hiçbir uç nokta seri porta veya uçuş bilgisayarına veri göndermez.
"""

from __future__ import annotations

import asyncio
import logging
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Any

from fastapi import FastAPI, HTTPException, WebSocket, WebSocketDisconnect
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from . import sources
from .hub import SOURCES, Hub
from .recorder import list_recordings, seal_interrupted, verify_recording

log = logging.getLogger("yi.server")


class SourceReq(BaseModel):
    mode: str
    ports: dict[str, str] | None = None
    baud: int = 9600
    name: str | None = None
    speed: float = 1.0


class ReplayReq(BaseModel):
    action: str
    speed: float | None = None
    t: float | None = None


def create_app(hub: Hub, ui_dir: Path | None, initial: SourceReq, record_sim: bool = False, sim_start: float = -30.0) -> FastAPI:
    state: dict[str, Any] = {"replay": None, "baud": initial.baud}

    def start_source(req: SourceReq) -> None:
        if req.mode == "sim":
            hub.begin(sources.sim_session(sim_start), record=record_sim)
            hub.task = asyncio.create_task(sources.run_sim(hub, sim_start))
        elif req.mode == "serial":
            ports = {k: v for k, v in (req.ports or {}).items() if k in SOURCES and v}
            if not ports:
                raise HTTPException(400, "en az bir alıcı portu seçin")
            hub.begin(sources.serial_session(ports), record=True, ports=ports)
            sources.start_serial(hub, ports, req.baud)
        elif req.mode == "replay":
            if not req.name or "/" in req.name or "\\" in req.name or req.name.startswith("."):
                raise HTTPException(400, "geçersiz kayıt adı")
            path = hub.recordings / req.name
            hub.end()  # etkin kayıt bu kayıtsa önce kapanıp diske tam yazılmalı
            try:
                rp = sources.Replay(path)
            except FileNotFoundError as e:
                raise HTTPException(404, str(e)) from e
            meta = next((r for r in list_recordings(hub.recordings) if r["name"] == req.name), {})
            hub.begin(rp.session(req.speed, meta), record=False)
            state["replay"] = (req.name, rp, meta)
            hub.task = asyncio.create_task(rp.run(hub))
        else:
            raise HTTPException(400, f"bilinmeyen kaynak: {req.mode}")
        if req.mode != "replay":
            state["replay"] = None

    @asynccontextmanager
    async def lifespan(_: FastAPI):  # type: ignore[no-untyped-def]
        for name in seal_interrupted(hub.recordings):
            log.warning("yarım kalmış kayıt işaretlendi: %s", name)
        pump = asyncio.create_task(hub.pump())
        start_source(initial)
        yield
        hub.end()
        pump.cancel()

    app = FastAPI(title="AKANA yer istasyonu", lifespan=lifespan)

    @app.get("/api/status")
    async def status() -> dict[str, Any]:
        return {**hub.status(), "hello": hub.hello() if hub.session else None}

    @app.get("/api/ports")
    async def ports() -> dict[str, Any]:
        return {"ports": await asyncio.to_thread(sources.list_ports)}

    @app.get("/api/recordings")
    async def recordings() -> dict[str, Any]:
        return {"recordings": list_recordings(hub.recordings)}

    @app.get("/api/recordings/{name}/verify")
    async def verify(name: str) -> dict[str, Any]:
        p = hub.recordings / name
        if "/" in name or not (p / "manifest.json").exists():
            raise HTTPException(404, "kayıt yok")
        return {"files": verify_recording(p)}

    @app.post("/api/source")
    async def set_source(req: SourceReq) -> dict[str, Any]:
        start_source(req)
        return hub.hello()

    @app.post("/api/replay")
    async def replay_ctl(req: ReplayReq) -> dict[str, Any]:
        s = hub.session
        if not s or s.mode != "replay" or not state["replay"]:
            raise HTTPException(400, "kayıt oynatılmıyor")
        name, rp, meta = state["replay"]
        if req.action == "pause":
            s.set_clock(s.now())
            s.paused = True
        elif req.action == "resume":
            if rp.i >= len(rp.items):  # sondaysa baştan
                start_source(SourceReq(mode="replay", name=name, speed=s.speed))
                return hub.hello()
            s.set_clock(s.now())
            s.paused = False
        elif req.action == "speed" and req.speed:
            s.set_clock(s.now())
            s.speed = max(0.1, min(50.0, req.speed))
        elif req.action == "seek" and req.t is not None:
            t = max(rp.t_start, min(rp.t_end, req.t))
            if t < s.now():  # geri: oturumu baştan kur, hedefe kadar anında işlenir
                speed, paused = s.speed, s.paused
                start_source(SourceReq(mode="replay", name=name, speed=speed))
                s = hub.session
                assert s is not None
                s.paused = paused
            s.set_clock(t)
        else:
            raise HTTPException(400, "geçersiz işlem")
        hub.broadcast_now(hub.hello())
        return hub.hello()

    @app.websocket("/ws")
    async def ws(websocket: WebSocket) -> None:
        await websocket.accept()
        q: asyncio.Queue[str] = asyncio.Queue()
        for m in hub.snapshot():
            q.put_nowait(m)
        hub.clients.add(q)

        async def drain_incoming() -> None:  # istemciden gelen her şey yok sayılır
            while True:
                await websocket.receive_text()

        rx = asyncio.create_task(drain_incoming())
        try:
            while True:
                m = await q.get()
                if m == "__close__":
                    await websocket.close(code=1013)
                    break
                await websocket.send_text(m)
        except (WebSocketDisconnect, RuntimeError):
            pass
        finally:
            rx.cancel()
            hub.clients.discard(q)

    if ui_dir and ui_dir.exists():
        app.mount("/", StaticFiles(directory=ui_dir, html=True), name="ui")
    return app
