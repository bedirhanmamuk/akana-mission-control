// =============================================================================
// AKANA MISSION CONTROL — 0006/0007 modülleri: yetki, iş akışı ve RLS testleri
// Projeler, departman sorumlusu yetkileri, alt görev, bağımlılık, ilerleme,
// bloke, yorum, doküman merkezi, takvim, risk, bildirim tercihleri, analitik,
// global arama, aktivite akışı. Gerçek yerel yığına karşı:  npm run test:mission
// Her çalıştırmada benzersiz kullanıcılar üretir; mevcut veriye dokunmaz.
// =============================================================================
import { anon, check, env, finish, login, MIME, sampleFile, section, service, sha256, sql } from "./helpers.mjs";

const run = Date.now().toString(36);
const PW = "Gorev-Sifre-" + run + "!7";
const mail = (n) => `${n}.${run}@akana.test`;
const today = sql("select private.today()");
const plus = (d) => sql(`select (private.today() + ${d})::text`);

async function makeUser(key, first, last, deptCode, role = "MEMBER") {
  const { data, error } = await service.auth.admin.createUser({ email: mail(key), password: PW, email_confirm: true, user_metadata: { first_name: first, last_name: last } });
  if (error) throw error;
  sql(`update public.profiles set is_active = true, role = '${role}', department_id = (select id from public.departments where code = '${deptCode}') where id = '${data.user.id}'`);
  return login(mail(key), PW);
}

const dept = (code) => sql(`select id from public.departments where code = '${code}'`);
const MEK = dept("MEK");
const AVY = dept("AVY");

section("0. Hazırlık ve anonim erişim");
const admin = await makeUser("adm", "Kaptan", "Test", "MEK", "ADMIN");
const lead = await makeUser("lead", "Selin", "Sorumlu", "MEK");
const m1 = await makeUser("m1", "Can", "Mekanik", "MEK");
const m2 = await makeUser("m2", "Deniz", "Aviyonik", "AVY");
{
  const a = anon();
  for (const t of ["projects", "risks", "documents", "events", "task_comments", "project_overview"]) {
    const r = await a.from(t).select("*");
    check(`anon: ${t} okunamaz`, r.error !== null || (r.data ?? []).length === 0);
  }
  const s = await a.rpc("global_search", { p_query: "AK" });
  check("anon: global_search çağrılamaz", s.error !== null);
}

section("1. Departmanlar ve departman sorumlusu");
{
  const names = sql("select string_agg(name, '|' order by name) from public.departments");
  check("8 AKANA departmanı mevcut", ["Elektronik", "Gömülü Yazılım", "Sponsorluk ve Organizasyon", "Mekanik", "Aviyonik"].every((n) => names.includes(n)) && names.split("|").length === 8, names);
  const self = await m1.from("departments").update({ lead_id: m1.userId }).eq("id", MEK).select();
  check("üye kendini sorumlu atayamaz", (self.data ?? []).length === 0);
  const set = await admin.from("departments").update({ lead_id: lead.userId }).eq("id", MEK).select();
  check("yönetici MEK sorumlusunu atar", !set.error && set.data.length === 1, set.error?.message);
  check("sorumlunun pozisyonu otomatik LEAD olur", sql(`select team_position from public.profiles where id = '${lead.userId}'`) === "LEAD");
  check("sorumlu değişikliği denetim kaydına yazılır", Number(sql(`select count(*) from public.activity_logs where action = 'DEPARTMENT_LEAD_CHANGED' and entity_id = '${MEK}'`)) >= 1);
}

const mkTask = (client, title, dep, ids, extra = {}) => client.rpc("create_task", {
  p_title: title, p_description: "Açıklama", p_department_id: dep, p_start_date: today, p_due_date: plus(10),
  p_priority: "HIGH", p_required_file_types: ["pdf"], p_notes: "", p_assignee_ids: ids, ...extra,
});

section("2. Projeler");
let project;
{
  const bad = await m1.from("projects").insert({ name: "Yetkisiz proje", target_date: plus(30) }).select();
  check("üye proje oluşturamaz", bad.error !== null || (bad.data ?? []).length === 0);
  const p = await admin.from("projects").insert({ name: "TEKNOFEST 2027 Orta İrtifa", description: "Ana yarışma roketi", target_date: plus(120), owner_id: lead.userId, department_id: MEK }).select().single();
  check("yönetici proje oluşturur, kod otomatik (PRJ-###)", !p.error && /^PRJ-\d{3}$/.test(p.data.code), p.error?.message);
  project = p.data;
  const seen = await m2.from("projects").select("id").eq("id", project.id);
  check("tüm aktif üyeler projeyi görür", seen.data?.length === 1);
  const ownerUpd = await lead.from("projects").update({ description: "Güncel kapsam" }).eq("id", project.id).select();
  check("proje sorumlusu projeyi günceller", ownerUpd.data?.length === 1);
  const otherUpd = await m2.from("projects").update({ description: "x" }).eq("id", project.id).select();
  check("başka üye projeyi güncelleyemez", (otherUpd.data ?? []).length === 0);
  const delM = await m1.from("projects").delete().eq("id", project.id).select();
  check("üye proje silemez", (delM.data ?? []).length === 0);
}

