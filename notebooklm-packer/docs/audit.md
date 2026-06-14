# notebooklm-packer 既存コード × 仕様書 v1.1 ギャップ分析

作成日: 2026-06-12
対象コミット: `50358bb`（Phase 11.5 マージ後の main）
対象仕様: `docs/spec.md`（v1.1 ドラフト）

> 本書は分析のみ。コード変更は行っていない。

---

## 1. 現状の構成図

```
mobile-code-desk/                       ← リポジトリ（GitHub Pages 配信）
├── index.html / app.js / style.css    ← MobileCodeDesk 本体（対象外・触らない）
└── notebooklm-packer/                 ← 本ツール
    ├── index.html   (411行)  縦1枚のセクション積みUI
    ├── app.js       (2996行) 全ロジック。グローバルスコープの単一スクリプト
    ├── style.css    (1827行) ダークテーマ・カード/ボタン部品
    └── worker/
        ├── index.js (126行)  Cloudflare Worker：生HTML中継プロキシ
        └── wrangler.toml
```

### index.html のセクション構成（上から順）

| セクション | 由来 | 内容 |
|---|---|---|
| 単一URL | Phase 1–5 | URL1件取得 → HTML/抽出本文/Markdown のタブ表示・保存 |
| 複数URL 資料パック | Phase 6/8/8.5/9.3 | textarea に1行1URL → 逐次取得 → 結合Markdown → コピー/txt/md/PDF用表示 |
| Sitemap候補 | Phase 7–11.5 | sitemap.xml 取得 → URL候補一覧（50件ページング・チェックボックス）→ タイトル取得・立ち読み・本文検索スコア → チェック済みを資料パック欄へ「反映」 |

### app.js の主要ブロックと依存関係

```
fetchHtmlFromWorker(url)                  ← 全取得の共通入口（Worker 経由）
  ├── handleFetch()                       単一URL
  ├── handleBatchFetch()                  資料パック作成（逐次・直列）
  ├── fetchAndParseSitemap()              sitemap 取得
  ├── fetchVisibleTitles()                titleCache（Map）
  ├── handlePreviewVisible/Checked()      previewCache（Map, 冒頭600字）
  └── handleBodySearch()                  bodySearchCache（Map, フル本文）

抽出系（DOMParser 前提・ブラウザ専用）
  prepareDoc() → extractBodyText() / nodeToPlainText()
              → htmlToMarkdown() / nodeToMarkdown()（表変換あり）
              → processForPack()（タイトル優先順位 H1 > title > URL）

検索系（Phase 11）
  parseKeywords / countKeywordOccurrences / computeSearchScore
  getRelevanceLabel（高/中/低/該当なし）/ needsSearchWarning（⚠️）

選択同期網（Phase 10.4–11.4）
  checkedSitemapUrls（Set）が真実
  togglePreviewUrlSelection() → URL一覧CB・立ち読みカード・検索カードを相互同期

出力系
  buildPackMarkdown() / generatePackName() / sanitizePackName()
  downloadPackMarkdown()（Blob保存）/ openPrintPreview()（PDF用表示）
```

### 状態の持ち方（重要）

**永続化は一切ない。** `localStorage` / `IndexedDB` の使用箇所ゼロ（grep で確認）。
全状態は in-memory（Map / Set / let 変数）と DOM（textarea の中身）に存在し、**リロードで全消滅**する。

---

## 2. 流用できる資産

### A. そのまま使える（ロジック単位で移植可）

| 資産 | 場所 | 仕様での用途 |
|---|---|---|
| `prepareDoc()` のノイズ除去＋セレクタフォールバック | app.js:585 | 本文抽出の中核。`main/article/[role=main]/#content/...` の優先順は実戦投入済み |
| `nodeToPlainText()` | app.js:846 | articleBody.body（プレーンテキスト）生成そのもの |
| `extractPageTitle()` / `processForPack()` のタイトル優先順位（H1 > doc.title > URL） | app.js:1660/687 | articleMeta.title |
| `countKeywordOccurrences()`（小文字化＋indexOf ループ） | app.js:2642 | scorer v1 の部分一致カウント |
| `escapeHtml()` / Blob ダウンロード処理 / クリップボード fallback | 各所 | そのまま |
| カード・ボタン・ステータスバーの CSS 部品（`--accent` 系変数、`.search-result-card` 等） | style.css | 3タブUIでも見た目の基盤として転用可 |
| Worker の CORS / SSRF 基本対策（プロトコル制限・OPTIONS 応答） | worker/index.js | 新 Worker でも同じ枠組みを維持 |

