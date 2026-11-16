import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from "react";
import { AlertTriangle, CheckCircle2, Info, X, XCircle } from "lucide-react";

type ToastKind = "success" | "error" | "info" | "warning";
interface Toast { id: number; kind: ToastKind; message: string }

interface ToastApi {
  success: (m: string) => void;
  error: (m: string) => void;
  info: (m: string) => void;
  warning: (m: string) => void;
}

const ToastContext = createContext<ToastApi | null>(null);

const STYLE: Record<ToastKind, { icon: typeof Info; cls: string }> = {
  success: { icon: CheckCircle2, cls: "border-success/40 text-success" },
  error: { icon: XCircle, cls: "border-danger/40 text-danger" },
  info: { icon: Info, cls: "border-accent/40 text-accent-2" },
  warning: { icon: AlertTriangle, cls: "border-warning/40 text-warning" },
};

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const seq = useRef(0);

  const dismiss = useCallback((id: number) => setToasts((t) => t.filter((x) => x.id !== id)), []);
  const push = useCallback((kind: ToastKind, message: string) => {
    const id = ++seq.current;
    setToasts((t) => [...t.slice(-3), { id, kind, message }]);
    window.setTimeout(() => dismiss(id), kind === "error" ? 8000 : 5000);
  }, [dismiss]);

  const api = useMemo<ToastApi>(() => ({
    success: (m) => push("success", m),
    error: (m) => push("error", m),
    info: (m) => push("info", m),
    warning: (m) => push("warning", m),
  }), [push]);

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div className="pointer-events-none fixed inset-x-4 bottom-[calc(76px+env(safe-area-inset-bottom))] z-[100] lg:bottom-6 flex flex-col items-end gap-2 sm:inset-x-auto sm:right-6" aria-live="polite">
        {toasts.map((t) => {
          const { icon: Icon, cls } = STYLE[t.kind];
          return (
            <div key={t.id} role={t.kind === "error" ? "alert" : "status"}
              className={`pointer-events-auto flex w-full max-w-sm animate-slide-in items-start gap-3 rounded-xl border bg-card px-4 py-3 shadow-xl shadow-black/40 ${cls}`}>
              <Icon className="mt-0.5 size-5 shrink-0" />
              <p className="flex-1 text-sm leading-snug text-ink">{t.message}</p>
              <button onClick={() => dismiss(t.id)} className="text-muted hover:text-ink" aria-label="Bildirimi kapat">
                <X className="size-4" />
              </button>
            </div>
          );
        })}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastApi {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast, ToastProvider içinde kullanılmalıdır.");
  return ctx;
}