section("3. Sorumlu yetkileri: görev oluşturma ve yönetme");
let tMek, tMek2, tAvy, sub;
{
  const r1 = await mkTask(lead, "Gövde montajı", MEK, [m1.userId], { p_project_id: project.id, p_difficulty: 4 });
  check("sorumlu kendi departmanına görev oluşturur", !r1.error && r1.data.code.startsWith("AK-MEK-") && r1.data.difficulty === 4, r1.error?.message);
  tMek = r1.data;
  const r2 = await mkTask(lead, "Aviyonik görevi", AVY, [m2.userId]);
  check("sorumlu başka departmana görev oluşturamaz", r2.error !== null);
  const r3 = await mkTask(m1, "Üye görevi", MEK, [m1.userId]);
  check("üye görev oluşturamaz", r3.error !== null);
  const r4 = await mkTask(admin, "Aviyonik entegrasyonu", AVY, [m2.userId], { p_project_id: project.id });
  check("yönetici her departmana görev oluşturur", !r4.error, r4.error?.message);
  tAvy = r4.data;
  const r5 = await mkTask(lead, "Burun konisi", MEK, [m1.userId]);
  tMek2 = r5.data;

  const u1 = await lead.from("tasks").update({ priority: "CRITICAL" }).eq("id", tMek.id).select();
  check("sorumlu kendi departmanındaki görevi günceller", u1.data?.length === 1);
  const u2 = await lead.from("tasks").update({ priority: "LOW" }).eq("id", tAvy.id).select();
  check("sorumlu başka departmanın görevini güncelleyemez", (u2.data ?? []).length === 0);
  const seeAvy = await lead.from("tasks").select("id").eq("id", tAvy.id);
  check("sorumlu başka departmanın görevini görmez", (seeAvy.data ?? []).length === 0);
  const asg = await lead.rpc("set_task_assignees", { p_task_id: tMek.id, p_user_ids: [m1.userId, lead.userId] });
  check("sorumlu kendi departman görevinin sorumlularını değiştirir", !asg.error, asg.error?.message);
  const asg2 = await lead.rpc("set_task_assignees", { p_task_id: tAvy.id, p_user_ids: [lead.userId] });
  check("sorumlu başka departmanın sorumlularını değiştiremez", asg2.error !== null);
  const stats = await lead.rpc("dashboard_stats");
  check("dashboard_stats yalnızca yöneticiye açık kalır", stats.error !== null);
  const ds = await lead.rpc("department_stats");
  check("sorumlu kendi departman istatistiğini alır", ds.data?.some((d) => d.department_id === MEK));

  const s1 = await mkTask(lead, "Alt görev: perçin delikleri", MEK, [m1.userId], { p_parent_id: tMek.id });
  check("alt görev oluşturulur ve projeyi üst görevden alır", !s1.error && s1.data.parent_id === tMek.id && s1.data.project_id === project.id, s1.error?.message);
  sub = s1.data;
  const s2 = await mkTask(lead, "Alt-alt görev", MEK, [m1.userId], { p_parent_id: sub.id });
  check("alt görevin altına görev eklenemez (tek seviye)", s2.error !== null);
  const dif = await mkTask(lead, "Geçersiz zorluk", MEK, [m1.userId], { p_difficulty: 9 });
  check("zorluk 1–5 dışında reddedilir", dif.error !== null);
}

