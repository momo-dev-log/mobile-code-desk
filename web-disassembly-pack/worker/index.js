/**
 * Web解体パック v0.1 用 Cloudflare Worker
 *
 * notebooklm-packer/worker/index.js (v2) をベースに、
 * HTMLだけでなくCSS/JSなど任意のテキストリソースも
 * 同じエンドポイントで取得できるよう汎用化したもの。
 *
 * 使い方:
 *   GET https://your-worker.workers.dev/?url=https://target-site.com/page
 *   GET https://your-worker.workers.dev/?url=https://target-site.com/style.css
 *
 * 応答:
 *   成功: { ok: true, content, contentType, finalUrl, httpStatus }
 *   失敗: { ok: false, reason: "network" | "http_error" | "too_large", httpStatus? }
 *
 * notebooklm-packer用Workerとは完全に独立しており、互いに影響しない。
 */

const MAX_RAW_BYTES = 5 * 1024 * 1024; // 5MB（安全側の上限。CSS/JSはフロント側でさらに小さい上限を適用する）
const FETCH_TIMEOUT_MS = 15000;

export default {
  async fetch(request) {
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        status: 204,
        headers: corsHeaders(),
      });
    }

    if (request.method !== 'GET') {
      return jsonResponse({ ok: false, reason: 'http_error', httpStatus: 405 }, 405);
    }

    const reqUrl = new URL(request.url);
    const targetUrl = reqUrl.searchParams.get('url');

    if (!targetUrl) {
      return jsonResponse({ ok: false, reason: 'http_error', httpStatus: 400 }, 400);
    }

    let parsed;
    try {
      parsed = new URL(targetUrl);
    } catch {
      return jsonResponse({ ok: false, reason: 'http_error', httpStatus: 400 }, 400);
    }

    if (!isAllowedTarget(parsed)) {
      return jsonResponse({ ok: false, reason: 'http_error', httpStatus: 400 }, 400);
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

    let siteResponse;
    let currentUrl = parsed.href;
    try {
      for (let redirectCount = 0; redirectCount <= 5; redirectCount += 1) {
        siteResponse = await fetch(currentUrl, {
        method: 'GET',
        headers: {
          'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) ' +
            'AppleWebKit/537.36 (KHTML, like Gecko) ' +
            'Chrome/120.0.0.0 Safari/537.36',
          'Accept': '*/*',
          'Accept-Language': 'ja,en-US;q=0.9,en;q=0.8',
        },
        redirect: 'manual',
        signal: controller.signal,
        });
        if (![301, 302, 303, 307, 308].includes(siteResponse.status)) break;
        const location = siteResponse.headers.get('location');
        if (!location || redirectCount === 5) {
          clearTimeout(timeoutId);
          return jsonResponse({ ok: false, reason: 'http_error', httpStatus: 400 }, 400);
        }
        const next = new URL(location, currentUrl);
        if (!isAllowedTarget(next)) {
          clearTimeout(timeoutId);
          return jsonResponse({ ok: false, reason: 'http_error', httpStatus: 400 }, 400);
        }
        currentUrl = next.href;
      }
    } catch {
      clearTimeout(timeoutId);
      return jsonResponse({ ok: false, reason: controller.signal.aborted ? 'timeout' : 'network' });
    }

    // Redirects without a usable Location must not be reported as fetched page content.
    if (siteResponse.status >= 300 && siteResponse.status < 400) {
      clearTimeout(timeoutId);
      return jsonResponse({ ok: false, reason: 'http_error', httpStatus: siteResponse.status });
    }

    if (siteResponse.status >= 400) {
      clearTimeout(timeoutId);
      return jsonResponse({ ok: false, reason: 'http_error', httpStatus: siteResponse.status });
    }

    const contentLength = siteResponse.headers.get('content-length');
    if (contentLength && Number(contentLength) > MAX_RAW_BYTES) {
      clearTimeout(timeoutId);
      return jsonResponse({ ok: false, reason: 'too_large', httpStatus: siteResponse.status });
    }

    let buffer;
    try {
      buffer = await siteResponse.arrayBuffer();
    } catch {
      return jsonResponse({ ok: false, reason: controller.signal.aborted ? 'timeout' : 'network' });
    } finally {
      clearTimeout(timeoutId);
    }

    if (buffer.byteLength > MAX_RAW_BYTES) {
      return jsonResponse({ ok: false, reason: 'too_large', httpStatus: siteResponse.status });
    }

    const contentType = siteResponse.headers.get('content-type') || '';
    const content = decodeBody(buffer, contentType);

    return jsonResponse({
      ok: true,
      content,
      contentType,
      finalUrl: siteResponse.url || currentUrl,
      httpStatus: siteResponse.status,
    });
  },
};

