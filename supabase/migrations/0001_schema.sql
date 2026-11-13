-- =============================================================================
-- AKANA MISSION CONTROL — 0001: Şema (tipler, tablolar, kısıtlar, indeksler)
-- =============================================================================

create extension if not exists pg_trgm with schema extensions;

-- İç yardımcı fonksiyonlar için API'ye açılmayan şema
create schema if not exists private;

-- ----------------------------------------------------------------------------
-- Enum tipleri
-- ----------------------------------------------------------------------------
create type public.user_role as enum ('ADMIN', 'MEMBER');

create type public.task_priority as enum ('LOW', 'NORMAL', 'HIGH', 'CRITICAL');

create type public.task_status as enum (
  'NEW',                 -- Yeni
  'IN_PROGRESS',         -- Devam ediyor
  'AWAITING_REPORT',     -- Rapor bekleniyor
  'IN_REVIEW',           -- İncelemede
  'REVISION_REQUESTED',  -- Revizyon istendi
  'APPROVED',            -- Onaylandı
  'COMPLETED',           -- Tamamlandı
  'OVERDUE'              -- Gecikmiş
);

create type public.report_status as enum (
  'PENDING',             -- İnceleme bekliyor
  'IN_REVIEW',           -- İnceleniyor
  'APPROVED',            -- Onaylandı
  'REVISION_REQUESTED',  -- Revizyon istendi
  'REJECTED'             -- Reddedildi
);

create type public.notification_type as enum (
  'TASK_ASSIGNED',
  'TASK_DUE_SOON',
  'TASK_OVERDUE',
  'TASK_COMPLETED',
  'REPORT_UPLOADED',
  'REPORT_SUBMITTED',     -- yöneticilere: yeni rapor inceleme bekliyor
  'REPORT_IN_REVIEW',
  'REPORT_REVISION_REQUESTED',
  'REPORT_APPROVED',
  'REPORT_REJECTED'
);

-- ----------------------------------------------------------------------------
-- departments
-- ----------------------------------------------------------------------------
create table public.departments (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  code        text not null,           -- görev kodunda kullanılır: AK-<code>-001
  description text not null default '',
  lead_id     uuid,                    -- FK aşağıda (profiles oluşturulduktan sonra)
  is_active   boolean not null default true,
  task_seq    integer not null default 0 check (task_seq >= 0),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  constraint departments_name_len check (char_length(btrim(name)) between 2 and 60),
  constraint departments_code_fmt check (code ~ '^[A-Z]{3}$')
);
create unique index departments_name_key on public.departments (lower(name));
create unique index departments_code_key on public.departments (code);

-- ----------------------------------------------------------------------------
-- profiles (auth.users ile 1-1)
-- ----------------------------------------------------------------------------
create table public.profiles (
  id            uuid primary key references auth.users (id) on delete restrict,
  first_name    text not null default '',
  last_name     text not null default '',
  email         text not null,
  department_id uuid references public.departments (id) on delete set null,
  role          public.user_role not null default 'MEMBER',
  is_active     boolean not null default false,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  constraint profiles_first_name_len check (char_length(first_name) <= 60),
  constraint profiles_last_name_len  check (char_length(last_name) <= 60)
);
create unique index profiles_email_key on public.profiles (lower(email));
create index profiles_department_idx on public.profiles (department_id);
create index profiles_role_idx on public.profiles (role) where is_active;

alter table public.departments
  add constraint departments_lead_fk
  foreign key (lead_id) references public.profiles (id) on delete set null;

-- ----------------------------------------------------------------------------
-- tasks
-- ----------------------------------------------------------------------------
create table public.tasks (
  id                  uuid primary key default gen_random_uuid(),
  code                text not null,   -- tetikleyici tarafından üretilir
  title               text not null,
  description         text not null default '',
  department_id       uuid not null references public.departments (id) on delete restrict,
  start_date          date not null default current_date,
  due_date            date not null,
  priority            public.task_priority not null default 'NORMAL',
  status              public.task_status not null default 'NEW',
  required_file_types text[] not null default '{}',
  notes               text not null default '',
  created_by          uuid references public.profiles (id) on delete set null,
  completed_at        timestamptz,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  constraint tasks_code_key unique (code),
  constraint tasks_title_len check (char_length(btrim(title)) between 3 and 160),
  constraint tasks_description_len check (char_length(description) <= 5000),
  constraint tasks_notes_len check (char_length(notes) <= 2000),
  constraint tasks_dates_chk check (due_date >= start_date)
);
create index tasks_department_idx on public.tasks (department_id);
create index tasks_status_idx on public.tasks (status);
create index tasks_due_date_idx on public.tasks (due_date);
create index tasks_created_at_idx on public.tasks (created_at desc);
create index tasks_title_trgm_idx on public.tasks using gin (title extensions.gin_trgm_ops);

-- ----------------------------------------------------------------------------
-- task_assignees
-- ----------------------------------------------------------------------------
create table public.task_assignees (
  task_id     uuid not null references public.tasks (id) on delete cascade,
  user_id     uuid not null references public.profiles (id) on delete restrict,
  assigned_by uuid references public.profiles (id) on delete set null,
  assigned_at timestamptz not null default now(),
  primary key (task_id, user_id)
);
create index task_assignees_user_idx on public.task_assignees (user_id);

