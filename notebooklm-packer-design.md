# NotebookLM用サイト資料化ツール 設計レポート

作成日：2026-05-24

---

## 概要

NotebookLMに入れるための資料を作るツール。  
NotebookLMへの自動送信はしない。  
まずは1URLのHTML取得・本文抽出・Markdown変換に絞ったMVP。

---

## 全体構成

```
ユーザー（ブラウザ）
  │
  │ ① URL入力
  ▼
┌─────────────────────────────────┐
│  notebooklm-packer              │
│  （静的Webアプリ）               │
│  GitHub Pages / 任意ホスト       │
│                                 │
│  ① URL入力                     │
│  ④ HTML受取 → 本文抽出          │
│  ⑤ Markdown整形                │
│  ⑥ .md/.txt ダウンロード        │
└──────────┬──────────────────────┘
           │ ② fetch('Worker?url=...')
           ▼
┌──────────────────────┐
│  Cloudflare Worker   │
│                      │
│  ③ 対象URLをfetch() │
│  CORSヘッダー付与    │
│  HTMLをそのまま返す  │
└──────────┬───────────┘
           │ ③ fetch('https://target-site.com/page')
           ▼
      外部サイト
```

---

## 各レイヤーの役割分担

### Cloudflare Worker の役割（シンプルに保つ）

| 役割 | やる | やらない |
|------|------|---------|
| URLを受け取って外部サイトをfetch | ✅ | |
| CORSヘッダーを付けて返す | ✅ | |
| HTMLをそのまま返す（生HTML） | ✅ | |
| User-Agentを一般的なブラウザに偽装 | ✅ | |
| URL検証・SSRFガード | ✅ | |
| 本文抽出・Markdown変換 | ❌ | ブラウザ側でやる |
| キャッシュ（将来拡張） | 将来 | |

Worker をシンプルにする理由：
- Workerの無料枠はCPU時間が短い（10ms）
- HTMLパース処理はブラウザの DOMParser の方が得意
- Worker側が複雑になると後のデバッグが困難
- 将来的に抽出ロジックを変えたいときにフロント側だけ修正できる

### フロント（別アプリ）の役割

| 役割 | 担当 |
|------|------|
| URL入力受付 | フロント |
| WorkerへfetchリクエストをGET | フロント |
| 取得したHTMLをDOMParserで解析 | フロント |
| nav・footer・script等の不要要素除去 | フロント |
| 本文・見出し・リストを抽出 | フロント |
| Markdown形式に変換 | フロント |
| プレビュー表示 | フロント |
| .md / .txt ダウンロード | フロント |

---

## Cloudflare Worker の設計

```javascript
// worker/index.js

export default {
  async fetch(request, env) {
    // CORS preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET, POST',
          'Access-Control-Allow-Headers': 'Content-Type',
        }
      });
    }

    const url = new URL(request.url);
    const targetUrl = url.searchParams.get('url');

    // バリデーション
    if (!targetUrl) {
      return new Response('Missing url parameter', { status: 400 });
    }

    // SSRFガード：内部IPへのアクセスを防ぐ
    try {
      const parsed = new URL(targetUrl);
      if (!['http:', 'https:'].includes(parsed.protocol)) {
        return new Response('Invalid protocol', { status: 400 });
      }
    } catch {
      return new Response('Invalid URL', { status: 400 });
    }

    // 対象サイトをfetch
    const response = await fetch(targetUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept': 'text/html,application/xhtml+xml',
        'Accept-Language': 'ja,en;q=0.9',
      },
      redirect: 'follow',
    });

    const html = await response.text();

    // CORSヘッダーを付けて返す
    return new Response(html, {
      status: response.status,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Content-Type': 'text/html; charset=utf-8',
        'X-Source-Url': targetUrl,
        'X-Source-Status': String(response.status),
      }
    });
  }
};
```

---

## フロント（別アプリ）の設計

### HTML本文抽出ロジック（概念設計）

