#!/bin/sh
set -e

export PLAYWRIGHT_BROWSERS_PATH=0

BROWSER_PATH="$(node -e "const {chromium}=require('playwright'); console.log(chromium.executablePath())")"

need_deps=0
ldconfig -p 2>/dev/null | grep -q 'libnspr4.so' || need_deps=1
ldconfig -p 2>/dev/null | grep -q 'libatk-1.0.so.0' || need_deps=1

if [ ! -x "$BROWSER_PATH" ] || [ "$need_deps" = "1" ]; then
  echo "[bootstrap] Preparando Chromium/depêndencias do Playwright..."
  if [ "$need_deps" = "1" ] && command -v apt-get >/dev/null 2>&1; then
    npx playwright install --with-deps chromium
  else
    npx playwright install chromium
  fi
fi

exec "$@"
