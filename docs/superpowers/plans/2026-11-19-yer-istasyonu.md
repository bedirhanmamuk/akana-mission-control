# AKANA Yer İstasyonu Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** N adet LoRa alıcısından gelen roket/görev yükü telemetrisini alan, kaydeden, HYİ'ye ileten ekransız bir çekirdek ve ona bağlanan "uçuş sahnesi" Qt Quick arayüzü.

**Architecture:** İki süreç. `yi-core` (saf Python): kaynak başına okuyucu iş parçacığı → ham kayıt → şemaya dayalı çerçeve çözücü → durum/sağlık/CSV/HYİ → TCP JSON veri yolu. `yi-ui` (PySide6 + QML): veri yoluna bağlanan istemci; mantık Python view-model'lerde, QML yalnızca görünüm.

**Tech Stack:** Python ≥ 3.11, PySide6 ≥ 6.6 (QtQuick, QtQuick.Shapes, QtQuick3D), pyserial ≥ 3.5, PyYAML ≥ 6, pytest ≥ 8.

**Spec:** `docs/superpowers/specs/2026-11-19-yer-istasyonu-design.md` · Görsel yön: `.superpowers/yer-istasyonu/layout-v3.html`

Plan iki bölümdür. **Bölüm 1 (Görev 1–12)** tek başına çalışan, simülatörle uçtan uca test edilmiş çekirdeği üretir. **Bölüm 2 (Görev 13–24)** arayüzü ekler.

## Global Constraints

- Tüm kod `yer-istasyonu/` altında; paket adı `yeristasyonu`, kaynak `yer-istasyonu/src/yeristasyonu/`, testler `yer-istasyonu/tests/`. Depodaki diğer dizinlere dokunulmaz.
- Tüm komutlar `yer-istasyonu/` dizininden çalışır. Test komutu: `python -m pytest <yol> -v`.
- Python ≥ 3.11; bağımlılıklar yalnızca: `PySide6>=6.6`, `pyserial>=3.5`, `PyYAML>=6`; geliştirme: `pytest>=8`. Başka paket eklenmez (numpy dahil).
- İnternet gerektiren hiçbir kod yolu yok.
- İrtifa eşiği / tavan: `CEILING_M = 6096.0` (20.000 ft). `FT_PER_M = 3.28084`.
- Sağlık eşikleri: yeşil `age < 1.0 s ve rate ≥ 4.5 Hz`; sarı `age < 3.0 s`; aksi kırmızı. Pencere 2.0 s. Sıra farkı > 1000 → yeniden başlama, kayıp değil.
- Veri yolu: `127.0.0.1:47800`, satır başına UTF-8 JSON, çift yönlü (çekirdek → arayüz mesajlar, arayüz → çekirdek `cmd`); yavaş istemci kuyruğu sınırı 500. Rokete komut gönderilmez.
- Faz enum (9 zorunlu faz): `0 RAMPA, 1 KALKIS, 2 APOGEE_YAKLASMA, 3 APOGEE, 4 DROGUE_ACILIS, 5 PAYLOAD_ACILIS, 6 MAIN_ACILIS, 7 FINIS, 8 GUVENLI_MOD`; görünen adlar: Rampa, Kalkış, Apogee yaklaşma, Apogee, Drogue açılış, Payload açılış, Main açılış, Finiş, Güvenli mod. `GUVENLI_MOD` sıralı değildir. T+ sayacı ilk `KALKIS` paketinde başlar.
- Arayüz metinleri Türkçe. Birincil birim metre, ft ikincil.
- Arayüz ekranı kendiliğinden düzen değiştirmez (yalnızca öneri gösterebilir).
- QML testleri `QT_QPA_PLATFORM=offscreen` ile çalışır (`tests/conftest.py` ayarlar).

## Review Focus

1. **USB alıcı uçuş sırasında çıkıp geri takılırsa** okuyucu iş parçacığı ölmemeli; 1 s aralıkla portu yeniden açmayı denemeli, sağlık kırmızıya dönmeli, ham kayıt aynı dosyaya devam etmeli. → Görev 9'a test eklendi (`test_reader_survives_serial_drop`).
2. **Arayüz kapanıp yeniden açılırsa** iz ve olaylar kaybolmamalı. → Görev 10/12 `snapshot` mesajı ve testi (`test_new_client_gets_snapshot`).
3. **GPS fix yokken** (`lat=lon=0` veya `sats<4`) harita/kubbe (0,0) noktasını göstermemeli; son geçerli konum ve yaşı kullanılmalı. → Görev 8 (`test_track_ignores_invalid_gps`).
4. **Disk yazma hatası** (dolu disk, çıkarılan USB bellek) çekirdeği durdurmamalı; telemetri akışı sürmeli, sağlıkta `log_error` görünmeli. → Görev 7 (`test_rawlog_write_error_is_reported_not_raised`).
5. **Uçuş sırasında yanlışlıkla port değiştirme**: faz `RAMPA`/`FINIS` dışındayken Portlar sekmesindeki her işlem onay ister; onaylanmazsa komut gönderilmez. → Görev 23 (`test_port_change_requires_confirm_in_flight`).
6. **Yanlış şema dosyası** (bilinmeyen tip, eksik rol hedefi) açılışta alan adını söyleyen `SchemaError` ile durmalı; sessizce yanlış çözüm yapılmamalı. → Görev 1 (`test_unknown_type_rejected`, `test_role_must_point_to_field`).

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
  - `@dataclass(frozen=True) PacketSchema(name: str, sync: bytes, length_byte: bool, endian: str, crc: str, rssi_byte: bool, fields: tuple[FieldSpec, ...], roles: dict[str, str], flags_bits: dict[int, str])`; metot `flag_labels(value: int) -> dict[str, bool]`; özellikler `payload_size: int`, `struct_format: str`; metot `field(name) -> FieldSpec`, `enum_name(field: str, value: int) -> str | None`.
  - `load_schema(path: str | Path) -> PacketSchema`
  - `TYPES = {"u8":"B","i8":"b","u16":"H","i16":"h","u32":"I","i32":"i","f32":"f"}`, `CRC_TYPES = {"crc16_ccitt_false","crc16_modbus","none"}`

- [ ] **Step 1: pyproject ve conftest**

`pyproject.toml`: proje adı `akana-yer-istasyonu`, `src` düzeni, bağımlılıklar Global Constraints'teki gibi, `[project.scripts] yi-core = "yeristasyonu.core:main"`, `yi-ui = "yeristasyonu.ui.app:main"`, `[tool.pytest.ini_options] testpaths=["tests"] pythonpath=["src"]`.
`tests/conftest.py`: `os.environ.setdefault("QT_QPA_PLATFORM", "offscreen")`; fixture `config_dir` → `Path(__file__).parent.parent / "config"`.

- [ ] **Step 2: Şema YAML dosyaları**

