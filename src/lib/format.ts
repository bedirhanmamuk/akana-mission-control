const dateFmt = new Intl.DateTimeFormat("tr-TR", { day: "2-digit", month: "2-digit", year: "numeric" });
const dateTimeFmt = new Intl.DateTimeFormat("tr-TR", {
  day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit",
});
const monthFmt = new Intl.DateTimeFormat("tr-TR", { month: "short", year: "2-digit" });

/** 'YYYY-MM-DD' (date sütunu) -> yerel tarih; saat dilimi kaymasını önler. */
function parseDateOnly(value: string): Date {
  const [y, m, d] = value.slice(0, 10).split("-").map(Number);
  return new Date(y, m - 1, d);
}

export function formatDate(value: string | null | undefined): string {
  if (!value) return "—";
  return dateFmt.format(value.length <= 10 ? parseDateOnly(value) : new Date(value));
}

export function formatDateTime(value: string | null | undefined): string {
  if (!value) return "—";
  return dateTimeFmt.format(new Date(value));
}

export function formatMonth(yyyyMm: string): string {
  const [y, m] = yyyyMm.split("-").map(Number);
  return monthFmt.format(new Date(y, m - 1, 1));
}

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const i = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
  const v = bytes / 1024 ** i;
  return `${v >= 100 || i === 0 ? v.toFixed(0) : v.toFixed(1)} ${units[i]}`;
}

export function timeAgo(value: string): string {
  const diff = Date.now() - new Date(value).getTime();
  const min = Math.round(diff / 60000);
  if (min < 1) return "az önce";
  if (min < 60) return `${min} dk önce`;
  const h = Math.round(min / 60);
  if (h < 24) return `${h} sa önce`;
  const d = Math.round(h / 24);
  if (d < 30) return `${d} gün önce`;
  return formatDate(value);
}

/** Teslim tarihine kalan gün (negatif: geçti). */
export function daysUntil(dateOnly: string): number {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return Math.round((parseDateOnly(dateOnly).getTime() - today.getTime()) / 86400000);
}

export function todayISO(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function fullName(p: { first_name: string; last_name: string } | null | undefined): string {
  if (!p) return "—";
  const n = `${p.first_name} ${p.last_name}`.trim();
  return n || "İsimsiz kullanıcı";
}

export function initials(p: { first_name: string; last_name: string } | null | undefined): string {
  if (!p) return "?";
  return ((p.first_name[0] ?? "") + (p.last_name[0] ?? "")).toLocaleUpperCase("tr-TR") || "?";
}
