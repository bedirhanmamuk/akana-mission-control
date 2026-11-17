import { REPORTS_BUCKET, SUPABASE_ANON_KEY, SUPABASE_URL, supabase } from "./supabase";

type Magic = "pdf" | "zip" | "ole" | "png" | "jpg" | "text" | "stl" | "step";

interface FileRule {
  /** Storage'a gönderilen ve sunucuda (bucket + submit_report) doğrulanan kanonik MIME */
  mime: string;
  /** Tarayıcının bu uzantı için bildirebileceği kabul edilebilir MIME türleri */
  accepted: string[];
  magic: Magic;
}

/** İzin verilen dosya türleri. Sunucu tarafındaki private.canonical_mime ile aynı olmalıdır. */
export const FILE_RULES: Record<string, FileRule> = {
  pdf: { mime: "application/pdf", accepted: ["application/pdf"], magic: "pdf" },
  doc: { mime: "application/msword", accepted: ["application/msword"], magic: "ole" },
  docx: {
    mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    accepted: ["application/vnd.openxmlformats-officedocument.wordprocessingml.document"],
    magic: "zip",
  },
  xls: { mime: "application/vnd.ms-excel", accepted: ["application/vnd.ms-excel"], magic: "ole" },
  xlsx: {
    mime: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    accepted: ["application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"],
    magic: "zip",
  },
  ppt: { mime: "application/vnd.ms-powerpoint", accepted: ["application/vnd.ms-powerpoint"], magic: "ole" },
  pptx: {
    mime: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    accepted: ["application/vnd.openxmlformats-officedocument.presentationml.presentation"],
    magic: "zip",
  },
  csv: { mime: "text/csv", accepted: ["text/csv", "application/csv", "text/plain", "application/vnd.ms-excel"], magic: "text" },
  zip: { mime: "application/zip", accepted: ["application/zip", "application/x-zip-compressed", "application/x-zip"], magic: "zip" },
  png: { mime: "image/png", accepted: ["image/png"], magic: "png" },
  jpg: { mime: "image/jpeg", accepted: ["image/jpeg"], magic: "jpg" },
  jpeg: { mime: "image/jpeg", accepted: ["image/jpeg"], magic: "jpg" },
  // CAD: tarayıcılar bu türler için çoğunlukla boş veya genel MIME bildirir
  stl: { mime: "model/stl", accepted: ["model/stl", "application/sla", "application/vnd.ms-pki.stl", "application/octet-stream", "model/x.stl-binary", "model/x.stl-ascii"], magic: "stl" },
  step: { mime: "model/step", accepted: ["model/step", "application/step", "application/octet-stream", "model/x-step", "application/x-step"], magic: "step" },
  stp: { mime: "model/step", accepted: ["model/step", "application/step", "application/octet-stream", "model/x-step", "application/x-step"], magic: "step" },
};

export const ALLOWED_EXTENSIONS = Object.keys(FILE_RULES);
/** Seçim listelerinde gösterilen uzantılar (eş anlamlı jpeg/stp tekrarlanmaz) */
export const PICKABLE_EXTENSIONS = ALLOWED_EXTENSIONS.filter((x) => x !== "jpeg" && x !== "stp");
export const DOCUMENTS_BUCKET = "documents";
export const AVATARS_BUCKET = "avatars";
export const ACCEPT_ATTR = ALLOWED_EXTENSIONS.map((e) => `.${e}`).join(",");
export const MAX_FILES_PER_UPLOAD = 10;

export function fileExtension(name: string): string {
  const m = /\.([A-Za-z0-9]+)$/.exec(name);
  return m ? m[1].toLowerCase() : "";
}

function startsWith(bytes: Uint8Array, sig: number[]): boolean {
  return sig.every((b, i) => bytes[i] === b);
}

