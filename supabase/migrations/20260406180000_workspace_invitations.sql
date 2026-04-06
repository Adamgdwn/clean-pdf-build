create table if not exists public.workspace_invitations (
  id                  uuid           primary key default gen_random_uuid(),
  workspace_id        uuid           not null references public.workspaces(id) on delete cascade,
  email               text           not null,
  role                public.workspace_role not null default 'member',
  invited_by_user_id  uuid           not null references public.profiles(id) on delete cascade,
  token               text           not null unique,
  expires_at          timestamptz    not null,
  accepted_at         timestamptz,
  created_at          timestamptz    not null default timezone('utc', now())
);

create index if not exists workspace_invitations_token_idx     on public.workspace_invitations(token);
create index if not exists workspace_invitations_email_idx     on public.workspace_invitations(lower(email));
create index if not exists workspace_invitations_workspace_idx on public.workspace_invitations(workspace_id);

alter table public.workspace_invitations enable row level security;

-- Workspace members can see pending invitations for their workspace
create policy "workspace members can read invitations"
  on public.workspace_invitations
  for select
  to authenticated
  using (public.is_workspace_member(workspace_id));
