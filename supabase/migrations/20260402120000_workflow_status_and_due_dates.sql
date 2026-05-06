do $$
begin
  if not exists (select 1 from pg_type where typname = 'workflow_status') then
    create type public.workflow_status as enum (
      'active',
      'changes_requested',
      'rejected',
      'canceled'
    );
  end if;
end $$;

alter table public.documents
  add column if not exists due_at timestamptz,
  add column if not exists workflow_status public.workflow_status not null default 'active',
  add column if not exists workflow_status_reason text,
  add column if not exists workflow_status_updated_at timestamptz,
  add column if not exists workflow_status_updated_by_user_id uuid references auth.users(id) on delete set null;
