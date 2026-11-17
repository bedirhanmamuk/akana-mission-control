import type {
  DocumentCategory, DocumentStatus, EventType, NotificationType, ProjectStatus, ReportStatus, RiskStatus,
  TaskPriority, TaskStatus, TeamPosition, UserRole,
} from "./types";

export type Tone = "neutral" | "accent" | "success" | "warning" | "danger" | "info";

export const ROLE_LABEL: Record<UserRole, string> = { ADMIN: "Yönetici", MEMBER: "Ekip Üyesi" };

export const PRIORITY_META: Record<TaskPriority, { label: string; tone: Tone }> = {
  LOW: { label: "Düşük", tone: "neutral" },
  NORMAL: { label: "Normal", tone: "info" },
  HIGH: { label: "Yüksek", tone: "warning" },
  CRITICAL: { label: "Kritik", tone: "danger" },
};
export const PRIORITIES: TaskPriority[] = ["LOW", "NORMAL", "HIGH", "CRITICAL"];

export const TASK_STATUS_META: Record<TaskStatus, { label: string; tone: Tone; color: string }> = {
  NEW: { label: "Yeni", tone: "info", color: "#6aa9e9" },
  IN_PROGRESS: { label: "Devam ediyor", tone: "accent", color: "#d9a441" },
  AWAITING_REPORT: { label: "Rapor bekleniyor", tone: "warning", color: "#f0b35a" },
  IN_REVIEW: { label: "İncelemede", tone: "info", color: "#8fb8e8" },
  REVISION_REQUESTED: { label: "Revizyon istendi", tone: "warning", color: "#f28c38" },
  APPROVED: { label: "Onaylandı", tone: "success", color: "#5ccf91" },
  COMPLETED: { label: "Tamamlandı", tone: "success", color: "#3fbf7f" },
  OVERDUE: { label: "Gecikmiş", tone: "danger", color: "#ef5350" },
  BLOCKED: { label: "Bloke", tone: "danger", color: "#c2413f" },
  CANCELLED: { label: "İptal edildi", tone: "neutral", color: "#6f7a92" },
};
/** Kanban sütunları (iş akışı sırası) */
export const BOARD_COLUMNS: TaskStatus[] = ["NEW", "IN_PROGRESS", "BLOCKED", "AWAITING_REPORT", "IN_REVIEW", "REVISION_REQUESTED", "OVERDUE", "APPROVED", "COMPLETED", "CANCELLED"];
export const CLOSED_STATUSES: TaskStatus[] = ["COMPLETED", "APPROVED", "CANCELLED"];
export const PRIORITY_WEIGHT: Record<TaskPriority, number> = { LOW: 0.8, NORMAL: 1, HIGH: 1.25, CRITICAL: 1.5 };
export const TASK_STATUSES = Object.keys(TASK_STATUS_META) as TaskStatus[];

export const REPORT_STATUS_META: Record<ReportStatus, { label: string; tone: Tone; color: string }> = {
  PENDING: { label: "İnceleme bekliyor", tone: "info", color: "#6aa9e9" },
  IN_REVIEW: { label: "İnceleniyor", tone: "accent", color: "#d9a441" },
  APPROVED: { label: "Onaylandı", tone: "success", color: "#3fbf7f" },
  REVISION_REQUESTED: { label: "Revizyon istendi", tone: "warning", color: "#f28c38" },
  REJECTED: { label: "Reddedildi", tone: "danger", color: "#ef5350" },
};
export const REPORT_STATUSES = Object.keys(REPORT_STATUS_META) as ReportStatus[];