Spec §7.1'deki alan listeleri birebir. `sync: [0xAA, 0x55]`, `length_byte: true`, `endian: little`, `crc: crc16_ccitt_false`, `rssi_byte: false`. Roket rolleri: `seq, t_ms, phase, altitude: kalman_alt, vz, accel_x: ax, accel_y: ay, accel_z: az, roll, pitch, yaw, lat, lon, gps_alt, sats`. Roket ek rol: `pressure`. Görev yükü rolleri: `seq, t_ms, altitude: baro_alt, vz, lat, lon, gps_alt, sats, pressure, temperature: temp, humidity`. Her iki şemada `flags_bits: {0: IMU, 1: GPS, 2: SD_KART, 3: AYRILDI}` (yer tutucu). Görev yükü alanlarına `humidity u16 ×0.01 %` (temp'ten sonra). `phase` alanında `enum` Global Constraints'teki faz listesi. Dosya başına yorum: "Alan sırası tahmindir; aviyonik struct gelince güncelle."

- [ ] **Step 3: Failing testleri yaz**

```python
from yeristasyonu.schema import load_schema, SchemaError

def test_roket_payload_size(config_dir):
    s = load_schema(config_dir / "paketler/akana_v1_roket.yaml")
    assert s.payload_size == 63
    assert s.sync == b"\xAA\x55"
    assert s.struct_format.startswith("<")
    assert s.roles["altitude"] == "kalman_alt"
    assert s.enum_name("phase", 3) == "APOGEE" and s.enum_name("phase", 8) == "GUVENLI_MOD"

def test_gorevyuku_payload_size(config_dir):
    g = load_schema(config_dir / "paketler/akana_v1_gorevyuku.yaml")
    assert g.payload_size == 36 and g.roles["humidity"] == "humidity"
    assert g.flag_labels(0b0101) == {"IMU": True, "GPS": False, "SD_KART": True, "AYRILDI": False}

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
    assert (az < 0.5 or az > 359.5) and r == pytest.approx(1110.0, abs=2.0) and el < 0
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
  - `FlightProfile.truth(t: float, body: str) -> dict` (`body ∈ {"roket","gorevyuku"}`; `t` kalkışa göre, negatif = rampa). Anahtarlar: `alt_agl, vz, accel_g (eksenel), phase (int), lat, lon, gps_alt, pressure_hpa, temp_c, humidity_pct, pitch, yaw, roll`. Atmosfer: ISA, deniz seviyesi 1013.25 hPa, rampa rakımı `launch[2]`, `p = 1013.25·(1 − 2.25577e-5·h_msl)^5.25588`, `T = 15 − 0.0065·h_msl` °C; nem yer tutucu: `40 − 0.004·alt_agl` (≥5) %. Açılar (simülatör `pitch_reference: vertical` varsayar, yani rampada pitch = 0): `t<t_apogee` için `pitch = 15·t/t_apogee`; apogee sonrası 2 s içinde doğrusal olarak 90'a çıkar ve orada kalır; `yaw = 230 + 0.2·max(t,0)`; `roll = 5·sin(t)` (t<0 için 0).
  - `class SimSource(profile, schema, body, rate_hz=5.0 (sim zamanına göre), speed=1.0, noise=False, loss_pct=0.0, corrupt_pct=0.0, seed=0, safe_at: float | None = None, clock=time.monotonic)`: ByteSource arayüzü (Görev 7) — `read(timeout: float) -> bytes`, `close()`. Sim zamanı `t_sim = (clock() - start)·speed - pad_s`. Rol eşlemesiyle şema alanlarını doldurur (`altitude`, `vz`, `phase`, `lat`, `lon`, `gps_alt`, `sats=14`, `accel_z=accel_g`, `pressure`, `temperature`, `humidity`, `pitch`, `yaw`, `roll`; diğer roller 0; `safe_at` geçildiyse `phase=8`); `seq` her pakette +1, `t_ms = t_sim·1000` (≥0'a kırpılmış).

Profil: `v_b` → `v_b·t_b/2 + v_b²/(2g) = apogee_m`, `g = 9.80665`. Roket fazı: `t<0` RAMPA(0); `vz ≥ 50` KALKIS(1); `t<t_apogee` APOGEE_YAKLASMA(2); `t<t_apogee+1` APOGEE(3); `t<t_apogee+2` DROGUE_ACILIS(4); alt > main_alt PAYLOAD_ACILIS(5); alt > 0 MAIN_ACILIS(6); aksi FINIS(7). Drogue iniş hızı apogee+1 s'den itibaren. Görev yükü `t_apogee+2`'ye kadar roketle aynı konumda, sonra `payload_mps` ile iner; fazı roketinkinin aynısı (görev yükü kartı kendi `flags`'ından `AYRILDI` gösterir). Yatay sürüklenme yalnızca apogee sonrası `wind_e_mps·(t - t_apogee)` doğuya.

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
    t_yak = 4.0 + (326.8 - 50) / 9.80665          # vz 50 m/s'ye düştüğü an ≈ 32.2 s
    assert [ph(-1), ph(1), ph(t_yak + 0.5), ph(P.t_apogee + 0.5), ph(P.t_apogee + 1.5), ph(P.t_apogee + 30)] == [0, 1, 2, 3, 4, 5]
    t_main = P.t_apogee + 1 + (6096 - 500) / 25.0 + 1
    assert ph(t_main) == 6 and ph(10_000) == 7

def test_safe_mode_injection(roket):
    ... # SimSource(safe_at=20.0) → t_sim ≥ 20 olan paketlerde phase == 8

def test_atmosphere():
    assert P.truth(-1, "roket")["pressure_hpa"] == pytest.approx(1013.25 * (1 - 2.25577e-5 * 900) ** 5.25588, rel=1e-4)

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
    - özellikler: `last: dict`, `last_t: float | None`, `max_alt: float | None`, `t_launch: float | None` (ilk `KALKIS` olayı zamanı), `safe_mode: bool` (son pakette faz 8), `last_sequential_phase: int` (8 dışındaki son faz), `events: list[FlightEvent]`, `last_fix: tuple[float, float, float] | None`, `last_fix_t: float | None`, `track: list[tuple[float, float, float, float]]` (t, lat, lon, alt)
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
    assert [e.name for e in st.events] == ["RAMPA", "KALKIS", "APOGEE_YAKLASMA"]

def test_safe_mode_flag(roket):
    st = FlightState("roket", roket, 900.0); st.update(0, {"phase": 3}); st.update(1, {"phase": 8})
    assert st.safe_mode is True and st.last_sequential_phase == 3

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
  - `class SerialSource(port: str | None, baud: int, reopen_s: float = 1.0, opener=serial.serial_for_url)`: `reconfigure(port: str | None, baud: int) -> None` (iş parçacığı güvenli; açık portu kapatır, yenisini bir sonraki `read`'de açar; `port=None` = bağlantısız bekle), `status() -> dict` (`port, baud, connected, error`); `read(timeout)` → bayt; port hatasında istisna yükseltmez, `b""` döner, `connected: bool = False`, `last_error: str`, `reopen_s` sonra yeniden açmayı dener. `loop://` URL'leri desteklenir.
  - `list_serial_ports() -> list[dict]` (`serial.tools.list_ports.comports()` → `{"device","description"}`)
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

