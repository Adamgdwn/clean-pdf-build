create extension if not exists pgcrypto;

do $$
begin
  if not exists (select 1 from pg_type where typname = 'access_role') then
    create type public.access_role as enum ('owner', 'editor', 'signer', 'viewer');
  end if;

  if not exists (select 1 from pg_type where typname = 'routing_strategy') then
    create type public.routing_strategy as enum ('sequential', 'parallel');
  end if;

  if not exists (select 1 from pg_type where typname = 'field_kind') then
    create type public.field_kind as enum ('text', 'image', 'signature', 'initial', 'date', 'checkbox');
  end if;

  if not exists (select 1 from pg_type where typname = 'field_source') then
    create type public.field_source as enum ('manual', 'auto_detected');
  end if;

  if not exists (select 1 from pg_type where typname = 'processing_job_type') then
    create type public.processing_job_type as enum ('ocr', 'field_detection');
  end if;

  if not exists (select 1 from pg_type where typname = 'processing_job_status') then
    create type public.processing_job_status as enum ('queued', 'running', 'completed', 'failed');
  end if;
end $$;

create table if not exists public.documents (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  file_name text not null,
  storage_path text not null unique,
  page_count integer,
  uploaded_at timestamptz not null default timezone('utc', now()),
  uploaded_by_user_id uuid not null references auth.users(id) on delete cascade,
  prepared_at timestamptz,
  sent_at timestamptz,
  completed_at timestamptz,
  reopened_at timestamptz,
  reopened_by_user_id uuid references auth.users(id) on delete set null,
  locked_at timestamptz,
  locked_by_user_id uuid references auth.users(id) on delete set null,
  routing_strategy public.routing_strategy not null default 'sequential',
  is_scanned boolean not null default false,
  is_ocr_complete boolean not null default false,
  is_field_detection_complete boolean not null default false,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.document_access (
  document_id uuid not null references public.documents(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role public.access_role not null,
  created_at timestamptz not null default timezone('utc', now()),
  primary key (document_id, user_id)
);

create table if not exists public.document_invites (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null references public.documents(id) on delete cascade,
  email text not null,
  role public.access_role not null,
  invited_by_user_id uuid not null references auth.users(id) on delete cascade,
  accepted_at timestamptz,
  created_at timestamptz not null default timezone('utc', now()),
  unique (document_id, email, role)
);

create table if not exists public.document_signers (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null references public.documents(id) on delete cascade,
  user_id uuid references auth.users(id) on delete set null,
  name text not null,
  email text not null,
  required boolean not null default true,
  signing_order integer,
  created_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.document_fields (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null references public.documents(id) on delete cascade,
  page integer not null check (page > 0),
  kind public.field_kind not null,
  label text not null,
  required boolean not null default false,
  assignee_signer_id uuid references public.document_signers(id) on delete set null,
  source public.field_source not null default 'manual',
  x numeric not null default 120,
  y numeric not null default 540,
  width numeric not null default 180,
  height numeric not null default 40,
  value text,
  completed_at timestamptz,
  completed_by_signer_id uuid references public.document_signers(id) on delete set null,
  created_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.document_versions (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null references public.documents(id) on delete cascade,
  label text not null,
  created_at timestamptz not null default timezone('utc', now()),
  created_by_user_id uuid not null references auth.users(id) on delete cascade,
  note text not null
);

create table if not exists public.document_audit_events (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null references public.documents(id) on delete cascade,
  type text not null,
  created_at timestamptz not null default timezone('utc', now()),
  actor_user_id text not null,
  summary text not null,
  metadata jsonb not null default '{}'::jsonb
);

create table if not exists public.document_processing_jobs (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null references public.documents(id) on delete cascade,
  requested_by_user_id uuid not null references auth.users(id) on delete cascade,
  type public.processing_job_type not null,
  status public.processing_job_status not null default 'queued',
  provider text not null default 'pending',
  confidence numeric,
  result jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default timezone('utc', now()),
  started_at timestamptz,
  completed_at timestamptz
);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = timezone('utc', now());
  return new;
end;
$$;

drop trigger if exists set_documents_updated_at on public.documents;
create trigger set_documents_updated_at
before update on public.documents
for each row
execute function public.set_updated_at();

create or replace function public.is_document_collaborator(target_document_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.document_access access_entry
    where access_entry.document_id = target_document_id
      and access_entry.user_id = auth.uid()
  );
$$;

create or replace function public.document_role(target_document_id uuid)
returns public.access_role
language sql
stable
security definer
set search_path = public
as $$
  select access_entry.role
  from public.document_access access_entry
  where access_entry.document_id = target_document_id
    and access_entry.user_id = auth.uid()
  limit 1;
$$;

alter table public.documents enable row level security;
alter table public.document_access enable row level security;
alter table public.document_invites enable row level security;
alter table public.document_signers enable row level security;
alter table public.document_fields enable row level security;
alter table public.document_versions enable row level security;
alter table public.document_audit_events enable row level security;
alter table public.document_processing_jobs enable row level security;

create policy "collaborators can read documents"
on public.documents
for select
to authenticated
using (public.is_document_collaborator(id));

create policy "collaborators can read access"
on public.document_access
for select
to authenticated
using (public.is_document_collaborator(document_id));

create policy "collaborators can read invites"
on public.document_invites
for select
to authenticated
using (public.is_document_collaborator(document_id));

create policy "collaborators can read signers"
on public.document_signers
for select
to authenticated
using (public.is_document_collaborator(document_id));

create policy "collaborators can read fields"
on public.document_fields
for select
to authenticated
using (public.is_document_collaborator(document_id));

create policy "collaborators can read versions"
on public.document_versions
for select
to authenticated
using (public.is_document_collaborator(document_id));

create policy "collaborators can read audit events"
on public.document_audit_events
for select
to authenticated
using (public.is_document_collaborator(document_id));

create policy "collaborators can read processing jobs"
on public.document_processing_jobs
for select
to authenticated
using (public.is_document_collaborator(document_id));

insert into storage.buckets (id, name, public)
values ('documents', 'documents', false)
on conflict (id) do nothing;

create policy "authenticated users can upload to their own folder"
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'documents'
  and (storage.foldername(name))[1] = auth.uid()::text
);
