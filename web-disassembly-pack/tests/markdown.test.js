import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildMarkdown } from '../js/markdown.js';
import { JS_FEATURE_CHECKS, CSS_EXCERPT_CATEGORIES, JS_EXCERPT_CATEGORIES } from '../js/keywords.js';
import { LIBRARY_CHECKS } from '../js/libraries.js';
import { APP_VERSION } from '../js/constants.js';

function baseStructure(overrides = {}) {
  return {
    canvas: 0,
    button: 7,
    audio: 0,
    video: 0,
    svg: 0,
    inlineScriptCount: 3,
    externalScriptCount: 3,
    inlineStyleCount: 1,
    externalStylesheetCount: 1,
    ...overrides,
  };
}

function jsFeatures(overrides = {}) {
  return JS_FEATURE_CHECKS.map(({ key, label }) => ({
    key,
    label,
    value: overrides[key] || 'なし',
  }));
}

function libraries(overrides = {}) {
  return LIBRARY_CHECKS.map(({ key, label }) => ({
    key,
    label,
    value: overrides[key] || 'なし',
  }));
}

function emptyExcerpts(categories) {
  return categories.map(({ key, label }) => ({ key, label, excerpts: [] }));
}

function baseData(overrides = {}) {
  return {
    pageUrl: 'https://example.com/',
    finalUrl: 'https://example.com/',
    title: 'Example',
    structure: baseStructure(),
    jsFeatures: jsFeatures(),
    libraries: libraries(),
    cssExcerpts: emptyExcerpts(CSS_EXCERPT_CATEGORIES),
    jsExcerpts: emptyExcerpts(JS_EXCERPT_CATEGORIES),
    cssResources: [],
    jsResources: [],
    dangerFindings: [],
    ...overrides,
  };
}

test('見出し順が固定されている', () => {
  const markdown = buildMarkdown(baseData());

  const headings = [
    '# Web解体パック 調査結果',
    '## HTML構造',
    '## 検出ライブラリ',
    '## JS内キーワード検出',
    '## CSS抜粋',
    '## JavaScript抜粋',
    '## 推定メモ',
    '## 危険情報チェック結果',
    '## 取得対象外の記録',
  ];

  let lastIndex = -1;
  for (const heading of headings) {
    const index = markdown.indexOf(heading);
    assert.ok(index !== -1, `${heading} が見つかりません`);
    assert.ok(index > lastIndex, `${heading} の出現順が不正です`);
    lastIndex = index;
  }
});

test('JS内キーワード検出12項目・検出ライブラリ10項目が、検出ゼロでも省略されない', () => {
  const markdown = buildMarkdown(baseData());

  for (const { label } of JS_FEATURE_CHECKS) {
    assert.match(markdown, new RegExp(`- ${escapeRegExp(label)}: なし`));
  }

  for (const { label } of LIBRARY_CHECKS) {
    assert.match(markdown, new RegExp(`- ${escapeRegExp(label)}: なし`));
  }

  assert.equal(JS_FEATURE_CHECKS.length, 12);
  assert.equal(LIBRARY_CHECKS.length, 10);
});

test('CSS抜粋/JavaScript抜粋は、該当が無い観点も省略せず「（該当なし）」を出す', () => {
  const markdown = buildMarkdown(baseData());

  for (const { label } of CSS_EXCERPT_CATEGORIES) {
    assert.match(markdown, new RegExp(`### ${escapeRegExp(label)}\\n\\n（該当なし）`));
  }
  for (const { label } of JS_EXCERPT_CATEGORIES) {
    assert.match(markdown, new RegExp(`### ${escapeRegExp(label)}\\n\\n（該当なし）`));
  }
});

test('本文の検出項目は4値（あり/なし/特定できず/未確認）で出る', () => {
  const markdown = buildMarkdown(baseData({
    jsFeatures: jsFeatures({ canvas: 'あり', getContext: '未確認' }),
    libraries: libraries({ three: 'あり', react: '特定できず', vue: '未確認' }),
  }));

  assert.match(markdown, /- canvas: あり/);
  assert.match(markdown, /- getContext: 未確認/);
  assert.match(markdown, /- Three\.js: あり/);
  assert.match(markdown, /- React: 特定できず/);
  assert.match(markdown, /- Vue: 未確認/);
});

test('件数の0とunknownが区別される', () => {
  const zero = buildMarkdown(baseData({ structure: baseStructure({ canvas: 0 }) }));
  assert.match(zero, /- canvasタグ: 0件/);
  assert.match(zero, /canvas_tag:0/);

  const unknown = buildMarkdown(baseData({ structure: baseStructure({ canvas: 'unknown' }) }));
  assert.match(unknown, /- canvasタグ: unknown件/);
  assert.match(unknown, /canvas_tag:unknown/);
});

