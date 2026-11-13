-- =============================================================================
-- AKANA MISSION CONTROL — 0002: Fonksiyonlar, tetikleyiciler ve RPC'ler
-- Tüm SECURITY DEFINER fonksiyonlar boş search_path ile çalışır; kimlik
-- yalnızca auth.uid() üzerinden alınır, istemciden gelen kullanıcı/rol
-- bilgisine güvenilmez.
-- =============================================================================

-- ----------------------------------------------------------------------------
-- Yetki yardımcıları (RLS politikalarında kullanılır)
-- ----------------------------------------------------------------------------
create or replace function private.is_active_user()
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.profiles p where p.id = auth.uid() and p.is_active
  );
$$;

create or replace function private.is_admin()
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and p.is_active and p.role = 'ADMIN'
  );
$$;

create or replace function private.my_department_id()
returns uuid language sql stable security definer set search_path = '' as $$
  select p.department_id from public.profiles p where p.id = auth.uid() and p.is_active;
$$;

create or replace function private.is_task_assignee(p_task_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.task_assignees ta
    where ta.task_id = p_task_id and ta.user_id = auth.uid()
  ) and private.is_active_user();
$$;

create or replace function private.can_view_task(p_task_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select private.is_admin() or (
    private.is_active_user() and exists (
      select 1 from public.tasks t
      where t.id = p_task_id
        and (t.department_id = private.my_department_id()
             or private.is_task_assignee(t.id))
    )
  );
$$;

create or replace function private.can_view_report(p_report_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select private.is_admin() or (
    private.is_active_user() and exists (
      select 1 from public.reports r
      where r.id = p_report_id and r.uploaded_by = auth.uid()
    )
  );
$$;

create or replace function private.today()
returns date language sql stable set search_path = '' as $$
  select (now() at time zone 'Europe/Istanbul')::date;
$$;

-- Görev durumlarının Türkçe karşılığı (kayıt ve bildirim metinleri için)
create or replace function private.task_status_label(p_status public.task_status)
returns text language sql immutable set search_path = '' as $$
  select case p_status
    when 'NEW' then 'Yeni'
    when 'IN_PROGRESS' then 'Devam ediyor'
    when 'AWAITING_REPORT' then 'Rapor bekleniyor'
    when 'IN_REVIEW' then 'İncelemede'
    when 'REVISION_REQUESTED' then 'Revizyon istendi'
    when 'APPROVED' then 'Onaylandı'
    when 'COMPLETED' then 'Tamamlandı'
    when 'OVERDUE' then 'Gecikmiş'
  end;
$$;

-- İzin verilen uzantılar ve her uzantının kanonik MIME türü
create or replace function private.canonical_mime(p_ext text)
returns text language sql immutable set search_path = '' as $$
  select case lower(p_ext)
    when 'pdf'  then 'application/pdf'
    when 'doc'  then 'application/msword'
    when 'docx' then 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    when 'xls'  then 'application/vnd.ms-excel'
    when 'xlsx' then 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    when 'ppt'  then 'application/vnd.ms-powerpoint'
    when 'pptx' then 'application/vnd.openxmlformats-officedocument.presentationml.presentation'
    when 'csv'  then 'text/csv'
    when 'zip'  then 'application/zip'
    when 'png'  then 'image/png'
    when 'jpg'  then 'image/jpeg'
    when 'jpeg' then 'image/jpeg'
    else null
  end;
$$;

create or replace function private.max_file_size_bytes()
returns bigint language sql stable security definer set search_path = '' as $$
  select coalesce(
    (select (s.value #>> '{}')::bigint from public.app_settings s where s.key = 'max_file_size_mb'),
    25
  ) * 1024 * 1024;
$$;

-- ----------------------------------------------------------------------------
-- Bildirim ve denetim kaydı yardımcıları (yalnızca iç kullanım)
-- ----------------------------------------------------------------------------
create or replace function private.notify(
  p_user_id uuid, p_type public.notification_type, p_title text,
  p_body text default '', p_link text default null, p_dedupe_key text default null
) returns void language plpgsql security definer set search_path = '' as $$
begin
  if p_user_id is null then return; end if;
  insert into public.notifications (user_id, type, title, body, link, dedupe_key)
  values (p_user_id, p_type, p_title, coalesce(p_body, ''), p_link, p_dedupe_key)
  on conflict (user_id, dedupe_key) do nothing;
end;
$$;

create or replace function private.notify_admins(
  p_type public.notification_type, p_title text, p_body text default '',
  p_link text default null, p_dedupe_key text default null, p_except uuid default null
) returns void language plpgsql security definer set search_path = '' as $$
declare r record;
begin
  for r in select id from public.profiles where role = 'ADMIN' and is_active
           and (p_except is null or id <> p_except)
  loop
    perform private.notify(r.id, p_type, p_title, p_body, p_link, p_dedupe_key);
  end loop;
end;
$$;

create or replace function private.log_activity(
  p_action text, p_entity_type text, p_entity_id text, p_summary text,
  p_details jsonb default '{}'::jsonb
) returns void language plpgsql security definer set search_path = '' as $$
declare v_actor uuid := auth.uid();
begin
  -- aktör profili yoksa (ör. SQL editöründen çalıştırma) null bırak
  if v_actor is not null and not exists (select 1 from public.profiles where id = v_actor) then
    v_actor := null;
  end if;
  insert into public.activity_logs (actor_id, action, entity_type, entity_id, summary, details)
  values (v_actor, p_action, p_entity_type, p_entity_id, coalesce(p_summary, ''), coalesce(p_details, '{}'::jsonb));
end;
$$;

-- ----------------------------------------------------------------------------
-- auth.users -> profiles: her yeni hesap MEMBER ve PASİF başlar.
-- Hesabı yalnızca yönetici (admin-users Edge Function) etkinleştirir; böylece
-- herkese açık kayıt açık kalsa bile kendi kendine kayıt olan biri hiçbir
-- veriye erişemez ve asla yönetici olamaz.
-- ----------------------------------------------------------------------------
create or replace function private.handle_new_user()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles (id, email, first_name, last_name, role, is_active)
  values (
    new.id,
    coalesce(new.email, ''),
    left(coalesce(new.raw_user_meta_data ->> 'first_name', ''), 60),
    left(coalesce(new.raw_user_meta_data ->> 'last_name', ''), 60),
    'MEMBER',
    false
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function private.handle_new_user();

-- ----------------------------------------------------------------------------
-- İlk yönetici kurulumu: yalnızca SQL editöründen (postgres rolüyle) ve
-- sistemde hiç yönetici yokken çalışır. API üzerinden çağrılamaz.
-- ----------------------------------------------------------------------------
create or replace function private.bootstrap_first_admin(p_email text)
returns text language plpgsql security definer set search_path = '' as $$
declare v_id uuid;
begin
  if exists (select 1 from public.profiles where role = 'ADMIN') then
    raise exception 'Sistemde zaten bir yönetici var. Yeni yöneticileri Üye Yönetimi ekranından atayın.';
  end if;
  select id into v_id from public.profiles where lower(email) = lower(btrim(p_email));
  if v_id is null then
    raise exception 'Bu e-posta ile kayıtlı kullanıcı yok: %. Önce Authentication > Users bölümünden kullanıcıyı oluşturun.', p_email;
  end if;
  update public.profiles set role = 'ADMIN', is_active = true where id = v_id;
  insert into public.activity_logs (actor_id, action, entity_type, entity_id, summary)
  values (v_id, 'ADMIN_BOOTSTRAPPED', 'profile', v_id::text, 'İlk yönetici hesabı kuruldu');
  return 'İlk yönetici atandı: ' || p_email;
end;
$$;

-- ----------------------------------------------------------------------------
-- profiles koruma + denetim tetikleyicisi
-- ----------------------------------------------------------------------------
create or replace function private.profiles_before_update()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.id <> old.id or new.created_at <> old.created_at then
    raise exception 'Profil kimliği değiştirilemez.';
  end if;

  -- auth.uid() null ise çağıran service_role / postgres'tir (sunucu tarafı).
  if auth.uid() is not null and not private.is_admin() then
    if new.role is distinct from old.role
       or new.is_active is distinct from old.is_active
       or new.department_id is distinct from old.department_id
       or new.email is distinct from old.email then
      raise exception 'Bu alanları değiştirme yetkiniz yok.' using errcode = '42501';
    end if;
  end if;

  -- Son aktif yönetici düşürülemez / pasifleştirilemez
  if old.role = 'ADMIN' and old.is_active
     and (new.role <> 'ADMIN' or not new.is_active)
     and not exists (
       select 1 from public.profiles
       where role = 'ADMIN' and is_active and id <> old.id
     ) then
    raise exception 'Sistemdeki son aktif yönetici pasifleştirilemez veya yetkisi alınamaz.';
  end if;

  new.updated_at := now();
  return new;
end;
$$;

create trigger profiles_before_update
  before update on public.profiles
  for each row execute function private.profiles_before_update();

create or replace function private.profiles_after_update()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_changes jsonb := '{}'::jsonb;
begin
  if new.role is distinct from old.role then
    v_changes := v_changes || jsonb_build_object('role', jsonb_build_array(old.role, new.role));
  end if;
  if new.is_active is distinct from old.is_active then
    v_changes := v_changes || jsonb_build_object('is_active', jsonb_build_array(old.is_active, new.is_active));
  end if;
  if new.department_id is distinct from old.department_id then
    v_changes := v_changes || jsonb_build_object('department_id', jsonb_build_array(old.department_id, new.department_id));
  end if;
  if new.email is distinct from old.email then
    v_changes := v_changes || jsonb_build_object('email', jsonb_build_array(old.email, new.email));
  end if;
  if new.first_name is distinct from old.first_name or new.last_name is distinct from old.last_name then
    v_changes := v_changes || jsonb_build_object('name',
      jsonb_build_array(old.first_name || ' ' || old.last_name, new.first_name || ' ' || new.last_name));
  end if;
  if v_changes <> '{}'::jsonb then
    perform private.log_activity('MEMBER_UPDATED', 'profile', new.id::text,
      'Üye güncellendi: ' || btrim(new.first_name || ' ' || new.last_name), v_changes);
  end if;
  return null;
end;
$$;

create trigger profiles_after_update
  after update on public.profiles
  for each row execute function private.profiles_after_update();

-- ----------------------------------------------------------------------------
-- departments denetim tetikleyicisi
-- ----------------------------------------------------------------------------
create or replace function private.departments_audit()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    perform private.log_activity('DEPARTMENT_CREATED', 'department', new.id::text,
      'Departman oluşturuldu: ' || new.name, jsonb_build_object('code', new.code));
    return new;
  elsif tg_op = 'UPDATE' then
    if new.code <> old.code and old.task_seq > 0 then
      raise exception 'Görev üretilmiş bir departmanın kodu değiştirilemez.';
    end if;
    new.updated_at := now();
    if new.name <> old.name or new.lead_id is distinct from old.lead_id
       or new.is_active <> old.is_active or new.description <> old.description
       or new.code <> old.code then
      perform private.log_activity('DEPARTMENT_UPDATED', 'department', new.id::text,
        'Departman güncellendi: ' || new.name,
        jsonb_build_object('lead_id', new.lead_id, 'is_active', new.is_active));
    end if;
    return new;
  else
    perform private.log_activity('DEPARTMENT_DELETED', 'department', old.id::text,
      'Departman silindi: ' || old.name, '{}'::jsonb);
    return old;
  end if;
end;
$$;

create trigger departments_audit
  before insert or update or delete on public.departments
  for each row execute function private.departments_audit();

-- ----------------------------------------------------------------------------
-- tasks tetikleyicileri: kod üretimi, koruma, denetim, bildirim
-- ----------------------------------------------------------------------------
create or replace function private.tasks_before_insert()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_code text; v_seq integer;
begin
  -- Satır kilidi ile atomik sayaç: eşzamanlı eklemelerde bile kod benzersizdir.
  update public.departments
     set task_seq = task_seq + 1
   where id = new.department_id and is_active
  returning code, task_seq into v_code, v_seq;
  if v_code is null then
    raise exception 'Geçersiz veya pasif departman.';
  end if;
  new.code := 'AK-' || v_code || '-' || lpad(v_seq::text, 3, '0');
  new.created_by := coalesce(auth.uid(), new.created_by);
  new.created_at := now();
  new.updated_at := now();
  if new.status = 'COMPLETED' then new.completed_at := now(); end if;
  return new;
end;
$$;

create trigger tasks_before_insert
  before insert on public.tasks
  for each row execute function private.tasks_before_insert();

create or replace function private.tasks_before_update()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.code <> old.code or new.department_id <> old.department_id
     or new.id <> old.id or new.created_at <> old.created_at then
    raise exception 'Görev kodu ve departmanı oluşturulduktan sonra değiştirilemez.';
  end if;
  -- Teslim tarihi ileri alınan gecikmiş görev tekrar aktifleşir
  if old.status = 'OVERDUE' and new.status = 'OVERDUE'
     and new.due_date >= private.today() then
    new.status := 'IN_PROGRESS';
  end if;
  if new.status = 'COMPLETED' and old.status <> 'COMPLETED' then
    new.completed_at := now();
  elsif new.status <> 'COMPLETED' then
    new.completed_at := null;
  end if;
  new.updated_at := now();
  return new;
end;
$$;

create trigger tasks_before_update
  before update on public.tasks
  for each row execute function private.tasks_before_update();

create or replace function private.tasks_after_change()
returns trigger language plpgsql security definer set search_path = '' as $$
declare r record;
begin
  if tg_op = 'INSERT' then
    perform private.log_activity('TASK_CREATED', 'task', new.id::text,
      'Görev oluşturuldu: ' || new.code || ' — ' || new.title,
      jsonb_build_object('code', new.code, 'priority', new.priority, 'due_date', new.due_date));
  elsif tg_op = 'UPDATE' then
    if new.status <> old.status then
      -- Sistem tarafından yapılan (auth.uid() null) durum geçişleri de kaydedilir
      perform private.log_activity('TASK_STATUS_CHANGED', 'task', new.id::text,
        new.code || ' durumu değişti: ' || private.task_status_label(old.status) || ' → ' || private.task_status_label(new.status),
        jsonb_build_object('from', old.status, 'to', new.status));
      if new.status = 'COMPLETED' then
        for r in select user_id from public.task_assignees where task_id = new.id loop
          perform private.notify(r.user_id, 'TASK_COMPLETED', 'Görev tamamlandı',
            new.code || ' — ' || new.title || ' görevi tamamlandı olarak işaretlendi.',
            '/gorevler/' || new.id);
        end loop;
      end if;
    end if;
    if new.title <> old.title or new.description <> old.description
       or new.due_date <> old.due_date or new.start_date <> old.start_date
       or new.priority <> old.priority or new.notes <> old.notes
       or new.required_file_types <> old.required_file_types then
      perform private.log_activity('TASK_UPDATED', 'task', new.id::text,
        'Görev güncellendi: ' || new.code,
        jsonb_build_object('due_date', new.due_date, 'priority', new.priority));
    end if;
  else
    perform private.log_activity('TASK_DELETED', 'task', old.id::text,
      'Görev silindi: ' || old.code || ' — ' || old.title, '{}'::jsonb);
  end if;
  return null;
end;
$$;

create trigger tasks_after_change
  after insert or update or delete on public.tasks
  for each row execute function private.tasks_after_change();

-- Atama yapıldığında bildirim
create or replace function private.task_assignees_after_insert()
returns trigger language plpgsql security definer set search_path = '' as $$
declare t record;
begin
  select code, title, due_date into t from public.tasks where id = new.task_id;
  perform private.notify(new.user_id, 'TASK_ASSIGNED', 'Yeni görev atandı',
    t.code || ' — ' || t.title || ' görevi size atandı. Son teslim: ' || to_char(t.due_date, 'DD.MM.YYYY'),
    '/gorevler/' || new.task_id);
  return null;
end;
$$;

create trigger task_assignees_after_insert
  after insert on public.task_assignees
  for each row execute function private.task_assignees_after_insert();

-- ----------------------------------------------------------------------------
-- Rapor geçmişi koruması: sürümler ve dosya kayıtları silinemez; kimlik
-- alanları değiştirilemez (yalnızca inceleme alanları güncellenir).
-- ----------------------------------------------------------------------------
create or replace function private.protect_report_history()
returns trigger language plpgsql set search_path = '' as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'Rapor geçmişi silinemez (%).', tg_table_name;
  end if;
  if tg_table_name = 'report_files' then
    raise exception 'Rapor dosya kayıtları değiştirilemez.';
  end if;
  if tg_table_name = 'report_versions' then
    if new.report_id <> old.report_id or new.version_number <> old.version_number
       or new.uploaded_by <> old.uploaded_by or new.created_at <> old.created_at
       or new.note <> old.note then
      raise exception 'Rapor sürüm kayıtları değiştirilemez.';
    end if;
  end if;
  return new;
end;
$$;

create trigger report_versions_protect
  before update or delete on public.report_versions
  for each row execute function private.protect_report_history();
create trigger report_files_protect
  before update or delete on public.report_files
  for each row execute function private.protect_report_history();
create trigger reports_protect
  before delete on public.reports
  for each row execute function private.protect_report_history();

-- Denetim kayıtları değiştirilemez / silinemez
create or replace function private.protect_logs()
returns trigger language plpgsql set search_path = '' as $$
begin
  raise exception 'Sistem kayıtları değiştirilemez.';
end;
$$;
create trigger activity_logs_protect
  before update or delete on public.activity_logs
  for each row execute function private.protect_logs();

-- =============================================================================
-- RPC'ler (API üzerinden çağrılır)
-- =============================================================================

-- ----------------------------------------------------------------------------
-- Üye kendi adını/soyadını günceller (rol, departman, durum değiştirilemez)
-- ----------------------------------------------------------------------------
create or replace function public.update_own_profile(p_first_name text, p_last_name text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not private.is_active_user() then
    raise exception 'Yetkisiz işlem.' using errcode = '42501';
  end if;
  if char_length(btrim(coalesce(p_first_name, ''))) < 1 or char_length(btrim(coalesce(p_last_name, ''))) < 1 then
    raise exception 'Ad ve soyad boş olamaz.';
  end if;
  update public.profiles
     set first_name = left(btrim(p_first_name), 60), last_name = left(btrim(p_last_name), 60)
   where id = auth.uid();
end;
$$;

-- ----------------------------------------------------------------------------
-- Görev oluşturma (atomik: görev + atamalar + bildirimler + kayıt)
-- ----------------------------------------------------------------------------
create or replace function public.create_task(
  p_title text, p_description text, p_department_id uuid,
  p_start_date date, p_due_date date, p_priority public.task_priority,
  p_required_file_types text[], p_notes text, p_assignee_ids uuid[]
) returns public.tasks language plpgsql security definer set search_path = '' as $$
declare v_task public.tasks; v_uid uuid; v_ext text;
begin
  if not private.is_admin() then
    raise exception 'Bu işlem için yönetici yetkisi gerekir.' using errcode = '42501';
  end if;
  if p_assignee_ids is null or cardinality(p_assignee_ids) = 0 then
    raise exception 'En az bir sorumlu seçilmelidir.';
  end if;
  foreach v_ext in array coalesce(p_required_file_types, '{}') loop
    if private.canonical_mime(v_ext) is null then
      raise exception 'Desteklenmeyen dosya türü: %', v_ext;
    end if;
  end loop;

  insert into public.tasks (title, description, department_id, start_date, due_date,
                            priority, required_file_types, notes, created_by)
  values (btrim(p_title), coalesce(p_description, ''), p_department_id,
          coalesce(p_start_date, private.today()), p_due_date,
          coalesce(p_priority, 'NORMAL'),
          coalesce((select array_agg(distinct lower(x)) from unnest(p_required_file_types) x), '{}'),
          coalesce(p_notes, ''), auth.uid())
  returning * into v_task;

  for v_uid in select distinct x from unnest(p_assignee_ids) x loop
    if not exists (select 1 from public.profiles where id = v_uid and is_active) then
      raise exception 'Sorumlu olarak seçilen kullanıcı bulunamadı veya pasif.';
    end if;
    insert into public.task_assignees (task_id, user_id, assigned_by)
    values (v_task.id, v_uid, auth.uid());
  end loop;

  return v_task;
end;
$$;

-- ----------------------------------------------------------------------------
-- Görev sorumlularını güncelle (fark alınır; yeni atananlara bildirim gider)
-- Raporu bulunan bir sorumlu görevden çıkarılamaz (geçmiş korunur).
-- ----------------------------------------------------------------------------
create or replace function public.set_task_assignees(p_task_id uuid, p_user_ids uuid[])
returns void language plpgsql security definer set search_path = '' as $$
declare v_uid uuid; v_code text;
begin
  if not private.is_admin() then
    raise exception 'Bu işlem için yönetici yetkisi gerekir.' using errcode = '42501';
  end if;
  select code into v_code from public.tasks where id = p_task_id;
  if v_code is null then raise exception 'Görev bulunamadı.'; end if;
  if p_user_ids is null or cardinality(p_user_ids) = 0 then
    raise exception 'En az bir sorumlu seçilmelidir.';
  end if;

  if exists (
    select 1 from public.task_assignees ta
    join public.reports r on r.task_id = ta.task_id and r.uploaded_by = ta.user_id
    where ta.task_id = p_task_id and not (ta.user_id = any (p_user_ids))
  ) then
    raise exception 'Bu göreve rapor yüklemiş bir sorumlu görevden çıkarılamaz.';
  end if;

  delete from public.task_assignees
   where task_id = p_task_id and not (user_id = any (p_user_ids));

  for v_uid in select distinct x from unnest(p_user_ids) x loop
    if not exists (select 1 from public.profiles where id = v_uid and is_active) then
      raise exception 'Sorumlu olarak seçilen kullanıcı bulunamadı veya pasif.';
    end if;
    insert into public.task_assignees (task_id, user_id, assigned_by)
    values (p_task_id, v_uid, auth.uid())
    on conflict do nothing;
  end loop;

  perform private.log_activity('TASK_ASSIGNEES_CHANGED', 'task', p_task_id::text,
    v_code || ' sorumluları güncellendi', jsonb_build_object('assignees', p_user_ids));
end;
$$;

-- ----------------------------------------------------------------------------
-- Üye görevine başladığını bildirir (NEW -> IN_PROGRESS)
-- ----------------------------------------------------------------------------
create or replace function public.start_task(p_task_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not private.is_task_assignee(p_task_id) then
    raise exception 'Bu görev size atanmamış.' using errcode = '42501';
  end if;
  update public.tasks set status = 'IN_PROGRESS'
   where id = p_task_id and status = 'NEW';
end;
$$;

-- ----------------------------------------------------------------------------
-- Rapor gönderimi. Dosyalar önce Storage'a yüklenir; bu fonksiyon dosyaların
-- gerçekten Storage'da olduğunu, yolun çağıran kullanıcıya ait olduğunu,
-- uzantı/MIME/boyut kurallarını SUNUCU tarafında doğrular ve yeni sürümü
-- atomik olarak kaydeder. Boyut ve MIME istemciden değil storage.objects
-- kaydından okunur.
-- p_files: [{ "path": "...", "name": "...", "sha256": "..." }, ...]
-- ----------------------------------------------------------------------------
create or replace function public.submit_report(
  p_task_id uuid, p_title text, p_description text, p_note text, p_files jsonb
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_task public.tasks;
  v_report public.reports;
  v_version_id uuid;
  v_version integer;
  v_file jsonb;
  v_path text; v_name text; v_ext text; v_sha text;
  v_obj record;
  v_size bigint; v_mime text;
  v_max bigint := private.max_file_size_bytes();
  v_prefix text;
  v_actor_name text;
begin
  if v_uid is null or not private.is_active_user() then
    raise exception 'Oturum geçersiz veya hesap pasif.' using errcode = '42501';
  end if;
  if not private.is_task_assignee(p_task_id) then
    raise exception 'Bu göreve rapor yükleme yetkiniz yok.' using errcode = '42501';
  end if;

  select * into v_task from public.tasks where id = p_task_id for update;
  if v_task.id is null then raise exception 'Görev bulunamadı.'; end if;
  if v_task.status = 'COMPLETED' then
    raise exception 'Tamamlanmış bir göreve rapor yüklenemez.';
  end if;

  if p_files is null or jsonb_typeof(p_files) <> 'array' or jsonb_array_length(p_files) = 0 then
    raise exception 'En az bir dosya yüklenmelidir.';
  end if;
  if jsonb_array_length(p_files) > 10 then
    raise exception 'Tek seferde en fazla 10 dosya yüklenebilir.';
  end if;

  select * into v_report from public.reports
   where task_id = p_task_id and uploaded_by = v_uid for update;

  if v_report.id is null then
    insert into public.reports (task_id, uploaded_by, title, description, status, current_version)
    values (p_task_id, v_uid, btrim(p_title), coalesce(p_description, ''), 'PENDING', 1)
    returning * into v_report;
    v_version := 1;
  else
    if v_report.status in ('IN_REVIEW', 'APPROVED') then
      raise exception 'Bu rapor şu anda % durumunda; yeni sürüm yüklenemez.',
        case v_report.status when 'IN_REVIEW' then 'inceleniyor' else 'onaylandı' end;
    end if;
    v_version := v_report.current_version + 1;
    update public.reports
       set title = btrim(p_title), description = coalesce(p_description, ''),
           status = 'PENDING', current_version = v_version,
           review_note = null, reviewed_by = null, reviewed_at = null,
           updated_at = now()
     where id = v_report.id
    returning * into v_report;
  end if;

  insert into public.report_versions (report_id, version_number, note, uploaded_by)
  values (v_report.id, v_version, left(coalesce(p_note, ''), 2000), v_uid)
  returning id into v_version_id;

  v_prefix := p_task_id::text || '/' || v_uid::text || '/';

  for v_file in select * from jsonb_array_elements(p_files) loop
    v_path := v_file ->> 'path';
    v_name := left(coalesce(v_file ->> 'name', ''), 255);
    v_sha  := lower(coalesce(v_file ->> 'sha256', ''));

    if v_path is null or left(v_path, char_length(v_prefix)) <> v_prefix or v_path like '%..%' then
      raise exception 'Geçersiz dosya yolu.' using errcode = '42501';
    end if;

    select o.name, o.metadata into v_obj
      from storage.objects o
     where o.bucket_id = 'reports' and o.name = v_path;
    if v_obj.name is null then
      raise exception 'Dosya depolama alanında bulunamadı: %. Yükleme tamamlanmamış olabilir.', v_name;
    end if;

    v_ext  := lower(substring(v_path from '\.([A-Za-z0-9]+)$'));
    v_size := (v_obj.metadata ->> 'size')::bigint;
    v_mime := lower(split_part(coalesce(v_obj.metadata ->> 'mimetype', ''), ';', 1));

    if v_ext is null or private.canonical_mime(v_ext) is null then
      raise exception 'İzin verilmeyen dosya türü: %', v_name;
    end if;
    if v_mime <> private.canonical_mime(v_ext) then
      raise exception 'Dosya türü ile uzantısı uyuşmuyor: %', v_name;
    end if;
    if v_size is null or v_size <= 0 then
      raise exception 'Boş dosya yüklenemez: %', v_name;
    end if;
    if v_size > v_max then
      raise exception 'Dosya boyutu sınırı aşıldı (% MB): %', v_max / 1048576, v_name;
    end if;
    if v_sha !~ '^[0-9a-f]{64}$' then
      raise exception 'Dosya özeti geçersiz: %', v_name;
    end if;
    if exists (select 1 from public.report_files where report_id = v_report.id and sha256 = v_sha) then
      raise exception 'Bu dosya bu rapora daha önce yüklenmiş: %', v_name using errcode = '23505';
    end if;

    insert into public.report_files (version_id, report_id, storage_path, original_name,
                                     extension, mime_type, size_bytes, sha256)
    values (v_version_id, v_report.id, v_path, v_name, v_ext, v_mime, v_size, v_sha);
  end loop;

  update public.tasks set status = 'IN_REVIEW' where id = p_task_id and status <> 'IN_REVIEW';

  select btrim(first_name || ' ' || last_name) into v_actor_name from public.profiles where id = v_uid;

  perform private.notify(v_uid, 'REPORT_UPLOADED', 'Rapor başarıyla yüklendi',
    v_task.code || ' görevi için "' || v_report.title || '" raporunun V' || v_version || ' sürümü sisteme yüklendi.',
    '/raporlar/' || v_report.id);
  perform private.notify_admins('REPORT_SUBMITTED', 'Yeni rapor inceleme bekliyor',
    v_actor_name || ', ' || v_task.code || ' görevi için V' || v_version || ' raporunu yükledi.',
    '/yonetim/rapor-inceleme/' || v_report.id, null, v_uid);
  perform private.log_activity('REPORT_SUBMITTED', 'report', v_report.id::text,
    v_task.code || ' için rapor yüklendi (V' || v_version || ')',
    jsonb_build_object('task_code', v_task.code, 'version', v_version,
                       'file_count', jsonb_array_length(p_files)));

  return jsonb_build_object('report_id', v_report.id, 'version_id', v_version_id, 'version_number', v_version);
end;
$$;

-- ----------------------------------------------------------------------------
-- Rapor inceleme (yalnızca yönetici)
-- p_action: 'START' | 'APPROVE' | 'REQUEST_REVISION' | 'REJECT'
-- ----------------------------------------------------------------------------
create or replace function public.review_report(p_report_id uuid, p_action text, p_note text default null)
returns public.reports language plpgsql security definer set search_path = '' as $$
declare
  v_report public.reports;
  v_task public.tasks;
  v_new public.report_status;
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
  v_type public.notification_type;
  v_title text; v_body text;
begin
  if not private.is_admin() then
    raise exception 'Bu işlem için yönetici yetkisi gerekir.' using errcode = '42501';
  end if;

  select * into v_report from public.reports where id = p_report_id for update;
  if v_report.id is null then raise exception 'Rapor bulunamadı.'; end if;
  select * into v_task from public.tasks where id = v_report.task_id for update;

  if v_report.status not in ('PENDING', 'IN_REVIEW') then
    raise exception 'Bu rapor için inceleme kararı zaten verilmiş. Üyenin yeni sürüm yüklemesi bekleniyor veya rapor onaylı.';
  end if;

  case p_action
    when 'START' then
      if v_report.status <> 'PENDING' then raise exception 'Rapor zaten incelemede.'; end if;
      v_new := 'IN_REVIEW'; v_type := 'REPORT_IN_REVIEW';
      v_title := 'Raporunuz incelemeye alındı';
      v_body := v_task.code || ' — "' || v_report.title || '" raporunuz yönetici tarafından inceleniyor.';
    when 'APPROVE' then
      v_new := 'APPROVED'; v_type := 'REPORT_APPROVED';
      v_title := 'Raporunuz onaylandı';
      v_body := v_task.code || ' — "' || v_report.title || '" (V' || v_report.current_version || ') onaylandı.'
                || coalesce(' Not: ' || v_note, '');
    when 'REQUEST_REVISION' then
      if v_note is null then raise exception 'Revizyon gerekçesi yazılması zorunludur.'; end if;
      v_new := 'REVISION_REQUESTED'; v_type := 'REPORT_REVISION_REQUESTED';
      v_title := 'Raporunuz için revizyon istendi';
      v_body := v_task.code || ' — "' || v_report.title || '" için revizyon istendi. Gerekçe: ' || v_note;
    when 'REJECT' then
      if v_note is null then raise exception 'Ret gerekçesi yazılması zorunludur.'; end if;
      v_new := 'REJECTED'; v_type := 'REPORT_REJECTED';
      v_title := 'Raporunuz reddedildi';
      v_body := v_task.code || ' — "' || v_report.title || '" reddedildi. Gerekçe: ' || v_note;
    else
      raise exception 'Geçersiz inceleme işlemi: %', p_action;
  end case;

  update public.reports
     set status = v_new,
         review_note = case when p_action = 'START' then review_note else v_note end,
         reviewed_by = auth.uid(), reviewed_at = now(), updated_at = now()
   where id = p_report_id
  returning * into v_report;

  update public.report_versions
     set status = v_new,
         review_note = case when p_action = 'START' then review_note else v_note end,
         reviewed_by = auth.uid(), reviewed_at = now()
   where report_id = p_report_id and version_number = v_report.current_version;

  -- Görev durumunu rapor kararına göre ilerlet
  if v_task.status <> 'COMPLETED' then
    if v_new = 'REVISION_REQUESTED' then
      update public.tasks set status = 'REVISION_REQUESTED' where id = v_task.id;
    elsif v_new = 'REJECTED' then
      update public.tasks set status = 'AWAITING_REPORT' where id = v_task.id;
    elsif v_new = 'APPROVED' then
      -- Görevin tüm sorumlularının raporu onaylıysa görev "Onaylandı" olur
      if not exists (
        select 1 from public.task_assignees ta
        left join public.reports r on r.task_id = ta.task_id and r.uploaded_by = ta.user_id
        where ta.task_id = v_task.id and (r.id is null or r.status <> 'APPROVED')
      ) then
        update public.tasks set status = 'APPROVED' where id = v_task.id;
      end if;
    end if;
  end if;

  perform private.notify(v_report.uploaded_by, v_type, v_title, v_body, '/raporlar/' || v_report.id);
  perform private.log_activity('REPORT_' || p_action, 'report', v_report.id::text,
    v_task.code || ' raporu: ' || case p_action
      when 'START' then 'incelemeye alındı' when 'APPROVE' then 'onaylandı'
      when 'REQUEST_REVISION' then 'revizyon istendi' else 'reddedildi' end
      || ' (V' || v_report.current_version || ')',
    jsonb_build_object('task_code', v_task.code, 'version', v_report.current_version, 'note', v_note));

  return v_report;
end;
$$;

-- ----------------------------------------------------------------------------
-- Teslim tarihi kontrolleri: yaklaşan/geciken görev bildirimleri ve OVERDUE
-- geçişi. Idempotenttir (dedupe_key). pg_cron ile günlük çalıştırılması
-- önerilir; uygulama da oturum açılışında çağırır.
-- ----------------------------------------------------------------------------
create or replace function public.process_deadlines()
returns integer language plpgsql security definer set search_path = '' as $$
declare r record; a record; v_today date := private.today(); v_count integer := 0;
begin
  -- auth.uid() null: pg_cron / SQL editörü. Aksi halde aktif kullanıcı şartı.
  if auth.uid() is not null and not private.is_active_user() then
    raise exception 'Yetkisiz işlem.' using errcode = '42501';
  end if;

  for r in
    select id, code, title, due_date from public.tasks
     where status in ('NEW', 'IN_PROGRESS', 'AWAITING_REPORT', 'REVISION_REQUESTED')
       and due_date >= v_today and due_date <= v_today + 3
  loop
    for a in select user_id from public.task_assignees where task_id = r.id loop
      perform private.notify(a.user_id, 'TASK_DUE_SOON', 'Teslim tarihi yaklaşıyor',
        r.code || ' — ' || r.title || ' görevinin son teslim tarihi: ' || to_char(r.due_date, 'DD.MM.YYYY'),
        '/gorevler/' || r.id, 'due_soon:' || r.id || ':' || r.due_date);
    end loop;
  end loop;

  for r in
    select id, code, title, due_date from public.tasks
     where status in ('NEW', 'IN_PROGRESS', 'AWAITING_REPORT', 'REVISION_REQUESTED')
       and due_date < v_today
     for update skip locked
  loop
    update public.tasks set status = 'OVERDUE' where id = r.id;
    v_count := v_count + 1;
    for a in select user_id from public.task_assignees where task_id = r.id loop
      perform private.notify(a.user_id, 'TASK_OVERDUE', 'Görev gecikti',
        r.code || ' — ' || r.title || ' görevinin teslim tarihi (' || to_char(r.due_date, 'DD.MM.YYYY') || ') geçti.',
        '/gorevler/' || r.id, 'overdue:' || r.id || ':' || r.due_date);
    end loop;
    perform private.notify_admins('TASK_OVERDUE', 'Görev gecikti',
      r.code || ' — ' || r.title || ' görevi teslim tarihini aştı.',
      '/gorevler/' || r.id, 'overdue:' || r.id || ':' || r.due_date);
  end loop;

  return v_count;
end;
$$;

-- ----------------------------------------------------------------------------
-- Dosya boyutu sınırı (yönetici). Hem ayar tablosunu hem de Storage bucket
-- sınırını günceller; böylece sınır depolama katmanında da zorlanır.
-- ----------------------------------------------------------------------------
create or replace function public.set_max_file_size_mb(p_mb integer)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not private.is_admin() then
    raise exception 'Bu işlem için yönetici yetkisi gerekir.' using errcode = '42501';
  end if;
  if p_mb is null or p_mb < 1 or p_mb > 500 then
    raise exception 'Dosya sınırı 1–500 MB aralığında olmalıdır.';
  end if;
  insert into public.app_settings (key, value, updated_by, updated_at)
  values ('max_file_size_mb', to_jsonb(p_mb), auth.uid(), now())
  on conflict (key) do update
    set value = excluded.value, updated_by = excluded.updated_by, updated_at = now();
  update storage.buckets set file_size_limit = p_mb::bigint * 1024 * 1024 where id = 'reports';
  perform private.log_activity('SETTING_CHANGED', 'setting', 'max_file_size_mb',
    'Dosya boyutu sınırı ' || p_mb || ' MB olarak ayarlandı', jsonb_build_object('value', p_mb));
end;
$$;

-- ----------------------------------------------------------------------------
-- Departman istatistikleri: yönetici tüm departmanları, üye yalnızca kendi
-- departmanının sayılarını görür.
-- ----------------------------------------------------------------------------
create or replace function public.department_stats()
returns table (
  department_id uuid, member_count bigint, total_tasks bigint, completed_tasks bigint,
  submitted_reports bigint, pending_reports bigint
) language sql stable security definer set search_path = '' as $$
  select d.id,
    (select count(*) from public.profiles p where p.department_id = d.id and p.is_active),
    (select count(*) from public.tasks t where t.department_id = d.id),
    (select count(*) from public.tasks t where t.department_id = d.id and t.status = 'COMPLETED'),
    (select count(*) from public.reports r join public.tasks t on t.id = r.task_id where t.department_id = d.id),
    (select count(*) from public.reports r join public.tasks t on t.id = r.task_id
      where t.department_id = d.id and r.status in ('PENDING', 'IN_REVIEW'))
  from public.departments d
  where private.is_admin()
     or (private.is_active_user() and d.id = private.my_department_id());
$$;

-- ----------------------------------------------------------------------------
-- Yönetici kontrol paneli verisi (tek çağrı, tamamı gerçek veriden)
-- ----------------------------------------------------------------------------
create or replace function public.dashboard_stats()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v jsonb;
begin
  if not private.is_admin() then
    raise exception 'Bu işlem için yönetici yetkisi gerekir.' using errcode = '42501';
  end if;

  select jsonb_build_object(
    'total_members',      (select count(*) from public.profiles where is_active),
    'active_departments', (select count(*) from public.departments where is_active),
    'total_tasks',        (select count(*) from public.tasks),
    'completed_tasks',    (select count(*) from public.tasks where status = 'COMPLETED'),
    'pending_reports',    (select count(*) from public.reports where status in ('PENDING', 'IN_REVIEW')),
    'approved_reports',   (select count(*) from public.reports where status = 'APPROVED'),
    'revision_reports',   (select count(*) from public.reports where status = 'REVISION_REQUESTED'),
    'overdue_tasks',      (select count(*) from public.tasks where status = 'OVERDUE'),
    'tasks_by_department', coalesce((
      select jsonb_agg(x order by x ->> 'name') from (
        select jsonb_build_object(
          'name', d.name,
          'total', count(t.id),
          'completed', count(t.id) filter (where t.status = 'COMPLETED'),
          'approved', count(t.id) filter (where t.status = 'APPROVED'),
          'overdue', count(t.id) filter (where t.status = 'OVERDUE')
        ) as x
        from public.departments d left join public.tasks t on t.department_id = d.id
        where d.is_active group by d.id, d.name
      ) s), '[]'::jsonb),
    'monthly_uploads', coalesce((
      select jsonb_agg(jsonb_build_object('month', to_char(m.month, 'YYYY-MM'), 'count', coalesce(c.cnt, 0)) order by m.month)
      from generate_series(
             date_trunc('month', now() at time zone 'Europe/Istanbul') - interval '11 months',
             date_trunc('month', now() at time zone 'Europe/Istanbul'),
             interval '1 month') as m(month)
      left join (
        select date_trunc('month', created_at at time zone 'Europe/Istanbul') as month, count(*) as cnt
        from public.report_versions group by 1
      ) c on c.month = m.month), '[]'::jsonb),
    'task_status', coalesce((
      select jsonb_agg(jsonb_build_object('status', s.status, 'count', s.cnt))
      from (select status, count(*) as cnt from public.tasks group by status) s), '[]'::jsonb),
    'report_status', coalesce((
      select jsonb_agg(jsonb_build_object('status', s.status, 'count', s.cnt))
      from (select status, count(*) as cnt from public.reports group by status) s), '[]'::jsonb),
    'recent_reports', coalesce((
      select jsonb_agg(x) from (
        select jsonb_build_object(
          'report_id', r.id, 'title', r.title, 'status', rv.status,
          'version', rv.version_number, 'task_code', t.code,
          'uploader', btrim(p.first_name || ' ' || p.last_name), 'created_at', rv.created_at) as x
        from public.report_versions rv
        join public.reports r on r.id = rv.report_id
        join public.tasks t on t.id = r.task_id
        join public.profiles p on p.id = rv.uploaded_by
        order by rv.created_at desc limit 6
      ) s), '[]'::jsonb),
    'recent_activity', coalesce((
      select jsonb_agg(x) from (
        select jsonb_build_object(
          'id', l.id, 'action', l.action, 'summary', l.summary, 'created_at', l.created_at,
          'actor', coalesce(btrim(p.first_name || ' ' || p.last_name), 'Sistem')) as x
        from public.activity_logs l left join public.profiles p on p.id = l.actor_id
        order by l.created_at desc limit 8
      ) s), '[]'::jsonb)
  ) into v;
  return v;
end;
$$;

-- ----------------------------------------------------------------------------
-- Ekip dizini: aktif kullanıcılar ekip arkadaşlarının yalnızca adını ve
-- departmanını görebilir (e-posta ve rol açığa çıkmaz).
-- ----------------------------------------------------------------------------
create or replace view public.directory as
  select p.id, p.first_name, p.last_name, p.department_id, p.is_active
  from public.profiles p
  where private.is_active_user();

-- ----------------------------------------------------------------------------
-- Rapor arşivi görünümü. security_invoker: alttaki tabloların RLS kuralları
-- sorguyu çalıştıran kullanıcı için aynen uygulanır.
-- ----------------------------------------------------------------------------
create or replace view public.report_overview
with (security_invoker = true) as
  select
    r.id, r.title, r.description, r.status, r.current_version,
    r.review_note, r.reviewed_at, r.created_at, r.updated_at,
    r.task_id, t.code as task_code, t.title as task_title,
    t.department_id, d.name as department_name,
    r.uploaded_by,
    btrim(dir.first_name || ' ' || dir.last_name) as uploader_name,
    coalesce(f.extensions, '{}') as file_extensions,
    coalesce(f.file_count, 0) as file_count,
    coalesce(f.total_bytes, 0) as total_bytes
  from public.reports r
  join public.tasks t on t.id = r.task_id
  join public.departments d on d.id = t.department_id
  left join public.directory dir on dir.id = r.uploaded_by
  left join lateral (
    select array_agg(distinct rf.extension) as extensions,
           count(*) as file_count, sum(rf.size_bytes) as total_bytes
    from public.report_versions rv
    join public.report_files rf on rf.version_id = rv.id
    where rv.report_id = r.id and rv.version_number = r.current_version
  ) f on true;