```javascript
function extractContent(rawHtml, sourceUrl) {
  const parser = new DOMParser();
  const doc = parser.parseFromString(rawHtml, 'text/html');

  // ① 不要タグを除去
  const removeSelectors = [
    'script', 'style', 'noscript',
    'nav', 'header', 'footer', 'aside',
    '.ad', '.advertisement', '.sidebar',
    '[role="navigation"]', '[role="banner"]',
    '[aria-hidden="true"]'
  ];
  removeSelectors.forEach(sel => {
    doc.querySelectorAll(sel).forEach(el => el.remove());
  });

  // ② メインコンテンツ候補を探す（優先順）
  const main =
    doc.querySelector('main') ||
    doc.querySelector('article') ||
    doc.querySelector('[role="main"]') ||
    doc.querySelector('#main') ||
    doc.querySelector('#content') ||
    doc.querySelector('.content') ||
    doc.querySelector('.entry-content') ||   // WordPress
    doc.querySelector('.post-body') ||        // はてなブログ
    doc.body;

  // ③ タイトル取得
  const title = doc.title || doc.querySelector('h1')?.textContent || 'untitled';

  // ④ Markdown変換
  const markdown = convertToMarkdown(main, sourceUrl);

  return { title, markdown };
}
```

### Markdown変換ロジック（概念設計）

```javascript
function convertToMarkdown(element, baseUrl) {
  let md = '';

  function walk(node) {
    if (node.nodeType === Node.TEXT_NODE) {
      const text = node.textContent.trim();
      if (text) md += text + ' ';
      return;
    }

    if (node.nodeType !== Node.ELEMENT_NODE) return;

    const tag = node.tagName.toLowerCase();

    switch(tag) {
      case 'h1': md += `\n\n# ${node.textContent.trim()}\n\n`; return;
      case 'h2': md += `\n\n## ${node.textContent.trim()}\n\n`; return;
      case 'h3': md += `\n\n### ${node.textContent.trim()}\n\n`; return;
      case 'h4': md += `\n\n#### ${node.textContent.trim()}\n\n`; return;
      case 'p':
        md += `\n\n`;
        node.childNodes.forEach(walk);
        md += `\n\n`;
        return;
      case 'li':  md += `\n- ${node.textContent.trim()}`; return;
      case 'a':
        const href = node.getAttribute('href');
        const absUrl = href ? new URL(href, baseUrl).href : '';
        md += `[${node.textContent.trim()}](${absUrl})`;
        return;
      case 'strong': case 'b':
        md += `**${node.textContent.trim()}**`; return;
      case 'em': case 'i':
        md += `*${node.textContent.trim()}*`; return;
      case 'code':
        md += `\`${node.textContent.trim()}\``; return;
      case 'pre':
        md += `\n\`\`\`\n${node.textContent.trim()}\n\`\`\`\n`; return;
      case 'blockquote':
        md += `\n> ${node.textContent.trim().replace(/\n/g, '\n> ')}\n`;
        return;
      case 'hr': md += '\n\n---\n\n'; return;
      default:
        node.childNodes.forEach(walk);
    }
  }

  walk(element);
  return md.replace(/\n{3,}/g, '\n\n').trim();
}
```

---

## MVPの画面構成

```
┌────────────────────────────────────────────┐
│  📄 NotebookLM 資料化ツール               │
├────────────────────────────────────────────┤
│                                            │
│  取得するページのURL                        │
│  ┌──────────────────────────────────────┐  │
│  │ https://example.com/article/...      │  │
│  └──────────────────────────────────────┘  │
│                                            │
│         [📥 取得してMarkdownに変換]         │
│                                            │
├────────────────────────────────────────────┤
│  ⏳ 取得中...  /  ✅ 完了  /  ❌ エラー   │
├────────────────────────────────────────────┤
│  Markdown プレビュー                        │
│  ┌──────────────────────────────────────┐  │
│  │ # ページタイトル                      │  │
│  │                                      │  │
│  │ ## はじめに                          │  │
│  │ 本文テキストが入ります...             │  │
│  │                                      │  │
│  └──────────────────────────────────────┘  │
├────────────────────────────────────────────┤
│  [📋 コピー] [⬇ .md] [⬇ .txt]           │
│                                            │
│  ⚠️ 注意：JS描画サイト・ログイン必須ページ  │
│  は取得できない場合があります              │
└────────────────────────────────────────────┘
```

---

## 必要なファイル構成

```
notebooklm-packer/
│
├── index.html                ← フロントUI
├── app.js                    ← 取得・変換・ダウンロードロジック
├── style.css                 ← スタイル
│
└── worker/
    ├── index.js              ← Cloudflare Worker本体
    └── wrangler.toml         ← Worker設定ファイル（デプロイ設定）
