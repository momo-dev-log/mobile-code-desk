# スマホで Cloudflare Worker をデプロイする手順（Phase 1）

対象：NotebookLM 用サイト資料化ツール Phase 1 の動作確認

---

## 事前準備

- Cloudflare アカウント（無料）が必要です
  - まだない場合 → https://dash.cloudflare.com/sign-up で作成
  - メールアドレスとパスワードだけで作れます（クレカ不要）
- スマホのブラウザ（Safari / Chrome どちらでも OK）

---

## 貼り付けるコード（コピーしておく）

Worker にそのまま貼り付けるコードです。
デプロイ手順に進む前に、このコードをコピーしておいてください。

```javascript
export default {
  async fetch(request, env, ctx) {

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

    if (request.method !== 'GET') {
      return errorJson('Method not allowed', 405);
    }

    const reqUrl = new URL(request.url);
    const targetUrl = reqUrl.searchParams.get('url');

    if (!targetUrl) {
      return errorJson('Missing required parameter: url', 400);
    }

    let parsed;
    try {
      parsed = new URL(targetUrl);
    } catch {
      return errorJson('Invalid URL format', 400);
    }

    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return errorJson('Only http and https are allowed', 400);
    }

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
        redirect: 'follow',
      });
    } catch (e) {
      return errorJson(`Fetch failed: ${e.message}`, 502);
    }

    const html = await siteResponse.text();

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

## STEP 1：Cloudflare にログイン

1. スマホのブラウザで https://dash.cloudflare.com を開く
2. メールアドレスとパスワードを入力して「Log in」をタップ
3. 2段階認証が設定してある場合は認証コードを入力する

---

## STEP 2：Workers & Pages を開く

ログイン後のダッシュボード画面で操作します。

```
画面左側 または 上部メニューに
「Workers & Pages」という項目があります
（スマホでは ☰ ハンバーガーメニューの中にある場合があります）
```

1. 「Workers & Pages」をタップ
2. 「Workers & Pages」の一覧画面が開きます

---

## STEP 3：Worker を新規作成する

「Workers & Pages」画面で：

1. 右上または上部にある **「Create」** ボタンをタップ
2. 「Create Worker」を選択（Pages ではなく Worker の方）
3. **Worker の名前を入力する欄**が出てきます
   - 例：`notebooklm-packer-worker`
   - 半角英数字とハイフンが使えます
   - 名前は後から変えられません（気に入らなければ別名で作り直しもできる）
4. 名前を入力したら **「Deploy」** ボタンをタップ
   - この時点ではデフォルトのサンプルコードが入った状態でデプロイされます
   - これで一旦 OK です（次のステップでコードを書き換えます）

---

## STEP 4：コードを書き換える

「Deploy」後に **「Edit code」** ボタンが表示されます。

1. **「Edit code」** をタップ
2. コードエディタ画面が開きます
3. エディタ内のコードを**すべて選択して削除**します
   - テキストを長押し → 「すべてを選択」→ 削除
   - または画面上部の「全選択」ボタンがある場合はそれを使う
4. 削除したら、先ほどコピーしておいた**コードを貼り付け**ます
5. 貼り付けたら右上の **「Deploy」** ボタンをタップ
6. 「Worker deployed」または「Deployed successfully」のような表示が出れば成功

---

## STEP 5：Worker URL を確認する

デプロイ後の画面、または Worker の詳細ページに Worker URL が表示されています。

```
形式：
https://[Worker名].[あなたのサブドメイン].workers.dev

例：
https://notebooklm-packer-worker.your-account.workers.dev
```

**この URL をメモまたはコピーしておきます。**  
（次の動作確認と、Phase 2 で使います）

Worker URL の確認場所：
- エディタ画面の上部に表示されている場合があります
- または「Workers & Pages」→ 作成した Worker 名をタップ → 詳細画面に表示

---

## STEP 6：動作確認用 URL を作る

Worker URL にテスト用のパラメータを付けます。

```
[Worker URL] + ?url= + [取得したいサイトのURL]
```

まずは `https://example.com` で確認します：

```
https://notebooklm-packer-worker.あなたのサブドメイン.workers.dev/?url=https://example.com
```

