#!/usr/bin/env bash
# =============================================================================
# Yerel Supabase test yığını (Postgres + Auth + PostgREST + Storage + Edge
# Runtime). Supabase CLI'ın `supabase start` komutunun kullanılamadığı
# ortamlarda migration'ları ve güvenlik testlerini GERÇEK servislerle
# çalıştırmak içindir. Üretim için değildir; anahtarlar her kurulumda
# rastgele üretilir ve local/.env.local dosyasına yazılır.
# =============================================================================
set -euo pipefail
cd "$(dirname "$0")"
ROOT="$(cd .. && pwd)"

PG_IMAGE="${PG_IMAGE:-supabase/postgres:15.19.0.019}"
AUTH_IMAGE="${AUTH_IMAGE:-supabase/gotrue:v2.198.0-rc.41}"
REST_IMAGE="${REST_IMAGE:-postgrest/postgrest:v12.2.3}"
STORAGE_IMAGE="${STORAGE_IMAGE:-supabase/storage-api:v1.94.2}"
EDGE_IMAGE="${EDGE_IMAGE:-supabase/edge-runtime:v1.78.1}"

bash ./down.sh >/dev/null 2>&1 || true

PGPASS="$(openssl rand -hex 16)"
JWT_SECRET="$(openssl rand -hex 32)"
eval "$(node keys.mjs "$JWT_SECRET")"
cat > .env.local <<ENV
SUPABASE_URL=http://127.0.0.1:54321
ANON_KEY=$ANON_KEY
SERVICE_ROLE_KEY=$SERVICE_ROLE_KEY
DB_URL=postgres://postgres:$PGPASS@127.0.0.1:5432/postgres
ENV
chmod 600 .env.local

echo "==> Postgres"
docker run -d --name akana-db --network host \
  -e POSTGRES_PASSWORD="$PGPASS" -e JWT_SECRET="$JWT_SECRET" -e JWT_EXP=3600 \
  "$PG_IMAGE" >/dev/null
export PGPASSWORD="$PGPASS"
for i in $(seq 1 90); do
  if psql -h 127.0.0.1 -U supabase_admin -d postgres -Atc "select 1" >/dev/null 2>&1; then break; fi
  sleep 1
done
sleep 3
psql -h 127.0.0.1 -U supabase_admin -d postgres -v ON_ERROR_STOP=1 -q <<SQL
alter user authenticator with password '$PGPASS';
alter user supabase_auth_admin with password '$PGPASS';
alter user supabase_storage_admin with password '$PGPASS';
alter user postgres with password '$PGPASS';
SQL

echo "==> Auth (GoTrue)"
docker run -d --name akana-auth --network host \
  -e GOTRUE_API_HOST=127.0.0.1 -e GOTRUE_API_PORT=9999 \
  -e API_EXTERNAL_URL=http://127.0.0.1:54321/auth/v1 \
  -e GOTRUE_DB_DRIVER=postgres \
  -e GOTRUE_DB_DATABASE_URL="postgres://supabase_auth_admin:$PGPASS@127.0.0.1:5432/postgres" \
  -e GOTRUE_SITE_URL=http://127.0.0.1:5173 \
  -e GOTRUE_DISABLE_SIGNUP=true \
  -e GOTRUE_JWT_ADMIN_ROLES=service_role -e GOTRUE_JWT_AUD=authenticated \
  -e GOTRUE_JWT_DEFAULT_GROUP_NAME=authenticated -e GOTRUE_JWT_EXP=3600 \
  -e GOTRUE_JWT_SECRET="$JWT_SECRET" \
  -e GOTRUE_EXTERNAL_EMAIL_ENABLED=true -e GOTRUE_MAILER_AUTOCONFIRM=true \
  "$AUTH_IMAGE" >/dev/null

echo "==> PostgREST"
docker run -d --name akana-rest --network host \
  -e PGRST_DB_URI="postgres://authenticator:$PGPASS@127.0.0.1:5432/postgres" \
  -e PGRST_DB_SCHEMAS=public -e PGRST_DB_ANON_ROLE=anon \
  -e PGRST_JWT_SECRET="$JWT_SECRET" -e PGRST_DB_USE_LEGACY_GUCS=false \
  -e PGRST_SERVER_HOST=127.0.0.1 -e PGRST_SERVER_PORT=3000 \
  "$REST_IMAGE" >/dev/null

