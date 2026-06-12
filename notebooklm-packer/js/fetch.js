import { WORKER_URL } from './constants.js';

/**
 * 新Worker（worker/index.js）経由でHTMLを取得する。
 * docs/spec.md 9章のJSON応答仕様に準拠。
 *
 * @param {string} targetUrl
 * @returns {Promise<
 *   { ok: true, html: string, finalUrl: string, httpStatus: number } |
 *   { ok: false, reason: 'network' | 'http_error' | 'too_large', httpStatus?: number }
 * >}
 */
export async function fetchArticleHtml(targetUrl) {
  const endpoint = `${WORKER_URL}/?url=${encodeURIComponent(targetUrl)}`;

  let response;
  try {
    response = await fetch(endpoint);
  } catch {
    return { ok: false, reason: 'network' };
  }

  try {
    return await response.json();
  } catch {
    return { ok: false, reason: 'network' };
  }
}
