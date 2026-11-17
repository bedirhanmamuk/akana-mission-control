import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Bot, Info, RefreshCw, Sparkles } from "lucide-react";
import { Bar, BarChart, CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { supabase } from "../lib/supabase";
import { useAuth } from "../context/AuthContext";
import { useAsync } from "../lib/useAsync";
import { fetchAnalytics, fetchDepartments, fetchProjectList, fetchWeeklyReport } from "../lib/api";
import { errorMessage } from "../lib/errors";
import { RISK_STATUS_META } from "../lib/constants";
import { formatDate, todayISO } from "../lib/format";
import {
  Card, EmptyState, ErrorState, LoadingState, PageHeader, ProgressBar, RiskScore, SectionTitle, Segmented, Spinner,
} from "../components/ui";

const AXIS = { fill: "var(--color-muted)", fontSize: 11 };
const GRID = "var(--color-line-soft)";
type Preset = "30" | "90" | "180" | "365" | "custom";
type Bucket = "week" | "month";
type AiKind = "weekly" | "delays" | "workload" | "risks";

const shift = (days: number) => { const d = new Date(); d.setDate(d.getDate() - days); return d.toISOString().slice(0, 10); };
const pct = (a: number, b: number) => (b > 0 ? Math.round((a / b) * 100) : null);
const monthLabel = new Intl.DateTimeFormat("tr-TR", { month: "short", year: "2-digit" });
const weekLabel = new Intl.DateTimeFormat("tr-TR", { day: "numeric", month: "short" });

function Tip({ active, payload, label }: { active?: boolean; payload?: { value?: number; name?: string; color?: string }[]; label?: string }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-lg bg-surface px-3 py-2 text-xs shadow-xl">
      <p className="mb-1 text-muted">{label}</p>
      {payload.map((p) => <p key={p.name} className="flex items-center gap-2 tabular-nums"><span className="size-2 rounded-sm" style={{ background: p.color }} />{p.name}: <b>{p.value}</b></p>)}
    </div>
  );
}

function Kpi({ label, value, hint, tone }: { label: string; value: string; hint: string; tone?: "danger" | "warning" | "success" }) {
  const color = tone === "danger" ? "text-danger" : tone === "warning" ? "text-warning" : tone === "success" ? "text-success" : "";
  return (
    <div className="px-4 py-4 sm:px-5" title={hint}>
      <p className="min-h-[2.5em] text-[13px] leading-tight text-muted">{label}</p>
      <p className={`num mt-1 text-[32px] font-semibold leading-none ${color}`}>{value}</p>
      <p className="mt-1.5 text-[11px] text-faint">{hint}</p>
    </div>
  );
}

