// =============================================================================
// AKANA MISSION CONTROL — admin-users Edge Function
//
// Service Role Key yalnızca burada (sunucu tarafında) kullanılır; frontend'e
// asla gönderilmez. Her istekte çağıranın JWT'si Auth sunucusunda doğrulanır
// ve veritabanındaki profilinden ADMIN + aktif olduğu kontrol edilir.
//
// İşlemler (POST gövdesi: { action, ... }):
//   create         -> yeni ekip üyesi oluşturur
//   update_email   -> üyenin e-postasını değiştirir
//   reset_password -> üyeye yeni geçici şifre atar
//
// Bilinçli olarak harici import yoktur: yalnızca fetch + Deno yerleşikleri.
// =============================================================================

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

const svcHeaders = {
  apikey: SERVICE_KEY,
  Authorization: `Bearer ${SERVICE_KEY}`,
  "Content-Type": "application/json",
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

async function rest(path: string, init: RequestInit = {}): Promise<Response> {
  return await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...init,
    headers: { ...svcHeaders, ...(init.headers ?? {}) },
  });
}

async function authAdmin(path: string, init: RequestInit = {}): Promise<Response> {
  return await fetch(`${SUPABASE_URL}/auth/v1/admin/${path}`, {
    ...init,
    headers: { ...svcHeaders, ...(init.headers ?? {}) },
  });
}

async function log(actorId: string, action: string, entityId: string, summary: string, details: unknown = {}) {
  await rest("activity_logs", {
    method: "POST",
    body: JSON.stringify({ actor_id: actorId, action, entity_type: "profile", entity_id: entityId, summary, details }),
  });
}

