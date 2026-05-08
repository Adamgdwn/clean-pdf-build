do $$
begin
  if not exists (select 1 from pg_type where typname = 'signature_assurance_level') then
    create type public.signature_assurance_level as enum (
      'electronic',
      'verified_electronic',
      'digital_pki',
      'qualified_provider'
    );
  end if;

  if not exists (select 1 from pg_type where typname = 'signature_appearance_type') then
    create type public.signature_appearance_type as enum ('typed', 'uploaded');
  end if;

  if not exists (select 1 from pg_type where typname = 'signature_identity_provider') then
    create type public.signature_identity_provider as enum (
      'easy_draft',
      'easy_draft_remote',
      'qualified_remote',
      'organization_hsm'
    );
  end if;

  if not exists (select 1 from pg_type where typname = 'signature_identity_status') then
    create type public.signature_identity_status as enum (
      'active',
      'verification_required',
      'requested',
      'verified',
      'rejected'
    );
  end if;
end $$;

create table if not exists public.signature_identities (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  label text not null,
  title_text text,
  signer_name text not null,
  signer_email text not null,
  organization_name text,
  assurance_level public.signature_assurance_level not null,
  signature_type public.signature_appearance_type not null,
  typed_text text,
  storage_path text,
  provider public.signature_identity_provider not null,
  status public.signature_identity_status not null,
  certificate_fingerprint text,
  provider_reference text,
  signing_reason text,
  is_default boolean not null default false,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint signature_identities_email_lower_check
    check (signer_email = lower(trim(signer_email))),
  constraint signature_identities_visual_payload_check
    check (
      (signature_type = 'typed' and typed_text is not null and storage_path is null)
      or (signature_type = 'uploaded' and storage_path is not null and typed_text is null)
    ),
  constraint signature_identities_assurance_provider_check
    check (
      (assurance_level in ('electronic', 'verified_electronic') and provider = 'easy_draft')
      or (assurance_level = 'digital_pki' and provider in ('easy_draft_remote', 'organization_hsm'))
      or (assurance_level = 'qualified_provider' and provider = 'qualified_remote')
    ),
  constraint signature_identities_assurance_status_check
    check (
      (assurance_level = 'electronic' and status = 'active')
      or (assurance_level = 'verified_electronic' and status in ('verification_required', 'verified', 'rejected'))
      or (assurance_level in ('digital_pki', 'qualified_provider') and status in ('requested', 'verified', 'rejected'))
    )
);

create unique index if not exists signature_identities_user_email_assurance_key
  on public.signature_identities(user_id, lower(signer_email), assurance_level);

create unique index if not exists signature_identities_user_default_key
  on public.signature_identities(user_id)
  where is_default;

create index if not exists signature_identities_user_idx
  on public.signature_identities(user_id, created_at desc);

drop trigger if exists set_signature_identities_updated_at on public.signature_identities;
create trigger set_signature_identities_updated_at
before update on public.signature_identities
for each row
execute function public.set_updated_at();

alter table public.signature_identities enable row level security;

create policy "users can read their signature identities"
on public.signature_identities
for select
to authenticated
using (user_id = auth.uid());

create policy "users can create their signature identities"
on public.signature_identities
for insert
to authenticated
with check (user_id = auth.uid());

create policy "users can update their signature identities"
on public.signature_identities
for update
to authenticated
using (user_id = auth.uid())
with check (user_id = auth.uid());

create policy "users can delete their signature identities"
on public.signature_identities
for delete
to authenticated
using (user_id = auth.uid());

alter table if exists public.digital_signature_profiles
  add column if not exists title_text text,
  add column if not exists signer_name text,
  add column if not exists signer_email text,
  add column if not exists organization_name text,
  add column if not exists signing_reason text;

do $$
begin
  if to_regclass('public.saved_signatures') is not null then
    execute $sql$
      with saved_source as (
        select
          saved.id,
          saved.user_id,
          saved.label,
          saved.title_text,
          coalesce(
            nullif(saved.typed_text, ''),
            nullif(user_profile.display_name, ''),
            split_part(auth_user.email, '@', 1),
            saved.label
          ) as signer_name,
          lower(trim(auth_user.email)) as signer_email,
          'electronic'::public.signature_assurance_level as assurance_level,
          saved.signature_type::text::public.signature_appearance_type as signature_type,
          saved.typed_text,
          saved.storage_path,
          'easy_draft'::public.signature_identity_provider as provider,
          'active'::public.signature_identity_status as status,
          saved.is_default,
          saved.created_at,
          saved.updated_at,
          row_number() over (
            partition by saved.user_id, lower(trim(auth_user.email)), 'electronic'
            order by saved.is_default desc, saved.created_at desc, saved.id
          ) as row_number
        from public.saved_signatures saved
        join auth.users auth_user on auth_user.id = saved.user_id
        left join public.easydraft_user_profiles user_profile on user_profile.user_id = saved.user_id
      )
      insert into public.signature_identities (
        id,
        user_id,
        label,
        title_text,
        signer_name,
        signer_email,
        assurance_level,
        signature_type,
        typed_text,
        storage_path,
        provider,
        status,
        is_default,
        created_at,
        updated_at
      )
      select
        id,
        user_id,
        label,
        title_text,
        signer_name,
        signer_email,
        assurance_level,
        signature_type,
        typed_text,
        storage_path,
        provider,
        status,
        is_default,
        created_at,
        updated_at
      from saved_source
      where row_number = 1
      on conflict do nothing
    $sql$;
  end if;
