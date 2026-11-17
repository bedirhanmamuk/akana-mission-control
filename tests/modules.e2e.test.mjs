// =============================================================================
// AKANA MISSION CONTROL — yeni modüllerin tarayıcı testleri (masaüstü + mobil)
// Kontrol merkezi, global arama, görev ayrıntısı (yorum, ilerleme, bloke,
// geçmiş), Kanban, projeler, Gantt, takvim, doküman merkezi (STL yükleme +
// onay), risk matrisi, analitik + YZ, ekip, organizasyon, bildirim tercihleri.
// Önkoşul: `npm run local:up` + `npm run dev`. Mevcut veriye ek yapar; silmez.
// =============================================================================
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { chromium, devices } = require(process.env.PLAYWRIGHT_PATH ?? "playwright");
import { mkdirSync } from "node:fs";
import { check, finish, login, section, service, sql } from "./helpers.mjs";

const BASE = process.env.APP_URL ?? "http://127.0.0.1:5173";
const OUT = new URL("./.artifacts/modules/", import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });
const run = Date.now().toString(36);
const PW = `Modul-Sifre-${run}!3`;
const mail = (k) => `${k}.${run}@akana.test`;
const today = sql("select private.today()::text");
const plus = (d) => sql(`select (private.today() + ${d})::text`);
const dept = (code) => sql(`select id from public.departments where code='${code}'`);
const MEK = dept("MEK"), AVY = dept("AVY");

async function makeUser(key, first, last, code, role = "MEMBER", extra = "") {
  const { data, error } = await service.auth.admin.createUser({ email: mail(key), password: PW, email_confirm: true, user_metadata: { first_name: first, last_name: last } });
  if (error) throw error;
  sql(`update public.profiles set is_active=true, role='${role}', department_id='${dept(code)}' ${extra} where id='${data.user.id}'`);
  return data.user.id;
}
const adminId = await makeUser("kaptan", "Ece", "Kaptan", "AVY", "ADMIN", ", team_position='CAPTAIN'");
const leadId = await makeUser("sorumlu", "Mert", "Sorumlu", "MEK");
const memberId = await makeUser("uye", "Zeynep", "Mekanik", "MEK", "MEMBER", ", skills='{SolidWorks,ANSYS}', university='İTÜ'");
const admin = await login(mail("kaptan"), PW);
await admin.from("departments").update({ lead_id: leadId }).eq("id", MEK);

// Örnek veri (gerçek API ile)
const { data: project } = await admin.from("projects").insert({ name: `Orta irtifa roketi ${run}`, target_date: plus(60), owner_id: leadId, department_id: MEK }).select().single();
const mk = async (title, dep, ids, extra = {}) => (await admin.rpc("create_task", { p_title: title, p_description: "Test görevi", p_department_id: dep, p_start_date: today, p_due_date: plus(12), p_priority: "HIGH", p_required_file_types: [], p_notes: "", p_assignee_ids: ids, p_project_id: project.id, ...extra })).data;
const tA = await mk(`Gövde montajı ${run}`, MEK, [memberId], { p_difficulty: 4 });
const tB = await mk(`Aviyonik entegrasyon ${run}`, AVY, [adminId]);
const tC = await mk(`Burun konisi kalıbı ${run}`, MEK, [memberId, leadId]);
await admin.rpc("add_task_dependency", { p_task_id: tB.id, p_depends_on_id: tA.id });
sql(`update public.tasks set start_date = private.today() - 20, due_date = private.today() - 3 where id='${tC.id}'`);
await admin.rpc("process_deadlines");
const member = await login(mail("uye"), PW);
await member.rpc("set_task_blocked", { p_task_id: tA.id, p_blocked: true, p_reason: "Alüminyum levha tedarik bekleniyor" });
await member.from("risks").insert({ title: `Paraşüt açılmama ${run}`, probability: 4, impact: 5, department_id: MEK, project_id: project.id });

