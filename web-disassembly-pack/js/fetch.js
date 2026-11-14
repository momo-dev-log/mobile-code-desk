import { WORKER_URL } from './constants.js';

/**
 * 専用Worker（worker/index.js）経由でリソース（HTML/CSS/JS）を取得する。
 *
 * timeoutMs で通信（応答本文の読み取りを含む）を打ち切り、
 * reason: 'timeout' を返す。指定しない呼び出しも20秒で打ち切る。
 * 打ち切ってもWorker側の処理は止まらない。
 *
 * @param {string} targetUrl
 * @param {{ timeoutMs?: number }} [options]
 * @returns {Promise<
 *   { ok: true, content: string, contentType: string, finalUrl: string, httpStatus: number } |
 *   { ok: false, reason: 'network' | 'http_error' | 'too_large' | 'timeout', httpStatus?: number }
 * >}
 */
export async function fetchResource(targetUrl, options = {}) {
  const endpoint = `${WORKER_URL}/?url=${encodeURIComponent(targetUrl)}`;

  const controller = new AbortController();
  let timedOut = false;
  const timeoutMs = Number.isFinite(options.timeoutMs) && options.timeoutMs >= 0 ? options.timeoutMs : 20000;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);

  try {
    const result = await readJson(() => fetch(endpoint, { signal: controller.signal }));
    return timedOut ? { ok: false, reason: 'timeout' } : result;
  } finally {
    clearTimeout(timer);
  }
}

async function readJson(request) {
  let response;
  try {
    response = await request();
  } catch {
    return { ok: false, reason: 'network' };
  }

  try {
    return await response.json();
  } catch {
    return { ok: false, reason: 'network' };
  }
}
