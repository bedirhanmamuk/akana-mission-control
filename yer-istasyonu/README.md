# AKANA Yer İstasyonu

TEKNOFEST 2026 A3 Yüksek İrtifa roketi için yer istasyonu: üç E22 alıcısından (Ana UKB, Yedek UKB,
görev yükü) gelen telemetriyi çözümler, ham hâliyle kaydeder ve arayüze WebSocket ile yayınlar.

```
E22 alıcıları ─USB/UART─▶ yi_core (Python)
                            ├─ çerçeve çözümleyici (senkron, CRC-16, bloklar)
                            ├─ kayıt: ham bayt + çözümlenmiş CSV + denetim kaydı + SHA-256
                            ├─ kayıt oynatma (hız, duraklatma, başa sarma)
                            └─ FastAPI: /api/*  +  /ws  ──▶ arayüz (ui/: görev ekranı, Analiz, Open MCT çalışma alanı)
```

Mimari, CU InSpace'in [ground-station](https://github.com/CarletonURocketry/ground-station) projesinden
(MIT) esinlendi: alıcı havuzu, blok tabanlı paket yapısı, ham+çözümlenmiş kayıt, oynatma ve WebSocket yayını.
Kod bu proje için yeniden yazıldı. Bilinçli farklar aşağıda.

## Kurulum

```bash
python -m venv .venv
```

```bash
.venv/bin/pip install -r requirements.txt        # Windows: .venv\Scripts\pip install -r requirements.txt
```

Arayüzün Open MCT dosyaları (bir kez, internet gerekir):

```bash
cd ui && npm install && npm run kur
```

Sahada internet yoktur; arayüzün tüm dosyaları (Open MCT, three.js, harita karoları) `ui/` altında yereldir.

## Çalıştırma

```bash
.venv/bin/python -m yi_core --open                                   # sunucu simülasyonu
```

```bash
.venv/bin/python -m yi_core --list-ports                             # alıcı portlarını gör
```

```bash
.venv/bin/python -m yi_core --port main=COM5 --port backup=COM6 --port payload=COM7 --baud 9600 --app
```

```bash
.venv/bin/python -m yi_core --replay 20261120_101500_serial --speed 2 --open
```