section("4. İlerleme ve bloke");
{
  const p1 = await m1.rpc("update_task_progress", { p_task_id: tMek.id, p_progress: 40 });
  check("sorumlu üye ilerlemeyi günceller; NEW → Devam ediyor", !p1.error && p1.data.progress === 40 && p1.data.status === "IN_PROGRESS", p1.error?.message);
  const p2 = await m2.rpc("update_task_progress", { p_task_id: tMek.id, p_progress: 90 });
  check("atanmamış üye ilerleme güncelleyemez", p2.error !== null);
  const p3 = await m1.rpc("update_task_progress", { p_task_id: tMek.id, p_progress: 150 });
  check("ilerleme 0–100 dışında reddedilir", p3.error !== null);
  const direct = await m1.from("tasks").update({ progress: 100 }).eq("id", tMek.id).select();
  check("üye ilerlemeyi doğrudan tablo üzerinden değiştiremez", direct.error !== null || (direct.data ?? []).length === 0);

  const b0 = await m1.rpc("set_task_blocked", { p_task_id: tMek.id, p_blocked: true, p_reason: "" });
  check("bloke nedeni zorunlu", b0.error !== null);
  const b1 = await m1.rpc("set_task_blocked", { p_task_id: tMek.id, p_blocked: true, p_reason: "Alüminyum levha tedarik bekleniyor" });
  check("üye görevi bloke eder", !b1.error && b1.data.status === "BLOCKED" && b1.data.blocked_reason.includes("Alüminyum"), b1.error?.message);
  const nl = await lead.from("notifications").select("title").eq("type", "TASK_UPDATED").eq("title", "Görev bloke edildi");
  check("sorumluya bloke bildirimi gider", nl.data?.length >= 1);
  const b2 = await m1.rpc("set_task_blocked", { p_task_id: tMek.id, p_blocked: false });
  check("blokaj kaldırılır; görev Devam ediyor, neden temizlenir", !b2.error && b2.data.status === "IN_PROGRESS" && b2.data.blocked_reason === "", b2.error?.message);
}

section("5. Görev bağımlılıkları (departmanlar arası)");
{
  const d1 = await admin.rpc("add_task_dependency", { p_task_id: tAvy.id, p_depends_on_id: tMek.id });
  check("aviyonik entegrasyonu mekanik montaja bağlanır", !d1.error, d1.error?.message);
  const cyc = await lead.rpc("add_task_dependency", { p_task_id: tMek.id, p_depends_on_id: tAvy.id });
  check("döngüsel bağımlılık reddedilir", cyc.error !== null && /döngü/.test(cyc.error.message), cyc.error?.message);
  const self = await lead.rpc("add_task_dependency", { p_task_id: tMek.id, p_depends_on_id: tMek.id });
  check("görev kendisine bağlanamaz", self.error !== null);
  const mem = await m1.rpc("add_task_dependency", { p_task_id: tMek.id, p_depends_on_id: tMek2.id });
  check("üye bağımlılık ekleyemez", mem.error !== null);
  const info = await m2.rpc("task_dependency_info", { p_task_id: tAvy.id });
  const pre = info.data?.find((x) => x.direction === "depends_on");
  check("AVY üyesi MEK ön koşulunun kodunu ve durumunu görür, ama açamaz", pre?.code === tMek.code && pre.can_open === false, JSON.stringify(info.error ?? pre));
  const info2 = await m2.rpc("task_dependency_info", { p_task_id: tMek.id });
  check("görmediği görevin bağımlılıklarını sorgulayamaz", info2.error !== null);
  const done = await admin.from("tasks").update({ status: "COMPLETED" }).eq("id", tAvy.id).select();
  check("ön koşulu bitmemiş görev Tamamlandı yapılamaz", done.error !== null && /ön koşul/.test(done.error.message), done.error?.message);
  await admin.from("tasks").update({ status: "COMPLETED" }).eq("id", tMek2.id);
  const d2 = await lead.rpc("add_task_dependency", { p_task_id: tMek.id, p_depends_on_id: tMek2.id });
  const rm = await lead.rpc("remove_task_dependency", { p_task_id: tMek.id, p_depends_on_id: tMek2.id });
  check("sorumlu bağımlılık ekler ve kaldırır", !d2.error && !rm.error);
}

section("6. Yorumlar ve görev geçmişi");
let commentId;
{
  const c1 = await m1.from("task_comments").insert({ task_id: tMek.id, body: "Montaj fikstürü hazır, yarın başlıyoruz." }).select().single();
  check("görevi gören üye yorum yazar; yazar sunucuda atanır", !c1.error && c1.data.author_id === m1.userId, c1.error?.message);
  commentId = c1.data?.id;
  const n = await lead.from("notifications").select("body").eq("type", "TASK_COMMENT");
  check("diğer sorumlulara yorum bildirimi gider", n.data?.length >= 1);
  const nSelf = await m1.from("notifications").select("id").eq("type", "TASK_COMMENT");
  check("yazar kendi yorumu için bildirim almaz", nSelf.data?.length === 0);
  const spoof = await m1.from("task_comments").insert({ task_id: tMek.id, body: "sahte", author_id: lead.userId }).select();
  check("yorum başkası adına yazılamaz", spoof.error !== null);
  const foreign = await m2.from("task_comments").insert({ task_id: tMek.id, body: "görmediğim görev" }).select();
  check("görmediği göreve yorum yazamaz", foreign.error !== null);
  const read = await m2.from("task_comments").select("id").eq("task_id", tMek.id);
  check("görmediği görevin yorumlarını okuyamaz", (read.data ?? []).length === 0);
  const edit = await lead.from("task_comments").update({ body: "değiştirildi" }).eq("id", commentId).select();
  check("başkasının yorumu düzenlenemez", (edit.data ?? []).length === 0);
  const own = await m1.from("task_comments").update({ body: "Montaj fikstürü hazır." }).eq("id", commentId).select();
  check("yazar kendi yorumunu düzenler", own.data?.length === 1);
  const h = await m1.rpc("task_history", { p_task_id: tMek.id });
  const acts = (h.data ?? []).map((x) => x.action);
  check("görev geçmişi: oluşturma, ilerleme, bloke, yorum kayıtları", ["TASK_CREATED", "TASK_PROGRESS", "TASK_BLOCKED", "TASK_COMMENTED"].every((a) => acts.includes(a)), acts.join(","));
  const h2 = await m2.rpc("task_history", { p_task_id: tMek.id });
  check("görmediği görevin geçmişini göremez", h2.error !== null);
}

