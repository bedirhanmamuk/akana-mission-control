import { formatDateTime } from "../lib/format";
import type { DirectoryEntry, ReportVersion } from "../lib/types";
import { fullName } from "../lib/format";
import FileList from "./FileList";
import { ReportStatusBadge } from "./ui";

/** Raporun tüm sürümleri (en yeni üstte). Eski sürümler asla silinmez. */
export default function VersionHistory({ versions, currentVersion, names }: {
  versions: ReportVersion[]; currentVersion: number; names?: Map<string, DirectoryEntry>;
}) {
  return (
    <ol className="space-y-4">
      {versions.map((v) => (
        <li key={v.id} className="rounded-xl border border-line bg-card p-4" data-testid={`version-${v.version_number}`}>
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <span className="rounded-md bg-accent/20 px-2 py-0.5 font-mono text-xs font-bold text-accent-2">V{v.version_number}</span>
            {v.version_number === currentVersion && <span className="text-[11px] font-medium text-muted">Güncel sürüm</span>}
            <ReportStatusBadge status={v.status} />
            <span className="ml-auto text-xs text-muted">{formatDateTime(v.created_at)}</span>
          </div>
          {v.note && (
            <p className="mb-3 text-sm text-muted"><span className="font-medium text-ink">Sürüm notu:</span> {v.note}</p>
          )}
          <FileList files={v.report_files} />
          {v.review_note && (
            <div className={`mt-3 rounded-lg border px-3 py-2 text-sm ${
              v.status === "APPROVED" ? "border-success/30 bg-success/5" : v.status === "REJECTED" ? "border-danger/30 bg-danger/5" : "border-warning/30 bg-warning/5"
            }`}>
              <p className="text-xs font-semibold text-muted">
                Yönetici değerlendirmesi
                {v.reviewed_by && names?.get(v.reviewed_by) ? ` · ${fullName(names.get(v.reviewed_by))}` : ""}
                {v.reviewed_at ? ` · ${formatDateTime(v.reviewed_at)}` : ""}
              </p>
              <p className="mt-1 whitespace-pre-wrap">{v.review_note}</p>
            </div>
          )}
        </li>
      ))}
    </ol>
  );
}