test('サマリ行のキー順が固定され、本文4値→サマリ3値の変換が正しい', () => {
  const data = baseData({
    structure: baseStructure({
      canvas: 0,
      button: 7,
      audio: 0,
      video: 0,
      svg: 0,
      inlineScriptCount: 3,
      externalScriptCount: 3,
      inlineStyleCount: 1,
      externalStylesheetCount: 1,
    }),
    jsFeatures: jsFeatures({
      canvas: 'あり',
      rendererDomElement: 'あり',
      getContext: 'なし',
      webgl: 'あり',
      pointerEvents: 'あり',
      touch: 'あり',
      mouse: 'あり',
      raf: 'あり',
    }),
    libraries: libraries({
      three: 'あり',
      react: '未確認',
    }),
    dangerFindings: [],
  });

  const markdown = buildMarkdown(data);

  const expected = 'summary: canvas_tag:0 | button:7 | audio:0 | video:0 | svg:0 | '
    + 'inline_script:3 | external_script:3 | inline_style:1 | external_style:1 | '
    + 'canvas_js:yes | renderer_dom:yes | get_context:no | webgl:yes | pointer:yes | '
    + 'touch:yes | mouse:yes | raf:yes | '
    + 'lib_three:yes | lib_p5:no | lib_pixi:no | lib_regl:no | lib_gsap:no | lib_anime:no | '
    + 'lib_matter:no | lib_react:unknown | lib_vue:no | lib_svelte:no | danger:no';

  assert.match(markdown, new RegExp(escapeRegExp(expected)));
});

test('特定できず/未確認はサマリ行でunknownになる', () => {
  const markdown = buildMarkdown(baseData({
    jsFeatures: jsFeatures({ canvas: '未確認' }),
    libraries: libraries({ three: '特定できず', p5: '未確認' }),
  }));

  assert.match(markdown, /canvas_js:unknown/);
  assert.match(markdown, /lib_three:unknown/);
  assert.match(markdown, /lib_p5:unknown/);
});

test('dangerはサマリ行の最後尾にyes/noで出る', () => {
  const noDanger = buildMarkdown(baseData({ dangerFindings: [] }));
  assert.match(noDanger, /\| danger:no$/m);

  const withDanger = buildMarkdown(baseData({
    dangerFindings: [{ label: 'JS', type: 'メールアドレス', preview: 'co***om' }],
  }));
  assert.match(withDanger, /\| danger:yes$/m);
});