### B. 小修正で使える

| 資産 | 必要な修正 |
|---|---|
| `buildSearchResultCard()`（スコア・タイトル・選択列つきカード） | 仕様4.1の関連度カードの骨格に転用。抜粋1〜2行＋キーワード強調、立ち読みのカード内展開、「✅追加済み（押せない）＋小さい［候補から外す］」化が必要 |
| `computeSearchScore()` | OR合算＋除外語 → **AND判定＋タイトル一致ボーナス＋highlights 出力**に改修。scorer インターフェース `{score, highlights}` に合わせて出力形を変更 |
| `buildPackMarkdown()` | 目次・作成日時・記事数ヘッダ・記事ごとのメタ（元URL/ドメイン/取得日時/文字数）・スキップ注記の追加。本文を Markdown 変換ではなく**プレーンテキスト埋め込み**へ変更（仕様11） |
| `parseUrls()` | 改行のみ分割 → **改行＋空白分割**（仕様4.1）。正規化関数を通してから dedup |
| `generateFilename()` 系 | `notebooklm-pack_YYYYMMDD_HHmm.md` 固定形式へ |
| `fetchHtmlFromWorker()` | 新 Worker の構造化 JSON（`{ok, ...}`）対応へ書き換え。AbortController によるタイムアウトも追加余地 |
| 立ち読みパネルの DOM 生成（`buildPreviewItemDom`） | パネル方式 → カード内インライン展開へ。「閉じたらカード先頭へスクロール」「上下に閉じるボタン」要追加 |
| `showPackWarnCard()` の警告文構造 | 51件以上の警告バナー（仕様4.2）の文言・見た目に転用。ただし**分割ボタンは付けない** |

---

## 3. 捨てるべき部分（理由付き）

| 捨てる対象 | 理由 |
|---|---|
| **Sitemap セクション全体のUI**（URL候補一覧・50件ページング・全選択/全解除・現在ページ概念・折りたたみ） | 仕様v1.1 の取り込みは「URL貼り付け」のみで、sitemap 導線が存在しない（→ §6-1 で仕様側に確認提起）。ページング・現在ページ・チェックボックス一覧は pack.items モデルと両立しない |
| **選択同期網**（`togglePreviewUrlSelection` / `updatePreviewCardSelection` / `updateSearchCardSelection` / `updateAllSearchCardSelections` 等） | 「チェックボックス・立ち読みカード・検索カードの3つのUIを相互同期」する構造が複雑性の主因。仕様は pack.items を唯一の真実とし、UIは投影（再レンダリング）に徹するため同期コード自体が不要になる |
| **資料パック欄への「反映」→ textarea → パック作成 の間接フロー** | 仕様では候補（pack.items）→仕上げが直結。textarea を経由する中間状態は「カゴ」概念と矛盾 |
| **分割反映・`_partN` サフィックス**（Phase 9.3） | 仕様9: 50件超はハードリミットなしの警告のみ。分割は手動運用に委ねる設計 |
| **PDF用表示**（`openPrintPreview`、約200行＋印刷CSS） | 仕様3「やらないことリスト」: PDF生成はv1でやらない |
| **単一URL セクション**（HTML/抽出本文/Markdown タブ） | 仕様の3タブに存在しない。デバッグ用途なら開発時のみ残す選択もあるが、UIからは撤去 |
| **URL検索/除外フィルター**（Phase 9.2、11.1で既に hidden） | 仕様10の検索は保存済み本文への全文検索。URL文字列フィルターは役割消滅 |
| **本文除外キーワード・関連度高/中/低・⚠️注意判定** | 仕様10の検索仕様（AND・スコア降順のみ）に含まれない（→ §6-2 で確認提起。資産価値はあるため判断待ち） |
| **titleCache / previewCache / bodySearchCache の3層キャッシュ** | 「取得＝保存」の一元モデル（articleMeta + articleBody）に置き換え。同一URLを最大3回取得しうる現構造は仕様0「本文取得は基本1回」に反する |
| **資料パック名入力欄**（pack-name-input、_part 連動含む） | 仕様11はファイル名固定。pack.name は既定「資料パック」でファイル内見出しにのみ使用（→ §6-7） |

---

## 4. 仕様との差分で手戻りが大きい箇所トップ5

### 1位: 永続化レイヤーがゼロ → IndexedDB 三層ストア＋状態機械の新設

