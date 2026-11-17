import { IMPACT_LABEL, PROBABILITY_LABEL } from "../lib/constants";
import type { Risk } from "../lib/types";

/** Puan bandının hücre rengi (renk tek başına anlam taşımaz: hücrede puan da yazar) */
function cellTone(score: number): string {
  if (score >= 15) return "bg-danger/30 hover:bg-danger/40";
  if (score >= 10) return "bg-warning/25 hover:bg-warning/35";
  if (score >= 5) return "bg-accent/18 hover:bg-accent/28";
  return "bg-success/14 hover:bg-success/24";
}

/**
 * 5×5 risk matrisi: satır = etki (5 üstte), sütun = olasılık. Hücredeki sayı o
 * noktadaki açık risk sayısıdır; tıklanınca liste o hücreye süzülür.
 */
export default function RiskMatrix({ risks, selected, onSelect }: {
  risks: Risk[]; selected: { p: number; i: number } | null; onSelect: (cell: { p: number; i: number } | null) => void;
}) {
  const open = risks.filter((r) => r.status !== "CLOSED");
  const count = (p: number, i: number) => open.filter((r) => r.probability === p && r.impact === i).length;
  return (
    <div className="flex gap-2" data-testid="risk-matrix">
      <div className="flex w-5 items-center justify-center"><span className="-rotate-90 text-xs whitespace-nowrap text-faint">Etki →</span></div>
      <div className="min-w-0 flex-1">
        <div className="grid grid-cols-[auto_repeat(5,minmax(0,1fr))] gap-1">
          {[5, 4, 3, 2, 1].map((i) => (
            <div key={i} className="contents">
              <div className="flex items-center justify-end pr-1.5 text-[10px] text-muted sm:text-xs" title={IMPACT_LABEL[i]}><span className="hidden sm:inline">{IMPACT_LABEL[i]}</span><span className="sm:hidden">{i}</span></div>
              {[1, 2, 3, 4, 5].map((p) => {
                const c = count(p, i); const s = p * i;
                const on = selected?.p === p && selected?.i === i;
                return (
                  <button key={p} onClick={() => onSelect(on ? null : { p, i })} aria-pressed={on}
                    aria-label={`Olasılık ${p}, etki ${i}, puan ${s}: ${c} açık risk`}
                    className={`relative flex aspect-[4/3] min-h-10 flex-col items-center justify-center rounded-md transition-colors ${cellTone(s)} ${on ? "ring-2 ring-ink" : ""}`}>
                    <span className="absolute top-0.5 left-1 text-[9px] text-ink/50 tabular-nums">{s}</span>
                    {c > 0 && <span className="num text-lg font-semibold text-ink">{c}</span>}
                  </button>
                );
              })}
            </div>
          ))}
          <div />
          {[1, 2, 3, 4, 5].map((p) => <div key={p} className="pt-1 text-center text-[10px] text-muted sm:text-xs" title={PROBABILITY_LABEL[p]}><span className="hidden sm:inline">{PROBABILITY_LABEL[p]}</span><span className="sm:hidden">{p}</span></div>)}
        </div>
        <p className="mt-1 text-center text-xs text-faint">Olasılık →</p>
      </div>
    </div>
  );
}