function authErrorMessage(payload: Record<string, unknown>): string {
  const code = String(payload.error_code ?? payload.code ?? "");
  const msg = String(payload.msg ?? payload.message ?? payload.error_description ?? "");
  if (code === "email_exists" || /already (been )?registered/i.test(msg)) {
    return "Bu e-posta adresiyle kayıtlı bir kullanıcı zaten var.";
  }
  if (code === "weak_password" || /password/i.test(msg)) {
    return "Şifre yeterince güçlü değil (en az 8 karakter olmalı).";
  }
  if (code === "validation_failed" || /invalid.*email|email.*invalid/i.test(msg)) {
    return "E-posta adresi geçersiz.";
  }
  return msg || "Kimlik doğrulama servisi hatası.";
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Yalnızca POST desteklenir." }, 405);

  try {
    // 1) Çağıranın kimliğini Auth sunucusunda doğrula
    const authHeader = req.headers.get("Authorization") ?? "";
    if (!authHeader.toLowerCase().startsWith("bearer ")) {
      return json({ error: "Oturum bulunamadı." }, 401);
    }
    const userRes = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      headers: { apikey: SERVICE_KEY, Authorization: authHeader },
    });
    if (!userRes.ok) return json({ error: "Oturum geçersiz veya süresi dolmuş." }, 401);
    const caller = await userRes.json();
    if (!caller?.id) return json({ error: "Oturum geçersiz." }, 401);

    // 2) Rolü veritabanından oku (JWT içeriğine veya istemciye güvenme)
    const profRes = await rest(`profiles?id=eq.${caller.id}&select=id,role,is_active`);
    const profs = profRes.ok ? await profRes.json() : [];
    const me = profs[0];
    if (!me || me.role !== "ADMIN" || me.is_active !== true) {
      return json({ error: "Bu işlem için yönetici yetkisi gerekir." }, 403);
    }

    const body = await req.json().catch(() => null);
    if (!body || typeof body !== "object") return json({ error: "Geçersiz istek gövdesi." }, 400);
    const action = String(body.action ?? "");

    // ---------------------------------------------------------------- create
    if (action === "create") {
      const email = String(body.email ?? "").trim().toLowerCase();
      const password = String(body.password ?? "");
      const firstName = String(body.first_name ?? "").trim().slice(0, 60);
      const lastName = String(body.last_name ?? "").trim().slice(0, 60);
      const role = body.role === "ADMIN" ? "ADMIN" : "MEMBER";
      const departmentId = body.department_id ? String(body.department_id) : null;

      if (!EMAIL_RE.test(email)) return json({ error: "E-posta adresi geçersiz." }, 400);
      if (password.length < 8) return json({ error: "Geçici şifre en az 8 karakter olmalıdır." }, 400);
      if (!firstName || !lastName) return json({ error: "Ad ve soyad zorunludur." }, 400);
      if (departmentId && !UUID_RE.test(departmentId)) return json({ error: "Departman geçersiz." }, 400);
      if (departmentId) {
        const d = await rest(`departments?id=eq.${departmentId}&select=id`);
        if (!d.ok || (await d.json()).length === 0) return json({ error: "Departman bulunamadı." }, 400);
      }

      const createRes = await authAdmin("users", {
        method: "POST",
        body: JSON.stringify({
          email,
          password,
          email_confirm: true,
          user_metadata: { first_name: firstName, last_name: lastName },
        }),
      });
      const created = await createRes.json().catch(() => ({}));
      if (!createRes.ok || !created?.id) return json({ error: authErrorMessage(created) }, 400);

      // Profil satırı tetikleyiciyle (MEMBER + pasif) oluştu; yetkili alanları ata.
      const updRes = await rest(`profiles?id=eq.${created.id}`, {
        method: "PATCH",
        headers: { Prefer: "return=representation" },
        body: JSON.stringify({
          first_name: firstName,
          last_name: lastName,
          email,
          role,
          department_id: departmentId,
          is_active: true,
        }),
      });
      const updated = updRes.ok ? await updRes.json() : [];
      if (!updRes.ok || updated.length !== 1) {
        // Yarım kalmış hesabı geri al
        await authAdmin(`users/${created.id}`, { method: "DELETE" });
        return json({ error: "Profil oluşturulamadı; işlem geri alındı." }, 500);
      }

      await log(me.id, "MEMBER_CREATED", created.id, `Üye oluşturuldu: ${firstName} ${lastName}`, { email, role, department_id: departmentId });
      return json({ profile: updated[0] });
    }

    // ---------------------------------------------- update_email / reset_password
    const userId = String(body.user_id ?? "");
    if (!UUID_RE.test(userId)) return json({ error: "Kullanıcı kimliği geçersiz." }, 400);
    const targetRes = await rest(`profiles?id=eq.${userId}&select=id,first_name,last_name,email`);
    const targets = targetRes.ok ? await targetRes.json() : [];
    if (targets.length !== 1) return json({ error: "Kullanıcı bulunamadı." }, 404);
    const target = targets[0];

    if (action === "update_email") {
      const email = String(body.email ?? "").trim().toLowerCase();
      if (!EMAIL_RE.test(email)) return json({ error: "E-posta adresi geçersiz." }, 400);
      const r = await authAdmin(`users/${userId}`, {
        method: "PUT",
        body: JSON.stringify({ email, email_confirm: true }),
      });
      const p = await r.json().catch(() => ({}));
      if (!r.ok) return json({ error: authErrorMessage(p) }, 400);
      const u = await rest(`profiles?id=eq.${userId}`, { method: "PATCH", body: JSON.stringify({ email }) });
      if (!u.ok) return json({ error: "Profil e-postası güncellenemedi." }, 500);
      await log(me.id, "MEMBER_EMAIL_CHANGED", userId, `E-posta değiştirildi: ${target.first_name} ${target.last_name}`, { from: target.email, to: email });
      return json({ ok: true });
    }

    if (action === "reset_password") {
      const password = String(body.password ?? "");
      if (password.length < 8) return json({ error: "Şifre en az 8 karakter olmalıdır." }, 400);
      const r = await authAdmin(`users/${userId}`, { method: "PUT", body: JSON.stringify({ password }) });
      const p = await r.json().catch(() => ({}));
      if (!r.ok) return json({ error: authErrorMessage(p) }, 400);
      await log(me.id, "MEMBER_PASSWORD_RESET", userId, `Şifre sıfırlandı: ${target.first_name} ${target.last_name}`);
      return json({ ok: true });
    }

    return json({ error: "Bilinmeyen işlem." }, 400);
  } catch (e) {
    console.error("admin-users error", e);
    return json({ error: "Beklenmeyen sunucu hatası." }, 500);
  }
});
