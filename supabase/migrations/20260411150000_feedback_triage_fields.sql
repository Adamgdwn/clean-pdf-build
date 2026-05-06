do $$
begin
  if not exists (select 1 from pg_type where typname = 'feedback_request_status') then
    create type public.feedback_request_status as enum ('new', 'acknowledged', 'planned', 'in_progress', 'closed');
  end if;

  if not exists (select 1 from pg_type where typname = 'feedback_request_priority') then
    create type public.feedback_request_priority as enum ('low', 'medium', 'high');
  end if;
end $$;

alter table public.feedback_requests
  alter column status drop default;

alter table public.feedback_requests
  alter column status type public.feedback_request_status
  using status::public.feedback_request_status;

alter table public.feedback_requests
  alter column status set default 'new'::public.feedback_request_status,
  add column if not exists priority public.feedback_request_priority not null default 'medium',
  add column if not exists owner_user_id uuid references auth.users(id) on delete set null,
  add column if not exists updated_by_user_id uuid references auth.users(id) on delete set null,
  add column if not exists resolution_note text,
  add column if not exists resolved_at timestamptz,
  add column if not exists updated_at timestamptz not null default timezone('utc', now());

create index if not exists feedback_requests_status_idx on public.feedback_requests(status);
create index if not exists feedback_requests_owner_user_id_idx on public.feedback_requests(owner_user_id);
create index if not exists feedback_requests_created_at_idx on public.feedback_requests(created_at desc);

drop trigger if exists set_feedback_requests_updated_at on public.feedback_requests;
create trigger set_feedback_requests_updated_at
before update on public.feedback_requests
for each row
execute function public.set_updated_at();
