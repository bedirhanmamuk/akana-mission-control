// =============================================================================
// AKANA MISSION CONTROL — tarayıcı uçtan uca testleri (Playwright + Chromium)
// 15 kabul kriterini gerçek arayüz üzerinden, gerçek yerel Supabase yığınına
// karşı doğrular. Önkoşul: `npm run local:up` (temiz yığın) ve çalışan
// `npm run dev` (VITE_* değişkenleri local/.env.local değerlerine ayarlı).
// =============================================================================
import { createRequire } from "node:module";
// Playwright ortamda genel (global) kuruluysa PLAYWRIGHT_PATH ile gösterin; yoksa `npm i -D playwright`.
const require = createRequire(import.meta.url);
const { chromium, devices } = require(process.env.PLAYWRIGHT_PATH ?? "playwright");
import { mkdirSync, readFileSync } from "node:fs";
import { check, finish, sampleFile, section, service, sha256, sql } from "./helpers.mjs";

const BASE = process.env.APP_URL ?? "http://127.0.0.1:5173";
const OUT = new URL("./.artifacts/", import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });
const run = Date.now().toString(36);
const PW = `E2e-Sifre-${run}!7`;
const adminEmail = `yonetici.${run}@akana.test`;
const memberEmail = `uye.${run}@akana.test`;
const otherEmail = `diger.${run}@akana.test`;

// Dosyalar bellekten verilir (Türkçe karakterli adlar dahil): Playwright bu ortamda
// ASCII dışı dosya yollarını sessizce yok saydığı için disk yolu kullanılmaz.
const MIMES = { pdf: "application/pdf", docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" };
const file = (name, ext, bytes) => ({ name, mimeType: MIMES[ext], buffer: sampleFile(ext, bytes) });
const pdfV1 = file("Gövde Analiz Raporu.pdf", "pdf", 400_000);
const docx = file("Hesap Dökümü.docx", "docx", 20_000);
const xlsx = file("Ölçüm Verileri.xlsx", "xlsx", 20_000);
const pdfV2 = file("Gövde Analiz Raporu v2.pdf", "pdf", 30_000);
const exe = { name: "zararli.exe", mimeType: "application/x-msdownload", buffer: Buffer.from("MZ-not-allowed") };
const fakePdf = { name: "sahte.pdf", mimeType: "application/pdf", buffer: Buffer.from("bu bir pdf degil") };

// İlk yönetici: Auth'ta kullanıcı + SQL ile bootstrap (README'deki kurulum adımı)
const created = await service.auth.admin.createUser({ email: adminEmail, password: PW, email_confirm: true, user_metadata: { first_name: "Deniz", last_name: "Yönetici" } });
if (created.error) throw created.error;
if (sql("select count(*) from public.profiles where role='ADMIN'") === "0") sql(`select private.bootstrap_first_admin('${adminEmail}')`);
else sql(`update public.profiles set role='ADMIN', is_active=true where id='${created.data.user.id}'`);

const browser = await chromium.launch();
const errors = [];
async function newPage(opts = {}) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: "tr-TR", ...opts });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
  page.on("console", (m) => { if (m.type() === "error" && !/Failed to load resource/.test(m.text())) errors.push(`console: ${m.text()}`); });
  return page;
}
async function signIn(page, email, password = PW) {
  await page.goto(`${BASE}/giris`);
  await page.fill('input[name="email"]', email);
  await page.fill('input[name="password"]', password);
  await page.click('button[type="submit"]');
}
const shot = (page, name, full = true) => page.screenshot({ path: `${OUT}${name}.png`, fullPage: full });
const visible = (loc, timeout = 8000) => loc.first().waitFor({ state: "visible", timeout }).then(() => true, () => false);

