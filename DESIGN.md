# AKANA Mission Control — tasarım sistemi

Bu dosya arayüzün görsel kararlarını kaydeder. Yeni ekran veya bileşen eklerken buradaki kurallara uyun; renk, yazı tipi ve hareket değerleri `src/index.css` içindeki `@theme` bloğunda tanımlıdır.

## Yön

**Görev kontrol merkezi.** Kullanıcı bir iş yapmaya gelir: kritik durumu görür, görevini bulur, raporunu yükler, onayı sonuçlandırır. Ekran önce çalışan bir araçtır; kimlik dört yerden gelir: yazı tipi, renk, yoğunluk ve üç imza öğe. Düzen, gezinme ve denetimler herkesin bildiği standart kalıplardır.

## Renk

Palet ürünün kimliğinden gelir: gece mavisi / antrasit zemin, **kontrollü altın-amber** vurgu. Altın yalnızca birincil eylem, seçili durum ve "şu an" için kullanılır; büyük yüzeylere sürülmez. İki tema vardır; varsayılan koyudur.

| Rol | Token | Koyu | Açık | Kullanım |
|---|---|---|---|---|
| Zemin | `bg` | `#0a0f1a` | `#f1f3f7` | Sayfa |
| Ray | `rail` | `#0b1220` | `#0b1220` | Sol menü: **her iki temada koyu** |
| Yüzey | `surface` | `#0e1524` | `#eaedf3` | Form alanları, panel içi kutular |
| Panel | `card` | `#131b2c` | `#ffffff` | İçerik panelleri |
| Yükseltilmiş | `raised` | `#1a2438` | `#e6eaf1` | İkincil düğme, üzerine gelme |
| Ana renk | `accent` | `#d9a441` | `#c8922a` | Birincil düğme zemini, etkin öğe, grafik |
| Ana renk üstü metin | `on-accent` | `#161004` | `#161004` | Altın zemindeki metin (beyaz değil: altın + beyaz 2,3:1'de kalır) |
| Ana renk (metin) | `accent-2` | `#e8bd66` | `#875a00` | Bağlantı, görev kodu |
| Şu an | `hot` | `#ffc857` | `#b86e00` | Geçerli aşama işareti |
| Durum | `success` yeşil / `warning` turuncu / `danger` kırmızı / `info` mavi | | | Yalnızca anlam taşıdığında; her zaman bir etiketle |

- Kontrast (hesaplanmış): koyu temada ana metin 15,2:1, ikincil 7,0:1, soluk 4,45:1, altın düğme 8,4:1; açık temada ana metin 17,4:1, ikincil 7,2:1, altın düğme 6,9:1. E2E testleri bunları iki temada da ölçer.
- Alanlar birbirinden **çizgiyle değil tonla** ayrılır. Panel içine panel konmaz.
- Koda ham renk yazılmaz; token kullanılır. Grafik serileri de token kullanır (`var(--color-success)` vb.).

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
3. **Giriş sahnesi** (`LaunchBackdrop`): takımın atış videosu sessiz ve döngüde, koyu mor katmanın altında oynar; dik ekranda dikey kurgu kullanılır. Açılışta logo yükselip yerine oturur; başarılı girişte logo yukarı fırlar ve video hızlanır (yaklaşık 1 sn), hatalı girişte form sarsılır. "Hareketi azalt" veya veri tasarrufu açıkken ya da video oynatılamazsa yıldızlı sahne (`OrbitScene`) gösterilir.

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
- **Mobil gezinme:** Altta beş öğeli çubuk (Genel, Görevler, Rapor yükle, Arşiv, Bildirim); tam menü üstteki düğmeden açılır, arama üst çubuktaki büyüteçtedir.
- **Menü:** Operasyon / Mühendislik / Organizasyon / Hesap / Yönetim gruplarıdır. Grup başlıkları bilgi taşır (rol ve iş alanı); etkin öğe soldaki altın çizgiyle işaretlenir.
- **Yükleniyor:** Spinner yerine içerik yerleşimini taklit eden iskelet (`.skeleton`). Yenilemeler sessizdir (`useAsync().refresh`); ekrandaki veri silinip yeniden çizilmez.
- **Geniş içerik (Kanban, Gantt, tablolar):** sayfa asla yatay taşmaz; içerik kendi kabında kayar (`.scroll-x`). Gantt'ta görev sütunu sabit kalır.
- **Aynı ekranda aynı adlı iki eylem olmaz** (ör. pencerede "Kaydet", sayfada "İlerlemeyi güncelle").
