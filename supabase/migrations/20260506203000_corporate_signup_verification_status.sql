alter table public.organizations
  add column if not exists status text not null default 'active';

alter table public.organizations
  drop constraint if exists organizations_status_check;

alter table public.organizations
  add constraint organizations_status_check
  check (status in ('pending_verification', 'active', 'payment_required', 'suspended', 'closing', 'closed'));
