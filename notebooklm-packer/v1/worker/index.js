/**
 * NotebookLM 用サイト資料化ツール - Phase 1
 * Cloudflare Worker：1URL の HTML 取得プロキシ
 *
 * 使い方：
 *   GET https://your-worker.workers.dev/?url=https://target-site.com/page
 *
 * 返り値：
 *   対象サイトの HTML（CORS ヘッダー付き）
 *
 * エラー時：
 *   JSON { "error": "..." } を返す
 */

export default {
  async fetch(request, env, ctx) {

    // -----------------------------------------------
    // CORS プリフライト（OPTIONS）への応答
    // ブラウザが本リクエストの前に自動送信する確認リクエスト
    // -----------------------------------------------
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        status: 204,
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type',
        },
      });
    }

    // -----------------------------------------------
    // GET のみ受け付ける
    // -----------------------------------------------
    if (request.method !== 'GET') {
      return errorJson('Method not allowed', 405);
    }

    // -----------------------------------------------
    // クエリパラメータから ?url= を取得
    // -----------------------------------------------
    const reqUrl = new URL(request.url);
    const targetUrl = reqUrl.searchParams.get('url');

    if (!targetUrl) {
      return errorJson('Missing required parameter: url', 400);
    }

    // -----------------------------------------------
    // URL 形式チェック
    // -----------------------------------------------
    let parsed;
    try {
      parsed = new URL(targetUrl);
    } catch {
      return errorJson('Invalid URL format', 400);
    }

    // -----------------------------------------------
    // プロトコルチェック（SSRF 基本対策）
    // http / https のみ許可。file:// や ftp:// は拒否
    // -----------------------------------------------
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return errorJson('Only http and https are allowed', 400);
    }

    // -----------------------------------------------
    // 対象サイトへ fetch
    // redirect: 'follow' で http→https リダイレクトも自動追跡
    // -----------------------------------------------
    let siteResponse;
    try {
      siteResponse = await fetch(targetUrl, {
        method: 'GET',
        headers: {
          // 一般的なブラウザの UA を偽装（Bot と判定されにくくする）
          'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) ' +
            'AppleWebKit/537.36 (KHTML, like Gecko) ' +
            'Chrome/120.0.0.0 Safari/537.36',
          'Accept':
            'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Accept-Language': 'ja,en-US;q=0.9,en;q=0.8',
        },
        redirect: 'follow',
      });
    } catch (e) {
      // DNS 解決失敗・ネットワークエラー・タイムアウト など
      return errorJson(`Fetch failed: ${e.message}`, 502);
    }

    // -----------------------------------------------
    // HTML テキストとして読み取り
    // -----------------------------------------------
    const html = await siteResponse.text();

    // -----------------------------------------------
    // CORS ヘッダーを付けてブラウザに返す
    // X-Source-Status / X-Source-Url はデバッグ用
    // -----------------------------------------------
    return new Response(html, {
      status: 200,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Content-Type': 'text/html; charset=utf-8',
        'X-Source-Status': String(siteResponse.status),
        'X-Source-Url': targetUrl,
      },
    });
  },
};

// -----------------------------------------------
// ヘルパー：エラーを JSON 形式で返す
// -----------------------------------------------
function errorJson(message, status) {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Content-Type': 'application/json; charset=utf-8',
    },
  });
}
