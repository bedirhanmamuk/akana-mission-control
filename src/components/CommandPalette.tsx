import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { createPortal } from "react-dom";
import { useNavigate } from "react-router-dom";
import {
  AlertTriangle, Building2, ClipboardList, FileText, FolderKanban, Search, ShieldAlert, UserRound, X, type LucideIcon,
} from "lucide-react";
import { globalSearch } from "../lib/api";
import { errorMessage } from "../lib/errors";
import type { SearchResult } from "../lib/types";
import { Spinner } from "./ui";

const KIND: Record<SearchResult["kind"], { label: string; icon: LucideIcon }> = {
  task: { label: "Görevler", icon: ClipboardList },
  project: { label: "Projeler", icon: FolderKanban },
  member: { label: "Ekip", icon: UserRound },
  department: { label: "Departmanlar", icon: Building2 },
  report: { label: "Raporlar", icon: FileText },
  document: { label: "Dokümanlar", icon: FileText },
  risk: { label: "Riskler", icon: ShieldAlert },
};
const ORDER: SearchResult["kind"][] = ["task", "project", "document", "report", "risk", "member", "department"];

/**
 * Uygulama geneli arama (Ctrl/⌘+K). Sonuçlar sunucuda kullanıcının yetkisine göre
 * süzülür (global_search RPC); istemci yalnızca gruplar ve gezinir.
 */
export default function CommandPalette({ open, onClose }: { open: boolean; onClose: () => void }) {
  const navigate = useNavigate();
  const [q, setQ] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    setQ(""); setResults([]); setError(null); setActive(0);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    window.setTimeout(() => inputRef.current?.focus(), 10);
    return () => { document.body.style.overflow = prev; };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const term = q.trim();
    if (term.length < 2) { setResults([]); setBusy(false); return; }
    setBusy(true);
    let alive = true;
    const t = window.setTimeout(() => {
      globalSearch(term)
        .then((r) => { if (alive) { setResults(r); setError(null); setActive(0); } })
        .catch((e) => { if (alive) setError(errorMessage(e)); })
        .finally(() => { if (alive) setBusy(false); });
    }, 220);
    return () => { alive = false; window.clearTimeout(t); };
  }, [q, open]);

  const ordered = useMemo(
    () => ORDER.flatMap((k) => results.filter((r) => r.kind === k)),
    [results],
  );

  function go(r: SearchResult) {
    onClose();
    navigate(r.link);
  }

  function onKey(e: KeyboardEvent) {
    if (e.key === "Escape") { e.preventDefault(); onClose(); }
    else if (e.key === "ArrowDown") { e.preventDefault(); setActive((a) => Math.min(ordered.length - 1, a + 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setActive((a) => Math.max(0, a - 1)); }
    else if (e.key === "Enter" && ordered[active]) { e.preventDefault(); go(ordered[active]); }
  }

  if (!open) return null;
  let index = -1;
  return createPortal(
    <div className="fixed inset-0 z-[60] flex items-start justify-center p-0 sm:p-4 sm:pt-[12vh]" role="dialog" aria-modal="true" aria-label="Global arama">
      <div className="absolute inset-0 animate-backdrop bg-[#04070d]/80" onClick={onClose} />
      <div className="relative flex h-dvh w-full animate-dialog flex-col bg-card shadow-[0_30px_80px_-20px_rgb(0_0_0/0.9)] sm:h-auto sm:max-h-[70vh] sm:max-w-xl sm:rounded-2xl" onKeyDown={onKey}>
        <div className="flex items-center gap-3 border-b border-line-soft px-4 py-3">
          <Search className="size-5 shrink-0 text-muted" />
          <input ref={inputRef} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Görev, proje, doküman, risk veya kişi ara…"
            className="min-h-10 flex-1 bg-transparent text-base text-ink outline-none placeholder:text-faint sm:text-sm" aria-label="Arama metni"
            role="combobox" aria-expanded={ordered.length > 0} aria-controls="search-results" aria-activedescendant={ordered[active] ? `sr-${ordered[active].kind}-${ordered[active].id}` : undefined} />
          {busy && <Spinner className="size-4" />}
          <button onClick={onClose} className="flex size-9 items-center justify-center rounded-md text-muted hover:bg-ink/5 hover:text-ink" aria-label="Aramayı kapat"><X className="size-5" /></button>
        </div>
        <div className="flex-1 overflow-y-auto p-2" id="search-results" role="listbox" aria-label="Arama sonuçları">
          {error ? (
            <p className="flex items-center gap-2 px-3 py-6 text-sm text-danger"><AlertTriangle className="size-4" /> {error}</p>
          ) : q.trim().length < 2 ? (
            <p className="px-3 py-8 text-center text-sm text-muted">Aramak için en az iki karakter yazın.</p>
          ) : !busy && ordered.length === 0 ? (
            <p className="px-3 py-8 text-center text-sm text-muted">“{q.trim()}” için sonuç bulunamadı.</p>
          ) : (
            ORDER.filter((k) => ordered.some((r) => r.kind === k)).map((k) => {
              const Icon = KIND[k].icon;
              return (
                <div key={k} className="mb-2">
                  <p className="px-3 pt-2 pb-1 text-xs font-medium text-faint">{KIND[k].label}</p>
                  {ordered.filter((r) => r.kind === k).map((r) => {
                    index += 1;
                    const i = index;
                    return (
                      <button key={`${r.kind}-${r.id}`} id={`sr-${r.kind}-${r.id}`} role="option" aria-selected={active === i}
                        onMouseEnter={() => setActive(i)} onClick={() => go(r)} data-testid="search-result"
                        className={`flex min-h-11 w-full items-center gap-3 rounded-lg px-3 py-2 text-left ${active === i ? "bg-accent/15" : "hover:bg-ink/5"}`}>
                        <Icon className={`size-4 shrink-0 ${active === i ? "text-accent-2" : "text-muted"}`} />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm">{r.title}</span>
                          <span className="block truncate text-xs text-muted">{r.subtitle}</span>
                        </span>
                      </button>
                    );
                  })}
                </div>
              );
            })
          )}
        </div>
        <div className="hidden items-center gap-4 border-t border-line-soft px-4 py-2 text-[11px] text-faint sm:flex">
          <span><kbd className="font-mono">↑↓</kbd> gezin</span><span><kbd className="font-mono">Enter</kbd> aç</span><span><kbd className="font-mono">Esc</kbd> kapat</span>
        </div>
      </div>
    </div>,
    document.body,
  );
}