function checkMagic(bytes: Uint8Array, magic: Magic): boolean {
  switch (magic) {
    case "pdf": return startsWith(bytes, [0x25, 0x50, 0x44, 0x46]);
    case "zip": return startsWith(bytes, [0x50, 0x4b, 0x03, 0x04]) || startsWith(bytes, [0x50, 0x4b, 0x05, 0x06]);
    case "ole": return startsWith(bytes, [0xd0, 0xcf, 0x11, 0xe0]);
    case "png": return startsWith(bytes, [0x89, 0x50, 0x4e, 0x47]);
    case "jpg": return startsWith(bytes, [0xff, 0xd8, 0xff]);
    case "text": return !bytes.includes(0); // ikili içerik barındırmamalı
    // STL: ASCII ("solid") veya 80 baytlık başlıklı ikili biçim; ikili biçimin imzası yoktur
    case "stl": return bytes.length >= 84 || startsWith(bytes, [0x73, 0x6f, 0x6c, 0x69, 0x64]);
    // STEP (ISO 10303-21) düz metin, "ISO-10303-21" ile başlar
    case "step": return new TextDecoder().decode(bytes.slice(0, 32)).trimStart().startsWith("ISO-10303-21");
  }
}

/**
 * Dosyayı yükleme öncesinde doğrular: uzantı, tarayıcının bildirdiği MIME,
 * boyut ve dosya imzası (magic bytes). Hata varsa Türkçe mesaj döner.
 * Not: Bu istemci kontrolü kullanıcı deneyimi içindir; bağlayıcı doğrulama
 * Storage bucket kuralları ve submit_report RPC'sinde sunucuda yapılır.
 */
export async function validateFile(file: File, maxBytes: number): Promise<string | null> {
  const ext = fileExtension(file.name);
  const rule = FILE_RULES[ext];
  if (!rule) {
    return `Desteklenmeyen dosya türü${ext ? ` (.${ext})` : ""}. İzin verilenler: ${ALLOWED_EXTENSIONS.join(", ").toUpperCase()}`;
  }
  if (file.size === 0) return "Dosya boş.";
  if (file.size > maxBytes) {
    return `Dosya çok büyük (${(file.size / 1048576).toFixed(1)} MB). Sınır: ${Math.round(maxBytes / 1048576)} MB.`;
  }
  if (file.type && !rule.accepted.includes(file.type.toLowerCase())) {
    return `Dosya türü (${file.type}) uzantısıyla (.${ext}) uyuşmuyor.`;
  }
  try {
    const head = new Uint8Array(await file.slice(0, 1024).arrayBuffer());
    if (!checkMagic(head, rule.magic)) {
      return `Dosya içeriği .${ext} biçimiyle uyuşmuyor; dosya bozuk veya uzantısı değiştirilmiş olabilir.`;
    }
  } catch {
    return "Dosya okunamadı.";
  }
  return null;
}

export async function sha256Hex(file: File): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", await file.arrayBuffer());
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

