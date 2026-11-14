import test from 'node:test';
import assert from 'node:assert/strict';
import worker, { isAllowedTarget } from '../worker/index.js';

test('Worker rejects local, private, and credentialed targets', () => {
  for (const url of [
    'http://localhost/', 'http://127.0.0.1/', 'http://10.1.2.3/',
    'http://172.16.0.1/', 'http://192.168.1.1/', 'http://169.254.169.254/',
    'http://[::1]/', 'http://example.com:8080/', 'http://user:pass@example.com/',
    'file:///etc/passwd', 'http://metadata.internal/'
  ]) assert.equal(isAllowedTarget(new URL(url)), false, url);
  assert.equal(isAllowedTarget(new URL('https://example.com/')), true);
});

test('Worker blocks redirect to private network before fetching it', async () => {
  const oldFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url) => {
    calls.push(url);
    return new Response(null, { status: 302, headers: { location: 'http://127.0.0.1/private' } });
  };
  try {
    const request = new Request('https://worker.example/?url=https%3A%2F%2Fexample.com');
    const response = await worker.fetch(request);
    assert.equal(response.status, 400);
    assert.equal((await response.json()).ok, false);
    assert.deepEqual(calls, ['https://example.com/']);
  } finally {
    globalThis.fetch = oldFetch;
  }
});

test('Worker rejects redirect response with no Location header', async () => {
  const oldFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(null, { status: 302 });
  try {
    const response = await worker.fetch(new Request('https://worker.example/?url=https%3A%2F%2Fexample.com'));
    const data = await response.json();
    assert.equal(data.ok, false);
    assert.equal(data.reason, 'http_error');
    assert.equal(data.httpStatus, 400);
  } finally {
    globalThis.fetch = oldFetch;
  }
});
