import { WORKER_URL } from './constants.js';

/**
 * 専用Worker（worker/index.js）経由でリソース（HTML/CSS/JS）を取得する。
 *
 * @param {string} targetUrl
 * @returns {Promise<
 *   { ok: true, content: string, contentType: string, finalUrl: string, httpStatus: number } |
 *   { ok: false, reason: 'network' | 'http_error' | 'too_large', httpStatus?: number }
 * >}
 */
export async function fetchResource(targetUrl) {
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
