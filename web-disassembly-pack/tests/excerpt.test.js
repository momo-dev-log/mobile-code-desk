import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractCategoryExcerpts, detect4Value, detectJsFeatures, looksMinified } from '../js/excerpt.js';
import { CSS_EXCERPT_CATEGORIES, JS_EXCERPT_CATEGORIES, JS_FEATURE_CHECKS } from '../js/keywords.js';

test('観点ごとに最大2箇所まで抜粋し、全文を含めない', () => {
  const longFiller = 'x'.repeat(500);
  const js = `
    const ctx = canvas.getContext('2d');
    ${longFiller}
    surface.addEventListener('pointerdown', (e) => {
      draw(e);
    });
    ${longFiller}
    requestAnimationFrame(loop);
  `;

  const sources = [{ label: 'インラインscript #1', text: js }];
  const result = extractCategoryExcerpts(sources, JS_EXCERPT_CATEGORIES);

  const canvasCategory = result.find((c) => c.key === 'canvas');
  assert.ok(canvasCategory.excerpts.length > 0);
  assert.ok(canvasCategory.excerpts.length <= 2);
  for (const ex of canvasCategory.excerpts) {
    assert.ok(ex.excerpt.length < js.length);
    assert.equal(ex.source, 'インラインscript #1');
  }

  const rafCategory = result.find((c) => c.key === 'raf');
  assert.ok(rafCategory.excerpts.some((ex) => ex.excerpt.includes('requestAnimationFrame')));
});

test('該当が無い観点は空のexcerpts配列を返す（省略しない）', () => {
  const sources = [{ label: 'インラインscript #1', text: 'const total = items.reduce((a, b) => a + b, 0);' }];
  const result = extractCategoryExcerpts(sources, JS_EXCERPT_CATEGORIES);

  assert.equal(result.length, JS_EXCERPT_CATEGORIES.length);
  const webglCategory = result.find((c) => c.key === 'webgl');
  assert.deepEqual(webglCategory.excerpts, []);
});

test('CSSの観点（toolbar/controls/footer/dock等）を抜粋する', () => {
  const css = `
    .toolbar {
      position: fixed;
      bottom: 0;
      touch-action: none;
    }
    .panel {
      backdrop-filter: blur(4px);
      border-radius: 8px;
    }
  `;

  const sources = [{ label: 'インラインstyle #1', text: css }];
  const result = extractCategoryExcerpts(sources, CSS_EXCERPT_CATEGORIES);

  const toolbarCategory = result.find((c) => c.key === 'toolbar');
  assert.ok(toolbarCategory.excerpts.some((ex) => ex.keyword === 'toolbar'));

  const touchActionCategory = result.find((c) => c.key === 'touchAction');
  assert.ok(touchActionCategory.excerpts.some((ex) => ex.excerpt.includes('touch-action')));
});

test('複数ソースのうち、より優先度の高いソースから抜粋される', () => {
  const sources = [
    { label: 'インラインscript #1', text: 'const ctx = canvas.getContext("2d");' },
    { label: 'https://example.com/lib.js', text: 'const ctx2 = canvas.getContext("webgl");' },
  ];

  const result = extractCategoryExcerpts(sources, JS_EXCERPT_CATEGORIES);
  const canvasCategory = result.find((c) => c.key === 'canvas');

  assert.equal(canvasCategory.excerpts[0].source, 'インラインscript #1');
});

test('detect4Valueは本文が無い場合「未確認」を返す', () => {
  assert.equal(detect4Value([], /canvas/i), '未確認');
  assert.equal(detect4Value([''], /canvas/i), '未確認');
});

test('detect4Valueは本文がある場合「あり」「なし」を返す', () => {
  assert.equal(detect4Value(['const c = canvas.getContext("2d")'], /getContext/i), 'あり');
  assert.equal(detect4Value(['const total = 1 + 2'], /getContext/i), 'なし');
});

test('detectJsFeaturesはJS内キーワード検出12項目を返す', () => {
  const features = detectJsFeatures([
    'const ctx = canvas.getContext("2d"); requestAnimationFrame(loop); el.addEventListener("pointerdown", fn);',
  ]);

  assert.equal(features.length, JS_FEATURE_CHECKS.length);
  assert.equal(features.length, 12);

  const byKey = (key) => features.find((f) => f.key === key);
  assert.equal(byKey('canvas').value, 'あり');
  assert.equal(byKey('getContext').value, 'あり');
  assert.equal(byKey('raf').value, 'あり');
  assert.equal(byKey('pointerEvents').value, 'あり');
  assert.equal(byKey('webgl').value, 'なし');
});

test('detectJsFeaturesはJSが1件も取得できない場合「未確認」を返す', () => {
  const features = detectJsFeatures([]);
  for (const feature of features) {
    assert.equal(feature.value, '未確認');
  }
});

test('looksMinifiedは長い1行のコードをminify済みと判定する', () => {
  const minified = 'a'.repeat(20000);
  assert.equal(looksMinified(minified), true);

  const normal = 'function foo() {\n  return 1;\n}\n'.repeat(50);
  assert.equal(looksMinified(normal), false);

  assert.equal(looksMinified(''), false);
});
