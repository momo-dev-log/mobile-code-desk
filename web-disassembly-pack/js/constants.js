/**
 * Web解体パック の定数。
 * notebooklm-packerの定数とは独立して管理する。
 */

export const APP_VERSION = 'v0.3.1';

// 専用Worker（worker/index.js）のエンドポイント
export const WORKER_URL = 'https://web-disassembly-pack-worker.momo19830831.workers.dev';

// 外部CSS/JSの取得件数の上限（同一オリジン優先）
export const MAX_CSS_FILES = 5;
export const MAX_JS_FILES = 5;

// 1ファイルあたりの処理対象文字数の上限（これを超える分はキーワード抜粋のみ対象にする）
export const MAX_RESOURCE_CHARS = 200 * 1024; // 約200KB
