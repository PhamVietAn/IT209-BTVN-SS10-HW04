const assert = require('node:assert/strict');
const { once } = require('node:events');
const { test } = require('node:test');
const { createServer } = require('./server.cjs');
const http = require('node:http');

async function start(t, pool) {
  const server = createServer(pool);
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => new Promise((resolve) => server.close(resolve)));
  return `http://127.0.0.1:${server.address().port}`;
}

test('API trạng thái phản ánh kết nối cơ sở dữ liệu', async (t) => {
  const url = await start(t, { query: async () => ({ rows: [{ result: 1 }] }) });
  const response = await fetch(`${url}/health`);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { status: 'ok', database: 'connected' });
});

test('API báo lỗi khi cơ sở dữ liệu không kết nối được', async (t) => {
  const url = await start(t, { query: async () => { throw new Error('Mất kết nối'); } });
  const response = await fetch(`${url}/health`);
  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), { status: 'error', database: 'disconnected' });
});

test('API từ chối JSON sai và tên rỗng', async (t) => {
  const url = await start(t, { query: async () => { throw new Error('Không được truy vấn'); } });
  for (const body of ['{', JSON.stringify({ name: '   ' })]) {
    const response = await fetch(`${url}/api/messages`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body
    });
    assert.equal(response.status, 400);
  }
});

test('Tên chứa ký tự SQL được gửi dưới dạng tham số', async (t) => {
  const name = "CrouAn244'); DROP TABLE messages; --";
  let queryText;
  let parameters;
  const url = await start(t, {
    query: async (text, values) => {
      queryText = text;
      parameters = values;
      return { rows: [{ id: 1, name }] };
    }
  });
  const response = await fetch(`${url}/api/messages`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name })
  });
  assert.equal(response.status, 201);
  assert.deepEqual(await response.json(), { id: 1, name });
  assert.equal(queryText, 'INSERT INTO messages (name) VALUES ($1) RETURNING id, name');
  assert.deepEqual(parameters, [name]);
});

test('API đọc danh sách dữ liệu từ cơ sở dữ liệu', async (t) => {
  const url = await start(t, {
    query: async () => ({ rows: [{ id: 1, name: 'CrouAn244' }] })
  });
  const response = await fetch(`${url}/api/messages`);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), [{ id: 1, name: 'CrouAn244' }]);
});

test('API giữ nguyên tiếng Việt khi ký tự UTF-8 bị chia giữa các gói dữ liệu', async (t) => {
  const url = await start(t, {
    query: async (_text, values) => ({ rows: [{ id: 2, name: values[0] }] })
  });
  const body = Buffer.from(JSON.stringify({ name: 'Tiếng Việt' }));
  const split = body.indexOf(Buffer.from('ế')) + 1;
  const response = await new Promise((resolve, reject) => {
    const request = http.request(`${url}/api/messages`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }
    }, (incoming) => {
      let data = '';
      incoming.setEncoding('utf8');
      incoming.on('data', (chunk) => { data += chunk; });
      incoming.on('end', () => resolve({ status: incoming.statusCode, data: JSON.parse(data) }));
    });
    request.on('error', reject);
    request.write(body.subarray(0, split));
    setTimeout(() => request.end(body.subarray(split)), 20);
  });
  assert.equal(response.status, 201);
  assert.deepEqual(response.data, { id: 2, name: 'Tiếng Việt' });
});
