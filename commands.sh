#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
cd -- "$SCRIPT_DIR"

# Git Bash không được tự đổi đường dẫn mount trong container sang đường dẫn Windows.
case "$(uname -s)" in
  MINGW*|MSYS*) export MSYS_NO_PATHCONV=1 ;;
esac

DB_USER="${APP_DB_USER:-CrouAn244}"
DB_PASSWORD="${APP_DB_PASSWORD:-CrouAn244@244}"
DB_NAME="${APP_DB_NAME:-appdb}"
APP_PORT="${APP_PORT:-3001}"
APP_URL="http://127.0.0.1:${APP_PORT}"
IMAGE="hw-backend:network"

for tool in docker curl; do
  command -v "$tool" >/dev/null || { printf 'Thiếu công cụ: %s\n' "$tool" >&2; exit 1; }
done
docker info >/dev/null

# Dừng khi trùng tên để không xóa nhầm container có sẵn.
for container in db-server app-container; do
  if docker container inspect "$container" >/dev/null 2>&1; then
    printf 'Container %s đã tồn tại. Hãy kiểm tra và dọn container của bài trước khi chạy lại.\n' "$container" >&2
    exit 1
  fi
done

# 1. Tạo Custom Bridge Network.
if ! docker network inspect app-net >/dev/null 2>&1; then
  docker network create --driver bridge app-net
fi
if [[ "$(docker network inspect --format '{{.Driver}}' app-net)" != 'bridge' ]]; then
  printf 'Network app-net phải sử dụng driver bridge.\n' >&2
  exit 1
fi

# 2. Tạo Named Volume.
if ! docker volume inspect db-data >/dev/null 2>&1; then
  docker volume create db-data
fi

docker build -t "$IMAGE" .

start_database() {
  docker run -d \
    --name db-server \
    --network app-net \
    --env "POSTGRES_USER=$DB_USER" \
    --env "POSTGRES_PASSWORD=$DB_PASSWORD" \
    --env "POSTGRES_DB=$DB_NAME" \
    --volume db-data:/var/lib/postgresql/data \
    --health-cmd 'pg_isready -h 127.0.0.1 -U "$POSTGRES_USER" -d "$POSTGRES_DB"' \
    --health-interval 2s --health-timeout 3s --health-retries 30 \
    postgres:15-alpine
}

wait_database() {
  for ((attempt=1; attempt<=60; attempt++)); do
    if [[ "$(docker inspect --format '{{.State.Health.Status}}' db-server)" == 'healthy' ]]; then
      return
    fi
    sleep 1
  done
  docker logs db-server >&2
  printf 'PostgreSQL không sẵn sàng sau thời gian chờ.\n' >&2
  exit 1
}

wait_backend() {
  for ((attempt=1; attempt<=30; attempt++)); do
    if curl -fsS --max-time 3 "$APP_URL/health" >/dev/null 2>&1; then
      return
    fi
    sleep 1
  done
  docker logs app-container >&2
  printf 'Backend không kết nối được cơ sở dữ liệu.\n' >&2
  exit 1
}

# 3. Chạy PostgreSQL, gắn volume và chờ dịch vụ sẵn sàng.
start_database
wait_database

# 4. Chạy backend với hostname DB là tên container.
docker run -d \
  --name app-container \
  --network app-net \
  --publish "127.0.0.1:${APP_PORT}:3000" \
  --env DB_HOST=db-server \
  --env DB_PORT=5432 \
  --env "DB_USER=$DB_USER" \
  --env "DB_PASSWORD=$DB_PASSWORD" \
  --env "DB_NAME=$DB_NAME" \
  "$IMAGE"
wait_backend

printf '\nKiểm tra network, volume và phân giải DNS:\n'
docker network ls --filter name=app-net
docker volume ls --filter name=db-data
docker network inspect app-net
docker exec app-container ping -c 2 db-server

# Mỗi lần chạy tạo một tên duy nhất để không nhầm với dữ liệu cũ.
MARKER="CrouAn244-$(date +%s)-${RANDOM}"
printf '\nThêm dữ liệu qua API:\n'
curl -fsS --max-time 5 -X POST "$APP_URL/api/messages" \
  -H 'Content-Type: application/json' \
  --data "{\"name\":\"${MARKER}\"}"
printf '\n\nDữ liệu trước khi xóa container DB:\n'
docker exec -i --env "PGPASSWORD=$DB_PASSWORD" db-server \
  psql -U "$DB_USER" -d "$DB_NAME" --set="marker=$MARKER" <<'SQL'
SELECT id, name FROM messages WHERE name = :'marker' ORDER BY id;
SQL

printf '\nXóa container DB, giữ nguyên volume db-data:\n'
docker rm -f db-server
start_database
wait_database
wait_backend

printf '\nDữ liệu sau khi tạo lại container DB:\n'
docker exec -i --env "PGPASSWORD=$DB_PASSWORD" db-server \
  psql -U "$DB_USER" -d "$DB_NAME" --set="marker=$MARKER" <<'SQL'
SELECT id, name FROM messages WHERE name = :'marker' ORDER BY id;
SQL

COUNT="$(docker exec -i --env "PGPASSWORD=$DB_PASSWORD" db-server \
  psql -U "$DB_USER" -d "$DB_NAME" -At --set="marker=$MARKER" <<'SQL'
SELECT COUNT(*) FROM messages WHERE name = :'marker';
SQL
)"
if [[ "$COUNT" != '1' ]]; then
  printf 'Kiểm tra thất bại: không tìm thấy đúng bản ghi đã thêm.\n' >&2
  exit 1
fi

printf '\nĐọc dữ liệu qua backend sau khi DB được tạo lại:\n'
MESSAGES="$(curl -fsS --max-time 5 "$APP_URL/api/messages")"
printf '%s\n' "$MESSAGES"
if ! printf '%s' "$MESSAGES" | grep -F "\"name\":\"${MARKER}\"" >/dev/null; then
  printf 'Backend chưa trả về bản ghi đã lưu.\n' >&2
  exit 1
fi
printf '\nKiểm tra thành công: dữ liệu vẫn còn trong volume db-data.\n'
