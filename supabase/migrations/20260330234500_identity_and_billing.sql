do $$
begin
  if not exists (select 1 from pg_type where typname = 'workspace_type') then
    create type public.workspace_type as enum ('personal', 'team');
  end if;

  if not exists (select 1 from pg_type where typname = 'workspace_role') then
    create type public.workspace_role as enum ('owner', 'admin', 'member', 'billing_admin');
  end if;
end $$;
alter table public.profiles
  add column if not exists avatar_url text,
  add column if not exists company_name text,
  add column if not exists job_title text,
  add column if not exists locale text,
  add column if not exists timezone text,
  add column if not exists marketing_opt_in boolean not null default false,
  add column if not exists product_updates_opt_in boolean not null default true,
  add column if not exists last_seen_at timestamptz;
create table if not exists public.workspaces (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null unique,
  workspace_type public.workspace_type not null default 'personal',
  owner_user_id uuid not null references public.profiles(id) on delete cascade,
  billing_email text,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);
create table if not exists public.workspace_memberships (
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  role public.workspace_role not null,
  created_at timestamptz not null default timezone('utc', now()),
  primary key (workspace_id, user_id)
);
create table if not exists public.billing_plans (
  key text primary key,
  name text not null,
  monthly_price_usd integer not null,
  included_internal_seats integer not null,
  included_completed_docs integer not null,
  included_ocr_pages integer not null,
  included_storage_gb numeric(10,2) not null,
  overage_completed_doc_usd_cents integer not null,
  overage_ocr_page_usd_cents integer not null,
  overage_storage_gb_usd_cents integer not null,
  active boolean not null default true,
  created_at timestamptz not null default timezone('utc', now())
);
insert into public.billing_plans (
  key,
  name,
  monthly_price_usd,
  included_internal_seats,
  included_completed_docs,
  included_ocr_pages,
  included_storage_gb,
  overage_completed_doc_usd_cents,
  overage_ocr_page_usd_cents,
  overage_storage_gb_usd_cents
)
values
  ('starter', 'Starter', 19, 1, 75, 500, 10, 25, 2, 25),
  ('team', 'Team', 79, 5, 500, 5000, 50, 15, 1, 15),
  ('business', 'Business', 249, 20, 2500, 25000, 250, 10, 1, 10)
on conflict (key) do update
set
  name = excluded.name,
  monthly_price_usd = excluded.monthly_price_usd,
  included_internal_seats = excluded.included_internal_seats,
  included_completed_docs = excluded.included_completed_docs,
  included_ocr_pages = excluded.included_ocr_pages,
  included_storage_gb = excluded.included_storage_gb,
  overage_completed_doc_usd_cents = excluded.overage_completed_doc_usd_cents,
  overage_ocr_page_usd_cents = excluded.overage_ocr_page_usd_cents,
  overage_storage_gb_usd_cents = excluded.overage_storage_gb_usd_cents,
  active = true;
create table if not exists public.workspace_billing_customers (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null unique references public.workspaces(id) on delete cascade,
  provider text not null default 'stripe',
  provider_customer_id text unique,
  billing_email text,
  country_code text,
  tax_id text,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);
create table if not exists public.workspace_subscriptions (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  provider text not null default 'stripe',
  provider_subscription_id text unique,
  billing_plan_key text not null references public.billing_plans(key),
  status text not null,
  seat_count integer not null default 1,
  current_period_start timestamptz,
  current_period_end timestamptz,
  cancel_at_period_end boolean not null default false,
  trial_ends_at timestamptz,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);
create table if not exists public.billing_usage_events (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  meter_key text not null,
  quantity numeric(12,2) not null default 1,
  occurred_at timestamptz not null default timezone('utc', now()),
  source_document_id uuid references public.documents(id) on delete set null,
  source_user_id uuid references public.profiles(id) on delete set null,
  metadata jsonb not null default '{}'::jsonb
);
alter table public.documents
  add column if not exists workspace_id uuid references public.workspaces(id) on delete set null;
create or replace function public.is_workspace_member(target_workspace_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.workspace_memberships membership
    where membership.workspace_id = target_workspace_id
      and membership.user_id = auth.uid()
  );
$$;
drop trigger if exists set_workspaces_updated_at on public.workspaces;
create trigger set_workspaces_updated_at
before update on public.workspaces
for each row
execute function public.set_updated_at();
drop trigger if exists set_workspace_billing_customers_updated_at on public.workspace_billing_customers;
create trigger set_workspace_billing_customers_updated_at
before update on public.workspace_billing_customers
for each row
execute function public.set_updated_at();
drop trigger if exists set_workspace_subscriptions_updated_at on public.workspace_subscriptions;
create trigger set_workspace_subscriptions_updated_at
before update on public.workspace_subscriptions
for each row
execute function public.set_updated_at();
alter table public.workspaces enable row level security;
alter table public.workspace_memberships enable row level security;
alter table public.billing_plans enable row level security;
alter table public.workspace_billing_customers enable row level security;
alter table public.workspace_subscriptions enable row level security;
alter table public.billing_usage_events enable row level security;
create policy "members can read workspaces"
on public.workspaces
for select
to authenticated
using (public.is_workspace_member(id));
create policy "members can read workspace memberships"
on public.workspace_memberships
for select
to authenticated
using (public.is_workspace_member(workspace_id));
create policy "authenticated users can read billing plans"
on public.billing_plans
for select
to authenticated
using (active = true);
create policy "workspace members can read billing customers"
on public.workspace_billing_customers
for select
to authenticated
using (public.is_workspace_member(workspace_id));
create policy "workspace members can read subscriptions"
on public.workspace_subscriptions
for select
to authenticated
using (public.is_workspace_member(workspace_id));
create policy "workspace members can read usage events"
on public.billing_usage_events
for select
to authenticated
using (public.is_workspace_member(workspace_id));
