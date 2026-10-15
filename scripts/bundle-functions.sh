#!/usr/bin/env bash
# Empacota cada Edge Function (com supabase/functions/_shared) em UM arquivo em dist-fn/<nome>.js.
# Necessário porque o conector Supabase (deploy_edge_function) aceita poucos arquivos por chamada.
# Alternativa oficial: `supabase functions deploy <nome> --no-verify-jwt` (CLI), que resolve ../_shared sozinho.
# Requer Deno (https://deno.com). Uso: bash scripts/bundle-functions.sh [funcao ...]
set -euo pipefail
cd "$(dirname "$0")/../supabase/functions"
OUT="${OUT:-../../dist-fn}"
mkdir -p "$OUT"
DENO="${DENO:-deno}"
fns=("$@"); [ ${#fns[@]} -eq 0 ] && fns=(auth chat data admin-set-key)
for f in "${fns[@]}"; do
  "$DENO" bundle --platform=deno --external='npm:*' "$f/index.ts" -o "$OUT/$f.js" 2>&1 | grep -v experimental || true
  echo "ok: $OUT/$f.js"
done
