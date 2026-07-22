#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"

mkdir -p dist
OUT="dist/DC_IRP_만기안내문자.html"

{
  echo '<!doctype html>'
  echo '<html lang="ko">'
  echo '<head>'
  echo '<meta charset="UTF-8" />'
  echo '<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1" />'
  echo '<title>DC·IRP 만기예정 안내 문자</title>'
  echo '<style>'
  cat style.css
  echo '</style>'
  echo '</head>'
  echo '<body>'
  sed -n '/^<body>/,/^<script src="vendor/p' index.html | sed '1d;$d'
  echo '<script>'
  cat vendor/xlsx.full.min.js
  echo '</script>'
  echo '<script>'
  cat vendor/officecrypto.min.js
  echo '</script>'
  echo '<script>'
  cat app.js
  echo '</script>'
  echo '</body>'
  echo '</html>'
} > "$OUT"

echo "생성됨: $OUT"
