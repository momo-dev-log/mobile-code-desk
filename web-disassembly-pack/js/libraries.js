/**
 * 外部ライブラリ検出辞書（初期対象10個・固定）。
 *
 * 検出方法:
 * - 段階1: script src のURL文字列から拾う（CDN/ファイル名）
 * - 段階2: グローバル変数痕跡やライセンスコメントから拾う
 * - 段階3のような強い推測（バンドル内の挙動からの推測など）は行わない
 *
 * バンドルでライブラリ名が消えている場合は「なし」と決めつけず、
 * 「特定できず」として記録する（looksMinifiedで判定）。
 */
import { looksMinified } from './excerpt.js';

export const LIBRARY_CHECKS = [
  {
    key: 'three',
    label: 'Three.js',
    srcPattern: /three(\.min)?\.js|three@/i,
    globalPattern: /\bTHREE\.|new\s+THREE\b|\bTHREE\s*=/,
  },
  {
    key: 'p5',
    label: 'p5.js',
    srcPattern: /p5(\.min)?\.js|p5@/i,
    globalPattern: /new\s+p5\s*\(|\bp5\.prototype\b|p5\.js\s*v[\d.]+/,
  },
  {
    key: 'pixi',
    label: 'PixiJS',
    srcPattern: /pixi(\.min)?\.js|pixi\.js@/i,
    globalPattern: /\bPIXI\.|new\s+PIXI\b/,
  },
  {
    key: 'regl',
    label: 'regl',
    srcPattern: /regl(\.min)?\.js|regl@/i,
    globalPattern: /require\(\s*['"]regl['"]\s*\)|\bregl\s*\(\s*\{/,
  },
  {
    key: 'gsap',
    label: 'GSAP',
    srcPattern: /gsap(\.min)?\.js|gsap@/i,
    globalPattern: /\bgsap\.to\(|\bgsap\.timeline\(|\bTweenMax\b|\bTweenLite\b/,
  },
  {
    key: 'anime',
    label: 'anime.js',
    srcPattern: /anime(\.min)?\.js|animejs@/i,
    globalPattern: /\banime\s*\(\s*\{|\banime\.timeline\(/,
  },
  {
    key: 'matter',
    label: 'Matter.js',
    srcPattern: /matter(\.min)?\.js|matter-js@/i,
    globalPattern: /\bMatter\.Engine\b|\bMatter\.World\b|\bMatter\.Bodies\b/,
  },
  {
    key: 'react',
    label: 'React',
    srcPattern: /react(-dom)?(\.production)?(\.min)?\.js|react@/i,
    globalPattern: /\breact\.createElement\b|\bReactDOM\b|__REACT_DEVTOOLS_GLOBAL_HOOK__|from\s+['"]react['"]/,
  },
  {
    key: 'vue',
    label: 'Vue',
    srcPattern: /vue(\.global)?(\.runtime)?(\.min)?\.js|vue@/i,
    globalPattern: /\bVue\.createApp\b|__VUE__|from\s+['"]vue['"]/,
  },
  {
    key: 'svelte',
    label: 'Svelte',
    srcPattern: /svelte/i,
    globalPattern: /from\s+['"]svelte['"]|SvelteComponent/,
  },
];

// サマリ行のキー順は LIBRARY_CHECKS の並び順と一致（lib_<key>）
export const LIBRARY_SUMMARY_PREFIX = 'lib_';

/**
 * 外部ライブラリ検出（4値）。
 *
 * - あり: script srcまたはJS本文中の痕跡から検出された
 * - なし: 確認対象の本文・URLがあり、痕跡が見つからなかった
 * - 特定できず: 確認対象はあるが、バンドル/圧縮済みで判別できない
 * - 未確認: 確認対象の本文・URLが1件も無い
 *
 * @param {{ scriptUrls?: string[], texts?: string[] }} input
 * @returns {Array<{ key: string, label: string, value: 'あり' | 'なし' | '特定できず' | '未確認' }>}
 */
export function detectLibraries({ scriptUrls = [], texts = [] } = {}) {
  const nonEmptyTexts = (texts || []).filter((text) => text && text.length > 0);
  const hasContent = nonEmptyTexts.length > 0 || (scriptUrls || []).length > 0;
  const combined = nonEmptyTexts.join('\n');
  const minified = nonEmptyTexts.some((text) => looksMinified(text));

  return LIBRARY_CHECKS.map(({ key, label, srcPattern, globalPattern }) => {
    if ((scriptUrls || []).some((url) => srcPattern.test(url))) {
      return { key, label, value: 'あり' };
    }

    if (globalPattern.test(combined)) {
      return { key, label, value: 'あり' };
    }

    if (!hasContent) {
      return { key, label, value: '未確認' };
    }

    if (minified) {
      return { key, label, value: '特定できず' };
    }

    return { key, label, value: 'なし' };
  });
}
