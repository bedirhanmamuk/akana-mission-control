"""Veri kaynakları: simülasyon, seri port (E22 alıcıları), kayıt oynatma."""

from __future__ import annotations

import asyncio
import logging
import threading
import time
from pathlib import Path
from typing import Any

from .flight_sim import ACTIVATION_T, SimTransmitter
from .hub import SOURCES, Hub, Session

log = logging.getLogger("yi.sources")


# ---------- simülasyon ----------
async def run_sim(hub: Hub, start_t: float = -30.0) -> None:
    """Oturum zamanı = görev zamanı. Aktivasyondan start_t'ye kadarki geçmiş anında üretilir."""
    tx = {s: SimTransmitter(s, rssi_byte=hub.rssi_byte) for s in SOURCES}
    for s in SOURCES:
        hub.set_source_state(s, "sim")
    s = hub.session
    assert s is not None
    while True:
        now = s.now()
        batch: list[tuple[float, str, bytes]] = []
        for src, t in tx.items():
            batch += [(rx, src, data) for rx, data in t.until(now)]
        batch.sort(key=lambda x: x[0])
        for rx, src, data in batch:
            hub.ingest(src, rx, data)
        await asyncio.sleep(0.02)


def sim_session(start_t: float = -30.0) -> Session:
    s = Session(mode="sim", label="Simülasyon (sunucu, 20 000 ft profili)", epoch_ms=time.time() * 1000 - start_t * 1000,
                t0=0.0, activation=ACTIVATION_T)
    s.set_clock(start_t)
    return s


# ---------- seri port ----------
class SerialReader:
    """Bir alıcıyı ayrı iş parçacığında okur; kopunca 2 s arayla yeniden bağlanır.

    Bilerek yazma yöntemi yoktur: yer istasyonu uçuş bilgisayarlarına komut gönderemez.
    """

    def __init__(self, hub: Hub, loop: asyncio.AbstractEventLoop, src: str, port: str, baud: int) -> None:
        self.hub, self.loop, self.src, self.port, self.baud = hub, loop, src, port, baud
        self._stop = threading.Event()
        self.thread = threading.Thread(target=self._run, name=f"seri-{src}", daemon=True)

    def start(self) -> None:
        self.thread.start()

    def stop(self) -> None:
        self._stop.set()

    def _state(self, state: str, note: str | None = None) -> None:
        self.loop.call_soon_threadsafe(self.hub.set_source_state, self.src, state, note)

    def _run(self) -> None:
        import serial  # pyserial

        while not self._stop.is_set():
            try:
                with serial.Serial(self.port, self.baud, timeout=0.05) as ser:
                    self._state("açık")
                    while not self._stop.is_set():
                        data = ser.read(512)
                        if data:
                            s = self.hub.session
                            rx = s.now() if s else 0.0
                            self.loop.call_soon_threadsafe(self.hub.ingest, self.src, rx, data)
            except Exception as e:  # noqa: BLE001  (SerialException, OSError: port çekildi vb.)
                self._state("hata", explain_serial_error(e))
                log.warning("seri %s (%s): %s", self.src, self.port, e)
                self._stop.wait(2.0)
        self._state("kapalı")


def explain_serial_error(e: Exception) -> str:
    m = str(e).lower()
    if "readiness" in m or "disconnected" in m or "device not configured" in m or "input/output" in m:
        return "cihaz bağlantısı koptu, 2 s sonra yeniden denenecek"
    if "permission" in m or "access is denied" in m or "erişim" in m:
        return "erişim reddedildi (port başka bir programda açık olabilir)"
    if "could not open" in m or "no such file" in m or "filenotfound" in m or "cannot find" in m:
        return "port açılamadı (alıcı takılı mı?)"
    return str(e)[:80]


def serial_session(ports: dict[str, str]) -> Session:
    label = "Canlı alıcılar · " + ", ".join(f"{k}={v}" for k, v in ports.items())
    s = Session(mode="serial", label=label, epoch_ms=time.time() * 1000, t0=None, activation=0.0, meta={"ports": ports})
    s.set_clock(0.0)
    return s


def start_serial(hub: Hub, ports: dict[str, str], baud: int) -> None:
    loop = asyncio.get_running_loop()
    readers = [SerialReader(hub, loop, src, port, baud) for src, port in ports.items() if src in SOURCES and port]
    for r in readers:
        r.start()
    hub.stopper = lambda: [r.stop() for r in readers]


def list_ports() -> list[dict[str, str]]:
    try:
        from serial.tools import list_ports as lp
    except ImportError:
        return []
    return [{"device": p.device, "description": p.description or "", "hwid": p.hwid or ""} for p in lp.comports()]


# ---------- kayıt oynatma ----------
class Replay:
    """Ham kaydı (raw_*.txt) baştan çözümleyerek oynatır; hız, duraklatma ve konuma atlama destekler."""

    def __init__(self, path: Path) -> None:
        self.path = path
        self.items: list[tuple[float, str, bytes]] = []
        for f in sorted(path.glob("raw_*.txt")):
            src = f.stem[4:]
            if src not in SOURCES:
                continue
            for line in f.read_text(encoding="ascii").splitlines():
                t, _, hx = line.partition("\t")
                try:  # yarım kalmış kayıtta son satır eksik olabilir
                    self.items.append((float(t), src, bytes.fromhex(hx)))
                except ValueError:
                    continue
        if not self.items:
            raise FileNotFoundError(f"kayıtta ham veri yok: {path}")
        self.items.sort(key=lambda x: x[0])
        self.t_start, self.t_end = self.items[0][0], self.items[-1][0]
        self.i = 0

    def session(self, speed: float, meta: dict[str, Any]) -> Session:
        s = Session(mode="replay", label=f"Kayıt oynatma · {self.path.name}", epoch_ms=meta.get("epoch_ms") or time.time() * 1000,
                    t0=None, activation=meta.get("activation", 0.0), speed=speed,
                    meta={"recording": self.path.name, "t_start": self.t_start, "t_end": self.t_end, "source_mode": meta.get("mode")})
        s.set_clock(self.t_start)
        return s

    async def run(self, hub: Hub) -> None:
        for s in SOURCES:
            hub.set_source_state(s, "kayıt")
        sess = hub.session
        assert sess is not None
        while True:
            now = sess.now()
            while self.i < len(self.items) and self.items[self.i][0] <= now:
                t, src, data = self.items[self.i]
                hub.ingest(src, t, data)
                self.i += 1
            if self.i >= len(self.items) and not sess.paused:
                sess.set_clock(self.t_end)
                sess.paused = True
                hub.log_msg("info", "Kayıt", "Kayıt sonuna gelindi.")
                hub.broadcast_now(hub.hello())
            await asyncio.sleep(0.02)
