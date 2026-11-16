# AKANA Mission Control — tasarım sistemi

Bu dosya arayüzün görsel kararlarını kaydeder. Yeni ekran veya bileşen eklerken buradaki kurallara uyun; renk, yazı tipi ve hareket değerleri `src/index.css` içindeki `@theme` bloğunda tanımlıdır.

## Yön

**Uçuş kontrol konsolu.** Kullanıcı bir iş yapmaya gelir: görevini bulur, raporunu yükler, incelemeyi sonuçlandırır. Ekran önce çalışan bir araçtır; kimlik dört yerden gelir: yazı tipi, renk, yoğunluk ve üç imza öğe. Düzen, gezinme ve denetimler herkesin bildiği standart kalıplardır.

## Renk

Palet logodan türetilir: derin mor zemin, menekşe ana renk ve logodaki macenta "şu an" vurgusu. İki tema vardır; varsayılan koyudur, açık tema Profil ekranından veya menüdeki güneş/ay düğmesinden seçilir ve cihazda hatırlanır.

| Rol | Token | Koyu | Açık | Kullanım |
|---|---|---|---|---|
| Zemin | `bg` | `#09070f` | `#f3f1fa` | Sayfa |
| Ray | `rail` | `#160c30` | `#160c30` | Sol menü: **her iki temada koyu** |
| Yüzey | `surface` | `#110e1c` | `#efecf8` | Form alanları, panel içi kutular |
| Panel | `card` | `#17132a` | `#ffffff` | İçerik panelleri |
| Yükseltilmiş | `raised` | `#201a3a` | `#ebe7f7` | İkincil düğme, üzerine gelme |
| Ana renk | `accent` | `#8452f0` | `#6a35e0` | Birincil düğme, etkin öğe, odak, grafik |
| Ana renk (metin) | `accent-2` | `#b89cff` | `#5b2bd0` | Bağlantı, görev kodu |
| Şu an | `hot` | `#e052f5` | `#b318cf` | Geçerli aşama işareti, okunmamış sayacı. Başka yerde kullanılmaz |
| Metin | `ink` / `muted` / `faint` | | | Ana, ikincil, üçüncül |
| Durum | `success` / `warning` / `danger` / `info` | | | Yalnızca anlam taşıdığında; her zaman bir etiketle |

- Alanlar birbirinden **çizgiyle değil tonla** ayrılır. Panel içine panel konmaz.
- Koda ham renk yazılmaz; token kullanılır. Üzerine gelme gibi katmanlar için `bg-ink/5` kullanılır (temayla birlikte döner); `bg-white/…` yalnızca her zaman koyu olan sol menüde kullanılır.
- Bir bölümün her temada koyu kalması gerekiyorsa `data-theme="dark"` verilir (sol menü, giriş ekranı).
- Kontrast: ana ve ikincil metin en az 4,5:1, soluk metin en az 3:1. Testler bunu iki temada da ölçer.

## Tipografi

| Rol | Yazı tipi | Not |
|---|---|---|
| Başlık ve rakam | Archivo (değişken; genişletilmiş) | `.display`, `.num` |
| Metin | IBM Plex Sans | 15 px gövde |
| Kod ve sayaç | IBM Plex Mono | Yalnızca görev kodu, sürüm, T- sayacı gibi veriler |

- Yazı tipleri projeye gömülüdür (`@fontsource`); dış sunucudan yüklenmez.
- Etiketler cümle düzenindedir. Aralıklı büyük harfli küçük etiket kullanılmaz (tek istisna: logodaki "AKANA / MISSION CONTROL" yazısı).
- Hizalanan rakamlarda `tabular-nums`.

## İmza öğeler

1. **Görev uçuş profili** (`FlightProfile`, `FlightTrack`): görevin aşaması bir yükseliş eğrisi üzerinde gösterilir. Aşama adları ürünün kendi durum adlarıdır.
2. **T- sayacı** (`TCountdown`): teslim tarihi `T-3` / `T+2` olarak gösterilir; 3 gün ve altında sarı, geçince kırmızı.
3. **Giriş sahnesi** (`OrbitScene`): yıldız alanı ve yörüngede dönen iki cisim.

Bunlar dışında "uzay" süslemesi eklenmez.

## Hareket

Hareket geri bildirim, durum ve süreklilik içindir; her bölüme aynı giriş animasyonu konmaz.

| Durum | Süre | Eğri |
|---|---|---|
| Düğmeye basma (`scale .97`) | 140 ms | `--ease-out` |
| Üzerine gelme, renk | 150 ms | `ease` |
| Sayfa geçişi | 220 ms | `--ease-out` |
| Pencere (masaüstü) / alt sayfa (mobil) | 220 / 340 ms | `--ease-out` / `--ease-drawer` |
| Liste girişi (ilk 8 öğe, 32 ms arayla) | 320 ms | `--ease-out` |
| Panel rakamlarının sayması, çubukların dolması | 650–700 ms | ease-out |
| Durum değişimi vurgusu (`animate-pop`) | 420 ms | `--ease-out` |

- `ease-in` kullanılmaz. Hiçbir şey `scale(0)`'dan başlamaz.
- Sürekli dönen tek animasyon geçerli aşamadaki işaret halkasıdır.
- `prefers-reduced-motion` açıkken konum ve ölçek hareketi kalkar; giriş sahnesi tek kare çizer.

## Bileşen kuralları

- **Düğmeler:** Birincil eylem mor ve ekranda tektir. İkincil eylemler `btn-secondary`. Tehlikeli eylem kırmızı tonlu.
- **Rozetler:** Dolu ton, kenarlıksız. Durum rengi + metin birlikte.
- **Tablolar:** Masaüstünde tablo, mobilde kart listesi. Başlık satırı soluk ve cümle düzeninde.
- **Boş, yükleniyor, hata, yetkisiz:** Her veri alanının dördü de vardır (`ui.tsx`).
- **Dokunma hedefi:** En az 40 px yükseklik.
- **Pencereler:** `Modal` her zaman `<body>` altına çizilir (portal). Masaüstünde ortada, telefonda alttan açılan sayfa; düğmeler telefonda tam genişlik ve birincil eylem üstte.
- **Mobil gezinme:** Altta beş öğeli çubuk (Genel, Görevler, Rapor yükle, Arşiv, Bildirim); tam menü üstteki düğmeden açılır.
