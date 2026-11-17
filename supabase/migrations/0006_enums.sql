-- =============================================================================
-- AKANA MISSION CONTROL — 0006: Yeni enum değerleri ve tipler
-- Not: ALTER TYPE ... ADD VALUE ile eklenen değer, eklendiği transaction
-- içinde kullanılamaz. `supabase db push` her dosyayı ayrı transaction'da
-- çalıştırdığı için yeni değerleri kullanan her şey 0007'dedir.
-- Mevcut değerler korunur; hiçbir satır değiştirilmez.
-- =============================================================================

-- Görev durumları: bloke ve iptal
alter type public.task_status add value if not exists 'BLOCKED';
alter type public.task_status add value if not exists 'CANCELLED';

-- Bildirim türleri
alter type public.notification_type add value if not exists 'TASK_UPDATED';
alter type public.notification_type add value if not exists 'TASK_COMMENT';
alter type public.notification_type add value if not exists 'RISK_CREATED';
alter type public.notification_type add value if not exists 'DOCUMENT_UPLOADED';
alter type public.notification_type add value if not exists 'DOCUMENT_APPROVED';
alter type public.notification_type add value if not exists 'DOCUMENT_REVISION_REQUESTED';

-- Takım içi pozisyon (organizasyon şeması). Yetki rolü (user_role) ayrıdır.
do $$ begin
  create type public.team_position as enum ('CAPTAIN', 'VICE_CAPTAIN', 'LEAD', 'MEMBER');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.project_status as enum ('PLANNING', 'ACTIVE', 'ON_HOLD', 'COMPLETED', 'CANCELLED');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.risk_status as enum ('OPEN', 'MITIGATING', 'MONITORING', 'CLOSED');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.document_status as enum ('DRAFT', 'PENDING', 'APPROVED', 'REVISION_REQUESTED');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.document_category as enum (
    'REPORT', 'DESIGN', 'ANALYSIS', 'TEST', 'CAD', 'PROCEDURE', 'MEETING', 'OTHER');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.event_type as enum ('MEETING', 'WORKSHOP', 'MILESTONE', 'TEST', 'OTHER');
exception when duplicate_object then null; end $$;
