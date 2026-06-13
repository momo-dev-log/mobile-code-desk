/**
 * 閾値・タイムアウト等の定数。
 * docs/spec.md 9章: 「閾値（short_body 200字／本文too_large 50万字／
 * 生HTML上限5MB）とタイムアウト（Worker側15秒）は定数で管理し調整可能にする」
 */

// 抽出後の本文がこの文字数未満の場合、warnings に "short_body" を付与する
export const SHORT_BODY_THRESHOLD = 200;

// 抽出後の本文がこの文字数を超える場合、too_large（二次）として失敗にする
export const BODY_TOO_LARGE_CHARS = 500000;

// 候補（pack.items）がこの件数を超えると警告バナーを表示する
export const PACK_WARN_THRESHOLD = 50;

// sitemap展開の上限件数
export const MAX_SITEMAP_URLS = 200;

// 立ち読みプレビューで表示する本文の先頭文字数
export const PREVIEW_CHARS = 800;

// 関連度バッジ（高/中/低）の閾値。
// scorer.jsが返すscoreは「マッチした語の種類数 * 1000 + ヒット数/タイトル一致ボーナス（0-899）」。
// ここではヒット数側の閾値のみを定義する（語種数による高/中の分岐はUI側で行う）。
export const RELEVANCE_HIGH_MIN_HITS = 5;
export const RELEVANCE_MID_MIN_HITS = 2;

// 新Workerのエンドポイント（v1とは別名でデプロイする）
export const WORKER_URL = 'https://notebooklm-packer-worker-v2.momo19830831.workers.dev';
