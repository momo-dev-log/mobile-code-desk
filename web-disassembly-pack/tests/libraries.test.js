import { test } from 'node:test';
import assert from 'node:assert/strict';
import { detectLibraries, LIBRARY_CHECKS } from '../js/libraries.js';

function findLib(result, key) {
  return result.find((l) => l.key === key);
}

test('外部ライブラリ10個を固定の順序・キーで返す', () => {
  const result = detectLibraries({ scriptUrls: [], texts: [] });

  assert.equal(result.length, 10);
  assert.deepEqual(result.map((l) => l.key), LIBRARY_CHECKS.map((l) => l.key));
  assert.deepEqual(result.map((l) => l.key), [
    'three', 'p5', 'pixi', 'regl', 'gsap', 'anime', 'matter', 'react', 'vue', 'svelte',
  ]);
});

test('script srcのURLからライブラリを検出する（段階1）', () => {
  const result = detectLibraries({
    scriptUrls: ['https://cdn.example.com/libs/three.min.js'],
    texts: ['console.log("hello")'],
  });

  assert.equal(findLib(result, 'three').value, 'あり');
  assert.equal(findLib(result, 'p5').value, 'なし');
});

test('グローバル変数痕跡からライブラリを検出する（段階2）', () => {
  const result = detectLibraries({
    scriptUrls: [],
    texts: ['const scene = new THREE.Scene(); const renderer = new THREE.WebGLRenderer();'],
  });

  assert.equal(findLib(result, 'three').value, 'あり');
});

test('確認対象が無い場合は「未確認」を返す', () => {
  const result = detectLibraries({ scriptUrls: [], texts: [] });

  for (const lib of result) {
    assert.equal(lib.value, '未確認');
  }
});

test('確認対象はあるが該当が無い場合は「なし」を返す', () => {
  const normalCode = 'function foo() {\n  return 1;\n}\n'.repeat(50);
  const result = detectLibraries({ scriptUrls: [], texts: [normalCode] });

  assert.equal(findLib(result, 'three').value, 'なし');
  assert.equal(findLib(result, 'react').value, 'なし');
});

test('minify済みで判別できない場合は「特定できず」を返す', () => {
  const minified = 'a'.repeat(20000);
  const result = detectLibraries({ scriptUrls: [], texts: [minified] });

  assert.equal(findLib(result, 'three').value, '特定できず');
  assert.equal(findLib(result, 'react').value, '特定できず');
});
