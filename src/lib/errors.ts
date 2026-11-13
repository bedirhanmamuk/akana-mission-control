interface ErrorLike {
  message?: string;
  code?: string;
  details?: string | null;
  status?: number;
  name?: string;
}

/** Supabase / ağ hatalarını kullanıcıya gösterilebilir Türkçe mesaja çevirir. */
export function errorMessage(err: unknown, fallback = "Beklenmeyen bir hata oluştu."): string {
  if (!err) return fallback;
  if (typeof err === "string") return err;
  const e = err as ErrorLike;
  const msg = e.message ?? "";

  if (typeof navigator !== "undefined" && navigator.onLine === false) {
    return "İnternet bağlantısı yok. Bağlantınızı kontrol edip tekrar deneyin.";
  }
  if (/failed to fetch|networkerror|load failed|network request failed/i.test(msg)) {
    return "Sunucuya ulaşılamıyor. İnternet bağlantınızı kontrol edip tekrar deneyin.";
  }
  if (/invalid login credentials/i.test(msg)) return "E-posta veya şifre hatalı.";
  if (/email not confirmed/i.test(msg)) return "E-posta adresi doğrulanmamış.";
  if (/rate limit|too many requests/i.test(msg)) return "Çok fazla deneme yapıldı. Lütfen biraz bekleyin.";
  if (/jwt expired|invalid jwt|session.*(missing|expired)/i.test(msg)) {
    return "Oturumunuzun süresi doldu. Lütfen tekrar giriş yapın.";
  }
  if (/new password should be different/i.test(msg)) return "Yeni şifre eski şifreyle aynı olamaz.";
  if (/password should be at least/i.test(msg)) return "Şifre yeterince uzun değil.";
  if (/row-level security|permission denied/i.test(msg)) return "Bu işlem için yetkiniz yok.";
  if (e.code === "23503") return "Bu kayıt başka kayıtlarla ilişkili olduğu için silinemez.";
  if (e.code === "23505" && !/[çğıöşüÇĞİÖŞÜ]/.test(msg)) return "Bu kayıt zaten mevcut.";
  if (e.code === "23514") return "Girilen değerler geçerli değil. Alanları kontrol edin.";
  if (e.code === "PGRST116") return "Kayıt bulunamadı veya erişim yetkiniz yok.";
  return msg || fallback;
}
