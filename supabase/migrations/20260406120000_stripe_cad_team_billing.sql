-- Idempotency table for Stripe webhook events.
-- Before processing any webhook, insert the event ID here.
-- A unique constraint violation means the event was already processed — skip it.
create table if not exists public.stripe_processed_events (
  stripe_event_id text primary key,
  event_type      text not null,
  workspace_id    uuid references public.workspaces(id) on delete set null,
  processed_at    timestamptz not null default timezone('utc', now())
);

-- Switch to single-product CAD billing model.
-- Deactivate all existing tiers so they no longer appear in plan selection.
-- We do NOT delete them — existing workspace_subscriptions rows reference these keys.
update public.billing_plans
set active = false
where key in ('starter', 'team', 'business');

-- New plan: EasyDraftDocs - Team
-- Priced at $12 CAD per seat per month.
-- NOTE: monthly_price_usd column is reused to store CAD cents-to-dollars value (integer = whole CAD dollars).
-- External signer tokens are purchased separately via one-time checkout; included_signing_tokens is 0.
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
  overage_storage_gb_usd_cents,
  included_signing_tokens,
  active
) values (
  'easydraft_team',
  'EasyDraftDocs - Team',
  12,
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
    name                         = excluded.name,
    monthly_price_usd            = excluded.monthly_price_usd,
    included_internal_seats      = excluded.included_internal_seats,
    included_completed_docs      = excluded.included_completed_docs,
    included_ocr_pages           = excluded.included_ocr_pages,
    included_storage_gb          = excluded.included_storage_gb,
    overage_completed_doc_usd_cents = excluded.overage_completed_doc_usd_cents,
    overage_ocr_page_usd_cents   = excluded.overage_ocr_page_usd_cents,
    overage_storage_gb_usd_cents = excluded.overage_storage_gb_usd_cents,
    included_signing_tokens      = excluded.included_signing_tokens,
    active                       = true;