この URL をそのままブラウザのアドレスバーに入力して開きます。

---

## STEP 7：動作確認

### テスト ① 正常取得（HTML が返ることを確認）

ブラウザで以下を開く：
```
https://[Worker URL]/?url=https://example.com
```

**成功した場合に表示されるもの：**
```
Example Domain というタイトルや、
「This domain is for use in illustrative examples...」
という英語テキストのページが表示されます。
（スタイルが崩れていても HTML が取れていれば OK）
```

または画面に HTML コードがそのまま表示される場合もありますが、  
それも取得できている証拠なので成功です。

---

### テスト ② エラー確認（url パラメータなし）

ブラウザで以下を開く：
```
https://[Worker URL]/
```

**成功した場合に表示されるもの：**
```json
{"error":"Missing required parameter: url"}
```

このような JSON テキストが表示されれば正しく動いています。

---

### テスト ③ エラー確認（不正な URL）

ブラウザで以下を開く：
```
https://[Worker URL]/?url=not-a-url
```

**成功した場合に表示されるもの：**
```json
{"error":"Invalid URL format"}
```

---

### テスト ④ 日本語サイトで確認（任意）

実際に使いたい日本語サイトの記事 URL で試してみます。

```
https://[Worker URL]/?url=https://[実際の記事URL]
```

例（Wikipedia の記事など）：
```
https://[Worker URL]/?url=https://ja.wikipedia.org/wiki/日本
```

日本語テキストが含まれた HTML が表示されれば OK です。

---

## 成功の判定

| テスト | 確認内容 | 合格サイン |
|--------|---------|-----------|
| テスト ① | example.com の HTML 取得 | ページの内容またはHTMLが表示される |
| テスト ② | url なしのエラー | `{"error":"Missing required parameter: url"}` が表示される |
| テスト ③ | 不正 URL のエラー | `{"error":"Invalid URL format"}` が表示される |

テスト① ② ③ が全部通れば **Phase 1 完了** です。

---

## うまくいかない時に見るべき場所

### 「Worker URL 自体が開かない」場合
→ Workers & Pages の一覧で Worker が「Active」になっているか確認

### テスト ① で何も表示されない / エラーページになる場合
→ URL の形式を確認。`?url=` の前後にスペースが入っていないか

### テスト ① で `{"error":"Fetch failed: ..."}` が表示される場合
→ Worker は動いているが、対象サイトにアクセスできなかった
→ `https://example.com` は取れるはずなので URL を確認
→ 別のサイトで試してみる

### テスト ② ③ で JSON が表示されず HTML になる場合
→ コードの貼り付けが途中で切れた可能性あり
→ エディタを開いてコードが全部入っているか確認
→ 再度デプロイ

### コードエディタで「Syntax Error」が出る場合
→ コードの貼り付け時に文字が変換された可能性あり
→ エディタの内容を全削除してもう一度貼り付け直す

---

## 取得した Worker URL の次の使い方（Phase 2）

Phase 1 で確認した Worker URL をメモしておきます。

```
あなたの Worker URL：
https://notebooklm-packer-worker.[サブドメイン].workers.dev
```

Phase 2 では、この URL をフロント（HTML ページ）の JavaScript に定数として書きます。

```javascript
// Phase 2 の app.js で使う（Phase 2 になったら書く）
const WORKER_URL = 'https://notebooklm-packer-worker.[サブドメイン].workers.dev';
```

Phase 2 の内容：
- URL 入力欄と「取得」ボタンのシンプルな HTML ページを作る
- ボタンを押したら Worker を呼び出す
- 取得した HTML をテキストエリアに表示する
- （本文抽出・Markdown 変換はまだしない）

---

## まとめ

```
STEP 1：dash.cloudflare.com にログイン
STEP 2：Workers & Pages を開く
STEP 3：「Create」→「Create Worker」→ 名前を入力 →「Deploy」
STEP 4：「Edit code」→ デフォルトコードを削除 → コードを貼り付け →「Deploy」
STEP 5：Worker URL をメモする
STEP 6：ブラウザで確認用 URL を開く
  → https://[Worker URL]/?url=https://example.com
STEP 7：HTML が表示されれば Phase 1 完了
```
