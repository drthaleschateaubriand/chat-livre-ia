# CHAT LIVRE IA

Chat estilo ChatGPT com **IAs gratuitas**, **login somente numérico** (código de 19 dígitos, sem e-mail/telefone/Google), histórico sincronizado entre dispositivos e instalável como app (PWA).

- **App:** https://drthaleschateaubriand.github.io/chat-livre-ia/
- **Frontend:** React + TypeScript + Vite + Tailwind (hospedado no GitHub Pages, rotas por hash `#/c/<id>`)
- **Backend:** Supabase (Postgres + Edge Functions em Deno). O navegador **nunca** acessa tabelas direto.

> ⚠️ **Aviso importante sobre o código de acesso:** o código de 19 dígitos é mostrado **uma única vez** na criação da conta. Não existe recuperação (não há e-mail nem telefone). **Se você perder o código, perde o acesso às suas conversas.** Quem tem o código acessa a conta.

---

## Como funciona

### Login numérico
1. **Criar conta:** o servidor gera um código de 19 dígitos com `crypto.getRandomValues` e *rejection sampling* (sem viés de módulo), descarta códigos previsíveis (repetidos/sequências/padrões curtos) e o mostra uma vez (copiar, baixar `.txt`, confirmação "anotei meu código").
2. **Entrar:** um único campo numérico; aceita espaços/hífens, normaliza e exige 18–20 dígitos.
3. **Nada de texto puro:** o banco guarda apenas `HMAC-SHA256(pepper, "lookup:"+código)` (índice determinístico) e `HMAC-SHA256(pepper, "verify:"+código)` (comparado em tempo constante). O *pepper* (32 bytes aleatórios) vive só na tabela privada `server_secrets`.
4. **Anti-abuso:** rate limit no Postgres (por IP e global, janela fixa + bloqueio progressivo), limite de criação de contas por IP/hora, honeypot e *proof-of-work* (SHA-256, 14 bits) para criar conta. Tentativas são registradas **sem** o código (IP só como hash HMAC).
5. **Sessões:** token de acesso opaco de 32 bytes (15 min) + refresh opaco com **rotação** (30 dias em "manter conectado", 12 h em sessão curta), guardados como SHA-256. Reuso de refresh antigo (fora da janela de corrida de 20 s) revoga a sessão. Há logout, "sair de todos os dispositivos" e revogação por dispositivo. O mesmo código funciona em vários dispositivos.
6. **Isolamento:** todas as tabelas têm RLS ligado, **nenhuma policy** e `REVOKE` para `anon/authenticated`. Só as Edge Functions (service role) leem/escrevem, e o `user_id` vem **sempre da sessão**, nunca do corpo. CORS restrito a `https://drthaleschateaubriand.github.io` e `http://localhost:5173/4173` (nunca `*`).

### IA e provedores (fallback automático)
Módulo `supabase/functions/_shared/providers/`:

| Provedor | Chave | Observação |
|---|---|---|
| **Pollinations** (`text.pollinations.ai/openai`) | não precisa | API oficial anônima; sempre disponível como último recurso |
| **Groq** | grátis | `llama-3.3-70b-versatile`, `llama-3.1-8b-instant`, `openai/gpt-oss-*` (lista real consultada pela API quando há chave) |
| **Google Gemini** | grátis | `gemini-2.5-flash`, `gemini-2.0-flash`… (lista real pela API oficial quando há chave) |
| **OpenRouter** | grátis | somente modelos com sufixo `:free` (lista pública consultada ao vivo) |

- Provedores **sem chave aparecem como "não configurado"** na interface e são pulados.
- Modo **Automático** escolhe o melhor elegível (por *rank*) e, em erro/timeout/429/5xx/401, **troca sozinho** para o próximo mantendo o contexto. Falha no meio da resposta descarta o parcial e recomeça no próximo.
- **Circuit breaker:** após 429 (usa `Retry-After`/cabeçalhos `x-ratelimit-reset-*`), 401/403, 5xx ou timeout, o modelo/provedor entra em *cooldown* (tabela `provider_state`) e **não é chamado de novo** até expirar. Sem retentativas abusivas: no máximo 1 falha por provedor por requisição.
- **Consumo** por provedor/modelo/dia em `provider_usage` (requisições, tokens, erros, limites atingidos, últimos cabeçalhos `x-ratelimit-*`), visível em *Ajustes → Modelos*.
- Quando **todas** as cotas esgotam: mensagem clara com quando tentar de novo. Nada é apresentado como ilimitado.
- A mensagem grava `provider`, `model` e `fallback_used`; a UI mostra discretamente "Provedor · modelo".
- Para adicionar um provedor: implemente `Provider` (`providers/types.ts`; para APIs compatíveis com OpenAI use `OpenAICompatProvider`) e registre em `registry.ts`.

### Histórico, memória e extras
Conversas, mensagens, preferências e **memórias explícitas** (editáveis/excluíveis, com chave liga/desliga e injetadas no prompt de sistema quando ativas). Pesquisa no histórico, renomear, fixar, excluir, regenerar, continuar, exportar conversa (TXT/Markdown), exportar todos os dados (JSON) e excluir conta (exige reenviar o código). Sincronização: busca ao abrir, ao focar a aba/voltar online e *polling* leve a cada 20 s. Extras: ditado por voz (Web Speech API), ler em voz alta (speechSynthesis), idioma, tamanho de fonte, tema claro/escuro e **resumo automático** do contexto antigo em conversas longas.

---

## Estrutura

