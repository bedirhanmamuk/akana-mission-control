export type UserRole = "ADMIN" | "MEMBER";
export type TaskPriority = "LOW" | "NORMAL" | "HIGH" | "CRITICAL";
export type TaskStatus =
  | "NEW" | "IN_PROGRESS" | "AWAITING_REPORT" | "IN_REVIEW"
  | "REVISION_REQUESTED" | "APPROVED" | "COMPLETED" | "OVERDUE" | "BLOCKED" | "CANCELLED";
export type ReportStatus = "PENDING" | "IN_REVIEW" | "APPROVED" | "REVISION_REQUESTED" | "REJECTED";
export type NotificationType =
  | "TASK_ASSIGNED" | "TASK_DUE_SOON" | "TASK_OVERDUE" | "TASK_COMPLETED"
  | "REPORT_UPLOADED" | "REPORT_SUBMITTED" | "REPORT_IN_REVIEW"
  | "REPORT_REVISION_REQUESTED" | "REPORT_APPROVED" | "REPORT_REJECTED"
  | "TASK_UPDATED" | "TASK_COMMENT" | "RISK_CREATED"
  | "DOCUMENT_UPLOADED" | "DOCUMENT_APPROVED" | "DOCUMENT_REVISION_REQUESTED";
export type TeamPosition = "CAPTAIN" | "VICE_CAPTAIN" | "LEAD" | "MEMBER";
export type ProjectStatus = "PLANNING" | "ACTIVE" | "ON_HOLD" | "COMPLETED" | "CANCELLED";
export type RiskStatus = "OPEN" | "MITIGATING" | "MONITORING" | "CLOSED";
export type DocumentStatus = "DRAFT" | "PENDING" | "APPROVED" | "REVISION_REQUESTED";
export type DocumentCategory = "REPORT" | "DESIGN" | "ANALYSIS" | "TEST" | "CAD" | "PROCEDURE" | "MEETING" | "OTHER";
export type EventType = "MEETING" | "WORKSHOP" | "MILESTONE" | "TEST" | "OTHER";

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
  university: string;
  major: string;
  title: string;
  skills: string[];
  avatar_path: string | null;
  team_position: TeamPosition;
}

