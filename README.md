# CHAT LIVRE IA

Chat estilo ChatGPT com **IAs gratuitas**, **login somente numérico** (código de 19 dígitos, sem e-mail/telefone/Google), histórico sincronizado entre dispositivos e instalável como app (PWA).

> 🔒 **App PRIVADO, de um único usuário (o dono).** Não existe cadastro público: a interface não tem “Criar conta” e o servidor recusa `auth/register` e `auth/pow-challenge` com **403** sempre. A única conta é criada pelo administrador (token `ADMIN_TOKEN`, fora do Git) e há **no máximo um dono** (índice único no banco).

- **App:** https://drthaleschateaubriand.github.io/chat-livre-ia/
- **Frontend:** React + TypeScript + Vite + Tailwind (hospedado no GitHub Pages, rotas por hash `#/c/<id>`)
- **Backend:** Supabase (Postgres + Edge Functions em Deno). O navegador **nunca** acessa tabelas direto.

> ⚠️ **Sobre o código de acesso:** o código de 19 dígitos é mostrado **uma única vez**, na criação do dono (ou numa redefinição). Não há e-mail nem telefone. Se perder o código, a recuperação é **só pelo administrador** (veja *Recuperação do código do dono* abaixo), que gera um código novo **mantendo o histórico**. Quem tem o código acessa a conta.

---

## Como funciona

### Login numérico
1. **Código do dono:** gerado no servidor, só pelo administrador (`admin-create-owner`), com `crypto.getRandomValues` e *rejection sampling* (sem viés de módulo), descartando códigos previsíveis (repetidos/sequências/padrões curtos). É devolvido uma vez ao administrador. **Não há cadastro público**: `auth/register`, `auth/challenge` e `auth/pow-challenge` respondem 403 `registration_closed`.
2. **Entrar:** um único campo (`type="text" inputMode="numeric"`, sem `maxLength`/`pattern`, com autocorreção/maiúsculas/sugestões desligadas). O app extrai só os dígitos do que foi digitado **ou colado** (mensagem inteira, espaços, hífens/travessões, NBSP, quebras de linha, caracteres invisíveis, dígitos de largura total e árabe-índicos), mostra "N de 19 dígitos — faltam X" e exige 18–20 dígitos. O **servidor repete a mesma normalização** (`_shared/code.ts`), então um cliente antigo/colagem estranha também funciona. Letras continuam sendo rejeitadas.
   - **Mensagens de erro distintas** (`src/lib/loginError.ts`): código não encontrado (401, lembra que um código antigo deixa de valer após redefinição), limite de tentativas (429, diz quanto esperar e que o código não foi julgado errado), servidor com problema (5xx), tempo esgotado (25 s), sem rede/CORS/endereço não oficial, origem não permitida (403).
3. **Nada de texto puro:** o banco guarda apenas `HMAC-SHA256(pepper, "lookup:"+código)` (índice determinístico) e `HMAC-SHA256(pepper, "verify:"+código)` (comparado em tempo constante). O *pepper* (32 bytes aleatórios) vive só na tabela privada `server_secrets`.
4. **Anti-abuso:** rate limit no Postgres (por IP e global, janela fixa + bloqueio progressivo), limite de falhas também nas ações administrativas (token errado bloqueia por IP com backoff). Tentativas são registradas **sem** o código (IP só como hash HMAC).
5. **Sessões:** token de acesso opaco de 32 bytes (15 min) + refresh opaco com **rotação** (30 dias em "manter conectado", 12 h em sessão curta), guardados como SHA-256. Reuso de refresh antigo (fora da janela de corrida de 20 s) revoga a sessão. Há logout, "sair de todos os dispositivos" e revogação por dispositivo. O mesmo código funciona em vários dispositivos.
6. **Isolamento:** todas as tabelas têm RLS ligado, **nenhuma policy** e `REVOKE` para `anon/authenticated`. Só as Edge Functions (service role) leem/escrevem, e o `user_id` vem **sempre da sessão**, nunca do corpo. CORS restrito a `https://drthaleschateaubriand.github.io` e `http://localhost:5173/4173` (nunca `*`).

