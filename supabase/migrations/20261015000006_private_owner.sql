-- App PRIVADO de um único usuário: marca o dono (no máximo um) e contas de teste (apagáveis em massa).
alter table public.users add column if not exists is_owner boolean not null default false;
alter table public.users add column if not exists is_test boolean not null default false;
-- no máximo UM dono, garantido pelo banco
create unique index if not exists users_single_owner on public.users ((true)) where is_owner;
-- dono nunca é conta de teste
alter table public.users drop constraint if exists users_owner_not_test;
alter table public.users add constraint users_owner_not_test check (not (is_owner and is_test));
