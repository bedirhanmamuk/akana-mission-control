-- =============================================================================
-- AKANA MISSION CONTROL — 0004: Storage (özel bucket + erişim politikaları)
-- Nesne yolu:  <task_id>/<user_id>/<yükleme_uuid>/<dosya_adı>
-- =============================================================================

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'reports', 'reports', false, 25 * 1024 * 1024,
  array[
    'application/pdf',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.ms-powerpoint',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    'text/csv',
    'application/zip',
    'image/png',
    'image/jpeg'
  ]
)
on conflict (id) do update
  set public = false,
      allowed_mime_types = excluded.allowed_mime_types;

-- Yükleme yetkisi: yol çağıranın kendi klasörü olmalı ve görev ona atanmış olmalı
create or replace function private.can_upload_object(p_name text)
returns boolean language plpgsql stable security definer set search_path = '' as $$
declare v_parts text[] := string_to_array(p_name, '/'); v_task uuid;
begin
  if cardinality(v_parts) <> 4 then return false; end if;
  if v_parts[2] <> auth.uid()::text then return false; end if;
  if private.canonical_mime(substring(v_parts[4] from '\.([A-Za-z0-9]+)$')) is null then
    return false;
  end if;
  begin
    v_task := v_parts[1]::uuid;
  exception when others then
    return false;
  end;
  return private.is_task_assignee(v_task)
     and exists (select 1 from public.tasks t where t.id = v_task and t.status <> 'COMPLETED');
end;
$$;

-- Okuma yetkisi: yönetici tüm raporları, üye yalnızca kendi klasörünü
create or replace function private.can_read_object(p_name text)
returns boolean language sql stable security definer set search_path = '' as $$
  select private.is_admin()
      or (private.is_active_user() and split_part(p_name, '/', 2) = auth.uid()::text);
$$;

-- Silme yetkisi: yalnızca henüz bir rapor sürümüne bağlanmamış (yarım kalan
-- yüklemeden artan) kendi dosyaları. Kayıtlı rapor dosyaları silinemez.
create or replace function private.can_delete_object(p_name text)
returns boolean language sql stable security definer set search_path = '' as $$
  select private.is_active_user()
     and split_part(p_name, '/', 2) = auth.uid()::text
     and not exists (select 1 from public.report_files rf where rf.storage_path = p_name);
$$;

revoke execute on function private.can_upload_object(text), private.can_read_object(text),
                           private.can_delete_object(text) from public, anon;
grant execute on function private.can_upload_object(text), private.can_read_object(text),
                          private.can_delete_object(text) to authenticated, service_role;

drop policy if exists reports_objects_insert on storage.objects;
drop policy if exists reports_objects_select on storage.objects;
drop policy if exists reports_objects_delete on storage.objects;

create policy reports_objects_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'reports' and private.can_upload_object(name));

create policy reports_objects_select on storage.objects for select to authenticated
  using (bucket_id = 'reports' and private.can_read_object(name));

create policy reports_objects_delete on storage.objects for delete to authenticated
  using (bucket_id = 'reports' and private.can_delete_object(name));

-- update politikası yok: yüklenen dosyaların üzerine yazılamaz.
