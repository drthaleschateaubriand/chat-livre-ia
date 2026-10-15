-- CHAT LIVRE IA — esquema principal.
-- Todas as tabelas são PRIVADAS: RLS ligado, nenhuma policy, REVOKE para anon/authenticated.
-- O acesso acontece apenas via Edge Functions com a service role.

create table public.server_secrets (
  name text primary key,
  value text not null,
  updated_at timestamptz not null default now()
);

create table public.users (
  id uuid primary key default gen_random_uuid(),
  code_lookup text not null unique,   -- HMAC-SHA256(pepper, "lookup:" || código): índice determinístico
  code_verify text not null,          -- HMAC-SHA256(pepper, "verify:" || código): comparado em tempo constante
  created_at timestamptz not null default now(),
  last_login_at timestamptz
);

create table public.sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  access_hash text not null unique,        -- SHA-256 do token de acesso
  access_expires_at timestamptz not null,
  refresh_hash text not null unique,       -- SHA-256 do token de refresh atual
  prev_refresh_hash text,                  -- refresh anterior (detecta reuso após rotação)
  refresh_expires_at timestamptz not null,
  persistent boolean not null default false,
  device_name text not null default 'Dispositivo',
  user_agent text,
  ip_hash text,
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  revoked_at timestamptz
);
create index sessions_user_idx on public.sessions(user_id);
create index sessions_prev_refresh_idx on public.sessions(prev_refresh_hash) where prev_refresh_hash is not null;

create table public.preferences (
  user_id uuid primary key references public.users(id) on delete cascade,
  theme text not null default 'system' check (theme in ('system','light','dark')),
  font_size text not null default 'md' check (font_size in ('sm','md','lg')),
  language text not null default 'pt-BR',
  memory_enabled boolean not null default true,
  default_model text not null default 'auto',
  auto_speak boolean not null default false,
  updated_at timestamptz not null default now()
);

create table public.conversations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  title text not null default 'Nova conversa',
  pinned boolean not null default false,
  summary text,                       -- resumo do contexto antigo (economiza tokens)
  summary_upto bigint not null default 0,  -- messages.seq coberto pelo resumo
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index conversations_user_idx on public.conversations(user_id, updated_at desc);

create table public.messages (
  id uuid primary key default gen_random_uuid(),
  seq bigint generated always as identity,
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  user_id uuid not null references public.users(id) on delete cascade,
  role text not null check (role in ('user','assistant','system')),
  content text not null,
  provider text,
  model text,
  fallback_used boolean not null default false,
  tokens_in integer,
  tokens_out integer,
  created_at timestamptz not null default now()
);
create index messages_conv_idx on public.messages(conversation_id, seq);
create index messages_user_idx on public.messages(user_id);

create table public.memories (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  content text not null check (char_length(content) between 1 and 1000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index memories_user_idx on public.memories(user_id);

-- Consumo por provedor/modelo/dia (compartilhado: as chaves de provedores são do servidor).
create table public.provider_usage (
  provider text not null,
  model text not null,
  day date not null,
  requests integer not null default 0,
  tokens_in bigint not null default 0,
  tokens_out bigint not null default 0,
  errors integer not null default 0,
  rate_limited integer not null default 0,
  limit_info jsonb,                  -- últimos cabeçalhos x-ratelimit-* vistos
  updated_at timestamptz not null default now(),
  primary key (provider, model, day)
);

-- Circuit breaker por provedor/modelo.
create table public.provider_state (
  provider text not null,
  model text not null,
  cooldown_until timestamptz,
  last_status integer,
  last_error text,
  consecutive_failures integer not null default 0,
  updated_at timestamptz not null default now(),
  primary key (provider, model)
);

-- Rate limit (janela fixa + bloqueio progressivo). A chave é sempre um hash (nunca IP/código em claro).
create table public.rate_limits (
  scope text not null,
  key text not null,
  window_start timestamptz not null default now(),
  count integer not null default 0,
  strikes integer not null default 0,
  blocked_until timestamptz,
  updated_at timestamptz not null default now(),
  primary key (scope, key)
);

-- Registro de tentativas (sem guardar o código).
create table public.auth_attempts (
  id bigint generated always as identity primary key,
  at timestamptz not null default now(),
  kind text not null,          -- login | register | refresh
  ok boolean not null,
  ip_hash text,
  reason text
);
create index auth_attempts_at_idx on public.auth_attempts(at);

-- Segurança: RLS ligado, SEM policies, e REVOKE de tudo para anon/authenticated.
do $$
declare t text;
begin
  foreach t in array array['server_secrets','users','sessions','preferences','conversations','messages','memories','provider_usage','provider_state','rate_limits','auth_attempts']
  loop
    execute format('alter table public.%I enable row level security', t);
    execute format('alter table public.%I force row level security', t);
    execute format('revoke all on table public.%I from anon, authenticated, public', t);
    execute format('grant all on table public.%I to service_role', t);
  end loop;
end $$;
revoke all on all sequences in schema public from anon, authenticated, public;
grant all on all sequences in schema public to service_role;