#### Entrar com QR code
O mesmo código também pode ser usado como **QR code** (mesmas regras de rate limit/segurança do login normal):
- **Onde aparece:** em *Ajustes → QR de acesso* (exige **digitar o código**, que o servidor confirma com `auth/verify-code`, mais uma caixa de confirmação; o app não guarda o código). Há botão **Baixar imagem do QR** (PNG).
- **Conteúdo do QR:** o link `https://drthaleschateaubriand.github.io/chat-livre-ia/#/login?c=<código>`. O código vai no **fragmento (`#`)**, que o navegador nunca envia ao servidor, a logs ou ao `Referer`; nada de query string.
- ⚠️ **O QR equivale ao código:** quem tiver a imagem/foto/print acessa a conta. Guarde-o como o código e não o compartilhe.
- **Entrar:** tela de login → **“Entrar com QR code”** (câmera via `BarcodeDetector` quando existir, senão `jsQR`), ou **escolher uma imagem do QR** salva na galeria, ou simplesmente **abrir o link/QR com a câmera nativa do celular**: o app lê o fragmento, faz o login e **limpa o fragmento da URL** (`history.replaceState`) imediatamente. Se a permissão da câmera for negada, aparece uma mensagem com as alternativas (imagem ou digitar o código). Com uma sessão já ativa, abrir um link de QR apenas limpa o fragmento.

### IA e provedores (fallback automático)
Módulo `supabase/functions/_shared/providers/`:

| Provedor | Chave | Observação |
|---|---|---|
| **Pollinations** (`text.pollinations.ai/openai`) | não precisa | API oficial anônima; sempre disponível como último recurso |
| **Groq** | grátis | `llama-3.3-70b-versatile`, `llama-3.1-8b-instant`, `openai/gpt-oss-*` (lista real consultada pela API quando há chave) |
| **Google Gemini** | grátis | `gemini-3.5-flash` (principal), `gemini-3.5-flash-lite` e `gemini-flash-lite-latest` (reserva), depois `gemini-3.8-flash`, `gemini-3.7-flash` e `gemini-flash-latest` (rank um pouco pior: deram 503 “high demand” transitório). Conferido com chave real em 15/10/2026: os `gemini-2.5-*`/`2.0-flash` retornam 404 “no longer available to new users”. Com chave, a lista vem de `GET /v1beta/models` (só `generateContent`), cruzada com o catálogo preferido; modelos de imagem/TTS/transcrição/lyria/robotics/computer-use/deep-research/antigravity/omni/nano-banana/embedding **nunca** entram no chat. Chaves novas (`AQ.…`) funcionam: a listagem usa `x-goog-api-key` e o chat (endpoint OpenAI-compatível) usa `Authorization: Bearer` |
| **OpenRouter** | grátis | somente modelos com sufixo `:free` (lista pública consultada ao vivo) |
| **xAI Grok** | ⚠️ **paga, opcional** | API oficial OpenAI-compatível (`https://api.x.ai/v1/chat/completions`). **Opcional, requer chave com créditos; pode gerar cobrança na conta xAI do dono da chave.** Sem plano gratuito garantido (só créditos promocionais eventuais) |

#### xAI Grok (opcional, pago)
- **Desligado por padrão:** sem chave gravada aparece como "não configurado" e é pulado. Com chave, **continua fora do Automático**: só é usado (a) quando o usuário **escolhe manualmente um modelo Grok**, ou (b) quando liga *Ajustes → Modelos → "Permitir provedores com possível custo no Automático"* (padrão: **desligado**, por usuário). Mesmo ligado, o Grok entra **depois** de Groq, Gemini, OpenRouter `:free` e Pollinations, só quando todos falham.
- **Teto de segurança:** no máximo 30 chamadas pagas/usuário/dia e 300 no total/dia (constantes em `chat/index.ts`), para proteger os créditos do dono; acima disso o Grok é pulado e o app segue para o próximo provedor.
- **Erros:** 429 → circuit breaker (`Retry-After`); 402, ou 403 de créditos/limite de gasto esgotado → *cota esgotada* com cooldown de 6 h no provedor inteiro (após recarregar, `set-provider-key.sh xai clear-cooldown`); 401/403 de chave ou 400 "Incorrect API key" → `auth`, cooldown de 1 h.
- **Modelos:** nomes conforme https://docs.x.ai/docs/models (conferidos em 15/10/2026: `grok-4.3`, `grok-4.7`, `grok-4.20-0309-non-reasoning`). Com chave, a lista vem de `GET https://api.x.ai/v1/models`; sem chave, vale um catálogo estático **marcado como não verificado**. O stream usa `max_completion_tokens` (o `max_tokens` está obsoleto na xAI).
- **Obter a chave:** https://console.x.ai (cadastre créditos/limite de gasto lá; a cobrança é na conta de quem criou a chave). Limites por tier (RPS/TPM): https://docs.x.ai/docs/key-information/consumption-and-rate-limits · preços: https://docs.x.ai/docs/models
- **Não testado com chave real** (este projeto não tem chave xAI). Testado: classificação de erros e fallback com servidor HTTP local, e a chamada **real** à API da xAI com chave inválida (retorna 400 → `auth` → fallback).

