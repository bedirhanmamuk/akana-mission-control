"""Simülasyon kaynağı: 20 000 ft profilli uçuş modelinden gerçek ikili çerçeveler üretir.

Çerçeveler seri porttan gelmiş gibi aynı FrameParser yolundan geçer; böylece simülasyon,
protokolü ve çözümleyiciyi de uçtan uca sınar. Örnek arızalar: CRC bozulması (ana), kesinti ve
sıra dışı paket (yedek), tekrar eden paket ve GPS kaybı (görev yükü), araya giren çöp baytlar.
Zaman ekseni: görev zamanı t (s), kalkış t=0. Arayüzdeki simülasyonla aynı model.
"""

from __future__ import annotations

import math
from dataclasses import dataclass

from .protocol import encode_block, encode_frame

G = 9.80665
SITE = {"lat": 38.32597, "lon": 33.96313, "alt": 900.0}
MPD = 111320.0
CL = math.cos(math.radians(SITE["lat"]))
HZ = 5
ACTIVATION_T = -610.0
OFFSETS = {"main": 0.00, "backup": 0.07, "payload": 0.13}

TB, VB = 4.0, 326.8
A = VB / TB
TAP = TB + VB / G
TYAK = TB + (VB - 50) / G
T_DROGUE, T_SEP = TAP + 1.0, TAP + 1.3
VD, VMAIN, VPL, MAIN_ALT = 25.0, 6.0, 13.0, 500.0
HD = 6096 - 0.5 * G * 1
T_MAIN = T_DROGUE + (HD - MAIN_ALT) / VD
T_LAND = T_MAIN + MAIN_ALT / VMAIN
H_SEP = HD - VD * (T_SEP - T_DROGUE)
T_LAND_PL = T_SEP + H_SEP / VPL


def _h(x: float) -> float:
    x = math.sin(x * 12.9898) * 43758.5453
    return x - math.floor(x)


def nz(t: float, k: float, a: float) -> float:
    return (_h(t * 7.13 + k * 91.7) - 0.5) * 2 * a


def pres(h: float) -> float:
    return 1013.25 * (1 - 2.25577e-5 * (h + SITE["alt"])) ** 5.25588


def temp_c(h: float) -> float:
    return 15 - 0.0065 * (h + SITE["alt"])


def to_lat(n: float) -> float:
    return SITE["lat"] + n / MPD


def to_lon(e: float) -> float:
    return SITE["lon"] + e / (MPD * CL)


@dataclass
class State:
    h: float
    vz: float
    vh: float
    az: float
    e: float
    n: float
    phase: int
    sep: bool = False


def rocket(t: float) -> State:
    if t <= 0:
        h, vz, az = 0.0, 0.0, 1.0
    elif t < TB:
        h, vz, az = 0.5 * A * t * t, A * t, A / G + 1
    elif t <= TAP:
        u = t - TB
        h, vz, az = 0.5 * A * TB * TB + VB * u - 0.5 * G * u * u, VB - G * u, -0.08
    elif t < T_DROGUE:
        u = t - TAP
        h, vz, az = 6096 - 0.5 * G * u * u, -G * u, 0.0
    elif t < T_MAIN:
        h, vz, az = HD - VD * (t - T_DROGUE), -VD, 1.0
    elif t < T_LAND:
        h, vz, az = MAIN_ALT - VMAIN * (t - T_MAIN), -VMAIN, 1.0
    else:
        h, vz, az = 0.0, 0.0, 1.0
    ref = h if t <= TAP else 6096.0
    e, n = 0.012 * ref, 0.006 * ref
    if t > TAP:
        u = min(t, T_LAND) - TAP
        e += 5 * u
        n -= 1.2 * u
    vh = 0.0 if t <= 0 or t >= T_LAND else (abs(vz) * 0.02 if t <= TAP else 5.2)
    if t < 0:
        ph = 0
    elif t < TYAK:
        ph = 1
    elif t < TAP:
        ph = 2
    elif t < T_DROGUE:
        ph = 3
    elif t < T_SEP:
        ph = 4
    elif t < T_MAIN:
        ph = 5
    elif t < T_LAND:
        ph = 6
    else:
        ph = 7
    return State(h, vz, vh, az, e, n, ph)


def payload(t: float) -> State:
    if t < T_SEP:
        s = rocket(t)
        s.sep = False
        return s
    r0 = rocket(T_SEP)
    u = min(t, T_LAND_PL) - T_SEP
    h = max(0.0, H_SEP - VPL * (t - T_SEP))
    return State(h, -VPL if h > 0 else 0.0, 6.4 if h > 0 else 0.0, 1.0, r0.e + 6.2 * u, r0.n - 1.8 * u, rocket(t).phase, True)


def attitude(t: float) -> tuple[float, float, float]:
    if t <= 0:
        p, y, r = 85.0, 231.0, 0.0
    elif t < TAP:
        p, y, r = 85 - 70 * (t / TAP) ** 2.2, 231 + 0.15 * t, ((t * 24) % 360) - 180
    elif t < TAP + 1.5:
        p, y, r = 15 - 55 * (t - TAP) / 1.5, 236 + 2 * (t - TAP), -120 + 6 * (t - TAP)
    else:
        p, y, r = -4 + 12 * math.sin(t * 1.25), (240 + 4 * (t - TAP)) % 360, (((t - TAP) * 6) % 360) - 180
    return p + nz(t, 30, 0.4), (y + nz(t, 31, 0.6)) % 360, r + nz(t, 32, 0.5)


