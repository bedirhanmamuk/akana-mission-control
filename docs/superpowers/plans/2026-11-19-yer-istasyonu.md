# AKANA Yer İstasyonu Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** N adet LoRa alıcısından gelen roket/görev yükü telemetrisini alan, kaydeden, HYİ'ye ileten ekransız bir çekirdek ve ona bağlanan "uçuş sahnesi" Qt Quick arayüzü.

**Architecture:** İki süreç. `yi-core` (saf Python): kaynak başına okuyucu iş parçacığı → ham kayıt → şemaya dayalı çerçeve çözücü → durum/sağlık/CSV/HYİ → TCP JSON veri yolu. `yi-ui` (PySide6 + QML): veri yoluna bağlanan istemci; mantık Python view-model'lerde, QML yalnızca görünüm.

**Tech Stack:** Python ≥ 3.11, PySide6 ≥ 6.6 (QtQuick, QtQuick.Shapes), pyserial ≥ 3.5, PyYAML ≥ 6, pytest ≥ 8.

**Spec:** `docs/superpowers/specs/2026-11-19-yer-istasyonu-design.md` · Görsel yön: `.superpowers/yer-istasyonu/layout-v2.html`

Plan iki bölümdür. **Bölüm 1 (Görev 1–12)** tek başına çalışan, simülatörle uçtan uca test edilmiş çekirdeği üretir. **Bölüm 2 (Görev 13–20)** arayüzü ekler.

## Global Constraints

- Tüm kod `yer-istasyonu/` altında; paket adı `yeristasyonu`, kaynak `yer-istasyonu/src/yeristasyonu/`, testler `yer-istasyonu/tests/`. Depodaki diğer dizinlere dokunulmaz.
- Tüm komutlar `yer-istasyonu/` dizininden çalışır. Test komutu: `python -m pytest <yol> -v`.
- Python ≥ 3.11; bağımlılıklar yalnızca: `PySide6>=6.6`, `pyserial>=3.5`, `PyYAML>=6`; geliştirme: `pytest>=8`. Başka paket eklenmez (numpy dahil).
- İnternet gerektiren hiçbir kod yolu yok.
- İrtifa eşiği / tavan: `CEILING_M = 6096.0` (20.000 ft). `FT_PER_M = 3.28084`.
- Sağlık eşikleri: yeşil `age < 1.0 s ve rate ≥ 4.5 Hz`; sarı `age < 3.0 s`; aksi kırmızı. Pencere 2.0 s. Sıra farkı > 1000 → yeniden başlama, kayıp değil.
- Veri yolu: `127.0.0.1:47800`, satır başına UTF-8 JSON; yavaş istemci kuyruğu sınırı 500.
- Faz enum: `0 RAMPA, 1 MOTOR, 2 SUZULME, 3 APOGEE, 4 DROGUE, 5 MAIN, 6 YERDE`.
- Arayüz metinleri Türkçe. Birincil birim metre, ft ikincil.
- Arayüz ekranı kendiliğinden düzen değiştirmez (yalnızca öneri gösterebilir).
- QML testleri `QT_QPA_PLATFORM=offscreen` ile çalışır (`tests/conftest.py` ayarlar).

## Review Focus

1. **USB alıcı uçuş sırasında çıkıp geri takılırsa** okuyucu iş parçacığı ölmemeli; 1 s aralıkla portu yeniden açmayı denemeli, sağlık kırmızıya dönmeli, ham kayıt aynı dosyaya devam etmeli. → Görev 9'a test eklendi (`test_reader_survives_serial_drop`).
2. **Arayüz kapanıp yeniden açılırsa** iz ve olaylar kaybolmamalı. → Görev 10/12 `snapshot` mesajı ve testi (`test_new_client_gets_snapshot`).
3. **GPS fix yokken** (`lat=lon=0` veya `sats<4`) harita/kubbe (0,0) noktasını göstermemeli; son geçerli konum ve yaşı kullanılmalı. → Görev 8 (`test_track_ignores_invalid_gps`).
4. **Disk yazma hatası** (dolu disk, çıkarılan USB bellek) çekirdeği durdurmamalı; telemetri akışı sürmeli, sağlıkta `log_error` görünmeli. → Görev 7 (`test_rawlog_write_error_is_reported_not_raised`).
5. **Yanlış şema dosyası** (bilinmeyen tip, eksik rol hedefi) açılışta alan adını söyleyen `SchemaError` ile durmalı; sessizce yanlış çözüm yapılmamalı. → Görev 1 (`test_unknown_type_rejected`, `test_role_must_point_to_field`).

---

# BÖLÜM 1 — Çekirdek

### Task 1: Proje iskeleti ve paket şeması

**Files:**
- Create: `yer-istasyonu/pyproject.toml`, `yer-istasyonu/README.md` (kurulum + çalıştırma, kısa)
- Create: `yer-istasyonu/src/yeristasyonu/__init__.py`, `yer-istasyonu/src/yeristasyonu/schema.py`
- Create: `yer-istasyonu/config/paketler/akana_v1_roket.yaml`, `yer-istasyonu/config/paketler/akana_v1_gorevyuku.yaml`
- Create: `yer-istasyonu/tests/conftest.py`, `yer-istasyonu/tests/test_schema.py`

**Interfaces:**
- Produces:
  - `class SchemaError(ValueError)`
  - `@dataclass(frozen=True) FieldSpec(name: str, type: str, scale: float = 1.0, unit: str = "", enum: dict[int, str] | None = None)`; `size: int` özelliği.
  - `@dataclass(frozen=True) PacketSchema(name: str, sync: bytes, length_byte: bool, endian: str, crc: str, rssi_byte: bool, fields: tuple[FieldSpec, ...], roles: dict[str, str])`; özellikler `payload_size: int`, `struct_format: str`; metot `field(name) -> FieldSpec`, `enum_name(field: str, value: int) -> str | None`.
  - `load_schema(path: str | Path) -> PacketSchema`
  - `TYPES = {"u8":"B","i8":"b","u16":"H","i16":"h","u32":"I","i32":"i","f32":"f"}`, `CRC_TYPES = {"crc16_ccitt_false","crc16_modbus","none"}`

- [ ] **Step 1: pyproject ve conftest**

`pyproject.toml`: proje adı `akana-yer-istasyonu`, `src` düzeni, bağımlılıklar Global Constraints'teki gibi, `[project.scripts] yi-core = "yeristasyonu.core:main"`, `yi-ui = "yeristasyonu.ui.app:main"`, `[tool.pytest.ini_options] testpaths=["tests"] pythonpath=["src"]`.
`tests/conftest.py`: `os.environ.setdefault("QT_QPA_PLATFORM", "offscreen")`; fixture `config_dir` → `Path(__file__).parent.parent / "config"`.

- [ ] **Step 2: Şema YAML dosyaları**

Spec §7.1'deki alan listeleri birebir. `sync: [0xAA, 0x55]`, `length_byte: true`, `endian: little`, `crc: crc16_ccitt_false`, `rssi_byte: false`. Roket rolleri: `seq, t_ms, phase, altitude: kalman_alt, vz, accel_x: ax, accel_y: ay, accel_z: az, roll, pitch, yaw, lat, lon, gps_alt, sats`. Görev yükü rolleri: `seq, t_ms, altitude: baro_alt, vz, lat, lon, gps_alt, sats`. `phase` alanında `enum` Global Constraints'teki faz listesi. Dosya başına yorum: "Alan sırası tahmindir; aviyonik struct gelince güncelle."

- [ ] **Step 3: Failing testleri yaz**