def test_reconfigure_switches_port():
    opened = []
    src = SerialSource("loop://", 9600, opener=lambda url, baudrate, timeout: opened.append((url, baudrate)) or serial.serial_for_url("loop://", timeout=timeout))
    src.read(0.05); src.reconfigure("loop://?x", 19200); src.read(0.05)
    assert opened[-1] == ("loop://?x", 19200) and src.status()["baud"] == 19200
    src.reconfigure(None, 9600); assert src.read(0.05) == b"" and src.status()["connected"] is False
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
  - `class BusServer(host: str = "127.0.0.1", port: int = 47800, on_connect: Callable[[], list[dict]] = lambda: [], on_command: Callable[[dict], list[dict]] = lambda c: [], max_queue: int = 500)`: istemciden gelen her JSON satırı `on_command`'a verilir, dönen mesajlar **tüm** istemcilere yayınlanır; bozuk JSON satırı yok sayılır; `start()`, `broadcast(msg: dict) -> None` (engellemez), `stop()`, `client_count: int`, `port: int` (0 verilirse atanmış port). İstemci başına gönderim iş parçacığı + `queue.Queue(max_queue)`; kuyruk doluysa istemci bağlantısı kapatılır. Yeni istemciye önce `on_connect()` çıktısı sırayla gönderilir. Port kullanımdaysa `OSError` mesajı: `"47800 portu kullanımda: başka bir yi-core çalışıyor olabilir"`.
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

def test_command_roundtrip():
    srv = BusServer(port=0, on_command=lambda c: [{"type": "ports", "echo": c["cmd"]}]); srv.start()
    s = socket.create_connection(("127.0.0.1", srv.port)); it = iter_messages(s)
    s.sendall(b'{"cmd": "list_ports"}\n'); assert next(it) == {"type": "ports", "echo": "list_ports"}
    s.sendall(b'bozuk\n'); srv.broadcast({"type": "x"}); assert next(it) == {"type": "x"}; srv.stop()

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
  - `class HyiForwarder(writer: Callable[[bytes], None] | None, encoder: HyiEncoder | None, rate_hz: float, on_sent: Callable[[bytes], None] = lambda b: None)`: başarılı her yazımdan sonra `on_sent(paket)`; `set_writer(writer | None)` (port değişince); `tick(now: float, states: dict[str, FlightState]) -> None` (1/rate_hz aralıkla bir kez encode + write); `status: str ∈ {"kapali","format_tanimsiz","gonderiyor","hata"}`; `detail: str`; `sent: int`. `writer is None` → `kapali`; `encoder is None` → `format_tanimsiz` ve hiç yazmaz; writer/encoder istisnası → `hata`, `detail` = istisna metni, istisna yükselmez.

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

def test_on_sent_called():
    sent = []; f = HyiForwarder(lambda b: None, lambda s: b"PK", 5, on_sent=sent.append); f.tick(0, {}); assert sent == [b"PK"]

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
    - Her `FrameResult` için `raw` yayını (`hex` = çerçeve baytları boşluklu büyük harf; `ok`; `seq` geçerliyse). Framer'a `last_frame_bytes` özelliği eklenir (geçerli ya da CRC'si hatalı son çerçevenin ham baytları).
    - HYİ `on_sent` → `hyi_tx` yayını.
    - `on_command`: `list_ports` → `ports`; `set_port` → hedef kaynak `SerialSource.reconfigure` veya HYİ yazıcısı yeniden açılır (`serial.Serial(port, baud, write_timeout=0.2)`), `oturum.yaml`'a `port_degisiklikleri` listesine `{t, target, port, baud}` eklenir, sonra `ports`; `disconnect` → `reconfigure(None, …)`. Hedef bilinmiyorsa `{"type":"error","detail":"bilinmeyen hedef: x"}`. Sim/replay kaynaklarında `set_port` → `error` (`"simülasyon kaynağı"`).
    - 2 s'de bir `ports` yayını.
    - `on_connect`: `session` + `ports` + kaynak başına `snapshot`.
    - `oturum.yaml`: yapılandırma dosyası ve şema dosyalarının içerikleri kopyalanır.
  - `main(argv: list[str] | None = None) -> int`: argümanlar `--config PATH` (varsayılan `config/istasyon.yaml`), `--sim` (her kaynak için `SimSource`; `body` = kaynak adı `gorevyuku` ise `"gorevyuku"`, aksi `"roket"`), `--sim-speed F` (varsayılan 1), `--sim-loss PCT`, `--sim-corrupt PCT`, `--sim-safe-at T`, `--replay DIR [--speed F]` (DIR içindeki `<ad>.bin`). Saniyede bir satır yazar: `T+ 012.4 | roket yesil 5.0Hz alt 1234m | gorevyuku sari 3.9Hz | HYİ format_tanimsiz`. Ctrl+C ile temiz kapanır, 0 döner.

- [ ] **Step 1: Failing entegrasyon testi**