section("7. Bildirim tercihleri");
{
  const pref = await m1.from("notification_preferences").upsert({ user_id: m1.userId, type: "TASK_COMMENT", enabled: false }).select();
  check("üye bildirim türünü kapatır", !pref.error, pref.error?.message);
  const foreign = await m1.from("notification_preferences").upsert({ user_id: lead.userId, type: "TASK_COMMENT", enabled: false }).select();
  check("başkasının tercihini değiştiremez", foreign.error !== null);
  await lead.from("task_comments").insert({ task_id: tMek.id, body: "Fikstür ölçülerini kontrol edelim." });
  const n = await m1.from("notifications").select("id").eq("type", "TASK_COMMENT");
  check("kapalı türde bildirim oluşmaz", n.data?.length === 0);
}

section("8. Doküman merkezi (STL/STEP, sürüm, onay, silme)");
let doc, docPath;
{
  const c = await m1.rpc("create_document", { p_title: "Gövde CAD modeli", p_description: "Rev A", p_category: "CAD", p_department_id: MEK, p_project_id: project.id, p_task_id: tMek.id });
  check("üye doküman oluşturur, kod otomatik (DOC-####)", !c.error && /^DOC-\d{4}$/.test(c.data.code) && c.data.status === "DRAFT", c.error?.message);
  doc = c.data;
  const stl = Buffer.concat([Buffer.from("solid govde\n"), sampleFile("csv")]);
  docPath = `${doc.id}/${crypto.randomUUID()}/govde.stl`;
  const up = await m1.storage.from("documents").upload(docPath, stl, { contentType: "model/stl" });
  check("STL dosyası yüklenir", !up.error, up.error?.message);
  const v1 = await m1.rpc("add_document_version", { p_document_id: doc.id, p_path: docPath, p_name: "Gövde.stl", p_sha256: sha256(stl), p_note: "İlk model" });
  check("sürüm V1 kaydedilir; durum Onay bekliyor", !v1.error && v1.data.version_number === 1 && sql(`select status from public.documents where id='${doc.id}'`) === "PENDING", v1.error?.message);
  const dup = await m1.rpc("add_document_version", { p_document_id: doc.id, p_path: docPath, p_name: "Gövde.stl", p_sha256: sha256(stl) });
  check("aynı dosya tekrar sürüm olarak eklenemez", dup.error !== null);
  const na = await admin.from("notifications").select("id").eq("type", "DOCUMENT_UPLOADED");
  const nl = await lead.from("notifications").select("id").eq("type", "DOCUMENT_UPLOADED");
  check("yönetici ve departman sorumlusu bilgilendirilir", na.data?.length >= 1 && nl.data?.length >= 1);
  const seen = await m2.from("documents").select("id").eq("id", doc.id);
  check("kısıtsız doküman tüm ekipçe görülür", seen.data?.length === 1);
  const dl = await m2.storage.from("documents").createSignedUrl(docPath, 60);
  check("ekip üyesi kısıtsız dokümanı indirebilir", !dl.error);
  const intruder = `${doc.id}/${crypto.randomUUID()}/x.pdf`;
  const up2 = await m2.storage.from("documents").upload(intruder, sampleFile("pdf"), { contentType: MIME.pdf });
  check("düzenleme yetkisi olmayan sürüm yükleyemez", up2.error !== null);
  const exe = await m1.storage.from("documents").upload(`${doc.id}/${crypto.randomUUID()}/v.exe`, Buffer.from("MZ"), { contentType: "application/x-msdownload" });
  check(".exe dokümana yüklenemez", exe.error !== null);
  const st = await m1.from("documents").update({ status: "APPROVED" }).eq("id", doc.id).select();
  check("durum doğrudan değiştirilemez (onay atlanamaz)", st.error !== null || sql(`select status from public.documents where id='${doc.id}'`) === "PENDING");
  const selfRev = await m1.rpc("review_document", { p_document_id: doc.id, p_action: "APPROVE" });
  check("yükleyen kendi dokümanını onaylayamaz", selfRev.error !== null);
  const avyLead = await m2.rpc("review_document", { p_document_id: doc.id, p_action: "APPROVE" });
  check("başka departman üyesi onaylayamaz", avyLead.error !== null);
  const noNote = await lead.rpc("review_document", { p_document_id: doc.id, p_action: "REQUEST_REVISION", p_note: " " });
  check("revizyon gerekçesi zorunlu", noNote.error !== null);
  const ap = await lead.rpc("review_document", { p_document_id: doc.id, p_action: "APPROVE", p_note: "Uygun" });
  check("departman sorumlusu onaylar", !ap.error && ap.data.status === "APPROVED", ap.error?.message);
  const nm = await m1.from("notifications").select("id").eq("type", "DOCUMENT_APPROVED");
  check("yükleyene onay bildirimi gider", nm.data?.length === 1);

  const step = Buffer.concat([Buffer.from("ISO-10303-21;\n"), sampleFile("csv")]);
  const r = await m1.rpc("create_document", { p_title: "Gizli sponsor sözleşmesi", p_description: "", p_category: "OTHER", p_department_id: MEK, p_is_restricted: true });
  const sp = `${r.data.id}/${crypto.randomUUID()}/model.step`;
  const su = await m1.storage.from("documents").upload(sp, step, { contentType: "model/step" });
  const sv = await m1.rpc("add_document_version", { p_document_id: r.data.id, p_path: sp, p_name: "model.step", p_sha256: sha256(step) });
  check("STEP dosyası kısıtlı dokümana yüklenir", !su.error && !sv.error, su.error?.message ?? sv.error?.message);
  const hidden = await m2.from("documents").select("id").eq("id", r.data.id);
  const hiddenFile = await m2.storage.from("documents").createSignedUrl(sp, 60);
  check("kısıtlı doküman başka departmandan görülemez ve indirilemez", (hidden.data ?? []).length === 0 && hiddenFile.error !== null);
  const meta = await m1.from("documents").update({ title: "Sponsor sözleşmesi (taslak)" }).eq("id", r.data.id).select();
  check("oluşturan doküman bilgisini günceller", meta.data?.length === 1);

  const delA = await m1.rpc("delete_document", { p_document_id: doc.id });
  check("onaylı doküman üye tarafından silinemez", delA.error !== null);
  const delB = await m1.rpc("delete_document", { p_document_id: r.data.id });
  check("oluşturan onaylanmamış dokümanını siler; dosya yolları döner", !delB.error && delB.data.length === 1, delB.error?.message);
  const rmv = await m1.storage.from("documents").remove(delB.data);
  check("sahibi artık bağlı olmayan dosyayı Storage'dan siler", !rmv.error && sql(`select count(*) from storage.objects where name='${sp}'`) === "0", JSON.stringify(rmv.error));
  const delC = await admin.rpc("delete_document", { p_document_id: doc.id });
  check("yönetici onaylı dokümanı siler; silme kaydedilir", !delC.error && Number(sql(`select count(*) from public.activity_logs where action='DOCUMENT_DELETED' and entity_id='${doc.id}'`)) === 1, delC.error?.message);
  await admin.storage.from("documents").remove(delC.data ?? []);
}

