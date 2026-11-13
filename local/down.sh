#!/usr/bin/env bash
cd "$(dirname "$0")"
[ -f gateway.pid ] && kill "$(cat gateway.pid)" 2>/dev/null; rm -f gateway.pid
docker rm -f akana-db akana-auth akana-rest akana-storage akana-edge >/dev/null 2>&1
echo "Yerel yığın durduruldu."