現状は揮発性 Map/Set のみで、仕様5〜6章に対応する資産が**何もない**。articleMeta/articleBody/pack のストア、同一トランザクション書き込み、孤児回収、マイグレーション雛形、すべて新規実装。さらに「fetchState を fetching にしてから取得開始」という**DB先行の状態遷移**は、現在の「fetch してから UI 更新」と処理順が逆で、取得フロー全体の書き直しを伴う。

### 2位: Worker の全面改修（現状は仕様9章にマップ不能）

詳細は §7-1。生HTML中継 → 構造化JSON＋抽出＋charset正規化＋タイムアウト＋エラー分類への変更で、現 Worker は実質書き直し。**現状の Worker には今すぐ直したいレベルの実害が2つ潜んでいる**（404ページを成功として返す／Shift_JIS が文字化けする — どちらも仕様のテスト観点に明記されている既知の弱点と一致）。
なお、これまでの開発運用ルール「Cloudflare Worker は変更しない」と仕様v1.1 は正面から矛盾するため、着手前にルール側の解除宣言が必要。

### 3位: UIシェルの転換（縦1枚 → 下部固定3タブ SPA）

index.html の3セクション構造とタブUIは別物で、DOM の大半を組み替える。カード部品・CSS変数は流用できるが、「さがすタブの折りたたみURL一覧」「候補タブ」「仕上げタブ」はいずれも新規。Phase 10〜11.5 で作り込んだ画面内導線（ページング・操作バー・折りたたみ）はほぼ引退する。

### 4位: データフローの逆転（UI相互同期 → 単一真実の投影）

現状: `checkedSitemapUrls`（Set）を3種類のUIが**相互に**同期し合う（Phase 10.4/11/11.4 で同期バグ修正を重ねてきた箇所）。仕様: pack.items が唯一の真実で、UIは状態から一方向に描画する。考え方の転換であり、既存の同期関数群は流用せず捨てて作り直す方が安全。引きずると同期バグの温床を新アーキテクチャに持ち込むことになる。

### 5位: URL正規化＋テスト基盤の不在

現状の重複判定は「文字列完全一致」のみで、仕様7章の正規化8手順・13テストケースに対応する資産がない。さらにリポジトリは**ビルドレス単一スクリプト構成でテストが1本もない**。テスト13本を「ユニットテストとして固定」するには、正規化・scorer 等の純関数を ES モジュールへ分離し、`node --test` 等で回せる構造（`js/` 分割＋`tests/`）への移行が前提になる。

---

## 5. 先に直すべき土台と着手順の提案

仕様書付録のフェーズ計画と整合させた具体案:

### Step 0: 土台整備（最初にやる）

- `notebooklm-packer/` を **ES モジュール構成に分割**: `js/normalize.js`（URL正規化・純関数）、`js/scorer.js`、`js/db.js`（IndexedDB ラッパ）、`js/worker-api.js`、`js/extract.js`（prepareDoc 系を移植）、`js/app.js`（UI）
- `tests/normalize.test.js` に仕様7章の13ケースを固定（`node --test` で実行。ブラウザ不要の純関数のみ対象）
- 現行アプリ（v0）は当面残す判断を推奨: 新アプリを `notebooklm-packer/v1/` などで並行開発し、受け入れ条件クリア後に差し替え。スマホ実機確認が唯一の検証手段である現状で、動くものを先に壊さない

### Step 1: データ層（仕様フェーズ1）

`db.js`（3ストア・同一トランザクション・孤児回収・onupgradeneeded 雛形）＋ `normalize.js`（テスト付き）。UIなしで完結する。

### Step 2: Worker 改修＋一本通し（仕様フェーズ2）

新 Worker（構造化JSON・charset・タイムアウト・エラー分類）→ `worker-api.js` → URL1件: 取り込み→取得→保存→立ち読み→候補→md生成→保存。**抽出をどちら側に置くかの決定（§6-3）がこの Step の前提条件。**

### Step 3〜5: 3タブUI → 状態表示 → 磨き（仕様フェーズ3〜5）

カードCSS・抽出ロジック・scorer を移植しながら肉付け。

### 順序の根拠

1位（永続化）と2位（Worker）の手戻りは UI に波及するが、逆は波及しない。UIから着手すると土台変更のたびに作り直しになる。仕様書付録の順序は妥当で、そのまま採用してよい。

---

## 6. 仕様書側への修正提案（実装視点で無理・曖昧・矛盾がある箇所）

### 6-1. 【要決定】Sitemap 取り込みが仕様から消えている

現アプリの主要導線（Phase 7〜11.5 の開発の中心）だが、仕様4.1 の取り込みは「URL貼り付け」のみ。意図的な廃止なら「やらないことリスト」に明記を。残すなら「さがすタブの取り込み欄に sitemap URL を貼ると展開して候補表示」等の節を追加する必要がある（データモデルへの影響は小さい: 展開結果を取り込み候補として見せるだけ）。

