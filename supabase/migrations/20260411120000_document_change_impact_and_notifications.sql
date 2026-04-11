do $$
begin
  if not exists (select 1 from pg_type where typname = 'document_change_impact') then
    create type public.document_change_impact as enum ('non_material', 'review_required', 'resign_required');
  end if;

  if exists (select 1 from pg_type where typname = 'notification_event_type') then
    begin
      alter type public.notification_event_type add value if not exists 'workflow_update';
    exception
      when duplicate_object then null;
    end;
  end if;
end $$;

alter table public.documents
  add column if not exists latest_change_impact public.document_change_impact,
  add column if not exists latest_change_impact_summary text,
  add column if not exists latest_change_impact_at timestamptz;

alter table public.document_versions
  add column if not exists change_impact public.document_change_impact,
  add column if not exists change_impact_summary text;