section("9. Takvim");
{
  const start = new Date(Date.now() + 86400000).toISOString();
  const end = new Date(Date.now() + 90000000).toISOString();
  const e1 = await m1.from("events").insert({ title: "Üye toplantısı", type: "MEETING", starts_at: start, ends_at: end }).select();
  check("üye etkinlik oluşturamaz", e1.error !== null || (e1.data ?? []).length === 0);
  const e2 = await lead.from("events").insert({ title: "Mekanik atölye günü", type: "WORKSHOP", starts_at: start, ends_at: end, department_id: MEK }).select().single();
  check("sorumlu kendi departmanına etkinlik ekler", !e2.error && e2.data.created_by === lead.userId, e2.error?.message);
  const e3 = await lead.from("events").insert({ title: "Aviyonik", type: "MEETING", starts_at: start, ends_at: end, department_id: AVY }).select();
  check("sorumlu başka departmana etkinlik ekleyemez", e3.error !== null || (e3.data ?? []).length === 0);
  const bad = await admin.from("events").insert({ title: "Ters zaman", type: "OTHER", starts_at: end, ends_at: start }).select();
  check("bitişi başlangıçtan önce olan etkinlik reddedilir", bad.error !== null);
  const e4 = await admin.from("events").insert({ title: "Kritik tasarım incelemesi", type: "MILESTONE", starts_at: start, ends_at: start, all_day: true, project_id: project.id }).select().single();
  check("yönetici ekip etkinliği ekler", !e4.error, e4.error?.message);
  const seen = await m2.from("events").select("id");
  check("tüm üyeler takvimi görür", seen.data?.length >= 2);
  const del = await m2.from("events").delete().eq("id", e2.data.id).select();
  check("üye etkinlik silemez", (del.data ?? []).length === 0);
}

