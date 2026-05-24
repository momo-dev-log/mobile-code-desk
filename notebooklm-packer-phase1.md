# Phase 1 実装計画：Cloudflare Worker で 1URL の HTML 取得

作成日：2026-05-24  
対象：NotebookLM用サイト資料化ツール（CodeDesk 本体とは別アプリ）

---

## Phase 1 のゴール

> Cloudflare Worker に URL を渡したら、そのページの HTML が返ってくる。
> ブラウザから CORS エラーなしに読めること。

既存 CodeDesk ファイルには一切触れない。  
フロント UI もまだ作らない。  
Worker 単体の技術検証のみ。

---

## 全体構成

```
ブラウザ（検証用）
  │
  │ GET https://your-worker.workers.dev/?url=https://target-site.com/page
  ▼
┌─────────────────────────────────┐
│  Cloudflare Worker              │
│                                 │
│  ① URL パラメータ受け取り       │
│  ② URL バリデーション           │
│  ③ 対象サイトへ fetch()         │
│  ④ HTML テキストを取得          │
│  ⑤ CORS ヘッダー付きで返す     │
└──────────┬──────────────────────┘
           │ fetch('https://target-site.com/page')
           ▼
      対象サイト（外部）
```

Worker は**サーバーサイドで動く**ため、CORS 制限を受けない。  
ブラウザ → Worker 間は CORS ヘッダーを付けることで解決する。

---

## Cloudflare Worker 最小コード

ファイル：`worker/index.js`

```javascript
export default {
  async fetch(request, env, ctx) {

    // CORS プリフライト（OPTIONS）への応答
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

    // GET のみ受け付ける
    if (request.method !== 'GET') {
      return errorJson('Method not allowed', 405);
    }

    // クエリパラメータから url を取得
    const reqUrl = new URL(request.url);
    const targetUrl = reqUrl.searchParams.get('url');

    if (!targetUrl) {
      return errorJson('Missing required parameter: url', 400);
    }

    // URL 形式チェック
    let parsed;
    try {
      parsed = new URL(targetUrl);
    } catch {
      return errorJson('Invalid URL format', 400);
    }

    // プロトコルチェック（SSRF 基本対策：http/https のみ許可）
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return errorJson('Only http and https are allowed', 400);
    }

    // 対象サイトへ fetch
    let siteResponse;
    try {
      siteResponse = await fetch(targetUrl, {
        method: 'GET',
        headers: {
          'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) ' +
            'AppleWebKit/537.36 (KHTML, like Gecko) ' +
            'Chrome/120.0.0.0 Safari/537.36',
          'Accept':
            'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Accept-Language': 'ja,en-US;q=0.9,en;q=0.8',
        },
        redirect: 'follow',  // リダイレクト（http→https 等）を自動追跡
      });
    } catch (e) {
      // ネットワークエラー・DNS 解決失敗など
      return errorJson(`Fetch failed: ${e.message}`, 502);
    }

    // HTML テキストとして読み取り
    const html = await siteResponse.text();

    // CORS ヘッダーを付けてブラウザに返す
    return new Response(html, {
      status: 200,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Content-Type': 'text/html; charset=utf-8',
        'X-Source-Status': String(siteResponse.status),  // 元サイトの HTTP ステータス
        'X-Source-Url': targetUrl,                        // デバッグ用
      },
    });
  },
};

// ヘルパー：エラーを JSON で返す
function errorJson(message, status) {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Content-Type': 'application/json; charset=utf-8',
    },
  });
}
```

---

## Worker 設定ファイル

ファイル：`worker/wrangler.toml`

```toml
name = "notebooklm-packer-worker"
main = "index.js"
compatibility_date = "2025-01-01"

# 無料プランで十分（100,000 req/日）
# 有料プランへのアップグレード不要
```

---

## デプロイ手順（Cloudflare ダッシュボード経由・最も簡単）

### 前提
- Cloudflare アカウント（無料）が必要
- アカウント作成：https://dash.cloudflare.com/sign-up

### 手順

```
1. https://dash.cloudflare.com にログイン

2. 左メニュー「Workers & Pages」→「Create」

3. 「Create Worker」を選択

4. Worker 名を入力（例：notebooklm-packer-worker）

5. 「Deploy」ボタンでひとまずデプロイ（デフォルトコードが入った状態）

6. 「Edit code」ボタンでエディタを開く

7. デフォルトコードを全削除し、上記の index.js の内容を貼り付け

8. 右上「Deploy」ボタンで保存・公開

9. Worker URL が発行される
   例：https://notebooklm-packer-worker.YOUR_NAME.workers.dev
```

### 補足：Wrangler CLI を使う場合（任意）
```bash
# Node.js が必要
npm install -g wrangler
wrangler login
wrangler deploy
```
※ ダッシュボードでの手動デプロイの方が初回は簡単

---

## 動作確認手順

### STEP 1：curl で直接叩く（最も確実）

```bash
# 正常系：example.com の HTML が返ること
curl "https://notebooklm-packer-worker.YOUR_NAME.workers.dev/?url=https://example.com"

# ヘッダーを確認（Access-Control-Allow-Origin: * があること）
curl -I "https://notebooklm-packer-worker.YOUR_NAME.workers.dev/?url=https://example.com"

# エラー系：url パラメータなし → 400 エラーが返ること
curl "https://notebooklm-packer-worker.YOUR_NAME.workers.dev/"

# エラー系：不正な URL → 400 エラーが返ること
curl "https://notebooklm-packer-worker.YOUR_NAME.workers.dev/?url=not-a-url"

# エラー系：存在しないドメイン → 502 エラーが返ること
curl "https://notebooklm-packer-worker.YOUR_NAME.workers.dev/?url=https://this-domain-does-not-exist-xyz.com/"
```

