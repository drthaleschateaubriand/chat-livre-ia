-- Preferência por usuário: permitir provedores com possível custo (xAI Grok) no modo Automático. Padrão: DESLIGADA.
alter table public.preferences add column if not exists allow_paid_auto boolean not null default false;
