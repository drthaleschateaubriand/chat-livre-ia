#!/usr/bin/env bash
# Cadastra (ou remove) a chave de um provedor de IA de forma segura, SEM expor a chave no chat/histórico do shell.
#
#   PROVIDER_KEY='...sua chave...' bash scripts/set-provider-key.sh groq          # grava (valida na API do provedor)
#   PROVIDER_KEY='xai-...' bash scripts/set-provider-key.sh xai                    # OPCIONAL/PAGO: pode gerar cobrança na conta xAI do dono da chave
#   bash scripts/set-provider-key.sh status                                         # mostra quais estão configurados
#   bash scripts/set-provider-key.sh gemini delete                                  # remove
#   bash scripts/set-provider-key.sh openrouter clear-cooldown                      # limpa pausa (circuit breaker)
#
# A chave é lida SOMENTE da variável de ambiente PROVIDER_KEY (nunca de argumento de linha de comando).
# Token admin: arquivo ADMIN_TOKEN_FILE (padrão /workspace/chat-livre-ia-private/admin_token.txt) ou variável ADMIN_TOKEN.
# A Edge Function `admin-set-key` compara o hash SHA-256 do token com o guardado em public.server_secrets.
set -euo pipefail
FN_URL="${FN_URL:-https://kvikbqjmtlthywbgxdii.supabase.co/functions/v1}"
TOKEN_FILE="${ADMIN_TOKEN_FILE:-/workspace/chat-livre-ia-private/admin_token.txt}"
if [ -z "${ADMIN_TOKEN:-}" ]; then
  [ -r "$TOKEN_FILE" ] || { echo "Token admin não encontrado em $TOKEN_FILE (ou defina ADMIN_TOKEN)." >&2; exit 1; }
  ADMIN_TOKEN="$(cat "$TOKEN_FILE")"
fi
provider="${1:-}"; action="${2:-set}"
if [ "$provider" = "status" ]; then provider="groq"; action="status"; fi
case "$provider" in groq|gemini|openrouter|pollinations|xai) ;; *) echo "uso: PROVIDER_KEY=... $0 {groq|gemini|openrouter|xai} [set|delete|clear-cooldown] | $0 status" >&2; exit 2;; esac
if [ "$action" = "set" ]; then
  [ -n "${PROVIDER_KEY:-}" ] || { echo "Defina a variável PROVIDER_KEY (a chave NÃO é aceita como argumento)." >&2; exit 2; }
  body=$(PROVIDER_KEY="$PROVIDER_KEY" python3 -c 'import json,os,sys; print(json.dumps({"action":"set","provider":sys.argv[1],"key":os.environ["PROVIDER_KEY"]}))' "$provider")
else
  body=$(python3 -c 'import json,sys; print(json.dumps({"action":sys.argv[2],"provider":sys.argv[1]}))' "$provider" "$action")
fi
curl -sS -X POST "$FN_URL/admin-set-key" -H "content-type: application/json" -H "x-admin-token: $ADMIN_TOKEN" --data-binary "$body"
echo
