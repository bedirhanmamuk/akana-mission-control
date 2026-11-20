"""AKANA telemetri paket protokolü, sürüm 1.

Çerçeve (little-endian):

    AA 55 | LEN | VER | SRC | SEQ(u16) | T_MS(u32) | NB | blok_1 ... blok_NB | CRC16(u16) [| RSSI(u8)]

- LEN: VER'den son bloğun sonuna kadar olan bayt sayısı (CRC hariç).
- CRC16-CCITT (0x1021, başlangıç 0xFFFF), VER..son blok aralığı üzerinden.
- RSSI: E22 modülünde "RSSI baytı ekle" açıksa paketin ardından gelen bayt (dBm = -(256 - b)).

Blok yapısı CU InSpace yer istasyonundaki "başlık + bloklar" fikrinden alındı: aviyonik kartın
sensör seti netleşmediği için her alan tipli bir blok olarak gelir; yeni sensör eklemek protokolü bozmaz,
bilinmeyen blok türünde çözümleme o paket için durur ve paket "çözümlenemedi" olarak sayılır.
"""

from __future__ import annotations

import struct
from dataclasses import dataclass, field
from typing import Any

SYNC = b"\xAA\x55"
VERSION = 1
HEADER_FMT = "<BBHIB"  # VER, SRC, SEQ, T_MS, NB
HEADER_LEN = struct.calcsize(HEADER_FMT)  # 9
MAX_LEN = 128  # en uzun geçerli gövde; daha büyük LEN sahte senkron sayılır (çözümleyici bekleyip takılmasın)

SOURCE_IDS: dict[int, str] = {1: "main", 2: "backup", 3: "payload"}
SOURCE_CODES: dict[str, int] = {v: k for k, v in SOURCE_IDS.items()}


def crc16_ccitt(data: bytes, crc: int = 0xFFFF) -> int:
    for b in data:
        crc ^= b << 8
        for _ in range(8):
            crc = ((crc << 1) ^ 0x1021) & 0xFFFF if crc & 0x8000 else (crc << 1) & 0xFFFF
    return crc


@dataclass(frozen=True)
class BlockSpec:
    code: int
    name: str
    fmt: str
    # (alan adı, ölçek) — fiziksel değer = ham * ölçek
    fields: tuple[tuple[str, float], ...]

    @property
    def size(self) -> int:
        return struct.calcsize(self.fmt)


BLOCKS: dict[int, BlockSpec] = {
    b.code: b
    for b in (
        BlockSpec(0x01, "baro", "<iIh", (("alt", 0.01), ("p", 0.01), ("temp", 0.01))),  # cm, Pa→hPa, c°C
        BlockSpec(0x02, "acc", "<hhh", (("ax", 0.001), ("ay", 0.001), ("az", 0.001))),  # mg → g
        BlockSpec(0x03, "att", "<hHh", (("pitch", 0.01), ("yaw", 0.01), ("roll", 0.01))),  # santiderece
        BlockSpec(0x04, "gnss", "<iiiBH", (("lat", 1e-7), ("lon", 1e-7), ("gpsAlt", 0.01), ("sats", 1), ("vh", 0.01))),
        BlockSpec(0x05, "vz", "<h", (("vz", 0.01),)),  # cm/s
        BlockSpec(0x06, "hum", "<H", (("hum", 0.01),)),  # %0,01
        BlockSpec(0x07, "state", "<BB", (("phase", 1), ("flags", 1))),  # flags bit0: görev yükü ayrıldı
        BlockSpec(0x08, "power", "<H", (("bat", 0.001),)),  # mV
        BlockSpec(0x09, "alt", "<i", (("alt", 0.01),)),  # Kalman irtifası, cm
    )
}
BLOCK_BY_NAME = {b.name: b for b in BLOCKS.values()}


class ProtocolError(ValueError):
    pass


def encode_block(name: str, values: dict[str, float]) -> bytes:
    spec = BLOCK_BY_NAME[name]
    raw = [int(round(values[f] / s)) for f, s in spec.fields]
    return bytes([spec.code]) + struct.pack(spec.fmt, *raw)


def encode_frame(source: str, seq: int, t_ms: int, blocks: list[bytes], rssi_byte: int | None = None) -> bytes:
    body = struct.pack(HEADER_FMT, VERSION, SOURCE_CODES[source], seq & 0xFFFF, t_ms & 0xFFFFFFFF, len(blocks)) + b"".join(blocks)
    if len(body) > MAX_LEN:
        raise ProtocolError(f"çerçeve çok uzun: {len(body)} bayt")
    out = SYNC + bytes([len(body)]) + body + struct.pack("<H", crc16_ccitt(body))
    if rssi_byte is not None:
        out += bytes([rssi_byte & 0xFF])
    return out