-- ----------------------------------------------------------------------------
-- reports — bir görev için bir üyenin rapor ana kaydı (sürümler ayrı tabloda)
-- ----------------------------------------------------------------------------
create table public.reports (
  id              uuid primary key default gen_random_uuid(),
  task_id         uuid not null references public.tasks (id) on delete restrict,
  uploaded_by     uuid not null references public.profiles (id) on delete restrict,
  title           text not null,
  description     text not null default '',
  status          public.report_status not null default 'PENDING',
  current_version integer not null default 1 check (current_version >= 1),
  review_note     text,
  reviewed_by     uuid references public.profiles (id) on delete set null,
  reviewed_at     timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  constraint reports_task_user_key unique (task_id, uploaded_by),
  constraint reports_title_len check (char_length(btrim(title)) between 3 and 160),
  constraint reports_description_len check (char_length(description) <= 5000)
);
create index reports_uploaded_by_idx on public.reports (uploaded_by);
create index reports_status_idx on public.reports (status);
create index reports_updated_at_idx on public.reports (updated_at desc);
create index reports_title_trgm_idx on public.reports using gin (title extensions.gin_trgm_ops);

-- ----------------------------------------------------------------------------
-- report_versions — her yükleme yeni bir satır; satırlar asla güncellenip
-- üzerine yazılmaz (yalnızca inceleme alanları RPC ile doldurulur)
-- ----------------------------------------------------------------------------
create table public.report_versions (
  id             uuid primary key default gen_random_uuid(),
  report_id      uuid not null references public.reports (id) on delete restrict,
  version_number integer not null check (version_number >= 1),
  note           text not null default '',      -- üyenin sürüm notu
  status         public.report_status not null default 'PENDING',
  review_note    text,
  reviewed_by    uuid references public.profiles (id) on delete set null,
  reviewed_at    timestamptz,
  uploaded_by    uuid not null references public.profiles (id) on delete restrict,
  created_at     timestamptz not null default now(),
  constraint report_versions_number_key unique (report_id, version_number),
  constraint report_versions_note_len check (char_length(note) <= 2000)
);
create index report_versions_created_at_idx on public.report_versions (created_at desc);

-- ----------------------------------------------------------------------------
-- report_files — bir sürüme ait dosyalar (Storage nesnesine işaret eder)
-- ----------------------------------------------------------------------------
create table public.report_files (
  id            uuid primary key default gen_random_uuid(),
  version_id    uuid not null references public.report_versions (id) on delete restrict,
  report_id     uuid not null references public.reports (id) on delete restrict,
  storage_path  text not null,
  original_name text not null,
  extension     text not null,
  mime_type     text not null,
  size_bytes    bigint not null check (size_bytes > 0),
  sha256        text not null check (sha256 ~ '^[0-9a-f]{64}$'),
  created_at    timestamptz not null default now(),
  constraint report_files_path_key unique (storage_path),
  constraint report_files_dup_key unique (report_id, sha256),   -- aynı dosya aynı rapora tekrar yüklenemez
  constraint report_files_name_len check (char_length(original_name) between 1 and 255)
);
create index report_files_version_idx on public.report_files (version_id);
create index report_files_extension_idx on public.report_files (extension);

-- ----------------------------------------------------------------------------
-- notifications
-- ----------------------------------------------------------------------------
create table public.notifications (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references public.profiles (id) on delete cascade,
  type       public.notification_type not null,
  title      text not null,
  body       text not null default '',
  link       text,                    -- uygulama içi yol, örn. /gorevler/<id>
  is_read    boolean not null default false,
  read_at    timestamptz,
  dedupe_key text,                    -- tekrarlı (zamanlanmış) bildirimleri engeller
  created_at timestamptz not null default now(),
  constraint notifications_dedupe_key unique (user_id, dedupe_key)
);
create index notifications_user_idx on public.notifications (user_id, created_at desc);
create index notifications_unread_idx on public.notifications (user_id) where not is_read;

-- ----------------------------------------------------------------------------
-- activity_logs — denetim kaydı (yalnızca ekleme)
-- ----------------------------------------------------------------------------
create table public.activity_logs (
  id          bigint generated always as identity primary key,
  actor_id    uuid references public.profiles (id) on delete set null,
  action      text not null,
  entity_type text not null,
  entity_id   text,
  summary     text not null default '',
  details     jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now()
);
create index activity_logs_created_at_idx on public.activity_logs (created_at desc);
create index activity_logs_actor_idx on public.activity_logs (actor_id);
create index activity_logs_action_idx on public.activity_logs (action);

-- ----------------------------------------------------------------------------
-- app_settings — yönetici tarafından değiştirilebilir sistem ayarları
-- ----------------------------------------------------------------------------
create table public.app_settings (
  key        text primary key,
  value      jsonb not null,
  updated_by uuid references public.profiles (id) on delete set null,
  updated_at timestamptz not null default now()
);
