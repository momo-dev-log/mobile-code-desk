/**
 * CSS/JS本文から「重要キーワード周辺の抜粋」を作る。
 *
 * Web解体パックは Canvas・スマホ操作（pointer/touch）・墨流し風UIの
 * 描画処理・音声・操作バー構造を調べることを主目的とするため、
 * それに関連するキーワードを優先的に抜粋する。
 *
 * 全文表示はせず、キーワード前後の一部のみを抜粋することで、
 * 巨大ファイルやminify済みJSでも画面に大量表示しない。
 */

// JS抜粋キーワード（優先度順。先頭ほど優先）
export const JS_KEYWORDS = [
  'canvas',
  'getContext',
  'pointer',
  'pointerdown',
  'pointermove',
  'pointerup',
  'touch',
  'touchstart',
  'touchmove',
  'mouse',
  'mousemove',
  'requestAnimationFrame',
  'audio',
  'play',
  'pause',
  'clear',
  'reset',
  'wash',
  'color',
  'palette',
  'draw',
  'resize',
  // 優先度低
  'fetch',
  'localStorage',
  'WebSocket',
];

// CSS抜粋キーワード（優先度順）
export const CSS_KEYWORDS = [
  'body',
  'html',
  'canvas',
  'button',
  'toolbar',
  'controls',
  'footer',
  'fixed',
  'position',
  'z-index',
  'background',
  'border-radius',
  'backdrop-filter',
  'display',
  'flex',
  'grid',
];

const CONTEXT_CHARS = 80;
const MAX_MATCHES_PER_KEYWORD = 2;
const MAX_TOTAL_EXCERPTS = 12;

/**
 * @param {string} text 本文（CSS/JS）
 * @param {string[]} keywords キーワード一覧（優先度順）
 * @returns {Array<{ keyword: string, excerpt: string }>}
 */
export function extractExcerpts(text, keywords) {
  if (!text) return [];

  const excerpts = [];
  const usedRanges = [];

  for (const keyword of keywords) {
    if (excerpts.length >= MAX_TOTAL_EXCERPTS) break;

    let searchFrom = 0;
    let matchCount = 0;

    while (matchCount < MAX_MATCHES_PER_KEYWORD) {
      const index = text.toLowerCase().indexOf(keyword.toLowerCase(), searchFrom);
      if (index === -1) break;

      const start = Math.max(0, index - CONTEXT_CHARS);
      const end = Math.min(text.length, index + keyword.length + CONTEXT_CHARS);

      if (!overlapsExisting(usedRanges, start, end)) {
        excerpts.push({
          keyword,
          excerpt: collapseWhitespace(text.slice(start, end)),
        });
        usedRanges.push([start, end]);
        matchCount += 1;

        if (excerpts.length >= MAX_TOTAL_EXCERPTS) break;
      }

      searchFrom = index + keyword.length;
    }
  }

  return excerpts;
}

function overlapsExisting(ranges, start, end) {
  return ranges.some(([s, e]) => start < e && end > s);
}

function collapseWhitespace(text) {
  return text.replace(/\s+/g, ' ').trim();
}

/**
 * JS本文に、Canvas/WebGL描画やポインター操作に関わる代表的なキーワードが
 * 含まれているかどうかを判定する。
 *
 * HTMLに<canvas>タグが無くても、JavaScript側でCanvas/WebGLが
 * 生成・操作されている場合があるため、HTML構造の判定とは別枠で確認する。
 */
export const JS_FEATURE_CHECKS = [
  { key: 'canvas', label: 'canvas', pattern: /canvas/i },
  { key: 'rendererDomElement', label: 'renderer.domElement', pattern: /renderer\.domElement/i },
  { key: 'getContext', label: 'getContext', pattern: /getContext/i },
  { key: 'requestAnimationFrame', label: 'requestAnimationFrame', pattern: /requestAnimationFrame/i },
  { key: 'pointerOps', label: 'pointer操作（pointer/touch/mouse）', pattern: /pointer|touch|mousemove|mousedown|mouseup/i },
  { key: 'three', label: 'THREE（Three.js）', pattern: /\bTHREE\b/ },
  { key: 'webgl', label: 'WebGL', pattern: /webgl/i },
];

/**
 * @param {string[]} texts JS本文（インライン/外部）の一覧
 * @returns {Array<{ key: string, label: string, found: boolean }>}
 */
export function detectJsFeatures(texts) {
  const combined = texts.join('\n');
  return JS_FEATURE_CHECKS.map(({ key, label, pattern }) => ({
    key,
    label,
    found: pattern.test(combined),
  }));
}