```

- Worker は別途Cloudflareアカウントにデプロイ（無料）
- フロントはGitHub Pagesでホスト可能（静的ファイルのみ）

---

## 実装手順（優先順）

```
Phase 1: Worker作成・動作確認
  └─ Cloudflareアカウント作成
  └─ Worker作成（URLを受けてHTMLを返す）
  └─ curlやブラウザで単体動作確認

Phase 2: フロント最小版
  └─ index.html + app.js でURL入力→Worker呼び出し
  └─ 取得したHTMLをconsole.logで確認
  └─ ステータス表示（取得中/完了/エラー）

Phase 3: 本文抽出
  └─ DOMParserで不要タグ除去
  └─ メインコンテンツ特定ロジック
  └─ テキスト抽出確認

Phase 4: Markdown変換
  └─ 見出し・段落・リスト変換
  └─ プレビュー表示

Phase 5: ダウンロード
  └─ .md / .txt ファイル出力
  └─ クリップボードコピー

Phase 6: デプロイ
  └─ フロントをGitHub Pagesへ
  └─ WorkerのURLをフロントに設定
```

---

## 注意点・制限事項

### 取得できないページ（想定）

| ケース | 理由 |
|--------|------|
| ログイン必須ページ | Workerはセッション/Cookieを持てない |
| JavaScriptで描画するSPA | Workerはブラウザではないため実行されない |
| Cloudflare保護サイト（bot対策） | UAを偽装しても検出される場合あり |
| 404 / 5xx エラーページ | エラーコードをフロントに伝えて表示 |
| 非常に大きなHTMLページ | Worker無料枠のメモリ上限128MBに引っかかる可能性 |
| PDFやバイナリファイル | HTML以外は未対応（MVP範囲外） |

### 制約・注意点

| 項目 | 内容 |
|------|------|
| Worker無料枠 | 1日10万リクエストまで（個人利用では十分） |
| Worker CPU時間 | 1リクエストあたり10ms（HTMLのfetchだけなら余裕） |
| Worker URL | デプロイ後に https://xxx.workers.dev のURLが発行される |
| CORS設定 | Worker側で Access-Control-Allow-Origin: * を必ず付ける |
| フロントのWorker URL | 環境変数または定数としてapp.jsに書く |
| 著作権 | 取得コンテンツは個人のNotebookLM利用範囲で使用すること |

---

## CodeDesk内に入れるか、別アプリにするかの判断

| 観点 | CodeDesk内に追加 | 別アプリ（推奨） |
|------|----------------|----------------|
| Worker連携 | CodeDesk構造に馴染まない | 独立して設計しやすい |
| コードの肥大化 | app.jsがさらに増加 | 分離できる |
| 機能の方向性 | コード編集ツールと目的が異なる | 専用ツールとして明確 |
| 将来拡張（複数URL・sitemap対応） | やりにくい | 独立して拡張しやすい |
| デプロイ | 同じリポジトリで済む | 新リポジトリ or サブフォルダ |

→ 別アプリとして作るのが正解。
CodeDeskで開発して別リポジトリにデプロイする形が最もきれい。

---

## MVPのスコープ（実装開始時の範囲）

### ✅ MVP に含める
- URL入力欄
- WorkerへのGETリクエスト
- HTMLをDOMParserで解析
- 不要タグ（script/nav/footer等）除去
- 見出し・段落・リストのMarkdown変換
- テキストエリアにプレビュー表示
- .txt ダウンロード

### ❌ MVP には含めない（後回し）
- .md ダウンロード（txtと内容は同じ）
- 複数URL
- sitemap.xml対応
- キャッシュ
- 結果の保存
- NotebookLM向けメタ情報付与
