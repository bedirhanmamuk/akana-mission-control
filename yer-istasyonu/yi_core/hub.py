"""Veri yolu: kaynak → çözümleyici → kayıt → istemciler.

CU InSpace yer istasyonundaki "alım görevleri + zaman çizelgesi kuyruğu + WebSocket yayını" yapısının
AKANA'ya uyarlanmış hâli. Bilinçli farklar:
- Paketler yapay gecikmeyle "düzleştirilmez" (CU'daki TelemetryTimelineWorker). Hakem ve operatör en güncel
  veriyi görmeli; sıralama arayüzde zaman damgasıyla yapılır, sıra dışı paket sayılır.
- Her alıcı ayrı kaynaktır (Ana UKB, Yedek UKB, görev yükü ayrı kanallarda); kaynaklar birleştirilmez.
- Yeni bağlanan istemciye geçmiş gönderilir; arayüz yenilenince veri kaybolmaz.
- Seri porta hiçbir koşulda yazılmaz: yer istasyonu yalnızca dinler (komut/ateşleme yolu yoktur).
"""

from __future__ import annotations

import asyncio
import json
import logging
import time
from collections import deque
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from .protocol import FrameParser, Frame
from .recorder import Recorder

log = logging.getLogger("yi.hub")
SOURCES = ("main", "backup", "payload")
LABELS = {"main": "Ana UKB", "backup": "Yedek UKB", "payload": "Görev yükü"}


@dataclass
class SourceState:
    parser: FrameParser
    state: str = "kapalı"  # kapalı | açık | hata | sim | kayıt
    port: str | None = None
    offset: float | None = None  # cihaz saati → oturum saati (en düşük gecikme tahmini)
    packets: int = 0
    src_mismatch: int = 0
    last_rx: float | None = None


@dataclass
class Session:
    mode: str  # sim | serial | replay
    label: str
    epoch_ms: float  # oturum zamanı 0'ın duvar saati karşılığı (ms)
    t0: float | None  # kalkış anı (oturum zamanı); bilinmiyorsa None
    activation: float  # UKB aktifleştirme anı (oturum zamanı) — şartname 2 dk bağlantı kuralı
    speed: float = 1.0
    clock_ref: tuple[float, float] = (0.0, 0.0)  # (monotonik, oturum zamanı)
    paused: bool = False
    meta: dict[str, Any] = field(default_factory=dict)

    def now(self) -> float:
        mono, t = self.clock_ref
        return t if self.paused else t + (time.monotonic() - mono) * self.speed

    def set_clock(self, t: float) -> None:
        self.clock_ref = (time.monotonic(), t)


