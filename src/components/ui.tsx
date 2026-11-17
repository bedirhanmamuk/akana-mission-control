import { useEffect, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { AlertTriangle, Inbox, Loader2, RefreshCw, ShieldAlert, X } from "lucide-react";
import { Link } from "react-router-dom";
import type { Tone } from "../lib/constants";
import {
  DOCUMENT_STATUS_META, PRIORITY_META, PROJECT_STATUS_META, REPORT_STATUS_META, RISK_STATUS_META, TASK_STATUS_META, riskBand,
} from "../lib/constants";
import type { DocumentStatus, ProjectStatus, ReportStatus, RiskStatus, TaskPriority, TaskStatus } from "../lib/types";
import { useCountUp } from "../lib/motion";
import { useAvatarUrl } from "../lib/avatars";
import { initials } from "../lib/format";

const TONE_CLASS: Record<Tone, string> = {
  neutral: "bg-ink/6 text-muted",
  accent: "bg-accent/18 text-accent-2",
  success: "bg-success/12 text-success",
  warning: "bg-warning/14 text-warning",
  danger: "bg-danger/14 text-danger",
  info: "bg-info/14 text-info",
};

export function Badge({ tone = "neutral", children }: { tone?: Tone; children: ReactNode }) {
  return (
    <span className={`inline-flex items-center gap-1 whitespace-nowrap rounded-md px-2 py-0.5 text-[11px] font-medium ${TONE_CLASS[tone]}`}>
      {children}
    </span>
  );
}

export function TaskStatusBadge({ status }: { status: TaskStatus }) {
  const m = TASK_STATUS_META[status];
  return <Badge tone={m.tone}>{m.label}</Badge>;
}
export function ReportStatusBadge({ status }: { status: ReportStatus }) {
  const m = REPORT_STATUS_META[status];
  return <Badge tone={m.tone}>{m.label}</Badge>;
}
export function PriorityBadge({ priority }: { priority: TaskPriority }) {
  const m = PRIORITY_META[priority];
  return <Badge tone={m.tone}>{m.label}</Badge>;
}
export function ProjectStatusBadge({ status }: { status: ProjectStatus }) {
  const m = PROJECT_STATUS_META[status];
  return <Badge tone={m.tone}>{m.label}</Badge>;
}
export function RiskStatusBadge({ status }: { status: RiskStatus }) {
  const m = RISK_STATUS_META[status];
  return <Badge tone={m.tone}>{m.label}</Badge>;
}
export function DocumentStatusBadge({ status }: { status: DocumentStatus }) {
  const m = DOCUMENT_STATUS_META[status];
  return <Badge tone={m.tone}>{m.label}</Badge>;
}
/** Risk puanı (olasılık × etki, 1–25) ve bandı */
export function RiskScore({ score }: { score: number }) {
  const b = riskBand(score);
  return (
    <span className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-md px-2 py-0.5 text-[11px] font-semibold tabular-nums ${TONE_CLASS[b.tone]}`} title={`Risk puanı ${score}/25 · ${b.label}`}>
      {score}<span className="font-medium opacity-80">{b.label}</span>
    </span>
  );
}

/** İlerleme çubuğu: değer 0–100. Renk yalnızca durum anlamı taşıdığında değişir. */
export function ProgressBar({ value, tone = "accent", label, className = "" }: {
  value: number; tone?: "accent" | "success" | "danger" | "warning"; label?: string; className?: string;
}) {
  const v = Math.max(0, Math.min(100, Math.round(value)));
  const bg = { accent: "bg-accent", success: "bg-success", danger: "bg-danger", warning: "bg-warning" }[tone];
  return (
    <div className={`h-1.5 overflow-hidden rounded-full bg-ink/8 ${className}`} role="progressbar" aria-valuenow={v} aria-valuemin={0} aria-valuemax={100} aria-label={label ?? `İlerleme yüzde ${v}`}>
      <div className={`bar-grow h-full rounded-full ${bg}`} style={{ width: `${v}%` }} />
    </div>
  );
}

/** Kişi avatarı: fotoğraf varsa imzalı URL ile, yoksa baş harfler */
export function Avatar({ person, size = 32, className = "" }: {
  person: { first_name: string; last_name: string; avatar_path?: string | null } | null | undefined; size?: number; className?: string;
}) {
  const url = useAvatarUrl(person?.avatar_path);
  const style = { width: size, height: size, fontSize: Math.max(10, Math.round(size * 0.36)) };
  return url ? (
    <img src={url} alt="" style={style} className={`shrink-0 rounded-full object-cover ${className}`} />
  ) : (
    <span style={style} className={`flex shrink-0 items-center justify-center rounded-full bg-accent/18 font-semibold text-accent-2 ${className}`} aria-hidden>
      {initials(person)}
    </span>
  );
}

/** Sekmeli seçim (görünüm, kapsam). Klavye ile gezilebilir düğme grubu. */
export function Segmented<T extends string>({ options, value, onChange, label, size = "md" }: {
  options: readonly (readonly [T, string])[]; value: T; onChange: (v: T) => void; label: string; size?: "sm" | "md";
}) {
  return (
    <div className="inline-flex max-w-full shrink-0 self-start overflow-x-auto rounded-lg bg-surface p-1" role="tablist" aria-label={label}>
      {options.map(([k, text]) => (
        <button key={k} type="button" role="tab" aria-selected={value === k} onClick={() => onChange(k)}
          className={`shrink-0 rounded-md px-3 transition-colors duration-150 ${size === "sm" ? "min-h-8 text-xs" : "min-h-9 text-sm"} ${value === k ? "bg-accent font-medium text-on-accent" : "text-muted hover:text-ink"}`}>
          {text}
        </button>
      ))}
    </div>
  );
}

export function FormError({ children }: { children: ReactNode }) {
  if (!children) return null;
  return <p className="rounded-lg border border-danger/40 bg-danger/10 px-3 py-2 text-sm text-danger" role="alert">{children}</p>;
}

export function Skeleton({ className = "" }: { className?: string }) {
  return <div className={`skeleton ${className}`} aria-hidden />;
}

export function Spinner({ className = "size-5" }: { className?: string }) {
  return <Loader2 className={`animate-spin ${/\btext-/.test(className) ? "" : "text-accent-2"} ${className}`} aria-hidden />;
}

/** Yükleniyor: içerik yerleşimini taklit eden iskelet (ekran okuyucuya etiket okunur) */
export function LoadingState({ label = "Yükleniyor…", variant = "page" }: { label?: string; variant?: "page" | "list" | "compact" }) {
  return (
    <div className="py-2" role="status" aria-live="polite">
      <span className="sr-only">{label}</span>
      {variant === "compact" ? (
        <div className="space-y-2"><Skeleton className="h-4 w-2/3" /><Skeleton className="h-4 w-1/2" /></div>
      ) : variant === "list" ? (
        <div className="space-y-2">{[0, 1, 2, 3, 4].map((i) => <Skeleton key={i} className="h-14" />)}</div>
      ) : (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">{[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-24 rounded-2xl" />)}</div>
          <div className="grid gap-4 lg:grid-cols-2"><Skeleton className="h-64 rounded-2xl" /><Skeleton className="h-64 rounded-2xl" /></div>
        </div>
      )}
    </div>
  );
}

export function EmptyState({ title, description, action, icon }: {
  title: string; description?: string; action?: ReactNode; icon?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 rounded-2xl bg-surface/70 px-6 py-14 text-center">
      <div className="flex size-12 items-center justify-center rounded-full bg-ink/5 text-muted">
        {icon ?? <Inbox className="size-6" />}
      </div>
      <div>
        <p className="font-medium text-ink">{title}</p>
        {description && <p className="mt-1 max-w-md text-sm text-muted">{description}</p>}
      </div>
      {action}
    </div>
  );
}

export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 rounded-2xl bg-danger/8 px-6 py-10 text-center" role="alert">
      <AlertTriangle className="size-7 text-danger" />
      <div>
        <p className="font-medium text-ink">Veriler yüklenemedi</p>
        <p className="mt-1 max-w-md text-sm text-muted">{message}</p>
      </div>
      {onRetry && (
        <button className="btn-secondary" onClick={onRetry}>
          <RefreshCw className="size-4" /> Tekrar dene
        </button>
      )}
    </div>
  );
}

export function Unauthorized() {
  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center gap-4 text-center">
      <div className="flex size-16 items-center justify-center rounded-full bg-danger/10 text-danger">
        <ShieldAlert className="size-8" />
      </div>
      <div>
        <h1 className="text-xl font-semibold">Yetkisiz erişim</h1>
        <p className="mt-1 max-w-sm text-sm text-muted">
          Bu sayfayı görüntüleme yetkiniz yok. Bir hata olduğunu düşünüyorsanız takım yöneticinizle iletişime geçin.
        </p>
      </div>
      <Link to="/" className="btn-primary">Genel Bakış'a dön</Link>
    </div>
  );
}

export function PageHeader({ title, description, actions }: {
  title: string; description?: string; actions?: ReactNode;
}) {
  return (
    <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
      <div className="min-w-0">
        <h1 className="display text-2xl font-semibold sm:text-[28px]">{title}</h1>
        {description && <p className="mt-1 text-sm text-muted">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function Card({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={`card ${className}`}>{children}</div>;
}

export function SectionTitle({ children, aside }: { children: ReactNode; aside?: ReactNode }) {
  return (
    <div className="mb-4 flex items-center justify-between gap-3">
      <h2 className="text-[15px] font-semibold text-ink">{children}</h2>
      {aside}
    </div>
  );
}

export function Field({ label, children, hint, required }: {
  label: string; children: ReactNode; hint?: string; required?: boolean;
}) {
  return (
    <label className="block">
      <span className="label">
        {label} {required && <span className="text-danger">*</span>}
      </span>
      {children}
      {hint && <span className="mt-1 block text-xs text-muted">{hint}</span>}
    </label>
  );
}

export function Modal({ open, onClose, title, children, footer, wide }: {
  open: boolean; onClose: () => void; title: string; children: ReactNode; footer?: ReactNode; wide?: boolean;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [open, onClose]);

  if (!open) return null;
  // Pencere doğrudan <body> altına çizilir: sayfa geçiş animasyonu gibi dönüşüm uygulanan
  // bir üst öğe, "fixed" konumu ekrana değil kendine bağlar ve pencere görünür alanın dışında kalırdı.
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center sm:p-4" role="dialog" aria-modal="true" aria-label={title}>
      <div className="absolute inset-0 animate-backdrop bg-[#04070d]/80" onClick={onClose} />
      <div className={`relative flex max-h-[92dvh] w-full animate-sheet flex-col rounded-t-3xl bg-card shadow-[0_30px_80px_-20px_rgb(0_0_0/0.9)] sm:animate-dialog sm:rounded-2xl ${wide ? "sm:max-w-2xl" : "sm:max-w-lg"}`}>
        <div className="flex items-center justify-between border-b border-line-soft px-5 py-4">
          <h2 className="font-semibold">{title}</h2>
          <button onClick={onClose} className="rounded-md p-1 text-muted hover:bg-ink/5 hover:text-ink" aria-label="Kapat">
            <X className="size-5" />
          </button>
        </div>
        <div className="overflow-y-auto px-5 py-4">{children}</div>
        {footer && <div className="flex flex-col-reverse gap-2 border-t border-line-soft px-5 pt-4 pb-[max(1rem,env(safe-area-inset-bottom))] sm:flex-row sm:flex-wrap sm:justify-end [&>*]:w-full sm:[&>*]:w-auto">{footer}</div>}
      </div>
    </div>,
    document.body,
  );
}

/** Telemetri okuması: etiket + büyük rakam. Rakam panel açılışında bir kez sayarak gelir. */
export function Readout({ label, value, to, tone }: {
  label: string; value: number; to?: string; tone?: "success" | "warning" | "danger";
}) {
  const shown = useCountUp(value);
  const alert = tone && tone !== "success" && value > 0;
  const color = tone === "success" ? "text-success" : alert ? (tone === "danger" ? "text-danger" : "text-warning") : "text-ink";
  const body = (
    <>
      <span className="flex min-h-[2.5em] items-end gap-1.5 text-[13px] leading-tight text-muted">
        {alert && <span className={`mb-[0.4em] size-1.5 shrink-0 rounded-full ${tone === "danger" ? "bg-danger" : "bg-warning"}`} />}
        {label}
      </span>
      {" "}
      <span className={`num mt-1 block text-[34px] font-semibold leading-none ${color}`}>{shown}</span>
    </>
  );
  const cls = "block min-w-0 rounded-xl px-3 py-3 -mx-1";
  return to
    ? <Link to={to} className={`${cls} transition-colors duration-150 hover:bg-ink/5`}>{body}</Link>
    : <div className={cls}>{body}</div>;
}

export function ReadoutGroup({ title, children, cols = 3 }: { title: string; children: ReactNode; cols?: 2 | 3 }) {
  return (
    <div className="min-w-0 px-4 py-4 sm:px-5">
      <h2 className="mb-1 px-2 text-xs font-medium text-faint">{title}</h2>
      <div className={`grid grid-cols-2 gap-x-2 ${cols === 3 ? "sm:grid-cols-3" : ""}`}>{children}</div>
    </div>
  );
}

export function InfoRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5 py-2 sm:flex-row sm:items-start sm:gap-4">
      <dt className="w-36 shrink-0 text-xs font-medium text-muted sm:pt-0.5">{label}</dt>
      <dd className="min-w-0 flex-1 text-sm break-words">{children}</dd>
    </div>
  );
}