const browser = await chromium.launch();
const errors = [];
async function newPage(opts = {}) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: "tr-TR", ...opts });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
  page.on("console", (m) => { if (m.type() === "error" && !/Failed to load resource/.test(m.text())) errors.push(`console ${page.url()}: ${m.text()}`); });
  return page;
}
async function signIn(page, email) {
  await page.goto(`${BASE}/giris`);
  await page.fill('input[name="email"]', email);
  await page.fill('input[name="password"]', PW);
  await page.click('button[type="submit"]');
  await page.getByRole("heading", { name: "Kontrol Merkezi" }).waitFor({ timeout: 10000 });
}
const visible = (loc, timeout = 8000) => loc.first().waitFor({ state: "visible", timeout }).then(() => true, () => false);
const noOverflow = (page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
const shot = (page, name) => page.screenshot({ path: `${OUT}${name}.png`, fullPage: true });

const ROUTES = [
  ["/", "Kontrol Merkezi"], ["/gorevler", "Görevler"], ["/projeler", "Projeler"], [`/projeler/${project.id}`, project.name],
  ["/takvim", "Takvim"], ["/zaman-cizelgesi", "Zaman Çizelgesi"], ["/dokumanlar", "Doküman Merkezi"], ["/riskler", "Risk Yönetimi"],
  ["/departmanlar", "Departmanlar"], [`/departmanlar/${MEK}`, "Mekanik"], ["/ekip", "Ekip"], [`/ekip/${memberId}`, "Zeynep Mekanik"],
  ["/organizasyon", "Organizasyon Şeması"], [`/gorevler/${tA.id}`, tA.title], ["/bildirimler", "Bildirimler"], ["/profil", "Profil ve Ayarlar"],
];

try {
  section("Masaüstü — yönetici");
  const a = await newPage();
  await signIn(a, mail("kaptan"));
  check("kontrol merkezi: özet şeridi, proje paneli, kritik operasyonlar", await visible(a.getByTestId("admin-stats")) && await visible(a.getByTestId("project-progress").getByText(project.name)) && await visible(a.getByTestId("critical-ops").getByText(tA.title)));
  check("kontrol merkezi: bloke ve geciken görev kritikte; aktivite akışı dolu", await visible(a.getByTestId("critical-ops").getByText(tC.title)) && await visible(a.getByTestId("activity-feed")));
  await a.waitForTimeout(800); await shot(a, "01-kontrol-merkezi");

  await a.keyboard.press("Control+k");
  await a.getByRole("combobox", { name: "Arama metni" }).fill(tB.code);
  check("global arama (Ctrl+K) görevi bulur", await visible(a.getByTestId("search-result").filter({ hasText: tB.code })));
  await a.keyboard.press("Enter");
  await a.waitForURL(new RegExp(`/gorevler/${tB.id}`));
  check("arama sonucu Enter ile göreve gider", true);
  check("görev ayrıntısı: departmanlar arası ön koşul görünür", await visible(a.getByText(tA.code).first()) && await visible(a.getByText(/ön koşul görevi henüz tamamlanmadı/)));
  await shot(a, "02-gorev-bagimlilik");

  await a.goto(`${BASE}/gorevler/${tA.id}`);
  check("bloke görevde neden bandı", await visible(a.getByTestId("blocked-banner").getByText(/Alüminyum/)));
  await a.getByRole("textbox", { name: "Yorum" }).fill("Levha pazartesi geliyor, montaja salı başlarız.");
  await a.getByRole("button", { name: "Yorumu gönder" }).click();
  check("yorum gönderilir ve listelenir", await visible(a.getByTestId("comment-item").filter({ hasText: "Levha pazartesi" })));
  await a.getByRole("button", { name: "Blokajı kaldır" }).click();
  check("blokaj kaldırılır", await visible(a.getByText("Blokaj kaldırıldı.")));
  const slider = a.getByRole("slider", { name: "İlerleme yüzdesi" });
  await slider.focus(); for (let i = 0; i < 9; i++) await a.keyboard.press("ArrowRight");
  await a.getByRole("button", { name: "İlerlemeyi güncelle" }).click();
  check("ilerleme güncellenir (%45)", await visible(a.getByText("İlerleme %45 olarak kaydedildi.")) && sql(`select progress from public.tasks where id='${tA.id}'`) === "45");
  await a.getByRole("button", { name: "Göster" }).click();
  check("görev geçmişi: bloke, yorum ve ilerleme kayıtları", await visible(a.getByTestId("task-history").getByText(/ilerlemesi %0 → %45/)) && await visible(a.getByTestId("task-history").getByText(/yorum yapıldı/)));
  await shot(a, "03-gorev-detay");

  await a.goto(`${BASE}/gorevler`);
  await a.getByRole("button", { name: "Kanban görünümü" }).click();
  check("Kanban görünümü sütunlarla açılır", await visible(a.getByTestId("task-board")) && await visible(a.getByRole("region", { name: "Bloke sütunu" })));
  await shot(a, "04-kanban");
  await a.getByRole("button", { name: "Kart görünümü" }).click();
  await a.goto(`${BASE}/gorevler?filtre=geciken`);
  await visible(a.getByTestId("task-item"));
  const lateItems = await a.getByTestId("task-item").allInnerTexts();
  check("hızlı filtre (geciken) yalnızca geciken görevleri gösterir", lateItems.length >= 1 && lateItems.every((t) => !t.includes(tB.code)) && lateItems.some((t) => t.includes(tC.code)));
  await a.getByRole("button", { name: /Filtreler/ }).click();
  await a.getByRole("combobox", { name: "Departmana göre filtrele" }).selectOption(AVY);
  check("gelişmiş filtre panelini açar ve uygular", await visible(a.getByText(/0 görev|1 görev/)));

  await a.goto(`${BASE}/zaman-cizelgesi`);
  check("Gantt: çubuklar ve bağımlılık oku çizilir", await visible(a.getByTestId("gantt")) && (await a.getByTestId("gantt-bar").count()) >= 3 && (await a.locator('[data-testid="gantt"] svg path[marker-end]').count()) >= 1);
  await shot(a, "05-gantt");

  await a.goto(`${BASE}/takvim`);
  check("takvim aylık görünüm ve teslim tarihleri", await visible(a.getByTestId("calendar-month")));
  await a.getByRole("button", { name: "Etkinlik ekle" }).first().click();
  await a.fill('input[name="event-title"]', `Kritik tasarım incelemesi ${run}`);
  await a.getByRole("dialog").getByRole("button", { name: "Kaydet" }).click();
  check("yönetici takvime etkinlik ekler", await visible(a.getByText("Etkinlik takvime eklendi.")) && sql(`select count(*) from public.events where title='Kritik tasarım incelemesi ${run}'`) === "1");
  await a.getByRole("tab", { name: "Hafta" }).click();
  check("haftalık görünüm", await visible(a.getByTestId("calendar-week")));
  await a.getByRole("tab", { name: "Gün" }).click();
  check("günlük görünüm", await visible(a.getByTestId("calendar-day")));
  await shot(a, "06-takvim");

  await a.goto(`${BASE}/riskler`);
  check("risk matrisi ve kritik risk satırı", await visible(a.getByTestId("risk-matrix")) && await visible(a.getByTestId("risk-row").filter({ hasText: `Paraşüt açılmama ${run}` })));
  await a.getByRole("button", { name: /^Olasılık 4, etki 5, puan 20/ }).click();
  check("matris hücresi listeyi süzer", (await a.getByTestId("risk-row").count()) >= 1);
  await a.getByRole("button", { name: "Risk kaydet" }).first().click();
  await a.fill('input[name="risk-title"]', `Motor tedarik gecikmesi ${run}`);
  await a.getByRole("radiogroup", { name: "Olasılık" }).getByRole("radio", { name: "2" }).click();
  await a.getByRole("dialog").getByRole("button", { name: "Riski kaydet" }).click();
  check("risk formu kaydeder ve detayına gider", await visible(a.getByRole("heading", { name: `Motor tedarik gecikmesi ${run}` })));
  await shot(a, "07-risk");

  await a.goto(`${BASE}/analitik`);
  check("analitik: metrikler, üye iş yükü, haftalık rapor", await visible(a.getByTestId("analytics-kpis")) && await visible(a.getByTestId("member-workload")) && await visible(a.getByTestId("weekly-report")));
  await a.getByRole("button", { name: "Analiz üret" }).click();
  check("YZ modülü anahtar yokken açık uyarı verir (sahte çıktı yok)", await visible(a.getByTestId("ai-error").getByText(/yapılandırılmamış/), 20000), await a.getByTestId("ai-error").innerText().catch(() => ""));
  await shot(a, "08-analitik");

  await a.goto(`${BASE}/organizasyon`);
  check("organizasyon şeması: kaptan ve departman sorumlusu", await visible(a.getByTestId("org-chart").getByText("Ece Kaptan")) && await visible(a.getByTestId("org-chart").getByText("Mert Sorumlu")));
  await a.goto(`${BASE}/ekip`);
  await a.getByRole("textbox", { name: "Ekipte ara" }).fill("ansys");
  const found = await visible(a.getByTestId("team-card").filter({ hasText: "Zeynep Mekanik" }));
  const cards = await a.getByTestId("team-card").allInnerTexts();
  check("ekip araması yetkinlikle bulur (yalnızca eşleşenler listelenir)", found && cards.length >= 1 && cards.every((c) => /ANSYS/i.test(c)), String(cards.length));

  for (const [path, heading] of ROUTES) {
    await a.goto(`${BASE}${path}`);
    const ok = await visible(a.getByRole("heading", { name: heading }).first(), 10000);
    check(`PC ${path}: açılır, başlık "${heading.slice(0, 24)}", taşma yok`, ok && await noOverflow(a));
  }
  await a.goto(`${BASE}/departmanlar/${MEK}`); await a.waitForTimeout(600); await shot(a, "09-departman");

  section("Mobil — üye ve doküman onayı");
  const m = await newPage({ ...devices["iPhone 13"], locale: "tr-TR" });
  await signIn(m, mail("uye"));
  check("mobil kontrol merkezi (üye kapsamı)", await visible(m.getByTestId("mission-stats")));
  await m.getByRole("button", { name: "Ara" }).click();
  await m.getByRole("combobox", { name: "Arama metni" }).fill(tB.code);
  await m.waitForTimeout(800);
  check("mobil arama: başka departmanın görevi aramada çıkmaz", (await m.getByTestId("search-result").filter({ hasText: tB.code }).count()) === 0);
  await m.getByRole("button", { name: "Aramayı kapat" }).click();

  await m.goto(`${BASE}/dokumanlar?gorev=${tA.id}&yeni=1`);
  const stl = { name: "govde-rev-a.stl", mimeType: "application/octet-stream", buffer: Buffer.concat([Buffer.from("solid govde\n"), Buffer.alloc(4096, 32)]) };
  await m.getByTestId("doc-file-input").setInputFiles(stl);
  await m.getByRole("dialog").getByRole("button", { name: "Yükle ve onaya gönder" }).click();
  check("mobilde STL yüklenir, V1 onay bekler", await visible(m.getByTestId("document-versions").getByText("govde-rev-a.stl"), 15000) && await visible(m.getByText("Onay bekliyor")));
  const docUrl = m.url();
  await shot(m, "10-mobil-dokuman");

  for (const [path, heading] of ROUTES.filter(([p]) => p !== `/projeler/${project.id}`)) {
    await m.goto(`${BASE}${path}`);
    const ok = await visible(m.getByRole("heading", { name: heading }).first(), 10000);
    check(`mobil ${path}: açılır, yatay taşma yok`, ok && await noOverflow(m));
  }
  await m.goto(`${BASE}/zaman-cizelgesi`); await m.waitForTimeout(500); await shot(m, "11-mobil-gantt");
  await m.goto(`${BASE}/takvim`); await m.waitForTimeout(500); await shot(m, "12-mobil-takvim");
  await m.goto(`${BASE}/gorevler`); await m.getByRole("button", { name: "Kanban görünümü" }).click(); await m.waitForTimeout(300);
  check("mobil Kanban yatay kayar, sayfa taşmaz", await visible(m.getByTestId("task-board")) && await noOverflow(m));
  await shot(m, "13-mobil-kanban");
  await m.goto(`${BASE}/`); await m.waitForTimeout(800); await shot(m, "14-mobil-kontrol-merkezi");
  await m.goto(`${BASE}/analitik`);
  check("üye analitik ekranına giremez (yetkisiz)", await visible(m.getByText("Yetkisiz erişim")));

  await m.goto(`${BASE}/bildirimler`);
  const sw = m.getByRole("switch", { name: "Yeni yorum bildirimleri" });
  await sw.uncheck();
  await m.waitForTimeout(600);
  check("bildirim tercihi kapatılır ve kaydedilir", sql(`select enabled::text from public.notification_preferences where user_id='${memberId}' and type='TASK_COMMENT'`) === "false");

  section("Departman sorumlusu — doküman onayı");
  const l = await newPage();
  await signIn(l, mail("sorumlu"));
  check("sorumlu menüde Analitik ve Görev Oluştur görür, Üye Yönetimi görmez", await visible(l.getByRole("link", { name: "Performans ve Analitik" })) && await visible(l.getByRole("link", { name: "Görev Oluştur" })) && (await l.getByRole("link", { name: "Üye Yönetimi" }).count()) === 0);
  await l.goto(docUrl);
  await l.getByTestId("document-review").getByRole("button", { name: "Onayla" }).click();
  await l.getByRole("dialog").getByRole("button", { name: "Onayla" }).click();
  check("sorumlu dokümanı onaylar", await visible(l.getByText("Doküman onaylandı.")));
  await l.goto(`${BASE}/yonetim/uyeler`);
  check("sorumlu yönetici sayfasına giremez", await visible(l.getByText("Yetkisiz erişim")));

  section("Açık tema — yeni sayfalar");
  await a.goto(`${BASE}/profil`);
  await a.getByRole("radio", { name: "Açık" }).click();
  for (const p of ["/", "/zaman-cizelgesi", "/riskler", "/analitik", "/takvim"]) {
    await a.goto(`${BASE}${p}`); await a.waitForTimeout(700);
    check(`açık tema ${p}: taşma yok`, await noOverflow(a));
  }
  await shot(a, "15-acik-kontrol-merkezi");
  await a.goto(`${BASE}/profil`); await a.getByRole("radio", { name: "Koyu" }).click();

  section("Tarayıcı hataları");
  check("konsol/sayfa hatası yok", errors.length === 0, errors.slice(0, 5).join(" || "));
} catch (e) {
  check("test akışı tamamlandı", false, e.message.split("\n")[0]);
  console.error(e);
} finally {
  await browser.close();
}
finish();