/** Kural tabanlı rapor ve isteğe bağlı YZ özeti. */
function WeeklyPanel() {
  const report = useAsync(fetchWeeklyReport, []);
  const [kind, setKind] = useState<AiKind>("weekly");
  const [ai, setAi] = useState<{ text?: string; error?: string; model?: string; at?: string } | null>(null);
  const [busy, setBusy] = useState(false);

  async function runAi() {
    setBusy(true); setAi(null);
    const { data, error } = await supabase.functions.invoke("ai-insights", { body: { kind } });
    setBusy(false);
    if (error) {
      let msg = errorMessage(error);
      const ctx = (error as { context?: Response }).context;
      if (ctx && typeof ctx.json === "function") { try { const j = await ctx.json() as { error?: string }; if (j.error) msg = j.error; } catch { /* gövde yok */ } }
      if (/failed to send|failed to fetch|not found|404/i.test(msg)) msg = "Yapay zekâ servisine ulaşılamadı. 'ai-insights' Edge Function'ının dağıtıldığından emin olun.";
      return setAi({ error: msg });
    }
    const d = data as { text: string; model: string; generated_at: string };
    setAi({ text: d.text, model: d.model, at: d.generated_at });
  }

  const r = report.data;
  return (
    <div className="grid gap-4 xl:grid-cols-2">
      <Card className="p-5">
        <SectionTitle aside={<button className="inline-flex items-center gap-1 text-xs text-accent-2 hover:underline" onClick={report.reload}><RefreshCw className="size-3.5" /> Yenile</button>}>Haftalık operasyon raporu</SectionTitle>
        {report.loading && !r ? <LoadingState variant="compact" /> : report.error || !r ? <ErrorState message={report.error ?? ""} onRetry={report.reload} /> : (
          <div className="space-y-4 text-sm" data-testid="weekly-report">
            <p className="text-muted">{formatDate(r.period.from)} – {formatDate(r.period.to)} · {r.scope === "all" ? "tüm takım" : "sorumlu olduğunuz departmanlar"}. </p>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {[["Yeni görev", r.created], ["Kapanan", r.completed.length], ["Geciken", r.overdue.length], ["Bloke", r.blocked.length]].map(([k, v]) => (
                <div key={k as string} className="rounded-lg bg-surface px-3 py-2"><p className="text-[11px] text-muted">{k}</p><p className={`num text-xl font-semibold ${(k === "Geciken" || k === "Bloke") && Number(v) > 0 ? "text-danger" : ""}`}>{v}</p></div>
              ))}
            </div>
            {r.overdue.length > 0 && <div><p className="mb-1 font-medium text-danger">Geciken görevler</p><ul className="space-y-0.5 text-muted">{r.overdue.slice(0, 8).map((t) => <li key={t.code}><span className="code-tag mr-1.5">{t.code}</span>{t.title} · {t.department} · <span className="text-danger">{t.days_late} gün</span></li>)}</ul></div>}
            {r.blocked.length > 0 && <div><p className="mb-1 font-medium text-danger">Bloke görevler</p><ul className="space-y-0.5 text-muted">{r.blocked.map((t) => <li key={t.code}><span className="code-tag mr-1.5">{t.code}</span>{t.title}: {t.reason || "neden yok"}</li>)}</ul></div>}
            {r.upcoming.length > 0 && <div><p className="mb-1 font-medium">Önümüzdeki 7 gün</p><ul className="space-y-0.5 text-muted">{r.upcoming.slice(0, 8).map((t) => <li key={t.code}><span className="code-tag mr-1.5">{t.code}</span>{t.title} · {formatDate(t.due_date)} · %{t.progress}</li>)}</ul></div>}
            {r.risks.length > 0 && <div><p className="mb-1 font-medium">Yüksek riskler (≥12)</p><ul className="space-y-1">{r.risks.slice(0, 6).map((x) => <li key={x.code} className="flex items-center gap-2 text-muted"><RiskScore score={x.score} /><span className="truncate">{x.code} · {x.title} · {RISK_STATUS_META[x.status].label}</span></li>)}</ul></div>}
            <p className="text-muted">Bekleyen onay: {r.pending_reports} rapor, {r.pending_documents} doküman.</p>
            {r.completed.length === 0 && r.overdue.length === 0 && r.upcoming.length === 0 && <p className="text-muted">Bu hafta kayda değer bir hareket yok.</p>}
          </div>
        )}
      </Card>
      <Card className="p-5">
        <SectionTitle><span className="flex items-center gap-2"><Sparkles className="size-4 text-accent-2" /> Yapay zekâ analizi <span className="rounded bg-ink/8 px-1.5 text-[10px] font-medium text-muted">isteğe bağlı</span></span></SectionTitle>
        <p className="mb-3 flex items-start gap-2 text-xs text-muted"><Info className="mt-0.5 size-3.5 shrink-0" /> Yalnızca sistem verisini okur, hiçbir kaydı değiştirmez. Sonuçları kayıtlarla doğrulayın.</p>
        <div className="flex flex-col gap-2 sm:flex-row">
          <select className="input sm:flex-1" value={kind} onChange={(e) => setKind(e.target.value as AiKind)} aria-label="Analiz türü">
            <option value="weekly">Haftalık operasyon özeti</option>
            <option value="delays">Geciken ve bloke görev analizi</option>
            <option value="workload">Kritik iş yükü değerlendirmesi</option>
            <option value="risks">Risk kayıtlarının değerlendirmesi</option>
          </select>
          <button className="btn-primary" onClick={() => void runAi()} disabled={busy}>{busy ? <Spinner className="size-4 text-current" /> : <Bot className="size-4" />} Analiz üret</button>
        </div>
        {ai?.error && <p className="mt-4 rounded-lg bg-warning/10 px-3 py-2.5 text-sm text-warning" role="alert" data-testid="ai-error">{ai.error}</p>}
        {ai?.text && (
          <div className="mt-4 rounded-xl bg-surface p-4">
            <div className="whitespace-pre-wrap text-sm leading-relaxed">{ai.text}</div>
            <p className="mt-3 text-[11px] text-faint">Üreten: {ai.model} · {ai.at ? new Date(ai.at).toLocaleString("tr-TR") : ""} · yapay zekâ çıktısıdır, doğrulayın.</p>
          </div>
        )}
      </Card>
    </div>
  );
}

