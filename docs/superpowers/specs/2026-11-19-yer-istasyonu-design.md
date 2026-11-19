# AKANA Yer İstasyonu — Tasarım

Tarih: 2026-11-19 · Durum: taslak, onay bekliyor

## 1. Amaç ve neden

TEKNOFEST yüksek irtifa roketi için sahada, internetsiz çalışan, roket ve görev yükünden gelen LoRa telemetrisini alan, gösteren, kaydeden ve Hakem Yer İstasyonu'na (HYİ) ileten masaüstü yer istasyonu. Eski SAZAKAN (A2) yer istasyonunun KTR'de tanımlanan işlevlerini (CRC-16 doğrulamalı binary paket çözümü, iki kaynağın eş zamanlı takibi, uçuş fazı, iz düşüm haritası, kayıt) temel alır; KTR incelemesinde bulunan eksikleri kapatır.

Aviyonik kartın modülleri henüz belli değil; yazılım paket yapısından bağımsız olmalı.

## 2. Hedefler

- H1. N adet alıcıyı (her biri bir E22 + Yagi, USB-seri) eş zamanlı dinlemek. Kaynak sayısı yapılandırmadan gelir.
- H2. Gelen her baytı çözümlemeden önce zaman damgasıyla diske yazmak (ham kayıt). Arayüz çökse bile kayıt ve HYİ aktarımı sürer.
- H3. Paket yapısını YAML şemasından okumak; aviyonik değişince kod değişmez.
- H4. Kaynak sağlığı: paket hızı, CRC hata oranı, sıra numarasından kayıp, son paket yaşı, RSSI.
- H5. Uçuş sahnesi arayüzü (bkz. §6), irtifa eşiği **20.000 ft (6.096 m)**.
- H6. Elle Yagi yönlendirme için azimut / elevasyon / eğik mesafe; ayrı tam ekran pencerede de açılabilir.
- H7. Donanımsız geliştirme ve prova için dahili uçuş simülatörü (20.000 ft profili).
- H8. Ham kayıttan tekrar oynatma.
- H9. HYİ'ye ayrı seri porttan aktarım altyapısı.

## 3. Hedef olmayanlar

- Rokete komut gönderme (uplink). Sistem tek yönlü.
- Motorlu anten döndürücü sürme.
- Bulut / Supabase / AKANA Mission Control entegrasyonu.
- Harita karolarını indirme aracı (karolar önceden hazırlanır, bkz. §8).
- HYİ paket formatının kendisi: şartname gelene kadar tanımsız, yalnızca altyapı.

## 4. Anti-hedefler (çalışsa bile başarısızlık sayılır)

- Arayüzdeki bir hata yüzünden tek bir telemetri baytının kaybolması.
- Ekranın operatörün isteği dışında kendiliğinden düzen değiştirmesi.
- Güneş altında okunamayan arayüz.
- Sahada internet gerektiren herhangi bir işlev.

## 5. Kısıtlar

- Windows 10/11 dizüstü (ekip makinesi); Linux'ta da çalışmalı.
- Python ≥ 3.11, PySide6 ≥ 6.6 (Qt Quick / QML), pyserial ≥ 3.5, PyYAML ≥ 6. Test: pytest.
- Minimum ekran 1920×1080.
- E22 UART varsayılanı 9600 baud (yapılandırılabilir).
- Varsayılan zorunlu veri hızı ≥ 5 Hz: sağlık eşikleri buna göre.
- Kod bu depoda bağımsız bir dizinde: `yer-istasyonu/`. Mission Control koduna dokunulmaz, bağımlılık yoktur. İleride ayrı depoya taşınabilir.

## 6. Yaklaşımlar ve seçim

| | Yaklaşım | Artı | Eksi |
|---|---|---|---|
| A | Yerel sunucu + tarayıcı arayüz | Veri alımı arayüzden ayrık, zengin web kütüphaneleri | İki parça, kurulum |
| **B** | **Masaüstü (Python + Qt)** | Tek kurulum, seri port ve çizim performansı | Arayüz hatası kaydı etkilemesin diye ayrıştırma gerekir |
| C | Yalnızca tarayıcı (Web Serial) | En basit | Sekme çökerse kayıt gider; Chrome'a bağlı |

