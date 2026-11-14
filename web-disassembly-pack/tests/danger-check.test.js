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

test('JavaScript識別子と画像パスは機密情報として検出しない', async () => {
  const { maskSensitive } = await import('../js/danger-check.js');
  const code = 'getAccessTokenFromStorage(); firebaseAuthInstance; url(img/icon@2x.png)';
  assert.equal(maskSensitive(code).text, code);
  assert.deepEqual(checkDangerousContent([{ label: 'JS', text: code }]), []);
});

test('実際のキー代入はマスクする', async () => {
  const { maskSensitive } = await import('../js/danger-check.js');
  const source = 'const apiKey = "sk_live_1234567890abcdef";';
  const result = maskSensitive(source);
  assert.ok(result.count > 0);
  assert.ok(!result.text.includes('sk_live_1234567890abcdef'));
});

test('引用符付きJSONキーの機密値もマスクする', async () => {
  const { maskSensitive } = await import('../js/danger-check.js');
  const code = '{"api_key":"sk_live_1234567890abcdef","token": "abcdefghijklmnopqrstuvwxyz"}';
  const masked = maskSensitive(code);
  assert.equal(masked.count, 2);
  assert.ok(!masked.text.includes('sk_live_1234567890abcdef'));
  assert.ok(!masked.text.includes('abcdefghijklmnopqrstuvwxyz'));
  assert.ok(masked.text.includes('"api_key":'));
  assert.ok(masked.text.includes('"token":'));
});