export default function Analytics() {
  const { isAdmin } = useAuth();
  const [preset, setPreset] = useState<Preset>("90");
  const [from, setFrom] = useState(shift(89));
  const [to, setTo] = useState(todayISO());
  const [project, setProject] = useState("");
  const [dept, setDept] = useState("");
  const [bucket, setBucket] = useState<Bucket>("week");

  const range = preset === "custom" ? { from, to } : { from: shift(Number(preset) - 1), to: todayISO() };
  const meta = useAsync(async () => {
    const [projects, departments] = await Promise.all([fetchProjectList(), fetchDepartments()]);
    return { projects, departments };
  }, []);
  const { data, loading, error, reload } = useAsync(
    () => fetchAnalytics({ from: range.from, to: range.to, projectId: project || null, departmentId: dept || null }),
    [range.from, range.to, project, dept],
  );

  const trend = useMemo(() => {
    if (!data) return [];
    if (bucket === "week") return data.weekly.map((w) => ({ label: weekLabel.format(new Date(w.week)), Oluşturulan: w.created, Kapanan: w.completed, "Teslimi gelen": w.due }));
    const m = new Map<string, { label: string; Oluşturulan: number; Kapanan: number; "Teslimi gelen": number }>();
    for (const w of data.weekly) {
      const d = new Date(w.week); const k = `${d.getFullYear()}-${d.getMonth()}`;
      const cur = m.get(k) ?? { label: monthLabel.format(d), Oluşturulan: 0, Kapanan: 0, "Teslimi gelen": 0 };
      cur.Oluşturulan += w.created; cur.Kapanan += w.completed; cur["Teslimi gelen"] += w.due;
      m.set(k, cur);
    }
    return [...m.values()];
  }, [data, bucket]);

  const s = data?.summary;
  const deptName = (id: string | null) => meta.data?.departments.find((d) => d.id === id)?.name ?? "—";
  const maxLoad = Math.max(1, ...(data?.members ?? []).map((m) => m.weighted_load));

  return (
    <>
      <PageHeader title="Performans ve Analitik" description={isAdmin ? "Teslim tarihi seçilen aralıkta olan görevler." : "Departmanlarınızın gerçek görev verisi."} />

      <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:flex-wrap lg:items-center">
        <Segmented label="Tarih aralığı" value={preset} onChange={setPreset}
          options={[["30", "30 gün"], ["90", "90 gün"], ["180", "6 ay"], ["365", "1 yıl"], ["custom", "Özel"]] as const} />
        {preset === "custom" && (
          <div className="flex gap-2">
            <input type="date" className="input" value={from} max={to} onChange={(e) => setFrom(e.target.value)} aria-label="Başlangıç" />
            <input type="date" className="input" value={to} min={from} onChange={(e) => setTo(e.target.value)} aria-label="Bitiş" />
          </div>
        )}
        {meta.data && (
          <div className="flex flex-1 flex-col gap-2 sm:flex-row">
            <select className="input sm:w-56" value={project} onChange={(e) => setProject(e.target.value)} aria-label="Proje">
              <option value="">Tüm projeler</option>{meta.data.projects.map((p) => <option key={p.id} value={p.id}>{p.code} — {p.name}</option>)}</select>
            <select className="input sm:w-52" value={dept} onChange={(e) => setDept(e.target.value)} aria-label="Departman">
              <option value="">{isAdmin ? "Tüm departmanlar" : "Sorumlu olduğum departmanlar"}</option>
              {meta.data.departments.filter((d) => isAdmin || data?.departments.some((x) => x.id === d.id)).map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</select>
          </div>
        )}
      </div>

      {loading && !data ? <LoadingState /> : error || !data || !s ? <ErrorState message={error ?? ""} onRetry={reload} /> : (
        <div className={loading ? "opacity-60 transition-opacity" : "transition-opacity"}>
          <section className="card grid grid-cols-2 divide-ink/5 sm:grid-cols-3 xl:grid-cols-6 [&>*]:border-ink/5 [&>*:not(:last-child)]:border-r" aria-label="Temel metrikler" data-testid="analytics-kpis">
            <Kpi label="Görev tamamlama oranı" value={pct(s.completed, s.total) === null ? "—" : `%${pct(s.completed, s.total)}`} hint={`${s.completed} / ${s.total} görev (iptal hariç)`} />
            <Kpi label="Zamanında teslim oranı" value={pct(s.on_time, s.completed) === null ? "—" : `%${pct(s.on_time, s.completed)}`} hint={`${s.on_time} / ${s.completed} kapanan görev`} tone={(pct(s.on_time, s.completed) ?? 100) < 70 ? "warning" : "success"} />
            <Kpi label="Ortalama tamamlanma süresi" value={s.avg_completion_days === null ? "—" : `${s.avg_completion_days} gün`} hint="başlangıçtan kapanışa" />
            <Kpi label="Geciken görev oranı" value={pct(s.overdue, s.total) === null ? "—" : `%${pct(s.overdue, s.total)}`} hint={`${s.overdue} açık görev teslim tarihini aştı`} tone={s.overdue > 0 ? "danger" : undefined} />
            <Kpi label="Revizyon oranı" value={pct(s.revision_versions, s.reviewed_versions) === null ? "—" : `%${pct(s.revision_versions, s.reviewed_versions)}`} hint={`${s.revision_versions} / ${s.reviewed_versions} incelenen rapor sürümü`} tone={(pct(s.revision_versions, s.reviewed_versions) ?? 0) > 30 ? "warning" : undefined} />
            <Kpi label="Bloke görev" value={String(s.blocked)} hint="şu an bloke" tone={s.blocked > 0 ? "danger" : undefined} />
          </section>

          {s.total === 0 ? (
            <div className="mt-4"><EmptyState title="Bu aralıkta görev yok" description="Tarih aralığını genişletin." /></div>
          ) : (
            <>
              <div className="mt-4 grid gap-4 xl:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
                <Card className="p-5">
                  <SectionTitle aside={<Segmented size="sm" label="Gruplama" value={bucket} onChange={setBucket} options={[["week", "Haftalık"], ["month", "Aylık"]] as const} />}>Performans değişimi</SectionTitle>
                  <div className="h-64">
                    <ResponsiveContainer width="100%" height="100%">
                      <LineChart data={trend} margin={{ top: 8, right: 12, bottom: 0, left: -18 }}>
                        <CartesianGrid vertical={false} stroke={GRID} />
                        <XAxis dataKey="label" tick={AXIS} axisLine={false} tickLine={false} minTickGap={16} />
                        <YAxis allowDecimals={false} tick={AXIS} axisLine={false} tickLine={false} />
                        <Tooltip content={<Tip />} />
                        <Legend iconType="plainline" wrapperStyle={{ fontSize: 11 }} />
                        <Line type="monotone" dataKey="Oluşturulan" stroke="var(--color-info)" strokeWidth={2} dot={false} />
                        <Line type="monotone" dataKey="Kapanan" stroke="var(--color-success)" strokeWidth={2} dot={false} />
                        <Line type="monotone" dataKey="Teslimi gelen" stroke="var(--color-accent)" strokeWidth={2} strokeDasharray="4 3" dot={false} />
                      </LineChart>
                    </ResponsiveContainer>
                  </div>
                </Card>
                <Card className="p-5">
                  <SectionTitle>Departman performansları</SectionTitle>
                  <div style={{ height: Math.max(200, data.departments.length * 34 + 40) }}>
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={data.departments.map((d) => ({ name: d.name, "Tamamlama %": pct(d.completed, d.total) ?? 0, "Zamanında %": pct(d.on_time, d.completed) ?? 0 }))} layout="vertical" margin={{ top: 0, right: 12, bottom: 0, left: 0 }}>
                        <CartesianGrid horizontal={false} stroke={GRID} />
                        <XAxis type="number" domain={[0, 100]} tick={AXIS} axisLine={false} tickLine={false} />
                        <YAxis type="category" dataKey="name" width={108} tick={{ ...AXIS, fill: "var(--color-ink)" }} axisLine={false} tickLine={false} />
                        <Tooltip content={<Tip />} cursor={{ fill: "color-mix(in srgb, var(--color-ink) 5%, transparent)" }} />
                        <Legend iconType="square" iconSize={8} wrapperStyle={{ fontSize: 11 }} />
                        <Bar dataKey="Tamamlama %" fill="var(--color-success)" maxBarSize={10} radius={[0, 3, 3, 0]} />
                        <Bar dataKey="Zamanında %" fill="var(--color-accent)" maxBarSize={10} radius={[0, 3, 3, 0]} />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </Card>
              </div>

              <Card className="mt-4 p-5">
                <SectionTitle>Üye bazlı iş yükü ve katkı</SectionTitle>
                <details className="mb-4 rounded-lg bg-surface px-3 py-2 text-xs text-muted">
                  <summary className="cursor-pointer font-medium text-ink">Puan nasıl hesaplanır?</summary>
                  <p className="mt-2 leading-relaxed">Üyeler yalnızca görev sayısıyla değerlendirilmez. Seçilen aralıkta kapanan her görev için: <b>zorluk (1–5) × öncelik katsayısı</b> (Düşük 0,8 · Normal 1 · Yüksek 1,25 · Kritik 1,5) <b>× zamanlılık</b> (zamanında 1, geç 0,75) <b>× kalite</b> (o görevdeki her revizyon/ret için −0,15, en az 0,5) <b>÷ görevdeki sorumlu sayısı</b>. Ağırlıklı yük = açık görevlerin zorluk × öncelik katsayısı toplamı. Puan bir karşılaştırma aracıdır, tek başına performans kararı değildir.</p>
                </details>
                {data.members.length === 0 ? <p className="text-sm text-muted">Bu kapsamda görev atanmış üye yok.</p> : (
                  <div className="overflow-x-auto">
                    <table className="w-full min-w-[640px]" data-testid="member-workload">
                      <thead className="border-b border-line-soft"><tr>
                        <th className="th">Üye</th><th className="th">Puan</th><th className="th">Kapanan</th><th className="th">Zamanında</th><th className="th">Revizyon</th><th className="th">Açık görev</th><th className="th w-48">Ağırlıklı yük</th>
                      </tr></thead>
                      <tbody className="divide-y divide-line-soft">
                        {data.members.map((m) => (
                          <tr key={m.user_id}>
                            <td className="td"><Link to={`/ekip/${m.user_id}`} className="hover:text-accent-2">{m.name}</Link><span className="block text-xs text-muted">{deptName(m.department_id)}</span></td>
                            <td className="td num text-base font-semibold">{m.score}</td>
                            <td className="td tabular-nums">{m.completed}</td>
                            <td className="td tabular-nums">{m.completed ? `%${pct(m.on_time, m.completed)}` : "—"}</td>
                            <td className={`td tabular-nums ${m.revisions ? "text-warning" : ""}`}>{m.revisions}</td>
                            <td className="td tabular-nums">{m.open_tasks}{m.overdue_open > 0 && <span className="ml-1 text-xs text-danger">({m.overdue_open} geciken)</span>}</td>
                            <td className="td"><span className="flex items-center gap-2"><ProgressBar className="flex-1" value={(m.weighted_load / maxLoad) * 100} tone={m.weighted_load / maxLoad > 0.8 ? "warning" : "accent"} label={`${m.name} iş yükü`} /><span className="w-10 text-right text-xs tabular-nums text-muted">{m.weighted_load}</span></span></td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </Card>

              {data.projects.length > 0 && (
                <Card className="mt-4 p-5">
                  <SectionTitle>Proje ilerlemeleri</SectionTitle>
                  <ul className="grid gap-x-8 gap-y-3 md:grid-cols-2">
                    {data.projects.map((p) => (
                      <li key={p.id}>
                        <div className="mb-1 flex items-baseline justify-between gap-3 text-sm"><Link to={`/projeler/${p.id}`} className="truncate hover:text-accent-2"><span className="code-tag mr-2">{p.code}</span>{p.name}</Link><span className="num font-semibold">%{p.progress}</span></div>
                        <ProgressBar value={p.progress} tone={p.overdue_tasks ? "danger" : "accent"} />
                        <p className="mt-1 text-xs text-muted">{p.completed_tasks}/{p.total_tasks} görev · hedef {formatDate(p.target_date)}{p.overdue_tasks ? ` · ${p.overdue_tasks} geciken` : ""}</p>
                      </li>
                    ))}
                  </ul>
                </Card>
              )}
            </>
          )}
        </div>
      )}

      <h2 className="display mt-8 mb-3 text-lg font-semibold">Operasyon raporları</h2>
      <WeeklyPanel />
    </>
  );
}
