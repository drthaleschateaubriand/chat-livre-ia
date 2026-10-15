# Modelo de segurança

| Tema | Decisão |
|---|---|
| Modelo | **App privado de um só usuário (dono).** Sem cadastro público: `auth/register`, `auth/challenge` e `auth/pow-challenge` sempre 403. Dono criado só via `ADMIN_TOKEN`; índice único `users_single_owner` impede um segundo dono; `account.delete` recusa o dono |
| Credencial | Código numérico de 19 dígitos (≈63 bits), gerado no servidor com CSPRNG e *rejection sampling*; mostrado uma vez ao administrador |
| Recuperação | `admin-reset-owner` (ADMIN_TOKEN): novo código para o mesmo usuário, revoga todas as sessões, mantém o histórico. Em repositório público o workflow só produz o código **criptografado** (RSA-OAEP); texto puro só no script local |
| Armazenamento | Somente HMAC-SHA256 com *pepper* de 32 bytes (lookup + verify), comparação em tempo constante |
| Força bruta | rate limit por IP (falhas: 5/15 min com bloqueio progressivo ×2 até 24 h), por janela global e falhas de token admin por IP; resposta genérica "Código inválido ou não encontrado" |
| Automação | sem cadastro público, não há o que automatizar; as ações admin têm rate limit e bloqueio progressivo por token errado |
| Sessão | tokens opacos de 32 bytes, SHA-256 no banco; acesso 15 min; refresh com rotação e detecção de reuso |
| Autorização | `user_id` só vem da sessão; toda consulta filtra `user_id`; 404 para recursos alheios |
| Banco | RLS ligado e forçado, sem policies, `REVOKE ALL` de `anon/authenticated`; funções RPC só para `service_role` |
| CORS | origens fixas (Pages + localhost); outras origens recebem 403 |
| Segredos | `server_secrets` (privada). Chaves de IA e pepper nunca saem do servidor; token admin só como hash |
| Cliente | tokens em `localStorage` (manter conectado) ou `sessionStorage` (sessão curta); XSS é o principal risco residual — Markdown renderizado sem HTML bruto |
| QR de login | O QR codifica `.../#/login?c=<código>`: o código fica no **fragmento**, que não é enviado ao servidor/logs/Referer; o app limpa o fragmento (`history.replaceState`) na carga; o login segue as mesmas regras de rate limit. **O QR equivale ao código.** Em Ajustes, gerar o QR exige digitar o código (`auth/verify-code`, mesmos limites e contadores de falha do login) |
| Provedor pago (xAI) | Desligado sem chave; fora do Automático salvo escolha manual ou preferência explícita do usuário (padrão desligada); teto diário por usuário/global; 402/403 de créditos = cota esgotada com cooldown de 6 h. Qualquer usuário pode escolher o modelo Grok manualmente quando o dono grava a chave: por isso o teto existe |

Limitações conhecidas: a recuperação depende do administrador (`ADMIN_TOKEN`) e, no caso do workflow, da chave privada de decifragem; quem obtiver o código tem acesso total; o IP do cliente vem do cabeçalho do gateway da Supabase (`cf-connecting-ip`).
