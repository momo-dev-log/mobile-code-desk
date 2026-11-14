/**
 * Web解体パック の定数。
 * notebooklm-packerの定数とは独立して管理する。
 */

export const APP_VERSION = 'v0.4.0';

// 専用Worker（worker/index.js）のエンドポイント
export const WORKER_URL = 'https://web-disassembly-pack-worker.momo19830831.workers.dev';

// 外部CSS/JSの取得件数の上限（同一オリジン優先）
export const MAX_CSS_FILES = 5;
export const MAX_JS_FILES = 5;

// 1ファイルあたりの処理対象文字数の上限（これを超える分はキーワード抜粋のみ対象にする）
export const MAX_RESOURCE_CHARS = 200 * 1024; // 約200KB

// 全文つきMarkdown（v0.4.0）の収録上限。取得件数・1ファイルの解析範囲の上限は変えない。
// HTML構造枠（script/style本文を除いたHTML）の最大文字数
export const MAX_FULL_HTML_CHARS = 20000;
// CSS/JS本文の合計の最大文字数
export const MAX_FULL_CODE_CHARS = 100000;
// CSS/JS本文の枠のうち、CSSに先に割り当てる割合（使い切らない分はJSへ、JSの余りはCSSへ回す）
export const FULL_CODE_CSS_SHARE = 0.4;
// 途中まで収録するときの最小文字数（残り枠がこれ未満なら、そのソースは収録しない）
export const MIN_PARTIAL_CHARS = 500;
