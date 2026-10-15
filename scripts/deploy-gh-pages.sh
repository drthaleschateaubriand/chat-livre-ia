#!/usr/bin/env bash
# Publica o build na branch `gh-pages` (Pages: Source = branch gh-pages, pasta /).
# Uso: npm run deploy   (requer git com permissão de push no repositório)
set -euo pipefail
cd "$(dirname "$0")/.."
npm run build
cp dist/index.html dist/404.html
touch dist/.nojekyll
REMOTE="$(git remote get-url origin)"
TMP="$(mktemp -d)"
cp -r dist/. "$TMP"/
cd "$TMP"
git init -q -b gh-pages
git add -A
git -c user.name="${GIT_AUTHOR_NAME:-deploy}" -c user.email="${GIT_AUTHOR_EMAIL:-deploy@users.noreply.github.com}" commit -q -m "deploy: $(date -u +%FT%TZ)"
git push -q -f "$REMOTE" gh-pages
echo "Publicado em gh-pages."