### 6-2. 【要決定】除外キーワード・関連度ラベル・⚠️注意の扱い

仕様10 の検索は「AND・スコア降順」のみで、Phase 11 で作り込んだ除外語/高中低/⚠️ が消えている。意図的な簡素化（scorer の中身差し替えで将来吸収する方針）なら整合するが、その場合も「やらないことリスト」への明記を推奨。また現アプリが OR 検索を採用したのは**表記ゆれ対応**（しょうゆ/醤油）の実需からで、純ANDだと表記ゆれに弱くなる点は認識しておくべき。

### 6-3. 【最重要・技術的制約】「抽出は Worker 側で完結」は再考を推奨

Cloudflare Worker には **DOMParser が存在しない**。現在の抽出品質（`prepareDoc` のセレクタ優先順・ノイズ除去・`nodeToPlainText`）は DOMParser 前提で、Worker 側に移すには HTMLRewriter（ストリーミングSAX型）への移植が必要。これは単純移植ではなく抽出アルゴリズムの書き直しで、品質回帰リスクが高い。

**代案**: Worker の責務を「取得・charset正規化・httpStatus判定・生HTMLサイズ上限・タイムアウト」とし、応答は `{ ok: true, html, finalUrl, httpStatus }`。抽出（title/body/charCount）はブラウザ側で既存ロジックを流用。この場合 extract_empty / too_large の判定もブラウザ側に移る（short_body と同じ側になり、閾値管理が一箇所に揃う副次効果もある）。「ブラウザに生HTMLを返さない」という決定を曲げる提案だが、生HTML転送のコストは実測上問題になっておらず（現アプリがまさにその方式）、移植リスクと天秤にかける価値がある。Worker 抽出を貫く場合は、HTMLRewriter 移植の検証期間をフェーズ2に上乗せして見積もるべき。

### 6-4. too_large の判定位置と基準

仕様9 は「抽出本文が50万字超」を Worker 判定としているが、6-3 の代案を採る場合は判定がブラウザ側に移る。いずれにせよ**生HTMLのバイトサイズ上限**（例: 5MB）を Worker 側に置くことを推奨（抽出前にメモリを守る防壁として）。仕様の too_large（抽出後文字数）とは別レイヤーの防御。

### 6-5. finalUrl の取得方法（実装可能・明記推奨）

`fetch(…, {redirect:'follow'})` 後の `response.url` で取得可能。現 Worker は要求URLをそのまま `X-Source-Url` に返しており、リダイレクト先を返していない。新 Worker では `siteResponse.url` を使うこと、と仕様に一行追記しておくと事故を防げる。

### 6-6. 受け入れ条件7（永続化）への iOS 注意書き

iOS Safari は「サイトを7日間操作しないと IndexedDB を削除する」仕様（ITP）。受け入れ条件としては成立するが、「長期間放置するとカゴが消える可能性がある」旨をユーザー向け注記またはリスクとして仕様に一行残すことを推奨。

### 6-7. パック名とファイル名の関係を明文化

仕様5 は pack.name（既定「資料パック」）を持つが、仕様11 のファイル名は `notebooklm-pack_YYYYMMDD_HHmm.md` 固定。pack.name は**ファイル内の `# {パック名}` にのみ使われ、ファイル名には使わない**という理解で良いか。現アプリは「パック名＝ファイル名」（ユーザー編集可）なので、挙動が変わる点を仕様上明確にしておきたい。v1 で pack.name の編集UIを持つのかも未記載（持たないなら「やらないこと」へ）。

### 6-8. 取得の同時実行数2と「1件ずつ順番」の整合

仕様4.1 は同時実行数2、現アプリは全フロー直列（1）。問題なく実装できるが、対象サイトへの負荷配慮（現設計の「同時大量アクセスなし」原則）との関係で、**同一ホストへは同時1・別ホストなら2** 等の補足があるとより安全。なくても可。

### 6-9. 仕上げの「同期処理」表現

仕様8 は Markdown 生成を「ローカルの同期処理」とするが、IndexedDB からの body 読み出しは本質的に非同期。実装上は「通信なしの非同期処理」になる。挙動に影響はないが、文言を「通信なしのローカル処理」へ直すと正確。

---

## 7. 特に確認を依頼された4点への回答

### 7-1. Worker: 仕様9章へのマップ可否 → **現状はマップ不能（書き直し前提）**

