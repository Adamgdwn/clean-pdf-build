do $$
begin
  if not exists (select 1 from pg_type where typname = 'saved_signature_type') then
    create type public.saved_signature_type as enum ('typed', 'uploaded');
  end if;
end $$;

create table if not exists public.saved_signatures (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  label text not null,
  title_text text,
  signature_type public.saved_signature_type not null,
  typed_text text,
  storage_path text,
  is_default boolean not null default false,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint saved_signature_has_payload check (
    (signature_type = 'typed' and typed_text is not null and storage_path is null)
    or (signature_type = 'uploaded' and storage_path is not null)
  )
);

alter table public.document_fields
  add column if not exists applied_saved_signature_id uuid references public.saved_signatures(id) on delete set null;

drop trigger if exists set_saved_signatures_updated_at on public.saved_signatures;
create trigger set_saved_signatures_updated_at
before update on public.saved_signatures
for each row
execute function public.set_updated_at();

alter table public.saved_signatures enable row level security;

create policy "users can read their own saved signatures"
on public.saved_signatures
for select
to authenticated
using (user_id = auth.uid());

create policy "users can create their own saved signatures"
on public.saved_signatures
for insert
to authenticated
with check (user_id = auth.uid());

create policy "users can update their own saved signatures"
on public.saved_signatures
for update
to authenticated
using (user_id = auth.uid())
with check (user_id = auth.uid());

create policy "users can delete their own saved signatures"
on public.saved_signatures
for delete
to authenticated
using (user_id = auth.uid());

insert into storage.buckets (id, name, public)
values ('signatures', 'signatures', false)
on conflict (id) do nothing;

create policy "authenticated users can upload signature assets to their own folder"
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'signatures'
  and (storage.foldername(name))[1] = auth.uid()::text
);