export const NOTIFICATION_META: Record<NotificationType, { label: string; tone: Tone }> = {
  TASK_ASSIGNED: { label: "Görev atandı", tone: "accent" },
  TASK_DUE_SOON: { label: "Teslim yaklaşıyor", tone: "warning" },
  TASK_OVERDUE: { label: "Görev gecikti", tone: "danger" },
  TASK_COMPLETED: { label: "Görev tamamlandı", tone: "success" },
  REPORT_UPLOADED: { label: "Rapor yüklendi", tone: "success" },
  REPORT_SUBMITTED: { label: "İnceleme bekliyor", tone: "info" },
  REPORT_IN_REVIEW: { label: "İncelemede", tone: "accent" },
  REPORT_REVISION_REQUESTED: { label: "Revizyon istendi", tone: "warning" },
  REPORT_APPROVED: { label: "Rapor onaylandı", tone: "success" },
  REPORT_REJECTED: { label: "Rapor reddedildi", tone: "danger" },
  TASK_UPDATED: { label: "Görev güncellendi", tone: "info" },
  TASK_COMMENT: { label: "Yeni yorum", tone: "accent" },
  RISK_CREATED: { label: "Risk kaydı", tone: "danger" },
  DOCUMENT_UPLOADED: { label: "Doküman yüklendi", tone: "info" },
  DOCUMENT_APPROVED: { label: "Doküman onaylandı", tone: "success" },
  DOCUMENT_REVISION_REQUESTED: { label: "Doküman revizyonu", tone: "warning" },
};

/** Bildirim tercihleri ekranındaki gruplar (kullanıcı türleri tek tek kapatabilir) */
export const NOTIFICATION_GROUPS: { title: string; types: NotificationType[] }[] = [
  { title: "Görevler", types: ["TASK_ASSIGNED", "TASK_UPDATED", "TASK_DUE_SOON", "TASK_OVERDUE", "TASK_COMPLETED", "TASK_COMMENT"] },
  { title: "Raporlar", types: ["REPORT_UPLOADED", "REPORT_SUBMITTED", "REPORT_IN_REVIEW", "REPORT_APPROVED", "REPORT_REVISION_REQUESTED", "REPORT_REJECTED"] },
  { title: "Doküman ve risk", types: ["DOCUMENT_UPLOADED", "DOCUMENT_APPROVED", "DOCUMENT_REVISION_REQUESTED", "RISK_CREATED"] },
];

export const POSITION_META: Record<TeamPosition, { label: string; rank: number }> = {
  CAPTAIN: { label: "Takım Kaptanı", rank: 0 },
  VICE_CAPTAIN: { label: "Kaptan Yardımcısı", rank: 1 },
  LEAD: { label: "Departman Sorumlusu", rank: 2 },
  MEMBER: { label: "Takım Üyesi", rank: 3 },
};
export const POSITIONS = Object.keys(POSITION_META) as TeamPosition[];

export const PROJECT_STATUS_META: Record<ProjectStatus, { label: string; tone: Tone }> = {
  PLANNING: { label: "Planlama", tone: "info" },
  ACTIVE: { label: "Aktif", tone: "accent" },
  ON_HOLD: { label: "Beklemede", tone: "warning" },
  COMPLETED: { label: "Tamamlandı", tone: "success" },
  CANCELLED: { label: "İptal edildi", tone: "neutral" },
};
export const PROJECT_STATUSES = Object.keys(PROJECT_STATUS_META) as ProjectStatus[];

export const RISK_STATUS_META: Record<RiskStatus, { label: string; tone: Tone }> = {
  OPEN: { label: "Açık", tone: "danger" },
  MITIGATING: { label: "Önlem alınıyor", tone: "warning" },
  MONITORING: { label: "İzleniyor", tone: "info" },
  CLOSED: { label: "Kapandı", tone: "neutral" },
};
export const RISK_STATUSES = Object.keys(RISK_STATUS_META) as RiskStatus[];
export const PROBABILITY_LABEL = ["", "Çok düşük", "Düşük", "Orta", "Yüksek", "Çok yüksek"];
export const IMPACT_LABEL = ["", "Önemsiz", "Küçük", "Orta", "Büyük", "Felaket"];
/** Risk puanı bandı: 1–4 düşük, 5–9 orta, 10–14 yüksek, 15–25 kritik */
export function riskBand(score: number): { label: string; tone: Tone } {
  if (score >= 15) return { label: "Kritik", tone: "danger" };
  if (score >= 10) return { label: "Yüksek", tone: "warning" };
  if (score >= 5) return { label: "Orta", tone: "accent" };
  return { label: "Düşük", tone: "success" };
}

