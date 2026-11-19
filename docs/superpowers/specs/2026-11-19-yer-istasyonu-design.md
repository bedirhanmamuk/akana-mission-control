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
- H10. Ekranda görünmesi zorunlu veriler (Baran): roket **irtifa, basınç, pitch, yaw** (roll da gösterilir); **görev yükü konumu ve basınç, sıcaklık, nem**; **9 zorunlu faz**; **roketin 3D görünümü**; **canlı grafikler**; **harita**.
- H11. Alttan açılan **seri panel**: (a) gelen veri akışı (çözülmüş / hex), (b) port seçimi ve bağlan/kes, (c) HYİ'ye giden paketler. Grafikler panel açıkken de görünür kalır.

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

Ana ekran yerleşimi: **A (tek ekran kokpit)**, Baran'ın isteğiyle **klasik kutulu panel düzeninden çıkılmış** sürüm. Görsel taslak: `.superpowers/yer-istasyonu/layout-v3.html` (v2 önceki sürüm).

Qt Widgets yerine **Qt Quick (QML)** (benim kararım): kutusuz, katmanlı, animasyonlu sahne QML'de doğal; mantık Python'da kalır ve test edilir, QML yalnızca görünüm.

## 7. Mimari

```
SerialSource/SimSource/ReplaySource ─► okuyucu iş parçacığı (kaynak başına)
      │ ham bayt + t
      ├─► RawLogWriter (.bin)
      └─► Framer(şema) ─► decode ─► FlightState, LinkHealth, CsvLogWriter
                                      │
                         BusServer (TCP, satır başına JSON, çift yönlü) ◄─► yi-ui (1..n)
                         HyiForwarder ─► HYİ seri portu
```

### 7.1 Paket şeması (YAML)

Her kaynak bir şema dosyası kullanır. Alanlar: `sync` (bayt listesi), `length_byte` (bool; değeri yük boyutu), `endian` (`little`/`big`), `crc` (`crc16_ccitt_false` | `crc16_modbus` | `none`), CRC kapsamı uzunluk baytı + yük, CRC bayt sırası `endian` ile aynı, `rssi_byte` (E22 "RSSI ekle" açıkken çerçeveden sonra 1 bayt; dBm = −(256 − değer)), `fields` (ad, tip `u8|i8|u16|i16|u32|i32|f32`, `scale`, `unit`, opsiyonel `enum`), `roles` (arayüzün kullandığı anlamlar → alan adı: `seq, t_ms, phase, altitude, vz, accel_x/y/z, roll, pitch, yaw, lat, lon, gps_alt, sats, pressure, temperature, humidity`), opsiyonel `flags_bits` (bit no → ad; arayüzde durum etiketi olarak gösterilir). Rolü olmayan alan yalnızca kaydedilir ve ham veri listesinde görünür.

Varsayılan şablon `akana_v1` (eski KTR çerçevesi `0xAA 0x55` + uzunluk + sıra + veri + CRC-16 üzerine; alan sırası tahmindir, aviyonik netleşince değişecek):