echo "==> Storage"
docker run -d --name akana-storage --network host \
  -e SERVER_HOST=127.0.0.1 -e SERVER_PORT=5000 \
  -e ANON_KEY="$ANON_KEY" -e SERVICE_KEY="$SERVICE_ROLE_KEY" \
  -e AUTH_JWT_SECRET="$JWT_SECRET" -e PGRST_JWT_SECRET="$JWT_SECRET" \
  -e POSTGREST_URL=http://127.0.0.1:3000 \
  -e DATABASE_URL="postgres://supabase_storage_admin:$PGPASS@127.0.0.1:5432/postgres" \
  -e FILE_SIZE_LIMIT=524288000 -e STORAGE_BACKEND=file \
  -e FILE_STORAGE_BACKEND_PATH=/var/lib/storage \
  -e TENANT_ID=stub -e REGION=stub -e GLOBAL_S3_BUCKET=stub \
  -e ENABLE_IMAGE_TRANSFORMATION=false \
  "$STORAGE_IMAGE" >/dev/null

echo "==> Servislerin hazır olması bekleniyor"
wait_http() { for i in $(seq 1 90); do curl -fsS -o /dev/null "$1" 2>/dev/null && return 0; sleep 1; done; echo "HAZIR DEĞİL: $1"; return 1; }
wait_http http://127.0.0.1:9999/health
wait_http http://127.0.0.1:3000/
wait_http http://127.0.0.1:5000/status

echo "==> Migration'lar uygulanıyor"
for f in "$ROOT"/supabase/migrations/*.sql; do
  echo "    $(basename "$f")"
  psql -h 127.0.0.1 -U postgres -d postgres -v ON_ERROR_STOP=1 -q -f "$f"
done
psql -h 127.0.0.1 -U postgres -d postgres -q -c "notify pgrst, 'reload schema'"

echo "==> Edge Runtime (admin-users)"
if docker image inspect "$EDGE_IMAGE" >/dev/null 2>&1; then
  docker run -d --name akana-edge --network host \
    -v "$ROOT/supabase/functions:/home/deno/functions:ro" \
    -e SUPABASE_URL=http://127.0.0.1:54321 \
    -e SUPABASE_SERVICE_ROLE_KEY="$SERVICE_ROLE_KEY" \
    "$EDGE_IMAGE" start --main-service /home/deno/functions/admin-users -p 9000 >/dev/null
  # Fonksiyon dinlemeye başlayana kadar bekle (ilk açılış birkaç saniye sürebilir)
  for i in $(seq 1 60); do
    curl -s -o /dev/null -X POST http://127.0.0.1:9000/ -d '{}' && break
    sleep 1
  done
  # İsteğe bağlı YZ modülü (ANTHROPIC_API_KEY ortamda varsa iletilir; yoksa 503 döner)
  # Kurumsal proxy arkasında npm paketi indirebilmek için proxy/CA ayarları (varsa) iletilir
  EDGE_NET_ARGS=()
  [ -n "${HTTPS_PROXY:-}" ] && EDGE_NET_ARGS+=(-e "HTTPS_PROXY=$HTTPS_PROXY" -e "HTTP_PROXY=${HTTP_PROXY:-$HTTPS_PROXY}" -e "NO_PROXY=${NO_PROXY:-localhost,127.0.0.1}")
  [ -n "${SSL_CERT_FILE:-}" ] && [ -f "$SSL_CERT_FILE" ] && EDGE_NET_ARGS+=(-v "$SSL_CERT_FILE:/etc/ssl/certs/ca-certificates.crt:ro" -e DENO_TLS_CA_STORE=system)
  docker run -d --name akana-edge-ai --network host "${EDGE_NET_ARGS[@]}" \
    -v "$ROOT/supabase/functions:/home/deno/functions:ro" \
    -e SUPABASE_URL=http://127.0.0.1:54321 \
    -e SUPABASE_ANON_KEY="$ANON_KEY" \
    -e ANTHROPIC_API_KEY="${ANTHROPIC_API_KEY:-}" \
    "$EDGE_IMAGE" start --main-service /home/deno/functions/ai-insights -p 9001 >/dev/null
else
  echo "    UYARI: $EDGE_IMAGE bulunamadı; admin-users fonksiyonu çalışmayacak."
fi

echo "==> API geçidi"
nohup node gateway.mjs > gateway.log 2>&1 &
echo $! > gateway.pid
sleep 1
echo "Hazır: http://127.0.0.1:54321  (anahtarlar: local/.env.local)"
