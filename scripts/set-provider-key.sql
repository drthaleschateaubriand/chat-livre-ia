-- Alternativa SQL (rode no SQL Editor do Supabase ou via conector). A tabela server_secrets é privada (RLS sem policies, REVOKE para anon/authenticated).
-- Substitua o valor entre aspas. Nomes: KEY_GROQ, KEY_GEMINI, KEY_OPENROUTER, KEY_XAI (xAI é OPCIONAL e PAGO: pode gerar cobrança).
insert into public.server_secrets(name, value) values ('KEY_GROQ', 'COLE_A_CHAVE_AQUI')
on conflict (name) do update set value = excluded.value, updated_at = now();
-- depois, limpe pausas antigas (opcional):
delete from public.provider_state where provider = 'groq';