```python
def test_sim_end_to_end(tmp_path, config_dir):
    cfg = load_station_config(config_dir / "istasyon.yaml")
    cfg = dataclasses.replace(cfg, bus_port=0, log_dir=tmp_path)
    prof = FlightProfile()
    srcs = {s.name: SimSource(prof, s.schema, "gorevyuku" if s.name == "gorevyuku" else "roket", speed=25.0) for s in cfg.sources}
    core = Core(cfg, srcs, tmp_path / "oturum"); core.start()
    sock = socket.create_connection(("127.0.0.1", core.bus.port)); it = iter_messages(sock)
    first = [next(it) for _ in range(4)]
    assert first[0]["type"] == "session" and first[1]["type"] == "ports" and {m["type"] for m in first[2:]} == {"snapshot"}
    time.sleep(2.4)                     # ≈ 60 s sim: apogee geçildi
    core.stop()
    assert core.states["roket"].max_alt == pytest.approx(6096, abs=30)
    assert [e.name for e in core.states["roket"].events][:6] == ["RAMPA", "KALKIS", "APOGEE_YAKLASMA", "APOGEE", "DROGUE_ACILIS", "PAYLOAD_ACILIS"]
    assert (tmp_path / "oturum/roket.bin").stat().st_size > 0
    assert len((tmp_path / "oturum/roket.csv").read_text().splitlines()) > 50
    assert (tmp_path / "oturum/oturum.yaml").exists()

def test_raw_messages_streamed(tmp_path, config_dir):
    ... # sim corrupt_pct=20 → istemci hem ok=True hem ok=False `raw` mesajları alır; hex "AA 55" ile başlar

def test_set_port_on_sim_source_errors(tmp_path, config_dir):
    ... # {"cmd":"set_port","target":"roket","port":"COM9","baud":9600} → {"type":"error"} ve "simülasyon kaynağı"

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

Görsel referans: `.superpowers/yer-istasyonu/layout-v3.html`. Renk, yazı tipi, animasyon ayrıntısı kurucunun kararıdır (Spec §9); düzen ve davranış aşağıda sabittir. Her görev bir ekran görüntüsüyle biter: `python tools/ekran_goruntusu.py --out ../.superpowers/yer-istasyonu/ui-tNN.png --t <sn>` (Görev 14'te yazılır); görüntü commit'e eklenir ve layout-v3 ile karşılaştırılır.

### Task 13: Arayüz iskeleti, veri yolu istemcisi, view-model'ler

**Files:**
- Create: `src/yeristasyonu/ui/__init__.py`, `ui/app.py`, `ui/client.py`, `ui/models.py`, `ui/format.py`, `ui/qml/Main.qml`, `ui/qml/Theme.qml`, `ui/qml/qmldir`
- Test: `tests/ui/test_models.py`, `tests/ui/test_qml_load.py`

**Interfaces:**
- Consumes: Spec §7.6 mesajları ve komutları.
- Produces:
  - `class BusClient(QObject)`: `QTcpSocket`; sinyaller `message(dict)`, `connectedChanged(bool)`; `send(cmd: dict)`; kopunca 1 s aralıkla yeniden bağlanır.
  - `class SourceModel(QObject)` — QML özellikleri (`Property` + `notify`): `name, label, color, altitude_m, altitude_ft, max_alt_m, pressure_hpa, temperature_c, humidity_pct, vz, accel_g, roll, pitch, yaw, phase (int), phase_name (görünen ad), safe_mode, status, rate_hz, crc_error_pct, lost, age_s, rssi_dbm, az_deg, el_deg, slant_m, gps_age_s, has_fix, lat, lon, offset_e_m, offset_n_m, flags (dict ad→bool)`. Rolü olmayan değerler `NaN` ve QML'de `"—"`. Slotlar: `track_xy() -> list` ([menzil_m, alt_m]; menzil = `ground_distance_m(launch, fix)`, launch = ilk geçerli fix), `sky_track(radius) -> list`, `events() -> list` (dict: phase, name, label, t, alt, downrange), `series(role: str, window_s: float) -> list` ([t, v]), `pulses(now, window_s=10) -> list` ([t, ok]), `at(offset_s: float) -> dict` (o andaki rol değerleri; ikili arama).
  - `class StationModel(QObject)`: `handle_message(msg: dict)`; özellikler `sources`, `connected`, `t_plus` (yoksa −1), `recording`, `log_dir`, `hyi_status`, `ceiling_m`, `day_mode` (yazılabilir), `view_offset_s` (0 = canlı, yazılabilir), `suggest_map`, `serial_panel_open` (yazılabilir), `raw_lines` (QAbstractListModel, en fazla 2000 satır: `t, source, ok, seq, text, hex`), `hyi_lines` (aynı, en fazla 2000), `ports` (dict: `available`, `sources`, `hyi`), `last_error`. Slot `command(cmd: dict)` → `BusClient.send`.
  - Görünen faz adları `ui/format.py: PHASE_LABELS = ["Rampa","Kalkış","Apogee yaklaşma","Apogee","Drogue açılış","Payload açılış","Main açılış","Finiş","Güvenli mod"]`.
  - `ui/app.py: main(argv=None) -> int` — `--host` (127.0.0.1), `--port` (47800), `--anten` (Görev 20).
  - Geçmiş tamponu kaynak başına rol başına en fazla 6000 nokta, aşılınca en eskiler düşer.

- [ ] **Step 1: Failing testler**

```python
def test_session_creates_sources(station):
    station.handle_message(SESSION)
    assert [s.name for s in station.sources] == ["roket", "gorevyuku"] and station.ceiling_m == 6096

def test_telemetry_updates_roles(station):
    station.handle_message(SESSION)
    station.handle_message({"type": "telemetry", "source": "roket", "t": 10.0,
                            "fields": {"kalman_alt": 6041.0, "pressure": 470.6, "pitch": 12.4, "phase": 3}})
    r = station.sources[0]
    assert r.altitude_ft == pytest.approx(19819, abs=1) and r.pressure_hpa == 470.6 and r.phase_name == "Apogee"

def test_payload_env(station):
    station.handle_message(SESSION)
    station.handle_message({"type": "telemetry", "source": "gorevyuku", "t": 1, "fields": {"temp": -18.6, "humidity": 34.0, "pressure": 471.2}})
    g = station.sources[1]; assert (g.temperature_c, g.humidity_pct, g.pressure_hpa) == (-18.6, 34.0, 471.2)

def test_safe_mode(station): ...         # phase 8 → safe_mode True, phase_name "Güvenli mod"
def test_raw_lines_capped(station): ...  # 2500 raw → len 2000, en yeni en üstte
def test_snapshot_restores_track(station): ...
def test_suggest_map_on_descent(station): ...   # phase 4 → True

def test_main_qml_loads_without_warnings(qapp):
    eng = QQmlApplicationEngine(); warns = []; eng.warnings.connect(lambda w: warns.extend(w))
    eng.rootContext().setContextProperty("station", StationModel()); eng.load(QML_DIR / "Main.qml")
    assert eng.rootObjects() and warns == []