```python
from yeristasyonu.schema import load_schema, SchemaError

def test_roket_payload_size(config_dir):
    s = load_schema(config_dir / "paketler/akana_v1_roket.yaml")
    assert s.payload_size == 63
    assert s.sync == b"\xAA\x55"
    assert s.struct_format.startswith("<")
    assert s.roles["altitude"] == "kalman_alt"
    assert s.enum_name("phase", 3) == "APOGEE"

def test_gorevyuku_payload_size(config_dir):
    assert load_schema(config_dir / "paketler/akana_v1_gorevyuku.yaml").payload_size == 34

def test_unknown_type_rejected(tmp_path):
    p = tmp_path / "s.yaml"
    p.write_text("name: x\nsync: [1]\nlength_byte: true\nendian: little\ncrc: none\n"
                 "fields:\n  - {name: a, type: f64}\nroles: {}\n")
    with pytest.raises(SchemaError, match="a.*f64"):
        load_schema(p)

def test_role_must_point_to_field(tmp_path):
    p = tmp_path / "s.yaml"
    p.write_text("name: x\nsync: [1]\nlength_byte: true\nendian: little\ncrc: none\n"
                 "fields:\n  - {name: a, type: u8}\nroles: {altitude: yok}\n")
    with pytest.raises(SchemaError, match="altitude.*yok"):
        load_schema(p)
```

Ek olarak: bilinmeyen `crc` değeri ve yinelenen alan adı `SchemaError`.

- [ ] **Step 4: Çalıştır, FAIL gör** — `python -m pytest tests/test_schema.py -v` → `ModuleNotFoundError`.
- [ ] **Step 5: `schema.py`'yi yaz.** `rssi_byte` yoksa `False`. `scale` yoksa 1.0.
- [ ] **Step 6: Çalıştır, PASS gör.**
- [ ] **Step 7: Commit** — `git add yer-istasyonu && git commit -m "yer-istasyonu: proje iskeleti ve YAML paket şeması"`

---

### Task 2: CRC ve kodlayıcı/çözücü

**Files:**
- Create: `src/yeristasyonu/crc.py`, `src/yeristasyonu/codec.py`
- Test: `tests/test_codec.py`

