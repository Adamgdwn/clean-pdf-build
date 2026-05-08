alter table public.documents
  add column if not exists signature_path integer not null default 1,
  add column if not exists status text not null default 'pending';
alter table public.documents
  drop constraint if exists documents_signature_path_check,
  add constraint documents_signature_path_check
    check (signature_path in (1, 2, 3));
alter table public.documents
  drop constraint if exists documents_status_check,
  add constraint documents_status_check
    check (status in ('pending', 'sent', 'signed', 'rejected', 'archived'));
create index if not exists documents_signature_path_idx
  on public.documents(signature_path);
create index if not exists documents_status_idx
  on public.documents(status);
create table if not exists public.signature_events (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null references public.documents(id) on delete cascade,
  signer_type public.participant_type not null,
  signer_email text,
  signer_user_id uuid references public.profiles(id) on delete set null,
  event_type text not null,
  ip_address text,
  user_agent text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default timezone('utc', now()),
  constraint signature_events_event_type_check
    check (event_type in ('sent', 'viewed', 'signed', 'rejected', 'verified'))
);
create index if not exists signature_events_document_id_idx
  on public.signature_events(document_id, created_at desc);
create index if not exists signature_events_signer_user_id_idx
  on public.signature_events(signer_user_id);
create index if not exists signature_events_signer_email_idx
  on public.signature_events(lower(signer_email));
create table if not exists public.signature_path_config (
  id uuid primary key default gen_random_uuid(),
  org_id uuid references public.organizations(id) on delete cascade,
  path integer not null,
  is_enabled boolean not null default true,
  config jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint signature_path_config_path_check
    check (path in (1, 2, 3))
);
create index if not exists signature_path_config_org_id_idx
  on public.signature_path_config(org_id);
create unique index if not exists signature_path_config_org_path_key
  on public.signature_path_config(org_id, path);
drop trigger if exists set_signature_path_config_updated_at on public.signature_path_config;
create trigger set_signature_path_config_updated_at
before update on public.signature_path_config
for each row
execute function public.set_updated_at();
alter table public.signature_events enable row level security;
alter table public.signature_path_config enable row level security;
create policy "collaborators can read signature events"
on public.signature_events
for select
to authenticated
using (public.is_document_collaborator(document_id));
create policy "members can read signature path config"
on public.signature_path_config
for select
to authenticated
using (
  org_id is not null
  and public.is_organization_member(org_id)
);