```

- [ ] **Step 2–4:** FAIL → yaz (Main.qml şimdilik zemin + Theme) → PASS.
- [ ] **Step 5: Commit** — `"yer-istasyonu/ui: QML iskeleti, veri yolu istemcisi, view-model'ler"`

---

### Task 14: Sahne düzeni, tema, ekran görüntüsü aracı

**Files:**
- Modify: `ui/qml/Main.qml`, `ui/qml/Theme.qml`
- Create: `tools/ekran_goruntusu.py`
- Test: `tests/ui/test_layout.py`

**Interfaces:**
- Produces: Main.qml'de `objectName`'li bölgeler (layout-v3): `topStrip`, `phaseRail`, `leftColumn`, `flightScene`, `liveCharts`, `rocket3d`, `mapOrSky`, `payloadCard`, `serialPanel`. Kutu/kenarlık/gölge yok. `serialPanel` kapalıyken yalnızca 8 px tutamaç; açıkken pencere yüksekliğinin %30'u, `leftColumn`/`flightScene`/`liveCharts` dikeyde sıkışır, hiçbiri gizlenmez.
  - `Theme`: `night`/`day` paletleri, `station.day_mode`'a bağlı; gündüzde metin kontrastı ≥ 7:1.
  - Kısayollar: `G` gece/gündüz, `H` harita/kubbe, `S` seri panel, `A` anten penceresi, `Esc` canlıya dön.
  - `tools/ekran_goruntusu.py --out PNG --t SECONDS [--day] [--serial] [--safe-at T]`: çekirdeği `--sim --sim-speed 10` ile başlatır, arayüzü offscreen 1920×1080 açar, sim T+`t` olunca `grabWindow()` kaydeder, ikisini kapatır.

- [ ] **Step 1: Failing test** — `test_regions_exist_and_do_not_overlap`: tüm `objectName`'ler bulunur; 1920×1080'de panel kapalı ve açıkken `leftColumn, flightScene, liveCharts, rocket3d, mapOrSky, payloadCard` dikdörtgenleri ikili kesişmez ve hepsinin yüksekliği > 80 px.
- [ ] **Step 2–4:** FAIL → yaz → PASS. · **Step 5:** `ui-t14.png`, `ui-t14-day.png`, `ui-t14-serial.png`.
- [ ] **Step 6: Commit** — `"yer-istasyonu/ui: kutusuz sahne düzeni, gece/gündüz teması"`

---

### Task 15: Üst şerit ve sol sütun

**Files:**
- Create: `ui/qml/PulseLines.qml`, `ui/qml/MissionClock.qml`, `ui/qml/AltitudeTape.qml`, `ui/qml/BigReadouts.qml`
- Test: `tests/ui/test_format.py`

**Interfaces:**
- Consumes: `SourceModel.pulses/status/rate_hz/rssi_dbm/lost/age_s`, `altitude_m/max_alt_m/pressure_hpa/pitch/yaw/roll/vz`, `StationModel.t_plus/recording/hyi_status/ports`.
- Produces:
  - PulseLines: kaynak başına satır, son 10 s; geçerli paket kaynak renginde çentik, CRC hatası kırmızı çentik, > 1 s boşluk kırmızı çizgi; sağda `"{port} · {rate:.1f} Hz · {rssi} dBm · kayıp {lost}"`, sarı/kırmızıda `"son paket {age:.1f} s önce"`. 10 Hz yenileme.
  - MissionClock: `T+ mm:ss.s` / `T− --:--.-`; kayıt göstergesi; HYİ durumu Türkçe (`kapalı / format tanımsız / gönderiyor / hata`).
  - AltitudeTape: 0–`ceiling_m`; okuyucu `"6 041 m"`, altında `"19 819 ft · max 6 088"`; > ceiling → okuyucu tavanda kırmızı.
  - BigReadouts: basınç `"{:.1f} hPa"`, pitch/yaw/roll `"{:.1f}°"`, dikey hız `"{:.1f} m/s"`.
  - `ui/format.py`: `fmt_m(v) -> str`, `fmt_clock(t_plus) -> str`, `fmt_num(v, digits, unit) -> str` (NaN → `"—"`), `pulse_segments(pulses, now, window_s=10, gap_s=1.0) -> list[tuple[float, float, str]]`.

- [ ] **Step 1: Failing testler**

```python
def test_fmt():
    assert fmt_m(6041.4) == "6 041 m" and fmt_clock(38.44) == "T+ 00:38.4" and fmt_clock(None) == "T− --:--.-"
    assert fmt_num(float("nan"), 1, "hPa") == "—" and fmt_num(470.63, 1, "hPa") == "470.6 hPa"

def test_pulse_segments_gap():
    segs = pulse_segments([[0.0, True], [0.2, True], [1.8, True], [2.0, False]], now=2.0)
    assert "gap" in [x[2] for x in segs] and segs[-1][2] == "crc"
```

- [ ] **Step 2–4:** FAIL → yaz → PASS. · **Step 5:** `ui-t15.png` (T+38).
- [ ] **Step 6: Commit** — `"yer-istasyonu/ui: nabız çizgileri, saat, irtifa şeridi, büyük göstergeler"`

---

### Task 16: 9 faz yolu ve güvenli mod

**Files:**
- Create: `ui/qml/PhaseRail.qml`, `ui/phases.py`
- Test: `tests/ui/test_phases.py`

**Interfaces:**
- Consumes: `SourceModel` (roket) `phase`, `safe_mode`, `events()`.
- Produces:
  - `rail_states(current: int, seen: set[int]) -> list[str]` → 8 sıralı faz (0–7) için `"gecildi" | "simdi" | "bekliyor"`. Sıra dışı atlama olursa (ör. 1'den 3'e) aradaki görülmemiş fazlar `"atlandi"`.
  - `safe_mode_banner(safe: bool, t_plus: float | None) -> str | None` → `"GÜVENLİ MOD · T+{t:.1f}"` veya None.
  - QML: 8 düğüm yatay yol; `simdi` altın + parıltı, `gecildi` dolu, `bekliyor` boş halka, `atlandi` çizgili halka; düğüm altında etiket ve geçiş zamanı `T+{t:.1f}`. Sağda ayrı Güvenli mod rozeti; aktifken rozet kırmızı ve tüm pencere kenarında 6 px kırmızı çerçeve yanıp söner (1 Hz). Yol, güvenli moddayken `last_sequential_phase`'i gösterir.

- [ ] **Step 1: Failing testler**

```python
def test_rail_states():
    assert rail_states(3, {0, 1, 2, 3}) == ["gecildi"] * 3 + ["simdi"] + ["bekliyor"] * 4

def test_skipped():
    assert rail_states(3, {0, 1, 3})[2] == "atlandi"

def test_banner():
    assert safe_mode_banner(True, 52.04) == "GÜVENLİ MOD · T+52.0" and safe_mode_banner(False, 1) is None
```

- [ ] **Step 2–4:** FAIL → yaz → PASS. · **Step 5:** `ui-t16.png` (T+38) ve `--safe-at 50 --t 52` ile `ui-t16-safe.png`.
- [ ] **Step 6: Commit** — `"yer-istasyonu/ui: 9 faz yolu ve güvenli mod uyarısı"`

---

### Task 17: Uçuş sahnesi (yan kesit yörünge)

**Files:**
- Create: `ui/qml/FlightScene.qml`, `ui/scene.py`
- Test: `tests/ui/test_scene.py`

**Interfaces:**
- Consumes: `SourceModel.track_xy()`, `events()`, `StationModel.ceiling_m`.
- Produces:
  - `class SceneScaler`: `update(points, ceiling_m, width, height, min_range_m=2000.0) -> tuple[float, float]` (px/m yatay, px/m dikey). Dikey sabit `height / ceiling_m`; yatay `width / max(min_range_m, 1.15 · max menzil)` ve asla küçülmez (en büyük menzil saklanır).
  - `pending_markers(seen: set[int]) -> list[tuple[str, float | None]]`: görülmemiş `APOGEE` (irtifa = ceiling değil, bilinmiyor → None) ve `MAIN_ACILIS` (500 m) soluk işaret olarak.
  - QML: roket izi kaynak renginde gradyan, görev yükü kesikli; tavan kesikli kırmızı + `"eşik 20 000 ft · 6 096 m"`; olay etiketleri `"{label} · T+{t:.1f} · {alt} m"`; şu anki konumda parlayan işaret; 5 Hz yeniden çizim.

- [ ] **Step 1: Failing testler**

```python
def test_vertical_fixed_horizontal_never_shrinks():
    sc = SceneScaler(); a, sy = sc.update([(0, 0), (5000, 10)], 6096, 1000, 600)
    assert sy == pytest.approx(600 / 6096); assert sc.update([(0, 0), (100, 10)], 6096, 1000, 600)[0] == a

