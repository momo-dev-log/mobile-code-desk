# Web解体パック v0.1 仕様メモ

## 目的

公開Webページ/Webアプリの HTML・CSS・JavaScript を取得し、
AIに読ませやすいMarkdown調査パックに変換する。

人間がスマホで長いコードを読むためのビューアではない。
AIに「このページどう作ってる？」と聞くための材料を作る梱包ツール。

主目的は、Canvas・スマホ操作（pointer/touch）・墨流し風UIの描画処理・
音声・操作バー構造の調査。

## 既存アプリとの関係

- `notebooklm-packer/` とは独立した別アプリ（`web-disassembly-pack/`）として実装する。
- フロント・Worker・デプロイワークフローはすべて専用に新規作成し、既存ファイルには触れない。

## v0.1のUI方針

- コードビューアではないため、HTML/CSS/JS本文をそのまま大量表示しない。
- 解析結果は要約カード・セクション単位で表示する。
- 最終成果物はMarkdown。
- スマホ利用を想定し、「コピーする」ボタンを最優先（大きく・上部）に配置する。
- 「.mdを保存」はコピーより優先度を下げる（あってもよいが控えめな配置）。
- 危険情報チェック欄は、Markdown生成前（生成結果の近く）に配置する。

## 操作ボタン文言

- URLを取得
- 構造を見る
- Markdownを作る
- コピーする
- .mdを保存
- やり直す

「解体する」のような強い表現はv0.1では使わない。

## 処理フロー

1. **URLを取得**
   - 専用Worker（`worker/index.js`）経由でHTMLを取得する（CORS回避・文字コード正規化）。
2. **構造を見る**
   - HTMLをDOM解析し、以下を判定する。
     - canvas / button / audio / video / svg の有無・件数
     - インライン/外部 script・style の件数
     - 外部CSS/JSの参照URL一覧（同一オリジン判定つき）
   - 外部CSS/JSを取得する（取得方針は下記）。
   - インライン/外部CSS・JSそれぞれにキーワード抜粋を作る。
   - 危険情報チェックを実行する。
3. **危険情報チェック**
   - HTML本文・インラインCSS/JS・取得できた外部CSS/JSを対象に、
     APIキーらしき文字列・メールアドレス・秘密鍵ブロック等のパターンを検出する。
   - 検出値はマスクして表示・Markdownに記録する。
4. **Markdownを作る**
   - 構造概要・危険情報チェック結果・CSS/JSセクションをまとめたMarkdownを生成する。
5. **コピーする / .mdを保存**
   - `navigator.clipboard` でコピー（最優先）。
   - Blobダウンロードで `.md` 保存（任意）。
6. **やり直す**
   - 状態をリセットし、最初の入力画面に戻る。

## 外部CSS/JS取得の制限（v0.1）

- CSS・JSそれぞれ最大5件まで取得する。
- 同一オリジンを優先し、外部オリジンのリソースはv0.1では取得対象外とする
  （Markdownには「取得対象外」として記録する）。
- 件数上限を超えた同一オリジンのリソースは「取得対象外（件数上限）」として記録する。
- 1ファイルあたり処理対象は約200KB（`MAX_RESOURCE_CHARS`）までとし、
  それを超える分は処理対象外（先頭部分のみを抜粋対象にする）。
- 取得に失敗したファイルは、理由（通信エラー/HTTPエラー/サイズ超過）とともに
  「取得失敗」としてMarkdownに記録する。

## キーワード抜粋（excerpt.js）

巨大ファイル・minify済みファイルでも全文を載せず、キーワード周辺のみ抜粋する。
該当キーワードが無い場合は、文字数と先頭部分のみの概要を記録する。

### JS優先キーワード

canvas, getContext, pointer, pointerdown, pointermove, pointerup,
touch, touchstart, touchmove, mouse, mousemove, requestAnimationFrame,
audio, play, pause, clear, reset, wash, color, palette, draw, resize
（fetch, localStorage, WebSocket は優先度低として末尾に含む）

### CSS優先キーワード

body, html, canvas, button, toolbar, controls, footer, fixed, position,
z-index, background, border-radius, backdrop-filter, display, flex, grid

## Worker（worker/index.js）

- notebooklm-packer用Workerとは完全に別名・別デプロイ（`web-disassembly-pack-worker`）。
- `GET /?url=<対象URL>` でHTML/CSS/JSいずれも取得可能。
- 文字コード判定・UTF-8正規化、サイズ上限（5MB）、タイムアウト（15秒）は
  notebooklm-packer v2 Workerと同様の方針を採用。

## v0.1成功条件

1. URLを入力できる
2. Worker経由でHTMLを取得できる
3. CSS/JSファイル一覧を抽出できる
4. canvas / button / audio / script / stylesheet の有無を判定できる
5. CSS/JSの重要キーワード周辺を抜粋できる
6. AI用Markdownを生成できる
7. スマホでMarkdownをコピーできる
8. 可能なら `.md` として保存できる

## v0.1で扱わないもの

- 複数URLの一括処理
- 履歴管理・カテゴリ分け・IndexedDB永続化
- 画像・フォント等バイナリアセットの内容取得（一覧表示のみ、v0.1では対象外）
- JS実行結果（動的DOM）の解析
- 認証が必要なページへの対応
