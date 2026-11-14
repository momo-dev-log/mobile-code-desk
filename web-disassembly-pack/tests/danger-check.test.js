import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkDangerousContent, maskSensitive } from '../js/danger-check.js';

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

// ---- v0.4.2: 複合名のキーの検出（v0.4.1 で検出できていたものを再び検出する） ----
const SAMPLE_VALUE = 'AbCdEfGhIjKlMnOp1234';

test('前に語が付いた複合名のキー（access_token など）を検出する', () => {
  const samples = [
    `access_token = "${SAMPLE_VALUE}"`,
    `client_secret: "${SAMPLE_VALUE}"`,
    `refresh_token: '${SAMPLE_VALUE}'`,
    `authToken = "${SAMPLE_VALUE}"`,
    `API_TOKEN="${SAMPLE_VALUE}"`,
    `apiSecret: "${SAMPLE_VALUE}"`,
    `X-Auth-Token: ${SAMPLE_VALUE}`,
    `"token": "${SAMPLE_VALUE}"`,
    `api_key=${SAMPLE_VALUE}`,
  ];
  for (const text of samples) {
    const findings = checkDangerousContent([{ label: 'JS', text }]);
    assert.equal(findings.length, 1, `検出できていません: ${text}`);
    assert.equal(findings[0].type, 'APIキー/トークンらしき文字列');
  }
});

test('マスクはキー名と区切りを残し、値だけを置き換える（複合名でも同じ）', () => {
  const masked = maskSensitive(`const cfg = { client_secret: "${SAMPLE_VALUE}", name: "app" };`);
  assert.equal(masked.count, 1);
  assert.equal(masked.text, 'const cfg = { client_secret: "[WDP:マスク済み]", name: "app" };');
});

test('区切り（: か =）のない文章や、短い値は検出しない', () => {
  for (const text of ['// secret sauce: tune it', 'the token advectionStrength is used', 'token = "short"', 'author = "someLongAuthorNameHere"']) {
    assert.equal(checkDangerousContent([{ label: 'JS', text }]).length, 0, `誤検出: ${text}`);
  }
});

test('英数字の長い連続（base64など）でも時間がかからない', () => {
  const text = `${'QUJDREVGR0hJSktMTU5PUFFSU1RVVldYWVo'.repeat(6000)} token = "${SAMPLE_VALUE}"`;
  const started = Date.now();
  const findings = checkDangerousContent([{ label: 'JS', text }]);
  assert.ok(Date.now() - started < 2000, `時間がかかりすぎています: ${Date.now() - started}ms`);
  assert.equal(findings.length, 1);
});