**Interfaces:**
- Consumes: `PacketSchema`, `FieldSpec`
- Produces:
  - `crc16_ccitt_false(data: bytes) -> int` (poly 0x1021, init 0xFFFF, yansımasız, xorout 0)
  - `crc16_modbus(data: bytes) -> int` (poly 0xA001 yansımalı, init 0xFFFF)
  - `compute_crc(kind: str, data: bytes) -> int | None` (`none` → None)
  - `decode_payload(schema, payload: bytes) -> dict[str, float | int]` (ham tamsayı × scale; scale 1 ve tamsayı tipse `int` döner)
  - `encode_payload(schema, values: dict[str, float]) -> bytes` (eksik alan 0; `round(v / scale)` ve tip aralığına kırpma)
  - `build_frame(schema, values: dict[str, float]) -> bytes` (sync + [len] + payload + [crc 2 bayt, şema endian'ı])

- [ ] **Step 1: Failing testler**

```python
def test_crc_check_values():
    assert crc16_ccitt_false(b"123456789") == 0x29B1
    assert crc16_modbus(b"123456789") == 0x4B37

def test_roundtrip_scaled(roket):
    vals = {"seq": 7, "lat": 38.7012345, "lon": 33.4567891, "kalman_alt": 6041.5, "phase": 3, "temp": -4.25}
    out = decode_payload(roket, encode_payload(roket, vals))
    assert out["seq"] == 7 and isinstance(out["seq"], int)
    assert abs(out["lat"] - 38.7012345) < 1e-7
    assert abs(out["kalman_alt"] - 6041.5) < 1e-3
    assert out["temp"] == pytest.approx(-4.25)

def test_frame_layout(roket):
    f = build_frame(roket, {"seq": 1})
    assert f[:2] == b"\xAA\x55" and f[2] == 63 and len(f) == 68
    assert int.from_bytes(f[-2:], "little") == crc16_ccitt_false(f[2:-2])

def test_encode_clamps_out_of_range(roket):
    assert decode_payload(roket, encode_payload(roket, {"sats": 999}))["sats"] == 255
```

(`roket` fixture'ı `conftest.py`'ye ekle: `load_schema(config_dir/"paketler/akana_v1_roket.yaml")`; `gorevyuku` aynı şekilde.)

- [ ] **Step 2: FAIL gör.**
- [ ] **Step 3: `crc.py` ve `codec.py`'yi yaz** (`struct.pack(schema.struct_format, ...)`).
- [ ] **Step 4: PASS gör.**
- [ ] **Step 5: Commit** — `"yer-istasyonu: CRC-16 ve şemaya dayalı kodlayıcı/çözücü"`

---

### Task 3: Akış çerçeveleyici (Framer)

**Files:**
- Create: `src/yeristasyonu/framer.py`
- Test: `tests/test_framer.py`

**Interfaces:**
- Consumes: `PacketSchema`, `compute_crc`
- Produces:
  - `@dataclass FrameResult(ok: bool, t: float, payload: bytes | None, rssi_dbm: int | None)`
  - `class Framer(schema)`: `feed(data: bytes, t: float) -> list[FrameResult]`; sayaçlar `crc_errors: int`, `resyncs: int`, `bytes_dropped: int`.

Davranış: tamponda sync aranır; sync öncesi baytlar atılır (`bytes_dropped`). Uzunluk baytı `payload_size`'a eşit değilse 1 bayt kaydırılıp yeniden aranır (`resyncs += 1`). Çerçeve tamamlanınca CRC kontrol edilir; hatalıysa `FrameResult(ok=False, payload=None)` üretilir, `crc_errors += 1` ve sync başlangıcından 1 bayt ileri kaydırılır (yük içinde gerçek bir sync olabilir). `rssi_byte` açıksa çerçeveden sonraki bayt `rssi_dbm = -(256 - b)`. Tampon üst sınırı 4096 bayt; aşılırsa en eskiler atılır. `t`, çerçevenin son baytını içeren `feed` çağrısının zamanıdır.

- [ ] **Step 1: Failing testler**

```python
def test_single_frame(roket):
    r = Framer(roket).feed(build_frame(roket, {"seq": 5}), 1.0)
    assert [x.ok for x in r] == [True] and decode_payload(roket, r[0].payload)["seq"] == 5

def test_garbage_and_split_chunks(roket):
    fr = Framer(roket); data = b"\x00\xAA\x13" + build_frame(roket, {"seq": 1}) + build_frame(roket, {"seq": 2})
    out = []
    for i in range(0, len(data), 7):
        out += fr.feed(data[i:i+7], float(i))
    assert [decode_payload(roket, x.payload)["seq"] for x in out if x.ok] == [1, 2]

def test_crc_error_then_recovery(roket):
    bad = bytearray(build_frame(roket, {"seq": 1})); bad[10] ^= 0xFF
    fr = Framer(roket); out = fr.feed(bytes(bad) + build_frame(roket, {"seq": 2}), 0.0)
    assert [x.ok for x in out] == [False, True] and fr.crc_errors == 1

def test_wrong_length_resync(roket):
    fr = Framer(roket); out = fr.feed(b"\xAA\x55\x05" + build_frame(roket, {"seq": 9}), 0.0)
    assert [x.ok for x in out] == [True] and fr.resyncs >= 1

def test_rssi_byte(roket):
    s = dataclasses.replace(roket, rssi_byte=True)
    out = Framer(s).feed(build_frame(s, {"seq": 1}) + bytes([185]), 0.0)
    assert out[0].rssi_dbm == -71
```

- [ ] **Step 2: FAIL gör.** · **Step 3: `framer.py`'yi yaz.** · **Step 4: PASS gör.**
- [ ] **Step 5: Commit** — `"yer-istasyonu: yeniden senkronlanan çerçeveleyici"`

---

### Task 4: Bağlantı sağlığı

**Files:**
- Create: `src/yeristasyonu/health.py`
- Test: `tests/test_health.py`

**Interfaces:**
- Produces:
  - `@dataclass HealthSnapshot(status: str, rate_hz: float, crc_error_pct: float, lost: int, age_s: float | None, rssi_dbm: int | None, log_error: str | None = None)`; `to_dict() -> dict`
  - `class LinkHealth(window_s: float = 2.0)`: `on_frame(t: float, ok: bool, seq: int | None, rssi_dbm: int | None) -> None`, `set_log_error(msg: str | None)`, `snapshot(now: float) -> HealthSnapshot`

`rate_hz` = penceredeki geçerli çerçeve sayısı / window_s. `crc_error_pct` = penceredeki hatalı / toplam × 100 (toplam 0 ise 0). `status` için eşikler Global Constraints'te. Hiç paket yoksa `age_s=None`, `status="kirmizi"`. Durum değerleri: `"yesil" | "sari" | "kirmizi"`.

- [ ] **Step 1: Failing testler**

```python
def feed(h, n, hz=5.0, start=0.0, seq0=0):
    for i in range(n): h.on_frame(start + i / hz, True, (seq0 + i) % 65536, -70)

def test_green_at_5hz():
    h = LinkHealth(); feed(h, 20)
    s = h.snapshot(3.85); assert s.status == "yesil" and s.rate_hz == pytest.approx(5.0, abs=0.5)

def test_yellow_then_red_by_age():
    h = LinkHealth(); feed(h, 20)
    assert h.snapshot(3.8 + 1.5).status == "sari"
    assert h.snapshot(3.8 + 3.5).status == "kirmizi"

def test_loss_with_wrap():
    h = LinkHealth()
    for s in (65534, 65535, 2): h.on_frame(0, True, s, None)
    assert h.snapshot(0).lost == 2

def test_restart_is_not_loss():
    h = LinkHealth()
    for s in (40000, 3): h.on_frame(0, True, s, None)
    assert h.snapshot(0).lost == 0

def test_crc_pct():
    h = LinkHealth(); h.on_frame(0, True, 0, None); h.on_frame(0.1, False, None, None)
    assert h.snapshot(0.2).crc_error_pct == 50.0

def test_no_packets_red():
    assert LinkHealth().snapshot(10).status == "kirmizi"
```

- [ ] **Step 2–4:** FAIL → `health.py` → PASS.
- [ ] **Step 5: Commit** — `"yer-istasyonu: bağlantı sağlığı (hız, CRC, kayıp, yaş)"`

---

### Task 5: Coğrafi hesaplar

**Files:**
- Create: `src/yeristasyonu/geo.py`
- Test: `tests/test_geo.py`

**Interfaces:**
- Produces:
  - `look_angles(station: tuple[float, float, float], target: tuple[float, float, float]) -> tuple[float, float, float]` → `(az_deg ∈ [0,360), el_deg, slant_m)`; WGS-84 (a=6378137.0, f=1/298.257223563) ECEF → ENU.
  - `enu(origin, target) -> tuple[float, float, float]` (doğu, kuzey, yukarı, m)
  - `ground_distance_m(origin, target) -> float` (= √(e²+n²))
  - `latlon_to_tile(lat: float, lon: float, z: int) -> tuple[float, float]` (Web Mercator, kesirli karo koordinatı)
  - `sky_to_xy(az_deg: float, el_deg: float, radius: float) -> tuple[float, float]` (Spec §8.5 formülü; el < 0 → kenara kırpılır)

- [ ] **Step 1: Failing testler**

```python
ST = (38.0, 33.0, 900.0)

def test_overhead():
    az, el, r = look_angles(ST, (38.0, 33.0, 1900.0))
    assert el == pytest.approx(90.0, abs=0.01) and r == pytest.approx(1000.0, abs=0.5)

def test_north_and_east():
    az, el, r = look_angles(ST, (38.01, 33.0, 900.0))
    assert (az < 0.5 or az > 359.5) and r == pytest.approx(1110.9, abs=2.0) and el < 0
    az, _, _ = look_angles(ST, (38.0, 33.01, 900.0))
    assert az == pytest.approx(90.0, abs=0.5)

def test_tile():
    assert latlon_to_tile(0.0, 0.0, 1) == pytest.approx((1.0, 1.0))
    x, y = latlon_to_tile(85.0511, -180.0, 3); assert x == pytest.approx(0.0) and y == pytest.approx(0.0, abs=1e-3)

def test_sky_to_xy():
    assert sky_to_xy(0, 90, 100) == pytest.approx((0.0, 0.0))
    assert sky_to_xy(90, 0, 100) == pytest.approx((100.0, 0.0))
    assert sky_to_xy(0, 45, 100) == pytest.approx((0.0, -50.0))
    assert sky_to_xy(180, -5, 100) == pytest.approx((0.0, 100.0))
```

- [ ] **Step 2–4:** FAIL → `geo.py` → PASS.
- [ ] **Step 5: Commit** — `"yer-istasyonu: ENU, bakış açıları, karo ve kubbe izdüşümü"`

---

### Task 6: Uçuş simülatörü

**Files:**
- Create: `src/yeristasyonu/sim.py`
- Test: `tests/test_sim.py`

**Interfaces:**
- Consumes: `PacketSchema`, `build_frame`, `geo` sabitleri (yerel düz-dünya dönüşümü: `dlat = n / 111320`, `dlon = e / (111320·cos(lat))` yeterli)
- Produces:
  - `@dataclass FlightProfile(apogee_m=6096.0, burn_s=4.0, drogue_mps=25.0, main_alt_m=500.0, main_mps=6.0, payload_mps=13.0, wind_e_mps=5.0, pad_s=10.0, launch=(38.0, 33.0, 900.0))`; özellikler `v_burnout: float`, `t_apogee: float`
  - `FlightProfile.truth(t: float, body: str) -> dict` (`body ∈ {"roket","gorevyuku"}`; `t` kalkışa göre, negatif = rampa). Anahtarlar: `alt_agl, vz, accel_g (eksenel), phase (int), lat, lon, gps_alt`.
  - `class SimSource(profile, schema, body, rate_hz=5.0 (sim zamanına göre), speed=1.0, noise=False, loss_pct=0.0, corrupt_pct=0.0, seed=0, clock=time.monotonic)`: ByteSource arayüzü (Görev 7) — `read(timeout: float) -> bytes`, `close()`. Sim zamanı `t_sim = (clock() - start)·speed - pad_s`. Rol eşlemesiyle şema alanlarını doldurur (`altitude`, `vz`, `phase`, `lat`, `lon`, `gps_alt`, `sats=14`, `accel_z=accel_g`, diğer roller 0); `seq` her pakette +1, `t_ms = t_sim·1000` (≥0'a kırpılmış).

Profil: `v_b` → `v_b·t_b/2 + v_b²/(2g) = apogee_m`, `g = 9.80665`. Faz: `t<0` RAMPA; `t<burn` MOTOR; `t<t_apogee` SUZULME; `t<t_apogee+1` APOGEE; alt > main_alt DROGUE; alt > 0 MAIN; aksi YERDE. Görev yükü apogee'ye kadar roketle aynı, sonra `payload_mps` ile iner ve fazı roketinkiyle aynı mantıktadır (main yok, DROGUE→YERDE). Yatay sürüklenme yalnızca apogee sonrası `wind_e_mps·(t - t_apogee)` doğuya.

- [ ] **Step 1: Failing testler**

```python
P = FlightProfile()

def test_burnout_and_apogee():
    assert P.v_burnout == pytest.approx(326.8, abs=0.5)
    assert P.t_apogee == pytest.approx(37.3, abs=0.1)
    assert P.truth(4.0, "roket")["alt_agl"] == pytest.approx(653.6, abs=1.0)
    assert P.truth(P.t_apogee, "roket")["alt_agl"] == pytest.approx(6096.0, abs=1.0)

def test_phases():
    ph = lambda t: P.truth(t, "roket")["phase"]
    assert [ph(-1), ph(1), ph(20), ph(P.t_apogee + 0.5)] == [0, 1, 2, 3]
    t_main = P.t_apogee + 1 + (6096 - 500) / 25.0 + 1
    assert ph(P.t_apogee + 30) == 4 and ph(t_main) == 5 and ph(10_000) == 6

def test_payload_descends_independently():
    t = P.t_apogee + 60
    assert P.truth(t, "gorevyuku")["alt_agl"] == pytest.approx(6096 - 13 * 60, abs=15)

def test_simsource_emits_decodable_frames(roket):
    clk = iter([0.0] + [i * 0.05 for i in range(1, 200)])
    src = SimSource(P, roket, "roket", speed=1.0, clock=lambda: next(clk))
    data = b"".join(src.read(0.05) for _ in range(100))
    frames = [f for f in Framer(roket).feed(data, 0) if f.ok]
    assert len(frames) >= 20
    seqs = [decode_payload(roket, f.payload)["seq"] for f in frames]
    assert seqs == sorted(seqs)

def test_loss_is_seeded(roket):
    ... # aynı tohum iki kez → aynı bayt akışı; loss_pct=50 → çerçeve sayısı ~yarısı (±%20)
```

`read(timeout)`: son okumadan bu yana `rate_hz`'e göre üretilmesi gereken paketleri döndürür; yoksa `timeout` kadar `time.sleep` yerine `clock` tabanlı bekler (testte sahte saat ilerler, gerçek uyku yok: `sleep` parametresi `sleep=time.sleep` olarak enjekte edilir, testte `lambda s: None`).

- [ ] **Step 2–4:** FAIL → `sim.py` → PASS.
- [ ] **Step 5: Commit** — `"yer-istasyonu: 20.000 ft analitik uçuş simülatörü"`

---

### Task 7: Kayıt ve tekrar oynatma

**Files:**
- Create: `src/yeristasyonu/sources.py` (ByteSource protokolü + ReplaySource), `src/yeristasyonu/logs.py`
- Test: `tests/test_logs.py`

**Interfaces:**
- Produces:
  - `class ByteSource(Protocol): read(timeout: float) -> bytes; close() -> None`
  - `class RawLogWriter(path)`: `write(t: float, data: bytes) -> None` (kayıt `struct.pack("<dI", t, len(data)) + data`; her yazmada `flush`, son fsync'ten ≥1 s geçtiyse `os.fsync`); `error: str | None` (yazma hatası yakalanır, buraya konur, istisna yükselmez); `close()`
  - `read_raw_log(path) -> Iterator[tuple[float, bytes]]` (yarım kalan son kaydı sessizce atlar)
  - `class CsvLogWriter(path, field_names: list[str])`: başlık `t_unix,<alanlar>`; `write(t: float, fields: dict)`; aynı hata politikası; `close()`
  - `class ReplaySource(path, speed: float = 1.0, clock=time.monotonic, sleep=time.sleep)`: kayıtları orijinal zaman aralıklarıyla (/ speed) döndürür; bitince `b""` ve `finished: bool = True`.
  - `new_session_dir(root: Path, now: datetime) -> Path` → `root / now.strftime("%Y%m%d_%H%M%S")` (oluşturur)

- [ ] **Step 1: Failing testler**

```python
def test_raw_roundtrip(tmp_path):
    w = RawLogWriter(tmp_path / "r.bin"); w.write(1.5, b"ab"); w.write(2.0, b"\x00" * 300); w.close()
    assert list(read_raw_log(tmp_path / "r.bin")) == [(1.5, b"ab"), (2.0, b"\x00" * 300)]

def test_truncated_tail_ignored(tmp_path):
    p = tmp_path / "r.bin"; w = RawLogWriter(p); w.write(1.0, b"xyz"); w.close()
    with open(p, "ab") as f: f.write(b"\x01\x02\x03")
    assert list(read_raw_log(p)) == [(1.0, b"xyz")]

def test_rawlog_write_error_is_reported_not_raised(tmp_path, monkeypatch):
    w = RawLogWriter(tmp_path / "r.bin")
    monkeypatch.setattr(w, "_f", BrokenFile())   # write() → OSError(28, "No space left on device")
    w.write(1.0, b"a")
    assert "No space" in w.error

def test_csv(tmp_path):
    w = CsvLogWriter(tmp_path / "c.csv", ["seq", "alt"]); w.write(1.0, {"seq": 1, "alt": 2.5}); w.close()
    assert (tmp_path / "c.csv").read_text().splitlines() == ["t_unix,seq,alt", "1.0,1,2.5"]

def test_replay_timing(tmp_path):
    ... # t=0,1,2 kayıtları; speed=2; sahte saat → 0.5 s aralıklarla dönen veriler, sonra finished
```

- [ ] **Step 2–4:** FAIL → yaz → PASS.
- [ ] **Step 5: Commit** — `"yer-istasyonu: ham/CSV kayıt ve tekrar oynatma"`

---

### Task 8: Uçuş durumu

**Files:**
- Create: `src/yeristasyonu/state.py`
- Test: `tests/test_state.py`

**Interfaces:**
- Consumes: `PacketSchema.roles`, `enum_name`
- Produces:
  - `@dataclass FlightEvent(phase: int, name: str, t: float, alt: float | None)`
  - `class FlightState(name: str, schema: PacketSchema, launch_alt_m: float)`:
    - `update(t: float, fields: dict) -> list[FlightEvent]` (yeni faz ilk kez görüldüğünde olay döner)
    - özellikler: `last: dict`, `last_t: float | None`, `max_alt: float | None`, `t_launch: float | None` (ilk `MOTOR` olayı zamanı), `events: list[FlightEvent]`, `last_fix: tuple[float, float, float] | None`, `last_fix_t: float | None`, `track: list[tuple[float, float, float, float]]` (t, lat, lon, alt)
    - `t_plus(now: float) -> float | None`
    - `snapshot(max_points: int = 2000) -> dict` (Spec §7.6 `snapshot` biçimi; iz eşit aralıklı seyreltilir, son nokta her zaman dahil)

`altitude` rolü AGL kabul edilir. GPS geçerli: `sats` rolü varsa ≥ 4 ve `lat`/`lon` ikisi birden 0 değil.

- [ ] **Step 1: Failing testler**

```python
def test_max_alt_and_events(roket):
    st = FlightState("roket", roket, 900.0)
    assert st.update(0.0, {"phase": 0, "kalman_alt": 0}) [0].name == "RAMPA"
    st.update(1.0, {"phase": 1, "kalman_alt": 50}); st.update(30.0, {"phase": 2, "kalman_alt": 6000})
    st.update(31.0, {"phase": 2, "kalman_alt": 5990})
    assert st.max_alt == 6000 and st.t_launch == 1.0 and st.t_plus(11.0) == 10.0
    assert [e.name for e in st.events] == ["RAMPA", "MOTOR", "SUZULME"]

def test_track_ignores_invalid_gps(roket):
    st = FlightState("roket", roket, 900.0)
    st.update(0, {"lat": 0.0, "lon": 0.0, "sats": 14})
    st.update(1, {"lat": 38.0, "lon": 33.0, "sats": 3})
    st.update(2, {"lat": 38.0, "lon": 33.0, "sats": 9, "gps_alt": 1500})
    assert st.last_fix == (38.0, 33.0, 1500) and st.last_fix_t == 2 and len(st.track) == 1

def test_snapshot_decimates(roket):
    st = FlightState("roket", roket, 900.0)
    for i in range(5000): st.update(i, {"lat": 38 + i * 1e-6, "lon": 33.0, "sats": 9})
    snap = st.snapshot(2000)
    assert len(snap["track"]) <= 2000 and snap["track"][-1][0] == 4999
```

- [ ] **Step 2–4:** FAIL → `state.py` → PASS.
- [ ] **Step 5: Commit** — `"yer-istasyonu: uçuş durumu, olaylar ve GPS izi"`

---

### Task 9: Yapılandırma, seri kaynak ve okuyucu

**Files:**
- Create: `src/yeristasyonu/config.py`, `src/yeristasyonu/reader.py`; Modify: `src/yeristasyonu/sources.py` (SerialSource ekle)
- Create: `config/istasyon.yaml` (örnek: iki kaynak `roket` COM5, `gorevyuku` COM6, istasyon konumu yer tutucu, `hyi: {port: null, baud: 19200, rate_hz: 5}`, `log_dir: kayitlar`, `bus_port: 47800`, `ceiling_m: 6096`)
- Test: `tests/test_config.py`, `tests/test_reader.py`

**Interfaces:**
- Produces:
  - `@dataclass SourceConfig(name, label, port, baud=9600, schema: PacketSchema, color="#d9a441")`
  - `@dataclass HyiConfig(port: str | None, baud: int, rate_hz: float)`
  - `@dataclass StationConfig(station: tuple[float, float, float], sources: list[SourceConfig], hyi: HyiConfig, log_dir: Path, bus_port: int, ceiling_m: float, path: Path)`
  - `load_station_config(path) -> StationConfig` (şema yolları yapılandırma dosyasına göreli; kaynak adları benzersiz ve `[a-z0-9_]+`, aksi `ValueError`)
  - `class SerialSource(port: str, baud: int, reopen_s: float = 1.0, opener=serial.serial_for_url)`: `read(timeout)` → bayt; port hatasında istisna yükseltmez, `b""` döner, `connected: bool = False`, `last_error: str`, `reopen_s` sonra yeniden açmayı dener. `loop://` URL'leri desteklenir.
  - `class SourceReader(threading.Thread)`: `__init__(name, source: ByteSource, sink: Callable[[str, float, bytes], None], clock=time.time)`; döngü `data = source.read(0.05)`; boş değilse `sink(name, clock(), data)`; `stop()`; istisnada iş parçacığı ölmez, hatayı `last_error`'a yazar ve devam eder.

- [ ] **Step 1: Failing testler**

```python
def test_load_example(config_dir):
    c = load_station_config(config_dir / "istasyon.yaml")
    assert [s.name for s in c.sources] == ["roket", "gorevyuku"] and c.ceiling_m == 6096 and c.hyi.port is None

def test_loop_serial():
    s = SerialSource("loop://", 9600); s._ser.write(b"abc"); assert s.read(0.2) == b"abc"

def test_reader_survives_serial_drop():
    calls = {"n": 0}
    def opener(url, baudrate, timeout):
        calls["n"] += 1
        if calls["n"] == 1: return FlakySerial(fail_after=1)   # ilk read başarılı, sonra SerialException
        return serial.serial_for_url("loop://", timeout=timeout)
    src = SerialSource("x", 9600, reopen_s=0.05, opener=opener)
    got = []; r = SourceReader("roket", src, lambda n, t, d: got.append(d)); r.start()
    time.sleep(0.5); assert r.is_alive() and calls["n"] >= 2 and src.connected; r.stop()
```

- [ ] **Step 2–4:** FAIL → yaz → PASS.
- [ ] **Step 5: Commit** — `"yer-istasyonu: istasyon yapılandırması, seri kaynak, dayanıklı okuyucu"`

---

### Task 10: Veri yolu (TCP JSON)

**Files:**
- Create: `src/yeristasyonu/bus.py`
- Test: `tests/test_bus.py`

**Interfaces:**
- Produces:
  - `class BusServer(host: str = "127.0.0.1", port: int = 47800, on_connect: Callable[[], list[dict]] = lambda: [], max_queue: int = 500)`: `start()`, `broadcast(msg: dict) -> None` (engellemez), `stop()`, `client_count: int`, `port: int` (0 verilirse atanmış port). İstemci başına gönderim iş parçacığı + `queue.Queue(max_queue)`; kuyruk doluysa istemci bağlantısı kapatılır. Yeni istemciye önce `on_connect()` çıktısı sırayla gönderilir. Port kullanımdaysa `OSError` mesajı: `"47800 portu kullanımda: başka bir yi-core çalışıyor olabilir"`.
  - `iter_messages(sock) -> Iterator[dict]` (test ve UI dışı istemciler için yardımcı)

- [ ] **Step 1: Failing testler**

```python
def test_on_connect_then_broadcast():
    srv = BusServer(port=0, on_connect=lambda: [{"type": "session"}, {"type": "snapshot", "source": "roket"}]); srv.start()
    s = socket.create_connection(("127.0.0.1", srv.port)); it = iter_messages(s)
    assert next(it)["type"] == "session" and next(it)["type"] == "snapshot"
    wait_until(lambda: srv.client_count == 1); srv.broadcast({"type": "telemetry", "x": 1})
    assert next(it) == {"type": "telemetry", "x": 1}; srv.stop()

def test_slow_client_dropped():
    srv = BusServer(port=0, max_queue=5); srv.start()
    s = socket.create_connection(("127.0.0.1", srv.port)); s.setsockopt(socket.SOL_SOCKET, socket.SO_RCVBUF, 1024)
    wait_until(lambda: srv.client_count == 1)
    for i in range(20000): srv.broadcast({"pad": "x" * 200, "i": i})
    wait_until(lambda: srv.client_count == 0, timeout=5); srv.stop()

def test_broadcast_never_blocks():
    srv = BusServer(port=0); srv.start(); t0 = time.perf_counter()
    for _ in range(10000): srv.broadcast({"a": 1})
    assert time.perf_counter() - t0 < 1.0; srv.stop()
```

- [ ] **Step 2–4:** FAIL → `bus.py` → PASS.
- [ ] **Step 5: Commit** — `"yer-istasyonu: TCP JSON veri yolu"`

---

### Task 11: HYİ aktarıcı altyapısı

**Files:**
- Create: `src/yeristasyonu/hyi.py`, `src/yeristasyonu/hyi_formats/__init__.py` (boş kayıt: `FORMATS: dict[str, Callable] = {}`)
- Test: `tests/test_hyi.py`

**Interfaces:**
- Produces:
  - `HyiEncoder = Callable[[dict[str, FlightState]], bytes]`
  - `class HyiForwarder(writer: Callable[[bytes], None] | None, encoder: HyiEncoder | None, rate_hz: float)`: `tick(now: float, states: dict[str, FlightState]) -> None` (1/rate_hz aralıkla bir kez encode + write); `status: str ∈ {"kapali","format_tanimsiz","gonderiyor","hata"}`; `detail: str`; `sent: int`. `writer is None` → `kapali`; `encoder is None` → `format_tanimsiz` ve hiç yazmaz; writer/encoder istisnası → `hata`, `detail` = istisna metni, istisna yükselmez.

- [ ] **Step 1: Failing testler**

```python
def test_undefined_format_writes_nothing():
    out = []; f = HyiForwarder(out.append, None, 5)
    for i in range(10): f.tick(i * 0.1, {})
    assert out == [] and f.status == "format_tanimsiz"

def test_rate_limited():
    out = []; f = HyiForwarder(out.append, lambda s: b"P", 5)
    for i in range(100): f.tick(i * 0.01, {})      # 1 s
    assert len(out) == 5 and f.status == "gonderiyor"

def test_writer_error_reported():
    def bad(b): raise OSError("port kapandı")
    f = HyiForwarder(bad, lambda s: b"P", 5); f.tick(0, {}); assert f.status == "hata" and "port" in f.detail

def test_no_port():
    assert HyiForwarder(None, None, 5).status == "kapali"
```

- [ ] **Step 2–4:** FAIL → yaz → PASS.
- [ ] **Step 5: Commit** — `"yer-istasyonu: HYİ aktarıcı altyapısı (format tanımsız)"`

---

### Task 12: Çekirdek orkestrasyonu ve `yi-core` CLI

**Files:**
- Create: `src/yeristasyonu/core.py`
- Test: `tests/test_core_integration.py`

**Interfaces:**
- Consumes: Görev 1–11'deki tümü.
- Produces:
  - `class Core(config: StationConfig, sources: dict[str, ByteSource], session_dir: Path, clock=time.time)`: `start()`, `stop()`, `states: dict[str, FlightState]`, `health: dict[str, LinkHealth]`, `bus: BusServer`.
    - `sink(name, t, data)`: ham kayda yaz → framer → her sonuç için `health.on_frame`; geçerliyse decode → `states[name].update` → CSV → `telemetry` yayını; konum değiştiyse `look` yayını (`look_angles(config.station, last_fix)`, `gps_age_s = t - last_fix_t`). Olay döndüyse `{"type":"event","source","phase","name","t","alt"}` yayını. Kaynak başına bir `threading.Lock` (sink tek okuyucudan çağrılır ama durum yayın iş parçacığından okunur).
    - 2 Hz zamanlayıcı iş parçacığı: `health` yayını (`log_error` = kaynağın Raw/CSV yazıcısı `error`'ı) + `HyiForwarder.tick` + `hyi` durum yayını (yalnızca değişince).
    - `on_connect`: `session` + kaynak başına `snapshot`.
    - `oturum.yaml`: yapılandırma dosyası ve şema dosyalarının içerikleri kopyalanır.
  - `main(argv: list[str] | None = None) -> int`: argümanlar `--config PATH` (varsayılan `config/istasyon.yaml`), `--sim` (her kaynak için `SimSource`; `body` = kaynak adı `gorevyuku` ise `"gorevyuku"`, aksi `"roket"`), `--sim-speed F` (varsayılan 1), `--sim-loss PCT`, `--replay DIR [--speed F]` (DIR içindeki `<ad>.bin`). Saniyede bir satır yazar: `T+ 012.4 | roket yesil 5.0Hz alt 1234m | gorevyuku sari 3.9Hz | HYİ format_tanimsiz`. Ctrl+C ile temiz kapanır, 0 döner.

- [ ] **Step 1: Failing entegrasyon testi**

```python
def test_sim_end_to_end(tmp_path, config_dir):
    cfg = load_station_config(config_dir / "istasyon.yaml")
    cfg = dataclasses.replace(cfg, bus_port=0, log_dir=tmp_path)
    prof = FlightProfile()
    srcs = {s.name: SimSource(prof, s.schema, "gorevyuku" if s.name == "gorevyuku" else "roket", speed=25.0) for s in cfg.sources}
    core = Core(cfg, srcs, tmp_path / "oturum"); core.start()
    sock = socket.create_connection(("127.0.0.1", core.bus.port)); it = iter_messages(sock)
    first = [next(it), next(it), next(it)]
    assert first[0]["type"] == "session" and {m["type"] for m in first[1:]} == {"snapshot"}
    time.sleep(2.4)                     # ≈ 60 s sim: apogee geçildi
    core.stop()
    assert core.states["roket"].max_alt == pytest.approx(6096, abs=30)
    assert "APOGEE" in [e.name for e in core.states["roket"].events]
    assert (tmp_path / "oturum/roket.bin").stat().st_size > 0
    assert len((tmp_path / "oturum/roket.csv").read_text().splitlines()) > 50
    assert (tmp_path / "oturum/oturum.yaml").exists()

def test_new_client_gets_snapshot(tmp_path, config_dir):
    ... # aynı kurulum, 1 s çalıştır, YENİ bir soket bağla: snapshot["track"] boş değil

def test_replay_reproduces_csv(tmp_path, config_dir):
    ... # sim oturumu kaydet → aynı .bin ile --replay (speed=50) → yeni roket.csv satır sayısı eşit
```

- [ ] **Step 2: FAIL gör.** · **Step 3: `core.py`'yi yaz.** · **Step 4: PASS gör** — `python -m pytest -v` (tüm Bölüm 1).
- [ ] **Step 5: Elle doğrulama** — `python -m yeristasyonu.core --sim --sim-speed 5`. Sim paket hızı sim zamanına göredir (5 Hz), bu yüzden `speed=5`'te durum satırında ≈25 Hz görünür. Beklenen: `alt` artar, gerçek saatte ≈7,5 s'de ≈6096 m'ye ulaşır; Ctrl+C → çıkış kodu 0, `kayitlar/<oturum>/` içinde `.bin`, `.csv`, `oturum.yaml`.
- [ ] **Step 6: Commit** — `"yer-istasyonu: çekirdek orkestrasyonu ve yi-core CLI"`

---

# BÖLÜM 2 — Uçuş sahnesi arayüzü

Görsel referans: `.superpowers/yer-istasyonu/layout-v2.html`. Renk, yazı tipi, animasyon ayrıntısı kurucunun kararıdır (Spec §9); düzen ve davranış aşağıda sabittir.

### Task 13: Arayüz iskeleti, veri yolu istemcisi, istasyon modeli

**Files:**
- Create: `src/yeristasyonu/ui/__init__.py`, `ui/app.py`, `ui/client.py`, `ui/models.py`, `ui/qml/Main.qml`, `ui/qml/Theme.qml` (singleton, `qmldir` ile)
- Test: `tests/ui/test_models.py`, `tests/ui/test_qml_load.py`

**Interfaces:**
- Consumes: Spec §7.6 mesajları.
- Produces:
  - `class BusClient(QObject)`: `QTcpSocket`; sinyal `message(dict)`, `connectedChanged(bool)`; kopunca 1 s aralıkla yeniden bağlanır.
  - `class SourceModel(QObject)` — QML özellikleri (`Property` + `notify`): `name, label, color, altitude_m, altitude_ft, max_alt_m, vz, accel_g, roll, pitch, yaw, phase (int), phase_name, status, rate_hz, crc_error_pct, lost, age_s, rssi_dbm, az_deg, el_deg, slant_m, gps_age_s, has_fix`. Slotlar: `track_xy() -> list` ([menzil_m, alt_m] noktaları; menzil = `ground_distance_m(launch, fix)`, launch = ilk geçerli fix), `sky_track(radius: float) -> list` (`sky_to_xy` ile), `events() -> list` (dict listesi: phase, name, t, alt, downrange), `series(name: str, window_s: float) -> list` ([t, v]), `pulses(now: float, window_s: float = 10) -> list` ([t, ok]).
  - `class StationModel(QObject)`: `handle_message(msg: dict)`; özellikler `sources` (liste), `connected`, `t_plus` (sn, `None` → -1), `recording`, `log_dir`, `hyi_status`, `ceiling_m`, `day_mode` (bool, yazılabilir), `view_offset_s` (0 = canlı; yazılabilir), `suggest_map` (iniş fazı DROGUE/MAIN'e girince True, kullanıcı haritaya geçince False).
  - `ui/app.py: main(argv=None) -> int` — `--host` (varsayılan 127.0.0.1), `--port` (47800), `--anten` (yalnızca anten penceresi, Görev 18).
  - Geçmiş tamponu kaynak başına seri başına en fazla 6000 nokta (≈20 dk @5 Hz), aşılınca en eskiler düşer.

- [ ] **Step 1: Failing testler**

```python
def test_session_creates_sources(station):
    station.handle_message(SESSION)          # iki kaynaklı örnek
    assert [s.name for s in station.sources] == ["roket", "gorevyuku"] and station.ceiling_m == 6096

def test_telemetry_updates_roles(station):
    station.handle_message(SESSION)
    station.handle_message({"type": "telemetry", "source": "roket", "t": 10.0, "fields": {"kalman_alt": 6041.0, "vz": -3.2, "phase": 3}})
    r = station.sources[0]
    assert r.altitude_m == 6041.0 and r.altitude_ft == pytest.approx(19819, abs=1) and r.phase_name == "APOGEE"

def test_snapshot_restores_track(station): ...      # snapshot → track_xy() uzunluğu = iz uzunluğu
def test_history_capped(station): ...               # 7000 telemetri → series("altitude", 1e9) uzunluğu 6000
def test_suggest_map_on_descent(station): ...       # phase 4 → suggest_map True; set_view("map") → False

def test_main_qml_loads_without_warnings(qapp):
    eng = QQmlApplicationEngine(); warns = []; eng.warnings.connect(lambda w: warns.extend(w))
    eng.rootContext().setContextProperty("station", StationModel()); eng.load(QML_DIR / "Main.qml")
    assert eng.rootObjects() and warns == []
```

- [ ] **Step 2–4:** FAIL → yaz (Main.qml şimdilik yalnızca zemin + Theme) → PASS.
- [ ] **Step 5: Commit** — `"yer-istasyonu/ui: QML iskeleti, veri yolu istemcisi, view-model'ler"`

---

### Task 14: Sahne düzeni, tema ve ekran görüntüsü aracı

**Files:**
- Modify: `ui/qml/Main.qml`, `ui/qml/Theme.qml`
- Create: `tools/ekran_goruntusu.py`
- Test: `tests/ui/test_layout.py`

**Interfaces:**
- Produces: Main.qml'de `objectName`'li bölgeler: `pulseArea` (üst sol), `clockArea` (üst sağ), `altitudeTape` (sol kenar), `flightScene` (merkez), `vzArc`, `skyArea` (sağ; kubbe/harita yer değiştirir), `timeline` (alt), `rawDrawer` (gizli). Kutu, kenarlık, gölge yok; ayrım boşluk ve tipografiyle.
  - `Theme`: `night` ve `day` paletleri; `station.day_mode`'a bağlı. Gündüz: açık zemin, metin kontrastı ≥ 7:1. Kısayollar: `G` gece/gündüz, `H` harita/kubbe, `R` ham veri çekmecesi, `A` anten penceresi, `Esc` canlıya dön.
  - `tools/ekran_goruntusu.py --out PNG [--t SECONDS]`: çekirdeği `--sim --sim-speed 10` ile başlatır, arayüzü offscreen 1920×1080 açar, sim T+`t` olunca `window.grabWindow()` kaydeder, ikisini kapatır.

- [ ] **Step 1: Failing test** — `test_regions_exist`: tüm `objectName`'ler `findChild` ile bulunur ve 1920×1080 pencerede sınırları birbirini kesmez (`altitudeTape`, `flightScene`, `skyArea`, `timeline` dikdörtgenleri ikili kesişimsiz).
- [ ] **Step 2–4:** FAIL → yaz → PASS.
- [ ] **Step 5: Görsel doğrulama** — `python tools/ekran_goruntusu.py --out ../.superpowers/yer-istasyonu/ui-t14.png --t 38` ve gündüz modu için `--day`; PNG'leri layout-v2 ile karşılaştır.
- [ ] **Step 6: Commit** — `"yer-istasyonu/ui: kutusuz sahne düzeni, gece/gündüz teması"`

---

### Task 15: Nabız çizgileri, irtifa şeridi, dikey hız yayı, saat

**Files:**
- Create: `ui/qml/PulseLines.qml`, `ui/qml/AltitudeTape.qml`, `ui/qml/VerticalSpeedArc.qml`, `ui/qml/MissionClock.qml`
- Test: `tests/ui/test_instruments.py`

**Interfaces:**
- Consumes: `SourceModel.pulses()`, `altitude_m`, `max_alt_m`, `vz`, `StationModel.t_plus/recording/hyi_status`.
- Produces (davranış):
  - PulseLines: kaynak başına satır; son 10 s; geçerli paket = kaynak renginde çentik, CRC hatası = kırmızı çentik, > 1 s boşluk = kırmızı çizgi; sağda `"{rate:.1f} Hz · {rssi} dBm · kayıp {lost}"`, durum sarı/kırmızıysa `"son paket {age:.1f} s önce"`. 10 Hz yenilenir.
  - AltitudeTape: 0–`ceiling_m` doğrusal; okuyucu `"{m:,.0f} m"` (binlik ayırıcı boşluk) + `"{ft:,.0f} ft · max {max:,.0f} m"`; irtifa > `ceiling_m` ise okuyucu tavanda kalır ve kırmızı olur.
  - VerticalSpeedArc: ±300 m/s, dışı kırpılır; sayı tek ondalık.
  - MissionClock: `T+ mm:ss.s`; `t_plus < 0` → `T− --:--.-`; kayıt göstergesi; HYİ durumu Türkçe metinle (`kapalı / format tanımsız / gönderiyor / hata`).
- Yardımcı (Python, test edilebilir): `ui/format.py` → `fmt_m(v) -> str`, `fmt_clock(t_plus) -> str`, `pulse_segments(pulses, now, window_s=10, gap_s=1.0) -> list[tuple[float, float, str]]` (başlangıç, bitiş, "ok"|"crc"|"gap").

- [ ] **Step 1: Failing testler**

```python
def test_fmt():
    assert fmt_m(6041.4) == "6 041 m" and fmt_clock(38.44) == "T+ 00:38.4" and fmt_clock(None) == "T− --:--.-"

def test_pulse_segments_gap():
    segs = pulse_segments([[0.0, True], [0.2, True], [1.8, True], [2.0, False]], now=2.0)
    assert ("gap" in [s[2] for s in segs]) and segs[-1][2] == "crc"
```

- [ ] **Step 2–4:** FAIL → yaz → PASS. · **Step 5:** ekran görüntüsü `ui-t15.png` (T+38).
- [ ] **Step 6: Commit** — `"yer-istasyonu/ui: nabız çizgileri ve göstergeler"`

---

### Task 16: Uçuş sahnesi (yan kesit yörünge)

**Files:**
- Create: `ui/qml/FlightScene.qml`, `ui/scene.py`
- Test: `tests/ui/test_scene.py`

**Interfaces:**
- Consumes: `SourceModel.track_xy()`, `events()`, `StationModel.ceiling_m`.
- Produces:
  - `scene_scale(points: list[tuple[float, float]], ceiling_m: float, width: float, height: float, min_range_m: float = 2000.0) -> tuple[float, float]` → (px/m yatay, px/m dikey). Dikey sabit: `height / ceiling_m`. Yatay: `width / max(min_range_m, 1.15 · max menzil)` (iz büyüdükçe genişler, asla daralmaz — kullanıcı sahnenin kendiliğinden küçüldüğünü görmez; en büyük değer saklanır).
  - `expected_events(events_seen: list[str]) -> list[str]`: henüz görülmemiş `["MOTOR→yanma sonu", "APOGEE", "MAIN"]` olayları "bekleniyor" olarak soluk çizilir; MAIN işareti 500 m yüksekliğinde gösterilir.
  - QML: roket izi altın, görev yükü turuncu (kaynak `color`'ı); tavan kesikli çizgi + `"eşik 20 000 ft · 6 096 m"`; olay etiketleri `"{ad} · T+{t:.1f} · {alt} m"`; şu anki konumda parlayan işaret. Çizim `QtQuick.Shapes` veya `Canvas` (kurucu seçer); 5 Hz'de yeniden çizim.

- [ ] **Step 1: Failing testler**

```python
def test_vertical_scale_fixed():
    _, sy = scene_scale([(0, 0)], 6096, 1000, 600); assert sy == pytest.approx(600 / 6096)

def test_horizontal_never_shrinks():
    sc = SceneScaler(); a = sc.update([(0, 0), (5000, 10)], 6096, 1000, 600)[0]
    b = sc.update([(0, 0), (100, 10)], 6096, 1000, 600)[0]; assert b == a

def test_expected_events():
    assert expected_events(["RAMPA", "MOTOR", "SUZULME", "APOGEE"]) == ["MAIN"]
```

(`SceneScaler` = `scene_scale`'in en büyük menzili saklayan durumlu sürümü.)

- [ ] **Step 2–4:** FAIL → yaz → PASS. · **Step 5:** `ui-t16.png` T+20 ve T+90.
- [ ] **Step 6: Commit** — `"yer-istasyonu/ui: yan kesit uçuş sahnesi"`

---

### Task 17: Gökyüzü kubbesi ve anten penceresi

**Files:**
- Create: `ui/qml/SkyDome.qml`, `ui/qml/AntennaWindow.qml`
- Modify: `ui/app.py` (`--anten`), `ui/qml/Main.qml` (`A` kısayolu, düğme)
- Test: `tests/ui/test_antenna.py`

**Interfaces:**
- Consumes: `SourceModel.az_deg/el_deg/slant_m/gps_age_s/has_fix`, `sky_track(radius)`.
- Produces:
  - SkyDome: halkalar 0°, 30°, 60°; K/D/G/B; kaynak başına iz + nokta; seçili kaynak (varsayılan ilk kaynak, tıklayınca değişir) için altında büyük `"{az:.0f}°"` ve `"{el:.0f}°"`, `az_compass(az) -> str` ile yön kısaltması (K, KD, D, GD, G, GB, B, KB), `"eğik mesafe {km:.1f} km"`. `has_fix=False` → nokta yok, `"GPS yok"`; `gps_age_s > 2` → `"son konum {s:.0f} s önce"` ve soluk nokta.
  - AntennaWindow: tam ekran, yalnızca kubbe + rakamlar; rakam yüksekliği ≥ pencere yüksekliğinin %15'i; ana pencereden `A` ile açılır veya `yi-ui --anten` ile tek başına.
  - `ui/format.py: az_compass(az_deg: float) -> str`

- [ ] **Step 1: Failing testler**

```python
@pytest.mark.parametrize("az,txt", [(0, "K"), (48, "KD"), (90, "D"), (200, "G"), (337.6, "K"), (315, "KB")])
def test_az_compass(az, txt): assert az_compass(az) == txt

def test_antenna_digits_large(qapp):
    win = load_antenna_window(height=1080); assert win.findChild(QObject, "azText").property("font").pixelSize() >= 162
```

- [ ] **Step 2–4:** FAIL → yaz → PASS. · **Step 5:** `ui-t17.png` ve `--anten` ekran görüntüsü.
- [ ] **Step 6: Commit** — `"yer-istasyonu/ui: gökyüzü kubbesi ve tam ekran anten penceresi"`

---

### Task 18: Çevrimdışı harita

**Files:**
- Create: `ui/qml/MapView.qml`, `ui/tiles.py`
- Modify: `ui/qml/Main.qml` (`H` ile kubbe ↔ harita; `suggest_map` önerisi)
- Test: `tests/ui/test_tiles.py`

**Interfaces:**
- Produces:
  - `visible_tiles(center: tuple[float, float], z: int, width_px: int, height_px: int, tile_px: int = 256) -> list[tuple[int, int, int, float, float]]` → (z, x, y, ekran_x, ekran_y).
  - `tile_path(root: Path, z: int, x: int, y: int) -> Path | None` (dosya yoksa None).
  - `fit_zoom(points: list[tuple[float, float]], width_px, height_px, z_min=10, z_max=17) -> int` (tüm noktaları %10 kenar payıyla sığdıran en büyük z).
  - QML: karo yoksa koyu ızgara; rampa, istasyon, roket ve görev yükü izleri; harita karosu klasörü yapılandırmadaki `harita_dir` (varsayılan `yer-istasyonu/harita`). `suggest_map` True iken kubbe köşesinde `"İniş başladı — haritaya geç (H)"` önerisi; otomatik geçiş yok.
- Modify: `config.py` → `StationConfig.map_dir: Path` (varsayılan `harita`), `session` mesajına eklenir.

- [ ] **Step 1: Failing testler**

```python
def test_visible_tiles_cover_view():
    tiles = visible_tiles((38.0, 33.0), 14, 512, 512)
    assert 4 <= len(tiles) <= 9 and all(t[0] == 14 for t in tiles)

def test_fit_zoom_monotonic():
    near = fit_zoom([(38.0, 33.0), (38.001, 33.001)], 600, 600); far = fit_zoom([(38.0, 33.0), (38.1, 33.1)], 600, 600)
    assert near > far and 10 <= far <= 17

def test_missing_tile(tmp_path): assert tile_path(tmp_path, 14, 1, 1) is None
```

- [ ] **Step 2–4:** FAIL → yaz → PASS.
- [ ] **Step 5:** README'ye "Harita karoları": karoların önceden `harita/{z}/{x}/{y}.png` düzeninde hazırlanacağı, OpenStreetMap genel karo sunucusundan toplu indirmenin kullanım politikasına aykırı olduğu, toplu indirmeye izin veren bir kaynak veya kendi üretilen karoların kullanılması gerektiği notu.
- [ ] **Step 6: Commit** — `"yer-istasyonu/ui: çevrimdışı karo haritası"`

---

### Task 19: Zaman şeridi, geçmişe kaydırma, ham veri çekmecesi

**Files:**
- Create: `ui/qml/Timeline.qml`, `ui/qml/RawDrawer.qml`, `ui/timeline.py`
- Test: `tests/ui/test_timeline.py`

**Interfaces:**
- Consumes: `SourceModel.events()`, `series("accel_g"| "pitch" | "roll", window)`, `StationModel.view_offset_s`, `last` alanları.
- Produces:
  - `phase_segments(events: list[dict], now_t: float) -> list[tuple[float, float, str]]` (T0'a göre başlangıç, bitiş, faz adı; son faz `now_t`'ye uzanır).
  - Timeline: faz bölümleri; "şu an" altın işaret; altında ince ivme ve açı şeritleri. Sürükleme `view_offset_s`'i ayarlar → sahne, gösterge ve kubbe o andaki değerleri gösterir (`SourceModel` `view_offset_s`'e göre geçmiş tampondan okur); ekranda `"GEÇMİŞ −{s:.0f} s · Esc canlı"` uyarısı. Çekirdeğe komut gönderilmez.
  - RawDrawer (`R`): seçili kaynağın son paketindeki tüm alanlar, ad · değer · birim; şemada rolü olmayanlar da dahil (`telemetry.fields`'tan).
- `SourceModel` ek: `at(offset_s: float) -> dict` (o andaki rol değerleri; ikili arama).

- [ ] **Step 1: Failing testler**

```python
def test_phase_segments():
    ev = [{"name": "MOTOR", "t": 0.0}, {"name": "SUZULME", "t": 4.0}, {"name": "APOGEE", "t": 37.3}]
    assert phase_segments(ev, 40.0) == [(0.0, 4.0, "MOTOR"), (4.0, 37.3, "SUZULME"), (37.3, 40.0, "APOGEE")]

def test_at_offset(station):
    feed_altitudes(station, [(0, 100.0), (1, 200.0), (2, 300.0)])
    assert station.sources[0].at(1.0)["altitude_m"] == 200.0
```

- [ ] **Step 2–4:** FAIL → yaz → PASS. · **Step 5:** `ui-t19.png` (geçmiş modunda).
- [ ] **Step 6: Commit** — `"yer-istasyonu/ui: zaman şeridi, geçmişe kaydırma, ham veri"`

---

### Task 20: Başlatıcı ve uçtan uca prova

**Files:**
- Create: `yer-istasyonu/baslat.py`
- Modify: `yer-istasyonu/README.md`
- Test: `tests/test_launcher.py`

**Interfaces:**
- Produces: `baslat.py [--sim] [--config PATH]` → `yi-core`'u alt süreç olarak başlatır, veri yolu portu açılana kadar (≤ 5 s) bekler, `yi-ui`'yi başlatır. Arayüz kapanınca çekirdek **çalışmaya devam eder** ve terminalde `"Arayüz kapandı. Çekirdek kayıt yapıyor. Arayüzü yeniden açmak için: python -m yeristasyonu.ui.app — çekirdeği durdurmak için Ctrl+C"` yazar. Ctrl+C → çekirdek temiz kapanır.
- Yardımcı: `wait_for_port(host, port, timeout_s) -> bool`.

- [ ] **Step 1: Failing test** — `test_wait_for_port`: dinleyen soket için True, kapalı port için `timeout_s=0.3`'te False.
- [ ] **Step 2–4:** FAIL → yaz → PASS.
- [ ] **Step 5: Uçtan uca prova (elle)** — `python baslat.py --sim`: (a) nabız çizgileri yeşil, (b) T+ sayacı motor fazında başlar, (c) sahne yörüngeyi çizer, apogee ≈ 6 096 m'de etiketlenir, (d) arayüzü kapat → çekirdek sürer → `python -m yeristasyonu.ui.app` → iz geri gelir, (e) `A` anten penceresi, (f) `G` gündüz modu, (g) Ctrl+C → `kayitlar/<oturum>/` içinde `.bin`, `.csv`, `oturum.yaml`. Sonra `python -m yeristasyonu.core --replay kayitlar/<oturum> --speed 4` ile aynı uçuş yeniden oynar.
- [ ] **Step 6: Tüm testler** — `python -m pytest -v` → hepsi PASS.
- [ ] **Step 7: Commit** — `"yer-istasyonu: başlatıcı ve kullanım kılavuzu"`
