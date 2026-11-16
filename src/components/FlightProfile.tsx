import { TASK_STATUS_META } from "../lib/constants";
import type { TaskStatus } from "../lib/types";

/**
 * Görev uçuş profili: görevin yaşam döngüsü bir roketin yükseliş eğrisi üzerinde gösterilir.
 * Evre adları ürünün kendi durum adlarıdır; eğri yalnızca ilerlemeyi okunur kılar.
 */
const PHASES: TaskStatus[] = ["NEW", "IN_PROGRESS", "AWAITING_REPORT", "IN_REVIEW", "APPROVED", "COMPLETED"];

/** Durumun eğri üzerindeki konumu ve vurgusu. Gecikmiş/revizyon durumları kendi evresinde uyarı rengiyle durur. */
function locate(status: TaskStatus): { index: number; tone: "accent" | "warning" | "danger" | "success" } {
  switch (status) {
    case "OVERDUE": return { index: 1, tone: "danger" };
    case "REVISION_REQUESTED": return { index: 3, tone: "warning" };
    case "COMPLETED": return { index: 5, tone: "success" };
    default: return { index: Math.max(0, PHASES.indexOf(status)), tone: "accent" };
  }
}

const TONE = { accent: "var(--color-accent)", warning: "var(--color-warning)", danger: "var(--color-danger)", success: "var(--color-success)" } as const;
/** Geçerli aşama işareti: logodaki macenta ("şu an") */
const NOW = "var(--color-hot)";

// Yükseliş eğrisi: hızlı tırmanış, sonra yörüngeye oturma. x,y yüzde cinsinden (y: 0 üst).
const X0 = 5, X1 = 95, Y_BOTTOM = 82, Y_TOP = 16;
const curveY = (t: number) => Y_BOTTOM - (Y_BOTTOM - Y_TOP) * (1 - Math.pow(1 - t, 2.4));
const point = (i: number) => { const t = i / (PHASES.length - 1); return { x: X0 + (X1 - X0) * t, y: curveY(t) }; };
/** Eğrinin 0..upTo aralığını çizen yol (upTo: 0–1). */
function pathTo(upTo: number): string {
  const steps = Math.max(1, Math.round(48 * upTo));
  return Array.from({ length: steps + 1 }, (_, k) => {
    const t = (k / steps) * upTo;
    return `${k === 0 ? "M" : "L"}${(X0 + (X1 - X0) * t).toFixed(2)} ${curveY(t).toFixed(2)}`;
  }).join(" ");
}
const PATH = pathTo(1);

export default function FlightProfile({ status }: { status: TaskStatus }) {
  const { index, tone } = locate(status);
  const color = TONE[tone];
  const progress = index / (PHASES.length - 1);
  const currentLabel = TASK_STATUS_META[status].label;

  return (
    <div role="img" aria-label={`Görev aşaması: ${currentLabel} (${index + 1}/${PHASES.length})`} data-testid="flight-profile">
      <div className="relative h-28 sm:h-32">
        <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="absolute inset-0 size-full overflow-visible" aria-hidden>
          <path d={PATH} fill="none" stroke="var(--color-line-strong)" strokeWidth="2" strokeDasharray="1 5" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
        </svg>
        {/* Kat edilen yol: açılışta soldan sağa bir kez açılır */}
        {progress > 0 && (
          <svg key={status} viewBox="0 0 100 100" preserveAspectRatio="none" className="absolute inset-0 size-full overflow-visible"
            style={{ animation: "reveal 0.9s var(--ease-out) both" }} aria-hidden>
            <path d={pathTo(progress)} fill="none" stroke={color} strokeWidth="2.5" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
          </svg>
        )}
        {PHASES.map((phase, i) => {
          const p = point(i);
          const done = i < index;
          const current = i === index;
          return (
            <div key={phase} className="absolute -translate-x-1/2 -translate-y-1/2" style={{ left: `${p.x}%`, top: `${p.y}%` }}>
              {current && <span className="absolute inset-0 animate-beacon rounded-full" style={{ background: tone === "accent" ? NOW : color }} />}
              <span className="relative block rounded-full"
                style={{
                  width: current ? 14 : 10, height: current ? 14 : 10,
                  background: current && tone === "accent" ? NOW : done || current ? color : "var(--color-card)",
                  boxShadow: done || current ? "0 0 0 3px var(--color-card)" : "0 0 0 2px var(--color-line-strong) inset, 0 0 0 3px var(--color-card)",
                }} />
              <span className={`absolute left-1/2 top-full mt-2 -translate-x-1/2 whitespace-nowrap text-[11px] ${current ? "font-medium text-ink" : "hidden text-faint sm:block"}`}>
                {current ? currentLabel : TASK_STATUS_META[phase].label}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/** Kartlar ve listeler için küçük profil: altı evre, tek satır. */
export function FlightTrack({ status }: { status: TaskStatus }) {
  const { index, tone } = locate(status);
  return (
    <span className="inline-flex items-center gap-1" role="img" aria-label={`Aşama ${index + 1}/${PHASES.length}: ${TASK_STATUS_META[status].label}`}>
      {PHASES.map((p, i) => (
        <span key={p} className="h-1 rounded-full" style={{ width: i === index ? 16 : 8, background: i <= index ? TONE[tone] : "var(--color-line-strong)", opacity: i < index ? 0.55 : 1 }} />
      ))}
    </span>
  );
}