section("10. Risk yönetimi");
let risk;
{
  const r = await m1.from("risks").insert({ title: "Paraşüt açılmama riski", description: "Ayrılma barutu nem alabilir", probability: 4, impact: 4, department_id: MEK, project_id: project.id, mitigation: "Nem testi", contingency: "Yedek CO2 sistemi" }).select().single();
  check("üye risk kaydeder; kod ve puan otomatik (4×4=16)", !r.error && /^RSK-\d{3}$/.test(r.data.code) && r.data.score === 16, r.error?.message);
  risk = r.data;
  const n = await admin.from("notifications").select("title").eq("type", "RISK_CREATED");
  check("yöneticiye 'Kritik risk' bildirimi gider", n.data?.some((x) => x.title === "Kritik risk kaydedildi"));
  const bad = await m1.from("risks").insert({ title: "Geçersiz", probability: 6, impact: 1 }).select();
  check("olasılık 1–5 dışında reddedilir", bad.error !== null);
  const scoreHack = await m1.from("risks").update({ score: 1 }).eq("id", risk.id).select();
  check("risk puanı elle değiştirilemez", scoreHack.error !== null);
  const u = await m2.from("risks").update({ impact: 1 }).eq("id", risk.id).select();
  check("ilgisiz üye riski değiştiremez", (u.data ?? []).length === 0);
  const u2 = await lead.from("risks").update({ probability: 2, status: "MITIGATING" }).eq("id", risk.id).select().single();
  check("departman sorumlusu riski günceller; puan yeniden hesaplanır", !u2.error && u2.data.score === 8 && u2.data.last_reviewed_at === today, u2.error?.message);
  const d = await m1.from("risks").delete().eq("id", risk.id).select();
  check("üye riski silemez", (d.data ?? []).length === 0);
}

section("11. Profil alanları ve fotoğraf");
{
  const png = sampleFile("png", 512);
  const own = `${m1.userId}/${crypto.randomUUID()}.png`;
  const up = await m1.storage.from("avatars").upload(own, png, { contentType: "image/png" });
  check("üye kendi klasörüne fotoğraf yükler", !up.error, up.error?.message);
  const other = await m1.storage.from("avatars").upload(`${m2.userId}/x.png`, png, { contentType: "image/png" });
  check("başkasının klasörüne fotoğraf yükleyemez", other.error !== null);
  const r = await m1.rpc("update_own_profile_details", { p_university: "İTÜ", p_major: "Uçak Mühendisliği", p_skills: ["SolidWorks", "ANSYS", " ", "SolidWorks"], p_avatar_path: own });
  check("üye üniversite, bölüm, yetkinlik ve fotoğrafını kaydeder", !r.error && sql(`select university || '|' || array_length(skills, 1) from public.profiles where id='${m1.userId}'`) === "İTÜ|2", r.error?.message);
  const steal = await m1.rpc("update_own_profile_details", { p_university: "", p_major: "", p_skills: [], p_avatar_path: `${m2.userId}/x.png` });
  check("başkasının dosyası profil fotoğrafı yapılamaz", steal.error !== null);
  const pos = await m1.from("profiles").update({ team_position: "CAPTAIN" }).eq("id", m1.userId).select();
  check("üye kendini kaptan yapamaz", (pos.data ?? []).length === 0 && sql(`select team_position from public.profiles where id='${m1.userId}'`) === "MEMBER");
  const dir = await m2.from("directory").select("university,skills,team_position").eq("id", m1.userId).single();
  check("ekip dizini herkese açık profil alanlarını gösterir (e-posta yok)", dir.data?.university === "İTÜ" && !("email" in (dir.data ?? {})));
  const ap = await admin.from("profiles").update({ team_position: "VICE_CAPTAIN", title: "Kaptan Yardımcısı" }).eq("id", lead.userId).select();
  check("yönetici pozisyon atar; yetki değişikliği kaydedilir", ap.data?.length === 1 && Number(sql(`select count(*) from public.activity_logs where action='POSITION_CHANGED' and entity_id='${lead.userId}'`)) >= 1);
}