def test_pending_markers():
    assert pending_markers({0, 1, 2, 3, 4, 5}) == [("MAIN_ACILIS", 500.0)]
```

- [ ] **Step 2–4:** FAIL → yaz → PASS. · **Step 5:** `ui-t17.png` T+20 ve T+90.
- [ ] **Step 6: Commit** — `"yer-istasyonu/ui: yan kesit uçuş sahnesi"`

---

### Task 18: Canlı grafikler ve geçmişe kaydırma

**Files:**
- Create: `ui/qml/LiveCharts.qml`, `ui/qml/StripChart.qml`, `ui/charts.py`
- Test: `tests/ui/test_charts.py`

**Interfaces:**
- Consumes: `SourceModel.series(role, window_s)`, `StationModel.view_offset_s`.
- Produces:
  - Dört grafik, her zaman görünür, varsayılan pencere 60 s: (1) roket irtifa — `altitude` + varsa ham `baro_alt` (soluk), (2) roket `pressure`, (3) `pitch`/`yaw`/`roll`, (4) görev yükü `temperature`/`humidity`/`pressure` (üç ayrı y ölçeği, eksen etiketleri sağda/solda; değerler son noktada etiket).
  - `nice_range(values: list[float], min_span: float) -> tuple[float, float]` (y ekseni; 1-2-5 adımlarına yuvarlar, en az `min_span`).
  - `decimate_minmax(points: list[tuple[float, float]], buckets: int) -> list[tuple[float, float]]` (piksel başına min-max; 6000 noktayı ≤ 2·buckets noktaya indirir, uç değerleri korur).
  - Grafik üzerinde yatay sürükleme `view_offset_s`'i ayarlar; geçmişteyken tüm göstergeler `at(offset)` değerlerini gösterir ve üstte `"GEÇMİŞ −{s:.0f} s · Esc canlı"` görünür. Çekirdeğe komut gitmez.
  - `StripChart.qml` Canvas veya Shapes (kurucu seçer); 5 Hz yeniden çizim, 1920 px genişlikte kare süresi < 16 ms (`test_charts.py` içinde `decimate_minmax` 6000 → 400 nokta süresi < 5 ms ölçülür).

- [ ] **Step 1: Failing testler**

```python
def test_nice_range():
    assert nice_range([468.1, 1009.7], 10) == (400.0, 1100.0)
    assert nice_range([5.0, 5.0], 10) == (0.0, 10.0)

def test_decimate_keeps_extremes():
    pts = [(i, 0.0) for i in range(6000)]; pts[3000] = (3000, 99.0)
    out = decimate_minmax(pts, 200); assert len(out) <= 400 and max(v for _, v in out) == 99.0
```

- [ ] **Step 2–4:** FAIL → yaz → PASS. · **Step 5:** `ui-t18.png` (T+60), sürükleme sonrası geçmiş modunda bir görüntü.
- [ ] **Step 6: Commit** — `"yer-istasyonu/ui: canlı grafikler ve geçmişe kaydırma"`

---

### Task 19: 3D roket görünümü

**Files:**
- Create: `ui/orientation.py`, `ui/qml/Rocket3D.qml`
- Modify: `config.py` (`SourceConfig.attitude: dict = {"order": "ZYX", "pitch_reference": "vertical"}`; `session` mesajındaki kaynak bilgisine eklenir), `config/istasyon.yaml`
- Test: `tests/ui/test_orientation.py`, `tests/ui/test_rocket3d_load.py`

**Interfaces:**
- Produces:
  - `euler_to_quat(roll: float, pitch: float, yaw: float, order: str = "ZYX") -> tuple[float, float, float, float]` (derece; (w, x, y, z); desteklenen sıralar `ZYX`, `XYZ`; diğerleri `ValueError`).
  - `rotate(q, v: tuple[float, float, float]) -> tuple[float, float, float]`.
  - `body_to_scene(roll, pitch, yaw, order, pitch_reference) -> tuple[float, float, float, float]`: roket gövde ekseni (burun) sahnede +Y; `pitch_reference="vertical"` iken pitch 0 = burun yukarı, `"horizontal"` iken pitch 90 = burun yukarı. Kuzey sahnede −Z, doğu +X. Sonuç QML `Node.rotation` (quaternion) için.
  - `SourceModel.orientation` özelliği (`QQuaternion`) bu fonksiyonla güncellenir.
  - `Rocket3D.qml`: `View3D`; model Qt Quick 3D yerleşik primitifleriyle (`#Cylinder` gövde, `#Cone` burun, kanatçıklar için ince `#Cube` ×4) ve renk bandı; ufuk halkası (yatay disk, yarı saydam) ve dikey kesikli referans; sabit kamera hafif yukarıdan; altında `P {pitch:.1f}° · Y {yaw:.1f}° · R {roll:.1f}°`. Yönelim değişimi 100 ms'lik `QuaternionAnimation`/yumuşatma ile.
  - 3D render başarısızsa (grafik sürücüsü) bölge, 2D yedek: gövde silueti pitch açısıyla döndürülmüş ve "3D kullanılamıyor" notu (`Rocket3D.qml` içinde `Loader` + `onStatusChanged`).

- [ ] **Step 1: Failing testler**

```python
def test_identity():
    assert rotate(euler_to_quat(0, 0, 0), (1, 0, 0)) == pytest.approx((1, 0, 0))

def test_yaw_and_pitch_zyx():
    assert rotate(euler_to_quat(0, 0, 90), (1, 0, 0)) == pytest.approx((0, 1, 0), abs=1e-9)
    assert rotate(euler_to_quat(0, 90, 0), (1, 0, 0)) == pytest.approx((0, 0, -1), abs=1e-9)

def test_scene_nose_up_on_pad():
    q = body_to_scene(0, 0, 0, "ZYX", "vertical"); assert rotate(q, (0, 1, 0)) == pytest.approx((0, 1, 0), abs=1e-9)
    q = body_to_scene(0, 90, 0, "ZYX", "horizontal"); assert rotate(q, (0, 1, 0)) == pytest.approx((0, 1, 0), abs=1e-9)

def test_scene_tilt_east():
    # dikey referans, yaw 90 (doğu), pitch 90 → burun doğuya, yatay
    q = body_to_scene(0, 90, 90, "ZYX", "vertical"); assert rotate(q, (0, 1, 0)) == pytest.approx((1, 0, 0), abs=1e-6)

def test_bad_order():
    with pytest.raises(ValueError): euler_to_quat(0, 0, 0, "YXZ")
```

