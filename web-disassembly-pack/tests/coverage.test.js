import { test } from 'node:test';
import assert from 'node:assert/strict';
import { truncateForAnalysis, buildInlineEntry } from '../js/coverage.js';
import { buildMarkdown } from '../js/markdown.js';
import { JS_FEATURE_CHECKS, CSS_EXCERPT_CATEGORIES, JS_EXCERPT_CATEGORIES } from '../js/keywords.js';
import { LIBRARY_CHECKS } from '../js/libraries.js';
import { MAX_RESOURCE_CHARS } from '../js/constants.js';

// -----------------------------------------------
// テスト用データ
// -----------------------------------------------
function baseData(overrides = {}) {
  return {
    pageUrl: 'https://example.com/',
    finalUrl: 'https://example.com/',
    title: 'Example',
    structure: {
      canvas: 0, button: 0, audio: 0, video: 0, svg: 0,
      inlineScriptCount: 0, externalScriptCount: 0,
      inlineStyleCount: 0, externalStylesheetCount: 0,
    },
    jsFeatures: JS_FEATURE_CHECKS.map(({ key, label }) => ({ key, label, value: 'なし' })),
    libraries: LIBRARY_CHECKS.map(({ key, label }) => ({ key, label, value: 'なし' })),
    cssExcerpts: CSS_EXCERPT_CATEGORIES.map(({ key, label }) => ({ key, label, excerpts: [] })),
    jsExcerpts: JS_EXCERPT_CATEGORIES.map(({ key, label }) => ({ key, label, excerpts: [] })),
    cssResources: [],
    jsResources: [],
    dangerFindings: [],
    htmlChars: 1000,
    inlineStyles: [],
    inlineScripts: [],
    ...overrides,
  };
}

function okEntry(url, text) {
  return { label: url, status: 'ok', ...truncateForAnalysis(text) };
}

// 「取得・解析範囲」セクションだけを取り出す
function coverageSection(markdown) {
  const start = markdown.indexOf('## 取得・解析範囲');
  const end = markdown.indexOf('\n## ', start + 1);
  assert.ok(start !== -1, '「取得・解析範囲」セクションがありません');
  return markdown.slice(start, end === -1 ? undefined : end);
}

const WARN_TRUNCATED = '全コードを解析済みと判断することはできません';

// -----------------------------------------------
// truncateForAnalysis / buildInlineEntry
// -----------------------------------------------
test('上限以下の本文は切り詰めない', () => {
  const text = 'a'.repeat(MAX_RESOURCE_CHARS);
  const result = truncateForAnalysis(text);
  assert.equal(result.size, MAX_RESOURCE_CHARS);
  assert.equal(result.analyzedChars, MAX_RESOURCE_CHARS);
  assert.equal(result.truncated, false);
  assert.equal(result.rawText, text);
});

test('上限を1文字でも超えると切り詰める', () => {
  const result = truncateForAnalysis('a'.repeat(MAX_RESOURCE_CHARS + 1));
  assert.equal(result.size, MAX_RESOURCE_CHARS + 1);
  assert.equal(result.analyzedChars, MAX_RESOURCE_CHARS);
  assert.equal(result.truncated, true);
  assert.equal(result.rawText.length, MAX_RESOURCE_CHARS);
});

test('空や未定義の本文でも壊れない', () => {
  for (const value of ['', null, undefined]) {
    const result = truncateForAnalysis(value);
    assert.equal(result.size, 0);
    assert.equal(result.analyzedChars, 0);
    assert.equal(result.truncated, false);
  }
});

test('インライン記録は識別子と範囲情報を持つ', () => {
  const entry = buildInlineEntry('x'.repeat(MAX_RESOURCE_CHARS + 10), 'インラインscript #2');
  assert.equal(entry.label, 'インラインscript #2');
  assert.equal(entry.size, MAX_RESOURCE_CHARS + 10);
  assert.equal(entry.analyzedChars, MAX_RESOURCE_CHARS);
  assert.equal(entry.truncated, true);
});

// -----------------------------------------------
// Markdown「取得・解析範囲」
// -----------------------------------------------
test('「取得・解析範囲」はHTML構造と検出ライブラリの間にある', () => {
  const markdown = buildMarkdown(baseData());
  const html = markdown.indexOf('## HTML構造');
  const coverage = markdown.indexOf('## 取得・解析範囲');
  const lib = markdown.indexOf('## 検出ライブラリ');
  assert.ok(html < coverage && coverage < lib);
});

