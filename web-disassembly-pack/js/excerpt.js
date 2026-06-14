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
