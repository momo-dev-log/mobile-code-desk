import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { APP_VERSION } from '../js/constants.js';

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');
const number = APP_VERSION.replace(/^v/, '');

test('index.html の main.js 読み込み指定が APP_VERSION と一致する', () => {
  const matches = [...read('../index.html').matchAll(/main\.js\?v=([\w.]+)/g)].map((m) => m[1]);
  assert.deepEqual(matches, [number]);
});

test('Service Worker のキャッシュ識別子が APP_VERSION と一致する', () => {
  const match = read('../sw.js').match(/CACHE_NAME\s*=\s*'([^']+)'/);
  assert.ok(match, 'CACHE_NAME が見つかりません');
  assert.equal(match[1], `web-disassembly-pack-${APP_VERSION}`);
});