/**
 * Content-Typeヘッダとmetaタグから文字コードを判定し、UTF-8文字列に変換する。
 * Shift_JIS等のサイトでも文字化けしないようにする。
 * @param {ArrayBuffer} buffer
 * @param {string} contentType
 * @returns {string}
 */
function decodeBody(buffer, contentType) {
  let charset = getCharsetFromContentType(contentType);

  if (!charset && /html/i.test(contentType)) {
    // Content-Typeに無い場合、先頭バイト列をASCII相当で覗いてmetaタグを探す
    const preview = new TextDecoder('windows-1252').decode(buffer.slice(0, 2048));
    charset = getCharsetFromMeta(preview);
  }

  charset = normalizeCharsetLabel(charset);

  try {
    return new TextDecoder(charset, { fatal: false }).decode(buffer);
  } catch {
    return new TextDecoder('utf-8', { fatal: false }).decode(buffer);
  }
}

function getCharsetFromContentType(contentType) {
  if (!contentType) return null;
  const match = contentType.match(/charset=([^;]+)/i);
  return match ? match[1].trim() : null;
}

function getCharsetFromMeta(preview) {
  // <meta charset="utf-8"> 形式
  let match = preview.match(/<meta[^>]+charset=["']?([^"'\s/>]+)/i);
  if (match) return match[1];

  // <meta http-equiv="Content-Type" content="text/html; charset=Shift_JIS"> 形式
  match = preview.match(/<meta[^>]+http-equiv=["']?content-type["']?[^>]+content=["'][^"']*charset=([^"'\s;]+)/i);
  if (match) return match[1];

  return null;
}

function normalizeCharsetLabel(charset) {
  if (!charset) return 'utf-8';
  const lower = charset.toLowerCase().trim();
  // よくある表記揺れをTextDecoderが認識するラベルに正規化
  if (lower === 'shift_jis' || lower === 'shift-jis' || lower === 'sjis' || lower === 'x-sjis') {
    return 'shift_jis';
  }
  return lower;
}

function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };
}

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      ...corsHeaders(),
      'Content-Type': 'application/json; charset=utf-8',
    },
  });
}

/** Block local/private network targets and credentialed or nonstandard-port URLs.
 * DNS rebinding and distributed abuse limits require platform-level protection.
 */
export function isAllowedTarget(url) {
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return false;
  if (url.port && !['80', '443'].includes(url.port)) return false;
  const host = url.hostname.toLowerCase().replace(/\.$/, '').replace(/^\[|\]$/g, '');
  if (!host || host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || host.endsWith('.internal') || host.endsWith('.test') || host.endsWith('.invalid')) return false;
  if (!host.includes('.') && !host.includes(':')) return false;
  if (host.includes(':')) {
    // IPv6 literals, including mapped IPv4, are denied to avoid private-address bypasses.
    return false;
  }
  if (/^\d+(?:\.\d+){0,3}$/.test(host)) {
    const parts = host.split('.').map(Number);
    if (parts.length !== 4 || parts.some(n => n > 255)) return false;
    const [a, c] = parts;
    if (a === 0 || a === 10 || a === 127 || a >= 224 || (a === 169 && c === 254) || (a === 172 && c >= 16 && c <= 31) || (a === 192 && c === 168) || (a === 100 && c >= 64 && c <= 127) || (a === 192 && c === 0) || (a === 198 && (c === 18 || c === 19))) return false;
  }
  return true;
}
