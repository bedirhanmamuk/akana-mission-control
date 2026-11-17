import { useEffect, useMemo, useRef } from "react";
import { Link } from "react-router-dom";
import { CLOSED_STATUSES, TASK_STATUS_META } from "../lib/constants";
import { todayISO } from "../lib/format";
import type { TaskWithRelations } from "../lib/types";

export type GanttZoom = "day" | "week" | "month";
export interface GanttGroup { key: string; label: string; tasks: TaskWithRelations[] }
export interface GanttMilestone { date: string; label: string }

const DAY_W: Record<GanttZoom, number> = { day: 30, week: 14, month: 5 };
const ROW_H = 38;
const HEAD_H = 46;
const DAY = 86400000;
const monthFmt = new Intl.DateTimeFormat("tr-TR", { month: "short", year: "2-digit" });
const dayFmt = new Intl.DateTimeFormat("tr-TR", { day: "numeric" });

const toDate = (s: string) => { const [y, m, d] = s.slice(0, 10).split("-").map(Number); return new Date(y, m - 1, d); };
const diffDays = (a: Date, b: Date) => Math.round((b.getTime() - a.getTime()) / DAY);

/**
 * Gantt şeması: çubuk = başlangıç → son teslim, iç dolgu = ilerleme.
 * Oklar ön koşul → bağımlı görev; ön koşul bağımlı görevin başlangıcından sonra
 * bitiyorsa ok kırmızıdır (zamanlama çakışması). Kırmızı kenar: gecikmiş veya kritik.
 */
