-- AGENTES (personas/skills com instruções salvas) + conversas com agente opcional.
-- Mesmo modelo de segurança das demais tabelas: RLS ligado e forçado, nenhuma policy, REVOKE para anon/authenticated.
-- O acesso é somente pela Edge Function `data` (service role), sempre filtrando por user_id da sessão.

create table public.agents (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 60),
  description text not null default '' check (char_length(description) <= 200),
  instructions text not null check (char_length(btrim(instructions)) between 1 and 4000),
  emoji text check (emoji is null or char_length(emoji) <= 8),
  preferred_model text not null default 'auto'
    check (preferred_model = 'auto' or preferred_model ~ '^[a-z]{3,20}\|[A-Za-z0-9._:/-]{1,100}$'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index agents_user_idx on public.agents(user_id, created_at);

alter table public.conversations
  add column agent_id uuid references public.agents(id) on delete set null;
create index conversations_agent_idx on public.conversations(agent_id) where agent_id is not null;

alter table public.agents enable row level security;
alter table public.agents force row level security;
revoke all on table public.agents from anon, authenticated, public;
grant all on table public.agents to service_role;