/** Storage anahtarları için güvenli (ASCII) dosya adı üretir; özgün ad veritabanında saklanır. */
export function safeObjectName(name: string, index: number): string {
  const ext = fileExtension(name);
  const map: Record<string, string> = { ç: "c", ğ: "g", ı: "i", ö: "o", ş: "s", ü: "u", Ç: "C", Ğ: "G", İ: "I", Ö: "O", Ş: "S", Ü: "U" };
  const base = name
    .slice(0, name.length - (ext ? ext.length + 1 : 0))
    .replace(/[çğıöşüÇĞİÖŞÜ]/g, (c) => map[c] ?? c)
    .normalize("NFKD")
    .replace(/[^A-Za-z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^[-.]+|[-.]+$/g, "")
    .slice(0, 80);
  return `${String(index + 1).padStart(2, "0")}-${base || "dosya"}.${ext}`;
}

export class UploadError extends Error {}

function storageErrorMessage(status: number, body: string, fileName: string): string {
  let msg = "";
  try {
    const j = JSON.parse(body) as { message?: string; error?: string };
    msg = j.message ?? j.error ?? "";
  } catch { /* gövde JSON değil */ }
  if (status === 413 || /maximum allowed size|too large/i.test(msg)) return `"${fileName}" dosya boyutu sınırını aşıyor.`;
  if (status === 415 || /mime type/i.test(msg)) return `"${fileName}" dosya türüne izin verilmiyor.`;
  if (status === 409 || /already exists|duplicate/i.test(msg)) return `"${fileName}" zaten yüklenmiş.`;
  if (status === 401 || /jwt/i.test(msg)) return "Oturumunuzun süresi doldu. Lütfen tekrar giriş yapın.";
  if (status === 403 || /row-level security|not authorized|unauthorized/i.test(msg)) {
    return "Bu göreve dosya yükleme yetkiniz yok.";
  }
  return `"${fileName}" yüklenemedi${msg ? `: ${msg}` : ` (HTTP ${status})`}.`;
}

/**
 * Tek bir dosyayı gerçek yükleme ilerlemesiyle Storage'a gönderir.
 * supabase-js ilerleme bildirmediği için XMLHttpRequest kullanılır; istek
 * kullanıcının kendi oturum belirteciyle yapılır ve Storage RLS'e tabidir.
 */
export function uploadWithProgress(
  path: string,
  file: File,
  contentType: string,
  accessToken: string,
  onProgress: (loaded: number, total: number) => void,
  signal?: AbortSignal,
  bucket: string = REPORTS_BUCKET,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    const encoded = path.split("/").map(encodeURIComponent).join("/");
    xhr.open("POST", `${SUPABASE_URL}/storage/v1/object/${bucket}/${encoded}`);
    xhr.setRequestHeader("Authorization", `Bearer ${accessToken}`);
    xhr.setRequestHeader("apikey", SUPABASE_ANON_KEY);
    xhr.setRequestHeader("x-upsert", "false");
    xhr.setRequestHeader("Content-Type", contentType);
    xhr.setRequestHeader("Cache-Control", "max-age=3600");
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress(e.loaded, e.total);
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        onProgress(file.size, file.size);
        resolve();
      } else {
        reject(new UploadError(storageErrorMessage(xhr.status, xhr.responseText, file.name)));
      }
    };
    xhr.onerror = () =>
      reject(new UploadError(
        navigator.onLine === false
          ? "İnternet bağlantısı kesildi. Bağlantı geldiğinde tekrar deneyin."
          : `"${file.name}" yüklenirken bağlantı hatası oluştu. Tekrar deneyin.`,
      ));
    xhr.ontimeout = () => reject(new UploadError(`"${file.name}" yüklenirken zaman aşımı oluştu.`));
    xhr.onabort = () => reject(new UploadError("Yükleme iptal edildi."));
    signal?.addEventListener("abort", () => xhr.abort(), { once: true });
    xhr.send(file);
  });
}

/** Yarım kalan yüklemeden artan nesneleri temizler (henüz rapora bağlanmamış olanlar silinebilir). */
export async function removeOrphans(paths: string[], bucket: string = REPORTS_BUCKET): Promise<void> {
  if (paths.length === 0) return;
  try {
    await supabase.storage.from(bucket).remove(paths);
  } catch { /* en iyi çaba */ }
}

/**
 * Kısa ömürlü (60 sn) imzalı URL üretir. İmzalama isteği kullanıcının
 * oturumuyla yapılır; Storage RLS politikası izin vermezse URL üretilmez.
 */
export async function getSignedUrl(path: string, downloadName?: string, bucket: string = REPORTS_BUCKET): Promise<string> {
  const { data, error } = await supabase.storage
    .from(bucket)
    .createSignedUrl(path, 60, downloadName ? { download: downloadName } : undefined);
  if (error || !data?.signedUrl) {
    throw new Error("Dosyaya erişilemedi. Yetkiniz olmayabilir veya dosya bulunamadı.");
  }
  return data.signedUrl;
}

export function canPreviewInBrowser(ext: string): boolean {
  return ["pdf", "png", "jpg", "jpeg"].includes(ext);
}
