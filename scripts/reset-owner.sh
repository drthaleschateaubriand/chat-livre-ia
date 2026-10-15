#!/usr/bin/env bash
# Gera um NOVO código para o dono (mesmo usuário): atualiza o hash, REVOGA todas as sessões e MANTÉM todo o histórico.
# O código antigo deixa de funcionar. O novo é gravado SOMENTE em OWNER_CODE_FILE (modo 600); não é impresso.
#   bash scripts/reset-owner.sh --yes
set -euo pipefail
[ "${1:-}" = "--yes" ] || { echo "Isto invalida o código atual e desconecta todos os dispositivos. Rode com --yes para confirmar." >&2; exit 2; }
cd "$(dirname "$0")"; . ./_owner_lib.sh
umask 077
mkdir -p "$(dirname "$OWNER_CODE_FILE")"
RESP="$(mktemp)"; TMP="$(mktemp "$(dirname "$OWNER_CODE_FILE")/.owner.XXXXXX")"
trap 'rm -f "$RESP" "$TMP"' EXIT
admin_call '{"action":"admin-reset-owner"}' "$RESP"
if [ "$HTTP" != "200" ]; then echo "Falhou (HTTP $HTTP): $(cat "$RESP")" >&2; exit 1; fi
python3 -c 'import json,sys; c=json.load(open(sys.argv[1]))["code"]; assert c.isdigit() and 18<=len(c)<=20; open(sys.argv[2],"w").write(c+"\n")' "$RESP" "$TMP"
chmod 600 "$TMP"; mv -f "$TMP" "$OWNER_CODE_FILE"
echo "Código do dono trocado, sessões revogadas, histórico preservado. Novo código em $OWNER_CODE_FILE (modo 600); não é exibido aqui."
