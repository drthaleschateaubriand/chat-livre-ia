-- Gera o pepper do servidor DENTRO do banco (32 bytes aleatórios). Nunca vai para o frontend nem para o Git.
create extension if not exists pgcrypto with schema extensions;
insert into public.server_secrets(name, value)
values ('PEPPER', encode(extensions.gen_random_bytes(32), 'hex'))
on conflict (name) do nothing;
