# GitHub'a yükleme ve yayına alma

Bu depo GitHub'a yüklendiğinde iki iş akışı otomatik çalışır:

| İş akışı | Ne yapar | Neye ihtiyaç duyar |
|---|---|---|
| **Siteyi yayınla (GitHub Pages)** | Uygulamayı derler ve GitHub Pages'te yayınlar | 2 depo değişkeni |
| **Supabase'i kur / güncelle** | Veritabanı tablolarını, güvenlik kurallarını, dosya deposunu ve `admin-users` fonksiyonunu kurar | 3 depo sırrı |

GitHub Pages yalnızca arayüzü barındırır. Giriş, veritabanı ve dosya depolama Supabase'de çalışır; bu yüzden ücretsiz bir Supabase projesi şarttır.

## Adımlar

### 1. Supabase projesi aç (bir kez)

[supabase.com](https://supabase.com) → New project. Oluştururken belirlediğin **veritabanı şifresini** not et.

Sonra şu dört değeri topla:

| Değer | Nerede |
|---|---|
| Proje kimliği (ref) | Proje adresinde: `https://<BU KISIM>.supabase.co` |
| Proje URL'si | Project Settings → API |
| anon / publishable anahtar | Project Settings → API |
| Access token | Sağ üst profil → Account → Access Tokens → Generate |

### 2. Depoyu GitHub'a yükle

GitHub'da boş bir depo oluştur (README ekleme), sonra bu klasörde:

```bash
git remote add origin https://github.com/<kullanici>/<depo>.git
```

```bash
git push -u origin main
```

### 3. Depo ayarlarını gir

**Settings → Secrets and variables → Actions**

*Variables* sekmesi (herkese açık değerler):

| Ad | Değer |
|---|---|
| `VITE_SUPABASE_URL` | Proje URL'si |
| `VITE_SUPABASE_ANON_KEY` | anon / publishable anahtar |

*Secrets* sekmesi (gizli değerler):

| Ad | Değer |
|---|---|
| `SUPABASE_ACCESS_TOKEN` | Access token |
| `SUPABASE_PROJECT_REF` | Proje kimliği |
| `SUPABASE_DB_PASSWORD` | Veritabanı şifresi |

> Service Role Key'i hiçbir yere yazmana gerek yok. Supabase onu Edge Function'a kendisi verir.

**Settings → Pages → Source:** "GitHub Actions" seç.

### 4. İş akışlarını çalıştır

**Actions** sekmesinde ikisini de sırayla aç ve **Run workflow** de:

1. *Supabase'i kur / güncelle* (önce bu)
2. *Siteyi yayınla (GitHub Pages)*

İkisi de yeşil olunca site adresi Pages iş akışının özetinde görünür:
`https://<kullanici>.github.io/<depo>/` (depo adı `<kullanici>.github.io` ise veya özel alan adı kullanıyorsan kök adres).

Sonraki her `git push` siteyi kendiliğinden günceller; `supabase/` klasörü değişirse veritabanı da güncellenir.

### 5. İlk yöneticiyi oluştur (bir kez)

1. Supabase → Authentication → Users → **Add user**: e-posta + şifre, "Auto Confirm User" işaretli.
2. Supabase → SQL Editor:

```sql
select private.bootstrap_first_admin('senin@epostan.com');
```

3. Supabase → Authentication → Sign In / Providers → **"Allow new users to sign up" kapalı**.

Siteyi aç, bu hesapla giriş yap. Diğer üyeleri Üye Yönetimi ekranından eklersin.

## Sorun giderme

| Belirti | Neden / çözüm |
|---|---|
| Site açılıyor ama "Supabase bağlantısı yapılandırılmamış" yazıyor | 3. adımdaki iki *Variable* eksik. Ekle, Pages iş akışını yeniden çalıştır. |
| Giriş ekranı geliyor, giriş "E-posta veya şifre hatalı" diyor | Kullanıcı Supabase → Authentication'da yok ya da şifre yanlış. |
| Giriş sonrası "Hesabınız aktif değil" | 5. adımdaki SQL çalıştırılmamış. |
| "Üye ekle" → "Üye yönetim servisine ulaşılamadı" | Supabase iş akışı çalışmamış ya da hata vermiş; Actions'ta kaydına bak. |
| Pages iş akışı "Get Pages site failed" hatası veriyor | Settings → Pages → Source "GitHub Actions" seçili değil. |
| Supabase iş akışı uyarıyla bitiyor, hiçbir şey kurmuyor | Üç *Secret*'tan biri eksik. |
| Depo özel (private) ve Pages açılmıyor | Ücretsiz GitHub hesabında Pages yalnızca herkese açık depolarda çalışır. |

## Depo herkese açıksa

Kaynak kodun görünür olması güvenlik açığı yaratmaz: anon anahtar zaten tarayıcıya giden herkese açık bir anahtardır ve tüm yetkilendirme veritabanındaki RLS kurallarıyla yapılır. Gizli kalması gerekenler (veritabanı şifresi, access token) yalnızca *Secrets* içinde durur ve koda girmez.