### STEP 2：ブラウザのコンソールで fetch テスト

ブラウザで任意のページを開き、DevTools コンソールに貼り付けて実行：

```javascript
// Worker URL を自分のものに変える
const WORKER = 'https://notebooklm-packer-worker.YOUR_NAME.workers.dev';
const TARGET = 'https://example.com';

fetch(`${WORKER}/?url=${encodeURIComponent(TARGET)}`)
  .then(r => {
    console.log('HTTP Status:', r.status);
    console.log('CORS Header:', r.headers.get('Access-Control-Allow-Origin'));
    console.log('Source Status:', r.headers.get('X-Source-Status'));
    return r.text();
  })
  .then(html => {
    console.log('HTML length:', html.length);
    console.log('HTML preview:', html.slice(0, 300));
  })
  .catch(e => console.error('Error:', e));
```

### STEP 3：実際の記事ページで確認

```javascript
// 日本語サイトで試す例（はてなブログ等）
const TARGET = 'https://hatenablog.com/';  // 実際の記事URLに変える

fetch(`${WORKER}/?url=${encodeURIComponent(TARGET)}`)
  .then(r => r.text())
  .then(html => console.log(html.slice(0, 1000)));
```

---

## 成功判定

| チェック項目 | 確認方法 | 合格条件 |
|------------|---------|---------|
| Worker が起動している | ブラウザで Worker URL を開く | 何らかのレスポンスが返る |
| HTML が取得できる | curl で example.com を取得 | `<!DOCTYPE html>` を含む HTML が返る |
| CORS ヘッダーがある | curl -I でヘッダー確認 | `Access-Control-Allow-Origin: *` が含まれる |
| ブラウザから fetch できる | コンソールで fetch テスト | CORS エラーが出ない |
| url なしは 400 | curl でパラメータなし | `{"error":"Missing required parameter: url"}` |
| 不正 URL は 400 | curl で不正 URL | `{"error":"Invalid URL format"}` |
| 存在しないドメインは 502 | curl で存在しないドメイン | `{"error":"Fetch failed: ..."}` |

全項目クリアで **Phase 1 完了**。

---

## よくある失敗パターン

| 失敗 | 原因 | 対処 |
|------|------|------|
| Worker URL にアクセスできない | デプロイが完了していない | ダッシュボードで「Active」表示を確認 |
| ブラウザで CORS エラーが出る | ヘッダーの付け方が間違っている | `Access-Control-Allow-Origin: *` が全レスポンスに付いているか確認 |
| 対象サイトから 403 が返る | Bot 検出にかかっている | `X-Source-Status: 403` をログで確認。User-Agent を変えるか、サイトを変えてテスト |
| 対象サイトから 301/302 が返る | リダイレクト未追跡 | `redirect: 'follow'` になっているか確認 |
| `Fetch failed: ...` が返る | DNS 解決失敗 / 接続タイムアウト | 別の URL で試す |
| HTML が文字化けする | 文字エンコードの問題 | `Content-Type: text/html; charset=utf-8` を確認。サイト側が Shift-JIS の可能性 |
| Worker が 1101 エラーを返す | CPU 時間超過（10ms 無料枠） | 通常の fetch だけなら超えないはず。処理を追加しすぎていないか確認 |
| OPTIONS リクエストに応答しない | プリフライト未対応 | コード内の `if (request.method === 'OPTIONS')` ブロックを確認 |

---

## Phase 1 でできること / できないこと

### ✅ できること
- 静的 HTML を返すページの取得
- `http://` / `https://` URL の取得
- リダイレクト（301/302）の自動追跡
- CORS ヘッダー付きでのブラウザへの返却
- エラー時の JSON レスポンス
- 日本語サイトの取得（文字コードが UTF-8 の場合）

### ❌ できないこと
- JavaScript で描画される SPA（React/Vue 等）のコンテンツ取得
- ログインが必要なページの取得（Cookie/セッション非対応）
- Cloudflare Bot 管理・Imperva 等の強固な Bot 対策を突破すること
- `file://` / `ftp://` 等の非 HTTP プロトコル
- Shift-JIS など UTF-8 以外の文字コードの自動変換（文字化けする可能性あり）
- ページネーションや無限スクロールのコンテンツ
- 画像・PDF などバイナリファイルの取得（text() で読むと壊れる）
- 1 回のリクエストでの複数 URL 取得

---

## Phase 2 に進む条件

以下の **全項目** が確認できたら Phase 2 へ：

```
□ curl で example.com の HTML が返ること
□ レスポンスヘッダーに Access-Control-Allow-Origin: * があること
□ ブラウザのコンソールから fetch() で HTML が取得できること
□ CORS エラーが出ないこと
□ url パラメータなし / 不正 URL のエラーが適切に返ること
□ 実際に使いたいサイト（テスト用の記事 URL）で HTML が取得できること
```

---

## Phase 2 の内容（参考）

Phase 1 完了後に進む内容：

```
Phase 2：フロント最小版の作成
  ├─ index.html に URL 入力欄とボタンを作る
  ├─ app.js で Worker を呼び出す fetch ロジックを書く
  ├─ 取得した HTML を console.log で確認する
  └─ ステータス表示（取得中 / 完了 / エラー）を実装する
  ※ 本文抽出・Markdown 変換はまだしない
```

Phase 2 は Worker URL が確定してから始めること。  
（Worker URL を app.js の定数として書く必要があるため）

---

## ファイル構成まとめ

Phase 1 で新規作成するファイル：

```
notebooklm-packer/
└── worker/
    ├── index.js        ← Worker 本体（上記コード）
    └── wrangler.toml   ← Worker 設定（Wrangler CLI 用）
```

**既存の CodeDesk ファイルは一切変更しない。**
