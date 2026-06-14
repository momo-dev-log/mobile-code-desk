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

    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return jsonResponse({ ok: false, reason: 'http_error', httpStatus: 400 }, 400);
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

    let siteResponse;
    try {
      siteResponse = await fetch(targetUrl, {
        method: 'GET',
        headers: {
          'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) ' +
            'AppleWebKit/537.36 (KHTML, like Gecko) ' +
            'Chrome/120.0.0.0 Safari/537.36',
          'Accept': '*/*',
          'Accept-Language': 'ja,en-US;q=0.9,en;q=0.8',
        },
        redirect: 'follow',
        signal: controller.signal,
      });
    } catch {
      return jsonResponse({ ok: false, reason: 'network' });
    } finally {
      clearTimeout(timeoutId);
    }

    if (siteResponse.status >= 400) {
      return jsonResponse({ ok: false, reason: 'http_error', httpStatus: siteResponse.status });
    }

    const contentLength = siteResponse.headers.get('content-length');
    if (contentLength && Number(contentLength) > MAX_RAW_BYTES) {
      return jsonResponse({ ok: false, reason: 'too_large', httpStatus: siteResponse.status });
    }

    let buffer;
    try {
      buffer = await siteResponse.arrayBuffer();
    } catch {
      return jsonResponse({ ok: false, reason: 'network' });
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
      finalUrl: siteResponse.url || targetUrl,
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
