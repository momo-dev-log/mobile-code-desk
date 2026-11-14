/**
 * 取得・解析範囲（どのコードを何文字ぶん解析したか）を記録するための補助関数。
 *
 * CSS/JS本文は MAX_RESOURCE_CHARS を超えると先頭だけを解析対象にする。
 * そのとき「元の文字数」「解析した文字数」「切り詰めの有無」を必ず残し、
 * Markdownの「取得・解析範囲」セクションで明示できるようにする。
 *
 * DOMに依存しないため、Nodeのテストから直接呼べる。
 */
import { MAX_RESOURCE_CHARS } from './constants.js';

/**
 * 本文を解析対象の長さに切り詰め、範囲の情報を付けて返す。
 *
 * @param {string} text 元の本文
 * @param {number} [maxChars] 解析対象の上限文字数
 * @returns {{ size: number, analyzedChars: number, truncated: boolean, rawText: string }}
 *   size: 元の文字数 / analyzedChars: 実際に解析する文字数 / rawText: 解析対象の本文
 */
export function truncateForAnalysis(text, maxChars = MAX_RESOURCE_CHARS) {
  const source = text || '';
  const truncated = source.length > maxChars;
  const rawText = truncated ? source.slice(0, maxChars) : source;

  return {
    size: source.length,
    analyzedChars: rawText.length,
    truncated,
    rawText,
  };
}

/**
 * インラインstyle/scriptの記録を作る。
 *
 * @param {string} text 本文
 * @param {string} label 識別子（例: 「インラインscript #1」）
 * @returns {{ label: string, size: number, analyzedChars: number, truncated: boolean, rawText: string }}
 */
export function buildInlineEntry(text, label) {
  return { label, ...truncateForAnalysis(text) };
}
