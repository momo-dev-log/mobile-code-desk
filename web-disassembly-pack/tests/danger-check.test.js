import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkDangerousContent } from '../js/danger-check.js';

test('APIキーらしき文字列を検出してマスクする', () => {
  const findings = checkDangerousContent([
    { label: 'JS', text: 'const apiKey = "sk_live_1234567890abcdef";' },
  ]);

  assert.equal(findings.length, 1);
  assert.equal(findings[0].label, 'JS');
  assert.equal(findings[0].type, 'APIキー/トークンらしき文字列');
  assert.notEqual(findings[0].preview, 'sk_live_1234567890abcdef');
  assert.ok(findings[0].preview.includes('...'));
});

test('メールアドレスを検出する', () => {
  const findings = checkDangerousContent([
    { label: 'HTML', text: '<a href="mailto:contact@example.com">contact</a>' },
  ]);

  assert.ok(findings.some((f) => f.type === 'メールアドレス'));
});

test('該当パターンが無い場合は空配列', () => {
  const findings = checkDangerousContent([
    { label: 'CSS', text: '.toolbar { position: fixed; }' },
  ]);

  assert.deepEqual(findings, []);
});
