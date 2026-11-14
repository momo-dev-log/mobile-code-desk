import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { fetchResource } from '../js/fetch.js';
import { WORKER_URL } from '../js/constants.js';

const originalFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = originalFetch; });

test('待ち時間を指定しない呼び出し（通常解析）は、従来どおり fetch(endpoint) だけを呼び、打ち切らない', async () => {
  const calls = [];
  globalThis.fetch = async (...args) => {
    calls.push(args);
    return { json: async () => ({ ok: true, content: 'a' }) };
  };
  const result = await fetchResource('https://site.example/a.js');
  assert.deepEqual(calls, [[`${WORKER_URL}/?url=${encodeURIComponent('https://site.example/a.js')}`]]);
  assert.deepEqual(result, { ok: true, content: 'a' });
});

test('待ち時間を指定すると、その時間で打ち切って timeout を返す（成功扱いにしない）', async () => {
  globalThis.fetch = (endpoint, { signal }) => new Promise((resolve, reject) => {
    signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
  });
  const started = Date.now();
  const result = await fetchResource('https://site.example/slow.js', { timeoutMs: 50 });
  assert.deepEqual(result, { ok: false, reason: 'timeout' });
  assert.ok(Date.now() - started < 1000);
});

test('応答本文の読み取り中に時間切れになっても timeout を返す', async () => {
  globalThis.fetch = async (endpoint, { signal }) => ({
    json: () => new Promise((resolve, reject) => {
      signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
    }),
  });
  assert.deepEqual(await fetchResource('https://site.example/body.js', { timeoutMs: 30 }), { ok: false, reason: 'timeout' });
});

test('時間内に返った結果はそのまま返し、失敗の理由も変えない', async () => {
  globalThis.fetch = async () => ({ json: async () => ({ ok: false, reason: 'http_error', httpStatus: 404 }) });
  assert.deepEqual(await fetchResource('https://site.example/x.js', { timeoutMs: 1000 }), { ok: false, reason: 'http_error', httpStatus: 404 });
  globalThis.fetch = async () => { throw new TypeError('network down'); };
  assert.deepEqual(await fetchResource('https://site.example/y.js', { timeoutMs: 1000 }), { ok: false, reason: 'network' });
});
