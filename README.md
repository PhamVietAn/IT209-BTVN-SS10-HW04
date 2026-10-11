## 1. Chạy script thiết lập

Mở terminal tại thư mục `ex04`. Dùng Bash trên Linux, WSL hoặc Git Bash, có `docker` và `curl`; Docker Desktop cần chạy ở chế độ Linux containers.

```bash
bash commands.sh
```

Nếu dùng Git Bash để chạy riêng các lệnh Docker bên dưới, đặt biến này trước để giữ nguyên đường dẫn Linux của volume:

```bash
export MSYS_NO_PATHCONV=1
```

Script thực hiện lần lượt:

1. Tạo Custom Bridge Network `app-net`.
2. Tạo Named Volume `db-data`.
3. Build image backend `hw-backend:network`, chạy container `db-server` từ `postgres:15-alpine`, tham gia `app-net` và mount `db-data` vào `/var/lib/postgresql/data`.
4. Chờ PostgreSQL sẵn sàng rồi chạy `app-container` trong `app-net`, truyền `DB_HOST=db-server` và các biến kết nối.
5. Kiểm tra DNS, thêm bản ghi qua API, xóa cứng container DB, tạo lại container với cùng volume rồi xác minh dữ liệu bằng SQL và API.

Script nằm trong `commands.sh`; mã backend, Dockerfile và manifest được lưu thành file riêng trong thư mục bài.

| Thành phần | Giá trị |
| --- | --- |
| Network | `app-net`, driver `bridge` |
| Volume | `db-data` |
| Container database | `db-server` |
| Image database | `postgres:15-alpine` |
| Đường dẫn mount | `/var/lib/postgresql/data` |
| Container backend | `app-container` |
| Image backend | `hw-backend:network` |
| Hostname DB trong backend | `db-server` |
| Cổng PostgreSQL nội bộ | `5432`, không publish ra host |
| Tài khoản database mặc định | `CrouAn244` |
| Mật khẩu thực hành mặc định | `CrouAn244@244` |
| Tên database mặc định | `appdb` |
| Địa chỉ backend trên host | `http://127.0.0.1:3001` |

Có thể thay thông tin kết nối hoặc cổng khi chạy script:

```bash
APP_DB_USER=CrouAn244 \
APP_DB_PASSWORD='CrouAn244@244' \
APP_DB_NAME=appdb \
APP_PORT=3001 \
bash commands.sh
```

