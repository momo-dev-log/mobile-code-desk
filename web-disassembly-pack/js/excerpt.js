/**
 * CSS/JS本文から「観点ごとの抜粋」と「キーワード検出（4値）」を作る。
 *
 * Web解体パックは Canvas・スマホ操作（pointer/touch）・墨流し風UIの
 * 描画処理・音声・操作バー構造を調べることを主目的とするため、
 * それに関連する観点を優先的に抜粋する。
 *
 * 全文表示はせず、観点ごとに最大2箇所・前後CONTEXT_CHARS文字のみ抜粋することで、
 * 巨大ファイルやminify済みJSでも画面に大量表示しない。
 */
import { JS_FEATURE_CHECKS } from './keywords.js';

const CONTEXT_CHARS = 150;
const MAX_EXCERPTS_PER_CATEGORY = 2;

// バンドル/圧縮済みらしいJSとみなす閾値
const MINIFIED_MIN_LENGTH = 5000;
const MINIFIED_AVG_LINE_LENGTH = 300;

/**
 * 観点（カテゴリ）ごとに、複数のソース本文から抜粋を作る。
 *
 * @param {Array<{ label: string, text: string }>} sources 本文一覧（優先順）
 * @param {Array<{ key: string, label: string, keywords: string[] }>} categories 観点一覧
 * @returns {Array<{ key: string, label: string, excerpts: Array<{ keyword: string, source: string, excerpt: string }> }>}
 */
export function extractCategoryExcerpts(sources, categories) {
  return categories.map((category) => {
    const excerpts = [];

    for (const source of sources || []) {
      if (excerpts.length >= MAX_EXCERPTS_PER_CATEGORY) break;

      const text = source.text || '';
      if (!text) continue;

      const usedRanges = [];

      for (const keyword of category.keywords) {
        if (excerpts.length >= MAX_EXCERPTS_PER_CATEGORY) break;

        const index = text.toLowerCase().indexOf(keyword.toLowerCase());
        if (index === -1) continue;

        const start = Math.max(0, index - CONTEXT_CHARS);
        const end = Math.min(text.length, index + keyword.length + CONTEXT_CHARS);

        if (overlapsExisting(usedRanges, start, end)) continue;

        excerpts.push({
          keyword,
          source: source.label,
          excerpt: collapseWhitespace(text.slice(start, end)),
        });
        usedRanges.push([start, end]);
      }
    }

    return { key: category.key, label: category.label, excerpts };
  });
}

function overlapsExisting(ranges, start, end) {
  return ranges.some(([s, e]) => start < e && end > s);
}

function collapseWhitespace(text) {
  return text.replace(/\s+/g, ' ').trim();
}

/**
 * 検出項目の4値判定。
 *
 * - あり: 取得できたコード内でpatternが検出された
 * - なし: 取得できたコード内でpatternが検出されなかった
 * - 未確認: 確認対象の本文が1件も取得できていない
 *
 * @param {string[]} texts 確認対象の本文一覧
 * @param {RegExp} pattern
 * @returns {'あり' | 'なし' | '未確認'}
 */
export function detect4Value(texts, pattern) {
  const hasContent = (texts || []).some((text) => text && text.length > 0);
  if (!hasContent) return '未確認';

  const combined = texts.join('\n');
  return pattern.test(combined) ? 'あり' : 'なし';
}

/**
 * JS内キーワード検出（本文12項目）。
 *
 * HTMLに<canvas>タグが無くても、JavaScript側でCanvas/WebGLが
 * 生成・操作されている場合があるため、HTML構造の判定とは別枠で確認する。
 *
 * @param {string[]} texts JS本文（インライン/外部）の一覧
 * @returns {Array<{ key: string, label: string, value: 'あり' | 'なし' | '未確認' }>}
 */
export function detectJsFeatures(texts) {
  return JS_FEATURE_CHECKS.map(({ key, label, pattern }) => ({
    key,
    label,
    value: detect4Value(texts, pattern),
  }));
}

/**
 * バンドル/圧縮済み（minify済み）らしいJS本文かどうかを判定する。
 * 外部ライブラリ検出で、固有の識別子が圧縮で失われ「特定できず」と
 * 判定するための補助に使う。
 *
 * @param {string} text
 * @returns {boolean}
 */
export function looksMinified(text) {
  if (!text || text.length < MINIFIED_MIN_LENGTH) return false;

  const lines = text.split('\n').filter((line) => line.length > 0);
  if (lines.length === 0) return false;

  const avgLineLength = text.length / lines.length;
  return avgLineLength > MINIFIED_AVG_LINE_LENGTH;
}
