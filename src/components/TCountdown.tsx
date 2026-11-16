import { daysUntil, formatDate } from "../lib/format";
import type { TaskStatus } from "../lib/types";

/**
 * Teslim tarihini fırlatma sayacı gibi gösterir: T-3 (3 gün kaldı), T-0 (bugün), T+2 (2 gün geçti).
 * Kapanmış görevlerde sayaç yerine yalnızca tarih görünür.
 */
export default function TCountdown({ dueDate, status, showDate = true }: {
  dueDate: string; status: TaskStatus; showDate?: boolean;
}) {
  const closed = status === "COMPLETED" || status === "APPROVED";
  const d = daysUntil(dueDate);
  if (closed) return <span className="text-xs text-faint tabular-nums">{formatDate(dueDate)}</span>;

  const tone = d < 0 ? "bg-danger/15 text-danger" : d <= 3 ? "bg-warning/15 text-warning" : "bg-ink/5 text-muted";
  const label = d < 0 ? `T+${-d}` : `T-${d}`;
  const spoken = d < 0 ? `${-d} gün gecikti` : d === 0 ? "bugün teslim" : `${d} gün kaldı`;
  return (
    <span className="inline-flex items-center gap-2 whitespace-nowrap" title={`${formatDate(dueDate)} · ${spoken}`}>
      <span className={`rounded-md px-1.5 py-0.5 font-mono text-[11px] font-medium tabular-nums ${tone}`} aria-label={spoken}>{label}</span>
      {showDate && <span className="text-xs text-muted tabular-nums">{formatDate(dueDate)}</span>}
    </span>
  );
}
