export type UserRole = "ADMIN" | "MEMBER";
export type TaskPriority = "LOW" | "NORMAL" | "HIGH" | "CRITICAL";
export type TaskStatus =
  | "NEW" | "IN_PROGRESS" | "AWAITING_REPORT" | "IN_REVIEW"
  | "REVISION_REQUESTED" | "APPROVED" | "COMPLETED" | "OVERDUE";
export type ReportStatus = "PENDING" | "IN_REVIEW" | "APPROVED" | "REVISION_REQUESTED" | "REJECTED";
export type NotificationType =
  | "TASK_ASSIGNED" | "TASK_DUE_SOON" | "TASK_OVERDUE" | "TASK_COMPLETED"
  | "REPORT_UPLOADED" | "REPORT_SUBMITTED" | "REPORT_IN_REVIEW"
  | "REPORT_REVISION_REQUESTED" | "REPORT_APPROVED" | "REPORT_REJECTED";

export interface Profile {
  id: string;
  first_name: string;
  last_name: string;
  email: string;
  department_id: string | null;
  role: UserRole;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface DirectoryEntry {
  id: string;
  first_name: string;
  last_name: string;
  department_id: string | null;
  is_active: boolean;
}

export interface Department {
  id: string;
  name: string;
  code: string;
  description: string;
  lead_id: string | null;
  is_active: boolean;
  task_seq: number;
  created_at: string;
}

export interface DepartmentStats {
  department_id: string;
  member_count: number;
  total_tasks: number;
  completed_tasks: number;
  submitted_reports: number;
  pending_reports: number;
}

export interface Task {
  id: string;
  code: string;
  title: string;
  description: string;
  department_id: string;
  start_date: string;
  due_date: string;
  priority: TaskPriority;
  status: TaskStatus;
  required_file_types: string[];
  notes: string;
  created_by: string | null;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface TaskWithRelations extends Task {
  department: Pick<Department, "id" | "name" | "code"> | null;
  task_assignees: { user_id: string }[];
}

export interface Report {
  id: string;
  task_id: string;
  uploaded_by: string;
  title: string;
  description: string;
  status: ReportStatus;
  current_version: number;
  review_note: string | null;
  reviewed_by: string | null;
  reviewed_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface ReportFile {
  id: string;
  version_id: string;
  report_id: string;
  storage_path: string;
  original_name: string;
  extension: string;
  mime_type: string;
  size_bytes: number;
  created_at: string;
}

export interface ReportVersion {
  id: string;
  report_id: string;
  version_number: number;
  note: string;
  status: ReportStatus;
  review_note: string | null;
  reviewed_by: string | null;
  reviewed_at: string | null;
  uploaded_by: string;
  created_at: string;
  report_files: ReportFile[];
}

export interface ReportOverview {
  id: string;
  title: string;
  description: string;
  status: ReportStatus;
  current_version: number;
  review_note: string | null;
  reviewed_at: string | null;
  created_at: string;
  updated_at: string;
  task_id: string;
  task_code: string;
  task_title: string;
  department_id: string;
  department_name: string;
  uploaded_by: string;
  uploader_name: string | null;
  file_extensions: string[];
  file_count: number;
  total_bytes: number;
}

export interface Notification {
  id: string;
  user_id: string;
  type: NotificationType;
  title: string;
  body: string;
  link: string | null;
  is_read: boolean;
  read_at: string | null;
  created_at: string;
}

export interface ActivityLog {
  id: number;
  actor_id: string | null;
  action: string;
  entity_type: string;
  entity_id: string | null;
  summary: string;
  details: Record<string, unknown>;
  created_at: string;
}

export interface DashboardStats {
  total_members: number;
  active_departments: number;
  total_tasks: number;
  completed_tasks: number;
  pending_reports: number;
  approved_reports: number;
  revision_reports: number;
  overdue_tasks: number;
  tasks_by_department: { name: string; total: number; completed: number; approved: number; overdue: number }[];
  monthly_uploads: { month: string; count: number }[];
  task_status: { status: TaskStatus; count: number }[];
  report_status: { status: ReportStatus; count: number }[];
  recent_reports: {
    report_id: string; title: string; status: ReportStatus; version: number;
    task_code: string; uploader: string; created_at: string;
  }[];
  recent_activity: { id: number; action: string; summary: string; created_at: string; actor: string }[];
}
