# Funções comuns dos scripts do dono. Nunca imprimem o código; ele só é gravado em OWNER_CODE_FILE (modo 600, fora do repositório).
FN_URL="${FN_URL:-https://kvikbqjmtlthywbgxdii.supabase.co/functions/v1}"
TOKEN_FILE="${ADMIN_TOKEN_FILE:-/workspace/chat-livre-ia-private/admin_token.txt}"
OWNER_CODE_FILE="${OWNER_CODE_FILE:-/workspace/chat-livre-ia-private/owner_code.txt}"
if [ -z "${ADMIN_TOKEN:-}" ]; then
  [ -r "$TOKEN_FILE" ] || { echo "Token admin não encontrado em $TOKEN_FILE (ou defina ADMIN_TOKEN)." >&2; exit 1; }
  ADMIN_TOKEN="$(cat "$TOKEN_FILE")"
fi
# admin_call '<json>' <arquivo-de-saída>  -> grava o corpo da resposta no arquivo e devolve o status HTTP em $HTTP
admin_call() {
  HTTP="$(curl -sS -o "$2" -w '%{http_code}' -X POST "$FN_URL/admin-set-key" -H 'content-type: application/json' -H "x-admin-token: $ADMIN_TOKEN" --data-binary "$1")"
}
