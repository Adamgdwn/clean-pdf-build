do $$
begin
  if not exists (select 1 from pg_type where typname = 'feedback_request_type') then
    create type public.feedback_request_type as enum ('bug_report', 'feature_request');
  end if;
end $$;

create table if not exists public.feedback_requests (
  id uuid primary key default gen_random_uuid(),
  feedback_type public.feedback_request_type not null,
  title text not null,
  details text not null,
  requester_email text not null,
  requester_user_id uuid references public.profiles(id) on delete set null,
  source text not null default 'web_app',
  requested_path text,
  status text not null default 'new',
  created_at timestamptz not null default timezone('utc', now())
);

alter table public.feedback_requests enable row level security;

drop policy if exists "requesters can read feedback requests" on public.feedback_requests;
create policy "requesters can read feedback requests"
on public.feedback_requests
for select
to authenticated
using (requester_user_id = auth.uid());