test('切り詰めなし: 元と解析の文字数が同じで、未確認の警告は出ない', () => {
  const markdown = buildMarkdown(baseData({
    jsResources: [okEntry('https://example.com/app.js', 'a'.repeat(500))],
  }));
  const section = coverageSection(markdown);
  assert.match(section, /\[JS\] https:\/\/example\.com\/app\.js: 元 500文字 \/ 解析 500文字 \/ 切り詰めなし/);
  assert.ok(!section.includes(WARN_TRUNCATED));
  assert.ok(section.includes('すべて全文を解析しました'));
});

test('切り詰めあり: 解析範囲と未解析の開始位置、未確認の警告が出る', () => {
  const size = MAX_RESOURCE_CHARS + 5000;
  const markdown = buildMarkdown(baseData({
    jsResources: [okEntry('https://example.com/bundle.js', 'a'.repeat(size))],
  }));
  const section = coverageSection(markdown);
  assert.ok(section.includes(
    `[JS] https://example.com/bundle.js: 元 ${size}文字 / 解析 ${MAX_RESOURCE_CHARS}文字 / 切り詰めあり（${MAX_RESOURCE_CHARS + 1}文字目以降は未解析）`,
  ));
  assert.ok(section.includes(WARN_TRUNCATED));
  assert.ok(!section.includes('すべて全文を解析しました'));
});

test('インラインの切り詰めも表示される', () => {
  const markdown = buildMarkdown(baseData({
    inlineStyles: [buildInlineEntry('b'.repeat(10), 'インラインstyle #1')],
    inlineScripts: [buildInlineEntry('c'.repeat(MAX_RESOURCE_CHARS + 1), 'インラインscript #1')],
  }));
  const section = coverageSection(markdown);
  assert.ok(section.includes('[CSS] インラインstyle #1: 元 10文字 / 解析 10文字 / 切り詰めなし'));
  assert.ok(section.includes(`[JS] インラインscript #1: 元 ${MAX_RESOURCE_CHARS + 1}文字 / 解析 ${MAX_RESOURCE_CHARS}文字 / 切り詰めあり`));
  assert.ok(section.includes(WARN_TRUNCATED));
});

test('取得失敗・外部オリジン・件数上限は件数で区別され、URLは取得対象外の記録にだけ出る', () => {
  const markdown = buildMarkdown(baseData({
    cssResources: [{ label: 'https://cdn.example.net/x.css', status: 'skipped_external' }],
    jsResources: [
      { label: 'https://example.com/fail.js', status: 'failed', reason: 'HTTPエラー 404' },
      { label: 'https://cdn.example.net/lib.js', status: 'skipped_external' },
      { label: 'https://example.com/six.js', status: 'skipped_limit' },
    ],
  }));
  const section = coverageSection(markdown);
  assert.ok(section.includes('- 取得失敗: 1件'));
  assert.ok(section.includes('- 取得対象外（外部オリジン）: 2件'));
  assert.ok(section.includes('- 取得対象外（取得件数の上限を超過）: 1件'));
  assert.ok(section.includes('「取得対象外の記録」を参照'));
  assert.ok(section.includes('取得していないコードがあります'));
  assert.ok(!section.includes('すべて全文を解析しました'));

  // 同じURLを2つのセクションに重複して並べない
  for (const url of ['https://example.com/fail.js', 'https://cdn.example.net/lib.js', 'https://example.com/six.js']) {
    assert.ok(!section.includes(url), `${url} が取得・解析範囲に重複しています`);
    assert.equal(markdown.split(url).length - 1, 1, `${url} はレポート内に1回だけ出るべきです`);
  }
  assert.ok(markdown.includes('- [JS] https://example.com/fail.js: 取得失敗（理由: HTTPエラー 404）'));
});

test('本文（rawText）はレポートに出力されない', () => {
  const marker = 'BODY_MARKER_SHOULD_NOT_APPEAR';
  const markdown = buildMarkdown(baseData({
    inlineScripts: [buildInlineEntry(`${marker} x`, 'インラインscript #1')],
    jsResources: [okEntry('https://example.com/app.js', `${marker} y`)],
  }));
  assert.ok(!markdown.includes(marker));
});

test('動的に読み込まれるコードは追跡していないことを常に明記する', () => {
  const markdown = buildMarkdown(baseData());
  assert.ok(coverageSection(markdown).includes('このツールでは追跡していません'));
});
