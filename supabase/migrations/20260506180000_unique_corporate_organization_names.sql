alter table public.organizations
  add column if not exists verified_email_domain text;

update public.organizations
set verified_email_domain = lower(split_part(billing_email, '@', 2))
where account_type = 'corporate'
  and verified_email_domain is null
  and billing_email is not null
  and billing_email like '%@%'
  and lower(split_part(billing_email, '@', 2)) not in (
    'aol.com',
    'gmail.com',
    'googlemail.com',
    'hotmail.com',
    'icloud.com',
    'live.com',
    'mail.com',
    'me.com',
    'msn.com',
    'outlook.com',
    'pm.me',
    'proton.me',
    'protonmail.com',
    'yahoo.ca',
    'yahoo.com',
    'ymail.com'
  );

create unique index if not exists organizations_corporate_normalized_name_key
on public.organizations (
  lower(regexp_replace(btrim(name), '\s+', ' ', 'g'))
)
where account_type = 'corporate';

create unique index if not exists organizations_corporate_verified_email_domain_key
on public.organizations (verified_email_domain)
where account_type = 'corporate'
  and verified_email_domain is not null;