export const DOCUMENT_STATUS_META: Record<DocumentStatus, { label: string; tone: Tone }> = {
  DRAFT: { label: "Taslak", tone: "neutral" },
  PENDING: { label: "Onay bekliyor", tone: "info" },
  APPROVED: { label: "Onaylandı", tone: "success" },
  REVISION_REQUESTED: { label: "Revizyon istendi", tone: "warning" },
};
export const DOCUMENT_CATEGORY_LABEL: Record<DocumentCategory, string> = {
  REPORT: "Teknik rapor", DESIGN: "Tasarım", ANALYSIS: "Analiz", TEST: "Test",
  CAD: "CAD / model", PROCEDURE: "Prosedür", MEETING: "Toplantı notu", OTHER: "Diğer",
};
export const DOCUMENT_CATEGORIES = Object.keys(DOCUMENT_CATEGORY_LABEL) as DocumentCategory[];

export const EVENT_TYPE_META: Record<EventType, { label: string; color: string }> = {
  MEETING: { label: "Toplantı", color: "#6aa9e9" },
  WORKSHOP: { label: "Atölye günü", color: "#d9a441" },
  MILESTONE: { label: "Kilometre taşı", color: "#ef5350" },
  TEST: { label: "Test / atış", color: "#3fbf7f" },
  OTHER: { label: "Diğer", color: "#9aa5bb" },
};
export const EVENT_TYPES = Object.keys(EVENT_TYPE_META) as EventType[];

export const ACTION_LABEL: Record<string, string> = {
  ADMIN_BOOTSTRAPPED: "İlk yönetici kurulumu",
  MEMBER_CREATED: "Üye oluşturuldu",
  MEMBER_UPDATED: "Üye güncellendi",
  MEMBER_EMAIL_CHANGED: "E-posta değiştirildi",
  MEMBER_PASSWORD_RESET: "Şifre sıfırlandı",
  DEPARTMENT_CREATED: "Departman oluşturuldu",
  DEPARTMENT_UPDATED: "Departman güncellendi",
  DEPARTMENT_DELETED: "Departman silindi",
  TASK_CREATED: "Görev oluşturuldu",
  TASK_UPDATED: "Görev güncellendi",
  TASK_DELETED: "Görev silindi",
  TASK_STATUS_CHANGED: "Görev durumu değişti",
  TASK_ASSIGNEES_CHANGED: "Sorumlular değişti",
  REPORT_SUBMITTED: "Rapor yüklendi",
  REPORT_START: "Rapor incelemeye alındı",
  REPORT_APPROVE: "Rapor onaylandı",
  REPORT_REQUEST_REVISION: "Revizyon istendi",
  REPORT_REJECT: "Rapor reddedildi",
  SETTING_CHANGED: "Ayar değişti",
  ROLE_CHANGED: "Yetki değişti",
  POSITION_CHANGED: "Pozisyon değişti",
  DEPARTMENT_LEAD_CHANGED: "Departman sorumlusu değişti",
  PROJECT_CREATED: "Proje oluşturuldu",
  PROJECT_UPDATED: "Proje güncellendi",
  PROJECT_DELETED: "Proje silindi",
  TASK_PROGRESS: "İlerleme güncellendi",
  TASK_BLOCKED: "Görev bloke edildi",
  TASK_UNBLOCKED: "Blokaj kaldırıldı",
  TASK_COMMENTED: "Yorum yapıldı",
  TASK_DEPENDENCY_ADDED: "Bağımlılık eklendi",
  TASK_DEPENDENCY_REMOVED: "Bağımlılık kaldırıldı",
  DOCUMENT_CREATED: "Doküman oluşturuldu",
  DOCUMENT_UPDATED: "Doküman güncellendi",
  DOCUMENT_UPLOADED: "Doküman yüklendi",
  DOCUMENT_APPROVED: "Doküman onaylandı",
  DOCUMENT_REVISION_REQUESTED: "Doküman revizyonu istendi",
  DOCUMENT_DELETED: "Doküman silindi",
  EVENT_CREATED: "Etkinlik eklendi",
  EVENT_UPDATED: "Etkinlik güncellendi",
  EVENT_DELETED: "Etkinlik silindi",
  RISK_CREATED: "Risk kaydedildi",
  RISK_UPDATED: "Risk güncellendi",
  RISK_DELETED: "Risk silindi",
};
