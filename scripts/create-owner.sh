#!/usr/bin/env bash
# Cria a conta ÚNICA do dono (app privado). Só funciona se ainda NÃO existir dono.
# O código de 19 dígitos é gerado no servidor, mostrado UMA vez e gravado SOMENTE em OWNER_CODE_FILE
# (padrão /workspace/chat-livre-ia-private/owner_code.txt, modo 600). Este script NÃO imprime o código.
#   bash scripts/create-owner.sh
set -euo pipefail
cd "$(dirname "$0")"; . ./_owner_lib.sh
umask 077
mkdir -p "$(dirname "$OWNER_CODE_FILE")"
RESP="$(mktemp)"; TMP="$(mktemp "$(dirname "$OWNER_CODE_FILE")/.owner.XXXXXX")"
trap 'rm -f "$RESP" "$TMP"' EXIT
admin_call '{"action":"admin-create-owner"}' "$RESP"
if [ "$HTTP" != "200" ]; then echo "Falhou (HTTP $HTTP): $(cat "$RESP")" >&2; exit 1; fi
python3 -c 'import json,sys; c=json.load(open(sys.argv[1]))["code"]; assert c.isdigit() and 18<=len(c)<=20; open(sys.argv[2],"w").write(c+"\n")' "$RESP" "$TMP"
chmod 600 "$TMP"; mv -f "$TMP" "$OWNER_CODE_FILE"
echo "Dono criado. Código gravado em $OWNER_CODE_FILE (modo 600); não é exibido aqui."
