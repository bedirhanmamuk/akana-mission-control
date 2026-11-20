"""Oturum kaydı.

recordings/<YYYYMMDD_HHMMSS>_<mod>/
    raw_<kaynak>.txt   her satır: "<oturum_zamanı_s>\\t<hex>"  — alıcıdan gelen bayt öbekleri, DOKUNULMADAN
    parsed.csv         çözümlenmiş paketler (arayüzün gördüğü değerler)
    events.jsonl       denetim kaydı: mod değişimi, port açılması/kopması, operatör işlemleri
    manifest.json      mod, başlangıç/bitiş, portlar; kapanışta ham dosyaların SHA-256 özetleri

Ham dosyalar yalnızca sona eklenerek yazılır ve kapanışta özetlenir; sonradan değiştirilip
değiştirilmediği özetle doğrulanabilir. Kayıt yeniden oynatılırken ham baytlar baştan çözümlenir.
Simülasyon kayıtları klasör adında ve manifestte "sim" olarak işaretlenir, gerçek uçuşla karışmaz.
"""

from __future__ import annotations

import csv
import hashlib
import json
import os
import time
from datetime import datetime
from pathlib import Path
from typing import Any

CSV_FIELDS = ["rx", "ts", "source", "seq", "crc", "rssi", "alt", "vz", "vh", "p", "temp", "hum", "ax", "ay", "az",
              "pitch", "yaw", "roll", "lat", "lon", "gpsAlt", "sats", "phase", "sep", "bat"]


class Recorder:
    def __init__(self, root: Path, mode: str, meta: dict[str, Any] | None = None) -> None:
        stamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        self.dir = root / f"{stamp}_{mode}"
        n = 1
        while self.dir.exists():
            n += 1
            self.dir = root / f"{stamp}_{mode}_{n}"
        self.dir.mkdir(parents=True)
        self.mode = mode
        self._raw: dict[str, Any] = {}
        self._csv_f = open(self.dir / "parsed.csv", "w", newline="", encoding="utf-8")
        self._csv = csv.DictWriter(self._csv_f, fieldnames=CSV_FIELDS, extrasaction="ignore")
        self._csv.writeheader()
        self._events = open(self.dir / "events.jsonl", "a", encoding="utf-8")
        self._last_sync = time.monotonic()
        self.manifest: dict[str, Any] = {"mode": mode, "started": datetime.now().isoformat(timespec="seconds"),
                                         "protocol": 1, **(meta or {})}
        self._write_manifest()
        self.closed = False

    def _write_manifest(self) -> None:
        (self.dir / "manifest.json").write_text(json.dumps(self.manifest, ensure_ascii=False, indent=2), encoding="utf-8")

    def raw(self, source: str, t: float, data: bytes) -> None:
        f = self._raw.get(source)
        if f is None:
            f = self._raw[source] = open(self.dir / f"raw_{source}.txt", "a", encoding="ascii")
        f.write(f"{t:.3f}\t{data.hex()}\n")
        self._maybe_sync()

    def packet(self, pkt: dict[str, Any]) -> None:
        row = {"rx": f"{pkt['rx']:.3f}", "ts": f"{pkt['ts']:.3f}", "source": pkt["source_id"], "seq": pkt["seq"],
               "crc": int(pkt["crc"]), "rssi": pkt.get("rssi")}
        row.update(pkt.get("fields", {}))
        self._csv.writerow(row)

    def event(self, kind: str, **data: Any) -> None:
        self._events.write(json.dumps({"wall": datetime.now().isoformat(timespec="milliseconds"), "kind": kind, **data},
                                      ensure_ascii=False) + "\n")
        self._events.flush()

    def _maybe_sync(self) -> None:
        now = time.monotonic()
        if now - self._last_sync < 1.0:
            return
        self._last_sync = now
        for f in (*self._raw.values(), self._csv_f):
            f.flush()
            os.fsync(f.fileno())

    def close(self) -> None:
        if self.closed:
            return
        self.closed = True
        for f in (*self._raw.values(), self._csv_f, self._events):
            f.flush()
            os.fsync(f.fileno())
            f.close()
        digests = {}
        for p in sorted(self.dir.glob("raw_*.txt")):
            digests[p.name] = hashlib.sha256(p.read_bytes()).hexdigest()
        self.manifest.update({"finished": datetime.now().isoformat(timespec="seconds"), "sha256": digests})
        self._write_manifest()


def list_recordings(root: Path) -> list[dict[str, Any]]:
    out = []
    if not root.exists():
        return out
    for d in sorted(root.iterdir(), reverse=True):
        m = d / "manifest.json"
        if d.is_dir() and m.exists():
            try:
                info = json.loads(m.read_text(encoding="utf-8"))
            except json.JSONDecodeError:
                info = {}
            out.append({"name": d.name, **info})
    return out


def verify_recording(path: Path) -> dict[str, bool]:
    """Ham dosyaların manifestteki özetlerle eşleşip eşleşmediği."""
    info = json.loads((path / "manifest.json").read_text(encoding="utf-8"))
    return {name: hashlib.sha256((path / name).read_bytes()).hexdigest() == h for name, h in info.get("sha256", {}).items()}


def seal_interrupted(root: Path) -> list[str]:
    """Program beklenmedik kapanmışsa (elektrik, çökme) kayıt manifesti bitiş bilgisi içermez.
    Açılışta bu kayıtlar "yarım kaldı" olarak işaretlenir ve ham dosyaların özeti o anki hâliyle alınır;
    veriler silinmez, kayıt oynatılabilir."""
    sealed = []
    if not root.exists():
        return sealed
    for d in root.iterdir():
        m = d / "manifest.json"
        if not (d.is_dir() and m.exists()):
            continue
        try:
            info = json.loads(m.read_text(encoding="utf-8"))
        except json.JSONDecodeError:
            continue
        if info.get("finished") or info.get("interrupted"):
            continue
        info["interrupted"] = True
        info["sha256"] = {p.name: hashlib.sha256(p.read_bytes()).hexdigest() for p in sorted(d.glob("raw_*.txt"))}
        m.write_text(json.dumps(info, ensure_ascii=False, indent=2), encoding="utf-8")
        sealed.append(d.name)
    return sealed