- **Ordem do Automático (por rank):** Groq (10…) e Gemini (12…21) → OpenRouter `:free` (22…) → **Pollinations por último** (90) → (xAI só com permissão). 404 “no longer available” é `bad_model` (cooldown de 6 h só desse modelo).
- Provedores **sem chave aparecem como "não configurado"** na interface e são pulados.
- Modo **Automático** escolhe o melhor elegível (por *rank*) e, em erro/timeout/429/5xx/401, **troca sozinho** para o próximo mantendo o contexto. Falha no meio da resposta descarta o parcial e recomeça no próximo.
- **Circuit breaker:** após 429 (usa `Retry-After`/cabeçalhos `x-ratelimit-reset-*`), 401/403, 5xx ou timeout, o modelo/provedor entra em *cooldown* (tabela `provider_state`) e **não é chamado de novo** até expirar. Sem retentativas abusivas: no máximo 1 falha por provedor por requisição.
- **Consumo** por provedor/modelo/dia em `provider_usage` (requisições, tokens, erros, limites atingidos, últimos cabeçalhos `x-ratelimit-*`), visível em *Ajustes → Modelos*.
- Quando **todas** as cotas esgotam: mensagem clara com quando tentar de novo. Nada é apresentado como ilimitado.
- A mensagem grava `provider`, `model` e `fallback_used`; a UI mostra discretamente "Provedor · modelo".
- Para adicionar um provedor: implemente `Provider` (`providers/types.ts`; para APIs compatíveis com OpenAI use `OpenAICompatProvider`) e registre em `registry.ts`.

### Agentes (personas com instruções salvas)
Um **agente** faz a IA se comportar sempre do mesmo jeito: nome, descrição curta (até 200), **instruções (até 4000 caracteres)**, emoji/ícone opcional e **modelo preferido** opcional (`auto` ou `provedor|modelo`). Máx. 50 por usuário.
- **Criar/editar/duplicar/excluir:** *Ajustes → Agentes* (validação e contador de caracteres; o servidor valida de novo). O botão **Adicionar exemplos** cria, só quando você clica, 3 agentes: *Tradutor PT-EN*, *Revisor de texto* e *Explicador simples* (nada é criado automaticamente).
- **Usar:** o botão de agente no cabeçalho escolhe o agente da **próxima conversa** (ou **troca/remove** o da conversa aberta); o cabeçalho mostra o agente ativo. Excluir um agente **não** apaga as conversas (`agent_id` vira `null`).
- **No prompt:** a ordem é *instrução base → agente → memórias → resumo* (`_shared/prompt.ts`). As instruções são **apenas texto**: limites, rate limit e a regra de provedor pago são aplicados no servidor, fora do prompt, e o agente não os altera.
- **Modelo preferido:** só vale quando a conversa está em **Automático** (se você escolheu um modelo à mão, ele vence). Se o modelo do agente for de um provedor **pago** (xAI) e você não permitiu pagos em *Ajustes → Modelos*, o preferido é **ignorado** e segue o Automático gratuito.
- **Dados:** tabela `agents` (RLS forçado, sem policies, `REVOKE`; só a Edge Function `data` acessa, sempre por `user_id` da sessão; agente de outro usuário responde 404). `conversations.agent_id` (FK `on delete set null`). A exportação JSON inclui `agents` e o `agent_id` das conversas; excluir a conta apaga os agentes (cascata).

### Histórico, memória e extras
Conversas, mensagens, preferências e **memórias explícitas** (editáveis/excluíveis, com chave liga/desliga e injetadas no prompt de sistema quando ativas). Pesquisa no histórico, renomear, fixar, excluir, regenerar, continuar, exportar conversa (TXT/Markdown), exportar todos os dados (JSON). **Não há exclusão de conta** pela interface nem pela API para o dono (`owner_protected`). Sincronização: busca ao abrir, ao focar a aba/voltar online e *polling* leve a cada 20 s. Extras: ditado por voz (Web Speech API), ler em voz alta (speechSynthesis), idioma, tamanho de fonte, tema claro/escuro e **resumo automático** do contexto antigo em conversas longas.

