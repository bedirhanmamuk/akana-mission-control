import type { NotificationType, ReportStatus, TaskPriority, TaskStatus, UserRole } from "./types";

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
  NEW: { label: "Yeni", tone: "info", color: "#60A5FA" },
  IN_PROGRESS: { label: "Devam ediyor", tone: "accent", color: "#8065D8" },
  AWAITING_REPORT: { label: "Rapor bekleniyor", tone: "warning", color: "#FBBF24" },
  IN_REVIEW: { label: "İncelemede", tone: "accent", color: "#A78BFA" },
  REVISION_REQUESTED: { label: "Revizyon istendi", tone: "warning", color: "#F59E0B" },
  APPROVED: { label: "Onaylandı", tone: "success", color: "#4ADE80" },
  COMPLETED: { label: "Tamamlandı", tone: "success", color: "#22C55E" },
  OVERDUE: { label: "Gecikmiş", tone: "danger", color: "#EF4444" },
};
export const TASK_STATUSES = Object.keys(TASK_STATUS_META) as TaskStatus[];

export const REPORT_STATUS_META: Record<ReportStatus, { label: string; tone: Tone; color: string }> = {
  PENDING: { label: "İnceleme bekliyor", tone: "info", color: "#60A5FA" },
  IN_REVIEW: { label: "İnceleniyor", tone: "accent", color: "#A78BFA" },
  APPROVED: { label: "Onaylandı", tone: "success", color: "#22C55E" },
  REVISION_REQUESTED: { label: "Revizyon istendi", tone: "warning", color: "#F59E0B" },
  REJECTED: { label: "Reddedildi", tone: "danger", color: "#EF4444" },
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
};

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
};
