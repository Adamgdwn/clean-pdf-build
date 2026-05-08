do $$
begin
  if not exists (select 1 from pg_type where typname = 'digital_signature_profile_status') then
    create type public.digital_signature_profile_status as enum (
      'setup_required',
      'requested',
      'verified',
      'rejected'
    );
  end if;

  if not exists (select 1 from pg_type where typname = 'digital_signature_provider') then
    create type public.digital_signature_provider as enum (
      'easy_draft_remote',
      'qualified_remote',
      'organization_hsm'
    );
  end if;
end $$;
alter table public.documents
  add column if not exists editor_history_index integer not null default 0,
  add column if not exists deleted_at timestamptz,
  add column if not exists deleted_by_user_id uuid references public.profiles(id) on delete set null;
create table if not exists public.document_editor_snapshots (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null references public.documents(id) on delete cascade,
  history_index integer not null check (history_index >= 0),
  action_key text not null,
  label text not null,
  fields jsonb not null default '[]'::jsonb,
  created_by_user_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default timezone('utc', now()),
  unique (document_id, history_index)
);
create table if not exists public.digital_signature_profiles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  label text not null,
  title_text text,
  provider public.digital_signature_provider not null default 'easy_draft_remote',
  assurance_level text not null default 'advanced',
  status public.digital_signature_profile_status not null default 'setup_required',
  certificate_fingerprint text,
  provider_reference text,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);
drop trigger if exists set_digital_signature_profiles_updated_at on public.digital_signature_profiles;
create trigger set_digital_signature_profiles_updated_at
before update on public.digital_signature_profiles
for each row
execute function public.set_updated_at();
alter table public.document_editor_snapshots enable row level security;
alter table public.digital_signature_profiles enable row level security;
create policy "collaborators can read editor snapshots"
on public.document_editor_snapshots
for select
to authenticated
using (public.is_document_collaborator(document_id));
create policy "users can read their digital signature profiles"
on public.digital_signature_profiles
for select
to authenticated
using (user_id = auth.uid());
create policy "users can insert their digital signature profiles"
on public.digital_signature_profiles
for insert
to authenticated
with check (user_id = auth.uid());
create policy "users can update their digital signature profiles"
on public.digital_signature_profiles
for update
to authenticated
using (user_id = auth.uid())
with check (user_id = auth.uid());
