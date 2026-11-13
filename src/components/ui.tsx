import { useEffect, type ReactNode } from "react";
import { AlertTriangle, Inbox, Loader2, RefreshCw, ShieldAlert, X } from "lucide-react";
import { Link } from "react-router-dom";
import type { Tone } from "../lib/constants";
import {
  PRIORITY_META, REPORT_STATUS_META, TASK_STATUS_META,
} from "../lib/constants";
import type { ReportStatus, TaskPriority, TaskStatus } from "../lib/types";

const TONE_CLASS: Record<Tone, string> = {
  neutral: "border-line bg-white/5 text-muted",
  accent: "border-accent/40 bg-accent/15 text-accent-2",
  success: "border-success/35 bg-success/10 text-success",
  warning: "border-warning/35 bg-warning/10 text-warning",
  danger: "border-danger/35 bg-danger/10 text-danger",
  info: "border-sky-400/30 bg-sky-400/10 text-sky-300",
};

export function Badge({ tone = "neutral", children }: { tone?: Tone; children: ReactNode }) {
  return (
    <span className={`inline-flex items-center gap-1 whitespace-nowrap rounded-md border px-2 py-0.5 text-[11px] font-medium ${TONE_CLASS[tone]}`}>
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

export function Spinner({ className = "size-5" }: { className?: string }) {
  return <Loader2 className={`animate-spin text-accent-2 ${className}`} aria-hidden />;
}

export function LoadingState({ label = "Yükleniyor…" }: { label?: string }) {
  return (
    <div className="flex min-h-48 flex-col items-center justify-center gap-3 py-12 text-muted" role="status">
      <Spinner className="size-7" />
      <span className="text-sm">{label}</span>
    </div>
  );
}

export function EmptyState({ title, description, action, icon }: {
  title: string; description?: string; action?: ReactNode; icon?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-line px-6 py-12 text-center">
      <div className="flex size-12 items-center justify-center rounded-full bg-white/5 text-muted">
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
    <div className="flex flex-col items-center justify-center gap-3 rounded-xl border border-danger/30 bg-danger/5 px-6 py-10 text-center" role="alert">
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
        <h1 className="text-xl font-semibold tracking-tight sm:text-2xl">{title}</h1>
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
      <h2 className="text-sm font-semibold tracking-wide text-ink">{children}</h2>
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
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center sm:p-4" role="dialog" aria-modal="true" aria-label={title}>
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={onClose} />
      <div className={`relative flex max-h-[92dvh] w-full animate-fade-in flex-col rounded-t-2xl border border-line bg-surface shadow-2xl sm:rounded-2xl ${wide ? "sm:max-w-2xl" : "sm:max-w-lg"}`}>
        <div className="flex items-center justify-between border-b border-line px-5 py-4">
          <h2 className="font-semibold">{title}</h2>
          <button onClick={onClose} className="rounded-md p-1 text-muted hover:bg-white/5 hover:text-ink" aria-label="Kapat">
            <X className="size-5" />
          </button>
        </div>
        <div className="overflow-y-auto px-5 py-4">{children}</div>
        {footer && <div className="flex flex-wrap justify-end gap-2 border-t border-line px-5 py-4">{footer}</div>}
      </div>
    </div>
  );
}

export function StatCard({ label, value, icon, tone = "accent", to }: {
  label: string; value: number | string; icon: ReactNode; tone?: Tone; to?: string;
}) {
  const body = (
    <div className={`card flex h-full items-center gap-3 p-3 transition-colors sm:gap-4 sm:p-4 ${to ? "hover:border-accent/50" : ""}`}>
      <div className={`flex size-9 shrink-0 items-center justify-center rounded-lg border sm:size-11 ${TONE_CLASS[tone]}`}>{icon}</div>
      <div className="min-w-0">
        <p className="line-clamp-2 text-xs leading-tight text-muted">{label}</p>
        <p className="text-2xl font-semibold tabular-nums tracking-tight">{value}</p>
      </div>
    </div>
  );
  return to ? <Link to={to}>{body}</Link> : body;
}

export function InfoRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5 py-2 sm:flex-row sm:items-start sm:gap-4">
      <dt className="w-36 shrink-0 text-xs font-medium text-muted sm:pt-0.5">{label}</dt>
      <dd className="min-w-0 flex-1 text-sm break-words">{children}</dd>
    </div>
  );
}