```
src/                 components/ services/ lib/ types/   (frontend)
supabase/
  migrations/        esquema, funções (rate limit/uso), pepper, rotated_at
  functions/
    _shared/         code.ts, crypto.ts, db.ts, http.ts, cors.ts, session.ts, providers/
    auth/ chat/ data/ admin-set-key/
tests/               *.test.ts (vitest), integration.mjs, ratelimit.mjs, e2e.mjs (Playwright)
scripts/             deploy-gh-pages.sh, bundle-functions.sh, set-provider-key.sh/.sql, make-icons.py
docs/                deploy-workflow.yml, SEGURANCA.md
public/              manifest, sw.js, icons/
```

## Rodar localmente
```bash
npm install
cp .env.example .env.local     # preencha VITE_SUPABASE_URL e VITE_SUPABASE_PUBLISHABLE_KEY (públicos)
npm run dev                    # http://localhost:5173/chat-livre-ia/
npm test                       # vitest: código numérico, provedores, fallback, 429, cotas esgotadas
npm run build
```

## Testes
- `npm test` — unitários (31): normalização/validação do código, geração sem viés, seleção/fallback/cooldown com mocks **e** com servidor HTTP local simulando 429/503/timeout/SSE.
- `npm run test:integration` — integração contra as Edge Functions reais (conta, login, sessões, isolamento A×B, acesso direto às tabelas com a chave anon, CORS, IA real, histórico, 2º dispositivo, memórias, fallback real, cotas esgotadas, resumo, exclusão). Antes: `delete from public.rate_limits;`.
- `npm run test:ratelimit` — bloqueio progressivo de login e limite de criação de contas (bloqueia seu IP por alguns minutos; limpe `rate_limits` depois).
- `node tests/e2e.mjs` — Playwright/Chromium contra o GitHub Pages (viewport iPhone 390×844, Android, desktop) com *screenshots*.

## Deploy
### Frontend (GitHub Pages)
O token usado para criar o repositório não tinha o escopo `workflow`, então o deploy padrão é pela branch **`gh-pages`**:
```bash
npm run deploy      # build + push do dist/ para a branch gh-pages (Settings → Pages → Source: gh-pages)
```
Para usar GitHub Actions no lugar: copie `docs/deploy-workflow.yml` para `.github/workflows/deploy.yml` (pelo site do GitHub ou com um token com escopo `workflow`) e em *Settings → Pages* escolha **Source: GitHub Actions**.

### Backend (Supabase)
Migrações em `supabase/migrations/` (aplique em ordem). Edge Functions: com a CLI oficial `supabase functions deploy auth chat data admin-set-key --no-verify-jwt` (a autenticação é própria; `verify_jwt=false` de propósito) ou, sem CLI, `bash scripts/bundle-functions.sh` (gera `dist-fn/*.js` com Deno) e publique cada arquivo como `index.ts`.

## Como obter e cadastrar as chaves gratuitas
| Provedor | Onde obter a chave grátis |
|---|---|
| Groq | https://console.groq.com/keys |
| Google Gemini | https://aistudio.google.com/apikey |
| OpenRouter | https://openrouter.ai/settings/keys (use só modelos `:free`) |

As chaves **não** vão para o frontend nem para o Git. Ficam na tabela privada `server_secrets` e são gravadas pela Edge Function `admin-set-key`, protegida por um `ADMIN_TOKEN` aleatório (só o hash SHA-256 fica no banco; o token em texto puro fica fora do repositório):

```bash
# a chave vem da variável de ambiente PROVIDER_KEY (nunca como argumento)
PROVIDER_KEY='cole-aqui' bash scripts/set-provider-key.sh groq
PROVIDER_KEY='cole-aqui' bash scripts/set-provider-key.sh gemini
PROVIDER_KEY='cole-aqui' bash scripts/set-provider-key.sh openrouter
bash scripts/set-provider-key.sh status            # quais estão configurados
bash scripts/set-provider-key.sh groq delete       # remover
```
A função valida a chave na API do provedor antes de gravar (recusa chaves inválidas). Alternativa: `scripts/set-provider-key.sql`. As funções também leem `Deno.env` primeiro (`KEY_GROQ`, `KEY_GEMINI`, `KEY_OPENROUTER`), caso você configure *secrets* nativos pelo painel.

## Limitações dos planos gratuitos (confira sempre a fonte oficial)
- **Nada é ilimitado.** Cada provedor limita requisições/tokens por minuto e/ou dia e pode mudar as regras.
- **Groq:** limites por modelo (RPM/RPD/TPM/TPD), compartilhados na organização; excedê-los devolve 429 — https://console.groq.com/docs/rate-limits
- **Gemini:** limites por projeto e por modelo (RPM, TPM, RPD; RPD zera à meia-noite do Pacífico); valores exatos no AI Studio — https://ai.google.dev/gemini-api/docs/rate-limits
- **OpenRouter `:free`:** segundo a documentação, 20 requisições/min e, com menos de 10 créditos comprados, 50 requisições/dia (1000/dia com ≥10 créditos) — https://openrouter.ai/docs/api-reference/limits
- **Pollinations anônimo:** sujeito a fila e limites por IP; sem garantia de disponibilidade — https://pollinations.ai
- **Supabase free:** projetos inativos podem ser pausados e há limites de uso/Edge Functions — https://supabase.com/pricing
- O app **nunca ativa cobrança**; use apenas planos/modelos gratuitos.
- Dados de planos gratuitos de alguns provedores podem ser usados para melhorar seus produtos (ex.: Gemini API gratuita): não envie dados sensíveis.

## Segurança
Veja `docs/SEGURANCA.md`. Nunca commite credenciais reais, token admin, pepper ou service role.
