const http = require('node:http');

function send(response, status, data) {
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  response.end(JSON.stringify(data));
}

function createServer(pool) {
  return http.createServer(async (request, response) => {
    const pathname = new URL(request.url, 'http://localhost').pathname;
    try {
      if (request.method === 'GET' && pathname === '/health') {
        await pool.query('SELECT 1 AS result');
        send(response, 200, { status: 'ok', database: 'connected' });
        return;
      }

      if (request.method === 'GET' && pathname === '/api/messages') {
        const result = await pool.query('SELECT id, name FROM messages ORDER BY id');
        send(response, 200, result.rows);
        return;
      }

      if (request.method === 'POST' && pathname === '/api/messages') {
        request.setEncoding('utf8');
        let body = '';
        for await (const chunk of request) {
          body += chunk;
          if (Buffer.byteLength(body) > 4096) {
            send(response, 413, { error: 'Dữ liệu gửi lên quá lớn.' });
            return;
          }
        }
        let data;
        try {
          data = JSON.parse(body);
        } catch {
          send(response, 400, { error: 'JSON không hợp lệ.' });
          return;
        }
        const name = typeof data?.name === 'string' ? data.name.trim() : '';
        if (!name || name.length > 100) {
          send(response, 400, { error: 'Tên phải có từ 1 đến 100 ký tự.' });
          return;
        }
        const result = await pool.query(
          'INSERT INTO messages (name) VALUES ($1) RETURNING id, name', [name]
        );
        send(response, 201, result.rows[0]);
        return;
      }

      send(response, 404, { error: 'Không tìm thấy API.' });
    } catch (error) {
      console.error('Lỗi truy vấn cơ sở dữ liệu:', error.message);
      if (pathname === '/health') {
        send(response, 503, { status: 'error', database: 'disconnected' });
      } else {
        send(response, 503, { error: 'Cơ sở dữ liệu chưa sẵn sàng.' });
      }
    }
  });
}

if (require.main === module) {
  const { Pool } = require('pg');
  const pool = new Pool({
    host: process.env.DB_HOST || 'db-server',
    port: Number(process.env.DB_PORT || 5432),
    user: process.env.DB_USER || 'CrouAn244',
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME || 'appdb',
    connectionTimeoutMillis: 3000
  });

  pool.on('error', (error) => console.error('Kết nối PostgreSQL bị ngắt:', error.message));

  pool.query('CREATE TABLE IF NOT EXISTS messages (id SERIAL PRIMARY KEY, name VARCHAR(100) NOT NULL)')
    .then(() => {
      const server = createServer(pool);
      server.listen(Number(process.env.PORT || 3000), '0.0.0.0', () => {
        console.log('Backend đã kết nối PostgreSQL qua hostname ' + (process.env.DB_HOST || 'db-server'));
      });
      process.on('SIGTERM', () => {
        server.close(() => pool.end().then(() => process.exit(0)));
      });
    })
    .catch((error) => {
      console.error('Không thể khởi tạo cơ sở dữ liệu:', error.message);
      pool.end().finally(() => process.exit(1));
    });
}

module.exports = { createServer };
