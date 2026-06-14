import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractExcerpts, JS_KEYWORDS, CSS_KEYWORDS } from '../js/excerpt.js';

test('canvas/pointer等のキーワード周辺を抜粋する', () => {
  const filler = '// no keywords here, just filler text to separate sections\n'.repeat(6);
  const js = `
    const ctx = canvas.getContext('2d');
    ${filler}
    surface.addEventListener('pointerdown', (e) => {
      draw(e);
    });
  `;

  const excerpts = extractExcerpts(js, JS_KEYWORDS);

  assert.ok(excerpts.length > 0);
  assert.ok(excerpts.some((e) => e.keyword === 'canvas'));
  // 'pointer' は 'pointerdown' の前方一致になるため、抜粋は'pointer'側に
  // 統合されるが、内容として'pointerdown'を含む。
  assert.ok(excerpts.some((e) => e.excerpt.includes('pointerdown')));
  for (const e of excerpts) {
    assert.ok(e.excerpt.length > 0);
  }
});

test('キーワードに該当しない本文では空配列を返す', () => {
  const js = 'const total = items.reduce((a, b) => a + b, 0);';
  const excerpts = extractExcerpts(js, JS_KEYWORDS);
  assert.deepEqual(excerpts, []);
});

test('CSSキーワード（toolbar, position等）を抜粋する', () => {
  const filler = '/* no keywords here, just filler text to separate sections */\n'.repeat(6);
  const css = `
    .toolbar {
      position: fixed;
      bottom: 0;
    }

    ${filler}

    .other-block {
      margin: 0 auto;
    }
  `;

  const excerpts = extractExcerpts(css, CSS_KEYWORDS);

  assert.ok(excerpts.some((e) => e.keyword === 'toolbar'));
  // 'fixed' は 'position' の近傍にあるため抜粋は'fixed'側に統合されるが、
  // 内容として'position'を含む。
  assert.ok(excerpts.some((e) => e.excerpt.includes('position')));
});

test('同じキーワードでも最大件数までしか抜粋しない', () => {
  const js = Array.from({ length: 10 }, (_, i) => `canvas${i}.getContext('2d');`).join('\n');
  const excerpts = extractExcerpts(js, ['getContext']);
  assert.ok(excerpts.length <= 2);
});