---

## App privado: dono, recuperação e administração

**Criar o dono (uma vez, só se ainda não existir):**
```bash
bash scripts/create-owner.sh         # usa o ADMIN_TOKEN (arquivo fora do repo); falha com 409 se já houver dono
```
O código é gravado em `/workspace/chat-livre-ia-private/owner_code.txt` (modo 600, **fora do repositório**, ignorado pelo `.gitignore`) e **nunca é impresso**. Variáveis: `ADMIN_TOKEN_FILE` (ou `ADMIN_TOKEN`) e `OWNER_CODE_FILE` para mudar os caminhos.

**Recuperação do código do dono (sem e-mail), controlada por você via GitHub/administrador:** a ação `admin-reset-owner` gera um código novo **para o mesmo usuário** (só troca o hash; **conversas, memórias e preferências ficam**), **revoga todas as sessões** e o código antigo deixa de funcionar.
- **Local (seguro):** `bash scripts/reset-owner.sh --yes` (precisa do `ADMIN_TOKEN`; grava o novo código em `owner_code.txt`, sem imprimir).
- **Via GitHub Actions (opcional):** copie `docs/reset-owner-workflow.yml` para `.github/workflows/reset-owner.yml` (o token usado aqui não tinha escopo `workflow`, por isso o arquivo está em `docs/`) e crie o *secret* `ADMIN_TOKEN` em *Settings → Secrets and variables → Actions*. Execute em *Actions → Reset owner → Run workflow* (digite `RESETAR`).
  - ⚠️ **O repositório é público e os logs do Actions também são públicos.** Por isso o workflow **nunca imprime o código**: a função devolve o código **criptografado** com a chave pública RSA-OAEP em `docs/reset-owner-pubkey.pem`, e só o texto cifrado vai para o *artifact* `reset-owner-enc` (1 dia de retenção). Quem decifra é quem tem a **chave privada** (`reset_private.pem`, guardada fora do repo, na máquina do administrador/assistente): `bash scripts/receive-reset.sh` (aceita um arquivo `.enc` ou baixa o artifact com `gh run download`).
  - **Limitação honesta:** sem a chave privada ninguém consegue ler o código novo, nem você. Guarde uma cópia da chave privada num lugar seguro. Se a quiser trocar, gere outro par (`openssl genrsa`/`openssl rsa -pubout`) e substitua `docs/reset-owner-pubkey.pem`.
  - Se você não puder usar a chave privada, use o script local.
- A API administrativa também tem `owner-status`, `admin-create-test-user` e `admin-delete-test-users` (só para testes; nunca tocam o dono). `admin-reset-owner` com `user_id` só aceita usuários **de teste**.

**Garantias no banco:** `users.is_owner` com índice único parcial (`users_single_owner`): um segundo dono é rejeitado pelo próprio Postgres. `account.delete` recusa o dono (403 `owner_protected`).

---

## Estrutura

