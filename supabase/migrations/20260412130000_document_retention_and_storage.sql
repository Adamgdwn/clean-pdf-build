alter table public.documents
  add column if not exists retention_mode text not null default 'temporary',
  add column if not exists retention_days integer not null default 30,
  add column if not exists purge_scheduled_at timestamptz,
  add column if not exists purged_at timestamptz,
  add column if not exists purged_by_user_id uuid references public.profiles(id) on delete set null,
  add column if not exists purge_reason text,
  add column if not exists source_storage_bytes bigint not null default 0,
  add column if not exists export_storage_bytes bigint not null default 0;
do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'documents_retention_mode_check'
  ) then
    alter table public.documents
      add constraint documents_retention_mode_check
      check (retention_mode in ('temporary', 'retained'));
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'documents_retention_days_check'
  ) then
    alter table public.documents
      add constraint documents_retention_days_check
      check (retention_days > 0);
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'documents_source_storage_bytes_check'
  ) then
    alter table public.documents
      add constraint documents_source_storage_bytes_check
      check (source_storage_bytes >= 0);
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'documents_export_storage_bytes_check'
  ) then
    alter table public.documents
      add constraint documents_export_storage_bytes_check
      check (export_storage_bytes >= 0);
  end if;
end $$;
create index if not exists documents_purge_scheduled_at_idx
on public.documents (purge_scheduled_at);
update public.documents
set source_storage_bytes = coalesce(
  (
    select nullif(storage.objects.metadata->>'size', '')::bigint
    from storage.objects
    where storage.objects.bucket_id = 'documents'
      and storage.objects.name = public.documents.storage_path
    limit 1
  ),
  0
);
update public.documents
set export_storage_bytes = coalesce(
  (
    select nullif(storage.objects.metadata->>'size', '')::bigint
    from storage.objects
    where storage.objects.bucket_id = 'documents'
      and storage.objects.name = public.documents.uploaded_by_user_id::text || '/' || public.documents.id::text || '/exports/latest.pdf'
    limit 1
  ),
  0
);
update public.documents
set purge_scheduled_at = completed_at + interval '7 days'
where retention_mode = 'temporary'
  and completed_at is not null
  and purge_scheduled_at is null
  and deleted_at is null
  and purged_at is null;
