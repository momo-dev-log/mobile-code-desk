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
 * URLがsitemap候補かどうかを末尾の拡張子で判定する。
 * @param {string} url
 * @returns {boolean}
 */
export function isSitemapUrlCandidate(url) {
  return /\.xml(?:[?#].*)?$/i.test(url);
}