test('HTMLにcanvasタグが無くてもJS内キーワード検出と推定メモを出す', () => {
  const markdown = buildMarkdown(baseData({
    structure: baseStructure({ canvas: 0 }),
    jsFeatures: jsFeatures({
      canvas: 'あり',
      rendererDomElement: 'あり',
      getContext: 'なし',
    }),
    libraries: libraries({ three: 'あり' }),
  }));

  assert.match(markdown, /## JS内キーワード検出/);
  assert.match(markdown, /- canvas: あり/);
  assert.match(markdown, /- getContext: なし/);
  assert.match(markdown, /## 推定メモ/);
  assert.match(markdown, /このページではJS内に "canvas" や "renderer\.domElement" があるため、実行時にCanvas\/WebGL描画を使っている可能性があります。/);
  assert.doesNotMatch(markdown, /"getContext" があるため/);
  assert.match(markdown, /Three\.jsを読み込んでいる場合、WebGL描画の可能性があります。/);
  assert.match(markdown, /HTML側のcanvasタグは0件ですが/);
});

test('推定メモは「あり」の項目だけを根拠にする（なし/特定できず/未確認は根拠にしない）', () => {
  const markdown = buildMarkdown(baseData({
    jsFeatures: jsFeatures({
      canvas: 'なし',
      getContext: '特定できず',
      rendererDomElement: '未確認',
      webgl: 'なし',
      pointerEvents: 'なし',
      touch: 'なし',
      mouse: 'なし',
      raf: 'なし',
    }),
    libraries: libraries({ three: 'なし' }),
  }));

  // 推定メモの最初の1行（一般的な注意書き）以外は出ない
  const notesSection = markdown.split('## 推定メモ')[1].split('## 危険情報チェック結果')[0];
  const noteLines = notesSection.split('\n').filter((line) => line.startsWith('- '));
  assert.equal(noteLines.length, 1);
  assert.match(noteLines[0], /HTMLにcanvasタグがなくても、JavaScriptでCanvas\/WebGLが生成される場合があります。/);
});

test('危険情報チェックの検出結果を一覧表示する', () => {
  const markdown = buildMarkdown(baseData({
    title: '',
    dangerFindings: [{ label: 'JS', type: 'メールアドレス', preview: 'co***om' }],
  }));

  assert.match(markdown, /\[JS\] メールアドレス: `co\*\*\*om`/);
});

test('CSS/JavaScript抜粋は全文ダンプにならず、観点ごとに抜粋される', () => {
  const longCss = `/* filler */\n${'.x { color: red; }\n'.repeat(200)}.toolbar { position: fixed; touch-action: none; }`;
  const longJs = `${'const noop = () => {};\n'.repeat(200)}const ctx = canvas.getContext('2d'); requestAnimationFrame(loop);`;

  const cssExcerpts = CSS_EXCERPT_CATEGORIES.map(({ key, label, keywords }) => {
    if (key === 'toolbar') {
      return { key, label, excerpts: [{ keyword: 'toolbar', source: 'インラインstyle #1', excerpt: '.toolbar { position: fixed; touch-action: none; }' }] };
    }
    return { key, label, excerpts: [] };
  });

  const jsExcerpts = JS_EXCERPT_CATEGORIES.map(({ key, label }) => {
    if (key === 'canvas') {
      return { key, label, excerpts: [{ keyword: 'canvas', source: 'インラインscript #1', excerpt: "const ctx = canvas.getContext('2d');" }] };
    }
    if (key === 'raf') {
      return { key, label, excerpts: [{ keyword: 'requestAnimationFrame', source: 'インラインscript #1', excerpt: 'requestAnimationFrame(loop);' }] };
    }
    return { key, label, excerpts: [] };
  });

  const markdown = buildMarkdown(baseData({ cssExcerpts, jsExcerpts }));

  assert.ok(!markdown.includes(longCss));
  assert.ok(!markdown.includes(longJs));
  assert.match(markdown, /キーワード: `toolbar`（インラインstyle #1）/);
  assert.match(markdown, /キーワード: `canvas`（インラインscript #1）/);
  assert.match(markdown, /キーワード: `requestAnimationFrame`（インラインscript #1）/);
});

test('取得対象外・取得失敗のリソースを記録する', () => {
  const markdown = buildMarkdown(baseData({
    cssResources: [
      { label: 'https://example.com/style.css', status: 'ok', size: 100 },
      { label: 'https://cdn.other.com/lib.css', status: 'skipped_external' },
    ],
    jsResources: [
      { label: 'https://example.com/app.js', status: 'failed', reason: '通信エラー' },
      { label: 'https://example.com/extra.js', status: 'skipped_limit' },
    ],
  }));

  const section = markdown.split('## 取得対象外の記録')[1];
  assert.match(section, /\[CSS\] https:\/\/cdn\.other\.com\/lib\.css: 取得対象外（外部オリジンのため対象外）/);
  assert.match(section, /\[JS\] https:\/\/example\.com\/app\.js: 取得失敗（理由: 通信エラー）/);
  assert.match(section, /\[JS\] https:\/\/example\.com\/extra\.js: 取得対象外（取得件数の上限を超過）/);
  assert.ok(!section.includes('https://example.com/style.css'));
});

test('取得対象外・取得失敗が無い場合はその旨を出す', () => {
  const markdown = buildMarkdown(baseData());
  const section = markdown.split('## 取得対象外の記録')[1];
  assert.match(section, /（取得対象外・取得失敗のリソースはありません）/);
});

test('メタ情報にWeb解体パック版が出る', () => {
  const markdown = buildMarkdown(baseData());

  assert.match(markdown, new RegExp(`- Web解体パック版: ${escapeRegExp(APP_VERSION)}`));
  assert.match(markdown, /- Web解体パック版: v\d+\.\d+\.\d+/);
});

test('APP_VERSIONはv0.3.0', () => {
  assert.equal(APP_VERSION, 'v0.3.0');
});

test('バージョン追加後も見出し順と既存summary行が壊れていない', () => {
  const markdown = buildMarkdown(baseData());

  // バージョン行はメタ情報内、summaryより前にある
  const versionIndex = markdown.indexOf(`- Web解体パック版: ${APP_VERSION}`);
  const summaryIndex = markdown.indexOf('summary:');
  const htmlStructureIndex = markdown.indexOf('## HTML構造');

  assert.ok(versionIndex !== -1, 'バージョン行が見つかりません');
  assert.ok(summaryIndex !== -1, 'summary行が見つかりません');
  assert.ok(versionIndex < summaryIndex, 'バージョン行はsummaryより前にある');
  assert.ok(summaryIndex < htmlStructureIndex, 'summary行はHTML構造より前にある');
});

function escapeRegExp(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
