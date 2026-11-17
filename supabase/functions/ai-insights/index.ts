// =============================================================================
// AKANA MISSION CONTROL — ai-insights Edge Function (isteğe bağlı YZ modülü)
//
// Ne yapar: Haftalık operasyon raporu ve analitik verisini, ÇAĞIRAN KULLANICININ
// kendi oturumuyla (RLS + RPC yetki kontrolleri aynen geçerli) okur ve Claude'a
// yalnızca bu veriden bir özet yazdırır.
//
// Güvenlik ilkeleri:
//  * Model hiçbir araç (tool) almaz: görev değiştiremez, silemez, onaylayamaz.
//  * Service Role Key veriye erişmek için KULLANILMAZ; veri kullanıcının JWT'siyle
//    okunur. Yönetici değilse yalnızca kendi departmanının verisini görür.
//  * ANTHROPIC_API_KEY tanımlı değilse 503 döner; arayüz bunu açıkça gösterir.
//    Kural tabanlı haftalık rapor (weekly_report) anahtar olmadan da çalışır.
//
// Kurulum: supabase secrets set ANTHROPIC_API_KEY=...  (frontend'e asla yazılmaz)
// =============================================================================
import Anthropic from "npm:@anthropic-ai/sdk@^0.70.0";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const GATEWAY_KEY = Deno.env.get("SUPABASE_ANON_KEY") ?? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const API_KEY = Deno.env.get("ANTHROPIC_API_KEY") ?? "";
const MODEL = Deno.env.get("AI_MODEL") ?? "claude-opus-5-5";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}

type Kind = "weekly" | "delays" | "workload" | "risks";
const TASKS: Record<Kind, string> = {
  weekly: "Haftalık operasyon raporu hazırla: genel durum, tamamlananlar, gecikenler ve bloke işler, önümüzdeki 7 günün kritik teslimleri, proje ilerlemesi, açık riskler ve bekleyen onaylar.",
  delays: "Geciken ve bloke görevleri analiz et: hangi departmanlarda yoğunlaşıyor, kaç gün gecikmişler, bloke nedenlerinde ortak bir örüntü var mı, hangi teslimleri riske atıyorlar.",
  workload: "Üye bazlı iş yükünü değerlendir: ağırlıklı yükü ve açık görevi belirgin şekilde yüksek olanları, geciken açık işi olanları ve yük dengesizliğini belirt.",
  risks: "Açık risk kayıtlarını değerlendir: en yüksek puanlılar, önleyici faaliyeti boş veya zayıf görünenler ve projeye etkisi.",
};

const SYSTEM = `Sen AKANA Roket Takımı'nın operasyon analistisin. Türkçe, kısa ve net yazarsın.
Kurallar:
- YALNIZCA kullanıcı mesajındaki JSON verisini kullan. Veride olmayan bir sayıyı, kişiyi, tarihi veya nedeni ASLA uydurma.
- Veri yetersizse bunu açıkça yaz ("Bu konuda sistemde veri yok").
- Tahmin veya yorum yaparsan "değerlendirme:" diye işaretle; gerçek veriyle karıştırma.
- Görev kodlarını (AK-XXX-000), proje kodlarını (PRJ-000) ve risk kodlarını (RSK-000) aynen kullan.
- Hiçbir işlemi yaptığını veya yapacağını söyleme; yalnızca analiz ve öneri yaz. Kararı insanlar verir.
- Biçim: kısa başlıklar ve madde işaretleri (Markdown). En fazla yaklaşık 350 kelime. En sonda en fazla 3 somut öneri.`;

async function rpc(name: string, auth: string, body: unknown = {}) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${name}`, {
    method: "POST",
    headers: { apikey: GATEWAY_KEY, Authorization: auth, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    const msg = (data && (data.message || data.error)) || `HTTP ${res.status}`;
    throw Object.assign(new Error(String(msg)), { status: res.status === 401 ? 401 : 403 });
  }
  return data;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Yalnızca POST desteklenir." }, 405);

  const auth = req.headers.get("Authorization") ?? "";
  if (!auth.toLowerCase().startsWith("bearer ")) return json({ error: "Oturum bulunamadı." }, 401);

  let kind: Kind = "weekly";
  try {
    const body = await req.json();
    if (body?.kind && body.kind in TASKS) kind = body.kind as Kind;
  } catch { /* varsayılan */ }

  // Veri, kullanıcının yetkisiyle okunur. Yönetici/sorumlu değilse RPC reddeder.
  let report: unknown, analytics: unknown;
  try {
    [report, analytics] = await Promise.all([rpc("weekly_report", auth), rpc("analytics", auth, {})]);
  } catch (e) {
    const status = (e as { status?: number }).status ?? 403;
    return json({ error: (e as Error).message || "Veri okunamadı." }, status);
  }

  if (!API_KEY) {
    return json({ error: "Yapay zekâ modülü yapılandırılmamış. Yönetici, Supabase'de ANTHROPIC_API_KEY sırrını tanımlamalıdır. Kural tabanlı haftalık rapor bu ekranda kullanılabilir.", configured: false }, 503);
  }

  try {
    const client = new Anthropic({ apiKey: API_KEY });
    const response = await client.beta.messages.create({
      model: MODEL,
      max_tokens: 4000,
      output_config: { effort: "medium" },
      // Güvenlik sınıflandırıcısı reddederse sunucu tarafında uygun modelle yeniden dener
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      system: SYSTEM,
      messages: [{
        role: "user",
        content: `Görev: ${TASKS[kind]}\n\nSistem verisi (JSON, kullanıcının yetki kapsamı):\n${JSON.stringify({ haftalik_rapor: report, analitik: analytics })}`,
      }],
    } as Parameters<typeof client.beta.messages.create>[0]);

    if (response.stop_reason === "refusal") {
      return json({ error: "Model bu isteği yanıtlamadı. Kural tabanlı raporu kullanın." }, 422);
    }
    const text = response.content
      .filter((b: { type: string }) => b.type === "text")
      .map((b: { type: string; text?: string }) => b.text ?? "")
      .join("\n")
      .trim();
    return json({ kind, text, model: response.model, generated_at: new Date().toISOString() });
  } catch (e) {
    if (e instanceof Anthropic.RateLimitError) return json({ error: "Yapay zekâ servisi şu an yoğun; biraz sonra tekrar deneyin." }, 429);
    if (e instanceof Anthropic.AuthenticationError) return json({ error: "ANTHROPIC_API_KEY geçersiz." }, 503);
    if (e instanceof Anthropic.APIError) return json({ error: `Yapay zekâ servisi hatası (${e.status}).` }, 502);
    return json({ error: "Yapay zekâ servisine ulaşılamadı." }, 502);
  }
});