section("12. Sorumlunun rapor incelemesi");
{
  const pdf = sampleFile("pdf");
  const path = `${tMek.id}/${m1.userId}/${crypto.randomUUID()}/rapor.pdf`;
  await m1.storage.from("reports").upload(path, pdf, { contentType: MIME.pdf });
  const s = await m1.rpc("submit_report", { p_task_id: tMek.id, p_title: "Montaj raporu", p_description: "", p_note: "", p_files: [{ path, name: "rapor.pdf", sha256: sha256(pdf) }] });
  check("üye raporu gönderir", !s.error, s.error?.message);
  const nl = await lead.from("notifications").select("id").eq("type", "REPORT_SUBMITTED");
  check("departman sorumlusuna 'rapor inceleme bekliyor' bildirimi gider", nl.data?.length >= 1);
  const see = await lead.from("report_overview").select("id").eq("id", s.data.report_id);
  check("sorumlu kendi departmanının raporunu görür", see.data?.length === 1);
  const file = await lead.storage.from("reports").createSignedUrl(path, 60);
  check("sorumlu rapor dosyasını indirebilir", !file.error, file.error?.message);
  const notSee = await m2.from("report_overview").select("id").eq("id", s.data.report_id);
  check("başka üye raporu göremez", (notSee.data ?? []).length === 0);
  const rv = await lead.rpc("review_report", { p_report_id: s.data.report_id, p_action: "APPROVE", p_note: "Uygun" });
  check("sorumlu raporu onaylar", !rv.error && rv.data.status === "APPROVED", rv.error?.message);
}

section("13. Kontrol merkezi, analitik, operasyon raporu");
{
  const o1 = await m1.rpc("mission_overview");
  check("üye kontrol merkezini alır (kapsam: üye)", !o1.error && o1.data.scope === "member" && o1.data.departments.length === 1, o1.error?.message ?? JSON.stringify(o1.data?.departments));
  check("kontrol merkezi projeleri ve ilerlemeyi içerir", o1.data.projects.some((p) => p.id === project.id));
  const o2 = await admin.rpc("mission_overview");
  check("yönetici tüm departmanları görür", o2.data.scope === "all" && o2.data.departments.length === 8);
  const realOpen = Number(sql("select count(*) from public.tasks where status not in ('COMPLETED','APPROVED','CANCELLED')"));
  check("aktif görev sayısı veritabanıyla tutarlı", o2.data.active_tasks === realOpen, `${o2.data.active_tasks} / ${realOpen}`);

  const a1 = await m1.rpc("analytics", {});
  check("üye analitik ekranını çağıramaz", a1.error !== null);
  const a2 = await lead.rpc("analytics", { p_from: plus(-30), p_to: plus(30) });
  check("sorumlu yalnızca kendi departmanının analitiğini alır", !a2.error && a2.data.departments.length === 1 && a2.data.departments[0].id === MEK, a2.error?.message);
  check("üye puanı hesaplanır (tamamlanan iş, zamanlılık)", Array.isArray(a2.data.members) && a2.data.weekly.length >= 8);
  const a3 = await lead.rpc("analytics", { p_department_id: AVY });
  check("sorumlu başka departmanın analitiğini isteyemez", a3.error !== null);
  const a4 = await admin.rpc("analytics", { p_from: plus(-30), p_to: plus(30), p_project_id: project.id });
  check("yönetici proje filtresiyle analitik alır", !a4.error && a4.data.summary.total >= 2, a4.error?.message);
  const w1 = await lead.rpc("weekly_report");
  check("sorumlu haftalık operasyon raporunu alır", !w1.error && Array.isArray(w1.data.upcoming), w1.error?.message);
  const w2 = await m2.rpc("weekly_report");
  check("üye operasyon raporunu çağıramaz", w2.error !== null);
}

