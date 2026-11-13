# AKANA MISSION CONTROL

AKANA Roket Takımı için bağımsız **görev, raporlama ve dokümantasyon yönetim sistemi**.

- **Frontend:** React 19 + TypeScript + Vite + Tailwind CSS 4, Lucide, Recharts
- **Backend:** Supabase (PostgreSQL + Auth + Storage + bir Edge Function)
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
```

CLI kullanmak istemezseniz: `supabase/migrations/` altındaki 5 dosyayı **sırayla** Dashboard → SQL Editor'da çalıştırın; `admin-users` fonksiyonunu Dashboard → Edge Functions üzerinden oluşturup `supabase/functions/admin-users/index.ts` içeriğini yapıştırın ve "Verify JWT" seçeneğini kapatın (fonksiyon JWT'yi kendi içinde Auth sunucusuna doğrulatır ve ayrıca veritabanından ADMIN rolünü kontrol eder).

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

### 1.5 (Önerilir) Teslim tarihi kontrolünü zamanlayın

"Teslim tarihi yaklaşıyor / görev gecikti" bildirimleri ve `Gecikmiş` durumu `process_deadlines()` ile üretilir. Uygulama bunu her oturum açılışında çağırır; kimse giriş yapmasa da çalışması için `pg_cron` ile günlük çalıştırın (Dashboard → Database → Extensions → pg_cron):

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
  functions/    admin-users (üye oluşturma, e-posta değişimi, şifre sıfırlama)
local/          yerel Supabase test yığını (Docker)      tests/  güvenlik + uçtan uca testler
```

### Veritabanı

`profiles`, `departments`, `tasks`, `task_assignees`, `reports`, `report_versions`, `report_files`, `notifications`, `activity_logs`, `app_settings` + `directory` ve `report_overview` görünümleri.

- **Rapor modeli:** bir görev için bir üyenin tek `reports` kaydı vardır; her yükleme yeni bir `report_versions` satırı (V1, V2, …) ve ona bağlı `report_files` satırları üretir. Sürüm ve dosya kayıtları tetikleyiciyle **silinemez / değiştirilemez**; Storage'da üzerine yazma politikası yoktur.
- **Görev kodu:** `AK-<departman kodu>-<sıra>`; departman satırı kilitlenerek üretilir (eşzamanlı oluşturmada da benzersiz). Departmanlar tablodan gelir; kodda sabit departman adı yoktur.
- **Yazma işlemleri RPC ile:** `create_task`, `set_task_assignees`, `start_task`, `submit_report`, `review_report`, `set_max_file_size_mb`, `update_own_profile`. Kimlik her zaman `auth.uid()`'den alınır; istemcinin gönderdiği kullanıcı/rol/departman bilgisine güvenilmez.

### Dosya yükleme akışı

1. İstemci uzantı, MIME, boyut ve dosya imzasını (magic bytes) kontrol eder, SHA-256 hesaplar.
2. Dosyalar kullanıcının kendi oturumuyla özel `reports` bucket'ına yüklenir (`<görev>/<kullanıcı>/<yükleme>/<dosya>`); ilerleme çubuğu gerçek `XMLHttpRequest` ilerlemesidir. Storage; bucket'ın MIME listesi, boyut sınırı ve RLS politikasıyla (yalnızca atandığı görev + kendi klasörü) yüklemeyi sınırlar.
3. `submit_report` RPC'si dosyaların gerçekten Storage'da olduğunu, yolun çağırana ait olduğunu, uzantı ↔ MIME uyumunu ve boyutu **storage.objects kaydından okuyarak** doğrular; sürümü tek transaction'da kaydeder. Başarı mesajı ancak bu adımdan sonra gösterilir; hata olursa yüklenen dosyalar temizlenir.
4. Görüntüleme/indirme 60 saniyelik imzalı URL iledir; imzalama isteği Storage RLS'e tabidir (üye yalnızca kendi klasörü, yönetici hepsi).

### Bilinen sınırlar (v1)

- **Dosya içeriği sunucuda taranmaz.** Sunucu; uzantıyı, beyan edilen MIME'ı ve boyutu zorlar. İçerik imzası (magic bytes) kontrolü istemcidedir, bilinçli bir saldırgan API'yi doğrudan çağırarak atlayabilir. Yüklenen dosyalar hiçbir zaman sunucuda çalıştırılmaz/açılmaz (ZIP dahil) ve yalnızca yükleyen + yöneticiler indirebilir. Daha sıkı güvence gerekiyorsa yükleme sonrası antivirüs/imza taraması yapan bir Edge Function eklenmelidir.
- Bildirimler 30 sn aralıkla ve sekme odaklandığında yenilenir (Realtime aboneliği yok). E-posta bildirimi yok.
- Departman sorumlusu bilgi amaçlıdır; ek yetki vermez. Departman bazlı "sorumlu kendi departmanının raporlarını görsün" kuralı istenirse `can_view_report` ve `can_read_object` fonksiyonlarına eklenmelidir.
- Yönetici şifre sıfırladığında geçici şifreyi üyeye kendisi iletir; "ilk girişte şifre değiştirmeye zorla" akışı yok.

---

## 3. Testler

Testler **gerçek Supabase servislerine** (Postgres + GoTrue + PostgREST + Storage + Edge Runtime) karşı çalışır. Docker gerekir.

```bash
npm run local:up          # temiz yerel yığın + migration'lar; anahtarlar local/.env.local'a yazılır
npm run test:security     # 117 API/RLS/Storage kontrolü

npm run local:up          # e2e de temiz yığın ister (ilk yönetici kurulumu test edilir)
# .env.local -> VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY = local/.env.local içindeki değerler
npm run dev &
npm i -D playwright && npx playwright install chromium   # yoksa
npm run test:e2e          # 70 tarayıcı kontrolü (masaüstü + iPhone 13)
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

Logo alanı `src/components/AppLayout.tsx` ve `src/pages/Login.tsx` içinde `data-logo-slot` ile işaretlidir. Logoyu `public/logo.svg` olarak ekleyip bu kutulardaki geçici SVG'yi `<img src="/logo.svg" alt="AKANA" />` ile değiştirin.
