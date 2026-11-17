import { supabase } from "./supabase";
import { unwrap } from "./useAsync";
import type {
  ActivityItem, AnalyticsData, CalendarEvent, DependencyInfo, DocumentRecord, DocumentVersion,
  HistoryItem, MissionOverview, Project, ProjectOverview, Risk, SearchResult, TaskComment, WeeklyReport,
} from "./types";
import type {
  Department, DepartmentStats, DirectoryEntry, Profile, Report, ReportVersion, TaskWithRelations,
} from "./types";

export const TASK_SELECT = "*, department:departments(id,name,code), task_assignees(user_id)";

export async function fetchDepartments(): Promise<Department[]> {
  return unwrap(await supabase.from("departments").select("*").order("name"));
}

export async function fetchDirectory(): Promise<DirectoryEntry[]> {
  return unwrap(await supabase.from("directory").select("*").order("first_name"));
}

export async function fetchProfiles(): Promise<Profile[]> {
  return unwrap(await supabase.from("profiles").select("*").order("first_name"));
}

export async function fetchDepartmentStats(): Promise<DepartmentStats[]> {
  return unwrap(await supabase.rpc("department_stats"));
}

export async function fetchTasks(): Promise<TaskWithRelations[]> {
  return unwrap(await supabase.from("tasks").select(TASK_SELECT).order("due_date", { ascending: true }));
}

export async function fetchTask(id: string): Promise<TaskWithRelations | null> {
  return unwrap(await supabase.from("tasks").select(TASK_SELECT).eq("id", id).maybeSingle());
}

export async function fetchVersions(reportId: string): Promise<ReportVersion[]> {
  return unwrap(
    await supabase
      .from("report_versions")
      .select("*, report_files(*)")
      .eq("report_id", reportId)
      .order("version_number", { ascending: false }),
  );
}

export async function fetchMaxFileSizeMb(): Promise<number> {
  const { data } = await supabase.from("app_settings").select("value").eq("key", "max_file_size_mb").maybeSingle();
  const n = Number(data?.value);
  return Number.isFinite(n) && n > 0 ? n : 25;
}

export function nameMap(dir: DirectoryEntry[]): Map<string, DirectoryEntry> {
  return new Map(dir.map((d) => [d.id, d]));
}

/** admin-users Edge Function çağrısı (service role yalnızca sunucuda). */
export async function adminUsers<T = { ok: true }>(body: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.functions.invoke("admin-users", { body });
  if (error) {
    let msg = error.message;
    const ctx = (error as { context?: Response }).context;
    if (ctx && typeof ctx.json === "function") {
      try {
        const j = (await ctx.json()) as { error?: string };
        if (j?.error) msg = j.error;
      } catch { /* gövde okunamadı */ }
    }
    if (/failed to send|failed to fetch|not found|404/i.test(msg)) {
      msg = "Üye yönetim servisine ulaşılamadı. 'admin-users' Edge Function'ının dağıtıldığından emin olun.";
    }
    throw new Error(msg);
  }
  if (data && typeof data === "object" && "error" in data && data.error) throw new Error(String(data.error));
  return data as T;
}

/** Yeni sürüm yüklenebilecek rapor durumları (sunucudaki submit_report ile aynı kural). */
export function canUploadNewVersion(report: Pick<Report, "status"> | null | undefined): boolean {
  return !report || !["IN_REVIEW", "APPROVED"].includes(report.status);
}

// ---------------------------------------------------------------------------
// Mission Control modülleri
// ---------------------------------------------------------------------------

export async function fetchProjects(): Promise<ProjectOverview[]> {
  return unwrap(await supabase.from("project_overview").select("*").order("target_date"));
}

export async function fetchProject(id: string): Promise<ProjectOverview | null> {
  return unwrap(await supabase.from("project_overview").select("*").eq("id", id).maybeSingle());
}

export async function fetchProjectList(): Promise<Pick<Project, "id" | "code" | "name" | "status">[]> {
  return unwrap(await supabase.from("projects").select("id,code,name,status").order("code"));
}

export async function fetchMissionOverview(): Promise<MissionOverview> {
  return unwrap(await supabase.rpc("mission_overview"));
}

export async function fetchActivity(departmentId: string | null = null, limit = 15): Promise<ActivityItem[]> {
  return unwrap(await supabase.rpc("activity_feed", { p_department_id: departmentId, p_limit: limit }));
}

export async function fetchTaskHistory(taskId: string): Promise<HistoryItem[]> {
  return unwrap(await supabase.rpc("task_history", { p_task_id: taskId }));
}

export async function fetchDependencies(taskId: string): Promise<DependencyInfo[]> {
  return unwrap(await supabase.rpc("task_dependency_info", { p_task_id: taskId }));
}

export async function fetchComments(taskId: string): Promise<TaskComment[]> {
  return unwrap(await supabase.from("task_comments").select("*").eq("task_id", taskId).order("created_at"));
}

export async function fetchSubtasks(taskId: string): Promise<TaskWithRelations[]> {
  return unwrap(await supabase.from("tasks").select(TASK_SELECT).eq("parent_id", taskId).order("due_date"));
}

export async function fetchDocuments(filter: { taskId?: string; projectId?: string; departmentId?: string } = {}): Promise<DocumentRecord[]> {
  let q = supabase.from("documents").select("*");
  if (filter.taskId) q = q.eq("task_id", filter.taskId);
  if (filter.projectId) q = q.eq("project_id", filter.projectId);
  if (filter.departmentId) q = q.eq("department_id", filter.departmentId);
  return unwrap(await q.order("updated_at", { ascending: false }).limit(500));
}

export async function fetchDocumentVersions(documentId: string): Promise<DocumentVersion[]> {
  return unwrap(await supabase.from("document_versions").select("*").eq("document_id", documentId).order("version_number", { ascending: false }));
}

export async function fetchEvents(fromISO: string, toISO: string): Promise<CalendarEvent[]> {
  return unwrap(await supabase.from("events").select("*").lte("starts_at", toISO).gte("ends_at", fromISO).order("starts_at"));
}

export async function fetchRisks(): Promise<Risk[]> {
  return unwrap(await supabase.from("risks").select("*").order("score", { ascending: false }).order("updated_at", { ascending: false }));
}

export async function fetchAnalytics(params: { from: string; to: string; projectId: string | null; departmentId: string | null }): Promise<AnalyticsData> {
  return unwrap(await supabase.rpc("analytics", {
    p_from: params.from, p_to: params.to, p_project_id: params.projectId, p_department_id: params.departmentId,
  }));
}

export async function fetchWeeklyReport(): Promise<WeeklyReport> {
  return unwrap(await supabase.rpc("weekly_report"));
}

export async function globalSearch(query: string): Promise<SearchResult[]> {
  return unwrap(await supabase.rpc("global_search", { p_query: query }));
}
