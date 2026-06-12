import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeUrl } from '../js/normalize.js';

// docs/spec.md 7章「正規化テストケース」13本
test('1. スキーム・ホストを小文字化する', () => {
  assert.equal(normalizeUrl('HTTPS://Example.COM/Page'), 'https://example.com/Page');
});

test('2. utm_*パラメータを除去する', () => {
  assert.equal(normalizeUrl('https://example.com/a?utm_source=x&id=3'), 'https://example.com/a?id=3');
});

test('3. 追跡対象外のクエリパラメータはそのまま保持する', () => {
  assert.equal(normalizeUrl('https://example.com/a?page=2'), 'https://example.com/a?page=2');
});

test('4. フラグメントを除去する', () => {
  assert.equal(normalizeUrl('https://example.com/a#section'), 'https://example.com/a');
});

test('5. ルートパスのみの末尾スラッシュを除去する', () => {
  assert.equal(normalizeUrl('https://example.com/'), 'https://example.com');
});

test('6. 記事パスの末尾スラッシュは保持する', () => {
  assert.equal(normalizeUrl('https://example.com/a/'), 'https://example.com/a/');
});

test('7. デフォルトポート(443)を除去する', () => {
  assert.equal(normalizeUrl('https://example.com:443/a'), 'https://example.com/a');
});

test('8. httpからhttpsへの昇格はしない', () => {
  assert.equal(normalizeUrl('http://example.com/a'), 'http://example.com/a');
});

test('9. 残りのクエリパラメータをキー名でソートする', () => {
  assert.equal(normalizeUrl('https://example.com/a?b=2&a=1'), 'https://example.com/a?a=1&b=2');
});

test('10. 前後の空白を除去する', () => {
  assert.equal(normalizeUrl(' https://example.com/a '), 'https://example.com/a');
});

test('11. fbclidパラメータを除去する', () => {
  assert.equal(normalizeUrl('https://example.com/a?fbclid=xyz'), 'https://example.com/a');
});

test('12. モバイル版URL(m.〜)はPC版と同一視しない', () => {
  assert.equal(normalizeUrl('https://m.example.com/a'), 'https://m.example.com/a');
});

test('13. 同URLを再投入しても同一の正規化結果になる（重複ガードの前提）', () => {
  const first = normalizeUrl('HTTPS://Example.COM/Page');
  const second = normalizeUrl('HTTPS://Example.COM/Page');
  assert.equal(first, second);
  assert.equal(second, 'https://example.com/Page');
});