export default function Gantt({ groups, dependencies, milestones = [], zoom, labelWidth: requestedLabel = 240 }: {
  groups: GanttGroup[]; dependencies: { task_id: string; depends_on_id: string }[];
  milestones?: GanttMilestone[]; zoom: GanttZoom; labelWidth?: number;
}) {
  const scroller = useRef<HTMLDivElement>(null);
  // Telefonda görev sütunu daralır; zaman ekseni yatay kayar
  const labelWidth = typeof window !== "undefined" && window.innerWidth < 640 ? Math.min(requestedLabel, 136) : requestedLabel;
  const dayW = DAY_W[zoom];
  const all = useMemo(() => groups.flatMap((g) => g.tasks), [groups]);

  const { start, days } = useMemo(() => {
    const today = toDate(todayISO());
    const dates = all.flatMap((t) => [toDate(t.start_date), toDate(t.due_date)]).concat(milestones.map((m) => toDate(m.date)), [today]);
    const min = new Date(Math.min(...dates.map((d) => d.getTime())));
    const max = new Date(Math.max(...dates.map((d) => d.getTime())));
    const s = new Date(min.getFullYear(), min.getMonth(), min.getDate() - 7);
    const e = new Date(max.getFullYear(), max.getMonth(), max.getDate() + 14);
    return { start: s, days: Math.max(30, diffDays(s, e)) };
  }, [all, milestones]);

  // Satır konumları (grup başlıkları dahil)
  const rows = useMemo(() => {
    const out: ({ type: "group"; label: string; count: number } | { type: "task"; task: TaskWithRelations })[] = [];
    for (const g of groups) {
      if (g.tasks.length === 0) continue;
      out.push({ type: "group", label: g.label, count: g.tasks.length });
      for (const t of g.tasks) out.push({ type: "task", task: t });
    }
    return out;
  }, [groups]);
  const rowIndex = useMemo(() => {
    const m = new Map<string, number>();
    rows.forEach((r, i) => { if (r.type === "task") m.set(r.task.id, i); });
    return m;
  }, [rows]);

  const width = days * dayW;
  const height = rows.length * ROW_H;
  const todayX = diffDays(start, toDate(todayISO())) * dayW + dayW / 2;
  const x0 = (t: TaskWithRelations) => diffDays(start, toDate(t.start_date)) * dayW;
  const x1 = (t: TaskWithRelations) => (diffDays(start, toDate(t.due_date)) + 1) * dayW;

  // Açılışta bugüne kaydır
  useEffect(() => {
    const el = scroller.current;
    if (el) el.scrollLeft = Math.max(0, todayX - (el.clientWidth - labelWidth) / 3);
  }, [todayX, labelWidth, zoom]);

  // Başlık: aylar ve gün/hafta çizgileri
  const months: { x: number; w: number; label: string }[] = [];
  const ticks: { x: number; label: string; weekend: boolean }[] = [];
  for (let i = 0; i < days; i++) {
    const d = new Date(start.getFullYear(), start.getMonth(), start.getDate() + i);
    if (d.getDate() === 1 || i === 0) {
      const next = new Date(d.getFullYear(), d.getMonth() + 1, 1);
      months.push({ x: i * dayW, w: Math.min(days - i, diffDays(d, next)) * dayW, label: monthFmt.format(d) });
    }
    const dow = d.getDay();
    if (zoom === "day" || (zoom === "week" && dow === 1) || (zoom === "month" && d.getDate() % 7 === 1)) {
      ticks.push({ x: i * dayW, label: dayFmt.format(d), weekend: zoom === "day" && (dow === 0 || dow === 6) });
    }
  }

  const byId = new Map(all.map((t) => [t.id, t]));
  const arrows = dependencies.flatMap((d) => {
    const pre = byId.get(d.depends_on_id); const post = byId.get(d.task_id);
    if (!pre || !post) return [];
    const ya = (rowIndex.get(pre.id)! + 0.5) * ROW_H; const yb = (rowIndex.get(post.id)! + 0.5) * ROW_H;
    const xa = x1(pre); const xb = x0(post);
    const conflict = pre.due_date >= post.start_date && !CLOSED_STATUSES.includes(pre.status);
    const mid = Math.max(xa + 8, Math.min(xb - 8, xa + 12));
    const path = xb - xa >= 16
      ? `M${xa},${ya} H${mid} V${yb} H${xb - 2}`
      : `M${xa},${ya} H${xa + 8} V${(ya + yb) / 2} H${xb - 10} V${yb} H${xb - 2}`;
    return [{ key: `${pre.id}-${post.id}`, path, conflict }];
  });

  return (
    <div ref={scroller} className="scroll-x relative rounded-2xl bg-card" style={{ boxShadow: "var(--shadow-card)" }} data-testid="gantt">
      <div className="relative" style={{ width: labelWidth + width, minHeight: HEAD_H + height }}>
        {/* Başlık */}
        <div className="sticky top-0 z-20 flex border-b border-line-soft bg-card" style={{ height: HEAD_H }}>
          <div className="sticky left-0 z-30 flex shrink-0 items-end border-r border-line-soft bg-card px-3 pb-2 text-xs font-medium text-faint" style={{ width: labelWidth }}>Görev</div>
          <div className="relative" style={{ width }}>
            {months.map((m) => (
              <div key={m.x} className="absolute top-0 border-l border-line-soft px-2 pt-1.5 text-xs font-medium text-muted" style={{ left: m.x, width: m.w }}>{m.label}</div>
            ))}
            {ticks.map((t) => (
              <div key={t.x} className={`absolute bottom-1 text-[10px] tabular-nums ${t.weekend ? "text-faint" : "text-muted"}`} style={{ left: t.x + 2 }}>{t.label}</div>
            ))}
          </div>
        </div>

        {/* Gövde */}
        <div className="relative flex">
          <div className="sticky left-0 z-10 shrink-0 border-r border-line-soft bg-card" style={{ width: labelWidth }}>
            {rows.map((r, i) => r.type === "group" ? (
              <div key={`g-${i}`} className="flex items-center gap-2 bg-surface/80 px-3 text-xs font-semibold text-ink" style={{ height: ROW_H }}>
                <span className="truncate">{r.label}</span><span className="text-faint tabular-nums">{r.count}</span>
              </div>
            ) : (
              <Link key={r.task.id} to={`/gorevler/${r.task.id}`} className="flex items-center gap-2 border-b border-line-soft/60 px-3 hover:bg-ink/5" style={{ height: ROW_H }} title={`${r.task.code} — ${r.task.title}`}>
                <span className="code-tag shrink-0 text-[11px]">{r.task.code}</span>
                <span className="truncate text-xs">{r.task.title}</span>
              </Link>
            ))}
          </div>
          <div className="relative" style={{ width, height }}>
            {/* hafta sonu / ızgara */}
            {zoom === "day" && ticks.filter((t) => t.weekend).map((t) => <div key={t.x} className="absolute top-0 bottom-0 bg-ink/[0.025]" style={{ left: t.x, width: dayW }} />)}
            {months.map((m) => <div key={m.x} className="absolute top-0 bottom-0 border-l border-line-soft" style={{ left: m.x }} />)}
            {rows.map((r, i) => r.type === "group" && <div key={`gb-${i}`} className="absolute inset-x-0 bg-surface/50" style={{ top: i * ROW_H, height: ROW_H }} />)}

            {/* Kilometre taşları */}
            {milestones.map((m) => {
              const x = diffDays(start, toDate(m.date)) * dayW + dayW / 2;
              return (
                <div key={`${m.date}-${m.label}`} className="absolute top-0 bottom-0 z-[1]" style={{ left: x }} title={`Kilometre taşı: ${m.label}`}>
                  <div className="absolute top-0 bottom-0 border-l border-dashed border-danger/50" />
                  <div className="absolute -top-1 -left-1.5 size-3 rotate-45 bg-danger" />
                </div>
              );
            })}

            {/* Bugün */}
            <div className="absolute top-0 bottom-0 z-[2] w-px bg-accent" style={{ left: todayX }} aria-hidden />

            {/* Çubuklar */}
            {rows.map((r, i) => {
              if (r.type !== "task") return null;
              const t = r.task;
              const left = x0(t); const w = Math.max(dayW, x1(t) - left);
              const overdue = !CLOSED_STATUSES.includes(t.status) && (t.status === "OVERDUE" || t.due_date < todayISO());
              const critical = overdue || t.status === "BLOCKED" || t.priority === "CRITICAL";
              const color = TASK_STATUS_META[t.status].color;
              return (
                <Link key={t.id} to={`/gorevler/${t.id}`} data-testid="gantt-bar"
                  className={`absolute z-[3] flex items-center overflow-hidden rounded-md text-[11px] font-medium transition-[filter] hover:brightness-110 ${critical ? "ring-2 ring-danger" : ""}`}
                  style={{ left, width: w, top: i * ROW_H + 8, height: ROW_H - 16, background: `color-mix(in srgb, ${color} 30%, var(--color-card))` }}
                  title={`${t.code} · ${t.title}\n${t.start_date} → ${t.due_date} · %${t.progress} · ${TASK_STATUS_META[t.status].label}`}>
                  <span className="absolute inset-y-0 left-0" style={{ width: `${t.progress}%`, background: color, opacity: 0.85 }} />
                  {w > 60 && <span className="relative truncate px-2 text-ink mix-blend-normal">{t.progress}%</span>}
                </Link>
              );
            })}

            {/* Bağımlılık okları */}
            <svg className="pointer-events-none absolute inset-0 z-[4] overflow-visible" width={width} height={height} aria-hidden>
              <defs>
                <marker id="gantt-arrow" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto"><path d="M0,0 L8,4 L0,8 z" fill="var(--color-muted)" /></marker>
                <marker id="gantt-arrow-bad" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto"><path d="M0,0 L8,4 L0,8 z" fill="var(--color-danger)" /></marker>
              </defs>
              {arrows.map((a) => (
                <path key={a.key} d={a.path} fill="none" strokeWidth={1.5}
                  stroke={a.conflict ? "var(--color-danger)" : "var(--color-muted)"} strokeDasharray={a.conflict ? "4 3" : undefined}
                  markerEnd={`url(#${a.conflict ? "gantt-arrow-bad" : "gantt-arrow"})`} />
              ))}
            </svg>
          </div>
        </div>
      </div>
    </div>
  );
}

export function GanttLegend() {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-muted">
      <span className="flex items-center gap-1.5"><span className="h-2.5 w-6 rounded-sm bg-accent/40"><span className="block h-full w-1/2 rounded-sm bg-accent" /></span> İlerleme</span>
      <span className="flex items-center gap-1.5"><span className="h-2.5 w-6 rounded-sm ring-2 ring-danger" /> Gecikmiş, bloke veya kritik</span>
      <span className="flex items-center gap-1.5"><span className="h-3 w-px bg-accent" /> Bugün</span>
      <span className="flex items-center gap-1.5"><span className="size-2.5 rotate-45 bg-danger" /> Proje hedefi</span>
      <span className="flex items-center gap-1.5"><svg width="24" height="8"><path d="M0,4 H20" stroke="var(--color-danger)" strokeDasharray="4 3" strokeWidth="1.5" /></svg> Zamanlama çakışması</span>
    </div>
  );
}
