#!/usr/bin/env bash
# Reset do código do dono com entrega CIFRADA (usado pelo workflow do GitHub Actions; o repositório é público e os logs também).
# O servidor cifra o novo código com a CHAVE PÚBLICA (docs/reset-owner-pubkey.pem); aqui só existe o texto cifrado.
# O código em texto puro NUNCA passa pelo runner nem pelos logs. Quem decifra é o dono, com a chave privada que fica fora do repositório
# (scripts/receive-reset.sh). Este script grava o texto cifrado em OUT e não imprime nada sensível.
#   ADMIN_TOKEN=... bash scripts/reset-owner-encrypted.sh
set -euo pipefail
cd "$(dirname "$0")/.."
FN_URL="${FN_URL:-https://kvikbqjmtlthywbgxdii.supabase.co/functions/v1}"
PUBKEY_FILE="${PUBKEY_FILE:-docs/reset-owner-pubkey.pem}"
OUT="${OUT:-reset-owner.enc}"
[ -n "${ADMIN_TOKEN:-}" ] || { echo "ADMIN_TOKEN ausente (secret do repositório)." >&2; exit 1; }
[ -s "$PUBKEY_FILE" ] || { echo "Chave pública não encontrada: $PUBKEY_FILE" >&2; exit 1; }
RESP="$(mktemp)"; trap 'rm -f "$RESP"' EXIT
BODY="$(python3 -c 'import json,os,sys; d={"action":"admin-reset-owner","encrypt_to":open(sys.argv[1]).read()}; t=os.environ.get("TARGET_USER_ID"); d.update({"user_id":t} if t else {}); print(json.dumps(d))' "$PUBKEY_FILE")"
HTTP="$(curl -sS -o "$RESP" -w '%{http_code}' -X POST "$FN_URL/admin-set-key" -H 'content-type: application/json' -H "x-admin-token: $ADMIN_TOKEN" --data-binary "$BODY")"
if [ "$HTTP" != "200" ]; then echo "Falhou (HTTP $HTTP): $(cat "$RESP")" >&2; exit 1; fi
python3 - "$RESP" "$OUT" <<'PY'
import json, sys
j = json.load(open(sys.argv[1]))
assert "code" not in j and j.get("encrypted_code"), "resposta inesperada (sem texto cifrado ou com código em claro)"
open(sys.argv[2], "w").write(j["encrypted_code"] + "\n")
PY
echo "Reset concluído. Código novo gerado e CIFRADO em $OUT; nada sensível foi impresso."
