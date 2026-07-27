-- PaperBook Cloud Web V1
-- 在 Supabase SQL Editor 中一次性执行

create extension if not exists pgcrypto;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text,
  is_app_admin boolean not null default false,
  created_at timestamptz not null default now()
);

create table if not exists public.workspaces (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  owner_id uuid not null references auth.users(id) on delete cascade,
  plan text not null default 'free',
  created_at timestamptz not null default now()
);

create table if not exists public.workspace_members (
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null default 'viewer'
    check (role in ('owner','admin','editor','viewer')),
  created_at timestamptz not null default now(),
  primary key (workspace_id,user_id)
);

create table if not exists public.notebooks (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  created_by uuid not null references auth.users(id),
  name text not null,
  sort_order integer not null default 0,
  is_archived boolean not null default false,
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.pages (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  notebook_id uuid not null references public.notebooks(id) on delete cascade,
  created_by uuid not null references auth.users(id),
  updated_by uuid not null references auth.users(id),
  title text not null default '无标题页',
  content_json jsonb not null default '{"html":"","tags":[]}'::jsonb,
  plain_text text not null default '',
  sort_order integer not null default 0,
  is_pinned boolean not null default false,
  is_archived boolean not null default false,
  revision integer not null default 1,
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists notebooks_workspace_idx
  on public.notebooks(workspace_id,deleted_at,sort_order);

create index if not exists pages_notebook_idx
  on public.pages(notebook_id,deleted_at,sort_order);

create index if not exists pages_search_idx
  on public.pages using gin(
    to_tsvector('simple',coalesce(title,'')||' '||coalesce(plain_text,''))
  );

create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at=now(); return new; end;
$$;

drop trigger if exists notebooks_touch_updated_at on public.notebooks;
create trigger notebooks_touch_updated_at
before update on public.notebooks
for each row execute procedure public.touch_updated_at();

drop trigger if exists pages_touch_updated_at on public.pages;
create trigger pages_touch_updated_at
before update on public.pages
for each row execute procedure public.touch_updated_at();

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path=public
as $$
declare wid uuid;
begin
  insert into public.profiles(id,display_name)
  values(new.id,coalesce(new.raw_user_meta_data->>'display_name',split_part(new.email,'@',1)))
  on conflict(id) do nothing;

  insert into public.workspaces(name,owner_id)
  values('我的空间',new.id)
  returning id into wid;

  insert into public.workspace_members(workspace_id,user_id,role)
  values(wid,new.id,'owner');

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert on auth.users
for each row execute procedure public.handle_new_user();

alter table public.profiles enable row level security;
alter table public.workspaces enable row level security;
alter table public.workspace_members enable row level security;
alter table public.notebooks enable row level security;
alter table public.pages enable row level security;

create or replace function public.is_workspace_member(wid uuid)
returns boolean
language sql stable security definer set search_path=public
as $$
  select exists(
    select 1 from public.workspace_members
    where workspace_id=wid and user_id=auth.uid()
  );
$$;

create or replace function public.workspace_role(wid uuid)
returns text
language sql stable security definer set search_path=public
as $$
  select role from public.workspace_members
  where workspace_id=wid and user_id=auth.uid()
  limit 1;
$$;

drop policy if exists profiles_self_select on public.profiles;
create policy profiles_self_select on public.profiles
for select using(id=auth.uid());

drop policy if exists profiles_self_update on public.profiles;
create policy profiles_self_update on public.profiles
for update using(id=auth.uid()) with check(id=auth.uid());

drop policy if exists workspaces_member_select on public.workspaces;
create policy workspaces_member_select on public.workspaces
for select using(public.is_workspace_member(id));

drop policy if exists members_member_select on public.workspace_members;
create policy members_member_select on public.workspace_members
for select using(public.is_workspace_member(workspace_id));

drop policy if exists notebooks_member_select on public.notebooks;
create policy notebooks_member_select on public.notebooks
for select using(public.is_workspace_member(workspace_id));

drop policy if exists notebooks_editor_insert on public.notebooks;
create policy notebooks_editor_insert on public.notebooks
for insert with check(
  created_by=auth.uid()
  and public.workspace_role(workspace_id) in ('owner','admin','editor')
);

drop policy if exists notebooks_editor_update on public.notebooks;
create policy notebooks_editor_update on public.notebooks
for update using(
  public.workspace_role(workspace_id) in ('owner','admin','editor')
) with check(
  public.workspace_role(workspace_id) in ('owner','admin','editor')
);

drop policy if exists pages_member_select on public.pages;
create policy pages_member_select on public.pages
for select using(public.is_workspace_member(workspace_id));

drop policy if exists pages_editor_insert on public.pages;
create policy pages_editor_insert on public.pages
for insert with check(
  created_by=auth.uid()
  and updated_by=auth.uid()
  and public.workspace_role(workspace_id) in ('owner','admin','editor')
);

drop policy if exists pages_editor_update on public.pages;
create policy pages_editor_update on public.pages
for update using(
  public.workspace_role(workspace_id) in ('owner','admin','editor')
) with check(
  updated_by=auth.uid()
  and public.workspace_role(workspace_id) in ('owner','admin','editor')
);

-- 如果你在运行此 SQL 之前已经注册过测试账号，
-- 该账号不会触发 handle_new_user。
-- 可先删除测试用户再重新注册，或手动为其创建 workspace。
