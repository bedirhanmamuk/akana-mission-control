import { useState } from "react";
import { Download, Eye, FileArchive, FileImage, FileSpreadsheet, FileText, Presentation, type LucideIcon } from "lucide-react";
import { canPreviewInBrowser, getSignedUrl } from "../lib/files";
import { formatBytes } from "../lib/format";
import { errorMessage } from "../lib/errors";
import { useToast } from "../context/ToastContext";
import type { ReportFile } from "../lib/types";
import { Spinner } from "./ui";

const ICONS: Record<string, LucideIcon> = {
  pdf: FileText, doc: FileText, docx: FileText,
  xls: FileSpreadsheet, xlsx: FileSpreadsheet, csv: FileSpreadsheet,
  ppt: Presentation, pptx: Presentation, zip: FileArchive,
  png: FileImage, jpg: FileImage, jpeg: FileImage,
};

export function fileIcon(ext: string): LucideIcon {
  return ICONS[ext] ?? FileText;
}

/** Rapor dosyaları: görüntüleme/indirme kısa ömürlü imzalı URL ile yapılır. */
export default function FileList({ files }: { files: ReportFile[] }) {
  const toast = useToast();
  const [busy, setBusy] = useState<string | null>(null);

  async function open(file: ReportFile, mode: "view" | "download") {
    // Önizleme sekmesi tıklama anında (eşzamanlı) açılır; aksi halde tarayıcılar,
    // özellikle mobil Safari, imzalı URL beklenirken açılan pencereyi engeller.
    const preview = mode === "view" ? window.open("", "_blank") : null;
    if (preview) preview.opener = null;
    setBusy(`${file.id}:${mode}`);
    try {
      const url = await getSignedUrl(file.storage_path);
      if (mode === "view") {
        if (preview) preview.location.replace(url);
        else window.location.assign(url);
        return;
      }
      // İndirme: içerik alınır ve özgün (Türkçe karakterli) dosya adıyla kaydedilir.
      const res = await fetch(url);
      if (!res.ok) throw new Error("Dosya indirilemedi. Lütfen tekrar deneyin.");
      const objectUrl = URL.createObjectURL(await res.blob());
      const a = document.createElement("a");
      a.href = objectUrl;
      a.download = file.original_name;
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.setTimeout(() => URL.revokeObjectURL(objectUrl), 30_000);
    } catch (e) {
      preview?.close();
      toast.error(errorMessage(e));
    } finally {
      setBusy(null);
    }
  }

  if (files.length === 0) return <p className="text-sm text-muted">Bu sürümde dosya yok.</p>;

  return (
    <ul className="divide-y divide-white/5 rounded-xl bg-raised/70">
      {files.map((f) => {
        const Icon = fileIcon(f.extension);
        return (
          <li key={f.id} className="flex items-center gap-3 px-3 py-2.5">
            <Icon className="size-5 shrink-0 text-accent-2" />
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm" title={f.original_name}>{f.original_name}</p>
              <p className="text-xs text-muted">{f.extension.toUpperCase()} · {formatBytes(f.size_bytes)}</p>
            </div>
            {canPreviewInBrowser(f.extension) && (
              <button className="btn-ghost min-h-9 px-2.5" onClick={() => void open(f, "view")} disabled={busy !== null} aria-label={`${f.original_name} dosyasını görüntüle`}>
                {busy === `${f.id}:view` ? <Spinner className="size-4" /> : <Eye className="size-4" />}
                <span className="hidden sm:inline">Görüntüle</span>
              </button>
            )}
            <button className="btn-secondary min-h-9 px-2.5" onClick={() => void open(f, "download")} disabled={busy !== null} aria-label={`${f.original_name} dosyasını indir`}>
              {busy === `${f.id}:download` ? <Spinner className="size-4" /> : <Download className="size-4" />}
              <span className="hidden sm:inline">İndir</span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}
