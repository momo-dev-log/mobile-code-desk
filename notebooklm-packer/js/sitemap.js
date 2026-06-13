/**
 * sitemap XMLの解析（ブラウザ側）
 * docs/spec.md 4.1「sitemap取り込み（最小形）」に準拠。
 *
 * - urlset: 記事URL一覧として { type: 'urlset', urls }
 * - sitemapindex: 子sitemap URL一覧として { type: 'sitemapindex', urls }
 * - いずれにも該当しない場合は null（sitemapではない）
 *
 * 件数上限（MAX_SITEMAP_URLS）の適用・打ち切り判定は呼び出し側で行う。
 * 多段の入れ子sitemapindexの解決は呼び出し側の責務（本関数は1階層のみ解析する）。
 */

/**
 * @param {string} xmlText
 * @returns {{ type: 'urlset' | 'sitemapindex', urls: string[] } | null}
 */
export function parseSitemap(xmlText) {
  let doc;
  try {
    doc = new DOMParser().parseFromString(xmlText, 'application/xml');
  } catch {
    return null;
  }

  if (!doc || doc.querySelector('parsererror')) return null;

  const root = doc.documentElement;
  if (!root) return null;

  const tag = root.tagName.toLowerCase();

  if (tag === 'urlset') {
    const urls = [...doc.querySelectorAll('url > loc')]
      .map(el => el.textContent.trim())
      .filter(Boolean);
    return { type: 'urlset', urls };
  }

  if (tag === 'sitemapindex') {
    const urls = [...doc.querySelectorAll('sitemap > loc')]
      .map(el => el.textContent.trim())
      .filter(Boolean);
    return { type: 'sitemapindex', urls };
  }

  return null;
}

/**
 * 入力URLが「sitemapらしい」かを判定する（v1/app.js から移植）。
 * パスが .xml で終わる、または "sitemap" を含む場合に true。
 * @param {string} url
 * @returns {boolean}
 */
export function looksLikeSitemapUrl(url) {
  try {
    const pathname = new URL(url).pathname.toLowerCase();
    return pathname.endsWith('.xml') || pathname.includes('sitemap');
  } catch {
    return false;
  }
}

/**
 * サイトURLのオリジンから自動探索するsitemap候補パスを返す（v1/app.js から移植）。
 * /sitemap.xml → /sitemap_index.xml → /wp-sitemap.xml の順。
 * @param {string} siteUrl
 * @returns {string[]}
 */
export function getSitemapCandidates(siteUrl) {
  const origin = new URL(siteUrl).origin;
  return [
    `${origin}/sitemap.xml`,
    `${origin}/sitemap_index.xml`,
    `${origin}/wp-sitemap.xml`,
  ];
}
