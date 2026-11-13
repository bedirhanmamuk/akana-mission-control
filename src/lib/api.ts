import { supabase } from "./supabase";
import { unwrap } from "./useAsync";
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