class Hub:
    def __init__(self, recordings: Path, rssi_byte: bool = True, history: int = 60000) -> None:
        self.recordings = recordings
        self.rssi_byte = rssi_byte
        self.clients: set[asyncio.Queue[str]] = set()
        self.history: deque[dict[str, Any]] = deque(maxlen=history)
        self.logs: deque[dict[str, Any]] = deque(maxlen=500)
        self.session: Session | None = None
        self.sources: dict[str, SourceState] = {}
        self.recorder: Recorder | None = None
        self._pending: list[dict[str, Any]] = []
        self.task: asyncio.Task[None] | None = None  # etkin kaynak görevi
        self.stopper: Any = None

    # ---------- oturum ----------
    def begin(self, session: Session, record: bool, ports: dict[str, str] | None = None) -> None:
        self.end()
        self.session = session
        self.history.clear()
        self.logs.clear()
        self.sources = {s: SourceState(FrameParser(rssi_byte=self.rssi_byte), port=(ports or {}).get(s)) for s in SOURCES}
        if record:
            self.recorder = Recorder(self.recordings, session.mode, {"label": session.label, "ports": ports or {}, "epoch_ms": session.epoch_ms,
                                                                    "activation": session.activation, **session.meta})
            self.recorder.event("oturum_basladi", mode=session.mode, label=session.label)
        self.broadcast_now({"type": "reset"})
        self.broadcast_now(self.hello())
        self.log_msg("info", "Yer istasyonu", f"Oturum başladı: {session.label}.")

    def end(self) -> None:
        if self.stopper:
            try:
                self.stopper()
            except Exception:  # noqa: BLE001
                log.exception("kaynak durdurulamadı")
            self.stopper = None
        if self.task and not self.task.done():
            self.task.cancel()
        self.task = None
        if self.recorder:
            self.recorder.event("oturum_bitti")
            self.recorder.close()
            self.recorder = None

    def hello(self) -> dict[str, Any]:
        s = self.session
        assert s is not None
        return {"type": "hello", "mode": s.mode, "label": s.label, "epoch_ms": s.epoch_ms, "t0": s.t0,
                "activation": s.activation, "speed": s.speed, "paused": s.paused, "t": s.now(),
                "recording": self.recorder.dir.name if self.recorder else None, "meta": s.meta}

    def status(self) -> dict[str, Any]:
        s = self.session
        return {
            "type": "status",
            "mode": s.mode if s else None,
            "t": s.now() if s else None,
            "t0": s.t0 if s else None,
            "sources": {k: {"state": v.state, "port": v.port, "packets": v.packets, "bytes": v.parser.stats.bytes_in,
                            "crc": v.parser.stats.crc_errors, "decode": v.parser.stats.decode_errors,
                            "resync": v.parser.stats.resync_bytes, "src_mismatch": v.src_mismatch,
                            "age": None if v.last_rx is None or not s else round(s.now() - v.last_rx, 2)}
                        for k, v in self.sources.items()},
            "recording": self.recorder.dir.name if self.recorder else None,
        }

    # ---------- veri ----------
    def set_source_state(self, src: str, state: str, note: str | None = None) -> None:
        st = self.sources[src]
        if st.state == state:
            return
        st.state = state
        if self.recorder:
            self.recorder.event("kaynak_durumu", source=src, state=state, port=st.port, note=note)
        sv = "err" if state == "hata" else "info"
        text = {"açık": "Alıcı bağlandı", "hata": "Alıcı hatası", "kapalı": "Alıcı kapatıldı",
                "sim": "Simülasyon kaynağı etkin", "kayıt": "Kayıttan okunuyor"}.get(state, state)
        self.log_msg(sv, LABELS[src], f"{text}{f' ({st.port})' if st.port else ''}{f': {note}' if note else ''}.", key=f"st{src}{state}")

    def ingest(self, src: str, rx: float, data: bytes) -> None:
        """Bir alıcıdan gelen bayt öbeği. rx: oturum zamanı (s)."""
        st = self.sources[src]
        if self.recorder:
            self.recorder.raw(src, rx, data)
        for fr in st.parser.feed(data):
            self._frame(src, rx, fr)

    def _frame(self, receiver: str, rx: float, fr: Frame) -> None:
        sid = receiver
        if fr.crc_ok and fr.source and fr.source != receiver:
            # CRC geçerliyse başlıktaki kaynak güvenilirdir; alıcı/kanal eşlemesi yanlış olabilir.
            self.sources[receiver].src_mismatch += 1
            sid = fr.source
            self.log_msg("warn", LABELS[receiver], f"{LABELS[fr.source]} paketi bu alıcıdan geldi; kanal eşlemesini kontrol edin.", key="mm" + receiver)
        st = self.sources[sid]
        ts = rx
        if fr.crc_ok:
            dev = fr.t_ms / 1000.0
            cand = rx - dev
            st.offset = cand if st.offset is None else min(st.offset, cand)
            ts = dev + st.offset
        fields = dict(fr.fields)
        if sid == "payload":
            fields.pop("phase", None)
        if fr.error and fr.crc_ok:
            self.log_msg("warn", LABELS[sid], f"Paket {fr.seq} çözümlenemedi: {fr.error}.", key="dec" + sid)
        pkt = {"source_id": sid, "seq": fr.seq, "ts": round(ts, 3), "rx": round(rx, 3), "crc": fr.crc_ok,
               "rssi": fr.rssi, "fields": fields}
        st.packets += 1
        st.last_rx = rx
        s = self.session
        if s and s.t0 is None and fr.crc_ok and sid in ("main", "backup") and fields.get("phase", 0) >= 1:
            s.t0 = ts
            self.log_msg("info", LABELS[sid], "Kalkış algılandı; T0 bu ana göre ayarlandı.")
            self.broadcast_now({"type": "t0", "t0": ts})
            if self.recorder:
                self.recorder.event("kalkis", t0=ts, source=sid)
        if self.recorder:
            self.recorder.packet(pkt)
        self.history.append(pkt)
        self._pending.append(pkt)

    # ---------- yayın ----------
    def log_msg(self, sv: str, src: str, msg: str, key: str | None = None) -> None:
        t = self.session.now() if self.session else 0.0
        if key:
            last = next((m for m in reversed(self.logs) if m.get("key") == key), None)
            if last and t - last["t"] < 10:
                return
        m = {"type": "log", "t": round(t, 2), "sv": sv, "src": src, "msg": msg, "key": key}
        self.logs.append(m)
        self.broadcast_now(m)

    def broadcast_now(self, msg: dict[str, Any]) -> None:
        text = json.dumps(msg, ensure_ascii=False)
        for q in list(self.clients):
            if q.qsize() > 2000:  # yavaş istemci: bağlantısı kesilir, yeniden bağlanınca geçmişi alır
                self.clients.discard(q)
                q.put_nowait("__close__")
                continue
            q.put_nowait(text)

    def flush(self) -> None:
        if self._pending:
            self.broadcast_now({"type": "pkts", "items": self._pending})
            self._pending = []

    def snapshot(self) -> list[str]:
        """Yeni istemci için: hello + geçmiş + kayıtlar + durum."""
        if not self.session:
            return []
        out = [json.dumps(self.hello(), ensure_ascii=False)]
        items = list(self.history)
        if self._pending:  # henüz yayınlanmamış paketler bir sonraki 'pkts' mesajıyla gider; çift gönderme
            items = items[: len(items) - len(self._pending)]
        for i in range(0, len(items), 2000):
            out.append(json.dumps({"type": "pkts", "items": items[i:i + 2000], "backlog": True}, ensure_ascii=False))
        out += [json.dumps(m, ensure_ascii=False) for m in self.logs]
        out.append(json.dumps(self.status(), ensure_ascii=False))
        return out

    async def pump(self) -> None:
        """50 ms'de bir bekleyen paketleri, 1 s'de bir durum ve saat bilgisini yayınlar."""
        last_status = 0.0
        while True:
            await asyncio.sleep(0.05)
            self.flush()
            now = time.monotonic()
            if self.session and now - last_status >= 1.0:
                last_status = now
                self.broadcast_now(self.status())
                self.broadcast_now({"type": "clock", "t": self.session.now(), "speed": self.session.speed, "paused": self.session.paused})
