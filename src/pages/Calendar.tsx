import { useMemo, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { ChevronLeft, ChevronRight, Clock, MapPin, Plus, Trash2 } from "lucide-react";
import { supabase } from "../lib/supabase";
import { useAuth } from "../context/AuthContext";
import { useToast } from "../context/ToastContext";
import { useAsync } from "../lib/useAsync";
import { fetchDepartments, fetchEvents, fetchProjects, fetchTasks } from "../lib/api";
import { errorMessage } from "../lib/errors";
import { CLOSED_STATUSES, EVENT_TYPES, EVENT_TYPE_META } from "../lib/constants";
import type { CalendarEvent, EventType } from "../lib/types";
import { ErrorState, Field, FormError, LoadingState, Modal, PageHeader, Segmented, Spinner } from "../components/ui";

type View = "month" | "week" | "day";

interface Item {
  key: string; kind: "event" | "task" | "milestone"; title: string; date: string; time?: string;
  color: string; link?: string; event?: CalendarEvent; sub?: string;
}

const pad = (n: number) => String(n).padStart(2, "0");
const iso = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const addDays = (d: Date, n: number) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
const startOfWeek = (d: Date) => addDays(d, -((d.getDay() + 6) % 7)); // Pazartesi
const parse = (s: string) => { const [y, m, d] = s.split("-").map(Number); return new Date(y, m - 1, d); };
const monthTitle = new Intl.DateTimeFormat("tr-TR", { month: "long", year: "numeric" });
const dayTitle = new Intl.DateTimeFormat("tr-TR", { weekday: "long", day: "numeric", month: "long", year: "numeric" });
const shortDay = new Intl.DateTimeFormat("tr-TR", { weekday: "short", day: "numeric" });
const timeFmt = new Intl.DateTimeFormat("tr-TR", { hour: "2-digit", minute: "2-digit" });
const WEEKDAYS = ["Pzt", "Sal", "Çar", "Per", "Cum", "Cmt", "Paz"];

function EventModal({ event, date, departments, projects, onClose, onSaved }: {
  event: CalendarEvent | null; date: string; departments: { id: string; name: string }[];
  projects: { id: string; code: string; name: string }[]; onClose: () => void; onSaved: () => void;
}) {
  const toast = useToast();
  const { isAdmin, leadDepartmentIds } = useAuth();
  const s = event ? new Date(event.starts_at) : null;
  const e = event ? new Date(event.ends_at) : null;
  const [form, setForm] = useState({
    title: event?.title ?? "", description: event?.description ?? "", type: (event?.type ?? "MEETING") as EventType,
    date: s ? iso(s) : date, start: s ? `${pad(s.getHours())}:${pad(s.getMinutes())}` : "18:00",
    end_date: e ? iso(e) : date, end: e ? `${pad(e.getHours())}:${pad(e.getMinutes())}` : "20:00",
    all_day: event?.all_day ?? false, location: event?.location ?? "",
    department_id: event?.department_id ?? (isAdmin ? "" : leadDepartmentIds[0] ?? ""), project_id: event?.project_id ?? "",
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const deptOptions = isAdmin ? departments : departments.filter((d) => leadDepartmentIds.includes(d.id));

  async function save(ev: FormEvent) {
    ev.preventDefault();
    setError(null);
    if (form.title.trim().length < 2) return setError("Etkinlik adını yazın.");
    const starts = form.all_day ? new Date(`${form.date}T00:00`) : new Date(`${form.date}T${form.start}`);
    const ends = form.all_day ? new Date(`${form.end_date}T23:59`) : new Date(`${form.end_date}T${form.end}`);
    if (ends < starts) return setError("Bitiş, başlangıçtan önce olamaz.");
    setBusy(true);
    const payload = {
      title: form.title.trim(), description: form.description, type: form.type, all_day: form.all_day,
      starts_at: starts.toISOString(), ends_at: ends.toISOString(), location: form.location,
      department_id: form.department_id || null, project_id: form.project_id || null,
    };
    const res = event ? await supabase.from("events").update(payload).eq("id", event.id).select("id")
      : await supabase.from("events").insert(payload).select("id");
    setBusy(false);
    if (res.error) return setError(errorMessage(res.error));
    if (!res.data?.length) return setError("Bu etkinliği değiştirme yetkiniz yok.");
    toast.success(event ? "Etkinlik güncellendi." : "Etkinlik takvime eklendi.");
    onSaved();
  }
  async function remove() {
    if (!event) return;
    setBusy(true);
    const { data, error: err } = await supabase.from("events").delete().eq("id", event.id).select("id");
    setBusy(false);
    if (err) return setError(errorMessage(err));
    if (!data?.length) return setError("Bu etkinliği silme yetkiniz yok.");
    toast.success("Etkinlik silindi.");
    onSaved();
  }

  return (
    <Modal open onClose={onClose} title={event ? "Etkinliği düzenle" : "Etkinlik ekle"} wide
      footer={<>
        {event && <button className="btn-danger sm:mr-auto" onClick={() => void remove()} disabled={busy}><Trash2 className="size-4" /> Sil</button>}
        <button className="btn-secondary" onClick={onClose} disabled={busy}>Vazgeç</button>
        <button className="btn-primary" type="submit" form="event-form" disabled={busy}>{busy && <Spinner className="size-4 text-current" />} Kaydet</button></>}>
      <form id="event-form" onSubmit={save} className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-[1fr_200px]">
          <Field label="Etkinlik" required><input className="input" name="event-title" value={form.title} maxLength={160} onChange={(x) => setForm({ ...form, title: x.target.value })} placeholder="Örn. Kritik tasarım incelemesi" /></Field>
          <Field label="Tür"><select className="input" name="event-type" value={form.type} onChange={(x) => setForm({ ...form, type: x.target.value as EventType })}>
            {EVENT_TYPES.map((t) => <option key={t} value={t}>{EVENT_TYPE_META[t].label}</option>)}</select></Field>
        </div>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" className="size-4" checked={form.all_day} onChange={(x) => setForm({ ...form, all_day: x.target.checked })} /> Tüm gün</label>
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          <Field label="Başlangıç tarihi" required><input type="date" className="input" name="event-date" value={form.date} onChange={(x) => setForm({ ...form, date: x.target.value, end_date: form.end_date < x.target.value ? x.target.value : form.end_date })} /></Field>
          {!form.all_day && <Field label="Saat"><input type="time" className="input" value={form.start} onChange={(x) => setForm({ ...form, start: x.target.value })} /></Field>}
          <Field label="Bitiş tarihi" required><input type="date" className="input" value={form.end_date} min={form.date} onChange={(x) => setForm({ ...form, end_date: x.target.value })} /></Field>
          {!form.all_day && <Field label="Saat"><input type="time" className="input" value={form.end} onChange={(x) => setForm({ ...form, end: x.target.value })} /></Field>}
        </div>
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Yer"><input className="input" value={form.location} maxLength={160} onChange={(x) => setForm({ ...form, location: x.target.value })} placeholder="Atölye, toplantı odası, atış alanı" /></Field>
          <Field label="Departman"><select className="input" value={form.department_id} onChange={(x) => setForm({ ...form, department_id: x.target.value })}>
            {isAdmin && <option value="">Tüm takım</option>}{deptOptions.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</select></Field>
          <Field label="Proje"><select className="input" value={form.project_id} onChange={(x) => setForm({ ...form, project_id: x.target.value })}>
            <option value="">—</option>{projects.map((p) => <option key={p.id} value={p.id}>{p.code}</option>)}</select></Field>
        </div>
        <Field label="Açıklama"><textarea className="input min-h-20" value={form.description} maxLength={2000} onChange={(x) => setForm({ ...form, description: x.target.value })} /></Field>
        <FormError>{error}</FormError>
      </form>
    </Modal>
  );
}

function ItemChip({ item, onEvent, compact }: { item: Item; onEvent: (e: CalendarEvent) => void; compact?: boolean }) {
  const body = (
    <span className="flex min-w-0 items-center gap-1.5">
      <span className={`shrink-0 ${item.kind === "milestone" ? "size-2 rotate-45" : item.kind === "task" ? "size-2 rounded-sm" : "size-2 rounded-full"}`} style={{ background: item.color }} />
      {!compact && item.time && <span className="shrink-0 font-mono text-[10px] text-muted tabular-nums">{item.time}</span>}
      <span className="truncate">{item.title}</span>
    </span>
  );
  const cls = "block w-full rounded-md px-1.5 py-0.5 text-left text-[11px] leading-4 hover:bg-ink/8";
  if (item.event) return <button className={cls} onClick={() => onEvent(item.event!)} title={item.title}>{body}</button>;
  return <Link to={item.link ?? "#"} className={cls} title={item.title}>{body}</Link>;
}

function Agenda({ items, onEvent, empty }: { items: Item[]; onEvent: (e: CalendarEvent) => void; empty: string }) {
  if (items.length === 0) return <p className="py-6 text-center text-sm text-muted">{empty}</p>;
  return (
    <ul className="divide-y divide-line-soft">
      {items.map((it) => {
        const inner = (
          <>
            <span className={`mt-1.5 shrink-0 ${it.kind === "milestone" ? "size-2.5 rotate-45" : it.kind === "task" ? "size-2.5 rounded-sm" : "size-2.5 rounded-full"}`} style={{ background: it.color }} />
            <span className="min-w-0 flex-1">
              <span className="block text-sm">{it.title}</span>
              <span className="flex flex-wrap items-center gap-x-3 text-xs text-muted">
                {it.time && <span className="inline-flex items-center gap-1"><Clock className="size-3" />{it.time}</span>}
                {it.sub && <span className="inline-flex items-center gap-1">{it.kind === "event" && <MapPin className="size-3" />}{it.sub}</span>}
              </span>
            </span>
          </>
        );
        return (
          <li key={it.key}>
            {it.event ? <button onClick={() => onEvent(it.event!)} className="flex w-full items-start gap-3 py-2.5 text-left hover:opacity-80">{inner}</button>
              : <Link to={it.link ?? "#"} className="flex items-start gap-3 py-2.5 hover:opacity-80">{inner}</Link>}
          </li>
        );
      })}
    </ul>
  );
}

export default function Calendar() {
  const { isManager } = useAuth();
  const [view, setView] = useState<View>("month");
  const [cursor, setCursor] = useState(() => new Date());
  const [selected, setSelected] = useState(() => iso(new Date()));
  const [editing, setEditing] = useState<{ event: CalendarEvent | null; date: string } | null>(null);
  const [show, setShow] = useState({ event: true, task: true, milestone: true });

  const range = useMemo(() => {
    if (view === "month") {
      const first = new Date(cursor.getFullYear(), cursor.getMonth(), 1);
      const start = startOfWeek(first);
      return { start, days: 42 };
    }
    if (view === "week") return { start: startOfWeek(cursor), days: 7 };
    return { start: new Date(cursor.getFullYear(), cursor.getMonth(), cursor.getDate()), days: 1 };
  }, [view, cursor]);
  const rangeEnd = addDays(range.start, range.days);

  const { data, loading, error, reload } = useAsync(async () => {
    const [events, tasks, projects, departments] = await Promise.all([
      fetchEvents(range.start.toISOString(), rangeEnd.toISOString()), fetchTasks(), fetchProjects(), fetchDepartments(),
    ]);
    return { events, tasks, projects, departments };
  }, [range.start.getTime(), range.days]);

  const byDay = useMemo(() => {
    const m = new Map<string, Item[]>();
    const push = (d: string, it: Item) => m.set(d, [...(m.get(d) ?? []), it]);
    if (!data) return m;
    if (show.event) for (const ev of data.events) {
      const s = new Date(ev.starts_at); const e = new Date(ev.ends_at);
      for (let d = new Date(s.getFullYear(), s.getMonth(), s.getDate()); d <= e; d = addDays(d, 1)) {
        const first = iso(d) === iso(s);
        push(iso(d), { key: `e-${ev.id}-${iso(d)}`, kind: "event", title: ev.title, date: iso(d), event: ev,
          time: ev.all_day ? undefined : first ? timeFmt.format(s) : "devam", color: EVENT_TYPE_META[ev.type].color,
          sub: [EVENT_TYPE_META[ev.type].label, ev.location].filter(Boolean).join(" · ") });
      }
    }
    if (show.task) for (const t of data.tasks) {
      if (t.status === "CANCELLED") continue;
      const closed = CLOSED_STATUSES.includes(t.status);
      push(t.due_date, { key: `t-${t.id}`, kind: "task", title: `${t.code} teslim: ${t.title}`, date: t.due_date, link: `/gorevler/${t.id}`,
        color: closed ? "var(--color-success)" : t.priority === "CRITICAL" ? "var(--color-danger)" : "var(--color-accent)",
        sub: `${t.department?.name ?? ""}${closed ? " · kapandı" : ` · %${t.progress}`}` });
    }
    if (show.milestone) for (const p of data.projects) {
      if (p.status === "CANCELLED") continue;
      push(p.target_date, { key: `p-${p.id}`, kind: "milestone", title: `${p.code} hedef teslim: ${p.name}`, date: p.target_date, link: `/projeler/${p.id}`, color: "var(--color-danger)", sub: "Proje kilometre taşı" });
    }
    for (const [k, v] of m) m.set(k, v.sort((a, b) => (a.time ?? "00").localeCompare(b.time ?? "00")));
    return m;
  }, [data, show]);

  function shift(n: number) {
    setCursor((c) => view === "month" ? new Date(c.getFullYear(), c.getMonth() + n, 1) : addDays(c, n * (view === "week" ? 7 : 1)));
  }
  const today = iso(new Date());
  const title = view === "month" ? monthTitle.format(cursor) : view === "week"
    ? `${shortDay.format(range.start)} – ${shortDay.format(addDays(range.start, 6))} ${range.start.getFullYear()}` : dayTitle.format(cursor);
  const openEvent = (e: CalendarEvent) => setEditing({ event: e, date: iso(new Date(e.starts_at)) });
  const readOnlyEvent = (e: CalendarEvent) => setEditing({ event: e, date: iso(new Date(e.starts_at)) });

  return (
    <>
      <PageHeader title="Takvim" description="Toplantılar, atölye günleri, teslimler ve kilometre taşları."
        actions={isManager && <button className="btn-primary" onClick={() => setEditing({ event: null, date: selected })}><Plus className="size-4" /> Etkinlik ekle</button>} />
      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-2">
          <button className="btn-secondary px-2.5" onClick={() => shift(-1)} aria-label="Önceki"><ChevronLeft className="size-4" /></button>
          <button className="btn-secondary" onClick={() => { setCursor(new Date()); setSelected(today); }}>Bugün</button>
          <button className="btn-secondary px-2.5" onClick={() => shift(1)} aria-label="Sonraki"><ChevronRight className="size-4" /></button>
          <h2 className="display ml-2 text-lg font-semibold first-letter:uppercase" aria-live="polite">{title}</h2>
        </div>
        <Segmented label="Takvim görünümü" value={view} onChange={setView} options={[["month", "Ay"], ["week", "Hafta"], ["day", "Gün"]] as const} />
      </div>
      <div className="mb-3 flex flex-wrap gap-x-4 gap-y-2 text-xs text-muted">
        {([["event", "Etkinlikler", "rounded-full", "var(--color-info)"], ["task", "Görev teslimleri", "rounded-sm", "var(--color-accent)"], ["milestone", "Kilometre taşları", "rotate-45", "var(--color-danger)"]] as const).map(([k, label, shape, color]) => (
          <label key={k} className="flex min-h-8 cursor-pointer items-center gap-2">
            <input type="checkbox" className="size-4" checked={show[k]} onChange={(e) => setShow({ ...show, [k]: e.target.checked })} />
            <span className={`size-2.5 ${shape}`} style={{ background: color }} /> {label}
          </label>
        ))}
      </div>

      {loading && !data ? <LoadingState /> : error || !data ? <ErrorState message={error ?? ""} onRetry={reload} /> : view === "month" ? (
        <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_320px]">
          <div className="card overflow-hidden" data-testid="calendar-month">
            <div className="grid grid-cols-7 border-b border-line-soft text-center text-xs font-medium text-faint">
              {WEEKDAYS.map((w) => <div key={w} className="py-2">{w}</div>)}
            </div>
            <div className="grid grid-cols-7">
              {Array.from({ length: 42 }, (_, i) => {
                const d = addDays(range.start, i); const k = iso(d);
                const items = byDay.get(k) ?? [];
                const inMonth = d.getMonth() === cursor.getMonth();
                return (
                  <div key={k} className={`min-h-16 border-r border-b border-line-soft p-1 sm:min-h-28 ${inMonth ? "" : "bg-ink/[0.02]"} ${selected === k ? "bg-accent/8" : ""}`}>
                    <button onClick={() => setSelected(k)} onDoubleClick={() => { setCursor(d); setView("day"); }}
                      className={`mb-0.5 flex size-7 items-center justify-center rounded-full text-xs tabular-nums ${k === today ? "bg-accent font-semibold text-on-accent" : inMonth ? "text-ink hover:bg-ink/8" : "text-faint hover:bg-ink/8"}`}
                      aria-label={`${dayTitle.format(d)}, ${items.length} kayıt`}>{d.getDate()}</button>
                    <div className="hidden space-y-0.5 sm:block">
                      {items.slice(0, 3).map((it) => <ItemChip key={it.key} item={it} onEvent={isManager ? openEvent : readOnlyEvent} compact />)}
                      {items.length > 3 && <button className="px-1.5 text-[11px] text-muted hover:text-ink" onClick={() => setSelected(k)}>+{items.length - 3} daha</button>}
                    </div>
                    {items.length > 0 && (
                      <div className="flex flex-wrap gap-0.5 px-1 sm:hidden" aria-hidden>
                        {items.slice(0, 4).map((it) => <span key={it.key} className="size-1.5 rounded-full" style={{ background: it.color }} />)}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
          <div className="card p-5">
            <h3 className="mb-2 font-semibold first-letter:uppercase">{dayTitle.format(parse(selected))}</h3>
            <Agenda items={byDay.get(selected) ?? []} onEvent={isManager ? openEvent : readOnlyEvent} empty="Bu gün için kayıt yok." />
            {isManager && <button className="btn-ghost mt-2 w-full" onClick={() => setEditing({ event: null, date: selected })}><Plus className="size-4" /> Bu güne etkinlik ekle</button>}
          </div>
        </div>
      ) : view === "week" ? (
        <div className="grid gap-3 md:grid-cols-7" data-testid="calendar-week">
          {Array.from({ length: 7 }, (_, i) => {
            const d = addDays(range.start, i); const k = iso(d);
            const items = byDay.get(k) ?? [];
            return (
              <div key={k} className={`card min-h-40 p-3 ${k === today ? "ring-1 ring-accent/60" : ""}`}>
                <button className="mb-2 flex w-full items-baseline justify-between text-left" onClick={() => { setCursor(d); setView("day"); }}>
                  <span className="text-xs font-medium text-muted">{WEEKDAYS[i]}</span>
                  <span className={`num text-lg font-semibold ${k === today ? "text-accent-2" : ""}`}>{d.getDate()}</span>
                </button>
                <div className="space-y-1">
                  {items.length === 0 ? <p className="text-xs text-faint">—</p> : items.map((it) => <ItemChip key={it.key} item={it} onEvent={isManager ? openEvent : readOnlyEvent} />)}
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="card p-5" data-testid="calendar-day">
          <Agenda items={byDay.get(iso(cursor)) ?? []} onEvent={isManager ? openEvent : readOnlyEvent} empty="Bu gün için kayıt yok." />
          {isManager && <button className="btn-ghost mt-2 w-full" onClick={() => setEditing({ event: null, date: iso(cursor) })}><Plus className="size-4" /> Bu güne etkinlik ekle</button>}
        </div>
      )}

      {editing && data && (isManager ? (
        <EventModal event={editing.event} date={editing.date} departments={data.departments.filter((d) => d.is_active)} projects={data.projects}
          onClose={() => setEditing(null)} onSaved={() => { setEditing(null); reload(); }} />
      ) : editing.event && (
        <Modal open onClose={() => setEditing(null)} title={editing.event.title}>
          <p className="text-sm text-muted">{EVENT_TYPE_META[editing.event.type].label} · {editing.event.all_day ? "Tüm gün" : `${timeFmt.format(new Date(editing.event.starts_at))} – ${timeFmt.format(new Date(editing.event.ends_at))}`}</p>
          {editing.event.location && <p className="mt-2 flex items-center gap-1.5 text-sm"><MapPin className="size-4 text-muted" /> {editing.event.location}</p>}
          {editing.event.description && <p className="mt-3 whitespace-pre-wrap text-sm">{editing.event.description}</p>}
        </Modal>
      ))}
    </>
  );
}
