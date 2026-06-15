/**
 * 外部ライブラリ検出辞書（初期対象10個・固定）。
 *
 * 検出方法:
 * - 段階1: script src のURL文字列から拾う（CDN/ファイル名）
 * - 段階2: グローバル変数痕跡やライセンスコメントから拾う
 * - 段階3のような強い推測（バンドル内の挙動からの推測など）は行わない
 *
 * 「特定できず」は、取得できたコードが全体的にminify/バンドルされていて、
 * かつ10ライブラリどれも痕跡が見つからなかった場合（＝判別材料が無い）のみ使う。
 * いずれかのライブラリが検出できている場合は、検出コードへの十分な視界がある
 * とみなし、他のライブラリは「なし」とする（looksMinifiedで判定）。
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
 * - あり: script srcのURLまたはJS本文中の痕跡（グローバル変数等）から検出された
 * - なし: 取得できたコードがあり、かつ（他のライブラリが検出できている、または
 *   minify済みでない）状態で、痕跡が見つからなかった
 * - 特定できず: 取得できたコードはあるが、全体的にminify/バンドルされていて
 *   どのライブラリも特定できない（何らかのライブラリ利用は疑われるが判別不可）
 * - 未確認: 取得できたコードが1件も無い（外部リソースが取得対象外・取得失敗等）
 *
 * @param {{ scriptUrls?: string[], texts?: string[] }} input
 * @returns {Array<{ key: string, label: string, value: 'あり' | 'なし' | '特定できず' | '未確認' }>}
 */
export function detectLibraries({ scriptUrls = [], texts = [] } = {}) {
  const nonEmptyTexts = (texts || []).filter((text) => text && text.length > 0);
  const hasCode = nonEmptyTexts.length > 0;
  const combined = nonEmptyTexts.join('\n');
  const minified = nonEmptyTexts.some((text) => looksMinified(text));

  const results = LIBRARY_CHECKS.map(({ key, label, srcPattern, globalPattern }) => {
    if ((scriptUrls || []).some((url) => srcPattern.test(url))) {
      return { key, label, value: 'あり' };
    }

    if (globalPattern.test(combined)) {
      return { key, label, value: 'あり' };
    }

    return { key, label, value: null };
  });

  const anyFound = results.some((result) => result.value === 'あり');

  return results.map((result) => {
    if (result.value === 'あり') {
      return result;
    }

    if (!hasCode) {
      return { ...result, value: '未確認' };
    }

    if (!anyFound && minified) {
      return { ...result, value: '特定できず' };
    }

    return { ...result, value: 'なし' };
  });
}
