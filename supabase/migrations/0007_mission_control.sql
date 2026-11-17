-- =============================================================================
-- AKANA MISSION CONTROL — 0007: Projeler, gelişmiş görevler, departman
-- sorumluluğu, doküman merkezi, takvim, risk yönetimi, bildirim tercihleri,
-- analitik, global arama.
--
-- İlkeler (0001–0005 ile aynı):
--  * Mevcut tablolar yalnızca GENİŞLETİLİR; hiçbir satır silinmez.
--  * Yazmaların çoğu SECURITY DEFINER RPC'lerle yapılır; kimlik auth.uid().
--  * Yetki RLS + RPC içi kontrol ile sunucuda zorlanır.
--  * Yetki modeli: ADMIN (kaptan/kaptan yardımcısı) her şeyi yönetir.
--    departments.lead_id olan kullanıcı (departman sorumlusu) YALNIZCA kendi
--    departmanının görevlerini, raporlarını, dokümanlarını yönetir.
-- =============================================================================

-- ----------------------------------------------------------------------------
-- 1. Yetki yardımcıları
-- ----------------------------------------------------------------------------
create or replace function private.try_uuid(p text)
returns uuid language plpgsql immutable set search_path = '' as $$
begin
  return p::uuid;
exception when others then
  return null;
end;
$$;