Roket yükü (63 bayt): `seq u16, t_ms u32, phase u8, flags u8, baro_alt f32, kalman_alt f32, vz f32, ax f32, ay f32, az f32, roll f32, pitch f32, yaw f32, lat i32 ×1e-7, lon i32 ×1e-7, gps_alt f32, sats u8, pressure f32, temp i16 ×0.01`.
Faz enum (**9 zorunlu faz**, Baran; eski arayüzle aynı): `0 RAMPA, 1 KALKIS, 2 APOGEE_YAKLASMA, 3 APOGEE, 4 DROGUE_ACILIS, 5 PAYLOAD_ACILIS, 6 MAIN_ACILIS, 7 FINIS, 8 GUVENLI_MOD`. Görünen adlar: Rampa, Kalkış, Apogee yaklaşma, Apogee, Drogue açılış, Payload açılış, Main açılış, Finiş, Güvenli mod. Fazı uçuş bilgisayarı belirler, yer istasyonu türetmez. `GUVENLI_MOD` sıralı değildir; herhangi bir anda gelebilir.
Görev yükü (36 bayt): `seq u16, t_ms u32, flags u8, baro_alt f32, lat i32 ×1e-7, lon i32 ×1e-7, gps_alt f32, sats u8, pressure f32, temp i16 ×0.01, humidity u16 ×0.01 (%), vz f32`.
Yönelim yapılandırması (istasyon YAML'ı, kaynak başına): `attitude: {order: ZYX, pitch_reference: vertical}`. `order` Euler dönüş sırası (`ZYX` = yaw→pitch→roll, havacılık), `pitch_reference` 0° pitch'in rokette dik mi (`vertical`) yatay mı (`horizontal`) olduğunu söyler. Aviyonik netleşince ayarlanır.

Not: roket çerçevesi 68 bayt; 4.8 kbps'de ham iletim ≈113 ms, 5 Hz'de kanal doluluğu ≈%57. İki verici aynı kanalı paylaşamaz: kaynak başına ayrı kanal ve ayrı alıcı.

### 7.2 Sağlık

2 s kayan pencere. Durum: **yeşil** yaş < 1,0 s ve hız ≥ 4,5 Hz; **sarı** yaş < 3,0 s; **kırmızı** diğer. Kayıp: `(seq − önceki − 1) mod 65536`; fark > 1000 ise verici yeniden başlamış sayılır, kayba eklenmez.

### 7.3 Anten yönü

İstasyon konumu yapılandırmada (enlem, boylam, rakım). WGS-84 ECEF → ENU; azimut 0–360° (kuzey 0, saat yönü), elevasyon, eğik mesafe. Hedef: kaynağın son geçerli GPS konumu (`sats ≥ 4` ve enlem/boylam ≠ 0); GPS yoksa son geçerli değer ve yaşı gösterilir.

### 7.4 Kayıt

Oturum klasörü `kayitlar/YYYYAAGG_SSddss/`. Kaynak başına `<ad>.bin` (kayıt: `<d` unix zamanı, `<I` uzunluk, baytlar; her yazmada flush, saniyede bir fsync) ve `<ad>.csv` (`t_unix` + tüm alanlar). `oturum.yaml`: kullanılan yapılandırma ve şemaların kopyası.

### 7.5 Simülatör

Analitik profil, `apogee_m = 6096`. Yanma 4 s sabit ivme; süzülme sürtünmesiz balistik. Yanma sonu hızı `v_b` şu denklemin pozitif kökü: `v_b·t_b/2 + v_b²/(2g) = apogee_m` → v_b ≈ 326,8 m/s, yanma sonu irtifası ≈ 654 m, apogee T+37,3 s. Fazlar: T<0 Rampa; kalkıştan `vz < 50 m/s` olana kadar Kalkış; sonra Apogee yaklaşma; apogee anından itibaren 1 s Apogee; +1 s Drogue açılış; +2 s Payload açılış (görev yükü ayrılır); 500 m'nin altında Main açılış; yerde Finiş. Güvenli mod yalnızca `--sim-safe-at T` verilirse o anda. Drogue 25 m/s, 500 m'de main 6 m/s, görev yükü 13 m/s, doğuya 5 m/s rüzgâr sürüklenmesi. T−10 s rampada başlar. Seçenekli Gauss gürültüsü, paket kaybı ve CRC bozma oranı (tohumlu).

### 7.6 Çekirdek → arayüz protokolü

TCP, UTF-8, satır başına bir JSON nesnesi. Bağlanınca `session`, sonra akış:
- `{"type":"session","sources":[{"name","label","color","roles"}],"station":{"lat","lon","alt"},"ceiling_m":6096,"log_dir"}`
- `{"type":"telemetry","source","t","fields":{...}}`
- `{"type":"health","t","sources":{"<ad>":{"status","rate_hz","crc_error_pct","lost","age_s","rssi_dbm","log_error"}}}` (2 Hz)
- `{"type":"look","source","t","az_deg","el_deg","slant_m","gps_age_s"}`
- `{"type":"event","source","phase","name","t","alt"}` (bir faz ilk kez görüldüğünde)
- `{"type":"hyi","t","status":"kapali|format_tanimsiz|gonderiyor|hata","detail"}`
- `{"type":"raw","source","t","hex","ok","seq"}`: her çerçeve sonucu (seri panel "Gelen veri" sekmesi; `ok=false` CRC hatası)
- `{"type":"hyi_tx","t","hex"}`: HYİ'ye yazılan her paket
- `{"type":"ports","t","available":[{"device","description"}],"sources":{"<ad>":{"port","baud","connected","error"}},"hyi":{"port","baud","connected","error"}}`: bağlanınca, komut sonrası ve 2 s'de bir

Arayüz → çekirdek komutları (aynı bağlantı, satır başına JSON):
- `{"cmd":"list_ports"}` → `ports` yanıtı
- `{"cmd":"set_port","target":"<kaynak adı>|hyi","port":"COM7","baud":9600}` → port kapatılıp yenisi açılır; ham kayıt aynı dosyaya devam eder
- `{"cmd":"disconnect","target":"<kaynak adı>|hyi"}`
Komutlar arayüzde onay ister: faz `RAMPA` veya `FINIS` dışındaysa "Uçuş sürüyor, port değiştirmek veri kaybına yol açabilir" uyarısı gösterilir. Port değişikliği `oturum.yaml`'a not düşülür.

Yavaş istemci (kuyruk > 500 mesaj) bağlantısı kesilir; çekirdek beklemez. Yeni bağlanan istemciye `session`'dan hemen sonra kaynak başına `{"type":"snapshot","source","track":[[t,lat,lon,alt],...],"events":[{"phase","t","alt"}],"last":{...}}` gönderilir (iz en fazla 2000 nokta, eşit aralıklı seyreltilmiş); arayüz yeniden açılınca iz kaybolmaz.

### 7.7 HYİ

`HyiForwarder(writer, encoder, rate_hz, on_sent)`. Her gönderimde `on_sent(bytes)` çağrılır (`hyi_tx` yayını). `encoder` tanımsızsa durum `format_tanimsiz`, porta hiçbir şey yazılmaz. Format şartnameden alınınca `hyi_formats/` altına bir encoder eklenir.

## 8. Arayüz (uçuş sahnesi)

Kutulu panel yok; tek koyu (gece) ya da açık yüksek kontrast (gündüz) zemin üzerinde katmanlar, ayrım boşluk ve tipografiyle. Tek vurgu rengi (altın) yalnızca "şu an" için. Yerleşim `layout-v3.html`:

1. **Üst şerit**: marka; **nabız çizgileri** (kaynak başına son 10 s; her paket bir çentik, CRC hatası kırmızı çentik, 1 s'yi aşan boşluk kırmızı çizgi; yanında port, hız, RSSI, kayıp); sağda T+ sayacı (ilk `KALKIS` paketinden), kayıt, HYİ durumu, gece/gündüz.
2. **9 faz yolu** (ekran genişliğinde): 8 sıralı faz düğümü; geçilenler dolu, şu anki altın ve parlak, gelecekler boş halka. **Güvenli mod** yolun dışında ayrı rozet; aktifse rozet ve ekran kenarı kırmızı yanar, faz yolu son sıralı fazda kalır.
3. **Sol sütun**: irtifa şeridi (0–6.096 m / 20.000 ft; okuyucu m birincil, ft ikincil, max) ve büyük rakamlarla **basınç (hPa), pitch, yaw, roll**, dikey hız.
4. **Merkez üst — uçuş sahnesi**: yatay eksen rampadan yatay menzil (m), dikey 0–6.096 m sabit ölçek; tavan kesikli çizgi. Roket ve görev yükü izleri; faz olayları yörünge üzerinde etiketli; gelmemiş olaylar (ör. main 500 m) soluk.
5. **Merkez alt — canlı grafikler** (her zaman görünür, son 60 s): roket irtifa (ham + filtreli), roket basınç, açılar (pitch/yaw/roll), görev yükü sıcaklık/nem/basınç. Sürüklenince görünüm geçmişe gider (çekirdeğe komut gitmez), `Esc` canlıya döner.
6. **Sağ üst — 3D roket**: Qt Quick 3D; basit parametrik model (gövde, burun, kanatçıklar, renk bandı), §7.1 yönelim yapılandırmasına göre döner; ufuk halkası ve dikey referans; altında P/Y/R. Dönüşüm Python'da kuaterniyona çevrilir.
7. **Sağ orta — harita / anten kubbesi** (`H` ile yer değiştirir): harita karoları `harita/{z}/{x}/{y}.png` yerel klasörden (yoksa ızgara); rampa, istasyon, roket ve görev yükü izleri; anten açıları satırı. Kubbe: kutupsal, merkez el 90°, kenar 0°, kuzey üstte, `r = R·(90 − el)/90`, `x = r·sin(az)`, `y = −r·cos(az)`. İniş fazında "haritaya geç" önerisi; ekran kendiliğinden değişmez. **Anten penceresi** (`A`): kubbe ve dev rakamlar tam ekran, rakam yüksekliği ≥ pencere yüksekliğinin %15'i.
8. **Sağ alt — görev yükü kartı**: durum (bekliyor / ayrıldı T+…), enlem, boylam, rampadan sapma (doğu/kuzey m), **basınç, sıcaklık, nem** büyük rakamla; `flags_bits` etiketleri.
9. **Alttan açılan seri panel** (`S` veya tutamaç; açıkken merkez ve sol sütun yukarı sıkışır, hiçbir bölge gizlenmez). Sekmeler:
   - *Gelen veri*: kaynak seçimi; satır başına zaman, kaynak, sıra, faz ve rol değerleri (çözülmüş) ya da hex + CRC + RSSI; CRC hataları kırmızı; duraklat, temizle; son 2000 satır.
   - *Portlar*: kaynak başına port ve baud seçimi, bağlan / kes, durum ve hata; HYİ portu da burada.
   - *HYİ'ye giden*: gönderilen paketler hex, gönderim sayacı, format durumu.

## 9. Kurucuya kalanlar

Renk değerleri, yazı tipleri, animasyon süreleri, QML bileşen iç yapısı, çizim tekniği (Shape / Canvas), hata mesajı metinleri.

## 10. Açık noktalar (benim varsayımlarım, onayla)

- `akana_v1` alan sırası tahmin; gerçek struct gelince şema güncellenecek.
- İstasyon konumu elle girilir (GPS'li yer istasyonu yok).
- Birincil birim metre, ft ikincil.
- HYİ formatı şartname gelene kadar tanımsız.
