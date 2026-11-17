# AKANA MISSION CONTROL

AKANA Roket Takımı için **mühendislik proje ve operasyon yönetim platformu**: kontrol merkezi, projeler, görevler (Kanban / tablo / liste, alt görev, departmanlar arası bağımlılık, yorum, ilerleme, bloke), Gantt zaman çizelgesi, takvim, doküman merkezi (STL/STEP dahil, sürüm + onay), rapor inceleme, risk matrisi, performans analitiği, ekip ve organizasyon şeması, bildirim tercihleri, global arama (Ctrl+K), denetim kaydı ve isteğe bağlı yapay zekâ özetleri.

*One Team. One Mission. Beyond the Limits.*

- **Frontend:** React 19 + TypeScript + Vite + Tailwind CSS 4, Lucide, Recharts
- **Backend:** Supabase (PostgreSQL + Auth + Storage + iki Edge Function)
- **Yetkilendirme:** tamamı veritabanında (Row Level Security + `SECURITY DEFINER` RPC'ler). Arayüzdeki rol kontrolleri yalnızca yönlendirme içindir.

> **GitHub Pages ile yayına almak için:** [GITHUB-KURULUM.md](GITHUB-KURULUM.md) — depo GitHub'a yüklendiğinde site ve Supabase kurulumu iş akışlarıyla otomatik yapılır.

---

## 1. Kurulum (Supabase projesi)

Gerekenler: Node.js ≥ 20, bir Supabase projesi, [Supabase CLI](https://supabase.com/docs/guides/cli).

### 1.1 Veritabanı, Storage ve Edge Function

```bash
npm install
npx supabase login
npx supabase link --project-ref <PROJE_REF>
npx supabase db push                        # supabase/migrations/*.sql
npx supabase functions deploy admin-users --no-verify-jwt
npx supabase functions deploy ai-insights --no-verify-jwt    # isteğe bağlı YZ modülü
npx supabase secrets set ANTHROPIC_API_KEY=...               # yalnızca YZ modülü kullanılacaksa
```

`ANTHROPIC_API_KEY` tanımlı değilse YZ modülü açıkça "yapılandırılmamış" (503) döner; kural tabanlı haftalık operasyon raporu anahtar olmadan da çalışır. YZ modülü veriyi **kullanıcının kendi oturumuyla** (RLS geçerli) okur, modele hiçbir yazma aracı verilmez; görev değiştiremez, silemez, onaylayamaz. Model `claude-opus-5-5`'tir (`AI_MODEL` sırrıyla değiştirilebilir); güvenlik sınıflandırıcısı reddederse sunucu taraflı yedek modele (`fallbacks: "default"`) geçer.

CLI kullanmak istemezseniz: `supabase/migrations/` altındaki 7 dosyayı **sırayla** Dashboard → SQL Editor'da çalıştırın; `admin-users` fonksiyonunu Dashboard → Edge Functions üzerinden oluşturup `supabase/functions/admin-users/index.ts` içeriğini yapıştırın ve "Verify JWT" seçeneğini kapatın (fonksiyon JWT'yi kendi içinde Auth sunucusuna doğrulatır ve ayrıca veritabanından ADMIN rolünü kontrol eder).

`SUPABASE_URL` ve `SUPABASE_SERVICE_ROLE_KEY` Edge Function ortamına Supabase tarafından otomatik verilir; elle bir anahtar girmeniz gerekmez.

### 1.2 Auth ayarları (Dashboard → Authentication)

- **Sign In / Providers → "Allow new users to sign up": KAPALI.** Hesapları yalnızca yönetici oluşturur.
  (Açık kalsa bile kendi kendine kayıt olan hesap `MEMBER` + **pasif** başlar ve hiçbir veriye erişemez; bu ikinci savunma hattıdır.)
- Email sağlayıcısı açık kalmalı. "Confirm email" ayarı fark etmez; yönetici oluşturduğu hesaplar onaylı gelir.

### 1.3 İlk yönetici hesabı (tek seferlik, güvenli kurulum)

1. Dashboard → Authentication → Users → **Add user** → e-posta + güçlü şifre, "Auto Confirm User" işaretli.
2. Dashboard → SQL Editor:

```sql
select private.bootstrap_first_admin('yonetici@ornek.com');
```

Bu fonksiyon API üzerinden çağrılamaz (yalnızca SQL Editor / `postgres` rolü) ve sistemde bir yönetici varken çalışmaz. Sonraki yöneticiler **Üye Yönetimi** ekranından atanır.

### 1.4 Frontend

```bash
cp .env.example .env
```

`.env` içine Project Settings → API'deki değerleri yazın:

```
VITE_SUPABASE_URL=https://<proje>.supabase.co
VITE_SUPABASE_ANON_KEY=<anon / publishable anahtar>
```

> **Service Role Key frontend'e asla yazılmaz.** Yalnızca Edge Function içinde, sunucuda kullanılır.

```bash
npm run dev      # http://127.0.0.1:5173
npm run build    # dist/ — herhangi bir statik barındırmaya (Vercel, Netlify, Cloudflare Pages) konabilir
```

Statik barındırmada tüm yolların `index.html`'e yönlendirilmesi (SPA fallback) gerekir; derleme bunun için `dist/404.html` üretir (GitHub Pages bunu kendiliğinden kullanır). Alt dizinde yayınlıyorsan `VITE_BASE_PATH=/<dizin>/ npm run build` kullan.

### 1.5 Teslim tarihi kontrolü (pg_cron)

"Teslim tarihi yaklaşıyor / görev gecikti" bildirimleri ve `Gecikmiş` durumu `process_deadlines()` ile üretilir. `0007` migration'ı `pg_cron` eklentisi varsa görevi her gün 05:00 UTC'de çalışacak şekilde **otomatik zamanlar**. Eklenti kurulamazsa migration bir uyarı yazar ve devam eder; o durumda elle zamanlayın:

```sql
select cron.schedule('akana-deadlines', '0 5 * * *', $$select public.process_deadlines()$$);
```

---

## 2. Mimari

```
src/
  lib/          supabase istemcisi, tipler, dosya doğrulama/yükleme, API yardımcıları
  context/      oturum (AuthContext), bildirim sayacı, toast
  components/   yerleşim (sol menü), ortak UI, yükleme formu, sürüm geçmişi
  pages/        üye sayfaları      pages/admin/  yönetici sayfaları
supabase/
  migrations/   0001 şema · 0002 fonksiyon/tetikleyici/RPC · 0003 RLS · 0004 Storage · 0005 başlangıç verisi
                0006 yeni enum değerleri · 0007 projeler, gelişmiş görevler, sorumlu yetkileri, doküman, takvim, risk, analitik, arama
  functions/    admin-users (üye oluşturma, e-posta değişimi, şifre sıfırlama) · ai-insights (isteğe bağlı YZ özeti)
local/          yerel Supabase test yığını (Docker)      tests/  güvenlik + uçtan uca testler
```

### Veritabanı

`profiles`, `departments`, `tasks`, `task_assignees`, `reports`, `report_versions`, `report_files`, `notifications`, `activity_logs`, `app_settings` + `directory` ve `report_overview` görünümleri.

- **Rapor modeli:** bir görev için bir üyenin tek `reports` kaydı vardır; her yükleme yeni bir `report_versions` satırı (V1, V2, …) ve ona bağlı `report_files` satırları üretir. Sürüm ve dosya kayıtları tetikleyiciyle **silinemez / değiştirilemez**; Storage'da üzerine yazma politikası yoktur.
- **Görev kodu:** `AK-<departman kodu>-<sıra>`; departman satırı kilitlenerek üretilir (eşzamanlı oluşturmada da benzersiz). Departmanlar tablodan gelir; kodda sabit departman adı yoktur.
- **Yazma işlemleri RPC ile:** `create_task`, `set_task_assignees`, `start_task`, `submit_report`, `review_report`, `set_max_file_size_mb`, `update_own_profile`. Kimlik her zaman `auth.uid()`'den alınır; istemcinin gönderdiği kullanıcı/rol/departman bilgisine güvenilmez.

### Yetki modeli

| Rol | Nasıl atanır | Yetki |
|---|---|---|
| Yönetici (`ADMIN`) — kaptan / kaptan yardımcısı | Üye Yönetimi → Rol | Her şey; proje oluşturma/silme, üye ve yetki yönetimi, denetim kaydı |
| Departman sorumlusu | Yönetim Paneli → departmanın sorumlusu (`departments.lead_id`) | **Yalnızca kendi departmanında:** görev oluşturma/düzenleme/atama/silme, rapor ve doküman onayı, takvime etkinlik, analitik. Kendi raporunu veya yüklediği doküman sürümünü onaylayamaz (sunucuda zorlanır). |
| Takım üyesi | — | Atandığı görevde ilerleme, bloke, rapor; doküman ve risk kaydı; yorum |

Takım pozisyonu (`team_position`: kaptan, yardımcı, sorumlu, üye) organizasyon şeması içindir; yetki vermez. Sorumlu atanınca pozisyon otomatik "Departman Sorumlusu" olur.

### Yeni modüllerin veri modeli (0006–0007)

- `projects` (+ `project_overview` görünümü: ilerleme = iptal edilmeyen görevlerin ilerleme ortalaması), `tasks.project_id / parent_id / progress / difficulty / blocked_reason`, `task_dependencies` (döngü tetikleyiciyle engellenir; ön koşulu bitmemiş görev "Tamamlandı" yapılamaz), `task_comments`.
- `documents` + `document_versions` (özel `documents` bucket'ı, `create_document` → yükleme → `add_document_version` sunucu doğrulaması → `review_document`), `events`, `risks` (`score` = olasılık × etki, üretilmiş sütun), `notification_preferences` (kapalı türde bildirim hiç oluşmaz), profil alanları ve özel `avatars` bucket'ı.
- Okuma RPC'leri: `mission_overview`, `analytics`, `weekly_report`, `activity_feed`, `task_history`, `task_dependency_info`, `global_search` — hepsi çağıranın yetkisine göre süzer.
- Görev durumlarına `BLOCKED` ve `CANCELLED` eklendi. Mevcut `OVERDUE` davranışı geriye dönük uyumluluk için korundu (ayrıntı: Bilinen sınırlar).

### Dosya yükleme akışı

1. İstemci uzantı, MIME, boyut ve dosya imzasını (magic bytes) kontrol eder, SHA-256 hesaplar.
2. Dosyalar kullanıcının kendi oturumuyla özel `reports` bucket'ına yüklenir (`<görev>/<kullanıcı>/<yükleme>/<dosya>`); ilerleme çubuğu gerçek `XMLHttpRequest` ilerlemesidir. Storage; bucket'ın MIME listesi, boyut sınırı ve RLS politikasıyla (yalnızca atandığı görev + kendi klasörü) yüklemeyi sınırlar.
3. `submit_report` RPC'si dosyaların gerçekten Storage'da olduğunu, yolun çağırana ait olduğunu, uzantı ↔ MIME uyumunu ve boyutu **storage.objects kaydından okuyarak** doğrular; sürümü tek transaction'da kaydeder. Başarı mesajı ancak bu adımdan sonra gösterilir; hata olursa yüklenen dosyalar temizlenir.
4. Görüntüleme/indirme 60 saniyelik imzalı URL iledir; imzalama isteği Storage RLS'e tabidir (üye yalnızca kendi klasörü, yönetici hepsi).

### Bilinen sınırlar (v1)

- **Dosya içeriği sunucuda taranmaz.** Sunucu; uzantıyı, beyan edilen MIME'ı ve boyutu zorlar. İçerik imzası (magic bytes) kontrolü istemcidedir, bilinçli bir saldırgan API'yi doğrudan çağırarak atlayabilir. Yüklenen dosyalar hiçbir zaman sunucuda çalıştırılmaz/açılmaz (ZIP dahil) ve yalnızca yükleyen + yöneticiler indirebilir. Daha sıkı güvence gerekiyorsa yükleme sonrası antivirüs/imza taraması yapan bir Edge Function eklenmelidir.
- Bildirimler 30 sn aralıkla ve sekme odaklandığında yenilenir (Realtime aboneliği yok). E-posta bildirimi yok.
- **"Gecikmiş" hâlâ bir durum olarak saklanır.** Gecikme aslında tarihten türetilen bir özelliktir; ancak mevcut testler ve iş akışı buna bağlı olduğu için değiştirilmedi. Kontrol merkezi ve analitik gecikmeyi `status = OVERDUE` **veya** `due_date < bugün` (açık görev) olarak hesaplar; bloke görevler `OVERDUE`'ya çevrilmez.
- Kontrol merkezi görünür sekmede 60 sn'de bir ve sekmeye dönüldüğünde yenilenir (Realtime aboneliği yok).
- Yönetici şifre sıfırladığında geçici şifreyi üyeye kendisi iletir; "ilk girişte şifre değiştirmeye zorla" akışı yok.

---

## 3. Testler

Testler **gerçek Supabase servislerine** (Postgres + GoTrue + PostgREST + Storage + Edge Runtime) karşı çalışır. Docker gerekir.

```bash
npm run local:up          # temiz yerel yığın + migration'lar; anahtarlar local/.env.local'a yazılır
npm run test:security     # 117 API/RLS/Storage kontrolü
npm run test:mission      # 137 kontrol: 0006–0007 modülleri, rol bazlı yetki, Storage, YZ fonksiyonu

npm run local:up          # e2e de temiz yığın ister (ilk yönetici kurulumu test edilir)
# .env.local -> VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY = local/.env.local içindeki değerler
npm run dev &
npm i -D playwright && npx playwright install chromium   # yoksa
npm run test:e2e          # 107 tarayıcı kontrolü (masaüstü + iPhone 13)
npm run test:modules      # 71 tarayıcı kontrolü: yeni modüller, masaüstü + mobil + açık tema, konsol hatası
npm run local:down
```

`local/` yığını `supabase start` ile aynı servisleri Docker Hub imajlarından ayağa kaldırır; yalnızca test içindir.
Supabase CLI kuruluysa onun yerine `npx supabase start` da kullanılabilir.

| # | Kabul kriteri | Güvenlik testi | Tarayıcı testi |
|---|---|---|---|
| 1 | Yönetici giriş yapar | ✓ | ✓ |
| 2 | Yönetici üye oluşturur | ✓ | ✓ |
| 3 | Yönetici departmana görev atar | ✓ | ✓ |
| 4 | Üye yalnızca kendi görevlerini görür | ✓ | ✓ |
| 5–6 | Üye PDF / Excel / Word yükler | ✓ | ✓ |
| 7 | Dosyalar Supabase Storage'da | ✓ | ✓ |
| 8 | Yönetici raporu görüntüler | ✓ | ✓ |
| 9 | Yönetici onaylar | ✓ | ✓ |
| 10 | Yönetici revizyon ister (gerekçe zorunlu) | ✓ | ✓ |
| 11 | Üye yeni sürüm yükler | ✓ | ✓ |
| 12 | Eski sürümler korunur | ✓ | ✓ |
| 13 | Üye başkasının raporunu göremez | ✓ | ✓ |
| 14 | Üye yönetici paneline erişemez | ✓ | ✓ |
| 15 | Mobilde temel işlemler çalışır | — | ✓ |

## 4. Logo

Logo `public/logo.png` (saydam zeminli) ve `public/favicon.png` dosyalarıdır. Değiştirmek için aynı adlarla yenilerini koymak yeterlidir.

## 5. Giriş ekranı videosu

`public/media/` içinde dört dosya vardır: `atis.mp4` (yatay, 1280×720) ve `atis-mobil.mp4` (dikey, 608×1080) ile ilk kareleri (`.jpg`). Videoyu değiştirmek için aynı adlarla yenilerini koyun; sessiz, 10–15 saniyelik, 1–2 MB altı dosyalar önerilir.

Şu anki görüntü TEKNOFEST resmi yayınından alınmıştır ve ilk saniyelerde TEKNOFEST rozeti görünür. Herkese açık bir sitede kullanmadan önce yayın görüntüsünün kullanım koşullarını kontrol edin.
