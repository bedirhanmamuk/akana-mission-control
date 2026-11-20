#!/usr/bin/env bash
# AKANA Yer İstasyonu - Linux/macOS başlatıcı
set -e
cd "$(dirname "$0")"
if [ ! -d .venv ]; then
  echo "İlk kurulum yapılıyor..."
  python3 -m venv .venv
  .venv/bin/python -m pip install -q -r requirements.txt
fi
[ -f ui/openmct/openmct.js ] || { echo "ui/openmct eksik: README'deki 'npm run kur' adımını yapın."; exit 1; }
echo "Yer istasyonu açılıyor: http://127.0.0.1:8000"
exec .venv/bin/python -m yi_core --open "$@"