try {
  // -------------------------------------------------------------------------
  section("Giriş ve yönetici (Kabul #1, #2, #3)");
  const admin = await newPage();
  await signIn(admin, adminEmail, "yanlis-sifre");
  check("hatalı şifre anlaşılır hata verir", await visible(admin.getByText("E-posta veya şifre hatalı.")));
  await shot(admin, "01-giris");
  await signIn(admin, adminEmail);
  check("#1 yönetici giriş yapar ve kontrol merkezini görür", await visible(admin.getByTestId("admin-stats")));
  check("yönetici menüsü görünür (Üye Yönetimi, Sistem Kayıtları)", await visible(admin.getByRole("link", { name: "Üye Yönetimi" })) && await visible(admin.getByRole("link", { name: "Sistem Kayıtları" })));

  // #2 üyeleri arayüzden oluştur
  for (const [email, first, last, dept] of [[memberEmail, "Elif", "Kaya", "Mekanik"], [otherEmail, "Mert", "Aydın", "Mekanik"]]) {
    await admin.goto(`${BASE}/yonetim/uyeler`);
    await admin.getByRole("button", { name: "Üye ekle" }).click();
    await admin.fill('#member-form input[name="first_name"]', first);
    await admin.fill('#member-form input[name="last_name"]', last);
    await admin.fill('#member-form input[name="email"]', email);
    await admin.selectOption('#member-form select[name="department"]', { label: dept });
    await admin.fill('#member-form input[name="password"]', PW);
    await admin.getByRole("button", { name: "Üyeyi oluştur" }).click();
    check(`#2 yönetici üye oluşturur: ${first} ${last}`, await visible(admin.getByText(`${first} ${last} ekibe eklendi.`)));
  }
  check("üye listede aktif olarak görünür", await visible(admin.getByTestId("member-row").filter({ hasText: memberEmail }).getByText("Aktif")));
  await shot(admin, "02-uye-yonetimi");

  // #3 görev oluştur ve ata (iki görev: biri Elif'e, biri Mert'e)
  async function createTask(title, assignee) {
    await admin.goto(`${BASE}/yonetim/gorev-olustur`);
    await admin.fill('input[name="title"]', title);
    await admin.fill('textarea[name="description"]', "Yapısal analiz sonuçlarını ve emniyet katsayılarını raporlayın.");
    await admin.selectOption('select[name="department"]', { label: "Mekanik" });
    const due = new Date(Date.now() + 14 * 86400000).toISOString().slice(0, 10);
    await admin.fill('input[name="due_date"]', due);
    await admin.selectOption('select[name="priority"]', "CRITICAL");
    await admin.getByRole("button", { name: "pdf", exact: true }).click();
    await admin.locator("label", { hasText: assignee }).getByTestId("assignee-checkbox").check();
    if (title.startsWith("Gövde")) await shot(admin, "03-gorev-olustur");
    await admin.getByRole("button", { name: "Görevi oluştur ve ata" }).click();
    await admin.waitForURL(/\/gorevler\/[0-9a-f-]{36}$/);
    return { code: (await admin.getByTestId("task-code").textContent()).trim(), url: admin.url() };
  }
  const task = await createTask("Gövde yapısal analiz raporu", "Elif Kaya");
  const otherTask = await createTask("Burun konisi kalıp tasarımı", "Mert Aydın");
  check("#3 görev oluşturuldu, kod otomatik (AK-MEK-001 / 002)", task.code === "AK-MEK-001" && otherTask.code === "AK-MEK-002", `${task.code} ${otherTask.code}`);
  // Aviyonik görevi (üyenin departmanı dışında) — API ile, görünürlük testi için
  const avy = sql("select id from public.departments where code='AVY'");
  const otherId = sql(`select id from public.profiles where email='${otherEmail}'`);
  sql(`set local role postgres; insert into public.tasks (title, department_id, due_date) values ('Telemetri kart testi', '${avy}', current_date + 10)`);
  const avyTask = sql("select id from public.tasks where code like 'AK-AVY-%' limit 1");
  sql(`insert into public.task_assignees (task_id, user_id) values ('${avyTask}', '${otherId}')`);

  // -------------------------------------------------------------------------
  section("Üye: görevler ve rapor yükleme (Kabul #4, #5, #6, #7)");
  const member = await newPage();
  await signIn(member, memberEmail);
  check("üye giriş yapar; yönetici menüsü görünmez", await visible(member.getByRole("link", { name: "Görevlerim" })) && (await member.getByRole("link", { name: "Üye Yönetimi" }).count()) === 0);
  await member.goto(`${BASE}/gorevler`);
  await visible(member.getByTestId("task-item"));
  const mine = await member.getByTestId("task-item").allTextContents();
  check("#4 'Bana atananlar': yalnızca kendi görevi", mine.length === 1 && mine[0].includes("AK-MEK-001"), mine.join(" | "));
  await member.getByRole("tab", { name: "Departman görevleri" }).click();
  const deptTasks = await member.getByTestId("task-item").allTextContents();
  check("#4 departman görevleri görünür; başka departmanınki görünmez", deptTasks.length === 2 && deptTasks.every((t) => t.includes("AK-MEK")), deptTasks.join(" | "));
  await member.goto(`${BASE}/gorevler/${avyTask}`);
  check("#4 başka departman görevine URL ile erişemez", await visible(member.getByText("Yetkisiz erişim")));
  await shot(member, "04-yetkisiz-gorev");
  await member.goto(`${BASE}/bildirimler`);
  check("görev atama bildirimi geldi", await visible(member.getByTestId("notification-item").filter({ hasText: "Yeni görev atandı" })));

  // Rapor Yükle ekranı
  await member.goto(`${BASE}/rapor-yukle`);
  await member.selectOption('select[name="task"]', { label: "AK-MEK-001 — Gövde yapısal analiz raporu" });
  await member.getByTestId("file-input").setInputFiles([exe, fakePdf]);
  check("izin verilmeyen tür (.exe) arayüzde reddedilir", await visible(member.getByText(/Desteklenmeyen dosya türü/)));
  check("içeriği PDF olmayan .pdf reddedilir (imza kontrolü)", await visible(member.getByText(/Dosya içeriği \.pdf biçimiyle uyuşmuyor/)));
  await member.fill('input[name="title"]', "Gövde analiz raporu");
  await member.getByRole("button", { name: "Raporu yükle" }).click();
  check("hatalı dosya varken yükleme başlamaz", await visible(member.getByTestId("upload-error")));
  await member.getByRole("button", { name: /zararli\.exe dosyasını kaldır/ }).click();
  await member.getByRole("button", { name: /sahte\.pdf dosyasını kaldır/ }).click();
  await member.getByTestId("file-input").setInputFiles([pdfV1, docx, xlsx]);
  check("seçilen dosyaların adı ve boyutu gösterilir", await visible(member.getByText("Gövde Analiz Raporu.pdf")) && await visible(member.getByText(/PDF · 39\d(\.\d)? KB/)));
  await member.fill('textarea[name="description"]', "FEA sonuçları, yükleme senaryoları ve emniyet katsayıları.");
  await shot(member, "05-rapor-yukle");

  // Gerçek ilerleme: yüklemeyi yavaşlat ve ara yüzdeyi yakala; bu sırada başarı mesajı OLMAMALI
  const cdp = await member.context().newCDPSession(member);
  await cdp.send("Network.enable");
  await cdp.send("Network.emulateNetworkConditions", { offline: false, latency: 20, downloadThroughput: -1, uploadThroughput: 150_000 });
  await member.getByRole("button", { name: "Raporu yükle" }).click();
  let mid = null, earlySuccess = false;
  for (let i = 0; i < 80 && mid === null; i++) {
    const t = await member.getByTestId("upload-percent").textContent({ timeout: 500 }).catch(() => null);
    const n = t ? Number(t.replace("%", "")) : NaN;
    if (n > 0 && n < 100) mid = n;
    if (await member.getByText("Raporunuz başarıyla AKANA MISSION CONTROL sistemine yüklendi.").count()) earlySuccess = true;
    await member.waitForTimeout(100);
  }
  if (mid !== null) await shot(member, "06-yukleme-ilerleme", false);
  check("yükleme sırasında gerçek ilerleme yüzdesi gösterilir", mid !== null, String(mid));
  check("yükleme bitmeden başarı mesajı gösterilmez", !earlySuccess);
  await cdp.send("Network.emulateNetworkConditions", { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
  check("#5 #6 PDF + Word + Excel yüklendi; başarı mesajı gösterildi", await visible(member.getByText("Raporunuz başarıyla AKANA MISSION CONTROL sistemine yüklendi."), 30000));
  await member.waitForURL(/\/raporlar\/[0-9a-f-]{36}$/);
  const reportId = member.url().split("/").pop();
  check("rapor 'İnceleme bekliyor' durumunda (otomatik onay yok)", await visible(member.getByTestId("report-status").getByText("İnceleme bekliyor")));
  const stored = sql(`select count(*) || ':' || bool_and(o.id is not null) from public.report_files f left join storage.objects o on o.bucket_id='reports' and o.name=f.storage_path where f.report_id='${reportId}'`);
  check("#7 dosyalar gerçekten Supabase Storage'da (3 nesne)", stored === "3:true", stored);
  // Not: bu ortamdaki headless Chromium ASCII dışı indirme adlarını "download" olarak raporluyor;
  // bu yüzden istenen ad <a download> üzerinden, içerik ise SHA-256 ile doğrulanır.
  await member.evaluate(() => { const c = HTMLAnchorElement.prototype.click; HTMLAnchorElement.prototype.click = function () { if (this.download) window.__dl = this.download; return c.call(this); }; });
  const dl = member.waitForEvent("download");
  await member.getByRole("button", { name: /Gövde Analiz Raporu\.pdf dosyasını indir/ }).click();
  const d = await dl;
  const got = readFileSync(await d.path());
  const asked = await member.evaluate(() => window.__dl);
  check("üye kendi dosyasını özgün adıyla ve bozulmadan indirir", asked === "Gövde Analiz Raporu.pdf" && sha256(got) === sha256(pdfV1.buffer), `${asked} ${got.length}`);

  // Çevrimdışı senaryosu (başka görevi olmadığı için aynı raporun yeni sürümünde denenir)
  await member.getByTestId("file-input").setInputFiles([pdfV2]);
  await member.context().setOffline(true);
  await member.getByRole("button", { name: "Yeni sürümü yükle" }).click();
  check("bağlantı kesikken kontrollü hata; başarı mesajı yok", await visible(member.getByTestId("upload-error").getByText(/İnternet bağlantısı|ulaşılamıyor|bağlantı/i)));
  await member.context().setOffline(false);
  const vCount = sql(`select count(*) from public.report_versions where report_id='${reportId}'`);
  check("başarısız yükleme sürüm oluşturmadı", vCount === "1", vCount);

  // -------------------------------------------------------------------------
  section("Yetkisiz erişim (Kabul #13, #14)");
  const other = await newPage();
  await signIn(other, otherEmail);
  await visible(other.getByRole("link", { name: "Görevlerim" }));
  await other.goto(`${BASE}/raporlar/${reportId}`);
  check("#13 başka üye raporu URL ile açamaz", await visible(other.getByText("Yetkisiz erişim")));
  await other.goto(`${BASE}/arsiv`);
  await visible(other.getByTestId("archive-count"));
  await other.waitForTimeout(600);
  check("#13 başka üyenin arşivinde rapor listelenmez", (await other.getByTestId("archive-row").count()) === 0 && await visible(other.getByText("0 rapor")));
  for (const path of ["/yonetim", "/yonetim/uyeler", "/yonetim/gorev-olustur", "/yonetim/rapor-inceleme", `/yonetim/rapor-inceleme/${reportId}`, "/yonetim/kayitlar"]) {
    await other.goto(`${BASE}${path}`);
    check(`#14 üye ${path} sayfasına erişemez`, await visible(other.getByText("Yetkisiz erişim")));
  }
  await shot(other, "07-yetkisiz-yonetim");
  const anonPage = await newPage();
  await anonPage.goto(`${BASE}/yonetim/uyeler`);
  await anonPage.waitForURL(/\/giris$/);
  check("oturumsuz kullanıcı giriş ekranına yönlendirilir", true);

  // -------------------------------------------------------------------------
  section("Yönetici: inceleme ve revizyon (Kabul #8, #9, #10)");
  await admin.goto(`${BASE}/yonetim/rapor-inceleme`);
  check("rapor inceleme kuyruğunda görünür", await visible(admin.getByTestId("review-item").filter({ hasText: "Gövde analiz raporu" })));
  await shot(admin, "08-inceleme-kuyrugu");
  await admin.getByTestId("review-item").filter({ hasText: "Gövde analiz raporu" }).click();
  check("#8 yönetici rapor detayını görür (yükleyen, görev, dosyalar)", await visible(admin.getByText("Elif Kaya")) && await visible(admin.getByText("Gövde Analiz Raporu.pdf")) && await visible(admin.getByText("Hesap Dökümü.docx")) && await visible(admin.getByText("Ölçüm Verileri.xlsx")));
  // Headless Chromium'da PDF görüntüleyici olmadığından sekme içeriği yerine imzalı URL yanıtı doğrulanır.
  const signedResp = admin.context().waitForEvent("response", { predicate: (r) => /\/storage\/v1\/object\/sign\/reports\/.+token=/.test(r.url()), timeout: 10000 }).catch(() => null);
  const popup = admin.waitForEvent("popup");
  await admin.getByRole("button", { name: /Gövde Analiz Raporu\.pdf dosyasını görüntüle/ }).click();
  const pp = await popup;
  const sr = await signedResp;
  check("#8 yönetici dosyayı yeni sekmede imzalı URL ile görüntüler", sr !== null && sr.status() === 200 && /application\/pdf/.test(sr.headers()["content-type"] ?? ""), sr ? `${sr.status()} ${sr.headers()["content-type"]}` : "yanıt yok");
  await pp.close().catch(() => {});
  await admin.getByRole("button", { name: "İncelemeye al" }).click();
  check("rapor 'İnceleniyor' durumuna geçti", await visible(admin.getByTestId("report-status").getByText("İnceleniyor")));
  await admin.getByRole("button", { name: "Revizyon iste" }).click();
  await admin.getByTestId("confirm-review").click();
  check("#10 gerekçesiz revizyon engellenir", await visible(admin.getByText("Revizyon gerekçesi yazılması zorunludur.")));
  await admin.fill('textarea[name="review-note"]', "Emniyet katsayısı hesabı eksik; Bölüm 3'e ekleyin.");
  await shot(admin, "09-revizyon-iste", false);
  await admin.getByTestId("confirm-review").click();
  check("#10 yönetici revizyon ister", await visible(admin.getByTestId("report-status").getByText("Revizyon istendi")));

  // -------------------------------------------------------------------------
  section("Üye: revizyon ve yeni sürüm (Kabul #11, #12)");
  await member.goto(`${BASE}/bildirimler`);
  check("revizyon bildirimi üyeye ulaştı", await visible(member.getByTestId("notification-item").filter({ hasText: "revizyon istendi" })));
  await shot(member, "10-bildirimler");
  await member.getByTestId("notification-item").filter({ hasText: "Raporunuz için revizyon istendi" }).getByRole("button").first().click();
  await member.waitForURL(new RegExp(`/raporlar/${reportId}$`));
  check("üye revizyon gerekçesini görür", await visible(member.getByTestId("review-note").getByText("Emniyet katsayısı hesabı eksik; Bölüm 3'e ekleyin.")));
  await member.getByTestId("file-input").setInputFiles([pdfV1]);
  await member.fill('textarea[name="note"]', "Aynı dosya denemesi");
  await member.getByRole("button", { name: "Yeni sürümü yükle" }).click();
  check("aynı dosyanın tekrar yüklenmesi kontrollü hata verir", await visible(member.getByTestId("upload-error").getByText(/daha önce yüklenmiş/), 15000));
  await member.getByRole("button", { name: /Gövde Analiz Raporu\.pdf dosyasını kaldır/ }).click();
  await member.getByTestId("file-input").setInputFiles([pdfV2]);
  await member.fill('textarea[name="note"]', "Bölüm 3'e emniyet katsayısı hesabı eklendi.");
  await member.getByRole("button", { name: "Yeni sürümü yükle" }).click();
  check("#11 üye revizyon sonrası V2 yükler", await visible(member.getByText("Raporunuz başarıyla AKANA MISSION CONTROL sistemine yüklendi."), 20000));
  check("#12 sürüm geçmişinde V1 ve V2 birlikte görünür", await visible(member.getByTestId("version-1").getByText("Gövde Analiz Raporu.pdf")) && await visible(member.getByTestId("version-2").getByText("Gövde Analiz Raporu v2.pdf")) && await visible(member.getByTestId("version-1").getByText("Revizyon istendi")));
  await shot(member, "11-surum-gecmisi");
  const orphan = sql(`select count(*) from storage.objects o where o.bucket_id='reports' and not exists (select 1 from public.report_files f where f.storage_path=o.name)`);
  const v1Files = sql(`select count(*) from public.report_files f join public.report_versions v on v.id=f.version_id join storage.objects o on o.name=f.storage_path where v.report_id='${reportId}' and v.version_number=1`);
  check("#12 V1 dosyaları Storage'da duruyor; başarısız denemelerden artık dosya kalmadı", v1Files === "3" && orphan === "0", `v1=${v1Files} orphan=${orphan}`);

  // -------------------------------------------------------------------------
  section("Yönetici: onay ve dashboard (Kabul #9)");
  await admin.goto(`${BASE}/yonetim/rapor-inceleme/${reportId}`);
  await admin.getByRole("button", { name: "Onayla" }).click();
  await admin.fill('textarea[name="review-note"]', "Uygun, teşekkürler.");
  await admin.getByTestId("confirm-review").click();
  check("#9 yönetici raporu onaylar", await visible(admin.getByTestId("report-status").getByText("Onaylandı")));
  check("onay sonrası inceleme düğmeleri kalkar", (await admin.getByTestId("review-actions").count()) === 0);
  await admin.goto(task.url);
  await visible(admin.getByTestId("flight-profile")); await admin.waitForTimeout(1100); await shot(admin, "17-gorev-detay");
  await admin.goto(`${BASE}/gorevler`); await visible(admin.getByTestId("task-item")); await admin.waitForTimeout(700); await shot(admin, "18-gorevler");
  await admin.goto(task.url);
  await admin.selectOption('select[name="task-status"]', "COMPLETED");
  check("yönetici görevi 'Tamamlandı' yapar", await visible(admin.getByText("Görev durumu güncellendi.")));
  await admin.goto(`${BASE}/`);
  await visible(admin.getByTestId("admin-stats"));
  await admin.waitForTimeout(1000); // rakamlar açılışta sayarak gelir
  const statText = (await admin.getByTestId("admin-stats").innerText()).replace(/\s+/g, " ");
  const db = sql("select (select count(*) from profiles where is_active) || '/' || (select count(*) from tasks) || '/' || (select count(*) from tasks where status='COMPLETED') || '/' || (select count(*) from reports where status='APPROVED')");
  const [m, t, c, a] = db.split("/");
  check("dashboard kartları veritabanıyla birebir aynı", statText.includes(`Toplam ekip üyesi ${m}`) && statText.includes(`Toplam görev ${t}`) && statText.includes(`Tamamlanan görev ${c}`) && statText.includes(`Onaylanan rapor ${a}`), `${statText} | db=${db}`);
  await admin.waitForTimeout(500);
  await shot(admin, "12-yonetici-dashboard");
  await admin.goto(`${BASE}/yonetim/kayitlar`);
  check("sistem kayıtlarında yönetici işlemleri var", await visible(admin.getByTestId("log-row").filter({ hasText: "onaylandı" })) && await visible(admin.getByTestId("log-row").filter({ hasText: "Üye oluşturuldu" })));
  await shot(admin, "13-sistem-kayitlari");
  await admin.goto(`${BASE}/arsiv`);
  await admin.getByLabel("Dosya formatı").selectOption("xlsx");
  await admin.waitForTimeout(700);
  check("arşiv: format filtresi (XLSX) eski sürümdeki dosyayı güncel sürümde aramaz", await visible(admin.getByText("0 rapor")));
  await admin.getByLabel("Dosya formatı").selectOption("pdf");
  await admin.getByLabel("Görev kodu").fill("mek-001");
  check("arşiv: görev kodu + format filtresi raporu bulur", await visible(admin.getByTestId("archive-row").filter({ hasText: "Gövde analiz raporu" })));
  await shot(admin, "14-arsiv");
  await admin.goto(`${BASE}/departmanlar`);
  check("departman kartları (6) ve sayılar", (await visible(admin.getByTestId("department-card"))) && (await admin.getByTestId("department-card").count()) === 6);
  await shot(admin, "15-departmanlar");
  await admin.goto(`${BASE}/yonetim`);
  await visible(admin.getByText("Dosya yükleme ayarları"));
  await shot(admin, "16-yonetim-paneli");

  // -------------------------------------------------------------------------
  section("Mobil (Kabul #15) — iPhone 13");
  const mobile = await newPage({ ...devices["iPhone 13"], locale: "tr-TR" });
  await signIn(mobile, otherEmail);
  check("mobil: giriş yapılır", await visible(mobile.getByRole("button", { name: "Menüyü aç" })));
  const noOverflow = async () => mobile.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
  check("mobil: yatay taşma yok (Genel Bakış)", await noOverflow());
  await shot(mobile, "20-mobil-genel-bakis");
  await mobile.getByRole("button", { name: "Menüyü aç" }).click();
  check("mobil: menü açılır", await visible(mobile.getByRole("navigation", { name: "Ana menü" }).getByRole("link", { name: "Rapor Yükle" })));
  await mobile.waitForTimeout(450); // menü kayarak açılır
  await shot(mobile, "21-mobil-menu", false);
  await mobile.getByRole("navigation", { name: "Ana menü" }).getByRole("link", { name: "Görevlerim" }).click();
  check("mobil: menü kapanır ve görevler listelenir", await visible(mobile.getByTestId("task-item").filter({ hasText: "AK-MEK-002" })) && !(await mobile.getByRole("navigation", { name: "Ana menü" }).isVisible().catch(() => false)));
  check("mobil: yatay taşma yok (Görevler)", await noOverflow());
  await mobile.getByTestId("task-item").filter({ hasText: "AK-MEK-002" }).click();
  await visible(mobile.getByTestId("file-input").locator(".."));
  await mobile.fill('input[name="title"]', "Burun konisi kalıp raporu");
  await mobile.getByTestId("file-input").setInputFiles([file("Kalıp Çizimi.pdf", "pdf", 50_000)]);
  await visible(mobile.getByText("Kalıp Çizimi.pdf"));
  await shot(mobile, "22-mobil-gorev-detay-yukleme");
  await mobile.getByRole("button", { name: "Raporu yükle" }).click();
  check("mobil: dosya seçilir ve rapor yüklenir", await visible(mobile.getByText("Raporunuz başarıyla AKANA MISSION CONTROL sistemine yüklendi."), 20000));
  check("mobil: yatay taşma yok (Görev detayı)", await noOverflow());
  await mobile.goto(`${BASE}/arsiv`);
  check("mobil: arşiv okunabilir kart düzeninde", await visible(mobile.locator("ul li[data-testid='archive-row']").filter({ hasText: "Burun konisi kalıp raporu" })) && await noOverflow());
  await shot(mobile, "23-mobil-arsiv");
  await mobile.goto(`${BASE}/bildirimler`);
  await mobile.getByRole("button", { name: "Tümünü okundu işaretle" }).click();
  check("mobil: bildirimler okundu işaretlenir", await visible(mobile.getByText("Tüm bildirimler okundu olarak işaretlendi.")) && (await mobile.locator('[data-testid="notification-item"][data-read="false"]').count()) === 0);
  const minBtn = await mobile.evaluate(() => Math.min(...[...document.querySelectorAll("main button, main a.btn-primary")].filter((b) => b.offsetParent).map((b) => b.getBoundingClientRect().height)));
  check("mobil: düğmeler dokunmaya uygun (≥ 32 px)", minBtn >= 32, String(minBtn));

  const mAdmin = await newPage({ ...devices["iPhone 13"], locale: "tr-TR" });
  await signIn(mAdmin, adminEmail);
  await visible(mAdmin.getByTestId("admin-stats"));
  await mAdmin.waitForTimeout(600);
  check("mobil yönetici: dashboard taşmadan görüntülenir", await mAdmin.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1));
  await shot(mAdmin, "24-mobil-yonetici-dashboard");
  await mAdmin.goto(`${BASE}/yonetim/rapor-inceleme`);
  await mAdmin.getByTestId("review-item").filter({ hasText: "Burun konisi" }).click();
  await mAdmin.getByRole("button", { name: "Onayla" }).click();
  await mAdmin.getByTestId("confirm-review").click();
  check("mobil yönetici: raporu onaylar", await visible(mAdmin.getByTestId("report-status").getByText("Onaylandı")));
  await mAdmin.goto(`${BASE}/yonetim/uyeler`);
  check("mobil yönetici: üye listesi kart düzeninde, taşma yok", await visible(mAdmin.locator("ul li[data-testid='member-row']").first()) && await mAdmin.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1));
  await shot(mAdmin, "25-mobil-uye-yonetimi");

  // -------------------------------------------------------------------------
  section("Yönetici: görev düzenleme ve silme (masaüstü + mobil)");
  const inViewport = async (page, loc) => {
    const b = await loc.boundingBox().catch(() => null); const v = page.viewportSize();
    return b !== null && b.y >= 0 && b.x >= 0 && b.y + b.height <= v.height + 1 && b.x + b.width <= v.width + 1;
  };
  const newTask = (title) => {
    sql(`insert into public.tasks (title, department_id, due_date) values ('${title}', '${avy}', current_date + 20)`);
    return sql(`select id || '|' || code from public.tasks where title='${title}'`).split("|");
  };
  const [delPcId, delPcCode] = newTask("Silinecek görev PC");
  const [, delMobCode] = newTask("Silinecek görev mobil");
  // Uzun bir sayfada (aşağı kaydırılmışken) pencere yine ekranda açılmalı
  await admin.goto(`${BASE}/gorevler/${delPcId}`);
  await visible(admin.getByTestId("flight-profile"));
  await admin.setViewportSize({ width: 1440, height: 560 });
  await admin.mouse.wheel(0, 600);
  await admin.getByRole("button", { name: "Düzenle" }).first().click();
  check("PC: düzenleme penceresi kısa ekranda da tamamen görünür", await visible(admin.getByRole("dialog")) && await inViewport(admin, admin.getByRole("dialog").locator("> div").nth(1)) && await inViewport(admin, admin.getByRole("button", { name: "Kaydet" })));
  await admin.getByRole("button", { name: "Vazgeç" }).click();
  await admin.setViewportSize({ width: 1440, height: 900 });
  await admin.goto(`${BASE}/gorevler`);
  await admin.getByRole("link", { name: "AK-MEK-002 görevini düzenle" }).first().click();
  check("PC: listeden 'düzenle' penceresi açılır", await visible(admin.getByRole("dialog", { name: /AK-MEK-002/ })));
  await admin.locator("#edit-task input").first().fill("Burun konisi kalıp tasarımı (rev. B)");
  await shot(admin, "30-gorev-duzenle", false);
  await admin.getByRole("button", { name: "Kaydet" }).click();
  check("PC: görev düzenlenir", await visible(admin.getByText("Görev güncellendi.")) && await visible(admin.getByRole("heading", { name: "Burun konisi kalıp tasarımı (rev. B)" })));
  await admin.goto(`${BASE}/gorevler`);
  await admin.getByRole("link", { name: `${delPcCode} görevini sil` }).first().click();
  check("PC: listeden 'sil' onayı açılır", await visible(admin.getByRole("dialog", { name: "Görevi sil" })));
  await admin.getByRole("button", { name: "Evet, sil" }).click();
  check("PC: görev silinir", await visible(admin.getByText("Görev silindi.")) && sql(`select count(*) from public.tasks where id='${delPcId}'`) === "0");
  await admin.goto(`${BASE}/gorevler`);
  await admin.getByRole("link", { name: "AK-MEK-001 görevini sil" }).first().click();
  await admin.getByRole("button", { name: "Evet, sil" }).click();
  check("PC: raporu olan görev silinmez, nedeni açıklanır", await visible(admin.getByText(/rapor yüklendiği için silinemez/)));

  await mAdmin.goto(`${BASE}/gorevler`);
  await visible(mAdmin.getByTestId("task-item"));
  check("mobil: görev kartında düzenle/sil düğmeleri var ve ≥ 40 px", await visible(mAdmin.getByRole("link", { name: "AK-MEK-002 görevini düzenle" })) && (await mAdmin.getByRole("link", { name: "AK-MEK-002 görevini düzenle" }).first().boundingBox()).height >= 40);
  await shot(mAdmin, "31-mobil-gorevler-yonetici");
  await mAdmin.getByRole("link", { name: "AK-MEK-002 görevini düzenle" }).first().click();
  await mAdmin.waitForTimeout(500);
  check("mobil: düzenleme penceresi ekranda açılır, Kaydet görünür", await visible(mAdmin.getByRole("dialog")) && await inViewport(mAdmin, mAdmin.getByRole("button", { name: "Kaydet" })));
  await shot(mAdmin, "32-mobil-gorev-duzenle", false);
  await mAdmin.locator("#edit-task textarea").first().fill("Mobilden güncellenen açıklama.");
  await mAdmin.getByRole("button", { name: "Kaydet" }).click();
  check("mobil: görev düzenlenir", await visible(mAdmin.getByText("Görev güncellendi.")) && await visible(mAdmin.getByText("Mobilden güncellenen açıklama.")));
  await mAdmin.goto(`${BASE}/gorevler`);
  await mAdmin.getByRole("link", { name: `${delMobCode} görevini sil` }).first().click();
  await mAdmin.waitForTimeout(450);
  check("mobil: silme onayı ekranda", await inViewport(mAdmin, mAdmin.getByRole("button", { name: "Evet, sil" })));
  await mAdmin.getByRole("button", { name: "Evet, sil" }).click();
  check("mobil: görev silinir", await visible(mAdmin.getByText("Görev silindi.")));
  await mAdmin.getByRole("navigation", { name: "Hızlı erişim" }).getByRole("link", { name: "Arşiv" }).click();
  await mAdmin.waitForURL(/\/arsiv$/);
  check("mobil: alt gezinme çubuğu çalışır", true);

  section("Açık tema");
  const overflowOk = (page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
  await mAdmin.getByRole("button", { name: "Açık temaya geç" }).click();
  check("mobil: açık temaya geçilir", (await mAdmin.evaluate(() => document.documentElement.dataset.theme)) === "light");
  for (const [path, name] of [["/", "40-acik-mobil-genel-bakis"], ["/gorevler", "41-acik-mobil-gorevler"]]) {
    await mAdmin.goto(`${BASE}${path}`); await mAdmin.waitForTimeout(1100);
    check(`mobil açık tema: ${path} taşma yok`, await overflowOk(mAdmin));
    await shot(mAdmin, name);
  }
  check("tema seçimi sayfa yenilenince korunur", (await mAdmin.evaluate(() => document.documentElement.dataset.theme)) === "light");
  await admin.goto(`${BASE}/profil`);
  await admin.getByRole("radio", { name: "Açık" }).click();
  for (const [path, name] of [["/", "42-acik-genel-bakis"], [task.url.replace(BASE, ""), "43-acik-gorev-detay"], ["/yonetim/uyeler", "44-acik-uyeler"], [`/yonetim/rapor-inceleme/${reportId}`, "45-acik-rapor"]]) {
    await admin.goto(`${BASE}${path}`); await admin.waitForTimeout(1200);
    check(`PC açık tema: ${path.slice(0, 28)} taşma yok`, await overflowOk(admin));
    await shot(admin, name);
  }
  // Açık temada metin kontrastı: ana metin ile zemin arasında yeterli fark olmalı
  const contrast = await admin.evaluate(() => {
    const lum = (c) => { const [r, g, b] = c.match(/\d+(\.\d+)?/g).slice(0, 3).map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
    const probe = (v) => { const d = document.createElement("div"); d.style.color = `var(${v})`; document.body.appendChild(d); const c = getComputedStyle(d).color; d.remove(); return lum(c); };
    const ratio = (a, b) => (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
    const card = probe("--color-card"), bg = probe("--color-bg");
    return { ink: ratio(probe("--color-ink"), card), muted: ratio(probe("--color-muted"), bg), faint: ratio(probe("--color-faint"), card), accent2: ratio(probe("--color-accent-2"), card), btn: ratio(1, probe("--color-accent")) };
  });
  check("açık tema: metin kontrastı yeterli (≥ 4.5; soluk ≥ 3)", contrast.ink >= 7 && contrast.muted >= 4.5 && contrast.accent2 >= 4.5 && contrast.btn >= 4.5 && contrast.faint >= 3, JSON.stringify(contrast));
  await admin.goto(`${BASE}/profil`);
  await admin.getByRole("radio", { name: "Koyu" }).click();
  const darkContrast = await admin.evaluate(() => {
    const lum = (c) => { const [r, g, b] = c.match(/\d+(\.\d+)?/g).slice(0, 3).map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
    const probe = (v) => { const d = document.createElement("div"); d.style.color = `var(${v})`; document.body.appendChild(d); const c = getComputedStyle(d).color; d.remove(); return lum(c); };
    const ratio = (a, b) => (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
    const card = probe("--color-card");
    return { muted: ratio(probe("--color-muted"), card), faint: ratio(probe("--color-faint"), card), btn: ratio(1, probe("--color-accent")) };
  });
  check("koyu tema: metin kontrastı yeterli", darkContrast.muted >= 4.5 && darkContrast.faint >= 3 && darkContrast.btn >= 4.5, JSON.stringify(darkContrast));
  await mAdmin.getByRole("button", { name: "Koyu temaya geç" }).click();

  section("Pasif hesap ve çıkış");
  await admin.goto(`${BASE}/yonetim/uyeler`);
  await admin.getByRole("button", { name: "Mert Aydın üyesini düzenle" }).first().click();
  await admin.locator('#member-edit input[name="is_active"]').uncheck();
  await admin.getByRole("button", { name: "Kaydet" }).click();
  check("yönetici üyeyi pasifleştirir", await visible(admin.getByText("Üye bilgileri güncellendi.")));
  await other.goto(`${BASE}/gorevler`);
  check("pasif üye 'Hesabınız aktif değil' ekranını görür", await visible(other.getByText("Hesabınız aktif değil")));
  await shot(other, "26-pasif-hesap");
  await member.goto(`${BASE}/profil`);
  await visible(member.getByText("Kişisel bilgiler"));
  await shot(member, "27-profil");
  await member.getByRole("button", { name: "Çıkış yap" }).click();
  await member.waitForURL(/\/giris$/);
  check("çıkış yapılır", true);

  section("Tarayıcı hataları");
  check("konsol/sayfa hatası yok", errors.length === 0, errors.slice(0, 5).join(" || "));
} catch (e) {
  check(`test akışı tamamlandı`, false, e.message.split("\n")[0]);
  console.error(e);
} finally {
  await browser.close();
}
finish();
