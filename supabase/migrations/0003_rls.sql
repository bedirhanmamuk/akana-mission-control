-- =============================================================================
-- AKANA MISSION CONTROL — 0003: Yetkiler ve Row Level Security
-- İlke: varsayılan olarak her şey kapalı. anon rolünün hiçbir yetkisi yok.
-- Yazma işlemlerinin çoğu RPC ile yapılır; tablolarda yalnızca gerekli
-- politikalar tanımlıdır.
-- =============================================================================

-- ---- Şema ve fonksiyon yetkileri -------------------------------------------
revoke all on schema private from public, anon;
grant usage on schema private to authenticated, service_role;

revoke execute on all functions in schema private from public, anon, authenticated;
grant execute on function
  private.is_active_user(), private.is_admin(), private.my_department_id(),
  private.is_task_assignee(uuid), private.can_view_task(uuid),
  private.can_view_report(uuid), private.today(), private.canonical_mime(text),
  private.max_file_size_bytes()
to authenticated, service_role;
alter default privileges in schema private revoke execute on functions from public;

revoke execute on all functions in schema public from public, anon;
grant execute on function
  public.update_own_profile(text, text),
  public.create_task(text, text, uuid, date, date, public.task_priority, text[], text, uuid[]),
  public.set_task_assignees(uuid, uuid[]),
  public.start_task(uuid),
  public.submit_report(uuid, text, text, text, jsonb),
  public.review_report(uuid, text, text),
  public.process_deadlines(),
  public.set_max_file_size_mb(integer),
  public.department_stats(),
  public.dashboard_stats()
to authenticated, service_role;

-- ---- Tablo yetkileri --------------------------------------------------------
revoke all on all tables in schema public from anon, authenticated;

grant select on public.profiles, public.departments, public.tasks, public.task_assignees,
                public.reports, public.report_versions, public.report_files,
                public.notifications, public.activity_logs, public.app_settings,
                public.directory, public.report_overview
  to authenticated;

grant insert, update, delete on public.departments to authenticated;   -- RLS: yalnızca yönetici
grant update (first_name, last_name, department_id, role, is_active)
  on public.profiles to authenticated;                                  -- RLS: yalnızca yönetici
grant update (title, description, start_date, due_date, priority, status, required_file_types, notes)
  on public.tasks to authenticated;                                     -- RLS: yalnızca yönetici
grant delete on public.tasks to authenticated;                          -- RLS: yalnızca yönetici
grant update (is_read, read_at) on public.notifications to authenticated; -- RLS: yalnızca sahibi
grant delete on public.notifications to authenticated;                  -- RLS: yalnızca sahibi

grant all on all tables in schema public to service_role;
grant usage, select on all sequences in schema public to service_role;

-- ---- RLS'i etkinleştir ------------------------------------------------------
alter table public.profiles        enable row level security;
alter table public.departments     enable row level security;
alter table public.tasks           enable row level security;
alter table public.task_assignees  enable row level security;
alter table public.reports         enable row level security;
alter table public.report_versions enable row level security;
alter table public.report_files    enable row level security;
alter table public.notifications   enable row level security;
alter table public.activity_logs   enable row level security;
alter table public.app_settings    enable row level security;

-- ---- profiles ---------------------------------------------------------------
-- Kullanıcı kendi profilini (pasif olsa bile, durum ekranı için) görür.
create policy profiles_select on public.profiles for select to authenticated
  using (id = (select auth.uid()) or private.is_admin());
create policy profiles_update_admin on public.profiles for update to authenticated
  using (private.is_admin()) with check (private.is_admin());
-- insert/delete politikası yok: profil yalnızca auth tetikleyicisiyle oluşur.

-- ---- departments ------------------------------------------------------------
create policy departments_select on public.departments for select to authenticated
  using (private.is_active_user());
create policy departments_insert_admin on public.departments for insert to authenticated
  with check (private.is_admin());
create policy departments_update_admin on public.departments for update to authenticated
  using (private.is_admin()) with check (private.is_admin());
create policy departments_delete_admin on public.departments for delete to authenticated
  using (private.is_admin());

-- ---- tasks ------------------------------------------------------------------
create policy tasks_select on public.tasks for select to authenticated
  using (
    private.is_admin()
    or (private.is_active_user()
        and (department_id = private.my_department_id() or private.is_task_assignee(id)))
  );
create policy tasks_update_admin on public.tasks for update to authenticated
  using (private.is_admin()) with check (private.is_admin());
create policy tasks_delete_admin on public.tasks for delete to authenticated
  using (private.is_admin());
-- insert politikası yok: görevler create_task RPC'si ile oluşturulur.

-- ---- task_assignees ---------------------------------------------------------
create policy task_assignees_select on public.task_assignees for select to authenticated
  using (private.can_view_task(task_id));
-- yazma: yalnızca create_task / set_task_assignees RPC'leri.

-- ---- reports / report_versions / report_files -------------------------------
create policy reports_select on public.reports for select to authenticated
  using (
    private.is_admin()
    or (private.is_active_user() and uploaded_by = (select auth.uid()))
  );
create policy report_versions_select on public.report_versions for select to authenticated
  using (private.can_view_report(report_id));
create policy report_files_select on public.report_files for select to authenticated
  using (private.can_view_report(report_id));
-- yazma: yalnızca submit_report / review_report RPC'leri.

-- ---- notifications ----------------------------------------------------------
create policy notifications_select on public.notifications for select to authenticated
  using (user_id = (select auth.uid()) and private.is_active_user());
create policy notifications_update on public.notifications for update to authenticated
  using (user_id = (select auth.uid()) and private.is_active_user())
  with check (user_id = (select auth.uid()));
create policy notifications_delete on public.notifications for delete to authenticated
  using (user_id = (select auth.uid()) and private.is_active_user());

-- ---- activity_logs ----------------------------------------------------------
create policy activity_logs_select_admin on public.activity_logs for select to authenticated
  using (private.is_admin());

-- ---- app_settings -----------------------------------------------------------
create policy app_settings_select on public.app_settings for select to authenticated
  using (private.is_active_user());