```
src/                 components/ services/ lib/ types/   (frontend)
supabase/
  migrations/        esquema, funções (rate limit/uso), pepper, rotated_at, allow_paid_auto, private_owner, agents
  functions/
    _shared/         code.ts, agents.ts, prompt.ts, crypto.ts, db.ts, http.ts, cors.ts, session.ts, providers/
    auth/ chat/ data/ admin-set-key/
tests/               *.test.ts (vitest), integration.mjs, private-owner.mjs, xai-qr.mjs, ratelimit.mjs, e2e.mjs, e2e-qr.mjs (Playwright)
scripts/             deploy-gh-pages.sh, bundle-functions.sh, set-provider-key.sh/.sql, create-owner.sh, reset-owner.sh, reset-owner-encrypted.sh, receive-reset.sh, make-icons.py
docs/                deploy-workflow.yml, reset-owner-workflow.yml, reset-owner-pubkey.pem, SEGURANCA.md
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
- `npm test` — unitários (vitest): normalização/validação do código, geração sem viés, seleção/fallback/cooldown com mocks **e** com servidor HTTP local simulando 429/503/timeout/SSE; **xAI** (402/403/429, ordem no Automático, escolha manual, "não configurado", teto pago); **QR** (parse do link/dígitos, fragmento limpo, QR gerado e decodificado com jsQR).
- `npm run test:gemini-real` — conversa REAL em produção com o login do dono (lê `owner_code.txt`, sem imprimir): confere que a resposta veio do Gemini (provider/model gravados), que com o Gemini em cooldown cai no Pollinations, e apaga a conversa. Gasta ~2 chamadas de chat grátis.
- `npm run test:agents` — integração REAL dos agentes: CRUD, validação (limites 60/200/4000, modelo inválido), isolamento entre usuários de teste (404 em tudo), trocar/remover agente da conversa, exclusão não apaga conversa, limite de 50, exportação, e **conversa real em produção** (agente “responda só ABACAXI”, modelo preferido Pollinations: a instrução foi seguida; controle sem agente). Usa usuários de teste do admin e os apaga.
- `npm run test:e2e-agents` — Playwright (iPhone 390×844): cria agente pela UI (validação, contador), exemplos, editar/duplicar/excluir, usa o agente numa conversa real, troca/remove e confere persistência após recarregar.
- `npm run test:login-inputs` — Playwright contra o **site publicado**: matriz de digitação/colagem do código (iPhone 13 e Pixel 7 emulados + desktop: sem espaços, com espaços/hífens, NBSP, invisíveis, texto longo, largura total, Backspace, Enter), as 4 mensagens de erro (401 real, 429, 503, rede) e, com `OWNER=1`, o código do dono (só login/logout; nunca impresso). **WebKit/Safari real não é testado** (emulação em Chromium).
- `npm run test:private-owner` — modelo privado em produção: `register`/`pow-challenge` 403 (nunca 429), dono único (2º dono → 409 e rejeição no banco; o reset do dono REAL só roda com `ALLOW_REAL_OWNER_RESET=1`, caso contrário é pulado para não invalidar o código que o dono guardou), login do dono com `owner_code.txt`, dono não excluível, reset (código novo, antigo e sessões invalidados, mesmo usuário, histórico preservado) **em usuário de teste**, entrega criptografada sem código em texto puro. Cria usuários de teste pelo admin e os apaga.
- `npm run test:integration` — integração contra as Edge Functions reais (cadastro fechado, usuários de teste via admin, login, sessões, isolamento A×B, acesso direto às tabelas com a chave anon, CORS, IA real, histórico, 2º dispositivo, memórias, fallback real, cotas esgotadas, resumo). Antes: `delete from public.rate_limits;`.
- `npm run test:xai-qr` — integração real: xAI desligado/pago por padrão, preferência `allow_paid_auto`, `admin-set-key xai` (validação real), chamada real com chave inválida + fallback, `auth/verify-code`. Antes: `delete from public.rate_limits;`.
- `npm run test:ratelimit` — bloqueio progressivo de login e cadastro sempre 403 (bloqueia seu IP por alguns minutos; limpe `rate_limits` depois).
- `node tests/e2e.mjs` — Playwright/Chromium contra o GitHub Pages (UI sem “Criar conta”, login com usuário de teste e com o dono real em modo leitura) (viewport iPhone 390×844, Android, desktop) com *screenshots*.
- `npm run test:e2e-qr` — Playwright: loga com usuário de teste, gera o QR em Ajustes, baixa o PNG, decodifica, loga pelo link com fragmento (URL limpa), por imagem da galeria e pela **câmera FAKE do Chromium** alimentada com vídeo do QR; erros de QR/permissão negada; confere que o código nunca vai em URL/query. **Câmera física de celular não foi testada.**

## Deploy
### Frontend (GitHub Pages)
O token usado para criar o repositório não tinha o escopo `workflow`, então o deploy padrão é pela branch **`gh-pages`**:
```bash
npm run deploy      # build + push do dist/ para a branch gh-pages (Settings → Pages → Source: gh-pages)
```
Para usar GitHub Actions no lugar: copie `docs/deploy-workflow.yml` para `.github/workflows/deploy.yml` (pelo site do GitHub ou com um token com escopo `workflow`) e em *Settings → Pages* escolha **Source: GitHub Actions**.

### Backend (Supabase)
Migrações em `supabase/migrations/` (aplique em ordem). Edge Functions (reimplante `auth data admin-set-key` após mudanças): com a CLI oficial `supabase functions deploy auth chat data admin-set-key --no-verify-jwt` (a autenticação é própria; `verify_jwt=false` de propósito) ou, sem CLI, `bash scripts/bundle-functions.sh` (gera `dist-fn/*.js` com Deno) e publique cada arquivo como `index.ts`.

## Como obter e cadastrar as chaves gratuitas
| Provedor | Onde obter a chave grátis |
|---|---|
| Groq | https://console.groq.com/keys |
| Google Gemini | https://aistudio.google.com/apikey |
| OpenRouter | https://openrouter.ai/settings/keys (use só modelos `:free`) |
| xAI Grok (**opcional, requer chave com créditos; pode gerar cobrança**) | https://console.x.ai |

As chaves **não** vão para o frontend nem para o Git. Ficam na tabela privada `server_secrets` e são gravadas pela Edge Function `admin-set-key`, protegida por um `ADMIN_TOKEN` aleatório (só o hash SHA-256 fica no banco; o token em texto puro fica fora do repositório):

```bash
# a chave vem da variável de ambiente PROVIDER_KEY (nunca como argumento)
PROVIDER_KEY='cole-aqui' bash scripts/set-provider-key.sh groq
PROVIDER_KEY='cole-aqui' bash scripts/set-provider-key.sh gemini
PROVIDER_KEY='cole-aqui' bash scripts/set-provider-key.sh openrouter
PROVIDER_KEY='cole-aqui' bash scripts/set-provider-key.sh xai          # OPCIONAL e PAGO: pode gerar cobrança na conta xAI da chave
bash scripts/set-provider-key.sh status            # quais estão configurados
bash scripts/set-provider-key.sh groq delete       # remover
```
A função valida a chave na API do provedor antes de gravar (recusa chaves inválidas). Alternativa: `scripts/set-provider-key.sql`. As funções também leem `Deno.env` primeiro (`KEY_GROQ`, `KEY_GEMINI`, `KEY_OPENROUTER`, `KEY_XAI`), caso você configure *secrets* nativos pelo painel.

## Limitações dos planos gratuitos (confira sempre a fonte oficial)
- **Nada é ilimitado.** Cada provedor limita requisições/tokens por minuto e/ou dia e pode mudar as regras.
- **Groq:** limites por modelo (RPM/RPD/TPM/TPD), compartilhados na organização; excedê-los devolve 429 — https://console.groq.com/docs/rate-limits
- **Gemini:** limites por projeto e por modelo (RPM, TPM, RPD; RPD zera à meia-noite do Pacífico); valores exatos no AI Studio — https://ai.google.dev/gemini-api/docs/rate-limits
- **OpenRouter `:free`:** segundo a documentação, 20 requisições/min e, com menos de 10 créditos comprados, 50 requisições/dia (1000/dia com ≥10 créditos) — https://openrouter.ai/docs/api-reference/limits
- **Pollinations anônimo:** sujeito a fila e limites por IP; sem garantia de disponibilidade — https://pollinations.ai
- **Supabase free:** projetos inativos podem ser pausados e há limites de uso/Edge Functions — https://supabase.com/pricing
- **xAI Grok:** sem plano gratuito garantido; cobrança por token na conta de quem criou a chave. Tiers, RPS e TPM: https://docs.x.ai/docs/key-information/consumption-and-rate-limits
- O app **nunca ativa cobrança** por conta própria: o único provedor que pode gerar custo (xAI) só existe com chave que o dono gravar e fica fora do Automático por padrão.
- Dados de planos gratuitos de alguns provedores podem ser usados para melhorar seus produtos (ex.: Gemini API gratuita): não envie dados sensíveis.

## Segurança
Veja `docs/SEGURANCA.md`. Nunca commite credenciais reais, token admin, pepper ou service role.


## PWA / service worker (cache do app)
`public/sw.js` (VERSION `v2`): `skipWaiting` + `clients.claim` (um SW novo assume na hora e apaga caches de versões antigas). A navegação (`index.html`) usa **rede primeiro com `cache: "no-cache"`** (revalida com o servidor mesmo com o `max-age=600` do GitHub Pages) e cai no cache só offline; assets têm hash no nome. Nunca intercepta chamadas à API. Se o app estiver desatualizado, a 1ª abertura após o deploy já traz o bundle novo; um bundle antigo continua conseguindo logar (o endpoint `auth/login` e o corpo não mudaram).