`test_rocket3d_load.py`: `Rocket3D.qml` offscreen yüklenir; RHI yoksa test 2D yedeğin yüklendiğini (`objectName: "rocketFallback"`) doğrular — iki durumda da QML uyarısı yok.

- [ ] **Step 2–4:** FAIL → yaz → PASS. · **Step 5:** `ui-t19.png` T+5 (dik), T+40 (yatıyor). Gerçek bir dizüstünde (GPU'lu) bir kez elle açıp 3D'nin çizildiğini doğrula; offscreen ortamda 2D yedek görünmesi beklenir.
- [ ] **Step 6: Commit** — `"yer-istasyonu/ui: 3D roket yönelim görünümü"`

---

### Task 20: Gökyüzü kubbesi ve anten penceresi

**Files:**
- Create: `ui/qml/SkyDome.qml`, `ui/qml/AntennaWindow.qml`
- Modify: `ui/app.py` (`--anten`), `ui/qml/Main.qml` (`A`), `ui/format.py`
- Test: `tests/ui/test_antenna.py`

**Interfaces:**
- Consumes: `SourceModel.az_deg/el_deg/slant_m/gps_age_s/has_fix`, `sky_track(radius)`; `geo.sky_to_xy`.
- Produces:
  - SkyDome: halkalar 0°/30°/60°, K/D/G/B; kaynak başına iz + nokta; seçili kaynak (varsayılan roket, tıklayınca değişir) için büyük `"{az:.0f}°"` `"{el:.0f}°"`, `az_compass(az)`, `"eğik mesafe {km:.1f} km"`. `has_fix=False` → `"GPS yok"`; `gps_age_s > 2` → `"son konum {s:.0f} s önce"`, soluk nokta.
  - AntennaWindow: tam ekran kubbe + rakamlar; rakam yüksekliği ≥ pencere yüksekliğinin %15'i; ana pencereden `A` veya `yi-ui --anten`.
  - `ui/format.py: az_compass(az_deg) -> str` (K, KD, D, GD, G, GB, B, KB).

- [ ] **Step 1: Failing testler**

```python
@pytest.mark.parametrize("az,txt", [(0, "K"), (48, "KD"), (90, "D"), (200, "G"), (337.6, "K"), (315, "KB")])
def test_az_compass(az, txt): assert az_compass(az) == txt

def test_antenna_digits_large(qapp):
    win = load_antenna_window(height=1080); assert win.findChild(QObject, "azText").property("font").pixelSize() >= 162
```

- [ ] **Step 2–4:** FAIL → yaz → PASS. · **Step 5:** `ui-t20.png` + `--anten` görüntüsü.
- [ ] **Step 6: Commit** — `"yer-istasyonu/ui: gökyüzü kubbesi ve anten penceresi"`

---

### Task 21: Çevrimdışı harita

**Files:**
- Create: `ui/qml/MapView.qml`, `ui/tiles.py`
- Modify: `config.py` (`StationConfig.map_dir: Path`, varsayılan `harita`; `session`'a eklenir), `ui/qml/Main.qml` (`H`; `suggest_map` önerisi)
- Test: `tests/ui/test_tiles.py`

**Interfaces:**
- Produces:
  - `visible_tiles(center, z, width_px, height_px, tile_px=256) -> list[tuple[int, int, int, float, float]]`
  - `tile_path(root: Path, z, x, y) -> Path | None`
  - `fit_zoom(points, width_px, height_px, z_min=10, z_max=17) -> int` (%10 kenar payıyla sığdıran en büyük z)
  - QML: karo yoksa koyu ızgara; rampa, istasyon, roket, görev yükü izleri; alt satırda `"anten {az:.0f}° · {el:.0f}° · {km:.1f} km"`. `suggest_map` iken kubbe köşesinde `"İniş başladı — haritaya geç (H)"`; otomatik geçiş yok.

- [ ] **Step 1: Failing testler**

```python
def test_visible_tiles_cover_view():
    t = visible_tiles((38.0, 33.0), 14, 512, 512); assert 4 <= len(t) <= 9 and all(x[0] == 14 for x in t)

def test_fit_zoom_monotonic():
    near = fit_zoom([(38.0, 33.0), (38.001, 33.001)], 600, 600); far = fit_zoom([(38.0, 33.0), (38.1, 33.1)], 600, 600)
    assert near > far and 10 <= far <= 17

def test_missing_tile(tmp_path): assert tile_path(tmp_path, 14, 1, 1) is None
```

- [ ] **Step 2–4:** FAIL → yaz → PASS.
- [ ] **Step 5:** README "Harita karoları": `harita/{z}/{x}/{y}.png` düzeni; OpenStreetMap genel karo sunucusundan toplu indirme kullanım politikasına aykırıdır; toplu indirmeye izin veren bir kaynak ya da kendi üretilen karolar kullanılmalı.
- [ ] **Step 6: Commit** — `"yer-istasyonu/ui: çevrimdışı karo haritası"`

---

### Task 22: Görev yükü kartı

**Files:**
- Create: `ui/qml/PayloadCard.qml`
- Modify: `ui/models.py` (sapma hesabı), `ui/format.py`
- Test: `tests/ui/test_payload.py`

**Interfaces:**
- Consumes: görev yükü `SourceModel`: `lat, lon, has_fix, pressure_hpa, temperature_c, humidity_pct, flags`, roket `events()`.
- Produces:
  - `SourceModel.offset_e_m/offset_n_m`: `enu(launch, fix)`'in doğu/kuzey bileşenleri (launch = roketin ilk geçerli fix'i; yoksa görev yükünün ilk fix'i).
  - `fmt_latlon(lat, lon) -> tuple[str, str]` → (`"38.7121345° K"`, `"33.4598812° D"`; negatifte G/B).
  - `fmt_offset(e, n) -> str` → `"D 1 214 m · K 388 m"` (negatif: B/G).
  - Kart: başlık "Görev yükü", durum `"bekliyor"` / `"ayrıldı · T+{t:.1f}"` (`flags["AYRILDI"]` ya da roket `PAYLOAD_ACILIS` olayı, hangisi önce), enlem, boylam, sapma; büyük rakamlarla basınç (hPa), sıcaklık (°C), nem (%); `flags` etiketleri küçük noktalarla (yeşil true, soluk false). GPS yoksa konum satırlarında `"GPS yok"`.

- [ ] **Step 1: Failing testler**

```python
def test_fmt_latlon(): assert fmt_latlon(38.7121345, -33.4598812) == ("38.7121345° K", "33.4598812° B")
def test_fmt_offset(): assert fmt_offset(1214.2, -388.0) == "D 1 214 m · G 388 m"
def test_offset_from_launch(station): ...   # roket ilk fix (38,33), görev yükü (38, 33.01) → offset_e_m ≈ 878.3 (±2), offset_n_m ≈ 0
```

- [ ] **Step 2–4:** FAIL → yaz → PASS. · **Step 5:** `ui-t22.png` (T+60).
- [ ] **Step 6: Commit** — `"yer-istasyonu/ui: görev yükü kartı (konum, basınç, sıcaklık, nem)"`

---

### Task 23: Alttan açılan seri panel

**Files:**
- Create: `ui/qml/SerialPanel.qml`, `ui/qml/IncomingTab.qml`, `ui/qml/PortsTab.qml`, `ui/qml/HyiTab.qml`, `ui/serial_view.py`
- Test: `tests/ui/test_serial_panel.py`

**Interfaces:**
- Consumes: `StationModel.raw_lines`, `hyi_lines`, `ports`, `command()`, roket `phase`.
- Produces:
  - `format_raw_line(msg: dict, decoded: dict | None, labels: dict[str, str], mode: str) -> str`: `mode="decoded"` → `"23:41:07.812  roket  #1342  Apogee  alt=6041.2  p=470.6  pitch=12.4  yaw=231.0  roll=-4.8  lat=38.7120411  lon=33.4561203"` (yalnızca rolü olan değerler, rol sırası: altitude, pressure, pitch, yaw, roll, temperature, humidity, lat, lon); CRC hatasında `"…  roket  CRC HATASI  68 bayt  AA 55 3F …"` (ilk 8 bayt); `mode="hex"` → tam hex + `"  CRC ✓"` / `"  CRC ✗"` + varsa `"  RSSI −71"`. Zaman yerel saat `HH:MM:SS.mmm`.
  - `needs_confirm(phase: int | None) -> bool` → faz `None`, 0 (Rampa) veya 7 (Finiş) dışında True.
  - Sekmeler:
    - **Gelen veri**: kaynak seçici (Tümü / kaynaklar), `çözülmüş | hex` anahtarı, duraklat (duraklatınca yeni satırlar tamponda birikir, liste kaymaz), temizle; CRC hatalı satırlar kırmızı; liste en yeni üstte, 2000 satır.
    - **Portlar**: her kaynak ve HYİ için satır: port açılır listesi (`ports.available`, boş ise "port bulunamadı"), baud listesi `[9600, 19200, 38400, 57600, 115200]`, `Bağlan`, `Kes`, durum (bağlı/bağlı değil/hata metni); `Yenile` → `{"cmd":"list_ports"}`. `needs_confirm` True iken işlem öncesi onay penceresi: `"Uçuş sürüyor. Port değiştirmek veri kaybına yol açabilir. Devam edilsin mi?"`; onaylanmazsa komut gönderilmez.
    - **HYİ'ye giden**: gönderilen paketler hex, sayaç, format durumu (`format tanımsız` iken açıklama: "Şartname formatı eklenince gönderim başlar").
  - Panel `S` ile açılır/kapanır; açık/kapalı durumu ve seçili sekme oturumlar arası `QSettings` ile hatırlanır.

- [ ] **Step 1: Failing testler**

```python
def test_format_decoded():
    line = format_raw_line(RAW_OK, DECODED, LABELS, "decoded")
    assert "#1342" in line and "alt=6041.2" in line and "p=470.6" in line and line.index("alt=") < line.index("pitch=")

def test_format_crc_error():
    assert "CRC HATASI" in format_raw_line(RAW_BAD, None, LABELS, "decoded")

def test_format_hex(): assert format_raw_line(RAW_OK, DECODED, LABELS, "hex").startswith(TIME_PREFIX + "  roket  AA 55")

@pytest.mark.parametrize("phase,need", [(None, False), (0, False), (3, True), (8, True), (7, False)])
def test_port_change_requires_confirm_in_flight(phase, need): assert needs_confirm(phase) is need

def test_ports_tab_sends_set_port(qapp, station_with_fake_client):
    ... # PortsTab'da roket için COM7 / 19200 seç → Bağlan → client.sent[-1] == {"cmd":"set_port","target":"roket","port":"COM7","baud":19200}
```

- [ ] **Step 2–4:** FAIL → yaz → PASS. · **Step 5:** `ui-t23-gelen.png`, `ui-t23-portlar.png`, `ui-t23-hyi.png` (`--serial`).
- [ ] **Step 6: Commit** — `"yer-istasyonu/ui: alttan açılan seri panel (gelen, portlar, HYİ)"`

---

### Task 24: Başlatıcı ve uçtan uca prova

**Files:**
- Create: `yer-istasyonu/baslat.py`
- Modify: `yer-istasyonu/README.md`
- Test: `tests/test_launcher.py`

**Interfaces:**
- Produces: `baslat.py [--sim] [--config PATH]` → `yi-core` alt süreç, veri yolu portu açılana kadar (≤ 5 s) bekler, `yi-ui`'yi başlatır. Arayüz kapanınca çekirdek **çalışmaya devam eder** ve `"Arayüz kapandı. Çekirdek kayıt yapıyor. Arayüzü yeniden açmak için: python -m yeristasyonu.ui.app — çekirdeği durdurmak için Ctrl+C"` yazar. Ctrl+C → temiz kapanış.
- Yardımcı: `wait_for_port(host, port, timeout_s) -> bool`.

- [ ] **Step 1: Failing test** — `test_wait_for_port`: dinleyen soket True; kapalı port `timeout_s=0.3`'te False.
- [ ] **Step 2–4:** FAIL → yaz → PASS.
- [ ] **Step 5: Uçtan uca prova (elle)** — `python baslat.py --sim`: (a) nabız çizgileri yeşil; (b) T+ Kalkış'ta başlar; (c) 9 faz yolu sırayla ilerler, apogee ≈ 6 096 m; (d) grafikler canlı akar, sürükleyince geçmiş, `Esc` canlı; (e) 3D roket dikten yatığa döner; (f) görev yükü kartında basınç/sıcaklık/nem değişir, ayrıldı zamanı görünür; (g) `S` → Gelen veri akar, hex'e geçiş, Portlar listesi, HYİ "format tanımsız"; (h) arayüzü kapat → çekirdek sürer → yeniden aç → iz geri gelir; (i) `A` anten penceresi, `G` gündüz; (j) `--sim-safe-at 50` ile güvenli mod uyarısı; (k) Ctrl+C → `kayitlar/<oturum>/` dolu. Sonra `python -m yeristasyonu.core --replay kayitlar/<oturum> --speed 4` aynı uçuşu yeniden oynatır.
- [ ] **Step 6: Tüm testler** — `python -m pytest -v` → hepsi PASS.
- [ ] **Step 7: Commit** — `"yer-istasyonu: başlatıcı ve kullanım kılavuzu"`
