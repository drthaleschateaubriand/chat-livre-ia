#!/usr/bin/env bash
# Recebe o código novo de um reset feito pelo GitHub Actions: decifra o texto cifrado com a chave privada do dono
# e grava o código SOMENTE em OWNER_CODE_FILE (modo 600). Não imprime o código.
#   bash scripts/receive-reset.sh reset-owner.enc          # arquivo já baixado
#   bash scripts/receive-reset.sh                          # baixa o artefato da última execução (precisa do gh autenticado)
#   bash scripts/receive-reset.sh <run-id>
set -euo pipefail
KEY="${RESET_PRIVATE_KEY:-/workspace/chat-livre-ia-private/reset_private.pem}"
OWNER_CODE_FILE="${OWNER_CODE_FILE:-/workspace/chat-livre-ia-private/owner_code.txt}"
REPO="${REPO:-drthaleschateaubriand/chat-livre-ia}"
[ -r "$KEY" ] || { echo "Chave privada não encontrada: $KEY" >&2; exit 1; }
umask 077
D="$(mktemp -d)"; trap 'rm -rf "$D"' EXIT
ARG="${1:-}"
if [ -f "$ARG" ]; then ENC="$ARG"
else
  RUN="${ARG:-$(gh run list -R "$REPO" --workflow reset-owner.yml --status success --limit 1 --json databaseId --jq '.[0].databaseId')}"
  [ -n "$RUN" ] || { echo "Nenhuma execução bem-sucedida do workflow encontrada." >&2; exit 1; }
  gh run download "$RUN" -R "$REPO" -n reset-owner-enc -D "$D"; ENC="$D/reset-owner.enc"
fi
mkdir -p "$(dirname "$OWNER_CODE_FILE")"
TMP="$(mktemp "$(dirname "$OWNER_CODE_FILE")/.owner.XXXXXX")"
openssl base64 -d -A -in "$ENC" | openssl pkeyutl -decrypt -inkey "$KEY" -pkeyopt rsa_padding_mode:oaep -pkeyopt rsa_oaep_md:sha256 -pkeyopt rsa_mgf1_md:sha256 > "$TMP"
python3 -c 'import sys; c=open(sys.argv[1]).read().strip(); assert c.isdigit() and 18<=len(c)<=20, "decifragem falhou"; open(sys.argv[1],"w").write(c+"\n")' "$TMP" || { rm -f "$TMP"; exit 1; }
chmod 600 "$TMP"; mv -f "$TMP" "$OWNER_CODE_FILE"
echo "Código novo decifrado e gravado em $OWNER_CODE_FILE (modo 600); não é exibido aqui."
