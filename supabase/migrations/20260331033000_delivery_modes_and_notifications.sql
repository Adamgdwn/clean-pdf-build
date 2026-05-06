do $$
begin
  if not exists (select 1 from pg_type where typname = 'document_delivery_mode') then
    create type public.document_delivery_mode as enum ('self_managed', 'platform_managed');
  end if;

  if not exists (select 1 from pg_type where typname = 'notification_event_type') then
    create type public.notification_event_type as enum ('signature_request', 'signature_progress');
  end if;

  if not exists (select 1 from pg_type where typname = 'notification_channel') then
    create type public.notification_channel as enum ('email', 'in_app');
  end if;

  if not exists (select 1 from pg_type where typname = 'notification_status') then
    create type public.notification_status as enum ('queued', 'sent', 'failed', 'skipped');
  end if;
end $$;

alter table public.documents
  add column if not exists delivery_mode public.document_delivery_mode not null default 'self_managed',
  add column if not exists distribution_target text,
  add column if not exists notify_originator_on_each_signature boolean not null default true;

create table if not exists public.document_notifications (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null references public.documents(id) on delete cascade,
  event_type public.notification_event_type not null,
  channel public.notification_channel not null default 'email',
  status public.notification_status not null default 'queued',
  recipient_email text not null,
  recipient_user_id uuid references auth.users(id) on delete set null,
  recipient_signer_id uuid references public.document_signers(id) on delete set null,
  provider text not null default 'pending',
  metadata jsonb not null default '{}'::jsonb,
  queued_at timestamptz not null default timezone('utc', now()),
  delivered_at timestamptz
);

alter table public.document_notifications enable row level security;

create policy "collaborators can read notifications"
on public.document_notifications
for select
to authenticated
using (public.is_document_collaborator(document_id));