Nếu `db-data` đã có dữ liệu PostgreSQL, tiếp tục sử dụng thông tin đăng nhập đã khởi tạo. Các biến `POSTGRES_USER`, `POSTGRES_PASSWORD` và `POSTGRES_DB` chỉ tạo tài khoản/database khi thư mục dữ liệu còn trống, theo [tài liệu PostgreSQL Official Image](https://hub.docker.com/_/postgres).

## 2. Kiểm tra network và volume

```bash
docker network ls | grep app-net
docker volume ls | grep db-data
docker network inspect app-net

docker inspect db-server \
  --format '{{range .Mounts}}{{.Type}} {{.Name}} -> {{.Destination}}{{println}}{{end}}'

docker inspect app-container \
  --format '{{range .Config.Env}}{{println .}}{{end}}' | grep DB_HOST
```

Docker Engine chưa chạy trong môi trường soạn bài. Các log Docker, IP nội bộ, ID tài nguyên và kết quả persistence trong README là **log minh họa**, chưa phải kết quả thực thi trên máy. `commands.sh` kiểm tra và báo lỗi nếu kết quả thực tế không đúng.

Log minh họa:

```text
$ docker network ls | grep app-net
bb870ad30244   app-net   bridge   local

$ docker volume ls | grep db-data
local   db-data

$ docker inspect db-server --format '{{range .Mounts}}{{.Type}} {{.Name}} -> {{.Destination}}{{println}}{{end}}'
volume db-data -> /var/lib/postgresql/data

$ docker inspect app-container --format '{{range .Config.Env}}{{println .}}{{end}}' | grep DB_HOST
DB_HOST=db-server
```

Phần thông tin liên quan trong `docker network inspect app-net`, minh họa:

```json
{
  "Name": "app-net",
  "Driver": "bridge",
  "Containers": {
    "9ab17d050244": {
      "Name": "db-server",
      "IPv4Address": "172.19.0.2/16"
    },
    "7cd20b890244": {
      "Name": "app-container",
      "IPv4Address": "172.19.0.3/16"
    }
  }
}
```

## 3. Kiểm tra phân giải DNS và API

```bash
docker exec -it app-container ping -c 2 db-server
curl -i http://127.0.0.1:3001/health
curl -i http://127.0.0.1:3001/api/messages
```

Log minh họa:

```text
PING db-server (172.19.0.2): 56 data bytes
64 bytes from 172.19.0.2: seq=0 ttl=64 time=0.145 ms
64 bytes from 172.19.0.2: seq=1 ttl=64 time=0.123 ms

--- db-server ping statistics ---
2 packets transmitted, 2 packets received, 0% packet loss

HTTP/1.1 200 OK
Content-Type: application/json; charset=utf-8

{"status":"ok","database":"connected"}
```

Custom Bridge Network cung cấp phân giải tên container qua DNS nội bộ. Backend kết nối `db-server:5432`; IP có thể đổi sau khi tạo lại container, nên cấu hình không gắn cố định IP. Cơ chế này được mô tả trong [tài liệu Bridge network của Docker](https://docs.docker.com/engine/network/drivers/bridge/).

Backend dùng thư viện `pg`, kiểm tra `SELECT 1` ở endpoint `/health` và tạo bảng `messages` khi khởi động. Nếu không kết nối được DB, `/health` trả mã `503` thay vì báo thành công.

| API | Phương thức | Chức năng |
| --- | --- | --- |
| `/health` | `GET` | Kiểm tra truy vấn DB |
| `/api/messages` | `POST` | Thêm bản ghi từ JSON có trường `name` |
| `/api/messages` | `GET` | Đọc các bản ghi theo thứ tự `id` |

## 4. Kiểm tra Data Persistence

Trong `commands.sh`, mỗi lần kiểm tra tạo một tên dạng `CrouAn244-<thời gian>-<số ngẫu nhiên>` để phân biệt với dữ liệu có sẵn. Ví dụ minh họa dưới đây dùng tên `CrouAn244-1791690000-244`.

Thêm dữ liệu qua backend:

```bash
curl -i -X POST http://127.0.0.1:3001/api/messages \
  -H 'Content-Type: application/json' \
  --data '{"name":"CrouAn244-1791690000-244"}'

docker exec db-server psql -U CrouAn244 -d appdb \
  -c "SELECT id, name FROM messages WHERE name = 'CrouAn244-1791690000-244';"
```

Log minh họa:

```text
HTTP/1.1 201 Created
Content-Type: application/json; charset=utf-8

{"id":1,"name":"CrouAn244-1791690000-244"}

 id |             name
----+------------------------------
  1 | CrouAn244-1791690000-244
(1 row)
```

Xóa cứng container DB và tạo container mới gắn lại đúng volume:

```bash
docker rm -f db-server

docker run -d \
  --name db-server \
  --network app-net \
  -e POSTGRES_USER=CrouAn244 \
  -e POSTGRES_PASSWORD='CrouAn244@244' \
  -e POSTGRES_DB=appdb \
  -v db-data:/var/lib/postgresql/data \
  --health-cmd 'pg_isready -h 127.0.0.1 -U "$POSTGRES_USER" -d "$POSTGRES_DB"' \
  --health-interval 2s --health-timeout 3s --health-retries 30 \
  postgres:15-alpine

# Chờ PostgreSQL nhận kết nối TCP trước khi truy vấn.
until docker exec db-server pg_isready -h 127.0.0.1 -U CrouAn244 -d appdb; do
  sleep 1
done

docker exec db-server psql -U CrouAn244 -d appdb \
  -c "SELECT id, name FROM messages WHERE name = 'CrouAn244-1791690000-244';"

curl -i http://127.0.0.1:3001/health
curl -i http://127.0.0.1:3001/api/messages
```

Log minh họa sau khi tạo lại DB:

```text
127.0.0.1:5432 - accepting connections

 id |             name
----+------------------------------
  1 | CrouAn244-1791690000-244
(1 row)

{"status":"ok","database":"connected"}
[{"id":1,"name":"CrouAn244-1791690000-244"}]

Kiểm tra thành công: dữ liệu vẫn còn trong volume db-data.
```

| Nội dung kiểm tra | Trước khi xóa DB | Sau khi tạo lại DB, kết quả minh họa |
| --- | --- | --- |
| Tên container database | `db-server` | `db-server`, container mới |
| Volume được gắn | `db-data` | `db-data` |
| Đường dẫn lưu dữ liệu | `/var/lib/postgresql/data` | `/var/lib/postgresql/data` |
| Bản ghi kiểm tra | `id=1`, tên đã thêm | Giữ nguyên `id` và tên |
| Kết quả truy vấn bản ghi | 1 dòng | 1 dòng |
| Backend truy vấn DB | Thành công | Thành công sau khi DB sẵn sàng |

Named Volume được quản lý riêng với container. `docker rm -f db-server` xóa container và lớp ghi của container, còn dữ liệu PostgreSQL nằm trong `db-data`. Container mới tiếp tục đọc thư mục dữ liệu khi mount lại cùng volume, theo [tài liệu Docker Volumes](https://docs.docker.com/engine/storage/volumes/).

## 5. Kiểm tra và chạy lại

```bash
docker logs db-server
docker logs app-container
docker ps --filter network=app-net

# Kiểm tra xử lý API trực tiếp, không yêu cầu Docker.
npm ci
npm test
```

Các bài kiểm tra API trực tiếp dùng đối tượng thay thế kết nối DB để kiểm tra phản hồi và truy vấn có tham số; không thay thế kiểm tra PostgreSQL, DNS và persistence bằng `commands.sh`.

Script dừng nếu đã tồn tại `db-server` hoặc `app-container`. Muốn chạy lại sau khi hoàn thành bài, xóa hai container của bài rồi chạy script; volume vẫn được giữ:

```bash
docker rm -f app-container db-server
bash commands.sh
```

Khi kết thúc thực hành, có thể dọn container và network, giữ dữ liệu:

```bash
docker rm -f app-container db-server
docker network rm app-net
docker volume inspect db-data
```

Khi nộp lên GitHub, đặt nội dung thư mục `ex04` vào `homework/session_10/ex4/`. Nộp `commands.sh`, `README.md` và các file backend, Dockerfile, manifest, lockfile để script có thể build image; không nộp `node_modules`.
