import { test } from 'node:test';
import assert from 'node:assert/strict';
import { orderSourcesBySize, extractCategoryExcerpts } from '../js/excerpt.js';
import { JS_EXCERPT_CATEGORIES } from '../js/keywords.js';

test('インラインと外部をまとめて、元の文字数の小さい順に並べる', () => {
  const sources = [
    { label: 'インラインscript #1', text: 'a', size: 366823 },
    { label: 'インラインscript #2', text: 'b', size: 17916 },
    { label: 'インラインscript #3', text: 'c', size: 234 },
    { label: 'https://example.com/ext.js', text: 'd', size: 5000 },
  ];
  assert.deepEqual(
    orderSourcesBySize(sources).map((s) => s.label),
    ['インラインscript #3', 'https://example.com/ext.js', 'インラインscript #2', 'インラインscript #1'],
  );
});

test('切り詰めたファイルは解析した長さではなく元の文字数で並ぶ', () => {
  const sources = [
    { label: 'big', text: 'x'.repeat(10), size: 366823 },
    { label: 'small', text: 'y'.repeat(100), size: 100 },
  ];
  assert.deepEqual(orderSourcesBySize(sources).map((s) => s.label), ['small', 'big']);
});

test('同じ文字数は元の順番を保ち、何も除外しない', () => {
  const sources = [
    { label: 'A', text: '', size: 10 },
    { label: 'B', text: '', size: 10 },
    { label: 'C', text: 'xyz' },
  ];
  const ordered = orderSourcesBySize(sources);
  assert.deepEqual(ordered.map((s) => s.label), ['C', 'A', 'B']);
  assert.equal(ordered.length, sources.length);
});

test('元の配列を書き換えない／空でも壊れない', () => {
  const sources = [{ label: 'big', text: '', size: 2 }, { label: 'small', text: '', size: 1 }];
  orderSourcesBySize(sources);
  assert.equal(sources[0].label, 'big');
  assert.deepEqual(orderSourcesBySize([]), []);
  assert.deepEqual(orderSourcesBySize(undefined), []);
});

test('小さい本体scriptがライブラリより先に抜粋の枠を使う', () => {
  const library = { label: 'インラインscript #1', text: 'canvas pointerdown requestAnimationFrame '.repeat(100), size: 366823 };
  const app = { label: 'インラインscript #2', text: 'const canvas = el; el.addEventListener("pointerdown", f); requestAnimationFrame(frame);', size: 17916 };

  const excerpts = extractCategoryExcerpts(orderSourcesBySize([library, app]), JS_EXCERPT_CATEGORIES);
  for (const key of ['canvas', 'pointerEvents', 'raf']) {
    const category = excerpts.find((c) => c.key === key);
    assert.equal(category.excerpts[0].source, 'インラインscript #2', `${key} の1件目が本体scriptではありません`);
  }
});