**Seçilen: B** (Baran'ın kararı). B'nin eksisini kapatmak için masaüstü uygulaması **iki süreç** olarak çalışır (benim kararım):

- `yi-core`: ekransız çekirdek. Seri okuma, ham kayıt, çözüm, CSV, sağlık, HYİ. Tek başına çalışır.
- `yi-ui`: Qt Quick arayüzü. Çekirdeğe `127.0.0.1:47800` üzerinden bağlanan bir istemci. Kapanması/çökmesi çekirdeği etkilemez. İkinci bir `yi-ui --anten` örneği aynı veya ağdaki başka bir bilgisayarda yalnızca anten penceresini açar.
- Tek tıkla başlatma: `yer-istasyonu/baslat.py` önce çekirdeği, sonra arayüzü açar.

Ana ekran yerleşimi: **A (tek ekran kokpit)**, Baran'ın isteğiyle **klasik kutulu panel düzeninden çıkılmış** sürüm. Görsel taslak: `.superpowers/yer-istasyonu/layout-v2.html`.

Qt Widgets yerine **Qt Quick (QML)** (benim kararım): kutusuz, katmanlı, animasyonlu sahne QML'de doğal; mantık Python'da kalır ve test edilir, QML yalnızca görünüm.

## 7. Mimari

```
SerialSource/SimSource/ReplaySource ─► okuyucu iş parçacığı (kaynak başına)
      │ ham bayt + t
      ├─► RawLogWriter (.bin)
      └─► Framer(şema) ─► decode ─► FlightState, LinkHealth, CsvLogWriter
                                      │
                         BusServer (TCP, satır başına JSON) ─► yi-ui (1..n)
                         HyiForwarder ─► HYİ seri portu
```

### 7.1 Paket şeması (YAML)

Her kaynak bir şema dosyası kullanır. Alanlar: `sync` (bayt listesi), `length_byte` (bool; değeri yük boyutu), `endian` (`little`/`big`), `crc` (`crc16_ccitt_false` | `crc16_modbus` | `none`), CRC kapsamı uzunluk baytı + yük, CRC bayt sırası `endian` ile aynı, `rssi_byte` (E22 "RSSI ekle" açıkken çerçeveden sonra 1 bayt; dBm = −(256 − değer)), `fields` (ad, tip `u8|i8|u16|i16|u32|i32|f32`, `scale`, `unit`, opsiyonel `enum`), `roles` (arayüzün kullandığı anlamlar → alan adı: `seq, t_ms, phase, altitude, vz, accel_x/y/z, roll, pitch, yaw, lat, lon, gps_alt, sats`). Rolü olmayan alan yalnızca kaydedilir ve ham veri listesinde görünür.

Varsayılan şablon `akana_v1` (eski KTR çerçevesi `0xAA 0x55` + uzunluk + sıra + veri + CRC-16 üzerine; alan sırası tahmindir, aviyonik netleşince değişecek):

Roket yükü (63 bayt): `seq u16, t_ms u32, phase u8, flags u8, baro_alt f32, kalman_alt f32, vz f32, ax f32, ay f32, az f32, roll f32, pitch f32, yaw f32, lat i32 ×1e-7, lon i32 ×1e-7, gps_alt f32, sats u8, pressure f32, temp i16 ×0.01`.
Faz enum: `0 RAMPA, 1 MOTOR, 2 SUZULME, 3 APOGEE, 4 DROGUE, 5 MAIN, 6 YERDE`.
Görev yükü (34 bayt): `seq u16, t_ms u32, flags u8, baro_alt f32, lat i32 ×1e-7, lon i32 ×1e-7, gps_alt f32, sats u8, pressure f32, temp i16 ×0.01, vz f32`.

Not: roket çerçevesi 68 bayt; 4.8 kbps'de ham iletim ≈113 ms, 5 Hz'de kanal doluluğu ≈%57. İki verici aynı kanalı paylaşamaz: kaynak başına ayrı kanal ve ayrı alıcı.

### 7.2 Sağlık

2 s kayan pencere. Durum: **yeşil** yaş < 1,0 s ve hız ≥ 4,5 Hz; **sarı** yaş < 3,0 s; **kırmızı** diğer. Kayıp: `(seq − önceki − 1) mod 65536`; fark > 1000 ise verici yeniden başlamış sayılır, kayba eklenmez.

### 7.3 Anten yönü

İstasyon konumu yapılandırmada (enlem, boylam, rakım). WGS-84 ECEF → ENU; azimut 0–360° (kuzey 0, saat yönü), elevasyon, eğik mesafe. Hedef: kaynağın son geçerli GPS konumu (`sats ≥ 4` ve enlem/boylam ≠ 0); GPS yoksa son geçerli değer ve yaşı gösterilir.

### 7.4 Kayıt

Oturum klasörü `kayitlar/YYYYAAGG_SSddss/`. Kaynak başına `<ad>.bin` (kayıt: `<d` unix zamanı, `<I` uzunluk, baytlar; her yazmada flush, saniyede bir fsync) ve `<ad>.csv` (`t_unix` + tüm alanlar). `oturum.yaml`: kullanılan yapılandırma ve şemaların kopyası.

### 7.5 Simülatör

Analitik profil, `apogee_m = 6096`. Yanma 4 s sabit ivme; süzülme sürtünmesiz balistik. Yanma sonu hızı `v_b` şu denklemin pozitif kökü: `v_b·t_b/2 + v_b²/(2g) = apogee_m` → v_b ≈ 326,8 m/s, yanma sonu irtifası ≈ 654 m, apogee T+37,3 s. Apogee'de görev yükü ayrılır. Drogue 25 m/s, 500 m'de main 6 m/s, görev yükü 13 m/s, doğuya 5 m/s rüzgâr sürüklenmesi. T−10 s rampada başlar. Seçenekli Gauss gürültüsü, paket kaybı ve CRC bozma oranı (tohumlu).

### 7.6 Çekirdek → arayüz protokolü

TCP, UTF-8, satır başına bir JSON nesnesi. Bağlanınca `session`, sonra akış:
- `{"type":"session","sources":[{"name","label","color","roles"}],"station":{"lat","lon","alt"},"ceiling_m":6096,"log_dir"}`
- `{"type":"telemetry","source","t","fields":{...}}`
- `{"type":"health","t","sources":{"<ad>":{"status","rate_hz","crc_error_pct","lost","age_s","rssi_dbm","log_error"}}}` (2 Hz)
- `{"type":"look","source","t","az_deg","el_deg","slant_m","gps_age_s"}`
- `{"type":"event","source","phase","name","t","alt"}` (bir faz ilk kez görüldüğünde)
- `{"type":"hyi","t","status":"kapali|format_tanimsiz|gonderiyor|hata","detail"}`

Yavaş istemci (kuyruk > 500 mesaj) bağlantısı kesilir; çekirdek beklemez. Yeni bağlanan istemciye `session`'dan hemen sonra kaynak başına `{"type":"snapshot","source","track":[[t,lat,lon,alt],...],"events":[{"phase","t","alt"}],"last":{...}}` gönderilir (iz en fazla 2000 nokta, eşit aralıklı seyreltilmiş); arayüz yeniden açılınca iz kaybolmaz.

### 7.7 HYİ

`HyiForwarder(writer, encoder, rate_hz)`. `encoder` tanımsızsa durum `format_tanimsiz`, porta hiçbir şey yazılmaz. Format şartnameden alınınca `hyi_formats/` altına bir encoder eklenir.

## 8. Arayüz (uçuş sahnesi)

Kutulu panel yok; tek koyu (gece) ya da açık yüksek kontrast (gündüz) zemin üzerinde katmanlar, ayrım boşluk ve tipografiyle. Tek vurgu rengi (altın) yalnızca "şu an" için.

1. **Nabız çizgileri** (üst sol): kaynak başına son 10 s; her paket bir çentik, CRC hatası kırmızı çentik, 1 s'yi aşan boşluk kırmızı çizgi. Yanında hız, RSSI, kayıp.
2. **Uçuş sahnesi** (merkez): yatay eksen rampadan yatay menzil (m), dikey 0–6.096 m (20.000 ft) sabit ölçek; tavan kesikli çizgi. Roketin ve görev yükünün izi; olaylar (yanma sonu, apogee/ayrılma, main) yörünge üzerinde etiketli işaret; gelmemiş olaylar soluk.
3. **İrtifa şeridi** (sol kenar): dikey ölçek, irtifa okuyucu roketle hareket eder; m birincil, ft ikincil; maksimum irtifa.
4. **Dikey hız iğnesi**: ±300 m/s yay.
5. **Gökyüzü kubbesi** (sağ): kutupsal; merkez elevasyon 90°, kenar 0°, kuzey üstte. `r = R·(90 − el)/90`, `x = r·sin(az)`, `y = −r·cos(az)`. Roket ve görev yükü izleri; altında 64 pt azimut ve elevasyon, eğik mesafe. "Anten penceresi" düğmesi aynı kubbeyi tam ekran ayrı pencerede açar (5 m'den okunur: rakam yüksekliği ≥ ekran yüksekliğinin %15'i).
6. **Harita**: kubbe ile yer değiştiren üstten görünüm (tek tuş). Karolar `harita/{z}/{x}/{y}.png` yerel klasörden; yoksa ızgara üzerinde yalnızca izler. İniş fazında "haritaya geç" önerisi belirir, ekran kendiliğinden değişmez.
7. **Zaman şeridi** (alt): T0'dan itibaren faz bölümleri, ince ivme ve açı şeritleri. Sürüklenince yalnızca görünüm geçmişteki o ana gider (çekirdeğe komut gitmez); "canlıya dön" ile geri gelinir.
8. **Üst sağ**: T+ sayacı (ilk `MOTOR` fazı paketinden), kayıt durumu, HYİ durumu, gece/gündüz.
9. **Ham veri çekmecesi**: kısayol ile açılan, seçili kaynağın son paketinin tüm alanları.

## 9. Kurucuya kalanlar

Renk değerleri, yazı tipleri, animasyon süreleri, QML bileşen iç yapısı, çizim tekniği (Shape / Canvas), hata mesajı metinleri.

## 10. Açık noktalar (benim varsayımlarım, onayla)

- `akana_v1` alan sırası tahmin; gerçek struct gelince şema güncellenecek.
- İstasyon konumu elle girilir (GPS'li yer istasyonu yok).
- Birincil birim metre, ft ikincil.
- HYİ formatı şartname gelene kadar tanımsız.