export interface DirectoryEntry {
  id: string;
  first_name: string;
  last_name: string;
  department_id: string | null;
  is_active: boolean;
  avatar_path?: string | null;
  university?: string;
  major?: string;
  title?: string;
  skills?: string[];
  team_position?: TeamPosition;
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
  project_id: string | null;
  parent_id: string | null;
  progress: number;
  difficulty: number;
  blocked_reason: string;
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

export interface Project {
  id: string;
  code: string;
  name: string;
  description: string;
  owner_id: string | null;
  department_id: string | null;
  start_date: string;
  target_date: string;
  status: ProjectStatus;
  created_at: string;
  updated_at: string;
}

export interface ProjectOverview extends Project {
  owner_name: string;
  total_tasks: number;
  completed_tasks: number;
  overdue_tasks: number;
  blocked_tasks: number;
  progress: number;
}

export interface TaskComment {
  id: string;
  task_id: string;
  author_id: string | null;
  body: string;
  created_at: string;
  updated_at: string;
}

export interface DependencyInfo {
  direction: "depends_on" | "blocks";
  task_id: string;
  code: string;
  title: string;
  status: TaskStatus;
  due_date: string;
  department_name: string;
  can_open: boolean;
}

export interface HistoryItem { id: number; action: string; summary: string; created_at: string; actor: string }

export interface ActivityItem extends HistoryItem { entity_type: string; entity_id: string | null }

export interface DocumentRecord {
  id: string;
  code: string;
  title: string;
  description: string;
  category: DocumentCategory;
  department_id: string | null;
  project_id: string | null;
  task_id: string | null;
  is_restricted: boolean;
  status: DocumentStatus;
  current_version: number;
  review_note: string | null;
  reviewed_by: string | null;
  reviewed_at: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface DocumentVersion {
  id: string;
  document_id: string;
  version_number: number;
  storage_path: string;
  original_name: string;
  extension: string;
  mime_type: string;
  size_bytes: number;
  note: string;
  uploaded_by: string | null;
  created_at: string;
}

export interface CalendarEvent {
  id: string;
  title: string;
  description: string;
  type: EventType;
  starts_at: string;
  ends_at: string;
  all_day: boolean;
  location: string;
  department_id: string | null;
  project_id: string | null;
  created_by: string | null;
}

export interface Risk {
  id: string;
  code: string;
  title: string;
  description: string;
  project_id: string | null;
  department_id: string | null;
  owner_id: string | null;
  probability: number;
  impact: number;
  score: number;
  mitigation: string;
  contingency: string;
  status: RiskStatus;
  last_reviewed_at: string;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface MissionTaskRow {
  id: string; code: string; title: string; due_date: string; status: TaskStatus;
  priority: TaskPriority; mine: boolean; department_name: string; progress?: number;
  blocked_reason?: string; reason?: "blocked" | "overdue" | "priority";
}

export interface MissionOverview {
  scope: "all" | "lead" | "member";
  total_projects: number;
  active_projects: number;
  active_tasks: number;
  completed_tasks: number;
  approved_tasks: number;
  total_tasks: number;
  in_progress_tasks: number;
  overdue_tasks: number;
  blocked_tasks: number;
  my_open_tasks: number;
  pending_approvals: number;
  active_members: number;
  projects: (Pick<ProjectOverview, "id" | "code" | "name" | "owner_name" | "start_date" | "target_date" | "status" | "progress" | "total_tasks" | "completed_tasks" | "overdue_tasks" | "blocked_tasks">)[];
  departments: { id: string; name: string; code: string; total: number; completed: number; active: number; overdue: number; blocked: number }[];
  upcoming: MissionTaskRow[];
  critical: MissionTaskRow[];
  critical_risks: Pick<Risk, "id" | "code" | "title" | "score" | "probability" | "impact" | "status">[];
  upcoming_events: Pick<CalendarEvent, "id" | "title" | "type" | "starts_at" | "ends_at" | "all_day" | "location">[];
}

export interface AnalyticsData {
  range: { from: string; to: string };
  scope: "all" | "lead";
  summary: {
    total: number; completed: number; on_time: number; overdue: number; blocked: number; cancelled: number;
    avg_completion_days: number | null; reviewed_versions: number; revision_versions: number;
  };
  departments: { id: string; name: string; total: number; completed: number; on_time: number; overdue: number; open: number }[];
  members: {
    user_id: string; name: string; department_id: string | null; completed: number; on_time: number;
    revisions: number; score: number; open_tasks: number; overdue_open: number; weighted_load: number;
  }[];
  weekly: { week: string; created: number; completed: number; due: number }[];
  projects: { id: string; code: string; name: string; progress: number; total_tasks: number; completed_tasks: number; overdue_tasks: number; target_date: string; status: ProjectStatus }[];
}

export interface WeeklyReport {
  period: { from: string; to: string };
  scope: "all" | "lead";
  created: number;
  completed: { code: string; title: string; department: string }[];
  overdue: { code: string; title: string; department: string; due_date: string; days_late: number }[];
  blocked: { code: string; title: string; department: string; reason: string }[];
  upcoming: { code: string; title: string; department: string; due_date: string; progress: number }[];
  risks: { code: string; title: string; score: number; status: RiskStatus; mitigation: string }[];
  pending_reports: number;
  pending_documents: number;
  projects: { code: string; name: string; progress: number; target_date: string; overdue: number }[];
}

export interface SearchResult {
  kind: "task" | "project" | "member" | "department" | "report" | "document" | "risk";
  id: string;
  title: string;
  subtitle: string;
  link: string;
}