section("14. Global arama ve aktivite akışı");
{
  const s1 = await m1.rpc("global_search", { p_query: tMek.code });
  check("üye kendi departman görevini bulur", s1.data?.some((r) => r.kind === "task" && r.id === tMek.id));
  const s2 = await m2.rpc("global_search", { p_query: tMek.code });
  check("başka departman üyesi o görevi aramada göremez", !(s2.data ?? []).some((r) => r.kind === "task"));
  const s3 = await m2.rpc("global_search", { p_query: "ansys" });
  check("yetkinliğe göre ekip üyesi bulunur", s3.data?.some((r) => r.kind === "member" && r.id === m1.userId));
  const s4 = await m2.rpc("global_search", { p_query: "%" });
  check("joker karakterler kaçırılır (tüm kayıtları döndürmez)", (s4.data ?? []).length === 0);
  const f1 = await m2.rpc("activity_feed", { p_department_id: MEK });
  check("üye başka departmanın aktivitelerini isteyemez", f1.error !== null);
  const f2 = await m1.rpc("activity_feed", { p_department_id: MEK, p_limit: 50 });
  check("üye kendi departmanının aktivitelerini görür", !f2.error && f2.data.some((x) => x.entity_id === tMek.id), f2.error?.message);
  const f3 = await m2.rpc("activity_feed", { p_limit: 100 });
  check("akış yetkisiz görev kayıtlarını içermez", !(f3.data ?? []).some((x) => x.entity_id === tMek.id));
}

section("15. Mevcut iş akışı korunur");
{
  check("process_deadlines günlük olarak zamanlanmış (pg_cron)", sql("select count(*) from cron.job where jobname='akana-deadlines'") === "1");
  const p = await m1.rpc("process_deadlines");
  check("process_deadlines hâlâ çalışır", !p.error, p.error?.message);
  check("BLOCKED ve CANCELLED durumları için etiket var", sql("select private.task_status_label('BLOCKED') || '|' || private.task_status_label('CANCELLED')") === "Bloke|İptal edildi");
}

section("16. Çıkar çatışması ve yapay zekâ modülü");
{
  // Sorumlu (lead), tMek görevinin sorumlularından biridir (bölüm 3)
  const pdf = sampleFile("pdf");
  const path = `${tMek.id}/${lead.userId}/${crypto.randomUUID()}/kendi.pdf`;
  await lead.storage.from("reports").upload(path, pdf, { contentType: MIME.pdf });
  const s = await lead.rpc("submit_report", { p_task_id: tMek.id, p_title: "Sorumlunun kendi raporu", p_description: "", p_note: "", p_files: [{ path, name: "kendi.pdf", sha256: sha256(pdf) }] });
  const self = await lead.rpc("review_report", { p_report_id: s.data?.report_id, p_action: "APPROVE", p_note: null });
  check("departman sorumlusu kendi raporunu onaylayamaz", !s.error && self.error !== null && /Kendi raporunuzu/.test(self.error.message), self.error?.message ?? s.error?.message);
  const byAdmin = await admin.rpc("review_report", { p_report_id: s.data?.report_id, p_action: "APPROVE", p_note: null });
  check("yönetici sorumlunun raporunu onaylar", !byAdmin.error, byAdmin.error?.message);

  const d = await lead.rpc("create_document", { p_title: "Sorumlunun analizi", p_description: "", p_category: "ANALYSIS", p_department_id: MEK });
  const buf = sampleFile("pdf");
  const dp = `${d.data.id}/${crypto.randomUUID()}/analiz.pdf`;
  await lead.storage.from("documents").upload(dp, buf, { contentType: MIME.pdf });
  await lead.rpc("add_document_version", { p_document_id: d.data.id, p_path: dp, p_name: "analiz.pdf", p_sha256: sha256(buf) });
  const selfDoc = await lead.rpc("review_document", { p_document_id: d.data.id, p_action: "APPROVE" });
  check("departman sorumlusu kendi yüklediği dokümanı onaylayamaz", selfDoc.error !== null);

  const call = async (client) => {
    const { data: ses } = await client.auth.getSession();
    const res = await fetch(`${env.SUPABASE_URL}/functions/v1/ai-insights`, { method: "POST", headers: { "content-type": "application/json", apikey: env.ANON_KEY, authorization: `Bearer ${ses.session.access_token}` }, body: JSON.stringify({ kind: "weekly" }) });
    return { status: res.status, body: await res.json().catch(() => ({})) };
  };
  const noAuth = await fetch(`${env.SUPABASE_URL}/functions/v1/ai-insights`, { method: "POST", headers: { "content-type": "application/json", apikey: env.ANON_KEY }, body: "{}" });
  check("ai-insights: oturumsuz çağrı 401", noAuth.status === 401, String(noAuth.status));
  const mem = await call(m1);
  check("ai-insights: üye (yönetici/sorumlu değil) veri alamaz", mem.status === 403, `${mem.status} ${JSON.stringify(mem.body)}`);
  const ld = await call(lead);
  check("ai-insights: anahtar yoksa açık '503 yapılandırılmamış' döner (sahte çıktı üretmez)", process.env.ANTHROPIC_API_KEY ? ld.status === 200 : ld.status === 503 && ld.body.configured === false, `${ld.status} ${JSON.stringify(ld.body).slice(0, 160)}`);
}

finish();