def pl_gps_lost(t: float) -> bool:
    return 126 < t < 141


def bk_drop(t: float) -> bool:
    return 158 < t < 161.5


def blocks_for(src: str, t: float) -> list[bytes]:
    r = rocket(t)
    if src == "main":
        return [
            encode_block("baro", {"alt": r.h + nz(t, 1, 2), "p": (pres(r.h) + nz(t, 8, 0.3)), "temp": temp_c(r.h) + 2.5 + nz(t, 9, 0.2)}),
            encode_block("acc", {"ax": 0, "ay": 0, "az": r.az + nz(t, 7, 0.12)}),
            encode_block("vz", {"vz": r.vz + nz(t, 3, 0.6)}),
            encode_block("gnss", {"lat": to_lat(r.n + nz(t, 40, 1.2)), "lon": to_lon(r.e + nz(t, 41, 1.2)), "gpsAlt": r.h + SITE["alt"], "sats": 13, "vh": r.vh}),
            encode_block("state", {"phase": r.phase, "flags": 0}),
            encode_block("power", {"bat": 8.06 - 0.00008 * (t + 900)}),
        ]
    if src == "backup":
        p, y, ro = attitude(t)
        return [
            encode_block("alt", {"alt": r.h + nz(t, 2, 3)}),
            encode_block("vz", {"vz": r.vz + nz(t, 4, 0.7)}),
            encode_block("acc", {"ax": nz(t, 5, 0.15) + (0.3 if 0 < t < TB else 0), "ay": nz(t, 6, 0.15), "az": r.az + nz(t, 7, 0.12)}),
            encode_block("att", {"pitch": p, "yaw": y, "roll": ro}),
            encode_block("gnss", {"lat": to_lat(r.n + nz(t, 42, 0.9)), "lon": to_lon(r.e + nz(t, 43, 0.9)), "gpsAlt": r.h + SITE["alt"] + nz(t, 20, 3), "sats": 14, "vh": max(0.0, r.vh + nz(t, 5, 0.3))}),
            encode_block("state", {"phase": r.phase, "flags": 0}),
            encode_block("power", {"bat": 7.81 - 0.00007 * (t + 900)}),
        ]
    s = payload(t)
    out = [
        encode_block("baro", {"alt": s.h + nz(t, 10, 2), "p": (pres(s.h) + 0.6 + nz(t, 12, 0.3)), "temp": temp_c(s.h) + 4 + nz(t, 13, 0.2)}),
        encode_block("vz", {"vz": s.vz + nz(t, 11, 0.5)}),
        encode_block("hum", {"hum": max(5.0, 40 - 0.004 * s.h) + nz(t, 14, 0.5)}),
    ]
    if not pl_gps_lost(t):
        out.append(encode_block("gnss", {"lat": to_lat(s.n + nz(t, 44, 1.5)), "lon": to_lon(s.e + nz(t, 45, 1.5)), "gpsAlt": s.h + SITE["alt"], "sats": 11, "vh": s.vh}))
    out += [encode_block("state", {"phase": 0, "flags": 1 if s.sep else 0}), encode_block("power", {"bat": 7.64 - 0.00006 * (t + 900)})]
    return out


def rssi_dbm(src: str, t: float) -> float:
    h = payload(t).h if src == "payload" else rocket(t).h
    base = {"main": -68, "backup": -71, "payload": -73}[src]
    div = {"main": 900, "backup": 850, "payload": 800}[src]
    return base - h / div + nz(round(t), 13 + list(OFFSETS).index(src), 0.8)


class SimTransmitter:
    """Bir UKB'nin vericisi + alıcının seri çıkışı: görev zamanına kadar olan baytları üretir."""

    def __init__(self, src: str, rssi_byte: bool = True) -> None:
        self.src = src
        self.k = 0
        self.rssi_byte = rssi_byte
        self._held: bytes | None = None

    def t_of(self, k: int) -> float:
        return ACTIVATION_T + 38 + k / HZ + OFFSETS[self.src]

    def frame(self, k: int) -> bytes:
        t = self.t_of(k)
        rb = int(round(rssi_dbm(self.src, t))) & 0xFF if self.rssi_byte else None
        raw = bytearray(encode_frame(self.src, k, int((t - ACTIVATION_T) * 1000), blocks_for(self.src, t), rb))
        if self.src == "main" and _h(k * 3.1) < 0.006:
            raw[12] ^= 0x5A  # CRC hatası: yükte bir bayt bozulur
        return bytes(raw)

    def until(self, t_end: float) -> list[tuple[float, bytes]]:
        """(alım zamanı, baytlar) listesi; t_end'e kadar."""
        out: list[tuple[float, bytes]] = []
        while self.t_of(self.k) <= t_end:
            k, t = self.k, self.t_of(self.k)
            self.k += 1
            if self.src == "backup" and bk_drop(t):
                continue
            data = self.frame(k)
            if self.src == "backup" and _h(k * 5.7) < 0.004 and self._held is None:
                self._held = data  # sıra dışı: bir sonrakinden sonra gönderilecek
                continue
            if self.src == "main" and _h(k * 1.9) < 0.003:
                data = b"\x13\x37\xAA" + data  # hat gürültüsü / sahte senkron
            out.append((t + 0.012, data))
            if self._held is not None:
                out.append((t + 0.022, self._held))
                self._held = None
            if self.src == "payload" and _h(k * 2.3) < 0.004:
                out.append((t + 0.042, data))  # tekrar eden paket
        return out