create or replace function private.is_dept_lead(p_dept uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select p_dept is not null and private.is_active_user() and exists (
    select 1 from public.departments d where d.id = p_dept and d.lead_id = auth.uid()
  );
$$;

create or replace function private.is_any_lead()
returns boolean language sql stable security definer set search_path = '' as $$
  select private.is_active_user() and exists (
    select 1 from public.departments d where d.lead_id = auth.uid()
  );
$$;

create or replace function private.is_manager()
returns boolean language sql stable security definer set search_path = '' as $$
  select private.is_admin() or private.is_any_lead();
$$;

create or replace function private.can_manage_department(p_dept uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select private.is_admin() or private.is_dept_lead(p_dept);
$$;

create or replace function private.can_manage_task(p_task_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select private.is_admin() or exists (
    select 1 from public.tasks t where t.id = p_task_id and private.is_dept_lead(t.department_id)
  );
$$;

-- Görev görünürlüğü: departman sorumlusu kendi departmanının görevlerini görür
create or replace function private.can_view_task(p_task_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select private.is_admin() or (
    private.is_active_user() and exists (
      select 1 from public.tasks t
      where t.id = p_task_id
        and (t.department_id = private.my_department_id()
             or private.is_task_assignee(t.id)
             or private.is_dept_lead(t.department_id))
    )
  );
$$;

create or replace function private.can_view_report(p_report_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select private.is_admin() or (
    private.is_active_user() and exists (
      select 1 from public.reports r
      where r.id = p_report_id
        and (r.uploaded_by = auth.uid() or private.can_manage_task(r.task_id))
    )
  );
$$;

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
    when 'BLOCKED' then 'Bloke'
    when 'CANCELLED' then 'İptal edildi'
  end;
$$;

-- STL ve STEP (CAD) desteği. İstemci yüklerken bu kanonik MIME'ı gönderir.
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
    when 'stl'  then 'model/stl'
    when 'step' then 'model/step'
    when 'stp'  then 'model/step'
    else null
  end;
$$;

update storage.buckets
   set allowed_mime_types = array(select distinct unnest(allowed_mime_types || array['model/stl', 'model/step']))
 where id = 'reports';

-- ----------------------------------------------------------------------------
-- 2. Bildirim tercihleri (private.notify bunlara uyar)
-- ----------------------------------------------------------------------------
create table if not exists public.notification_preferences (
  user_id uuid not null references public.profiles (id) on delete cascade,
  type    public.notification_type not null,
  enabled boolean not null,
  updated_at timestamptz not null default now(),
  primary key (user_id, type)
);

create or replace function private.notify(
  p_user_id uuid, p_type public.notification_type, p_title text,
  p_body text default '', p_link text default null, p_dedupe_key text default null
) returns void language plpgsql security definer set search_path = '' as $$
begin
  if p_user_id is null then return; end if;
  if exists (
    select 1 from public.notification_preferences np
    where np.user_id = p_user_id and np.type = p_type and not np.enabled
  ) then
    return;
  end if;
  insert into public.notifications (user_id, type, title, body, link, dedupe_key)
  values (p_user_id, p_type, p_title, coalesce(p_body, ''), p_link, p_dedupe_key)
  on conflict (user_id, dedupe_key) do nothing;
end;
$$;

-- Departman sorumlusuna bildirim (yönetici ise zaten notify_admins ile alır)
create or replace function private.notify_dept_lead(
  p_dept uuid, p_type public.notification_type, p_title text, p_body text,
  p_link text, p_except uuid default null
) returns void language plpgsql security definer set search_path = '' as $$
declare v_lead uuid;
begin
  select d.lead_id into v_lead from public.departments d where d.id = p_dept;
  if v_lead is null or v_lead = p_except then return; end if;
  if exists (select 1 from public.profiles p where p.id = v_lead and p.role = 'ADMIN') then return; end if;
  perform private.notify(v_lead, p_type, p_title, p_body, p_link);
end;
$$;

-- ----------------------------------------------------------------------------
-- 3. Departmanlar: AKANA yapısına göre eksik departmanlar
-- ----------------------------------------------------------------------------
insert into public.departments (name, code, description) values
  ('Elektronik',     'ELK', 'Güç dağıtımı, PCB tasarımı, kablaj ve elektronik entegrasyon'),
  ('Gömülü Yazılım', 'GYZ', 'Uçuş yazılımı, sensör sürücüleri, telemetri protokolleri ve testler')
on conflict do nothing;

update public.departments set name = 'Sponsorluk ve Organizasyon'
 where name = 'Sponsorluk'
   and not exists (select 1 from public.departments where lower(name) = lower('Sponsorluk ve Organizasyon'));

-- ----------------------------------------------------------------------------
-- 4. Profil alanları (üniversite, bölüm, unvan, yetkinlik, fotoğraf, pozisyon)
-- ----------------------------------------------------------------------------
alter table public.profiles
  add column if not exists university    text not null default '',
  add column if not exists major         text not null default '',
  add column if not exists title         text not null default '',
  add column if not exists skills        text[] not null default '{}',
  add column if not exists avatar_path   text,
  add column if not exists team_position public.team_position not null default 'MEMBER';

do $$ begin
  alter table public.profiles add constraint profiles_university_len check (char_length(university) <= 120);
exception when duplicate_object then null; end $$;
do $$ begin
  alter table public.profiles add constraint profiles_major_len check (char_length(major) <= 120);
exception when duplicate_object then null; end $$;
do $$ begin
  alter table public.profiles add constraint profiles_title_len check (char_length(title) <= 80);
exception when duplicate_object then null; end $$;
do $$ begin
  alter table public.profiles add constraint profiles_skills_len check (cardinality(skills) <= 30);
exception when duplicate_object then null; end $$;

-- Mevcut yöneticiler organizasyon şemasında görünsün diye kaptan yardımcısı
-- olarak işaretlenmez; pozisyonu yönetici Üye Yönetimi'nden atar. Sorumlular:
update public.profiles p set team_position = 'LEAD'
 where p.team_position = 'MEMBER'
   and exists (select 1 from public.departments d where d.lead_id = p.id);

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
       or new.email is distinct from old.email
       or new.team_position is distinct from old.team_position
       or new.title is distinct from old.title then
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

-- Yetki ve pozisyon değişiklikleri ayrıca kaydedilir (denetim: "yetki değiştirme")
create or replace function private.profiles_after_update_ex()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_name text := btrim(new.first_name || ' ' || new.last_name);
begin
  if new.role is distinct from old.role then
    perform private.log_activity('ROLE_CHANGED', 'profile', new.id::text,
      'Yetki değişti: ' || v_name || ' (' || old.role || ' → ' || new.role || ')',
      jsonb_build_object('from', old.role, 'to', new.role));
  end if;
  if new.team_position is distinct from old.team_position or new.title is distinct from old.title then
    perform private.log_activity('POSITION_CHANGED', 'profile', new.id::text,
      'Takım pozisyonu güncellendi: ' || v_name,
      jsonb_build_object('position', jsonb_build_array(old.team_position, new.team_position),
                         'title', jsonb_build_array(old.title, new.title)));
  end if;
  return null;
end;
$$;

drop trigger if exists profiles_after_update_ex on public.profiles;
create trigger profiles_after_update_ex
  after update on public.profiles
  for each row execute function private.profiles_after_update_ex();

-- Departman sorumlusu değişince pozisyonu güncelle ve kaydet
create or replace function private.departments_lead_changed()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.lead_id is not distinct from old.lead_id then return null; end if;
  if new.lead_id is not null then
    update public.profiles set team_position = 'LEAD'
     where id = new.lead_id and team_position = 'MEMBER';
  end if;
  if old.lead_id is not null and not exists (
       select 1 from public.departments where lead_id = old.lead_id and id <> new.id) then
    update public.profiles set team_position = 'MEMBER'
     where id = old.lead_id and team_position = 'LEAD';
  end if;
  perform private.log_activity('DEPARTMENT_LEAD_CHANGED', 'department', new.id::text,
    new.name || ' departman sorumlusu değişti',
    jsonb_build_object('from', old.lead_id, 'to', new.lead_id));
  return null;
end;
$$;

drop trigger if exists departments_lead_changed on public.departments;
create trigger departments_lead_changed
  after update of lead_id on public.departments
  for each row execute function private.departments_lead_changed();

-- Üyenin kendi düzenleyebildiği profil alanları
create or replace function public.update_own_profile_details(
  p_university text, p_major text, p_skills text[], p_avatar_path text default null
) returns void language plpgsql security definer set search_path = '' as $$
declare v_skills text[];
begin
  if not private.is_active_user() then
    raise exception 'Yetkisiz işlem.' using errcode = '42501';
  end if;
  if char_length(coalesce(p_university, '')) > 120 or char_length(coalesce(p_major, '')) > 120 then
    raise exception 'Üniversite ve bölüm en fazla 120 karakter olabilir.';
  end if;
  select coalesce(array_agg(distinct left(btrim(s), 40)) filter (where btrim(s) <> ''), '{}')
    into v_skills from unnest(coalesce(p_skills, '{}')) s;
  if cardinality(v_skills) > 30 then
    raise exception 'En fazla 30 yetkinlik eklenebilir.';
  end if;
  if p_avatar_path is not null then
    if left(p_avatar_path, char_length(auth.uid()::text) + 1) <> auth.uid()::text || '/'
       or p_avatar_path like '%..%'
       or not exists (select 1 from storage.objects o where o.bucket_id = 'avatars' and o.name = p_avatar_path) then
      raise exception 'Geçersiz profil fotoğrafı.' using errcode = '42501';
    end if;
  end if;
  update public.profiles
     set university = btrim(coalesce(p_university, '')),
         major = btrim(coalesce(p_major, '')),
         skills = v_skills,
         avatar_path = p_avatar_path
   where id = auth.uid();
end;
$$;

-- Ekip dizini: herkese açık profil alanları (e-posta ve rol açığa çıkmaz)
create or replace view public.directory as
  select p.id, p.first_name, p.last_name, p.department_id, p.is_active,
         p.avatar_path, p.university, p.major, p.title, p.skills, p.team_position
  from public.profiles p
  where private.is_active_user();

-- Profil fotoğrafları: özel bucket; okuma tüm aktif üyelere, yazma yalnızca kendi klasörüne
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('avatars', 'avatars', false, 2 * 1024 * 1024, array['image/png', 'image/jpeg', 'image/webp'])
on conflict (id) do update set public = false, allowed_mime_types = excluded.allowed_mime_types,
  file_size_limit = excluded.file_size_limit;

drop policy if exists avatars_insert on storage.objects;
drop policy if exists avatars_select on storage.objects;
drop policy if exists avatars_delete on storage.objects;
create policy avatars_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'avatars' and private.is_active_user()
              and split_part(name, '/', 1) = auth.uid()::text
              and array_length(string_to_array(name, '/'), 1) = 2);
create policy avatars_select on storage.objects for select to authenticated
  using (bucket_id = 'avatars' and private.is_active_user());
create policy avatars_delete on storage.objects for delete to authenticated
  using (bucket_id = 'avatars' and split_part(name, '/', 1) = auth.uid()::text);

-- ----------------------------------------------------------------------------
-- 5. Projeler
-- ----------------------------------------------------------------------------
create sequence if not exists public.project_code_seq;

create table if not exists public.projects (
  id            uuid primary key default gen_random_uuid(),
  code          text not null,
  name          text not null,
  description   text not null default '',
  owner_id      uuid references public.profiles (id) on delete set null,
  department_id uuid references public.departments (id) on delete set null,
  start_date    date not null default current_date,
  target_date   date not null,
  status        public.project_status not null default 'ACTIVE',
  created_by    uuid references public.profiles (id) on delete set null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  constraint projects_code_key unique (code),
  constraint projects_name_len check (char_length(btrim(name)) between 3 and 120),
  constraint projects_description_len check (char_length(description) <= 5000),
  constraint projects_dates_chk check (target_date >= start_date)
);
create index if not exists projects_status_idx on public.projects (status);

create or replace function private.projects_before_write()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    new.code := 'PRJ-' || lpad(nextval('public.project_code_seq')::text, 3, '0');
    new.created_by := coalesce(auth.uid(), new.created_by);
    new.created_at := now();
  else
    if new.code <> old.code or new.id <> old.id or new.created_at <> old.created_at then
      raise exception 'Proje kodu değiştirilemez.';
    end if;
  end if;
  new.name := btrim(new.name);
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists projects_before_write on public.projects;
create trigger projects_before_write
  before insert or update on public.projects
  for each row execute function private.projects_before_write();

create or replace function private.projects_audit()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    perform private.log_activity('PROJECT_CREATED', 'project', new.id::text,
      'Proje oluşturuldu: ' || new.code || ' — ' || new.name,
      jsonb_build_object('target_date', new.target_date));
  elsif tg_op = 'UPDATE' then
    perform private.log_activity('PROJECT_UPDATED', 'project', new.id::text,
      'Proje güncellendi: ' || new.code || ' — ' || new.name,
      jsonb_build_object('status', new.status, 'target_date', new.target_date));
  else
    perform private.log_activity('PROJECT_DELETED', 'project', old.id::text,
      'Proje silindi: ' || old.code || ' — ' || old.name, '{}'::jsonb);
  end if;
  return null;
end;
$$;

drop trigger if exists projects_audit on public.projects;
create trigger projects_audit
  after insert or update or delete on public.projects
  for each row execute function private.projects_audit();

-- ----------------------------------------------------------------------------
-- 6. Görev genişletmeleri: proje, alt görev, ilerleme, zorluk, bloke nedeni
-- ----------------------------------------------------------------------------
alter table public.tasks
  add column if not exists project_id     uuid references public.projects (id) on delete set null,
  add column if not exists parent_id      uuid references public.tasks (id) on delete set null,
  add column if not exists progress       smallint not null default 0,
  add column if not exists difficulty     smallint not null default 3,
  add column if not exists blocked_reason text not null default '';

do $$ begin
  alter table public.tasks add constraint tasks_progress_chk check (progress between 0 and 100);
exception when duplicate_object then null; end $$;
do $$ begin
  alter table public.tasks add constraint tasks_difficulty_chk check (difficulty between 1 and 5);
exception when duplicate_object then null; end $$;
do $$ begin
  alter table public.tasks add constraint tasks_blocked_reason_len check (char_length(blocked_reason) <= 1000);
exception when duplicate_object then null; end $$;
do $$ begin
  alter table public.tasks add constraint tasks_parent_self_chk check (parent_id is null or parent_id <> id);
exception when duplicate_object then null; end $$;

create index if not exists tasks_project_idx on public.tasks (project_id);
create index if not exists tasks_parent_idx on public.tasks (parent_id);

-- Mevcut kapanmış görevlerin ilerlemesi %100 sayılır (veri kaybı yok; yalnızca yeni sütun)
update public.tasks set progress = 100 where status in ('COMPLETED', 'APPROVED') and progress <> 100;

create table if not exists public.task_dependencies (
  task_id       uuid not null references public.tasks (id) on delete cascade,
  depends_on_id uuid not null references public.tasks (id) on delete cascade,
  created_by    uuid references public.profiles (id) on delete set null,
  created_at    timestamptz not null default now(),
  primary key (task_id, depends_on_id),
  constraint task_dependencies_self_chk check (task_id <> depends_on_id)
);
create index if not exists task_dependencies_depends_idx on public.task_dependencies (depends_on_id);

create or replace function private.task_dependencies_check()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if exists (
    with recursive chain(id) as (
      select d.depends_on_id from public.task_dependencies d where d.task_id = new.depends_on_id
      union
      select d.depends_on_id from public.task_dependencies d join chain c on d.task_id = c.id
    )
    select 1 from chain where id = new.task_id
  ) then
    raise exception 'Bu bağımlılık bir döngü oluşturur (görevler birbirini bekler).';
  end if;
  return new;
end;
$$;

drop trigger if exists task_dependencies_check on public.task_dependencies;
create trigger task_dependencies_check
  before insert on public.task_dependencies
  for each row execute function private.task_dependencies_check();

-- Görev tutarlılığı: alt görev tek seviye, kapanınca ilerleme %100,
-- ön koşulları bitmemiş görev "Tamamlandı" yapılamaz.
create or replace function private.tasks_validate_ex()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_parent record; v_open integer;
begin
  if new.parent_id is not null and (tg_op = 'INSERT' or new.parent_id is distinct from old.parent_id) then
    select t.id, t.parent_id, t.project_id into v_parent from public.tasks t where t.id = new.parent_id;
    if v_parent.id is null then raise exception 'Üst görev bulunamadı.'; end if;
    if v_parent.parent_id is not null then
      raise exception 'Alt görevin altına görev eklenemez (en fazla bir seviye).';
    end if;
    if tg_op = 'UPDATE' and exists (select 1 from public.tasks c where c.parent_id = new.id) then
      raise exception 'Alt görevleri olan bir görev başka bir görevin altına taşınamaz.';
    end if;
    if new.project_id is null then new.project_id := v_parent.project_id; end if;
  end if;

  if new.status in ('COMPLETED', 'APPROVED') then new.progress := 100; end if;
  if new.status <> 'BLOCKED' then new.blocked_reason := ''; end if;

  if new.status = 'COMPLETED' and (tg_op = 'INSERT' or old.status <> 'COMPLETED') then
    select count(*) into v_open
      from public.task_dependencies d join public.tasks p on p.id = d.depends_on_id
     where d.task_id = new.id and p.status not in ('COMPLETED', 'APPROVED', 'CANCELLED');
    if v_open > 0 then
      raise exception 'Bu görevin tamamlanmamış % ön koşul görevi var. Önce ön koşullar tamamlanmalı.', v_open;
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists tasks_validate_ex on public.tasks;
create trigger tasks_validate_ex
  before insert or update on public.tasks
  for each row execute function private.tasks_validate_ex();

-- Sorumlulara "görev güncellendi" bildirimi
create or replace function private.tasks_notify_ex()
returns trigger language plpgsql security definer set search_path = '' as $$
declare r record; v_actor uuid := auth.uid(); v_changes text[] := '{}';
begin
  if new.title <> old.title then v_changes := v_changes || 'başlık'::text; end if;
  if new.description <> old.description then v_changes := v_changes || 'açıklama'::text; end if;
  if new.start_date <> old.start_date then v_changes := v_changes || 'başlangıç tarihi'::text; end if;
  if new.due_date <> old.due_date then v_changes := v_changes || 'teslim tarihi'::text; end if;
  if new.priority <> old.priority then v_changes := v_changes || 'öncelik'::text; end if;
  if new.project_id is distinct from old.project_id then v_changes := v_changes || 'proje'::text; end if;
  if new.status <> old.status and (new.status in ('BLOCKED', 'CANCELLED') or old.status = 'BLOCKED') then
    v_changes := v_changes || ('durum (' || private.task_status_label(new.status) || ')');
  end if;
  if cardinality(v_changes) = 0 then return null; end if;

  for r in select ta.user_id from public.task_assignees ta
           where ta.task_id = new.id and (v_actor is null or ta.user_id <> v_actor) loop
    perform private.notify(r.user_id, 'TASK_UPDATED', 'Görev güncellendi',
      new.code || ' — ' || new.title || ': ' || array_to_string(v_changes, ', ') || ' değişti.',
      '/gorevler/' || new.id);
  end loop;

  if new.project_id is distinct from old.project_id then
    perform private.log_activity('TASK_UPDATED', 'task', new.id::text,
      'Görevin projesi değişti: ' || new.code, jsonb_build_object('project_id', new.project_id));
  end if;
  return null;
end;
$$;

drop trigger if exists tasks_notify_ex on public.tasks;
create trigger tasks_notify_ex
  after update on public.tasks
  for each row execute function private.tasks_notify_ex();

-- Yeni rapor sürümünde departman sorumlusu da bilgilendirilir
create or replace function private.report_versions_notify_lead()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_task record;
begin
  select t.id, t.code, t.department_id into v_task
    from public.reports r join public.tasks t on t.id = r.task_id where r.id = new.report_id;
  perform private.notify_dept_lead(v_task.department_id, 'REPORT_SUBMITTED', 'Yeni rapor inceleme bekliyor',
    v_task.code || ' görevi için V' || new.version_number || ' raporu yüklendi.',
    '/yonetim/rapor-inceleme/' || new.report_id, new.uploaded_by);
  return null;
end;
$$;

drop trigger if exists report_versions_notify_lead on public.report_versions;
create trigger report_versions_notify_lead
  after insert on public.report_versions
  for each row execute function private.report_versions_notify_lead();

-- ----------------------------------------------------------------------------
-- 7. Görev yorumları
-- ----------------------------------------------------------------------------
create table if not exists public.task_comments (
  id         uuid primary key default gen_random_uuid(),
  task_id    uuid not null references public.tasks (id) on delete cascade,
  author_id  uuid default auth.uid() references public.profiles (id) on delete set null,
  body       text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint task_comments_body_len check (char_length(btrim(body)) between 1 and 4000)
);
create index if not exists task_comments_task_idx on public.task_comments (task_id, created_at);

create or replace function private.task_comments_before_write()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    new.author_id := coalesce(auth.uid(), new.author_id);
    new.created_at := now();
  else
    if new.task_id <> old.task_id or new.author_id is distinct from old.author_id
       or new.created_at <> old.created_at then
      raise exception 'Yorumun yalnızca metni düzenlenebilir.';
    end if;
  end if;
  new.body := btrim(new.body);
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists task_comments_before_write on public.task_comments;
create trigger task_comments_before_write
  before insert or update on public.task_comments
  for each row execute function private.task_comments_before_write();

create or replace function private.task_comments_after_insert()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_task record; v_author text; r record;
begin
  select t.id, t.code, t.title, t.created_by into v_task from public.tasks t where t.id = new.task_id;
  select btrim(first_name || ' ' || last_name) into v_author from public.profiles where id = new.author_id;
  for r in
    select distinct u from (
      select ta.user_id as u from public.task_assignees ta where ta.task_id = new.task_id
      union select v_task.created_by
    ) x where u is not null and u is distinct from new.author_id
  loop
    perform private.notify(r.u, 'TASK_COMMENT', 'Yeni yorum',
      coalesce(v_author, 'Bir ekip üyesi') || ', ' || v_task.code || ' görevine yorum yaptı: '
        || left(new.body, 140) || case when char_length(new.body) > 140 then '…' else '' end,
      '/gorevler/' || new.task_id);
  end loop;
  perform private.log_activity('TASK_COMMENTED', 'task', new.task_id::text,
    v_task.code || ' görevine yorum yapıldı', jsonb_build_object('comment_id', new.id));
  return null;
end;
$$;

drop trigger if exists task_comments_after_insert on public.task_comments;
create trigger task_comments_after_insert
  after insert on public.task_comments
  for each row execute function private.task_comments_after_insert();

-- ----------------------------------------------------------------------------
-- 8. Doküman merkezi
-- ----------------------------------------------------------------------------
create sequence if not exists public.document_code_seq;

create table if not exists public.documents (
  id              uuid primary key default gen_random_uuid(),
  code            text not null,
  title           text not null,
  description     text not null default '',
  category        public.document_category not null default 'OTHER',
  department_id   uuid references public.departments (id) on delete set null,
  project_id      uuid references public.projects (id) on delete set null,
  task_id         uuid references public.tasks (id) on delete set null,
  is_restricted   boolean not null default false,
  status          public.document_status not null default 'DRAFT',
  current_version integer not null default 0 check (current_version >= 0),
  review_note     text,
  reviewed_by     uuid references public.profiles (id) on delete set null,
  reviewed_at     timestamptz,
  created_by      uuid references public.profiles (id) on delete set null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  constraint documents_code_key unique (code),
  constraint documents_title_len check (char_length(btrim(title)) between 3 and 160),
  constraint documents_description_len check (char_length(description) <= 5000)
);
create index if not exists documents_department_idx on public.documents (department_id);
create index if not exists documents_project_idx on public.documents (project_id);
create index if not exists documents_task_idx on public.documents (task_id);
create index if not exists documents_title_trgm_idx on public.documents using gin (title extensions.gin_trgm_ops);

create table if not exists public.document_versions (
  id             uuid primary key default gen_random_uuid(),
  document_id    uuid not null references public.documents (id) on delete cascade,
  version_number integer not null check (version_number >= 1),
  storage_path   text not null,
  original_name  text not null,
  extension      text not null,
  mime_type      text not null,
  size_bytes     bigint not null check (size_bytes > 0),
  sha256         text not null check (sha256 ~ '^[0-9a-f]{64}$'),
  note           text not null default '',
  uploaded_by    uuid references public.profiles (id) on delete set null,
  created_at     timestamptz not null default now(),
  constraint document_versions_number_key unique (document_id, version_number),
  constraint document_versions_path_key unique (storage_path),
  constraint document_versions_dup_key unique (document_id, sha256),
  constraint document_versions_note_len check (char_length(note) <= 2000)
);

create or replace function private.can_view_document(p_doc uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select private.is_active_user() and exists (
    select 1 from public.documents d
    where d.id = p_doc
      and (not d.is_restricted
           or private.is_admin()
           or d.created_by = auth.uid()
           or d.department_id = private.my_department_id()
           or private.is_dept_lead(d.department_id))
  );
$$;

create or replace function private.can_edit_document(p_doc uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select private.is_active_user() and exists (
    select 1 from public.documents d
    where d.id = p_doc
      and (d.created_by = auth.uid() or private.can_manage_department(d.department_id))
  );
$$;

create or replace function private.documents_before_write()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    new.code := 'DOC-' || lpad(nextval('public.document_code_seq')::text, 4, '0');
    new.created_by := coalesce(auth.uid(), new.created_by);
    new.created_at := now();
  else
    if new.code <> old.code or new.id <> old.id or new.created_at <> old.created_at
       or new.created_by is distinct from old.created_by then
      raise exception 'Doküman kimlik bilgileri değiştirilemez.';
    end if;
    if new.department_id is distinct from old.department_id and not private.can_manage_department(new.department_id)
       and auth.uid() is not null then
      raise exception 'Dokümanı bu departmana taşıma yetkiniz yok.' using errcode = '42501';
    end if;
    if (new.title <> old.title or new.description <> old.description or new.category <> old.category
        or new.project_id is distinct from old.project_id or new.task_id is distinct from old.task_id
        or new.is_restricted <> old.is_restricted or new.department_id is distinct from old.department_id) then
      perform private.log_activity('DOCUMENT_UPDATED', 'document', new.id::text,
        'Doküman bilgileri güncellendi: ' || new.code || ' — ' || new.title, '{}'::jsonb);
    end if;
  end if;
  new.title := btrim(new.title);
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists documents_before_write on public.documents;
create trigger documents_before_write
  before insert or update on public.documents
  for each row execute function private.documents_before_write();

create or replace function public.create_document(
  p_title text, p_description text, p_category public.document_category,
  p_department_id uuid, p_project_id uuid default null, p_task_id uuid default null,
  p_is_restricted boolean default false
) returns public.documents language plpgsql security definer set search_path = '' as $$
declare v_doc public.documents;
begin
  if not private.is_active_user() then
    raise exception 'Yetkisiz işlem.' using errcode = '42501';
  end if;
  if p_department_id is not null and not exists (
       select 1 from public.departments where id = p_department_id and is_active) then
    raise exception 'Geçersiz veya pasif departman.';
  end if;
  if p_task_id is not null and not private.can_view_task(p_task_id) then
    raise exception 'Seçilen görev bulunamadı veya erişim yetkiniz yok.' using errcode = '42501';
  end if;
  insert into public.documents (title, description, category, department_id, project_id, task_id, is_restricted)
  values (btrim(coalesce(p_title, '')), coalesce(p_description, ''), coalesce(p_category, 'OTHER'),
          p_department_id, p_project_id, p_task_id, coalesce(p_is_restricted, false))
  returning * into v_doc;
  perform private.log_activity('DOCUMENT_CREATED', 'document', v_doc.id::text,
    'Doküman oluşturuldu: ' || v_doc.code || ' — ' || v_doc.title, '{}'::jsonb);
  return v_doc;
end;
$$;

-- Yeni sürüm: dosya önce Storage'a (<doküman>/<yükleme>/<ad>) yüklenir; bu
-- fonksiyon nesnenin varlığını, türünü ve boyutunu SUNUCUDA doğrular.
create or replace function public.add_document_version(
  p_document_id uuid, p_path text, p_name text, p_sha256 text, p_note text default ''
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_doc public.documents; v_obj record; v_ext text; v_size bigint; v_mime text;
  v_sha text := lower(coalesce(p_sha256, '')); v_version integer; v_id uuid;
  v_max bigint := private.max_file_size_bytes(); v_actor text;
begin
  if not private.can_edit_document(p_document_id) then
    raise exception 'Bu dokümana sürüm yükleme yetkiniz yok.' using errcode = '42501';
  end if;
  select * into v_doc from public.documents where id = p_document_id for update;
  if p_path is null or left(p_path, 37) <> p_document_id::text || '/' or p_path like '%..%'
     or array_length(string_to_array(p_path, '/'), 1) <> 3 then
    raise exception 'Geçersiz dosya yolu.' using errcode = '42501';
  end if;
  select o.name, o.metadata into v_obj from storage.objects o
   where o.bucket_id = 'documents' and o.name = p_path;
  if v_obj.name is null then
    raise exception 'Dosya depolama alanında bulunamadı. Yükleme tamamlanmamış olabilir.';
  end if;
  v_ext  := lower(substring(p_path from '\.([A-Za-z0-9]+)$'));
  v_size := (v_obj.metadata ->> 'size')::bigint;
  v_mime := lower(split_part(coalesce(v_obj.metadata ->> 'mimetype', ''), ';', 1));
  if v_ext is null or private.canonical_mime(v_ext) is null then
    raise exception 'İzin verilmeyen dosya türü: %', p_name;
  end if;
  if v_mime <> private.canonical_mime(v_ext) then
    raise exception 'Dosya türü ile uzantısı uyuşmuyor: %', p_name;
  end if;
  if v_size is null or v_size <= 0 then raise exception 'Boş dosya yüklenemez.'; end if;
  if v_size > v_max then
    raise exception 'Dosya boyutu sınırı aşıldı (% MB): %', v_max / 1048576, p_name;
  end if;
  if v_sha !~ '^[0-9a-f]{64}$' then raise exception 'Dosya özeti geçersiz.'; end if;
  if exists (select 1 from public.document_versions where document_id = p_document_id and sha256 = v_sha) then
    raise exception 'Bu dosya bu dokümana daha önce yüklenmiş: %', p_name using errcode = '23505';
  end if;

  v_version := v_doc.current_version + 1;
  insert into public.document_versions (document_id, version_number, storage_path, original_name,
                                        extension, mime_type, size_bytes, sha256, note, uploaded_by)
  values (p_document_id, v_version, p_path, left(coalesce(p_name, 'dosya'), 255), v_ext, v_mime,
          v_size, v_sha, left(coalesce(p_note, ''), 2000), auth.uid())
  returning id into v_id;

  update public.documents
     set current_version = v_version, status = 'PENDING',
         review_note = null, reviewed_by = null, reviewed_at = null
   where id = p_document_id;

  select btrim(first_name || ' ' || last_name) into v_actor from public.profiles where id = auth.uid();
  perform private.notify_admins('DOCUMENT_UPLOADED', 'Doküman onay bekliyor',
    coalesce(v_actor, 'Bir üye') || ', ' || v_doc.code || ' — ' || v_doc.title || ' için V' || v_version || ' yükledi.',
    '/dokumanlar/' || p_document_id, null, auth.uid());
  perform private.notify_dept_lead(v_doc.department_id, 'DOCUMENT_UPLOADED', 'Doküman onay bekliyor',
    coalesce(v_actor, 'Bir üye') || ', ' || v_doc.code || ' — ' || v_doc.title || ' için V' || v_version || ' yükledi.',
    '/dokumanlar/' || p_document_id, auth.uid());
  perform private.log_activity('DOCUMENT_UPLOADED', 'document', p_document_id::text,
    v_doc.code || ' için dosya yüklendi (V' || v_version || '): ' || left(coalesce(p_name, ''), 120),
    jsonb_build_object('version', v_version, 'size', v_size, 'extension', v_ext));
  return jsonb_build_object('version_id', v_id, 'version_number', v_version);
end;
$$;

create or replace function public.review_document(p_document_id uuid, p_action text, p_note text default null)
returns public.documents language plpgsql security definer set search_path = '' as $$
declare v_doc public.documents; v_note text := nullif(btrim(coalesce(p_note, '')), ''); v_uploader uuid;
begin
  select * into v_doc from public.documents where id = p_document_id for update;
  if v_doc.id is null then raise exception 'Doküman bulunamadı.'; end if;
  if not private.can_manage_department(v_doc.department_id) then
    raise exception 'Bu dokümanı onaylama yetkiniz yok.' using errcode = '42501';
  end if;
  if v_doc.status <> 'PENDING' then
    raise exception 'Yalnızca onay bekleyen dokümanlar incelenebilir.';
  end if;
  select uploaded_by into v_uploader from public.document_versions
   where document_id = p_document_id and version_number = v_doc.current_version;
  -- Çıkar çatışması: departman sorumlusu kendi yüklediği sürümü onaylayamaz (yönetici onaylar)
  if not private.is_admin() and v_uploader = auth.uid() then
    raise exception 'Kendi yüklediğiniz sürümü onaylayamazsınız; bir yönetici onaylar.' using errcode = '42501';
  end if;

  if p_action = 'APPROVE' then
    update public.documents set status = 'APPROVED', review_note = v_note,
           reviewed_by = auth.uid(), reviewed_at = now()
     where id = p_document_id returning * into v_doc;
    perform private.notify(coalesce(v_uploader, v_doc.created_by), 'DOCUMENT_APPROVED', 'Doküman onaylandı',
      v_doc.code || ' — ' || v_doc.title || ' (V' || v_doc.current_version || ') onaylandı.' || coalesce(' Not: ' || v_note, ''),
      '/dokumanlar/' || v_doc.id);
    perform private.log_activity('DOCUMENT_APPROVED', 'document', v_doc.id::text,
      v_doc.code || ' onaylandı (V' || v_doc.current_version || ')', jsonb_build_object('note', v_note));
  elsif p_action = 'REQUEST_REVISION' then
    if v_note is null then raise exception 'Revizyon gerekçesi yazılması zorunludur.'; end if;
    update public.documents set status = 'REVISION_REQUESTED', review_note = v_note,
           reviewed_by = auth.uid(), reviewed_at = now()
     where id = p_document_id returning * into v_doc;
    perform private.notify(coalesce(v_uploader, v_doc.created_by), 'DOCUMENT_REVISION_REQUESTED', 'Doküman için revizyon istendi',
      v_doc.code || ' — ' || v_doc.title || ': ' || v_note, '/dokumanlar/' || v_doc.id);
    perform private.log_activity('DOCUMENT_REVISION_REQUESTED', 'document', v_doc.id::text,
      v_doc.code || ' için revizyon istendi', jsonb_build_object('note', v_note));
  else
    raise exception 'Geçersiz işlem: %', p_action;
  end if;
  return v_doc;
end;
$$;

-- Silme: yönetici her dokümanı, oluşturan onaylanmamış kendi dokümanını silebilir.
-- Storage nesnelerinin yolları döndürülür; istemci bunları Storage API ile siler
-- (Storage, nesnelerin SQL ile silinmesine izin vermez).
create or replace function public.delete_document(p_document_id uuid)
returns text[] language plpgsql security definer set search_path = '' as $$
declare v_doc public.documents; v_paths text[];
begin
  select * into v_doc from public.documents where id = p_document_id for update;
  if v_doc.id is null then raise exception 'Doküman bulunamadı.'; end if;
  if not (private.is_admin()
          or (private.is_active_user() and v_doc.created_by = auth.uid() and v_doc.status <> 'APPROVED')) then
    raise exception 'Bu dokümanı silme yetkiniz yok. Onaylı dokümanları yalnızca yönetici silebilir.' using errcode = '42501';
  end if;
  select coalesce(array_agg(storage_path), '{}') into v_paths
    from public.document_versions where document_id = p_document_id;
  delete from public.documents where id = p_document_id;
  perform private.log_activity('DOCUMENT_DELETED', 'document', p_document_id::text,
    'Doküman silindi: ' || v_doc.code || ' — ' || v_doc.title,
    jsonb_build_object('versions', cardinality(v_paths)));
  return v_paths;
end;
$$;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
select 'documents', 'documents', false, b.file_size_limit, b.allowed_mime_types
  from storage.buckets b where b.id = 'reports'
on conflict (id) do update set public = false, allowed_mime_types = excluded.allowed_mime_types;

create or replace function private.can_upload_document_object(p_name text)
returns boolean language plpgsql stable security definer set search_path = '' as $$
declare v_parts text[] := string_to_array(p_name, '/'); v_doc uuid;
begin
  if cardinality(v_parts) <> 3 then return false; end if;
  if private.canonical_mime(substring(v_parts[3] from '\.([A-Za-z0-9]+)$')) is null then return false; end if;
  v_doc := private.try_uuid(v_parts[1]);
  return v_doc is not null and private.can_edit_document(v_doc);
end;
$$;

drop policy if exists documents_objects_insert on storage.objects;
drop policy if exists documents_objects_select on storage.objects;
drop policy if exists documents_objects_delete on storage.objects;
create policy documents_objects_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'documents' and private.can_upload_document_object(name));
-- Okuma: dokümanı görebilen herkes. Storage API silmeden önce nesneyi okuduğu
-- için yönetici ve (sürüme bağlı olmayan) kendi nesnesinin sahibi de okuyabilir.
create policy documents_objects_select on storage.objects for select to authenticated
  using (bucket_id = 'documents' and (
    private.can_view_document(private.try_uuid(split_part(name, '/', 1)))
    or private.is_admin()
    or (owner_id = auth.uid()::text
        and not exists (select 1 from public.document_versions v where v.storage_path = name))
  ));
-- Silme: yönetici; ya da sahibi, nesne artık bir doküman sürümüne bağlı değilse
create policy documents_objects_delete on storage.objects for delete to authenticated
  using (bucket_id = 'documents' and (
    private.is_admin()
    or (owner_id = auth.uid()::text
        and not exists (select 1 from public.document_versions v where v.storage_path = name))
  ));

-- Dosya boyutu sınırı tüm dosya bucket'larına uygulanır
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
  update storage.buckets set file_size_limit = p_mb::bigint * 1024 * 1024 where id in ('reports', 'documents');
  perform private.log_activity('SETTING_CHANGED', 'setting', 'max_file_size_mb',
    'Dosya boyutu sınırı ' || p_mb || ' MB olarak ayarlandı', jsonb_build_object('value', p_mb));
end;
$$;

-- Rapor dosyaları: departman sorumlusu kendi departmanının raporlarını okuyabilir
create or replace function private.can_read_object(p_name text)
returns boolean language sql stable security definer set search_path = '' as $$
  select private.is_admin()
      or (private.is_active_user() and split_part(p_name, '/', 2) = auth.uid()::text)
      or (private.is_active_user() and private.can_manage_task(private.try_uuid(split_part(p_name, '/', 1))));
$$;

-- ----------------------------------------------------------------------------
-- 9. Takvim etkinlikleri (toplantı, atölye, kilometre taşı, test)
-- ----------------------------------------------------------------------------
create table if not exists public.events (
  id            uuid primary key default gen_random_uuid(),
  title         text not null,
  description   text not null default '',
  type          public.event_type not null default 'MEETING',
  starts_at     timestamptz not null,
  ends_at       timestamptz not null,
  all_day       boolean not null default false,
  location      text not null default '',
  department_id uuid references public.departments (id) on delete set null,
  project_id    uuid references public.projects (id) on delete set null,
  created_by    uuid default auth.uid() references public.profiles (id) on delete set null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  constraint events_title_len check (char_length(btrim(title)) between 2 and 160),
  constraint events_description_len check (char_length(description) <= 2000),
  constraint events_location_len check (char_length(location) <= 160),
  constraint events_time_chk check (ends_at >= starts_at),
  constraint events_span_chk check (ends_at - starts_at <= interval '31 days')
);
create index if not exists events_starts_idx on public.events (starts_at);

create or replace function private.events_before_write()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    new.created_by := coalesce(auth.uid(), new.created_by);
    new.created_at := now();
  elsif new.created_by is distinct from old.created_by or new.created_at <> old.created_at then
    raise exception 'Etkinliği oluşturan bilgisi değiştirilemez.';
  end if;
  new.title := btrim(new.title);
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists events_before_write on public.events;
create trigger events_before_write
  before insert or update on public.events
  for each row execute function private.events_before_write();

create or replace function private.events_audit()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    perform private.log_activity('EVENT_CREATED', 'event', new.id::text,
      'Takvime eklendi: ' || new.title || ' (' || to_char(new.starts_at at time zone 'Europe/Istanbul', 'DD.MM.YYYY HH24:MI') || ')', '{}'::jsonb);
  elsif tg_op = 'UPDATE' then
    perform private.log_activity('EVENT_UPDATED', 'event', new.id::text, 'Etkinlik güncellendi: ' || new.title, '{}'::jsonb);
  else
    perform private.log_activity('EVENT_DELETED', 'event', old.id::text, 'Etkinlik silindi: ' || old.title, '{}'::jsonb);
  end if;
  return null;
end;
$$;

drop trigger if exists events_audit on public.events;
create trigger events_audit
  after insert or update or delete on public.events
  for each row execute function private.events_audit();

-- ----------------------------------------------------------------------------
-- 10. Risk yönetimi
-- ----------------------------------------------------------------------------
create sequence if not exists public.risk_code_seq;

create table if not exists public.risks (
  id               uuid primary key default gen_random_uuid(),
  code             text not null,
  title            text not null,
  description      text not null default '',
  project_id       uuid references public.projects (id) on delete set null,
  department_id    uuid references public.departments (id) on delete set null,
  owner_id         uuid references public.profiles (id) on delete set null,
  probability      smallint not null,
  impact           smallint not null,
  score            smallint generated always as (probability * impact) stored,
  mitigation       text not null default '',
  contingency      text not null default '',
  status           public.risk_status not null default 'OPEN',
  last_reviewed_at date not null default current_date,
  created_by       uuid default auth.uid() references public.profiles (id) on delete set null,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  constraint risks_code_key unique (code),
  constraint risks_title_len check (char_length(btrim(title)) between 3 and 160),
  constraint risks_description_len check (char_length(description) <= 5000),
  constraint risks_mitigation_len check (char_length(mitigation) <= 3000),
  constraint risks_contingency_len check (char_length(contingency) <= 3000),
  constraint risks_probability_chk check (probability between 1 and 5),
  constraint risks_impact_chk check (impact between 1 and 5)
);
create index if not exists risks_score_idx on public.risks (score desc) where status <> 'CLOSED';

create or replace function private.risks_before_write()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    new.code := 'RSK-' || lpad(nextval('public.risk_code_seq')::text, 3, '0');
    new.created_by := coalesce(auth.uid(), new.created_by);
    new.created_at := now();
    new.last_reviewed_at := coalesce(new.last_reviewed_at, private.today());
  else
    if new.code <> old.code or new.created_by is distinct from old.created_by or new.created_at <> old.created_at then
      raise exception 'Risk kimlik bilgileri değiştirilemez.';
    end if;
    -- Değerlendirme değiştiyse son değerlendirme tarihi bugündür
    if (new.probability <> old.probability or new.impact <> old.impact or new.status <> old.status)
       and new.last_reviewed_at = old.last_reviewed_at then
      new.last_reviewed_at := private.today();
    end if;
  end if;
  new.title := btrim(new.title);
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists risks_before_write on public.risks;
create trigger risks_before_write
  before insert or update on public.risks
  for each row execute function private.risks_before_write();

create or replace function private.risks_after_write()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_body text;
begin
  if tg_op = 'INSERT' then
    v_body := new.code || ' — ' || new.title || ' (puan ' || new.score || '/25)';
    perform private.notify_admins('RISK_CREATED', case when new.score >= 15 then 'Kritik risk kaydedildi' else 'Yeni risk kaydedildi' end,
      v_body, '/riskler/' || new.id, null, new.created_by);
    perform private.notify_dept_lead(new.department_id, 'RISK_CREATED', 'Yeni risk kaydedildi', v_body,
      '/riskler/' || new.id, new.created_by);
    if new.owner_id is not null and new.owner_id is distinct from new.created_by then
      perform private.notify(new.owner_id, 'RISK_CREATED', 'Bir riskin sorumlusu oldunuz', v_body, '/riskler/' || new.id);
    end if;
    perform private.log_activity('RISK_CREATED', 'risk', new.id::text, 'Risk kaydedildi: ' || v_body,
      jsonb_build_object('probability', new.probability, 'impact', new.impact));
  elsif tg_op = 'UPDATE' then
    if new.owner_id is distinct from old.owner_id and new.owner_id is not null and new.owner_id is distinct from auth.uid() then
      perform private.notify(new.owner_id, 'RISK_CREATED', 'Bir riskin sorumlusu oldunuz',
        new.code || ' — ' || new.title || ' (puan ' || new.score || '/25)', '/riskler/' || new.id);
    end if;
    perform private.log_activity('RISK_UPDATED', 'risk', new.id::text,
      'Risk güncellendi: ' || new.code || ' (puan ' || old.score || ' → ' || new.score || ', ' || new.status || ')',
      jsonb_build_object('from', old.score, 'to', new.score, 'status', new.status));
  else
    perform private.log_activity('RISK_DELETED', 'risk', old.id::text, 'Risk silindi: ' || old.code || ' — ' || old.title, '{}'::jsonb);
  end if;
  return null;
end;
$$;

drop trigger if exists risks_after_write on public.risks;
create trigger risks_after_write
  after insert or update or delete on public.risks
  for each row execute function private.risks_after_write();

-- ----------------------------------------------------------------------------
-- 11. Görev RPC'leri
-- ----------------------------------------------------------------------------
drop function if exists public.create_task(text, text, uuid, date, date, public.task_priority, text[], text, uuid[]);

create or replace function public.create_task(
  p_title text, p_description text, p_department_id uuid,
  p_start_date date, p_due_date date, p_priority public.task_priority,
  p_required_file_types text[], p_notes text, p_assignee_ids uuid[],
  p_project_id uuid default null, p_parent_id uuid default null, p_difficulty integer default 3
) returns public.tasks language plpgsql security definer set search_path = '' as $$
declare v_task public.tasks; v_uid uuid; v_ext text;
begin
  if not private.can_manage_department(p_department_id) then
    raise exception 'Bu departmana görev oluşturma yetkiniz yok.' using errcode = '42501';
  end if;
  if p_assignee_ids is null or cardinality(p_assignee_ids) = 0 then
    raise exception 'En az bir sorumlu seçilmelidir.';
  end if;
  if p_difficulty is null or p_difficulty < 1 or p_difficulty > 5 then
    raise exception 'Zorluk 1–5 arasında olmalıdır.';
  end if;
  foreach v_ext in array coalesce(p_required_file_types, '{}') loop
    if private.canonical_mime(v_ext) is null then
      raise exception 'Desteklenmeyen dosya türü: %', v_ext;
    end if;
  end loop;
  if p_parent_id is not null and not private.can_view_task(p_parent_id) then
    raise exception 'Üst görev bulunamadı veya erişim yetkiniz yok.' using errcode = '42501';
  end if;

  insert into public.tasks (title, description, department_id, start_date, due_date,
                            priority, required_file_types, notes, created_by,
                            project_id, parent_id, difficulty)
  values (btrim(p_title), coalesce(p_description, ''), p_department_id,
          coalesce(p_start_date, private.today()), p_due_date,
          coalesce(p_priority, 'NORMAL'),
          coalesce((select array_agg(distinct lower(x)) from unnest(p_required_file_types) x), '{}'),
          coalesce(p_notes, ''), auth.uid(), p_project_id, p_parent_id, p_difficulty)
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

-- Sorumlular: yönetici veya görevin departman sorumlusu (gövde 0002 ile aynı)
create or replace function public.set_task_assignees(p_task_id uuid, p_user_ids uuid[])
returns void language plpgsql security definer set search_path = '' as $$
declare v_uid uuid; v_code text;
begin
  if not private.can_manage_task(p_task_id) then
    raise exception 'Bu işlem için yönetici veya departman sorumlusu yetkisi gerekir.' using errcode = '42501';
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

-- Rapor inceleme: yönetici veya görevin departman sorumlusu (gövde 0002 ile aynı)
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
  if not private.can_manage_task((select r.task_id from public.reports r where r.id = p_report_id)) then
    raise exception 'Bu işlem için yönetici veya departman sorumlusu yetkisi gerekir.' using errcode = '42501';
  end if;
  -- Çıkar çatışması: departman sorumlusu kendi raporunu inceleyemez (yönetici inceler)
  if not private.is_admin() and exists (select 1 from public.reports r where r.id = p_report_id and r.uploaded_by = auth.uid()) then
    raise exception 'Kendi raporunuzu inceleyemezsiniz; raporu bir yönetici inceler.' using errcode = '42501';
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

create or replace function public.update_task_progress(p_task_id uuid, p_progress integer)
returns public.tasks language plpgsql security definer set search_path = '' as $$
declare v_task public.tasks; v_old smallint;
begin
  if not (private.is_task_assignee(p_task_id) or private.can_manage_task(p_task_id)) then
    raise exception 'Bu görevin ilerlemesini güncelleme yetkiniz yok.' using errcode = '42501';
  end if;
  if p_progress is null or p_progress < 0 or p_progress > 100 then
    raise exception 'İlerleme 0 ile 100 arasında olmalıdır.';
  end if;
  select * into v_task from public.tasks where id = p_task_id for update;
  if v_task.status in ('COMPLETED', 'APPROVED', 'CANCELLED') then
    raise exception 'Kapanmış bir görevin ilerlemesi değiştirilemez.';
  end if;
  v_old := v_task.progress;
  update public.tasks
     set progress = p_progress,
         status = case when status = 'NEW' and p_progress > 0 then 'IN_PROGRESS'::public.task_status else status end
   where id = p_task_id
  returning * into v_task;
  if v_old <> p_progress then
    perform private.log_activity('TASK_PROGRESS', 'task', p_task_id::text,
      v_task.code || ' ilerlemesi %' || v_old || ' → %' || p_progress, jsonb_build_object('from', v_old, 'to', p_progress));
  end if;
  return v_task;
end;
$$;

create or replace function public.set_task_blocked(p_task_id uuid, p_blocked boolean, p_reason text default null)
returns public.tasks language plpgsql security definer set search_path = '' as $$
declare v_task public.tasks; v_reason text := btrim(coalesce(p_reason, ''));
begin
  if not (private.is_task_assignee(p_task_id) or private.can_manage_task(p_task_id)) then
    raise exception 'Bu görevin durumunu değiştirme yetkiniz yok.' using errcode = '42501';
  end if;
  select * into v_task from public.tasks where id = p_task_id for update;
  if v_task.id is null then raise exception 'Görev bulunamadı.'; end if;
  if p_blocked then
    if v_task.status in ('COMPLETED', 'APPROVED', 'CANCELLED') then
      raise exception 'Kapanmış bir görev bloke edilemez.';
    end if;
    if char_length(v_reason) < 3 then
      raise exception 'Bloke nedeni yazılması zorunludur.';
    end if;
    update public.tasks set status = 'BLOCKED', blocked_reason = left(v_reason, 1000)
     where id = p_task_id returning * into v_task;
    perform private.notify_admins('TASK_UPDATED', 'Görev bloke edildi',
      v_task.code || ' — ' || v_task.title || ': ' || left(v_reason, 200), '/gorevler/' || v_task.id, null, auth.uid());
    perform private.notify_dept_lead(v_task.department_id, 'TASK_UPDATED', 'Görev bloke edildi',
      v_task.code || ' — ' || v_task.title || ': ' || left(v_reason, 200), '/gorevler/' || v_task.id, auth.uid());
    perform private.log_activity('TASK_BLOCKED', 'task', p_task_id::text,
      v_task.code || ' bloke edildi: ' || left(v_reason, 200), jsonb_build_object('reason', v_reason));
  else
    if v_task.status <> 'BLOCKED' then raise exception 'Görev bloke durumda değil.'; end if;
    update public.tasks set status = 'IN_PROGRESS' where id = p_task_id returning * into v_task;
    perform private.log_activity('TASK_UNBLOCKED', 'task', p_task_id::text,
      v_task.code || ' blokajı kaldırıldı', '{}'::jsonb);
  end if;
  return v_task;
end;
$$;

create or replace function public.add_task_dependency(p_task_id uuid, p_depends_on_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare v_a text; v_b text;
begin
  if not private.can_manage_task(p_task_id) then
    raise exception 'Bu göreve bağımlılık ekleme yetkiniz yok.' using errcode = '42501';
  end if;
  if p_task_id = p_depends_on_id then raise exception 'Görev kendisine bağımlı olamaz.'; end if;
  select code into v_a from public.tasks where id = p_task_id;
  select code into v_b from public.tasks where id = p_depends_on_id;
  if v_b is null then raise exception 'Ön koşul görevi bulunamadı.'; end if;
  insert into public.task_dependencies (task_id, depends_on_id, created_by)
  values (p_task_id, p_depends_on_id, auth.uid())
  on conflict do nothing;
  perform private.log_activity('TASK_DEPENDENCY_ADDED', 'task', p_task_id::text,
    v_a || ' artık ' || v_b || ' görevine bağlı', jsonb_build_object('depends_on', p_depends_on_id));
end;
$$;

create or replace function public.remove_task_dependency(p_task_id uuid, p_depends_on_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare v_a text; v_b text;
begin
  if not private.can_manage_task(p_task_id) then
    raise exception 'Bu görevin bağımlılıklarını değiştirme yetkiniz yok.' using errcode = '42501';
  end if;
  delete from public.task_dependencies where task_id = p_task_id and depends_on_id = p_depends_on_id;
  if found then
    select code into v_a from public.tasks where id = p_task_id;
    select code into v_b from public.tasks where id = p_depends_on_id;
    perform private.log_activity('TASK_DEPENDENCY_REMOVED', 'task', p_task_id::text,
      v_a || ' ile ' || coalesce(v_b, '?') || ' arasındaki bağımlılık kaldırıldı', '{}'::jsonb);
  end if;
end;
$$;

-- Bağımlılıklar (her iki yön). Ön koşul başka departmanda olsa bile kodu,
-- başlığı ve durumu görünür: departmanlar arası koordinasyon için gereklidir.
create or replace function public.task_dependency_info(p_task_id uuid)
returns table (direction text, task_id uuid, code text, title text, status public.task_status,
               due_date date, department_name text, can_open boolean)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not private.can_view_task(p_task_id) then
    raise exception 'Görev bulunamadı veya erişim yetkiniz yok.' using errcode = '42501';
  end if;
  return query
    select 'depends_on'::text, t.id, t.code, t.title, t.status, t.due_date, d.name, private.can_view_task(t.id)
      from public.task_dependencies x join public.tasks t on t.id = x.depends_on_id
      join public.departments d on d.id = t.department_id
     where x.task_id = p_task_id
    union all
    select 'blocks'::text, t.id, t.code, t.title, t.status, t.due_date, d.name, private.can_view_task(t.id)
      from public.task_dependencies x join public.tasks t on t.id = x.task_id
      join public.departments d on d.id = t.department_id
     where x.depends_on_id = p_task_id;
end;
$$;

-- Görev geçmişi: görevin ve raporlarının denetim kayıtları
create or replace function public.task_history(p_task_id uuid)
returns table (id bigint, action text, summary text, created_at timestamptz, actor text)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not private.can_view_task(p_task_id) then
    raise exception 'Görev bulunamadı veya erişim yetkiniz yok.' using errcode = '42501';
  end if;
  return query
    select l.id, l.action, l.summary, l.created_at,
           coalesce(btrim(p.first_name || ' ' || p.last_name), 'Sistem')
      from public.activity_logs l left join public.profiles p on p.id = l.actor_id
     where (l.entity_type = 'task' and l.entity_id = p_task_id::text)
        or (l.entity_type = 'report' and l.entity_id in (
              select r.id::text from public.reports r where r.task_id = p_task_id))
     order by l.created_at desc
     limit 200;
end;
$$;

-- Departman istatistikleri: departman sorumlusu da kendi departmanını görür
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
     or (private.is_active_user() and (d.id = private.my_department_id() or private.is_dept_lead(d.id)));
$$;

-- ----------------------------------------------------------------------------
-- 12. Proje görünümü (ilerleme gerçek görevlerden hesaplanır)
-- İlerleme = iptal edilmeyen görevlerin ilerleme ortalaması; kapanan görev %100.
-- ----------------------------------------------------------------------------
create or replace view public.project_overview as
  select pr.id, pr.code, pr.name, pr.description, pr.owner_id, pr.department_id,
         pr.start_date, pr.target_date, pr.status, pr.created_at, pr.updated_at,
         coalesce(btrim(o.first_name || ' ' || o.last_name), '') as owner_name,
         coalesce(s.total, 0)::integer as total_tasks,
         coalesce(s.done, 0)::integer as completed_tasks,
         coalesce(s.overdue, 0)::integer as overdue_tasks,
         coalesce(s.blocked, 0)::integer as blocked_tasks,
         coalesce(s.progress, 0)::integer as progress
    from public.projects pr
    left join public.profiles o on o.id = pr.owner_id
    left join lateral (
      select count(*) filter (where t.status <> 'CANCELLED') as total,
             count(*) filter (where t.status in ('COMPLETED', 'APPROVED')) as done,
             count(*) filter (where t.status = 'OVERDUE'
                               or (t.status not in ('COMPLETED', 'APPROVED', 'CANCELLED') and t.due_date < private.today())) as overdue,
             count(*) filter (where t.status = 'BLOCKED') as blocked,
             round(avg(t.progress) filter (where t.status <> 'CANCELLED')) as progress
        from public.tasks t where t.project_id = pr.id
    ) s on true
   where private.is_active_user();

-- ----------------------------------------------------------------------------
-- 13. Aktivite akışı (yetkiye göre süzülmüş denetim kayıtları)
-- ----------------------------------------------------------------------------
create or replace function public.activity_feed(p_department_id uuid default null, p_limit integer default 15)
returns table (id bigint, action text, summary text, entity_type text, entity_id text,
               created_at timestamptz, actor text)
language plpgsql stable security definer set search_path = '' as $$
declare v_admin boolean := private.is_admin();
begin
  if not private.is_active_user() then
    raise exception 'Yetkisiz işlem.' using errcode = '42501';
  end if;
  if p_department_id is not null and not (v_admin or private.is_dept_lead(p_department_id)
                                          or private.my_department_id() = p_department_id) then
    raise exception 'Bu departmanın aktivitelerini görme yetkiniz yok.' using errcode = '42501';
  end if;
  return query
    select l.id, l.action, l.summary, l.entity_type, l.entity_id, l.created_at,
           coalesce(btrim(p.first_name || ' ' || p.last_name), 'Sistem')
      from public.activity_logs l left join public.profiles p on p.id = l.actor_id
     where case
       when p_department_id is null and v_admin then true
       when l.entity_type = 'task' then
         private.can_view_task(private.try_uuid(l.entity_id))
         and (p_department_id is null or exists (
               select 1 from public.tasks t where t.id = private.try_uuid(l.entity_id) and t.department_id = p_department_id))
       when l.entity_type = 'document' then
         private.can_view_document(private.try_uuid(l.entity_id))
         and (p_department_id is null or exists (
               select 1 from public.documents d where d.id = private.try_uuid(l.entity_id) and d.department_id = p_department_id))
       when l.entity_type = 'risk' then
         p_department_id is null or exists (
           select 1 from public.risks r where r.id = private.try_uuid(l.entity_id) and r.department_id = p_department_id)
       when l.entity_type = 'event' then
         p_department_id is null or exists (
           select 1 from public.events e where e.id = private.try_uuid(l.entity_id) and e.department_id = p_department_id)
       when l.entity_type = 'project' then p_department_id is null
       else false
     end
     order by l.created_at desc
     limit least(greatest(coalesce(p_limit, 15), 1), 100);
end;
$$;

-- ----------------------------------------------------------------------------
-- 14. Kontrol merkezi özeti (tüm roller; görünürlük kullanıcının yetkisine göre)
-- ----------------------------------------------------------------------------
create or replace function public.mission_overview()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v jsonb; v_uid uuid := auth.uid(); v_admin boolean := private.is_admin();
  v_today date := private.today();
begin
  if not private.is_active_user() then
    raise exception 'Yetkisiz işlem.' using errcode = '42501';
  end if;

  with vis as (
    select t.*, (exists (select 1 from public.task_assignees a where a.task_id = t.id and a.user_id = v_uid)) as mine
      from public.tasks t
     where v_admin or private.can_view_task(t.id)
  ), open_t as (
    select * from vis where status not in ('COMPLETED', 'APPROVED', 'CANCELLED')
  ), dept_scope as (
    select d.id, d.name, d.code from public.departments d
     where d.is_active and (v_admin or d.id = private.my_department_id() or private.is_dept_lead(d.id))
  )
  select jsonb_build_object(
    'scope', case when v_admin then 'all' when private.is_any_lead() then 'lead' else 'member' end,
    'total_projects', (select count(*) from public.projects where status <> 'CANCELLED'),
    'active_projects', (select count(*) from public.projects where status = 'ACTIVE'),
    'active_tasks', (select count(*) from open_t),
    'completed_tasks', (select count(*) from vis where status = 'COMPLETED'),
    'approved_tasks', (select count(*) from vis where status = 'APPROVED'),
    'total_tasks', (select count(*) from vis),
    'in_progress_tasks', (select count(*) from vis where status in ('IN_PROGRESS', 'AWAITING_REPORT', 'IN_REVIEW', 'REVISION_REQUESTED')),
    'overdue_tasks', (select count(*) from open_t where status = 'OVERDUE' or due_date < v_today),
    'blocked_tasks', (select count(*) from open_t where status = 'BLOCKED'),
    'my_open_tasks', (select count(*) from open_t where mine),
    'pending_approvals', (
      (select count(*) from public.reports r join public.tasks t on t.id = r.task_id
        where r.status in ('PENDING', 'IN_REVIEW')
          and (v_admin or private.is_dept_lead(t.department_id) or r.uploaded_by = v_uid))
      + (select count(*) from public.documents d
          where d.status = 'PENDING'
            and (private.can_manage_department(d.department_id) or d.created_by = v_uid))),
    'active_members', (select count(*) from public.profiles where is_active),
    'projects', coalesce((
      select jsonb_agg(to_jsonb(p) order by (p.status = 'ACTIVE') desc, p.target_date)
        from (select id, code, name, owner_name, start_date, target_date, status, progress,
                     total_tasks, completed_tasks, overdue_tasks, blocked_tasks
                from public.project_overview
               where status not in ('COMPLETED', 'CANCELLED')
               order by target_date limit 8) p), '[]'::jsonb),
    'departments', coalesce((
      select jsonb_agg(x order by x ->> 'name') from (
        select jsonb_build_object(
          'id', ds.id, 'name', ds.name, 'code', ds.code,
          'total', count(t.id) filter (where t.status <> 'CANCELLED'),
          'completed', count(t.id) filter (where t.status in ('COMPLETED', 'APPROVED')),
          'active', count(t.id) filter (where t.status not in ('COMPLETED', 'APPROVED', 'CANCELLED')),
          'overdue', count(t.id) filter (where t.status not in ('COMPLETED', 'APPROVED', 'CANCELLED')
                                          and (t.status = 'OVERDUE' or t.due_date < v_today)),
          'blocked', count(t.id) filter (where t.status = 'BLOCKED')
        ) as x
        from dept_scope ds left join public.tasks t on t.department_id = ds.id
        group by ds.id, ds.name, ds.code) s), '[]'::jsonb),
    'upcoming', coalesce((
      select jsonb_agg(to_jsonb(u) order by u.due_date, u.priority desc) from (
        select o.id, o.code, o.title, o.due_date, o.status, o.priority, o.mine, o.progress,
               d.name as department_name
          from open_t o join public.departments d on d.id = o.department_id
         where o.due_date between v_today and v_today + 7
         order by o.due_date limit 12) u), '[]'::jsonb),
    'critical', coalesce((
      select jsonb_agg(to_jsonb(c)) from (
        select o.id, o.code, o.title, o.due_date, o.status, o.priority, o.mine, o.blocked_reason,
               d.name as department_name,
               case when o.status = 'BLOCKED' then 'blocked'
                    when o.status = 'OVERDUE' or o.due_date < v_today then 'overdue'
                    else 'priority' end as reason
          from open_t o join public.departments d on d.id = o.department_id
         where o.status = 'BLOCKED' or o.status = 'OVERDUE' or o.due_date < v_today
            or o.priority in ('CRITICAL', 'HIGH')
         order by case when o.status = 'BLOCKED' then 0 when o.status = 'OVERDUE' or o.due_date < v_today then 1 else 2 end,
                  case o.priority when 'CRITICAL' then 0 when 'HIGH' then 1 else 2 end, o.due_date
         limit 10) c), '[]'::jsonb),
    'critical_risks', coalesce((
      select jsonb_agg(to_jsonb(r) order by r.score desc) from (
        select id, code, title, score, probability, impact, status
          from public.risks where status <> 'CLOSED' and score >= 15
         order by score desc limit 6) r), '[]'::jsonb),
    'upcoming_events', coalesce((
      select jsonb_agg(to_jsonb(e) order by e.starts_at) from (
        select id, title, type, starts_at, ends_at, all_day, location
          from public.events
         where ends_at >= now() and starts_at <= now() + interval '14 days'
         order by starts_at limit 5) e), '[]'::jsonb)
  ) into v;
  return v;
end;
$$;

-- ----------------------------------------------------------------------------
-- 15. Analitik (yönetici: tümü; departman sorumlusu: yalnızca kendi departmanı)
-- Üye puanı (açık formül, ekranda da gösterilir):
--   tamamlanan her görev için  zorluk(1–5) × öncelik katsayısı
--   (Düşük .8 / Normal 1 / Yüksek 1.25 / Kritik 1.5) × zamanlılık (zamanında 1, geç .75)
--   × kalite (1 − .15 × o görevdeki revizyon sayısı, en az .5) ÷ görevdeki sorumlu sayısı
-- ----------------------------------------------------------------------------
create or replace function public.analytics(
  p_from date default null, p_to date default null,
  p_project_id uuid default null, p_department_id uuid default null
) returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_from date := coalesce(p_from, private.today() - 89);
  v_to date := coalesce(p_to, private.today());
  v_today date := private.today();
  v_admin boolean := private.is_admin();
  v_depts uuid[];
  v jsonb;
begin
  if not private.is_manager() then
    raise exception 'Analitik ekranı yalnızca yöneticiler ve departman sorumluları içindir.' using errcode = '42501';
  end if;
  if v_to < v_from then raise exception 'Bitiş tarihi başlangıç tarihinden önce olamaz.'; end if;
  if v_to - v_from > 731 then raise exception 'Tarih aralığı en fazla 2 yıl olabilir.'; end if;

  if v_admin then
    v_depts := case when p_department_id is null then null else array[p_department_id] end;
  else
    select array_agg(d.id) into v_depts from public.departments d where d.lead_id = auth.uid();
    if p_department_id is not null then
      if not (p_department_id = any (v_depts)) then
        raise exception 'Bu departmanın verilerini görme yetkiniz yok.' using errcode = '42501';
      end if;
      v_depts := array[p_department_id];
    end if;
  end if;

  with base as (
    select t.*,
      case when t.status in ('COMPLETED', 'APPROVED') then
        (coalesce(t.completed_at,
                  (select max(r.reviewed_at) from public.reports r where r.task_id = t.id and r.status = 'APPROVED'),
                  t.updated_at) at time zone 'Europe/Istanbul')::date
      end as done_on,
      greatest((select count(*) from public.task_assignees a where a.task_id = t.id), 1) as n_assignees,
      case t.priority when 'LOW' then 0.8 when 'NORMAL' then 1.0 when 'HIGH' then 1.25 else 1.5 end as pw
    from public.tasks t
    where (v_depts is null or t.department_id = any (v_depts))
      and (p_project_id is null or t.project_id = p_project_id)
  ), scope as (
    select * from base where due_date between v_from and v_to
  ), rv as (
    select v.status, r.task_id, r.uploaded_by
      from public.report_versions v join public.reports r on r.id = v.report_id
      join scope s on s.id = r.task_id
  ), per_member as (
    select a.user_id,
      count(*) filter (where s.done_on is not null) as completed,
      count(*) filter (where s.done_on is not null and s.done_on <= s.due_date) as on_time,
      coalesce(sum(case when s.done_on is not null then
          s.difficulty * s.pw
          * (case when s.done_on <= s.due_date then 1.0 else 0.75 end)
          * greatest(0.5, 1 - 0.15 * (select count(*) from rv where rv.task_id = s.id and rv.uploaded_by = a.user_id
                                        and rv.status in ('REVISION_REQUESTED', 'REJECTED')))
          / s.n_assignees
        else 0 end), 0) as score,
      (select count(*) from rv where rv.uploaded_by = a.user_id and rv.status in ('REVISION_REQUESTED', 'REJECTED')) as revisions
    from scope s join public.task_assignees a on a.task_id = s.id
    group by a.user_id
  ), load as (
    select a.user_id, count(*) as open_tasks, sum(b.difficulty * b.pw) as weighted_load,
           count(*) filter (where b.status = 'OVERDUE' or b.due_date < v_today) as overdue_open
      from base b join public.task_assignees a on a.task_id = b.id
     where b.status not in ('COMPLETED', 'APPROVED', 'CANCELLED')
     group by a.user_id
  )
  select jsonb_build_object(
    'range', jsonb_build_object('from', v_from, 'to', v_to),
    'scope', case when v_admin then 'all' else 'lead' end,
    'summary', (
      select jsonb_build_object(
        'total', count(*) filter (where status <> 'CANCELLED'),
        'completed', count(*) filter (where done_on is not null),
        'on_time', count(*) filter (where done_on is not null and done_on <= due_date),
        'overdue', count(*) filter (where status not in ('COMPLETED', 'APPROVED', 'CANCELLED')
                                    and (status = 'OVERDUE' or due_date < v_today)),
        'blocked', count(*) filter (where status = 'BLOCKED'),
        'cancelled', count(*) filter (where status = 'CANCELLED'),
        'avg_completion_days', round(avg(done_on - start_date) filter (where done_on is not null), 1),
        'reviewed_versions', (select count(*) from rv where status in ('APPROVED', 'REVISION_REQUESTED', 'REJECTED')),
        'revision_versions', (select count(*) from rv where status in ('REVISION_REQUESTED', 'REJECTED'))
      ) from scope),
    'departments', coalesce((
      select jsonb_agg(x order by x ->> 'name') from (
        select jsonb_build_object(
          'id', d.id, 'name', d.name,
          'total', count(s.id) filter (where s.status <> 'CANCELLED'),
          'completed', count(s.id) filter (where s.done_on is not null),
          'on_time', count(s.id) filter (where s.done_on is not null and s.done_on <= s.due_date),
          'overdue', count(s.id) filter (where s.status not in ('COMPLETED', 'APPROVED', 'CANCELLED')
                                          and (s.status = 'OVERDUE' or s.due_date < v_today)),
          'open', (select count(*) from base b where b.department_id = d.id
                     and b.status not in ('COMPLETED', 'APPROVED', 'CANCELLED'))
        ) as x
        from public.departments d left join scope s on s.department_id = d.id
        where d.is_active and (v_depts is null or d.id = any (v_depts))
        group by d.id, d.name) q), '[]'::jsonb),
    'members', coalesce((
      select jsonb_agg(x order by (x ->> 'score')::numeric desc, (x ->> 'weighted_load')::numeric desc) from (
        select jsonb_build_object(
          'user_id', p.id, 'name', btrim(p.first_name || ' ' || p.last_name),
          'department_id', p.department_id,
          'completed', coalesce(m.completed, 0), 'on_time', coalesce(m.on_time, 0),
          'revisions', coalesce(m.revisions, 0), 'score', round(coalesce(m.score, 0)::numeric, 1),
          'open_tasks', coalesce(l.open_tasks, 0), 'overdue_open', coalesce(l.overdue_open, 0),
          'weighted_load', round(coalesce(l.weighted_load, 0)::numeric, 1)
        ) as x
        from public.profiles p
        left join per_member m on m.user_id = p.id
        left join load l on l.user_id = p.id
        where p.is_active and (m.user_id is not null or l.user_id is not null)) q), '[]'::jsonb),
    'weekly', coalesce((
      select jsonb_agg(jsonb_build_object(
               'week', to_char(w.wk, 'YYYY-MM-DD'),
               'created', (select count(*) from base b
                            where (b.created_at at time zone 'Europe/Istanbul')::date >= w.wk
                              and (b.created_at at time zone 'Europe/Istanbul')::date < w.wk + 7),
               'completed', (select count(*) from base b where b.done_on >= w.wk and b.done_on < w.wk + 7),
               'due', (select count(*) from base b where b.due_date >= w.wk and b.due_date < w.wk + 7
                         and b.status <> 'CANCELLED')
             ) order by w.wk)
        from (select generate_series(date_trunc('week', v_from::timestamp), v_to::timestamp, interval '7 days')::date as wk) w
    ), '[]'::jsonb),
    'projects', coalesce((
      select jsonb_agg(to_jsonb(p) order by p.target_date) from (
        select id, code, name, progress, total_tasks, completed_tasks, overdue_tasks, target_date, status
          from public.project_overview
         where (p_project_id is null or id = p_project_id)
           and (v_depts is null or department_id is null or department_id = any (v_depts))
      ) p), '[]'::jsonb)
  ) into v;
  return v;
end;
$$;

-- ----------------------------------------------------------------------------
-- 16. Haftalık operasyon raporu (kural tabanlı; tamamen gerçek veriden)
-- ----------------------------------------------------------------------------
create or replace function public.weekly_report()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v jsonb; v_admin boolean := private.is_admin(); v_today date := private.today();
  v_from date := private.today() - 6; v_depts uuid[];
begin
  if not private.is_manager() then
    raise exception 'Operasyon raporu yalnızca yöneticiler ve departman sorumluları içindir.' using errcode = '42501';
  end if;
  if not v_admin then
    select array_agg(d.id) into v_depts from public.departments d where d.lead_id = auth.uid();
  end if;

  with t as (
    select t.*, d.name as department_name
      from public.tasks t join public.departments d on d.id = t.department_id
     where v_depts is null or t.department_id = any (v_depts)
  )
  select jsonb_build_object(
    'period', jsonb_build_object('from', v_from, 'to', v_today),
    'scope', case when v_admin then 'all' else 'lead' end,
    'created', (select count(*) from t where (created_at at time zone 'Europe/Istanbul')::date >= v_from),
    'completed', coalesce((select jsonb_agg(jsonb_build_object('code', code, 'title', title, 'department', department_name))
                             from t where status in ('COMPLETED', 'APPROVED')
                               and (coalesce(completed_at, updated_at) at time zone 'Europe/Istanbul')::date >= v_from), '[]'::jsonb),
    'overdue', coalesce((select jsonb_agg(jsonb_build_object('code', code, 'title', title, 'department', department_name,
                                                             'due_date', due_date, 'days_late', v_today - due_date) order by due_date)
                           from t where status not in ('COMPLETED', 'APPROVED', 'CANCELLED')
                             and (status = 'OVERDUE' or due_date < v_today)), '[]'::jsonb),
    'blocked', coalesce((select jsonb_agg(jsonb_build_object('code', code, 'title', title, 'department', department_name,
                                                             'reason', blocked_reason))
                           from t where status = 'BLOCKED'), '[]'::jsonb),
    'upcoming', coalesce((select jsonb_agg(jsonb_build_object('code', code, 'title', title, 'department', department_name,
                                                              'due_date', due_date, 'progress', progress) order by due_date)
                            from t where status not in ('COMPLETED', 'APPROVED', 'CANCELLED')
                              and due_date between v_today and v_today + 7), '[]'::jsonb),
    'risks', coalesce((select jsonb_agg(jsonb_build_object('code', r.code, 'title', r.title, 'score', r.score,
                                                           'status', r.status, 'mitigation', left(r.mitigation, 300)) order by r.score desc)
                         from public.risks r where r.status <> 'CLOSED' and r.score >= 12
                           and (v_depts is null or r.department_id is null or r.department_id = any (v_depts))), '[]'::jsonb),
    'pending_reports', (select count(*) from public.reports r join t on t.id = r.task_id where r.status in ('PENDING', 'IN_REVIEW')),
    'pending_documents', (select count(*) from public.documents d where d.status = 'PENDING'
                            and (v_depts is null or d.department_id = any (v_depts))),
    'projects', coalesce((select jsonb_agg(jsonb_build_object('code', code, 'name', name, 'progress', progress,
                                                              'target_date', target_date, 'overdue', overdue_tasks) order by target_date)
                            from public.project_overview where status = 'ACTIVE'
                              and (v_depts is null or department_id is null or department_id = any (v_depts))), '[]'::jsonb)
  ) into v;
  return v;
end;
$$;

-- ----------------------------------------------------------------------------
-- 17. Global arama (sonuçlar yetkiye göre süzülür)
-- ----------------------------------------------------------------------------
create or replace function public.global_search(p_query text)
returns table (kind text, id uuid, title text, subtitle text, link text)
language plpgsql stable security definer set search_path = '' as $$
declare v_q text := btrim(coalesce(p_query, '')); v_like text;
begin
  if not private.is_active_user() then
    raise exception 'Yetkisiz işlem.' using errcode = '42501';
  end if;
  if char_length(v_q) < 2 then return; end if;
  v_like := '%' || replace(replace(replace(left(v_q, 80), '\', '\\'), '%', '\%'), '_', '\_') || '%';

  return query
  (select 'task'::text, t.id, t.code || ' — ' || t.title, d.name || ' · ' || private.task_status_label(t.status), '/gorevler/' || t.id
     from public.tasks t join public.departments d on d.id = t.department_id
    where (t.code ilike v_like or t.title ilike v_like) and private.can_view_task(t.id)
    order by t.updated_at desc limit 8)
  union all
  (select 'project'::text, p.id, p.code || ' — ' || p.name, 'Proje', '/projeler/' || p.id
     from public.projects p where p.code ilike v_like or p.name ilike v_like
    order by p.updated_at desc limit 5)
  union all
  (select 'member'::text, p.id, btrim(p.first_name || ' ' || p.last_name),
          coalesce(nullif(p.title, ''), coalesce(d.name, 'Ekip üyesi')), '/ekip/' || p.id
     from public.profiles p left join public.departments d on d.id = p.department_id
    where p.is_active and ((p.first_name || ' ' || p.last_name) ilike v_like or p.title ilike v_like
                           or exists (select 1 from unnest(p.skills) s where s ilike v_like))
    order by p.first_name limit 6)
  union all
  (select 'department'::text, d.id, d.name, d.code || ' departmanı', '/departmanlar/' || d.id
     from public.departments d where d.is_active and (d.name ilike v_like or d.code ilike v_like) limit 4)
  union all
  (select 'report'::text, r.id, r.title, t.code || ' raporu', '/raporlar/' || r.id
     from public.reports r join public.tasks t on t.id = r.task_id
    where r.title ilike v_like and private.can_view_report(r.id)
    order by r.updated_at desc limit 5)
  union all
  (select 'document'::text, d.id, d.code || ' — ' || d.title, 'Doküman', '/dokumanlar/' || d.id
     from public.documents d
    where (d.code ilike v_like or d.title ilike v_like or d.description ilike v_like) and private.can_view_document(d.id)
    order by d.updated_at desc limit 6)
  union all
  (select 'risk'::text, r.id, r.code || ' — ' || r.title, 'Risk · puan ' || r.score, '/riskler/' || r.id
     from public.risks r where r.code ilike v_like or r.title ilike v_like
    order by r.score desc limit 5);
end;
$$;

-- ----------------------------------------------------------------------------
-- 18. pg_cron ile günlük teslim tarihi kontrolü (eklenti varsa)
-- ----------------------------------------------------------------------------
do $$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    create extension if not exists pg_cron;
    if exists (select 1 from cron.job where jobname = 'akana-deadlines') then
      perform cron.unschedule('akana-deadlines');
    end if;
    perform cron.schedule('akana-deadlines', '0 5 * * *', 'select public.process_deadlines()');
  end if;
exception when others then
  raise notice 'pg_cron zamanlaması kurulamadı (%). README''deki komutla elle kurun.', sqlerrm;
end $$;

-- =============================================================================
-- 19. Yetkiler ve RLS
-- =============================================================================
revoke execute on all functions in schema private from public, anon;
grant execute on function
  private.try_uuid(text), private.is_dept_lead(uuid), private.is_any_lead(), private.is_manager(),
  private.can_manage_department(uuid), private.can_manage_task(uuid),
  private.can_view_document(uuid), private.can_edit_document(uuid),
  private.can_upload_document_object(text), private.can_view_task(uuid), private.can_view_report(uuid),
  private.can_read_object(text), private.canonical_mime(text), private.task_status_label(public.task_status)
to authenticated, service_role;

revoke execute on all functions in schema public from public, anon;
grant execute on function
  public.update_own_profile(text, text),
  public.update_own_profile_details(text, text, text[], text),
  public.create_task(text, text, uuid, date, date, public.task_priority, text[], text, uuid[], uuid, uuid, integer),
  public.set_task_assignees(uuid, uuid[]),
  public.start_task(uuid),
  public.submit_report(uuid, text, text, text, jsonb),
  public.review_report(uuid, text, text),
  public.process_deadlines(),
  public.set_max_file_size_mb(integer),
  public.department_stats(),
  public.dashboard_stats(),
  public.update_task_progress(uuid, integer),
  public.set_task_blocked(uuid, boolean, text),
  public.add_task_dependency(uuid, uuid),
  public.remove_task_dependency(uuid, uuid),
  public.task_dependency_info(uuid),
  public.task_history(uuid),
  public.create_document(text, text, public.document_category, uuid, uuid, uuid, boolean),
  public.add_document_version(uuid, text, text, text, text),
  public.review_document(uuid, text, text),
  public.delete_document(uuid),
  public.activity_feed(uuid, integer),
  public.mission_overview(),
  public.analytics(date, date, uuid, uuid),
  public.weekly_report(),
  public.global_search(text)
to authenticated, service_role;

-- Supabase yeni tablolara varsayılan olarak anon/authenticated için TÜM yetkileri
-- verir. Önce hepsi geri alınır, ardından yalnızca gereken sütunlar açılır
-- (aksi halde ör. documents.status doğrudan güncellenip onay atlanabilirdi).
revoke all on public.projects, public.project_overview, public.task_dependencies, public.task_comments,
              public.documents, public.document_versions, public.events, public.risks,
              public.notification_preferences
  from anon, authenticated;
revoke all on sequence public.project_code_seq, public.document_code_seq, public.risk_code_seq from anon, authenticated;

-- Tablo yetkileri
grant select on public.projects, public.project_overview, public.task_dependencies, public.task_comments,
                public.documents, public.document_versions, public.events, public.risks,
                public.notification_preferences, public.directory
  to authenticated;
grant insert (name, description, owner_id, department_id, start_date, target_date, status),
      update (name, description, owner_id, department_id, start_date, target_date, status)
  on public.projects to authenticated;
grant delete on public.projects to authenticated;
grant update (project_id, parent_id, difficulty) on public.tasks to authenticated;   -- RLS: yönetici / departman sorumlusu
grant update (title, team_position, university, major) on public.profiles to authenticated; -- RLS: yalnızca yönetici
grant insert (task_id, body), update (body), delete on public.task_comments to authenticated;
grant update (title, description, category, department_id, project_id, task_id, is_restricted) on public.documents to authenticated;
grant insert (title, description, type, starts_at, ends_at, all_day, location, department_id, project_id),
      update (title, description, type, starts_at, ends_at, all_day, location, department_id, project_id),
      delete on public.events to authenticated;
grant insert (title, description, project_id, department_id, owner_id, probability, impact, mitigation, contingency, status, last_reviewed_at),
      update (title, description, project_id, department_id, owner_id, probability, impact, mitigation, contingency, status, last_reviewed_at),
      delete on public.risks to authenticated;
grant insert, update, delete on public.notification_preferences to authenticated;
grant all on public.projects, public.task_dependencies, public.task_comments, public.documents,
             public.document_versions, public.events, public.risks, public.notification_preferences
  to service_role;
grant usage, select on public.project_code_seq, public.document_code_seq, public.risk_code_seq to service_role;

alter table public.projects                 enable row level security;
alter table public.task_dependencies        enable row level security;
alter table public.task_comments            enable row level security;
alter table public.documents                enable row level security;
alter table public.document_versions        enable row level security;
alter table public.events                   enable row level security;
alter table public.risks                    enable row level security;
alter table public.notification_preferences enable row level security;

-- tasks: departman sorumlusu kendi departmanını görür ve yönetir
drop policy if exists tasks_select on public.tasks;
create policy tasks_select on public.tasks for select to authenticated
  using (
    private.is_admin()
    or (private.is_active_user()
        and (department_id = private.my_department_id()
             or private.is_task_assignee(id)
             or private.is_dept_lead(department_id)))
  );
drop policy if exists tasks_update_admin on public.tasks;
drop policy if exists tasks_update_manager on public.tasks;
create policy tasks_update_manager on public.tasks for update to authenticated
  using (private.can_manage_department(department_id))
  with check (private.can_manage_department(department_id));
drop policy if exists tasks_delete_admin on public.tasks;
drop policy if exists tasks_delete_manager on public.tasks;
create policy tasks_delete_manager on public.tasks for delete to authenticated
  using (private.can_manage_department(department_id));

-- reports: departman sorumlusu kendi departmanının raporlarını görür
drop policy if exists reports_select on public.reports;
create policy reports_select on public.reports for select to authenticated
  using (
    private.is_admin()
    or (private.is_active_user() and (uploaded_by = (select auth.uid()) or private.can_manage_task(task_id)))
  );

-- projects: herkes görür; yönetici oluşturur/siler; proje sorumlusu günceller
create policy projects_select on public.projects for select to authenticated
  using (private.is_active_user());
create policy projects_insert on public.projects for insert to authenticated
  with check (private.is_admin());
create policy projects_update on public.projects for update to authenticated
  using (private.is_admin() or (private.is_active_user() and owner_id = (select auth.uid())))
  with check (private.is_admin() or (private.is_active_user() and owner_id = (select auth.uid())));
create policy projects_delete on public.projects for delete to authenticated
  using (private.is_admin());

-- task_dependencies: görünen görevlerin bağımlılıkları; yazma yalnızca RPC
create policy task_dependencies_select on public.task_dependencies for select to authenticated
  using (private.can_view_task(task_id) or private.can_view_task(depends_on_id));

-- task_comments
create policy task_comments_select on public.task_comments for select to authenticated
  using (private.can_view_task(task_id));
create policy task_comments_insert on public.task_comments for insert to authenticated
  with check (private.is_active_user() and author_id = (select auth.uid()) and private.can_view_task(task_id));
create policy task_comments_update on public.task_comments for update to authenticated
  using (private.is_active_user() and author_id = (select auth.uid()))
  with check (author_id = (select auth.uid()));
create policy task_comments_delete on public.task_comments for delete to authenticated
  using (private.is_active_user() and (author_id = (select auth.uid()) or private.can_manage_task(task_id)));

-- documents
create policy documents_select on public.documents for select to authenticated
  using (private.can_view_document(id));
create policy documents_update on public.documents for update to authenticated
  using (private.can_edit_document(id)) with check (private.is_active_user());
create policy document_versions_select on public.document_versions for select to authenticated
  using (private.can_view_document(document_id));

-- events: herkes görür; yönetici ve departman sorumluları yönetir
create policy events_select on public.events for select to authenticated
  using (private.is_active_user());
create policy events_insert on public.events for insert to authenticated
  with check (private.is_manager() and (department_id is null or private.can_manage_department(department_id)));
create policy events_update on public.events for update to authenticated
  using (private.is_admin() or (private.is_active_user() and created_by = (select auth.uid()))
         or private.is_dept_lead(department_id))
  with check (private.is_manager() and (department_id is null or private.can_manage_department(department_id)
                                        or created_by = (select auth.uid())));
create policy events_delete on public.events for delete to authenticated
  using (private.is_admin() or (private.is_active_user() and created_by = (select auth.uid()))
         or private.is_dept_lead(department_id));

-- risks: herkes görür ve risk bildirebilir; sahibi, oluşturan, sorumlu veya yönetici günceller
create policy risks_select on public.risks for select to authenticated
  using (private.is_active_user());
create policy risks_insert on public.risks for insert to authenticated
  with check (private.is_active_user());
create policy risks_update on public.risks for update to authenticated
  using (private.is_admin()
         or (private.is_active_user() and (created_by = (select auth.uid()) or owner_id = (select auth.uid())))
         or private.is_dept_lead(department_id))
  with check (private.is_active_user());
create policy risks_delete on public.risks for delete to authenticated
  using (private.is_admin());

-- notification_preferences: yalnızca sahibi
create policy notification_preferences_all on public.notification_preferences for all to authenticated
  using (user_id = (select auth.uid()) and private.is_active_user())
  with check (user_id = (select auth.uid()) and private.is_active_user());
