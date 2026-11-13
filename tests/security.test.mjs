// =============================================================================
// AKANA MISSION CONTROL — API / RLS / Storage güvenlik ve iş akışı testleri
// Gerçek Supabase servislerine (yerel yığın) karşı çalışır:  npm run test:security
// Her çalıştırmada benzersiz kullanıcılar üretir; temiz bir yığın gerektirir
// (ilk yönetici kurulumu test edildiği için):  npm run local:up
// =============================================================================
import { anon, check, env, finish, login, MIME, sampleFile, section, service, sha256, sql } from "./helpers.mjs";

const run = Date.now().toString(36);
const PW = "Test-Sifre-" + run + "!9";
const mail = (n) => `${n}.${run}@akana.test`;

async function fn(client, body) {
  const { data: s } = await client.auth.getSession();
  const res = await fetch(`${env.SUPABASE_URL}/functions/v1/admin-users`, {
    method: "POST",
    headers: { "content-type": "application/json", apikey: env.ANON_KEY, ...(s.session ? { authorization: `Bearer ${s.session.access_token}` } : {}) },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: await res.json().catch(() => ({})) };
}

async function upload(client, taskId, name, buf, mime, userId = client.userId) {
  const path = `${taskId}/${userId}/${crypto.randomUUID()}/${name}`;
  const { error } = await client.storage.from("reports").upload(path, buf, { contentType: mime, upsert: false });
  return { path, error };
}

async function submit(client, taskId, title, files, note = "") {
  return client.rpc("submit_report", { p_task_id: taskId, p_title: title, p_description: "Test raporu", p_note: note, p_files: files });
}

// ---------------------------------------------------------------------------
section("0. Anonim erişim ve kendi kendine kayıt");
{
  const a = anon();
  const r1 = await a.from("profiles").select("*");
  check("anon: profiles okunamaz", r1.error !== null || (r1.data ?? []).length === 0);
  const r2 = await a.from("tasks").select("*");
  check("anon: tasks okunamaz", r2.error !== null || (r2.data ?? []).length === 0);
  const r3 = await a.rpc("dashboard_stats");
  check("anon: dashboard_stats çağrılamaz", r3.error !== null);
  const r4 = await a.storage.from("reports").list();
  check("anon: storage listelenemez", r4.error !== null || (r4.data ?? []).length === 0);
  const r5 = await a.auth.signUp({ email: mail("hacker"), password: PW, options: { data: { role: "ADMIN" } } });
  check("herkese açık kayıt kapalı", r5.error !== null, r5.error?.message);
  const r6 = await fn(a, { action: "create", email: mail("x"), password: PW, first_name: "X", last_name: "Y", role: "ADMIN" });
  check("admin-users: oturumsuz çağrı 401", r6.status === 401);
}

// ---------------------------------------------------------------------------
section("1. İlk yönetici kurulumu ve giriş (Kabul #1)");
const adminEmail = mail("yonetici");
{
  const { data, error } = await service.auth.admin.createUser({ email: adminEmail, password: PW, email_confirm: true, user_metadata: { first_name: "Ana", last_name: "Yönetici", role: "ADMIN" } });
  check("auth kullanıcısı oluşturuldu", !error && data.user, error?.message);
  const row = sql(`select role || ':' || is_active from public.profiles where id = '${data.user.id}'`);
  check("yeni hesap MEMBER ve PASİF başlar (metadata'daki role yok sayılır)", row === "MEMBER:false", row);

  const pre = await login(adminEmail, PW);
  const r = await pre.from("departments").select("*");
  check("pasif hesap veri göremez", (r.data ?? []).length === 0);
  const esc = await pre.from("profiles").update({ role: "ADMIN", is_active: true }).eq("id", pre.userId).select();
  check("pasif hesap kendini yönetici yapamaz", (esc.data ?? []).length === 0);
  const rpcBoot = await pre.rpc("bootstrap_first_admin", { p_email: adminEmail });
  check("bootstrap_first_admin API'den çağrılamaz", rpcBoot.error !== null);

  const existing = sql(`select count(*) from public.profiles where role = 'ADMIN'`);
  if (existing === "0") {
    const out = sql(`select private.bootstrap_first_admin('${adminEmail}')`);
    check("ilk yönetici SQL ile kuruldu", out.includes("İlk yönetici atandı"), out);
    let second = "";
    try { second = sql(`select private.bootstrap_first_admin('${adminEmail}')`); } catch (e) { second = String(e.stderr ?? e.message); }
    check("ikinci bootstrap reddedilir", second.includes("zaten bir yönetici var"), second);
  } else {
    sql(`update public.profiles set role='ADMIN', is_active=true where id='${data.user.id}'`);
    console.log("  (yığın temiz değil: bootstrap adımı atlandı)");
  }
}
const admin = await login(adminEmail, PW);
{
  const { data } = await admin.from("profiles").select("role,is_active").eq("id", admin.userId).single();
  check("yönetici giriş yaptı ve rolü ADMIN", data?.role === "ADMIN" && data?.is_active === true);
}

// ---------------------------------------------------------------------------
section("2. Üye oluşturma (Kabul #2)");
const { data: depts } = await admin.from("departments").select("*").order("name");
check("6 başlangıç departmanı mevcut", depts.length === 6, String(depts.length));
const MEK = depts.find((d) => d.code === "MEK");
const AVY = depts.find((d) => d.code === "AVY");
const members = {};
for (const [key, first, dep] of [["a", "Ayşe", MEK], ["b", "Burak", AVY], ["c", "Cem", MEK]]) {
  const r = await fn(admin, { action: "create", email: mail(key), password: PW, first_name: first, last_name: "Test", role: "MEMBER", department_id: dep.id });
  check(`yönetici üye oluşturdu: ${first} (${dep.name})`, r.status === 200 && r.body.profile?.is_active === true, JSON.stringify(r.body));
  members[key] = await login(mail(key), PW);
}
const [A, B, C] = [members.a, members.b, members.c];
{
  const dup = await fn(admin, { action: "create", email: mail("a"), password: PW, first_name: "D", last_name: "D", role: "MEMBER" });
  check("aynı e-posta ile ikinci üye reddedilir", dup.status === 400, JSON.stringify(dup.body));
  const r = await fn(A, { action: "create", email: mail("z"), password: PW, first_name: "Z", last_name: "Z", role: "ADMIN" });
  check("üye admin-users ile hesap oluşturamaz (403)", r.status === 403);
  const r2 = await fn(A, { action: "reset_password", user_id: admin.userId, password: "ele-gecirildi-123" });
  check("üye yöneticinin şifresini sıfırlayamaz (403)", r2.status === 403);
}

// ---------------------------------------------------------------------------
section("3. Yetki yükseltme denemeleri");
{
  const r1 = await A.from("profiles").update({ role: "ADMIN" }).eq("id", A.userId).select();
  check("üye kendi rolünü değiştiremez", (r1.data ?? []).length === 0);
  const r2 = await A.from("profiles").update({ first_name: "Hack" }).eq("id", B.userId).select();
  check("üye başkasının profilini değiştiremez", (r2.data ?? []).length === 0);
  const r3 = await A.from("profiles").select("id");
  check("üye yalnızca kendi profil satırını görür", r3.data?.length === 1 && r3.data[0].id === A.userId, JSON.stringify(r3.data));
  const r4 = await A.from("profiles").insert({ id: crypto.randomUUID(), email: "x@x.co", role: "ADMIN", is_active: true });
  check("üye profil satırı ekleyemez", r4.error !== null);
  const r5 = await A.rpc("update_own_profile", { p_first_name: "Ayşe Nur", p_last_name: "Test" });
  const after = await A.from("profiles").select("first_name,role").eq("id", A.userId).single();
  check("üye kendi adını güncelleyebilir (rol değişmez)", !r5.error && after.data.first_name === "Ayşe Nur" && after.data.role === "MEMBER");
  const r6 = await A.from("directory").select("*");
  check("dizin görünümü e-posta/rol sızdırmaz", r6.data.length >= 4 && !("email" in r6.data[0]) && !("role" in r6.data[0]));
  for (const [name, call] of [
    ["dashboard_stats", () => A.rpc("dashboard_stats")],
    ["set_max_file_size_mb", () => A.rpc("set_max_file_size_mb", { p_mb: 500 })],
    ["create_task", () => A.rpc("create_task", { p_title: "Hack görev", p_description: "", p_department_id: MEK.id, p_start_date: "2026-01-01", p_due_date: "2026-12-31", p_priority: "LOW", p_required_file_types: [], p_notes: "", p_assignee_ids: [A.userId] })],
  ]) {
    const r = await call();
    check(`üye ${name} çağıramaz`, r.error !== null);
  }
  const r7 = await A.from("departments").insert({ name: "Sahte", code: "SHT" });
  check("üye departman ekleyemez", r7.error !== null);
  const r8 = await A.from("departments").update({ lead_id: A.userId }).eq("id", MEK.id).select();
  check("üye departman sorumlusu atayamaz", (r8.data ?? []).length === 0);
  const r9 = await A.from("activity_logs").select("id");
  check("üye sistem kayıtlarını göremez", (r9.data ?? []).length === 0);
  const r10 = await A.from("notifications").insert({ user_id: B.userId, type: "TASK_ASSIGNED", title: "sahte" });
  check("üye bildirim üretemez", r10.error !== null);
}

// ---------------------------------------------------------------------------
section("4. Görev oluşturma ve atama (Kabul #3, #4)");
const future = new Date(Date.now() + 20 * 86400000).toISOString().slice(0, 10);
const today = new Date().toISOString().slice(0, 10);
const mk = (title, dep, ids) => admin.rpc("create_task", { p_title: title, p_description: "Açıklama", p_department_id: dep.id, p_start_date: today, p_due_date: future, p_priority: "HIGH", p_required_file_types: ["pdf"], p_notes: "", p_assignee_ids: ids });
const seqBefore = Number(sql(`select task_seq from public.departments where code='MEK'`));
const t1 = (await mk("Gövde yapısal analizi", MEK, [A.userId])).data;
const t2 = (await mk("Uçuş bilgisayarı testi", AVY, [B.userId])).data;
const t3 = (await mk("Kanatçık üretimi", MEK, [C.userId])).data;
check("görev kodu otomatik ve biçimli (AK-MEK-NNN)", t1?.code === `AK-MEK-${String(seqBefore + 1).padStart(3, "0")}`, t1?.code);
check("aynı departmanda kod artar", t3?.code === `AK-MEK-${String(seqBefore + 2).padStart(3, "0")}`, t3?.code);
check("farklı departman kendi sayacını kullanır", /^AK-AVY-\d{3}$/.test(t2?.code ?? ""), t2?.code);
{
  const burst = await Promise.all(Array.from({ length: 8 }, (_, i) => mk(`Eşzamanlı görev ${i}`, AVY, [B.userId])));
  const codes = burst.map((r) => r.data?.code);
  check("eşzamanlı oluşturmada kodlar benzersiz", new Set(codes).size === 8 && codes.every(Boolean), codes.join(","));
  const bad = await admin.rpc("create_task", { p_title: "Geçersiz tarih", p_description: "", p_department_id: MEK.id, p_start_date: future, p_due_date: today, p_priority: "LOW", p_required_file_types: [], p_notes: "", p_assignee_ids: [A.userId] });
  check("teslim < başlangıç reddedilir", bad.error !== null);
  const upd = await admin.from("tasks").update({ code: "AK-XXX-999" }).eq("id", t1.id);
  check("görev kodu sonradan değiştirilemez", upd.error !== null);

  const aTasks = (await A.from("tasks").select("id,code")).data;
  const aIds = aTasks.map((t) => t.id);
  check("üye A: kendi görevi + departman görevini görür", aIds.includes(t1.id) && aIds.includes(t3.id));
  check("üye A: başka departmanın görevini göremez", !aIds.includes(t2.id) && aTasks.every((t) => t.code.startsWith("AK-MEK")), aTasks.map((t) => t.code).join(","));
  const direct = await A.from("tasks").select("id").eq("id", t2.id);
  check("üye A: başka departman görevine kimlikle de erişemez", (direct.data ?? []).length === 0);
  const assn = await A.from("task_assignees").select("task_id").eq("task_id", t2.id);
  check("üye A: başka departman görevinin sorumlularını göremez", (assn.data ?? []).length === 0);
  const n = await A.from("notifications").select("type,is_read,title").eq("type", "TASK_ASSIGNED");
  check("atama bildirimi oluştu (A)", n.data.length === 1 && n.data[0].is_read === false);
  const st = await A.from("tasks").update({ status: "COMPLETED" }).eq("id", t1.id).select();
  check("üye görev durumunu doğrudan değiştiremez", (st.data ?? []).length === 0);
  const del = await A.from("tasks").delete().eq("id", t1.id).select();
  check("üye görev silemez", (del.data ?? []).length === 0);
  const s1 = await A.rpc("start_task", { p_task_id: t1.id });
  const s2 = await A.rpc("start_task", { p_task_id: t3.id });
  const stt = await admin.from("tasks").select("id,status").in("id", [t1.id, t3.id]);
  check("üye kendi görevini başlatır; başkasınınkini başlatamaz", !s1.error && s2.error !== null && stt.data.find((t) => t.id === t1.id).status === "IN_PROGRESS" && stt.data.find((t) => t.id === t3.id).status === "NEW");
}

// ---------------------------------------------------------------------------
section("5. Dosya yükleme ve Storage (Kabul #5, #6, #7)");
const pdf1 = sampleFile("pdf");
const docx1 = sampleFile("docx");
const xlsx1 = sampleFile("xlsx");
let reportA;
{
  const u1 = await upload(A, t1.id, "01-analiz.pdf", pdf1, MIME.pdf);
  check("üye PDF yükledi (Storage)", !u1.error, u1.error?.message);
  const u2 = await upload(A, t1.id, "02-rapor.docx", docx1, MIME.docx);
  const u3 = await upload(A, t1.id, "03-veri.xlsx", xlsx1, MIME.xlsx);
  check("üye Word ve Excel yükledi (Storage)", !u2.error && !u3.error, u2.error?.message ?? u3.error?.message);

  const s = await submit(A, t1.id, "Gövde analizi raporu", [
    { path: u1.path, name: "Gövde Analizi.pdf", sha256: sha256(pdf1) },
    { path: u2.path, name: "Rapor.docx", sha256: sha256(docx1) },
    { path: u3.path, name: "Veri.xlsx", sha256: sha256(xlsx1) },
  ]);
  check("rapor V1 kaydedildi", !s.error && s.data?.version_number === 1, s.error?.message);
  reportA = s.data?.report_id;

  const objs = sql(`select count(*) from storage.objects where bucket_id='reports' and name like '${t1.id}/%'`);
  check("dosyalar gerçekten Storage'da (storage.objects = 3)", objs === "3", objs);
  const bucket = sql(`select public::text || ':' || file_size_limit from storage.buckets where id='reports'`);
  check("bucket özel ve 25 MB sınırlı", bucket === `false:${25 * 1024 * 1024}`, bucket);
  const pub = await fetch(`${env.SUPABASE_URL}/storage/v1/object/public/reports/${u1.path}`);
  check("herkese açık URL ile erişilemez", pub.status >= 400, String(pub.status));
  const meta = await A.from("report_files").select("size_bytes,mime_type,extension").eq("report_id", reportA).order("extension");
  check("boyut/MIME sunucudan okundu", meta.data.length === 3 && meta.data.find((f) => f.extension === "pdf").size_bytes === pdf1.length);
  const st = await admin.from("tasks").select("status").eq("id", t1.id).single();
  const rp = await A.from("reports").select("status,current_version").eq("id", reportA).single();
  check("rapor 'İnceleme bekliyor', görev 'İncelemede' (otomatik onay yok)", rp.data.status === "PENDING" && st.data.status === "IN_REVIEW");
  const nA = await A.from("notifications").select("id").eq("type", "REPORT_UPLOADED");
  const nAdm = await admin.from("notifications").select("id").eq("type", "REPORT_SUBMITTED");
  check("yükleme bildirimleri (üye + yönetici)", nA.data.length === 1 && nAdm.data.length >= 1);

  // Olumsuz senaryolar
  const exe = await upload(A, t1.id, "virus.exe", Buffer.from("MZ...."), "application/x-msdownload");
  check("izin verilmeyen uzantı/MIME reddedilir (.exe)", exe.error !== null);
  const disguised = await upload(A, t1.id, "virus.pdf", Buffer.from("MZ...."), "application/x-msdownload");
  check("izinli uzantı + yasak MIME reddedilir", disguised.error !== null);
  const mism = await upload(A, t1.id, "sahte.pdf", sampleFile("png"), MIME.png);
  let mismRes = { error: mism.error };
  if (!mism.error) mismRes = await submit(A, t1.id, "Sahte", [{ path: mism.path, name: "sahte.pdf", sha256: sha256(sampleFile("png")) }]);
  check("uzantı–MIME uyuşmazlığı sunucuda reddedilir", mismRes.error !== null, mismRes.error?.message);
  const big = await upload(A, t1.id, "buyuk.pdf", Buffer.concat([Buffer.from("%PDF-1.4\n"), Buffer.alloc(26 * 1024 * 1024)]), MIME.pdf);
  check("25 MB üstü dosya Storage tarafından reddedilir", big.error !== null, big.error?.message);
  const foreignTask = await upload(A, t2.id, "x.pdf", sampleFile("pdf"), MIME.pdf);
  check("atanmadığı göreve dosya yükleyemez", foreignTask.error !== null);
  const foreignFolder = await upload(A, t1.id, "x.pdf", sampleFile("pdf"), MIME.pdf, B.userId);
  check("başkasının klasörüne dosya yükleyemez", foreignFolder.error !== null);
  const over = await A.storage.from("reports").upload(u1.path, sampleFile("pdf"), { contentType: MIME.pdf, upsert: true });
  check("yüklenmiş dosyanın üzerine yazılamaz", over.error !== null);
  const rm = await A.storage.from("reports").remove([u1.path]);
  const still = sql(`select count(*) from storage.objects where name='${u1.path}'`);
  check("kayıtlı rapor dosyası üye tarafından silinemez", still === "1", JSON.stringify(rm.error));
  const fake = await submit(B, t2.id, "Çalıntı", [{ path: u1.path, name: "a.pdf", sha256: sha256(pdf1) }]);
  check("başkasının dosya yolu ile rapor gönderilemez", fake.error !== null, fake.error?.message);
  const ghost = await submit(A, t1.id, "Hayalet", [{ path: `${t1.id}/${A.userId}/${crypto.randomUUID()}/yok.pdf`, name: "yok.pdf", sha256: sha256(Buffer.from("x")) }]);
  check("Storage'da olmayan dosya ile rapor kaydedilemez", ghost.error !== null && /bulunamadı/.test(ghost.error.message), ghost.error?.message);
  const notAssigned = await submit(C, t1.id, "Yetkisiz", []);
  check("atanmamış üye rapor gönderemez", notAssigned.error !== null);
  const directIns = await A.from("reports").insert({ task_id: t3.id, uploaded_by: A.userId, title: "Doğrudan ekleme" });
  check("reports tablosuna doğrudan yazılamaz", directIns.error !== null);
  const directUpd = await A.from("reports").update({ status: "APPROVED" }).eq("id", reportA).select();
  check("üye kendi raporunu onaylayamaz (doğrudan güncelleme)", directUpd.error !== null || (directUpd.data ?? []).length === 0);
  const selfReview = await A.rpc("review_report", { p_report_id: reportA, p_action: "APPROVE", p_note: null });
  check("üye review_report çağıramaz", selfReview.error !== null);
}

// ---------------------------------------------------------------------------
section("6. Başkasının raporuna erişim (Kabul #13)");
const aFile = (await A.from("report_files").select("storage_path").eq("report_id", reportA).eq("extension", "pdf").single()).data.storage_path;
{
  for (const [who, cl] of [["farklı departman (B)", B], ["aynı departman (C)", C]]) {
    const r = await cl.from("reports").select("id").eq("id", reportA);
    const v = await cl.from("report_versions").select("id").eq("report_id", reportA);
    const f = await cl.from("report_files").select("id").eq("report_id", reportA);
    const o = await cl.from("report_overview").select("id").eq("id", reportA);
    check(`${who}: rapor/sürüm/dosya kayıtlarını göremez`, [r, v, f, o].every((x) => (x.data ?? []).length === 0));
    const signed = await cl.storage.from("reports").createSignedUrl(aFile, 60);
    check(`${who}: imzalı URL alamaz`, signed.error !== null);
    const dl = await cl.storage.from("reports").download(aFile);
    check(`${who}: dosyayı indiremez`, dl.error !== null);
  }
  const own = await A.storage.from("reports").createSignedUrl(aFile, 60);
  const got = own.data ? await fetch(own.data.signedUrl) : null;
  const buf = got ? Buffer.from(await got.arrayBuffer()) : Buffer.alloc(0);
  check("sahibi imzalı URL ile indirir ve içerik bozulmamış", got?.status === 200 && sha256(buf) === sha256(pdf1));
}

// ---------------------------------------------------------------------------
section("7. İnceleme, revizyon ve sürümleme (Kabul #8–#12)");
{
  const adm = await admin.storage.from("reports").createSignedUrl(aFile, 60);
  const got = adm.data ? await fetch(adm.data.signedUrl) : null;
  check("yönetici raporu görüntüleyebilir/indirebilir", got?.status === 200);
  const start = await admin.rpc("review_report", { p_report_id: reportA, p_action: "START", p_note: null });
  check("yönetici raporu incelemeye aldı", !start.error && start.data.status === "IN_REVIEW", start.error?.message);
  const blocked = await submit(A, t1.id, "İnceleme sırasında", []);
  check("inceleme sürerken yeni sürüm yüklenemez", blocked.error !== null);
  const noNote = await admin.rpc("review_report", { p_report_id: reportA, p_action: "REQUEST_REVISION", p_note: "   " });
  check("gerekçesiz revizyon isteği reddedilir", noNote.error !== null && /zorunlu/.test(noNote.error.message), noNote.error?.message);
  const rev = await admin.rpc("review_report", { p_report_id: reportA, p_action: "REQUEST_REVISION", p_note: "Emniyet katsayısı hesabı eksik." });
  check("yönetici revizyon istedi", !rev.error && rev.data.status === "REVISION_REQUESTED", rev.error?.message);
  const seen = await A.from("reports").select("status,review_note").eq("id", reportA).single();
  const tsk = await A.from("tasks").select("status").eq("id", t1.id).single();
  check("üye revizyon gerekçesini görür; görev 'Revizyon istendi'", seen.data.review_note === "Emniyet katsayısı hesabı eksik." && tsk.data.status === "REVISION_REQUESTED");
  const nRev = await A.from("notifications").select("id").eq("type", "REPORT_REVISION_REQUESTED");
  check("revizyon bildirimi oluştu", nRev.data.length === 1);

  const dupUp = await upload(A, t1.id, "01-analiz-ayni.pdf", pdf1, MIME.pdf);
  const dup = await submit(A, t1.id, "Aynı dosya", [{ path: dupUp.path, name: "ayni.pdf", sha256: sha256(pdf1) }]);
  check("aynı dosyanın tekrar yüklenmesi reddedilir", dup.error !== null && /daha önce yüklenmiş/.test(dup.error.message), dup.error?.message);
  const vAfterDup = await A.from("report_versions").select("version_number").eq("report_id", reportA);
  check("başarısız gönderim sürüm oluşturmaz (atomik)", vAfterDup.data.length === 1);
  const cleanup = await A.storage.from("reports").remove([dupUp.path]);
  const gone = sql(`select count(*) from storage.objects where name='${dupUp.path}'`);
  check("üye yarım kalan (bağlanmamış) yüklemesini temizleyebilir", !cleanup.error && gone === "0", gone);

  const pdf2 = sampleFile("pdf");
  const u = await upload(A, t1.id, "01-analiz-v2.pdf", pdf2, MIME.pdf);
  const s2 = await submit(A, t1.id, "Gövde analizi raporu", [{ path: u.path, name: "Gövde Analizi v2.pdf", sha256: sha256(pdf2) }], "Emniyet katsayısı eklendi");
  check("üye V2 yükledi", !s2.error && s2.data.version_number === 2, s2.error?.message);

  const vers = await A.from("report_versions").select("version_number,status,review_note,report_files(storage_path)").eq("report_id", reportA).order("version_number");
  check("V1 korunuyor: kayıt, gerekçe ve 3 dosyası duruyor",
    vers.data.length === 2 && vers.data[0].status === "REVISION_REQUESTED" && vers.data[0].review_note !== null && vers.data[0].report_files.length === 3 && vers.data[1].status === "PENDING");
  const oldOk = await A.storage.from("reports").download(aFile);
  check("V1 dosyası Storage'da duruyor ve indirilebiliyor", !oldOk.error && sha256(Buffer.from(await oldOk.data.arrayBuffer())) === sha256(pdf1));
  let tamper = "";
  try { sql(`delete from public.report_versions where report_id='${reportA}' and version_number=1`); } catch (e) { tamper = String(e.stderr ?? e.message); }
  check("sürüm kaydı veritabanı düzeyinde silinemez", /silinemez/.test(tamper), tamper.slice(0, 80));

  const ap = await admin.rpc("review_report", { p_report_id: reportA, p_action: "APPROVE", p_note: "Uygun." });
  const tsk2 = await admin.from("tasks").select("status").eq("id", t1.id).single();
  check("yönetici V2'yi onayladı; görev 'Onaylandı'", !ap.error && ap.data.status === "APPROVED" && tsk2.data.status === "APPROVED", ap.error?.message);
  const again = await admin.rpc("review_report", { p_report_id: reportA, p_action: "REJECT", p_note: "tekrar" });
  check("onaylanmış rapora ikinci karar verilemez", again.error !== null);
  const after = await submit(A, t1.id, "Onay sonrası", []);
  check("onaylı rapora yeni sürüm yüklenemez", after.error !== null);

  // Ret akışı (üye C)
  const pdfC = sampleFile("pdf");
  const uc = await upload(C, t3.id, "01-kanatcik.pdf", pdfC, MIME.pdf);
  const sc = await submit(C, t3.id, "Kanatçık raporu", [{ path: uc.path, name: "Kanatçık.pdf", sha256: sha256(pdfC) }]);
  const rej0 = await admin.rpc("review_report", { p_report_id: sc.data.report_id, p_action: "REJECT", p_note: "" });
  const rej = await admin.rpc("review_report", { p_report_id: sc.data.report_id, p_action: "REJECT", p_note: "Yanlış şablon." });
  const nRej = await C.from("notifications").select("id").eq("type", "REPORT_REJECTED");
  check("ret: gerekçe zorunlu, bildirim gider", rej0.error !== null && !rej.error && rej.data.status === "REJECTED" && nRej.data.length === 1);

  const done = await admin.from("tasks").update({ status: "COMPLETED" }).eq("id", t1.id).select().single();
  const nDone = await A.from("notifications").select("id").eq("type", "TASK_COMPLETED");
  check("görev tamamlandı + bildirim", done.data?.status === "COMPLETED" && done.data.completed_at !== null && nDone.data.length === 1);
  const delTask = await admin.from("tasks").delete().eq("id", t1.id);
  check("raporu olan görev silinemez (geçmiş korunur)", delTask.error !== null);
}

// ---------------------------------------------------------------------------
section("8. Bildirimler, teslim tarihleri, kayıtlar, ayarlar");
{
  const mine = await A.from("notifications").select("id,user_id,is_read");
  check("üye yalnızca kendi bildirimlerini görür", mine.data.length > 0 && mine.data.every((n) => n.user_id === A.userId));
  const mark = await A.from("notifications").update({ is_read: true, read_at: new Date().toISOString() }).eq("id", mine.data[0].id).select();
  check("üye bildirimini okundu işaretler", mark.data?.length === 1 && mark.data[0].is_read === true);
  const tamper = await A.from("notifications").update({ title: "değişti" }).eq("id", mine.data[0].id);
  check("bildirim içeriği değiştirilemez (yalnızca okundu alanı)", tamper.error !== null);
  const other = await B.from("notifications").update({ is_read: true }).eq("id", mine.data[0].id).select();
  check("başkasının bildirimi işaretlenemez", (other.data ?? []).length === 0);

  // Teslim tarihi: görev tarihini geçmişe çek (sunucu tarafı) ve kontrolü çalıştır
  sql(`update public.tasks set start_date = current_date - 10, due_date = current_date - 1 where id = '${t2.id}'`);
  const soon = (await mk("Yaklaşan teslim", AVY, [B.userId])).data;
  sql(`update public.tasks set due_date = (now() at time zone 'Europe/Istanbul')::date + 2 where id = '${soon.id}'`);
  const p1 = await B.rpc("process_deadlines");
  const p2 = await B.rpc("process_deadlines");
  const od = await admin.from("tasks").select("status").eq("id", t2.id).single();
  const nOver = await B.from("notifications").select("id").eq("type", "TASK_OVERDUE");
  const nSoon = await B.from("notifications").select("id").eq("type", "TASK_DUE_SOON");
  check("geciken görev OVERDUE olur", !p1.error && od.data.status === "OVERDUE", p1.error?.message);
  check("gecikme ve yaklaşan teslim bildirimleri tekrarsız üretilir", !p2.error && nOver.data.length === 1 && nSoon.data.length === 1, `${nOver.data.length}/${nSoon.data.length}`);
  const ext = await admin.from("tasks").update({ due_date: future }).eq("id", t2.id).select().single();
  check("teslim tarihi uzatılınca görev tekrar aktifleşir", ext.data?.status === "IN_PROGRESS");

  const stats = await admin.rpc("dashboard_stats");
  const d = stats.data;
  const realTasks = Number(sql("select count(*) from public.tasks"));
  const realAppr = Number(sql("select count(*) from public.reports where status='APPROVED'"));
  check("dashboard gerçek veriyle tutarlı", !stats.error && d.total_tasks === realTasks && d.approved_reports === realAppr && d.monthly_uploads.length === 12 && d.monthly_uploads.at(-1).count >= 3,
    JSON.stringify({ t: d?.total_tasks, realTasks }));
  const ds = await A.rpc("department_stats");
  check("üye yalnızca kendi departman istatistiğini alır", ds.data.length === 1 && ds.data[0].department_id === MEK.id);
  const dsAll = await admin.rpc("department_stats");
  check("yönetici tüm departman istatistiklerini alır", dsAll.data.length === 6);

  const logs = await admin.from("activity_logs").select("action,actor_id");
  const acts = new Set(logs.data.map((l) => l.action));
  const want = ["MEMBER_CREATED", "TASK_CREATED", "REPORT_SUBMITTED", "REPORT_START", "REPORT_REQUEST_REVISION", "REPORT_APPROVE", "REPORT_REJECT", "TASK_STATUS_CHANGED"];
  check("yönetici işlemleri kayıt altında", want.every((w) => acts.has(w)), want.filter((w) => !acts.has(w)).join(","));
  const logDel = await admin.from("activity_logs").delete().gt("id", 0);
  check("yönetici dahi kayıtları silemez", logDel.error !== null);

  const sz = await admin.rpc("set_max_file_size_mb", { p_mb: 30 });
  const lim = sql("select file_size_limit from storage.buckets where id='reports'");
  check("yönetici dosya sınırını değiştirir; bucket sınırı da güncellenir", !sz.error && lim === String(30 * 1024 * 1024), lim);
  await admin.rpc("set_max_file_size_mb", { p_mb: 25 });
}

// ---------------------------------------------------------------------------
section("9. Üye yönetimi: departman değişimi, pasifleştirme, son yönetici");
{
  const mv = await admin.from("profiles").update({ department_id: AVY.id }).eq("id", C.userId).select().single();
  const cTasks = (await C.from("tasks").select("id")).data.map((t) => t.id);
  check("departmanı değişen üye yeni departmanın görevlerini görür; atandığı eski görevi de görür", mv.data?.department_id === AVY.id && cTasks.includes(t2.id) && cTasks.includes(t3.id));

  const off = await admin.from("profiles").update({ is_active: false }).eq("id", B.userId).select().single();
  check("yönetici üyeyi pasifleştirdi", off.data?.is_active === false);
  const bT = await B.from("tasks").select("id");
  const bN = await B.from("notifications").select("id");
  const bD = await B.from("departments").select("id");
  const bUp = await upload(B, t2.id, "x.pdf", sampleFile("pdf"), MIME.pdf);
  check("pasif üyenin mevcut oturumu hiçbir veriye erişemez", [bT, bN, bD].every((r) => (r.data ?? []).length === 0) && bUp.error !== null);
  const bSelf = await B.from("profiles").select("is_active").eq("id", B.userId).single();
  check("pasif üye yalnızca kendi durumunu görebilir", bSelf.data?.is_active === false);

  const demote = await admin.from("profiles").update({ role: "MEMBER" }).eq("id", admin.userId);
  const self = await admin.from("profiles").select("role").eq("id", admin.userId).single();
  const admins = Number(sql("select count(*) from public.profiles where role='ADMIN' and is_active"));
  check("son aktif yönetici yetkisini kaybedemez", admins > 1 || (demote.error !== null && self.data.role === "ADMIN"), demote.error?.message);

  const pw = await fn(admin, { action: "reset_password", user_id: A.userId, password: PW + "x" });
  const relog = await login(mail("a"), PW + "x").then(() => true, () => false);
  check("yönetici şifre sıfırlar; üye yeni şifreyle girer", pw.status === 200 && relog);
}

finish();