- `--app`: masaüstü penceresi (`pip install pywebview`; Windows'ta Edge WebView2 kullanır). Kurulu değilse tarayıcı açılır.
- Kaynak, arayüzdeki **Kaynak** listesinden ve **Bağlan** düğmesinden de değiştirilebilir (portlar seçilerek).
- Sunucu varsayılan olarak yalnızca `127.0.0.1` adresini dinler. Hakem ekranını ikinci bir bilgisayardan açmak
  gerekirse `--host 0.0.0.0` kullanın; sunucuda kimlik doğrulama yoktur, yalnızca kapalı ağda yapın.

Donanımsız seri yol testi (Linux/macOS):

```bash
.venv/bin/python tools/sahte_alici.py main backup payload           # sanal portları yazar
```

## Arayüzdeki modlar

| Bant | Anlamı |
|---|---|
| SİMÜLASYON MODU (mor) | Veri simülatörden. Gerçek uçuş değildir. |
| CANLI VERİ (yeşil) | Seri port açık **ve** son 2 s içinde en az bir alıcıdan geçerli paket var. Hangi alıcının veri verdiği bantta ✓/✗ ile yazar. |
| ALICILAR AÇIK · VERİ YOK (sarı) | Portlar açık, paket gelmiyor. |
| SERVİS BAĞLANTISI YOK (kırmızı) | Arayüz yi_core'a ulaşamıyor; son değerler yaşlarıyla kalır, sıfırlanmaz; 2 s'de bir yeniden bağlanır. |
| KAYIT OYNATMA (mavi) | Bir kayıt oynatılıyor; bantta duraklat / başa sar / hız. |

Sunucu olmadan açılan sayfa (ör. dosyadan) kendi dahili simülasyonuyla çalışır.

## Paket protokolü (sürüm 1)

```
AA 55 | LEN | VER=1 | SRC | SEQ(u16) | T_MS(u32) | NB | blok_1 … blok_NB | CRC16(u16) [| RSSI(u8)]
```

Little-endian. CRC-16/CCITT-FALSE (0x1021, başlangıç 0xFFFF), VER'den son bloğa kadar. SRC: 1 Ana, 2 Yedek, 3 Görev yükü.
RSSI baytı, E22'de "paket sonuna RSSI ekle" açıksa vardır (`--no-rssi-byte` ile kapatılır). LEN > 128 sahte senkron sayılır.

| Kod | Blok | Yapı | Birim (ham → fiziksel) |
|---|---|---|---|
| 0x01 | baro | i32 irtifa, u32 basınç, i16 sıcaklık | cm → m, Pa → hPa, 0,01 °C |
| 0x02 | acc | 3× i16 | mg → g |
| 0x03 | att | i16 pitch, u16 yaw, i16 roll | 0,01° (NED, gövde X burun; pitch yataydan) |
| 0x04 | gnss | i32 enlem, i32 boylam, i32 yükseklik, u8 uydu, u16 yatay hız | 1e-7°, cm (MSL), cm/s |
| 0x05 | vz | i16 | cm/s |
| 0x06 | hum | u16 | 0,01 % |
| 0x07 | state | u8 faz (0–7), u8 bayrak (bit0: görev yükü ayrıldı) | — |
| 0x08 | power | u16 | mV |
| 0x09 | alt | i32 (Kalman irtifası) | cm |

Aviyonik kartların sensör seti kesinleşmedi; yeni sensör yeni blok kodu demektir, çerçeve değişmez.
Uçuş yazılımı tarafı aynı tabloyu C struct'ı olarak kullanmalı (`tests/test_protocol.py` referans vektörleri içerir).

### Bağlantı bütçesi (kanal başına, 5 Hz → paket aralığı 200 ms)

| Kaynak | Çerçeve | Nominal 4,8 kbps | LoRa SF7/BW250 | LoRa SF8/BW250 | LoRa SF9/BW125 |
|---|---|---|---|---|---|
| Ana UKB | 57 B | 95 ms | 54 ms | 98 ms | 349 ms |
| Yedek UKB | 58 B | 97 ms | 56 ms | 98 ms | 370 ms |
| Görev yükü | 53 B | 88 ms | 51 ms | 92 ms | 329 ms |

Sonuç: 4,8 kbps hava hızında paket başına ~95 ms, yani kanal %50 dolu. Bu sınırda, rahat değil.
E22'nin "4,8k" ayarının hangi SF/BW'ye karşılık geldiği modül belgesinden ve **menzil testinde ölçülerek**
doğrulanmalı. SF9/BW125'e denk düşüyorsa 5 Hz fiziksel olarak mümkün değil; görev yükü için 5 Hz şartnamede
zorunlu. Önlemler: 9,6 kbps'ye çıkmak (menzil kaybını Yagi kazancıyla karşılamak) ya da çerçeveyi 40 B altına
indirmek (ör. GNSS'i her pakette değil 1 Hz göndermek).

## Bilinçli tasarım kararları

- **Komut yolu yok.** Hiçbir kod seri porta yazmaz (`tests/test_server.py` bunu denetler). Yer istasyonu
  ateşleme/ayrılma gibi kritik işlevlere dokunamaz.
- **Gecikme eklenmez.** CU'nun zaman çizelgesi kuyruğu veriyi düzleştirmek için bekletir; burada paket
  gelir gelmez yayınlanır, sıra dışı paket arayüzde zaman damgasıyla yerleştirilir ve sayılır.
- **Kaynaklar birleştirilmez.** Ana, yedek ve görev yükü ayrı kanallardır; olaylar (apogee vb.) iki UKB'den
  doğrulanınca "doğrulandı" olur.
- **Cihaz saati → oturum saati** her kaynak için en düşük gecikme tahminiyle eşlenir (`ts`), alım anı (`rx`) ayrıca tutulur.
- **CRC hatalı çerçeve atılır ama sayılır**; sahte senkron durumunda tek bayt ilerlenir, gerçek çerçeve kaçırılmaz.
  Aynı bozuk bölge iki kez sayılmaz.
- **Kayıt kurcalanamaz değil, kurcalandığı anlaşılır**: ham dosyalar yalnız sona eklenir, kapanışta SHA-256 alınır
  (`GET /api/recordings/{ad}/verify`). Elektrik kesilirse kayıt bir sonraki açılışta "yarım kaldı" olarak işaretlenir,
  silinmez ve oynatılabilir.
- **Yeniden bağlanan arayüz geçmişi alır**: sunucu son ~60 000 paketi bellekte tutar.
- **Simülasyon kayıtları** klasör adında ve manifestte `sim` olarak işaretlenir; gerçek uçuş kaydıyla karışmaz.

## Testler

```bash
.venv/bin/python -m pytest -q
```

Kapsam: CRC referans vektörü, alan gidiş-dönüş, çerçeve boyutu sınırı, parçalı okuma + çöp bayt + senkron
kurtarma, çerçeve içine bayt girmesi, simülasyon akışında beklenen arızalar, sunucu: geçmiş + canlı akış,
kaydın oynatılınca birebir aynı paketleri vermesi, yol geçişi (path traversal) reddi, seri porta yazma
yasağı, yarım kalmış kaydın işaretlenmesi.

## Eksikler / sıradaki işler

- Uçuş yazılımı tarafında aynı protokolün C kodlayıcısı (bloklar, CRC) ve ortak test vektörleri.
- Menzil testi aracı: gerçek hava hızını, paket kaybını ve RSSI'yi mesafeye göre ölçen betik.
- Windows'ta donanımsız test için com0com ile sanal port çifti belgesi.
- Masaüstü paketi (PyInstaller ile tek dosya) ve sahada kurulum kontrol listesi.
