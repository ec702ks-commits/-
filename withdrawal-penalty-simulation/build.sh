#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"

mkdir -p dist
OUT="dist/중도해지_패널티_시뮬레이션.html"

{
  echo '<!doctype html>'
  echo '<html lang="ko">'
  echo '<head>'
  echo '<meta charset="UTF-8" />'
  echo '<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1" />'
  echo '<meta name="color-scheme" content="light dark" />'
  echo '<title>중도해지 패널티 시뮬레이션</title>'
  echo '<style>'
  cat style.css
  echo '</style>'
  echo '</head>'
  echo '<body>'
  sed -n '/^<body>/,/^<script src="vendor\/xlsx.full.min.js/p' index.html | sed '1d;$d'
  echo '<script>'
  cat vendor/xlsx.full.min.js
  echo '</script>'
  echo '<script>'
  cat vendor/pdf.min.js
  echo '</script>'
  echo '<script type="text/plain" id="pdfWorkerSrc">'
  cat vendor/pdf.worker.min.js
  echo '</script>'
  echo '<script>'
  cat vendor/html2canvas.min.js
  echo '</script>'
  echo '<script>'
  cat vendor/jspdf.umd.min.js
  echo '</script>'
  echo '<script>'
  cat app.js
  echo '</script>'
  echo '</body>'
  echo '</html>'
} > "$OUT"

echo "생성됨: $OUT"
