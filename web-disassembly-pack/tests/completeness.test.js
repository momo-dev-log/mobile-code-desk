/**
 * v0.4.3: 出力の完全性の目印と、コード本文の並び順のテスト。
 *
 * - 冒頭（メタ情報の最後）に「全体の文字数」、末尾に「ここで終わり」の行が入り、
 *   書かれた文字数が出力全体の長さと一致すること
 * - 途中で切れた出力では末尾の行がなくなること
 * - 全文収録のコード本文が、収録優先順（文字数の小さい順）に並ぶこと
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildMarkdown, buildFullMarkdown, addCompletenessMarkers, END_MARKER_TEXT } from '../js/markdown.js';
import { buildFullTextSections, orderForDisplay } from '../js/fulltext.js';
import { buildInlineEntry, truncateForAnalysis } from '../js/coverage.js';
import { JS_FEATURE_CHECKS, CSS_EXCERPT_CATEGORIES, JS_EXCERPT_CATEGORIES } from '../js/keywords.js';
import { LIBRARY_CHECKS } from '../js/libraries.js';

function baseData(overrides = {}) {
  return {
    pageUrl: 'https://example.com/',
    finalUrl: 'https://example.com/',
    title: 'Example',
    structure: {
      canvas: 0, button: 0, audio: 0, video: 0, svg: 0,
      inlineScriptCount: 0, externalScriptCount: 0, inlineStyleCount: 0, externalStylesheetCount: 0,
    },
    jsFeatures: JS_FEATURE_CHECKS.map(({ key, label }) => ({ key, label, value: 'なし' })),
    libraries: LIBRARY_CHECKS.map(({ key, label }) => ({ key, label, value: 'なし' })),
    cssExcerpts: CSS_EXCERPT_CATEGORIES.map(({ key, label }) => ({ key, label, excerpts: [] })),
    jsExcerpts: JS_EXCERPT_CATEGORIES.map(({ key, label }) => ({ key, label, excerpts: [] })),
    cssResources: [],
    jsResources: [],
    dangerFindings: [],
    htmlChars: 0,
    inlineStyles: [],
    inlineScripts: [],
    html: '',
    ...overrides,
  };
}

const HEAD_RE = /^- 全体の文字数: (\d+)文字（最後の行に「Web解体パックの出力はここで終わりです」と書いてあります。その行がなければ、途中で切れています）$/m;
const TAIL_RE = /（Web解体パックの出力はここで終わりです。全体 (\d+)文字）\n$/;

function assertMarkers(markdown) {
  const head = markdown.match(HEAD_RE);
  const tail = markdown.match(TAIL_RE);
  assert.ok(head, '冒頭の「全体の文字数」の行がありません');
  assert.ok(tail, '末尾の「ここで終わり」の行がありません');
  assert.equal(Number(head[1]), markdown.length, '冒頭に書いた文字数が出力全体の長さと一致しません');
  assert.equal(Number(tail[1]), markdown.length, '末尾に書いた文字数が出力全体の長さと一致しません');
  assert.equal(markdown.split(END_MARKER_TEXT).length - 1, 2, '目印の文言は冒頭と末尾の2回だけのはずです');
}

test('通常版: 冒頭と末尾に目印が入り、文字数が出力全体と一致する', () => {
  const md = buildMarkdown(baseData());
  assertMarkers(md);
  // 冒頭の行はメタ情報（版数の行）の直後、summary行より前にある
  const lines = md.split('\n');
  const headIndex = lines.findIndex((line) => HEAD_RE.test(line));
  assert.ok(lines[headIndex - 1].startsWith('- Web解体パック版: '));
  assert.ok(headIndex < lines.findIndex((line) => line.startsWith('summary: ')));
});

test('全文つき版: 目印は全文収録まで含めた全体に1組だけ入る', () => {
  const md = buildFullMarkdown(baseData({
    inlineScripts: [buildInlineEntry('const a = 1;', 'インラインscript #1')],
    html: '<html><body><script>const a = 1;</script></body></html>',
  }));
  assertMarkers(md);
  assert.ok(md.indexOf('## 全文収録') < md.search(TAIL_RE), '末尾の目印は全文収録より後にあるはずです');
  // 冒頭の行は「出力形式: 全文つき」の行の直後
  const lines = md.split('\n');
  const headIndex = lines.findIndex((line) => HEAD_RE.test(line));
  assert.ok(lines[headIndex - 1].startsWith('- 出力形式: 全文つき'));
});

test('途中で切れた出力には末尾の目印が残らない', () => {
  const md = buildFullMarkdown(baseData({
    inlineScripts: [buildInlineEntry('x'.repeat(5000), 'インラインscript #1')],
  }));
  for (const keep of [0.3, 0.6, 0.95]) {
    const cut = md.slice(0, Math.floor(md.length * keep));
    assert.ok(!TAIL_RE.test(cut), `${keep} で切った出力に末尾の目印があります`);
    // 冒頭の行は残るので、書かれた文字数と受け取った長さの違いで切れたことが分かる
    const head = cut.match(HEAD_RE);
    if (head) assert.ok(Number(head[1]) > cut.length);
  }
});

test('文字数の桁が変わる境目でも、書いた数と実際の長さが一致する', () => {
  const template = '# Web解体パック 調査結果\n\n- 対象URL: x\n\nsummary: a\n';
  const markerSize = addCompletenessMarkers(template).length - template.length;
  // 目印を付けた後の長さが 9,990〜10,010 文字あたりになる本文で試す
  for (let target = 9990; target <= 10010; target += 1) {
    const pad = target - markerSize - template.length;
    const body = template + 'z'.repeat(Math.max(0, pad));
    assertMarkers(addCompletenessMarkers(body));
  }
});

// ---- コード本文の並び ----

test('JS本文は収録優先順（小さい順）に並び、途中まで収録した大きなファイルが最後になる', () => {
  // 墨流しと同じ形: 大きなランタイム（#1）・本体（#2）・小さな計測（#3）
  const sections = buildFullTextSections(baseData({
    inlineScripts: [
      buildInlineEntry('r'.repeat(300000), 'インラインscript #1'),
      buildInlineEntry('b'.repeat(17916), 'インラインscript #2'),
      buildInlineEntry('t'.repeat(234), 'インラインscript #3'),
    ],
  }));
  const jsPart = sections.slice(sections.indexOf('### JavaScript本文'));
  const headings = [...jsPart.matchAll(/^#### \[JS・インライン\] `(インラインscript #\d)`$/gm)].map((m) => m[1]);
  assert.deepEqual(headings, ['インラインscript #3', 'インラインscript #2', 'インラインscript #1']);
  // 本体（#2）は全文、大きな #1 は途中まで
  assert.match(jsPart, /`インラインscript #2`\n\n- 元の文字数: 17916文字\n- 解析範囲: 17916文字（全文）\n- 収録優先順: 2\n- 収録: 17916文字（全文）/);
  assert.match(jsPart, /`インラインscript #1`[\s\S]*- 収録: \d+文字（途中まで。/);
});

test('外部ファイルも含めて小さい順。同一内容で省略したものは最後に置く', () => {
  const ext = (url, text) => ({ label: url, status: 'ok', ...truncateForAnalysis(text) });
  const sections = buildFullTextSections(baseData({
    inlineScripts: [buildInlineEntry('a'.repeat(3000), 'インラインscript #1')],
    jsResources: [
      ext('https://example.com/big.js', 'b'.repeat(8000)),
      ext('https://example.com/copy.js', 'a'.repeat(3000)),
      ext('https://example.com/small.js', 'c'.repeat(500)),
    ],
  }));
  const jsPart = sections.slice(sections.indexOf('### JavaScript本文'));
  const labels = [...jsPart.matchAll(/^#### \[JS・[^\]]+\] `([^`]+)`$/gm)].map((m) => m[1]);
  assert.deepEqual(labels, [
    'https://example.com/small.js',
    'インラインscript #1',
    'https://example.com/big.js',
    'https://example.com/copy.js',
  ]);
  assert.match(jsPart, /`https:\/\/example\.com\/copy\.js`[\s\S]*- 収録: なし（`インラインscript #1` と同一内容のため本文を省略）/);
});

test('orderForDisplay: 元の配列を書き換えず、空でも壊れない', () => {
  const list = [{ priority: 2, inclusion: 'full' }, { priority: 1, inclusion: 'full' }];
  const ordered = orderForDisplay(list);
  assert.deepEqual(ordered.map((s) => s.priority), [1, 2]);
  assert.deepEqual(list.map((s) => s.priority), [2, 1]);
  assert.deepEqual(orderForDisplay([]), []);
  assert.deepEqual(orderForDisplay(undefined), []);
});
