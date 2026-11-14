/**
 * v0.4.2: JavaScriptではないscript（JSON-LD・埋め込みデータ等）があるページで、
 * 全文つき版の「HTML構造」と「JavaScript本文」のインラインscript番号が一致することを確かめる。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isJavaScriptType } from '../js/parse.js';
import { buildHtmlSkeleton } from '../js/fulltext.js';

test('isJavaScriptType: typeなし・module・JavaScriptのMIMEタイプだけを JavaScript とみなす', () => {
  for (const type of [null, undefined, '', '  ', 'module', 'MODULE', 'text/javascript', 'application/javascript', 'text/javascript; charset=utf-8']) {
    assert.equal(isJavaScriptType(type), true, `JavaScriptのはず: ${type}`);
  }
  for (const type of ['application/ld+json', 'application/json', 'importmap', 'text/template', 'text/x-handlebars-template', 'speculationrules']) {
    assert.equal(isJavaScriptType(type), false, `JavaScriptではないはず: ${type}`);
  }
});

const HTML = [
  '<html><head>',
  '<script type="application/ld+json">{"name":"data"}</script>',
  '<script type="application/json" id="__DATA__">{"todos":[1,2,3]}</script>',
  '<script>window.first = 1;</script>',
  '</head><body>',
  '<script type="module">import "./a.js";</script>',
  '<script type="text/template"><p>x</p></script>',
  '<script>window.third = 3;</script>',
  '</body></html>',
].join('');

test('HTML構造のインラインscript番号は、JavaScriptのscriptだけを数える（parse.js と同じ）', () => {
  const { text } = buildHtmlSkeleton(HTML);
  const numbered = [...text.matchAll(/本文省略: インラインscript #(\d+)（(\d+)文字）。本文は「JavaScript本文」を参照/g)].map((m) => [Number(m[1]), Number(m[2])]);
  assert.deepEqual(numbered, [
    [1, 'window.first = 1;'.length],
    [2, 'import "./a.js";'.length],
    [3, 'window.third = 3;'.length],
  ]);
});

test('JavaScriptではないscriptは番号を付けず、「JavaScript本文」を参照させない', () => {
  const { text } = buildHtmlSkeleton(HTML);
  const notes = text.match(/JavaScriptではないscript（type属性で判定）の本文 \d+文字は省略（本文は収録していません）/g) || [];
  assert.equal(notes.length, 3);
  // 本文そのものは残さない（従来どおり、script本文はHTML構造に載せない）
  assert.ok(!text.includes('"todos"'));
  // type属性は残るので、何のscriptかは読み取れる
  assert.ok(text.includes('type="application/ld+json"'));
});
