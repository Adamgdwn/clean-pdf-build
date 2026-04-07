alter table public.billing_plans
  add column if not exists billing_interval text not null default 'month';

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'billing_plans_billing_interval_check'
  ) then
    alter table public.billing_plans
      add constraint billing_plans_billing_interval_check
      check (billing_interval in ('month', 'year'));
  end if;
end $$;

update public.billing_plans
set billing_interval = 'month'
where billing_interval is distinct from 'month'
  and key in ('starter', 'team', 'business', 'easydraft_team');

insert into public.billing_plans (
  key,
  name,
  monthly_price_usd,
  billing_interval,
  included_internal_seats,
  included_completed_docs,
  included_ocr_pages,
  included_storage_gb,
  overage_completed_doc_usd_cents,
  overage_ocr_page_usd_cents,
  overage_storage_gb_usd_cents,
  included_signing_tokens,
  active
) values (
  'easydraft_team_annual',
  'EasyDraftDocs - Team Annual',
  120,
  'year',
  1,
  999999,
  999999,
  100,
  0,
  0,
  0,
  0,
  true
)
on conflict (key) do update
set
  name = excluded.name,
  monthly_price_usd = excluded.monthly_price_usd,
  billing_interval = excluded.billing_interval,
  included_internal_seats = excluded.included_internal_seats,
  included_completed_docs = excluded.included_completed_docs,
  included_ocr_pages = excluded.included_ocr_pages,
  included_storage_gb = excluded.included_storage_gb,
  overage_completed_doc_usd_cents = excluded.overage_completed_doc_usd_cents,
  overage_ocr_page_usd_cents = excluded.overage_ocr_page_usd_cents,
  overage_storage_gb_usd_cents = excluded.overage_storage_gb_usd_cents,
  included_signing_tokens = excluded.included_signing_tokens,
  active = true;