| 仕様9の要求 | 現 Worker の実態 |
|---|---|
| 構造化JSON `{ok, title, body, charCount, finalUrl, httpStatus}` | 生HTMLをそのまま返す。JSON は Worker 自体のエラー時のみ（`{error}` 形式で reason 分類なし） |
| http_error（4xx/5xx）の検出 | **対象サイトが404でも status 200 で HTML を返す**。実ステータスは `X-Source-Status` ヘッダに入るが、**フロントは一度も読んでいない**。つまり「404エラーページが記事として取得成功扱いになる」バグが現存 |
| タイムアウト15秒 | なし（AbortController 不使用）。ハングしたサイトは Worker の実行上限まで待つ |
| charset 正規化 | なし。`response.text()` は常に UTF-8 として復号するため **Shift_JIS サイトは現状文字化けする**（仕様13のテスト観点が既存バグを言い当てている） |
| extract_empty / too_large 判定 | なし |
| 本文抽出 | なし（全てブラウザ側）。Worker 移管には §6-3 の HTMLRewriter 問題あり |

### 7-2. 本文抽出の品質 → **抽出ロジック自体は資産。判定材料も揃うが、charset は Worker 修正が必須**

- extract_empty 判定: `extractBodyText()` の戻り値（プレーンテキスト）に対する「空白のみ含む空判定」は trim 一発で実装でき、`usedSelector`（どのセレクタで抽出したか）も返しているため判定根拠の記録にも使える。**材料は揃っている**
- charCount: 同じ戻り値の `.length` でそのまま算出可
- charset 正規化: ブラウザ側では手の打ちようがなく（Worker が既に UTF-8 として壊した文字列を受け取るため）、**Worker 側で Content-Type ヘッダ／meta charset を判定して TextDecoder で復号する実装が必須**

### 7-3. IndexedDB 設計への移行可能性 → **データの「形」は移行可能、ストレージ層は全て新規**

- `bodySearchCache`（url → {title, text, error} フル本文）が articleMeta＋articleBody に**概念上もっとも近い**。「フル本文を一度取ってキャッシュし、検索・プレビューが再利用する」という Phase 11 の設計思想は仕様0 の「取得＝保存」と同型で、データの形はほぼそのまま写せる
- ただし保存先が in-memory Map のため、IndexedDB ラッパ・トランザクション・状態機械（fetchState）・孤児回収は**ゼロから新規**
- titleCache / previewCache は articleMeta.title / body の先頭スライスに吸収されて消滅
- checkedSitemapUrls（Set）は pack.items（配列・順序保持）へ置き換え。**Set には追加順がないため、現コードからの単純変換では「追加順＝出力順」を満たせない**点に注意
- URL正規化は前述の通り資産なし。`parseUrls()` の dedup は文字列一致のみ

### 7-4. UI構造の3タブへの流用度 → **シェルは新規、部品は5〜6割流用可**

| 仕様のUI | 流用元 | 流用度 |
|---|---|---|
| さがす: 関連度カード | `buildSearchResultCard()`＋カードCSS | **中〜高**。スコア表示・タイトル・URL・選択列の骨格あり。抜粋＋強調・インライン立ち読み・追加済みラベル分離は新規 |
| さがす: 折りたたみURL一覧 | Phase 11.5 の `url-list-toggle` 一式 | **高**。折りたたみパターンをそのまま転用できる（今回の Phase 11.5 がちょうど同型） |
| さがす: 取り込み確認1枚 | なし | 新規（現 handleBatchFetch は確認なしで即取得） |
| 候補タブ | チェック済み件数表示・51件警告カード | **低〜中**。一覧UIは新規、警告文の枠は転用 |
| 仕上げタブ | `buildPackMarkdown` / Blob保存 / 進捗リスト | **中**。生成・保存の機構は生きる。md フォーマット（目次・メタヘッダ）は改修 |
| 下部固定タブバー | なし | 新規（CSS は小規模） |
| トースト通知（再取得失敗時） | なし（ステータスバー文化） | 新規 |

---

## 付記: 進め方に関わる前提の確認（実装前に返答が欲しい）

1. **「Cloudflare Worker は変更しない」ルールの解除**を確認したい（仕様v1.1 は Worker 改修を要求している）
2. **現行アプリ（v0）を残すか**: `notebooklm-packer/v1/` 並行開発 → 差し替えを推奨（§5 Step 0）
3. §6-1（sitemap）と §6-2（除外語・関連度ラベル）の **採否**
4. §6-3 の **抽出の置き場所**（Worker 完結 or ブラウザ抽出維持）— Step 2 の前提条件