def decode_blocks(payload: bytes, nb: int) -> dict[str, float]:
    fields: dict[str, float] = {}
    i = 0
    for _ in range(nb):
        if i >= len(payload):
            raise ProtocolError("blok sayısı yükten fazla")
        spec = BLOCKS.get(payload[i])
        if spec is None:
            raise ProtocolError(f"bilinmeyen blok türü 0x{payload[i]:02X}")
        i += 1
        if i + spec.size > len(payload):
            raise ProtocolError(f"{spec.name} bloğu kesik")
        raw = struct.unpack_from(spec.fmt, payload, i)
        i += spec.size
        for (name, scale), r in zip(spec.fields, raw):
            fields[name] = r * scale
    if i != len(payload):
        raise ProtocolError("blokların ardında fazladan bayt var")
    if "flags" in fields:
        fields["sep"] = 1 if int(fields.pop("flags")) & 1 else 0
    if "p" in fields:
        fields["p"] = round(fields["p"], 2)
    return fields


@dataclass
class Frame:
    src_code: int
    seq: int
    t_ms: int
    crc_ok: bool
    fields: dict[str, float]
    raw: bytes
    rssi: float | None = None
    error: str | None = None

    @property
    def source(self) -> str | None:
        return SOURCE_IDS.get(self.src_code)


@dataclass
class ParserStats:
    bytes_in: int = 0
    frames: int = 0
    crc_errors: int = 0
    decode_errors: int = 0
    resync_bytes: int = 0  # senkron arayışında atlanan bayt


@dataclass
class FrameParser:
    """Bayt akışından çerçeve çıkarır. Bozuk/kesik veride senkronu yeniden yakalar.

    CRC'si tutmayan çerçeve de döndürülür (crc_ok=False), böylece arayüz CRC hatasını sayabilir;
    alanları boştur. Uzunluk alanı bozuksa yanlış bir çerçeveye kilitlenmemek için yalnızca
    1 bayt ilerlenir ve senkron yeniden aranır.
    """

    rssi_byte: bool = False
    buf: bytearray = field(default_factory=bytearray)
    stats: ParserStats = field(default_factory=ParserStats)
    _covered: int = 0  # son raporlanan bozuk çerçevenin tamponda kalan bayt sayısı (çift sayımı önler)

    def _drop(self, k: int) -> None:
        del self.buf[:k]
        self._covered = max(0, self._covered - k)

    def feed(self, data: bytes) -> list[Frame]:
        self.stats.bytes_in += len(data)
        self.buf += data
        out: list[Frame] = []
        tail = 2 + (1 if self.rssi_byte else 0)
        while True:
            start = self.buf.find(SYNC)
            if start < 0:
                keep = 1 if self.buf.endswith(SYNC[:1]) else 0
                self.stats.resync_bytes += len(self.buf) - keep
                self._drop(len(self.buf) - keep)
                break
            if start:
                self.stats.resync_bytes += start
                self._drop(start)
            if len(self.buf) < 3:
                break
            n = self.buf[2]
            if n < HEADER_LEN or n > MAX_LEN:
                self.stats.resync_bytes += 1
                self._drop(1)
                continue
            total = 3 + n + tail
            if len(self.buf) < total:
                break
            body = bytes(self.buf[3 : 3 + n])
            crc_rx = struct.unpack_from("<H", self.buf, 3 + n)[0]
            rssi = -(256 - self.buf[3 + n + 2]) if self.rssi_byte else None
            raw = bytes(self.buf[:total])
            ver, src, seq, t_ms, nb = struct.unpack_from(HEADER_FMT, body, 0)
            if crc16_ccitt(body) != crc_rx or ver != VERSION:
                # Sahte senkron olabilir: tek bayt ilerle; gerçek çerçeve hemen arkadaysa kaçırmayız.
                # Aynı bozuk bölge içindeki ikincil senkron adayları ayrıca sayılmaz.
                if self._covered == 0:
                    self.stats.crc_errors += 1
                    out.append(Frame(src, seq, t_ms, False, {}, raw, rssi, "crc" if ver == VERSION else f"sürüm {ver}"))
                    self._covered = total
                self._drop(1)
                continue
            self._drop(total)
            self.stats.frames += 1
            try:
                fields = decode_blocks(body[HEADER_LEN:], nb)
                out.append(Frame(src, seq, t_ms, True, fields, raw, rssi))
            except ProtocolError as e:
                self.stats.decode_errors += 1
                out.append(Frame(src, seq, t_ms, True, {}, raw, rssi, str(e)))
        return out


def frame_to_dict(fr: Frame) -> dict[str, Any]:
    return {"src": fr.source, "seq": fr.seq, "t_ms": fr.t_ms, "crc": fr.crc_ok, "fields": fr.fields, "rssi": fr.rssi}