end $$;

do $$
begin
  if to_regclass('public.digital_signature_profiles') is not null then
    execute $sql$
      with digital_source as (
        select
          profile.id,
          profile.user_id,
          profile.label,
          profile.title_text,
          coalesce(
            nullif(profile.signer_name, ''),
            nullif(user_profile.display_name, ''),
            nullif(staff_profile.display_name, ''),
            split_part(auth_user.email, '@', 1),
            profile.label
          ) as signer_name,
          lower(trim(coalesce(profile.signer_email, auth_user.email))) as signer_email,
          profile.organization_name,
          case
            when profile.assurance_level = 'qualified' then 'qualified_provider'::public.signature_assurance_level
            else 'digital_pki'::public.signature_assurance_level
          end as assurance_level,
          'typed'::public.signature_appearance_type as signature_type,
          coalesce(
            nullif(profile.signer_name, ''),
            nullif(user_profile.display_name, ''),
            nullif(staff_profile.display_name, ''),
            split_part(auth_user.email, '@', 1),
            profile.label
          ) as typed_text,
          case
            when profile.provider = 'qualified_remote' then 'qualified_remote'::public.signature_identity_provider
            when profile.provider = 'organization_hsm' then 'organization_hsm'::public.signature_identity_provider
            else 'easy_draft_remote'::public.signature_identity_provider
          end as provider,
          case
            when profile.status = 'verified' then 'verified'::public.signature_identity_status
            when profile.status = 'rejected' then 'rejected'::public.signature_identity_status
            else 'requested'::public.signature_identity_status
          end as status,
          profile.certificate_fingerprint,
          profile.provider_reference,
          profile.signing_reason,
          profile.created_at,
          profile.updated_at,
          row_number() over (
            partition by profile.user_id,
              lower(trim(coalesce(profile.signer_email, auth_user.email))),
              case when profile.assurance_level = 'qualified' then 'qualified_provider' else 'digital_pki' end
            order by profile.status = 'verified' desc, profile.created_at desc, profile.id
          ) as row_number
        from public.digital_signature_profiles profile
        join auth.users auth_user on auth_user.id = profile.user_id
        left join public.easydraft_user_profiles user_profile on user_profile.user_id = profile.user_id
        left join public.easydraft_staff_profiles staff_profile on staff_profile.user_id = profile.user_id
      )
      insert into public.signature_identities (
        id,
        user_id,
        label,
        title_text,
        signer_name,
        signer_email,
        organization_name,
        assurance_level,
        signature_type,
        typed_text,
        storage_path,
        provider,
        status,
        certificate_fingerprint,
        provider_reference,
        signing_reason,
        is_default,
        created_at,
        updated_at
      )
      select
        id,
        user_id,
        label,
        title_text,
        signer_name,
        signer_email,
        organization_name,
        assurance_level,
        signature_type,
        typed_text,
        null,
        provider,
        status,
        certificate_fingerprint,
        provider_reference,
        signing_reason,
        false,
        created_at,
        updated_at
      from digital_source
      where row_number = 1
      on conflict do nothing
    $sql$;
  end if;
end $$;

alter table public.document_fields
  add column if not exists applied_signature_identity_id uuid references public.signature_identities(id) on delete set null;

do $$
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'document_fields'
      and column_name = 'applied_saved_signature_id'
  ) then
    execute $sql$
      update public.document_fields
      set applied_signature_identity_id = applied_saved_signature_id
      where applied_signature_identity_id is null
        and applied_saved_signature_id is not null
        and exists (
          select 1
          from public.signature_identities identity
          where identity.id = document_fields.applied_saved_signature_id
        )
    $sql$;
  end if;
end $$;

alter table public.document_fields
  drop constraint if exists document_fields_applied_saved_signature_id_fkey;

alter table public.document_fields
  drop column if exists applied_saved_signature_id;

do $$
begin
  if to_regclass('public.saved_signatures') is not null then
    drop policy if exists "users can read their own saved signatures" on public.saved_signatures;
    drop policy if exists "users can create their own saved signatures" on public.saved_signatures;
    drop policy if exists "users can update their own saved signatures" on public.saved_signatures;
    drop policy if exists "users can delete their own saved signatures" on public.saved_signatures;
    drop trigger if exists set_saved_signatures_updated_at on public.saved_signatures;
  end if;
end $$;
drop table if exists public.saved_signatures;
drop type if exists public.saved_signature_type;

do $$
begin
  if to_regclass('public.digital_signature_profiles') is not null then
    drop policy if exists "users can read their digital signature profiles" on public.digital_signature_profiles;
    drop policy if exists "users can insert their digital signature profiles" on public.digital_signature_profiles;
    drop policy if exists "users can update their digital signature profiles" on public.digital_signature_profiles;
    drop trigger if exists set_digital_signature_profiles_updated_at on public.digital_signature_profiles;
  end if;
end $$;
drop table if exists public.digital_signature_profiles;
drop type if exists public.digital_signature_profile_status;
drop type if exists public.digital_signature_provider;
