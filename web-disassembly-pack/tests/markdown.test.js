import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildMarkdown } from '../js/markdown.js';

function baseStructure() {
  return {
    canvas: 1,
    button: 2,
    audio: 0,
    video: 0,
    svg: 0,
    inlineScriptCount: 1,
    externalScriptCount: 1,
    inlineStyleCount: 1,
    externalStylesheetCount: 1,
  };
}

test('構造の概要・危険情報チェック・CSS/JSセクションを含むMarkdownを生成する', () => {
  const markdown = buildMarkdown({
    pageUrl: 'https://example.com/',
    finalUrl: 'https://example.com/',
    title: 'Example',
    structure: baseStructure(),
    cssResources: [
      { label: 'https://example.com/style.css', status: 'ok', size: 100, excerpts: [{ keyword: 'toolbar', excerpt: '.toolbar { position: fixed; }' }] },
      { label: 'https://cdn.other.com/lib.css', status: 'skipped_external' },
    ],
    jsResources: [
      { label: 'https://example.com/app.js', status: 'failed', reason: '通信エラー' },
    ],
    inlineStyles: [],
    inlineScripts: [],
    dangerFindings: [],
  });

  assert.match(markdown, /# Web解体パック 調査結果/);
  assert.match(markdown, /canvasタグ: 1件/);
  assert.match(markdown, /チェック対象のパターンは検出されませんでした。/);
  assert.match(markdown, /### https:\/\/example\.com\/style\.css/);
  assert.match(markdown, /キーワード: `toolbar`/);
  assert.match(markdown, /取得対象外（外部オリジンのため v0\.1ではスキップ）/);
  assert.match(markdown, /取得失敗（理由: 通信エラー）/);
});

test('HTMLにcanvasタグが無くてもJS内キーワード検出と推定メモを出す', () => {
  const structure = baseStructure();
  structure.canvas = 0;

  const markdown = buildMarkdown({
    pageUrl: 'https://example.com/',
    finalUrl: 'https://example.com/',
    title: 'Example',
    structure,
    jsFeatures: [
      { key: 'canvas', label: 'canvas', found: true },
      { key: 'rendererDomElement', label: 'renderer.domElement', found: true },
      { key: 'getContext', label: 'getContext', found: false },
      { key: 'requestAnimationFrame', label: 'requestAnimationFrame', found: false },
      { key: 'pointerOps', label: 'pointer操作（pointer/touch/mouse）', found: false },
      { key: 'three', label: 'THREE（Three.js）', found: true },
      { key: 'webgl', label: 'WebGL', found: false },
    ],
    cssResources: [],
    jsResources: [],
    inlineStyles: [],
    inlineScripts: [],
    dangerFindings: [],
  });

  assert.match(markdown, /## JS内キーワード検出/);
  assert.match(markdown, /- canvas: あり/);
  assert.match(markdown, /- getContext: なし/);
  assert.match(markdown, /## 推定メモ/);
  assert.match(markdown, /このページではJS内に "canvas" や "renderer\.domElement" があるため、実行時にCanvas\/WebGL描画を使っている可能性があります。/);
  assert.doesNotMatch(markdown, /"getContext" があるため/);
  assert.match(markdown, /Three\.jsを読み込んでいる場合、WebGL描画の可能性があります。/);
  assert.match(markdown, /HTML側のcanvasタグは0件ですが/);
});

test('危険情報チェックの検出結果を一覧表示する', () => {
  const markdown = buildMarkdown({
    pageUrl: 'https://example.com/',
    finalUrl: 'https://example.com/',
    title: '',
    structure: baseStructure(),
    cssResources: [],
    jsResources: [],
    inlineStyles: [],
    inlineScripts: [],
    dangerFindings: [{ label: 'JS', type: 'メールアドレス', preview: 'co***om' }],
  });

  assert.match(markdown, /\[JS\] メールアドレス: `co\*\*\*om`/);
});
