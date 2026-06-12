/**
 * URL正規化（ブラックリスト方式）
 * docs/spec.md 7章の手順に準拠した純関数。
 *
 * 手順:
 * 1. 前後の空白・改行を除去
 * 2. スキームとホストを小文字化（パス・クエリは触らない）
 * 3. デフォルトポートを除去（:80, :443）
 * 4. フラグメント（#以降）を除去
 * 5. 追跡パラメータのみ除去: utm_*, fbclid, gclid, yclid, igshid, mc_cid, mc_eid
 * 6. 残ったクエリパラメータはキー名でソートして保持
 * 7. パスが「/」のみの場合は末尾スラッシュを除去。それ以外の末尾スラッシュは保持
 * 8. httpからhttpsへの昇格はしない
 */

const TRACKING_PARAM_NAMES = new Set([
  'fbclid',
  'gclid',
  'yclid',
  'igshid',
  'mc_cid',
  'mc_eid',
]);

/**
 * @param {string} input
 * @returns {string} 正規化されたURL
 */
export function normalizeUrl(input) {
  const trimmed = input.trim();
  const url = new URL(trimmed);

  // 4. フラグメント除去
  url.hash = '';

  // 5. 追跡パラメータ除去 + 6. 残りをキー名でソート
  const kept = [];
  for (const [key, value] of new URLSearchParams(url.search).entries()) {
    const lowerKey = key.toLowerCase();
    if (lowerKey.startsWith('utm_') || TRACKING_PARAM_NAMES.has(lowerKey)) {
      continue;
    }
    kept.push([key, value]);
  }
  kept.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));

  const sortedParams = new URLSearchParams();
  for (const [key, value] of kept) {
    sortedParams.append(key, value);
  }
  url.search = sortedParams.toString();

  // 7. パスが「/」のみの場合は末尾スラッシュを除去
  let result = url.toString();
  if (url.pathname === '/' && url.search === '') {
    result = result.replace(/\/$/, '');
  }

  // 2, 3, 8 は URL パーサーの標準動作（スキーム/ホストの小文字化、
  // デフォルトポート除去、プロトコルの保持）に従う。
  return result;
}
