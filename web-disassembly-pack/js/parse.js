/**
 * 取得したHTML文字列を解析し、AI向け調査パックに必要な情報を抽出する。
 *
 * - 構造の概要（canvas/button/audio/video/svg/script/styleの有無・件数）
 * - 外部CSS/JSの参照URL一覧（同一オリジン判定つき）
 * - インラインstyle/scriptの本文
 *
 * @param {string} html
 * @param {string} pageUrl 取得元ページのURL（相対URL解決・オリジン判定に使う）
 * @returns {{
 *   title: string,
 *   structure: {
 *     canvas: number, button: number, audio: number, video: number, svg: number,
 *     inlineScriptCount: number, externalScriptCount: number,
 *     inlineStyleCount: number, externalStylesheetCount: number,
 *   },
 *   cssLinks: Array<{ url: string, sameOrigin: boolean }>,
 *   jsScripts: Array<{ url: string, sameOrigin: boolean }>,
 *   inlineStyles: string[],
 *   inlineScripts: string[],
 * }}
 */
export function parseHtml(html, pageUrl) {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const pageOrigin = getOrigin(pageUrl);

  const structure = {
    canvas: doc.querySelectorAll('canvas').length,
    button: doc.querySelectorAll('button').length,
    audio: doc.querySelectorAll('audio').length,
    video: doc.querySelectorAll('video').length,
    svg: doc.querySelectorAll('svg').length,
    inlineScriptCount: 0,
    externalScriptCount: 0,
    inlineStyleCount: 0,
    externalStylesheetCount: 0,
  };

  const cssLinks = [];
  doc.querySelectorAll('link[rel~="stylesheet"]').forEach((link) => {
    const href = link.getAttribute('href');
    const absolute = resolveUrl(href, pageUrl);
    if (!absolute) return;
    cssLinks.push({ url: absolute, sameOrigin: getOrigin(absolute) === pageOrigin });
    structure.externalStylesheetCount += 1;
  });

  const inlineStyles = [];
  doc.querySelectorAll('style').forEach((style) => {
    const text = (style.textContent || '').trim();
    if (!text) return;
    inlineStyles.push(text);
    structure.inlineStyleCount += 1;
  });

  const jsScripts = [];
  const inlineScripts = [];
  doc.querySelectorAll('script').forEach((script) => {
    const src = script.getAttribute('src');
    if (src) {
      const absolute = resolveUrl(src, pageUrl);
      if (!absolute) return;
      jsScripts.push({ url: absolute, sameOrigin: getOrigin(absolute) === pageOrigin });
      structure.externalScriptCount += 1;
    } else {
      const text = (script.textContent || '').trim();
      if (!text) return;
      inlineScripts.push(text);
      structure.inlineScriptCount += 1;
    }
  });

  return {
    title: (doc.title || '').trim(),
    structure,
    cssLinks,
    jsScripts,
    inlineStyles,
    inlineScripts,
  };
}

function resolveUrl(maybeRelative, baseUrl) {
  if (!maybeRelative) return null;
  try {
    return new URL(maybeRelative, baseUrl).href;
  } catch {
    return null;
  }
}

function getOrigin(url) {
  try {
    return new URL(url).origin;
  } catch {
    return '';
  }
}
