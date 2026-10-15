# Modelo de segurança

| Tema | Decisão |
|---|---|
| Credencial | Código numérico de 19 dígitos (≈63 bits), gerado no servidor com CSPRNG e *rejection sampling*; mostrado uma vez |
| Armazenamento | Somente HMAC-SHA256 com *pepper* de 32 bytes (lookup + verify), comparação em tempo constante |
| Força bruta | rate limit por IP (falhas: 5/15 min com bloqueio progressivo ×2 até 24 h), por janela global e limite de contas/IP/hora; resposta genérica "Código inválido ou não encontrado" |
| Automação | honeypot + proof-of-work de uso único e expiração (10 min) |
| Sessão | tokens opacos de 32 bytes, SHA-256 no banco; acesso 15 min; refresh com rotação e detecção de reuso |
| Autorização | `user_id` só vem da sessão; toda consulta filtra `user_id`; 404 para recursos alheios |
| Banco | RLS ligado e forçado, sem policies, `REVOKE ALL` de `anon/authenticated`; funções RPC só para `service_role` |
| CORS | origens fixas (Pages + localhost); outras origens recebem 403 |
| Segredos | `server_secrets` (privada). Chaves de IA e pepper nunca saem do servidor; token admin só como hash |
| Cliente | tokens em `localStorage` (manter conectado) ou `sessionStorage` (sessão curta); XSS é o principal risco residual — Markdown renderizado sem HTML bruto |
| QR de login | O QR codifica `.../#/login?c=<código>`: o código fica no **fragmento**, que não é enviado ao servidor/logs/Referer; o app limpa o fragmento (`history.replaceState`) na carga; o login segue as mesmas regras de rate limit. **O QR equivale ao código.** Em Ajustes, gerar o QR exige digitar o código (`auth/verify-code`, mesmos limites e contadores de falha do login) |
| Provedor pago (xAI) | Desligado sem chave; fora do Automático salvo escolha manual ou preferência explícita do usuário (padrão desligada); teto diário por usuário/global; 402/403 de créditos = cota esgotada com cooldown de 6 h. Qualquer usuário pode escolher o modelo Grok manualmente quando o dono grava a chave: por isso o teto existe |

Limitações conhecidas: sem recuperação de conta por desenho; quem obtiver o código tem acesso total; o IP do cliente vem do cabeçalho do gateway da Supabase (`cf-connecting-ip`).
