# AKANA Mission Control — tasarım sistemi

Bu dosya arayüzün görsel kararlarını kaydeder. Yeni ekran veya bileşen eklerken buradaki kurallara uyun; renk, yazı tipi ve hareket değerleri `src/index.css` içindeki `@theme` bloğunda tanımlıdır.

## Yön

**Uçuş kontrol konsolu.** Kullanıcı bir iş yapmaya gelir: görevini bulur, raporunu yükler, incelemeyi sonuçlandırır. Ekran önce çalışan bir araçtır; kimlik dört yerden gelir: yazı tipi, renk, yoğunluk ve üç imza öğe. Düzen, gezinme ve denetimler herkesin bildiği standart kalıplardır.

## Renk

Tek tema, koyu. Zemin ve yüzeyler mora çalan tek bir ton merdivenidir:

| Rol | Token | Kullanım |
|---|---|---|
| Zemin | `bg` | Sayfa |
| Ray | `rail` | Sol menü (üstten mor ışık alır) |
| Yüzey | `surface` | Form alanları, panel içi kutular |
| Panel | `card` | İçerik panelleri |
| Yükseltilmiş | `raised` | İkincil düğme, açılır pencere, üzerine gelme |
| Mor | `accent`, `accent-2` | Yalnızca eylem ve "şu an": birincil düğme, etkin menü, geçerli aşama, odak |
| Metin | `ink`, `muted`, `faint` | Ana, ikincil, üçüncül |
| Durum | `success`, `warning`, `danger` | Yalnızca anlam taşıdığında; her zaman bir etiketle birlikte |

- Alanlar birbirinden **çizgiyle değil tonla** ayrılır. Panellerde kenarlık yoktur; form alanlarında ince bir iç çizgi vardır.
- Panel içine panel konmaz. İç içe yüzey gerekiyorsa bir ton farkı kullanılır.
- Koda ham renk yazılmaz; token kullanılır. Grafik renkleri `Dashboard.tsx` ve `constants.ts` içindeki durum renkleridir.

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
