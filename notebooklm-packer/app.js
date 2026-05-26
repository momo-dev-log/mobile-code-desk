'use strict';

// -----------------------------------------------
// Phase 1 で取得した Cloudflare Worker URL
// -----------------------------------------------
const WORKER_URL = 'https://notebooklm-packer.momo19830831.workers.dev';

// -----------------------------------------------
// DOM 要素の取得 — 単一URL セクション（Phase 1–5）
// -----------------------------------------------
const urlInput       = document.getElementById('url-input');
const fetchBtn       = document.getElementById('fetch-btn');
const statusBar      = document.getElementById('status-bar');
const statusIcon     = document.getElementById('status-icon');
const statusText     = document.getElementById('status-text');
const resultCard     = document.getElementById('result-card');
const charCount      = document.getElementById('char-count');
const resultNote     = document.getElementById('result-note');

const tabHtmlBtn      = document.getElementById('tab-html');
const tabTextBtn      = document.getElementById('tab-text');
const tabMarkdownBtn  = document.getElementById('tab-markdown');

const panelHtml      = document.getElementById('panel-html');
const panelText      = document.getElementById('panel-text');
const panelMarkdown  = document.getElementById('panel-markdown');

const resultHtml     = document.getElementById('result-html');
const resultText     = document.getElementById('result-text');
const resultMarkdown = document.getElementById('result-markdown');
const extractMeta    = document.getElementById('extract-meta');

const copyMarkdownBtn = document.getElementById('copy-markdown-btn');
const downloadTxtBtn  = document.getElementById('download-txt-btn');
const downloadMdBtn   = document.getElementById('download-md-btn');
const copyFeedback    = document.getElementById('copy-feedback');

// -----------------------------------------------
// DOM 要素の取得 — 複数URL セクション（Phase 6）
// -----------------------------------------------
const multiUrlInput      = document.getElementById('multi-url-input');
const packBtn            = document.getElementById('pack-btn');
const packStatusBar      = document.getElementById('pack-status-bar');
const packStatusIcon     = document.getElementById('pack-status-icon');
const packStatusText     = document.getElementById('pack-status-text');
const packProgressCard   = document.getElementById('pack-progress-card');
const progressList       = document.getElementById('progress-list');
const packResultCard     = document.getElementById('pack-result-card');
const packResultMarkdown = document.getElementById('pack-result-markdown');
const packCharCount      = document.getElementById('pack-char-count');
const packResultNote     = document.getElementById('pack-result-note');
const copyPackBtn        = document.getElementById('copy-pack-btn');
const downloadPackTxtBtn = document.getElementById('download-pack-txt-btn');
const downloadPackMdBtn  = document.getElementById('download-pack-md-btn');
const packCopyFeedback   = document.getElementById('pack-copy-feedback');
const printPreviewBtn    = document.getElementById('print-preview-btn');
const packNameInput      = document.getElementById('pack-name-input');   // Phase 8.5：常設入力欄

// -----------------------------------------------
// DOM 要素の取得 — Sitemap セクション（Phase 7 / 7.5）
// -----------------------------------------------
const sitemapInput          = document.getElementById('sitemap-input');
const sitemapFetchBtn       = document.getElementById('sitemap-fetch-btn');
const sitemapStatusBar      = document.getElementById('sitemap-status-bar');
const sitemapStatusIcon     = document.getElementById('sitemap-status-icon');
const sitemapStatusText     = document.getElementById('sitemap-status-text');
const sitemapResultCard     = document.getElementById('sitemap-result-card');
const sitemapUrlCount       = document.getElementById('sitemap-url-count');
const sitemapResultNote     = document.getElementById('sitemap-result-note');
const copySitemapBtn        = document.getElementById('copy-sitemap-btn');
const toPackBtn             = document.getElementById('to-pack-btn');
const sitemapCopyFeedback   = document.getElementById('sitemap-copy-feedback');
// Phase 7.5 追加
const sitemapUrlCheckboxes  = document.getElementById('sitemap-url-checkboxes');
const sitemapSelectCount    = document.getElementById('sitemap-select-count');
// Phase 9.2 追加（検索・除外キーワード絞り込み）
const sitemapIncludeInput       = document.getElementById('sitemap-include-input');
const sitemapExcludeInput       = document.getElementById('sitemap-exclude-input');
const sitemapDisplayCount       = document.getElementById('sitemap-display-count');
const sitemapSelectVisibleBtn   = document.getElementById('sitemap-select-visible-btn');
const sitemapDeselectVisibleBtn = document.getElementById('sitemap-deselect-visible-btn');
// Phase 9.1 追加（タイトル取得）
const fetchTitlesBtn    = document.getElementById('fetch-titles-btn');
const fetchTitlesStatus = document.getElementById('fetch-titles-status');
// Phase 9.2 追加（ページネーション）
const sitemapPageInfo   = document.getElementById('sitemap-page-info');
const sitemapPageBtns   = document.getElementById('sitemap-page-btns');
// Phase 9.3 追加（分割反映 警告カード）
const packWarnCard    = document.getElementById('pack-warn-card');
const packWarnCount   = document.getElementById('pack-warn-count');
const packWarnActions = document.getElementById('pack-warn-actions');
// Phase 9.4 追加（大量候補時の案内）
const sitemapBulkHint = document.getElementById('sitemap-bulk-hint');
// Phase 10 追加（本文プレビュー）
const previewVisibleBtn  = document.getElementById('preview-visible-btn');
const previewCheckedBtn  = document.getElementById('preview-checked-btn');
const previewStatus      = document.getElementById('preview-status');
const previewResultArea  = document.getElementById('preview-result-area');
const previewResultList  = document.getElementById('preview-result-list');
const previewCloseBtn    = document.getElementById('preview-close-btn');

// -----------------------------------------------
// 状態管理
// -----------------------------------------------
let lastHtml         = '';   // 取得した HTML ソース
let lastText         = '';   // 抽出した本文テキスト
let lastMarkdown     = '';   // 単一URL Markdown
let lastTitle        = '';   // ページタイトル（ファイル名生成用）
let currentTab       = 'html';
let lastPackMarkdown = '';   // 結合 Markdown（Phase 6）
let lastSitemapUrls  = [];   // URL 候補（Phase 7）
let lastPackResults  = [];   // 資料パック結果（Phase 8 印刷プレビュー用）
let isDownloading    = false; // 二重ダウンロード防止フラグ（Phase 8.5）
// Phase 9.2 追加
let filteredSitemapUrls  = [];           // フィルター後のURL一覧
let sitemapCurrentPage   = 0;           // 現在のページ（0始まり）
const titleCache         = new Map();   // url → タイトル文字列
const checkedSitemapUrls = new Set();   // チェック済みURLの Set
// Phase 10 追加
const previewCache = new Map();          // url → { title: string, text: string, error: boolean }

/** Phase 9.1：タイトル取得の上限件数 */
const TITLE_FETCH_LIMIT = 20;
/** Phase 10：本文プレビューの1回の上限件数 */
const PREVIEW_FETCH_LIMIT = 10;
/** Phase 10：本文プレビューの表示文字数 */
const PREVIEW_TEXT_LENGTH = 600;

// -----------------------------------------------
// イベントリスナー — 単一URL
// -----------------------------------------------
fetchBtn.addEventListener('click', handleFetch);
urlInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') handleFetch(); });

tabHtmlBtn    .addEventListener('click', () => switchTab('html'));
tabTextBtn    .addEventListener('click', () => switchTab('text'));
tabMarkdownBtn.addEventListener('click', () => switchTab('markdown'));

copyMarkdownBtn.addEventListener('click', copyMarkdown);
downloadTxtBtn .addEventListener('click', () => downloadMarkdown('txt'));
downloadMdBtn  .addEventListener('click', () => downloadMarkdown('md'));

// -----------------------------------------------
// イベントリスナー — 複数URL（Phase 6）
// -----------------------------------------------
packBtn            .addEventListener('click', handleBatchFetch);
copyPackBtn        .addEventListener('click', copyPackMarkdown);
downloadPackTxtBtn .addEventListener('click', () => downloadPackMarkdown('txt'));
downloadPackMdBtn  .addEventListener('click', () => downloadPackMarkdown('md'));
printPreviewBtn    .addEventListener('click', openPrintPreview);

// -----------------------------------------------
// イベントリスナー — Sitemap（Phase 7）
// -----------------------------------------------
sitemapFetchBtn    .addEventListener('click', handleSitemapFetch);
sitemapInput       .addEventListener('keydown', (e) => { if (e.key === 'Enter') handleSitemapFetch(); });
copySitemapBtn     .addEventListener('click', copySitemapUrls);
toPackBtn          .addEventListener('click', sendToPackInput);

// -----------------------------------------------
// イベントリスナー — Sitemap 絞り込み（Phase 9.2：検索・除外2フィールド）
// -----------------------------------------------
// input / search イベント両方に登録（× クリアボタン対応）
sitemapIncludeInput .addEventListener('input',  filterSitemapList);
sitemapIncludeInput .addEventListener('search', filterSitemapList);
sitemapExcludeInput .addEventListener('input',  filterSitemapList);
sitemapExcludeInput .addEventListener('search', filterSitemapList);
sitemapSelectVisibleBtn  .addEventListener('click', () => setSitemapVisibleCheck(true));
sitemapDeselectVisibleBtn.addEventListener('click', () => setSitemapVisibleCheck(false));
fetchTitlesBtn           .addEventListener('click', fetchVisibleTitles);
// Phase 10：本文プレビュー
previewVisibleBtn.addEventListener('click', () => startBodyPreview('visible'));
previewCheckedBtn.addEventListener('click', () => startBodyPreview('checked'));
previewCloseBtn  .addEventListener('click', closePreviewPanel);

// -----------------------------------------------
// タブ切り替え
// -----------------------------------------------
function switchTab(tab) {
  currentTab = tab;

  tabHtmlBtn    .classList.toggle('tab-active', tab === 'html');
  tabTextBtn    .classList.toggle('tab-active', tab === 'text');
  tabMarkdownBtn.classList.toggle('tab-active', tab === 'markdown');

  panelHtml     .hidden = tab !== 'html';
  panelText     .hidden = tab !== 'text';
  panelMarkdown .hidden = tab !== 'markdown';

  const count =
    tab === 'html'     ? lastHtml.length :
    tab === 'text'     ? lastText.length :
    /* markdown */       lastMarkdown.length;

  const label =
    tab === 'html'     ? 'HTML' :
    tab === 'text'     ? '本文' :
    /* markdown */       'Markdown';

  charCount.textContent = count ? `${count.toLocaleString()} 文字（${label}）` : '';
}

// -----------------------------------------------
// 共通：Worker 経由で HTML を取得する
// -----------------------------------------------
async function fetchHtmlFromWorker(url) {
  const endpoint = `${WORKER_URL}/?url=${encodeURIComponent(url)}`;
  const response = await fetch(endpoint);
  if (!response.ok) {
    let errMsg = `HTTP ${response.status}`;
    try {
      const errData = await response.json();
      if (errData.error) errMsg = errData.error;
    } catch { /* 無視 */ }
    throw new Error(errMsg);
  }
  return response.text();
}

// -----------------------------------------------
// 単一URL 処理
// -----------------------------------------------
async function handleFetch() {
  const targetUrl = urlInput.value.trim();

  if (!targetUrl) {
    setStatus('error', '❌', 'URL を入力してください');
    return;
  }
  try { new URL(targetUrl); } catch {
    setStatus('error', '❌', 'URL の形式が正しくありません（https:// から始まる URL を入力してください）');
    return;
  }

  fetchBtn.disabled = true;
  resultCard.hidden = true;
  setStatus('loading', '⏳', '取得中...');

  try {
    const html = await fetchHtmlFromWorker(targetUrl);
    lastHtml = html;
    resultHtml.value = html;

    const tmpDoc = new DOMParser().parseFromString(html, 'text/html');
    lastTitle = (tmpDoc.title || '').trim();

    setStatus('loading', '⏳', '本文を抽出中...');
    const { text, usedSelector } = extractBodyText(html);
    lastText = text;
    resultText.value = text;
    extractMeta.textContent = `抽出元：${usedSelector}`;

    setStatus('loading', '⏳', 'Markdown に変換中...');
    lastMarkdown = htmlToMarkdown(html, targetUrl);
    resultMarkdown.value = lastMarkdown;

    resultNote.textContent =
      '※ Markdown タブの「コピー」または「ダウンロード」ボタンで NotebookLM に追加できます。';

    resultCard.hidden = false;
    switchTab(currentTab);
    resultCard.scrollIntoView({ behavior: 'smooth', block: 'start' });
    setStatus('success', '✅', '取得・抽出・Markdown 変換完了');

  } catch (e) {
    setStatus('error', '❌', `エラー：${e.message}`);
  } finally {
    fetchBtn.disabled = false;
  }
}

// -----------------------------------------------
// Phase 5：単一URL コピー・ダウンロード
// -----------------------------------------------
function generateFilename(title, ext) {
  const now  = new Date();
  const yyyy = now.getFullYear();
  const mm   = String(now.getMonth() + 1).padStart(2, '0');
  const dd   = String(now.getDate()).padStart(2, '0');
  const dateStr = `${yyyy}${mm}${dd}`;

  let safeName = title
    .replace(/[\r\n\t]/g, ' ')
    .replace(/[\\/:*?"<>|]/g, '')
    .replace(/\s+/g, '_')
    .replace(/^[._]+|[._]+$/g, '')
    .slice(0, 50);

  if (!safeName) safeName = 'notebooklm-resource';
  return `${safeName}_${dateStr}.${ext}`;
}

async function copyMarkdown() {
  if (!lastMarkdown) {
    showCopyFeedback('❌ コピーする内容がありません', false);
    return;
  }
  try {
    await navigator.clipboard.writeText(lastMarkdown);
    showCopyFeedback('✅ コピー完了', true);
  } catch {
    try {
      resultMarkdown.select();
      document.execCommand('copy');
      showCopyFeedback('✅ コピー完了', true);
    } catch {
      showCopyFeedback('❌ コピーに失敗しました', false);
    }
  }
}

function showCopyFeedback(message, success) {
  copyFeedback.hidden = false;
  copyFeedback.textContent = message;
  copyFeedback.className = `copy-feedback ${success ? 'copy-success' : 'copy-error'}`;
  clearTimeout(copyFeedback._timer);
  copyFeedback._timer = setTimeout(() => { copyFeedback.hidden = true; }, 3000);
}

function downloadMarkdown(ext) {
  if (!lastMarkdown) return;
  const filename = generateFilename(lastTitle, ext);
  const blob = new Blob([lastMarkdown], { type: 'text/plain; charset=utf-8' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// -----------------------------------------------
// Phase 6：複数URL 一括処理
// -----------------------------------------------

/**
 * 入力テキストを解析し、有効・ユニークな URL の配列を返す
 */
function parseUrls(rawInput) {
  const seen = new Set();
  return rawInput
    .split('\n')
    .map(l => l.trim())
    .filter(l => {
      if (!l) return false;
      try { new URL(l); return true; } catch { return false; }
    })
    .filter(l => {
      if (seen.has(l)) return false;
      seen.add(l); return true;
    });
}

/**
 * 成功ページだけを 1 つの Markdown ドキュメントにまとめる
 */
function buildPackMarkdown(results) {
  const successItems = results.filter(r => r.success);
  if (!successItems.length) return '';

  const now   = new Date();
  const yyyy  = now.getFullYear();
  const mm    = String(now.getMonth() + 1).padStart(2, '0');
  const dd    = String(now.getDate()).padStart(2, '0');

  const header =
    `# NotebookLM 資料パック\n\n` +
    `作成日：${yyyy}-${mm}-${dd}　取得ページ数：${successItems.length}\n\n---\n\n`;

  const sections = successItems.map((item, idx) =>
    `## ${idx + 1}. ${item.title}\n\n` +
    `Source: ${item.url}\n\n` +
    `${item.md}`
  );

  return (header + sections.join('\n\n---\n\n'))
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/**
 * 処理状況リストに URL 1件分の行を追加し、その li 要素を返す
 */
function addProgressItem(url) {
  const li = document.createElement('li');
  li.className = 'progress-item progress-pending';
  li.innerHTML =
    `<span class="progress-status-icon">⏸</span>` +
    `<div class="progress-info">` +
      `<span class="progress-url-text">${escapeHtml(url)}</span>` +
      `<span class="progress-detail-text">待機中</span>` +
    `</div>`;
  progressList.appendChild(li);
  return li;
}

/**
 * li 要素の状態を更新する
 * @param {HTMLElement} li
 * @param {'pending'|'loading'|'success'|'error'} state
 * @param {string} detail  表示する詳細テキスト
 */
function updateProgressItem(li, state, detail) {
  const icons = { pending: '⏸', loading: '⏳', success: '✅', error: '❌' };
  li.className = `progress-item progress-${state}`;
  li.querySelector('.progress-status-icon').textContent = icons[state] || '•';
  li.querySelector('.progress-detail-text').textContent = detail;
}

/** HTML エスケープ（innerHTML 用） */
function escapeHtml(str) {
  return str
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/** パック用ステータスバーを更新する */
function setPackStatus(type, icon, message) {
  packStatusBar.hidden = false;
  packStatusBar.className = `status-bar status-${type}`;
  packStatusIcon.textContent = icon;
  packStatusText.textContent = message;
}

/**
 * メイン処理：複数URL を順番に取得・変換して結合 Markdown を作る
 */
async function handleBatchFetch() {
  const urls = parseUrls(multiUrlInput.value);

  if (urls.length === 0) {
    setPackStatus('error', '❌', 'URL を1件以上入力してください（1行1URL）');
    return;
  }

  // 初期化
  packBtn.disabled     = true;
  packResultCard.hidden = true;
  packProgressCard.hidden = false;
  progressList.innerHTML  = '';
  lastPackMarkdown = '';
  setPackStatus('loading', '⏳', `0 / ${urls.length} 処理中...`);

  // 全行を「待機中」で表示
  const items = urls.map(url => addProgressItem(url));

  const results = [];

  for (let i = 0; i < urls.length; i++) {
    const url = urls[i];
    setPackStatus('loading', '⏳', `${i + 1} / ${urls.length} 処理中...`);
    updateProgressItem(items[i], 'loading', '取得中...');

    try {
      const html = await fetchHtmlFromWorker(url);
      // タイトル取得と Markdown 変換を 1 回のパースでまとめて行う
      const { title, md } = processForPack(html, url);

      results.push({ url, title, md, success: true });
      updateProgressItem(items[i], 'success', title);

    } catch (e) {
      results.push({ url, title: url, md: '', success: false, error: e.message });
      updateProgressItem(items[i], 'error', `取得失敗：${e.message}`);
    }
  }

  const successCount = results.filter(r => r.success).length;

  if (successCount === 0) {
    setPackStatus('error', '❌', 'すべての URL の取得に失敗しました');
    packBtn.disabled = false;
    return;
  }

  // 結合 Markdown を生成して表示（Phase 8 用に results も保存）
  lastPackResults  = results;
  // Phase 9.3：分割反映後に付加された _partN サフィックスを保持する
  const prevPartSuffix = (packNameInput.value.trim().match(/(_part\d+)$/) ?? [])[1] ?? '';
  packNameInput.value = generatePackName(results) + prevPartSuffix;
  lastPackMarkdown = buildPackMarkdown(results);
  packResultMarkdown.value = lastPackMarkdown;
  packCharCount.textContent =
    `${lastPackMarkdown.length.toLocaleString()} 文字`;
  packResultNote.textContent =
    `※ ${successCount} / ${urls.length} ページを結合しました。` +
    `「コピー」または「ダウンロード」で NotebookLM に追加できます。`;

  packResultCard.hidden = false;
  setPackStatus(
    'success', '✅',
    `完了：${successCount} / ${urls.length} ページ取得成功`
  );
  packResultCard.scrollIntoView({ behavior: 'smooth', block: 'start' });
  packBtn.disabled = false;
}

// -----------------------------------------------
// Phase 6：パック用 コピー・ダウンロード
// -----------------------------------------------
async function copyPackMarkdown() {
  if (!lastPackMarkdown) {
    showPackCopyFeedback('❌ コピーする内容がありません', false);
    return;
  }
  try {
    await navigator.clipboard.writeText(lastPackMarkdown);
    showPackCopyFeedback('✅ コピー完了', true);
  } catch {
    try {
      packResultMarkdown.select();
      document.execCommand('copy');
      showPackCopyFeedback('✅ コピー完了', true);
    } catch {
      showPackCopyFeedback('❌ コピーに失敗しました', false);
    }
  }
}

function showPackCopyFeedback(message, success) {
  packCopyFeedback.hidden = false;
  packCopyFeedback.textContent = message;
  packCopyFeedback.className =
    `copy-feedback ${success ? 'copy-success' : 'copy-error'}`;
  clearTimeout(packCopyFeedback._timer);
  packCopyFeedback._timer = setTimeout(() => {
    packCopyFeedback.hidden = true;
  }, 3000);
}

function downloadPackMarkdown(ext) {
  if (!lastPackMarkdown || isDownloading) return;
  // 二重タップ・二重ダウンロード防止（300ms でリセット）
  isDownloading = true;
  setTimeout(() => { isDownloading = false; }, 300);

  // pack-name-input を必ずブラーしてから処理（iOS でフォーカス中の場合を考慮）
  packNameInput.blur();

  const filename = `${sanitizePackName(packNameInput.value)}.${ext}`;
  const blob    = new Blob([lastPackMarkdown], { type: 'text/plain; charset=utf-8' });
  const url     = URL.createObjectURL(blob);
  const a       = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// -----------------------------------------------
// 共通：DOMParser でノイズ除去 → メインコンテンツ特定
// -----------------------------------------------
function prepareDoc(rawHtml) {
  const parser = new DOMParser();
  const doc = parser.parseFromString(rawHtml, 'text/html');

  [
    'script', 'style', 'noscript',
    'nav', 'header', 'footer', 'aside',
    '[role="navigation"]', '[role="banner"]', '[role="complementary"]',
    '[aria-hidden="true"]',
  ].forEach(sel => doc.querySelectorAll(sel).forEach(el => el.remove()));

  const selectors = [
    'main', 'article', '[role="main"]',
    '#main', '#content',
    '.content', '.entry-content', '.post-body',
    '.post-content', '.article-body', '.hentry',
  ];

  let mainEl = null;
  let usedSelector = 'body（フォールバック）';

  for (const sel of selectors) {
    const el = doc.querySelector(sel);
    if (el) { mainEl = el; usedSelector = sel; break; }
  }
  if (!mainEl) mainEl = doc.body;

  return { doc, mainEl, usedSelector };
}

// -----------------------------------------------
// 本文抽出：プレーンテキストを返す
// -----------------------------------------------
function extractBodyText(rawHtml) {
  const { doc, mainEl, usedSelector } = prepareDoc(rawHtml);
  const title = (doc.title || '').trim();
  const bodyText = nodeToPlainText(mainEl);

  let text;
  if (!title) {
    text = bodyText;
  } else {
    const firstH1 = mainEl.querySelector('h1');
    const firstH1Text = firstH1 ? firstH1.textContent.trim() : '';
    const isDuplicate = firstH1Text.toLowerCase() === title.toLowerCase();
    text = isDuplicate ? bodyText : `${title}\n\n${bodyText}`;
  }

  return { text, usedSelector };
}

// -----------------------------------------------
// Markdown 変換：HTML → Markdown テキストを返す（単一URLタブ用）
// -----------------------------------------------
function htmlToMarkdown(rawHtml, sourceUrl) {
  const { doc, mainEl } = prepareDoc(rawHtml);
  const title = (doc.title || '').trim();

  const md = nodeToMarkdown(mainEl, sourceUrl);

  let result;
  if (!title) {
    result = md;
  } else {
    const firstH1 = mainEl.querySelector('h1');
    const firstH1Text = firstH1 ? firstH1.textContent.trim() : '';
    const isDuplicate = firstH1Text.toLowerCase() === title.toLowerCase();
    result = isDuplicate ? md : `# ${title}\n\n${md}`;
  }

  return result
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

// -----------------------------------------------
// 資料パック専用処理：タイトル取得と Markdown 変換
//
// ── 旧実装の問題 ──
//   processForPack は prepareDoc() 後の mainEl から H1 を探していた。
//   prepareDoc は <header> 要素を除去するため、H1 が <header> 内にあると
//   mainEl.querySelector('h1') が null を返し、URL にフォールバックしていた。
//   さらに H1 除去条件も満たされず、本文内に H1 が残っていた。
//
// ── 新実装の方針 ──
//   タイトル取得 → ノイズ除去「前」の rawDoc.body から H1 を検索（確実）
//   Markdown 変換 → ノイズ除去「後」の prepareDoc の mainEl を使用
//   H1 除去       → mainEl 内に一致する H1 があれば remove()
//                    （<header> 内の H1 は prepareDoc で既に消えているため不要）
//
// タイトル優先順位: 先頭 H1 > doc.title > URL
// -----------------------------------------------

/**
 * パック用 HTML 処理。
 * rawDoc（ノイズ除去前）でタイトルを確実に取得し、
 * prepareDoc（ノイズ除去後）の mainEl で Markdown を生成する。
 *
 * @param {string} rawHtml
 * @param {string} sourceUrl
 * @returns {{ title: string, md: string }}
 */
function processForPack(rawHtml, sourceUrl) {
  // ── Step 1：ノイズ除去前の rawDoc からタイトル・H1 を取得 ──
  // prepareDoc は <header>/<nav>/<footer> 等を除去するため、
  // そこに含まれる H1 が mainEl から消えてしまう。
  // rawDoc.body.querySelector('h1') なら除去前に確実に取得できる。
  const rawDoc   = new DOMParser().parseFromString(rawHtml, 'text/html');
  const docTitle = (rawDoc.title || '').trim();
  const rawH1    = rawDoc.body ? rawDoc.body.querySelector('h1') : null;
  const h1Text   = rawH1 ? rawH1.textContent.trim() : '';

  // タイトル優先順位: H1 > doc.title > URL
  const title = h1Text || docTitle || sourceUrl;

  // ── Step 2：ノイズ除去後の mainEl から Markdown を生成 ──
  const { mainEl } = prepareDoc(rawHtml);

  // mainEl 内に title と同テキストの H1 が残っている場合は除去
  // （<header> 内の H1 は prepareDoc 時点で消えているため、ここでは何もしなくてよい）
  const contentH1 = mainEl.querySelector('h1');
  if (contentH1 && contentH1.textContent.trim().toLowerCase() === title.toLowerCase()) {
    contentH1.remove();
  }

  const md = nodeToMarkdown(mainEl, sourceUrl)
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  return { title, md };
}

// -----------------------------------------------
// DOM → Markdown 変換（再帰）
// -----------------------------------------------
function nodeToMarkdown(node, baseUrl) {
  if (!node) return '';

  function convert(n) {
    if (n.nodeType === Node.TEXT_NODE) {
      return n.textContent.replace(/[\r\n\t]+/g, ' ');
    }
    if (n.nodeType !== Node.ELEMENT_NODE) return '';

    const tag = n.tagName.toLowerCase();
    const children = () => Array.from(n.childNodes).map(convert).join('');
    const inline   = () => children().trim();

    switch (tag) {
      case 'h1': return `\n\n# ${inline()}\n\n`;
      case 'h2': return `\n\n## ${inline()}\n\n`;
      case 'h3': return `\n\n### ${inline()}\n\n`;
      case 'h4': return `\n\n#### ${inline()}\n\n`;
      case 'h5': return `\n\n##### ${inline()}\n\n`;
      case 'h6': return `\n\n###### ${inline()}\n\n`;

      case 'p': { const t = inline(); return t ? `\n\n${t}\n\n` : ''; }
      case 'br': return '\n';
      case 'hr': return '\n\n---\n\n';

      case 'strong': case 'b': {
        const t = inline(); return t ? `**${t}**` : '';
      }
      case 'em': case 'i': {
        const t = inline(); return t ? `*${t}*` : '';
      }

      case 'code': {
        if (n.parentElement && n.parentElement.tagName.toLowerCase() === 'pre') {
          return n.textContent;
        }
        const t = n.textContent; return t ? `\`${t}\`` : '';
      }
      case 'pre': {
        const codeEl = n.querySelector('code');
        const content = (codeEl ? codeEl.textContent : n.textContent).trim();
        return `\n\n\`\`\`\n${content}\n\`\`\`\n\n`;
      }

      case 'blockquote': {
        const inner = inline().split('\n').map(l => `> ${l}`).join('\n');
        return `\n\n${inner}\n\n`;
      }

      case 'a': {
        const href = (n.getAttribute('href') || '').trim();
        const text = inline() || href;
        if (!href || href.startsWith('#') || href.startsWith('javascript:')) return text;
        try { return `[${text}](${new URL(href, baseUrl).href})`; }
        catch { return text; }
      }

      case 'img': {
        const src = (n.getAttribute('src') || '').trim();
        const alt = (n.getAttribute('alt') || '').trim();
        if (!src) return alt;
        try { return `![${alt}](${new URL(src, baseUrl).href})`; }
        catch { return alt; }
      }

      case 'ul': {
        const items = Array.from(n.children)
          .filter(c => c.tagName.toLowerCase() === 'li')
          .map(li => `- ${Array.from(li.childNodes).map(convert).join('').trim()}`)
          .join('\n');
        return items ? `\n\n${items}\n\n` : '';
      }
      case 'ol': {
        const items = Array.from(n.children)
          .filter(c => c.tagName.toLowerCase() === 'li')
          .map((li, idx) =>
            `${idx + 1}. ${Array.from(li.childNodes).map(convert).join('').trim()}`)
          .join('\n');
        return items ? `\n\n${items}\n\n` : '';
      }
      case 'li': return children();

      case 'table': return `\n\n${convertTable(n)}\n\n`;
      case 'thead': case 'tbody': case 'tfoot':
      case 'tr': case 'th': case 'td': return children();

      case 'div': case 'section': case 'article':
      case 'main': case 'figure': case 'figcaption':
      case 'aside': case 'dl': case 'dt': case 'dd': {
        const t = children(); return t ? `\n${t}\n` : '';
      }

      default: return children();
    }
  }

  function convertTable(tableNode) {
    const rows = Array.from(tableNode.querySelectorAll('tr'));
    if (!rows.length) return '';
    return rows.map((row, i) => {
      const cells = Array.from(row.querySelectorAll('th, td'));
      const line = '| ' +
        cells.map(c => c.textContent.trim().replace(/\|/g, '\\|')).join(' | ') + ' |';
      if (i === 0) {
        const sep = '| ' + cells.map(() => '---').join(' | ') + ' |';
        return `${line}\n${sep}`;
      }
      return line;
    }).join('\n');
  }

  return convert(node);
}

// -----------------------------------------------
// DOM → プレーンテキスト変換
// -----------------------------------------------
const BLOCK_TAGS = new Set([
  'p', 'div', 'section', 'article', 'main', 'aside',
  'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
  'ul', 'ol', 'li', 'dl', 'dt', 'dd',
  'blockquote', 'pre', 'figure', 'figcaption',
  'table', 'thead', 'tbody', 'tfoot', 'tr', 'th', 'td',
]);

function nodeToPlainText(node) {
  if (!node) return '';
  const parts = [];

  function walk(n) {
    if (n.nodeType === Node.TEXT_NODE) {
      const t = n.textContent.replace(/[\r\n\t ]+/g, ' ');
      if (t.trim()) parts.push(t);
      return;
    }
    if (n.nodeType !== Node.ELEMENT_NODE) return;
    const tag = n.tagName.toLowerCase();
    if (tag === 'br') { parts.push('\n'); return; }
    if (tag === 'hr') { parts.push('\n\n'); return; }
    const isBlock = BLOCK_TAGS.has(tag);
    if (isBlock) parts.push('\n');
    n.childNodes.forEach(walk);
    if (isBlock) parts.push('\n');
  }

  walk(node);
  return parts.join('')
    .replace(/[ \t]*\n/g, '\n')
    .replace(/\n[ \t]+/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

// -----------------------------------------------
// 単一URL ステータスバーの表示を更新する
// -----------------------------------------------
function setStatus(type, icon, message) {
  statusBar.hidden = false;
  statusBar.className = `status-bar status-${type}`;
  statusIcon.textContent = icon;
  statusText.textContent = message;
}

// ===============================================
// Phase 7：Sitemap から URL 候補を取得
// ===============================================

/** Phase 9.2：URL候補の内部保持上限 */
const SITEMAP_FETCH_LIMIT = 500;
/** Phase 9.2：1ページの表示件数 */
const SITEMAP_PAGE_SIZE   = 50;
/** Phase 9.2：資料パック転記時の警告件数 */
const PACK_WARN_LIMIT     = 50;
/** Phase 9.2：資料パック転記時の分割推奨件数 */
const PACK_SPLIT_LIMIT    = 100;

/**
 * サイト URL のオリジンから試みる sitemap 候補パスを返す
 * @param {string} siteUrl
 * @returns {string[]}
 */
function getSitemapCandidates(siteUrl) {
  const origin = new URL(siteUrl).origin;
  return [
    `${origin}/sitemap.xml`,
    `${origin}/sitemap_index.xml`,
    `${origin}/wp-sitemap.xml`,
  ];
}

/**
 * 入力が sitemap XML URL のように見えるか判定する。
 * パスが .xml で終わるか "sitemap" を含む場合に true。
 * @param {string} urlStr
 * @returns {boolean}
 */
function looksLikeSitemapUrl(urlStr) {
  try {
    const pathname = new URL(urlStr).pathname.toLowerCase();
    return pathname.endsWith('.xml') || pathname.includes('sitemap');
  } catch { return false; }
}

/**
 * Cloudflare Worker 経由で sitemap XML を取得し DOMParser で解析する。
 * @param {string} sitemapUrl
 * @returns {Promise<
 *   { type: 'index',  sitemapUrls: string[] } |
 *   { type: 'urlset', urls: string[] } |
 *   { type: 'empty',  urls: string[] }
 * >}
 */
async function fetchAndParseSitemap(sitemapUrl) {
  const xml = await fetchHtmlFromWorker(sitemapUrl);

  const xmlDoc = new DOMParser().parseFromString(xml, 'application/xml');

  // パースエラーチェック（Firefox / Chrome 共通のフォールバック）
  if (xmlDoc.querySelector('parsererror')) {
    throw new Error('XML として解析できませんでした');
  }

  // ── sitemap index かどうか確認 ──
  // <sitemapindex> > <sitemap> > <loc>
  const sitemapLocs = [
    ...xmlDoc.querySelectorAll('sitemapindex > sitemap > loc'),
  ];
  if (sitemapLocs.length > 0) {
    return {
      type: 'index',
      sitemapUrls: sitemapLocs
        .map(el => el.textContent.trim())
        .filter(Boolean),
    };
  }

  // ── 通常 sitemap ──
  // <urlset> > <url> > <loc>
  const urlLocs = [...xmlDoc.querySelectorAll('urlset > url > loc')];
  if (urlLocs.length > 0) {
    return {
      type: 'urlset',
      urls: urlLocs.map(el => el.textContent.trim()).filter(Boolean),
    };
  }

  return { type: 'empty', urls: [] };
}

/**
 * Sitemap index の sub-sitemap を順番に取得して URL を収集する（1 階層のみ）。
 * SITEMAP_FETCH_LIMIT に達した時点で打ち切る。
 * @param {string[]} sitemapUrls  sub-sitemap の URL 一覧
 * @returns {Promise<string[]>}
 */
async function collectUrlsFromIndex(sitemapUrls) {
  const collected = [];
  for (const sitemapUrl of sitemapUrls) {
    if (collected.length >= SITEMAP_FETCH_LIMIT) break;
    setSitemapStatus(
      'loading', '⏳',
      `Sub-sitemap を取得中… ${collected.length} 件収集済み`
    );
    try {
      const result = await fetchAndParseSitemap(sitemapUrl);
      if (result.type === 'urlset') {
        for (const url of result.urls) {
          if (collected.length >= SITEMAP_FETCH_LIMIT) break;
          collected.push(url);
        }
      }
    } catch { /* 取得失敗は無視して次へ */ }
  }
  return collected;
}

/** Sitemap ステータスバーを更新する */
function setSitemapStatus(type, icon, message) {
  sitemapStatusBar.hidden = false;
  sitemapStatusBar.className = `status-bar status-${type}`;
  sitemapStatusIcon.textContent = icon;
  sitemapStatusText.textContent = message;
}

/**
 * メイン処理：Sitemap 取得 → 解析 → URL 候補一覧表示
 */
async function handleSitemapFetch() {
  const rawInput = sitemapInput.value.trim();

  if (!rawInput) {
    setSitemapStatus('error', '❌', 'URL を入力してください');
    return;
  }
  try { new URL(rawInput); } catch {
    setSitemapStatus(
      'error', '❌',
      'URL の形式が正しくありません（https:// から始まる URL を入力してください）'
    );
    return;
  }

  sitemapFetchBtn.disabled = true;
  sitemapResultCard.hidden = true;
  lastSitemapUrls = [];
  hidePackWarnCard(); // Phase 9.3：新規取得時は警告カードを閉じる

  try {
    let collectedUrls = [];
    let noteText      = '';

    if (looksLikeSitemapUrl(rawInput)) {
      // ── 直接 sitemap URL として扱う ──
      setSitemapStatus('loading', '⏳', 'Sitemap を取得中…');
      const result = await fetchAndParseSitemap(rawInput);

      if (result.type === 'index') {
        setSitemapStatus(
          'loading', '⏳',
          `Sitemap index を検出 — ${result.sitemapUrls.length} 件の sub-sitemap から URL 候補を収集中…`
        );
        collectedUrls = await collectUrlsFromIndex(result.sitemapUrls);
        noteText = `${rawInput}（Sitemap index）配下 ${result.sitemapUrls.length} 件の sub-sitemap から URL 候補を収集しました。`;

      } else if (result.type === 'urlset') {
        collectedUrls = result.urls;
        noteText = `${rawInput} から URL 候補を取得しました。`;

      } else {
        throw new Error(
          'URL 候補が 0 件でした（sitemap に <url><loc> エントリが見つかりません）'
        );
      }

    } else {
      // ── サイト URL → 候補パスを順に試みる ──
      const candidates = getSitemapCandidates(rawInput);
      let found = false;

      for (const candidate of candidates) {
        setSitemapStatus('loading', '⏳', `試行中：${candidate}`);
        try {
          const result = await fetchAndParseSitemap(candidate);

          if (result.type === 'index') {
            setSitemapStatus(
              'loading', '⏳',
              `Sitemap index を検出 — ${result.sitemapUrls.length} 件の sub-sitemap から URL 候補を収集中…`
            );
            collectedUrls = await collectUrlsFromIndex(result.sitemapUrls);
            noteText = `${candidate}（Sitemap index）配下から URL 候補を収集しました。`;
            found = true;
            break;

          } else if (result.type === 'urlset' && result.urls.length > 0) {
            collectedUrls = result.urls;
            noteText = `${candidate} から URL 候補を取得しました。`;
            found = true;
            break;
          }
          // type === 'empty' の場合は次の候補へ

        } catch { /* 取得失敗 → 次の候補へ */ }
      }

      if (!found) {
        throw new Error(
          'Sitemap が見つかりませんでした\n' +
          '（/sitemap.xml / /sitemap_index.xml / /wp-sitemap.xml を試しましたが取得できませんでした）'
        );
      }
    }

    // ── URL 上限を適用して内部保持・表示 ──（Phase 9.2）
    const total     = collectedUrls.length;
    const stored    = collectedUrls.slice(0, SITEMAP_FETCH_LIMIT);
    const truncated = total > SITEMAP_FETCH_LIMIT;

    lastSitemapUrls      = stored;
    filteredSitemapUrls  = [...stored];
    sitemapCurrentPage   = 0;
    checkedSitemapUrls.clear();
    // Phase 9.4：50件以下は全件チェック済み、51件以上は初期状態を未選択にする（安全対策）
    if (stored.length <= PACK_WARN_LIMIT) {
      stored.forEach(url => checkedSitemapUrls.add(url));
    }
    titleCache.clear();
    previewCache.clear();    // Phase 10：新規取得時はプレビューキャッシュもリセット
    closePreviewPanel();     // Phase 10：古いプレビューパネルを閉じる

    // Phase 9.4：大量候補時の案内文
    if (stored.length > PACK_WARN_LIMIT) {
      sitemapBulkHint.textContent =
        `URL候補が ${stored.length} 件あります。候補が多いため初期状態は未選択です。` +
        `キーワードで絞り込んでから「このページを全選択」で必要なページを選んでください。`;
      sitemapBulkHint.hidden = false;
    } else {
      sitemapBulkHint.hidden = true;
    }

    renderCurrentPage();
    // 絞り込みフィールドをリセット
    sitemapIncludeInput.value = '';
    sitemapExcludeInput.value = '';
    sitemapDisplayCount.hidden = true;
    sitemapUrlCount.textContent = truncated
      ? `${stored.length} 件（全 ${total} 件中、上位 ${SITEMAP_FETCH_LIMIT} 件を保持）`
      : `${stored.length} 件`;
    sitemapResultNote.textContent = truncated
      ? `${noteText}　上限 ${SITEMAP_FETCH_LIMIT} 件を内部保持しています（全 ${total} 件）。`
      : noteText;

    sitemapResultCard.hidden = false;
    setSitemapStatus('success', '✅', `URL 候補 ${stored.length} 件を取得しました`);
    sitemapResultCard.scrollIntoView({ behavior: 'smooth', block: 'start' });

  } catch (e) {
    setSitemapStatus('error', '❌', `エラー：${e.message}`);
  } finally {
    sitemapFetchBtn.disabled = false;
  }
}

/**
 * Sitemap URL 一覧（全件）をクリップボードにコピーする
 */
async function copySitemapUrls() {
  if (!lastSitemapUrls.length) {
    showSitemapCopyFeedback('❌ コピーする内容がありません', false);
    return;
  }
  const text = lastSitemapUrls.join('\n');
  try {
    await navigator.clipboard.writeText(text);
    showSitemapCopyFeedback(`✅ ${lastSitemapUrls.length} 件をコピーしました`, true);
  } catch {
    showSitemapCopyFeedback('❌ コピーに失敗しました', false);
  }
}

/**
 * フィルター済みかつチェック済みの URL を複数URL 資料パック入力欄に転記する。
 * 50件以下はそのまま反映。51件以上は分割反映 警告カードを表示する。（Phase 9.3）
 */
function sendToPackInput() {
  // filteredSitemapUrls ∩ checkedSitemapUrls（全ページ対象）
  const checkedUrls = filteredSitemapUrls.filter(url => checkedSitemapUrls.has(url));

  if (!checkedUrls.length) {
    showSitemapCopyFeedback('❌ チェックされた URL がありません', false);
    return;
  }

  if (checkedUrls.length <= PACK_WARN_LIMIT) {
    // 50件以下：そのまま反映
    doReflectUrls(checkedUrls);
    return;
  }

  // 51件以上：分割反映 警告カードを表示（window.confirm は使わない）
  showPackWarnCard(checkedUrls);
}

// ===============================================
// Phase 9.3：分割反映 警告カード
// ===============================================

/**
 * 分割反映 警告カードを表示する。
 * ヘッダーに件数、「このまま全部を反映」「N〜M件だけ反映」「選択を見直す」ボタンを生成。
 * @param {string[]} urls  チェック済み URL の全リスト
 */
function showPackWarnCard(urls) {
  packWarnCount.textContent = urls.length;
  packWarnActions.innerHTML = '';

  // ── このまま全部を反映 ──
  const allBtn = document.createElement('button');
  allBtn.type        = 'button';
  allBtn.className   = 'pack-warn-btn pack-warn-btn--all';
  allBtn.textContent = `このまま全部を反映（${urls.length}件）`;
  allBtn.addEventListener('click', () => {
    hidePackWarnCard();
    doReflectUrls(urls);  // partNum なし = パック名変更なし
  });
  packWarnActions.appendChild(allBtn);

  // ── 50件単位の分割ボタン ──
  const chunkSize  = PACK_WARN_LIMIT; // 50
  const chunkCount = Math.ceil(urls.length / chunkSize);
  for (let i = 0; i < chunkCount; i++) {
    const start  = i * chunkSize;
    const end    = Math.min(start + chunkSize, urls.length);
    const chunk  = urls.slice(start, end);
    const partNo = i + 1;

    const chunkBtn = document.createElement('button');
    chunkBtn.type        = 'button';
    chunkBtn.className   = 'pack-warn-btn pack-warn-btn--chunk';
    chunkBtn.textContent = `${start + 1}〜${end}件だけ反映`;
    chunkBtn.addEventListener('click', () => {
      hidePackWarnCard();
      doReflectUrls(chunk, partNo);
    });
    packWarnActions.appendChild(chunkBtn);
  }

  // ── 選択を見直す ──
  const cancelBtn = document.createElement('button');
  cancelBtn.type        = 'button';
  cancelBtn.className   = 'pack-warn-btn pack-warn-btn--cancel';
  cancelBtn.textContent = '選択を見直す';
  cancelBtn.addEventListener('click', hidePackWarnCard);
  packWarnActions.appendChild(cancelBtn);

  packWarnCard.hidden = false;
  packWarnCard.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

/** 分割反映 警告カードを閉じてボタンをクリア */
function hidePackWarnCard() {
  packWarnCard.hidden = true;
  packWarnActions.innerHTML = '';
}

/**
 * URL リストを複数URL 資料パック入力欄に転記する。（Phase 9.3）
 * @param {string[]} urls    転記する URL リスト
 * @param {number|null} partNum  分割番号（null = 全件反映, 1以上 = 分割）
 */
function doReflectUrls(urls, partNum = null) {
  multiUrlInput.value = urls.join('\n');

  // 分割時：資料パック名に _partN を付加
  if (partNum !== null) {
    // 既存の入力欄から _partN を除いたベース名を取得
    const rawBase = packNameInput.value.trim().replace(/_part\d+$/, '');
    let baseName = rawBase;

    // 入力欄が空の場合はサイトmap URL のドメインから推定
    if (!baseName) {
      try {
        const hostname = new URL(sitemapInput.value.trim()).hostname.replace(/^www\./, '');
        const domain   = hostname.split('.').slice(0, -1).join('-') || hostname;
        const now      = new Date();
        const d = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
        baseName = `${domain}_資料パック_${d}`;
      } catch { /* 推定失敗時は設定しない */ }
    }

    if (baseName) packNameInput.value = `${baseName}_part${partNum}`;
  }

  multiUrlInput.scrollIntoView({ behavior: 'smooth', block: 'center' });
  showSitemapCopyFeedback(`✅ ${urls.length} 件を資料パック欄に反映しました`, true);
}

function showSitemapCopyFeedback(message, success) {
  sitemapCopyFeedback.hidden = false;
  sitemapCopyFeedback.textContent = message;
  sitemapCopyFeedback.className =
    `copy-feedback ${success ? 'copy-success' : 'copy-error'}`;
  clearTimeout(sitemapCopyFeedback._timer);
  sitemapCopyFeedback._timer = setTimeout(() => {
    sitemapCopyFeedback.hidden = true;
  }, 3000);
}

// ===============================================
// Phase 7.5：Sitemap URL 選択チェックボックス
// ===============================================

/**
 * URL 候補をチェックボックスリストとしてレンダリングする（Phase 9.2：ページネーション対応）。
 * チェック状態は checkedSitemapUrls Set から復元し、タイトルは titleCache から復元する。
 * @param {string[]} urls  現在ページに表示する URL 一覧
 */
function renderSitemapCheckboxList(urls) {
  sitemapUrlCheckboxes.innerHTML = '';
  urls.forEach(url => {
    const isAux            = isAuxiliaryUrl(url);
    const { type, css }    = classifyUrl(url);
    const labelText        = getUrlLabel(url);
    const shortHostText    = getUrlShortPath(url);

    // ── ルート要素（label）──
    const item = document.createElement('label');
    item.className = `sitemap-url-item${isAux ? ' sitemap-url-item--aux' : ''}`;
    item.title = url;   // ロングプレス / ホバーで full URL

    // チェックボックス（Phase 9.2：checkedSitemapUrls で状態を復元）
    const cb = document.createElement('input');
    cb.type      = 'checkbox';
    cb.className = 'sitemap-url-check';
    cb.value     = url;
    cb.checked   = checkedSitemapUrls.has(url);
    cb.addEventListener('change', () => {
      if (cb.checked) {
        checkedSitemapUrls.add(url);
      } else {
        checkedSitemapUrls.delete(url);
      }
      updateSitemapSelectCount();
      updatePreviewCheckedBtn(); // Phase 10.1：チェック変更時に選択中プレビューボタンも更新
    });

    // ── info ブロック（右側）──
    const info = document.createElement('div');
    info.className = 'sitemap-url-info';

    // タイトル行（Phase 9.2：titleCache から復元、未取得は hidden）
    const titleSpan = document.createElement('span');
    if (titleCache.has(url)) {
      const cachedTitle       = titleCache.get(url);
      titleSpan.textContent   = cachedTitle || 'タイトル取得不可';
      titleSpan.hidden        = false;
      titleSpan.className     = cachedTitle
        ? 'sitemap-url-title'
        : 'sitemap-url-title sitemap-url-title--error';
      item.dataset.titleState = 'done';
    } else {
      titleSpan.className     = 'sitemap-url-title';
      titleSpan.hidden        = true;
      item.dataset.titleState = 'pending';
    }

    // 1 行目：ラベル + タイプバッジ [+ 補助ページヒント]
    const labelRow = document.createElement('div');
    labelRow.className = 'sitemap-url-label-row';

    const labelSpan = document.createElement('span');
    labelSpan.className   = 'sitemap-url-label';
    labelSpan.textContent = labelText;

    const badge = document.createElement('span');
    badge.className   = `url-badge ${css}`;
    badge.textContent = type;

    labelRow.appendChild(labelSpan);
    labelRow.appendChild(badge);

    if (isAux) {
      const auxHint = document.createElement('span');
      auxHint.className   = 'url-aux-hint';
      auxHint.textContent = '補助ページ';
      labelRow.appendChild(auxHint);
    }

    // 2 行目：ドメイン＋パス（小さめ）
    const domainSpan = document.createElement('span');
    domainSpan.className   = 'sitemap-url-domain';
    domainSpan.textContent = shortHostText;

    info.appendChild(titleSpan);  // Phase 9.1：タイトル（取得後に表示）
    info.appendChild(labelRow);
    info.appendChild(domainSpan);

    item.appendChild(cb);
    item.appendChild(info);
    sitemapUrlCheckboxes.appendChild(item);
  });
  updateSitemapSelectCount();
}

/**
 * 選択件数表示を更新する（Phase 9.2：filteredSitemapUrls 全体を集計してページ跨ぎに対応）
 */
function updateSitemapSelectCount() {
  const total   = filteredSitemapUrls.length;
  const checked = filteredSitemapUrls.filter(url => checkedSitemapUrls.has(url)).length;
  sitemapSelectCount.textContent = total > 0 ? `${checked} / ${total} 件選択中` : '';
}

// ===============================================
// Phase 7.6：URL 表示ヘルパー
// ===============================================

/**
 * pathname のセグメントを " / " でつなぎ、人が読みやすいラベルを返す。
 * 例: /blog/example-post/ → "blog / example-post"
 *     /protocol.html      → "protocol.html"
 *     /                   → "Home"
 * @param {string} url
 * @returns {string}
 */
function getUrlLabel(url) {
  try {
    const segments = new URL(url).pathname
      .split('/')
      .filter(s => s.length > 0);
    return segments.length === 0 ? 'Home' : segments.join(' / ');
  } catch {
    return url;
  }
}

/**
 * "hostname + pathname" 形式（プロトコル省略）を返す。
 * ドメイン行に small text として表示する。
 * @param {string} url
 * @returns {string}
 */
function getUrlShortPath(url) {
  try {
    const u = new URL(url);
    return u.hostname + u.pathname;
  } catch {
    return url;
  }
}

/**
 * URL パスからページの種類を推定し、バッジラベルと CSS クラスを返す。
 * @param {string} url
 * @returns {{ type: string, css: string }}
 */
function classifyUrl(url) {
  try {
    const path = new URL(url).pathname.toLowerCase();

    if (path === '/' || path === '')
      return { type: 'Home',     css: 'badge-home'    };
    if (/\/faq|\/help|\/frequently[\-_]asked/.test(path))
      return { type: 'FAQ',      css: 'badge-faq'     };
    if (/\/blog|\/news/.test(path))
      return { type: 'Blog',     css: 'badge-blog'    };
    if (/\/articles?\//.test(path))
      return { type: 'Article',  css: 'badge-article' };
    if (/\/privacy/.test(path))
      return { type: 'Privacy',  css: 'badge-aux'     };
    if (/\/terms|\/tos\b|\/legal/.test(path))
      return { type: 'Terms',    css: 'badge-aux'     };
    if (/\/categor/.test(path))
      return { type: 'Category', css: 'badge-nav'     };
    if (/\/tag/.test(path))
      return { type: 'Tag',      css: 'badge-nav'     };

    // 拡張子なし・セグメント有 → Article 扱い
    return { type: 'Article', css: 'badge-article' };
  } catch {
    return { type: 'Other', css: 'badge-other' };
  }
}

/**
 * NotebookLM 資料に不要な「補助ページ」かどうか判定する。
 * privacy / terms / tag / category / archive / login / search などが該当。
 * @param {string} url
 * @returns {boolean}
 */
function isAuxiliaryUrl(url) {
  try {
    const path = new URL(url).pathname.toLowerCase();
    return [
      /\/privacy/,
      /\/terms/,
      /\/tos\b/,
      /\/legal/,
      /\/disclaimer/,
      /\/tags?(\/|$)/,
      /\/categor/,
      /\/archive/,
      /\/login|\/signin|\/signup|\/register/,
      /\/search/,
      /\/contact/,
      /\/sitemap/,
      /\/feed|\/rss/,
      /\/author/,
      /\/page\/\d/,   // ページネーション（/page/2/ など）
    ].some(p => p.test(path));
  } catch {
    return false;
  }
}

// ===============================================
// Phase 9.2：Sitemap URL 絞り込み（検索・除外キーワード）
// ===============================================

/**
 * 検索キーワード / 除外キーワードに基づき URL 候補をデータレベルで絞り込み、
 * filteredSitemapUrls を更新してページ 0 に移動する。（Phase 9.2 改訂）
 *
 * 区切り文字: 半角スペース・全角スペース・カンマ・読点
 *
 * ロジック:
 *   検索キーワード — どれか1つでも含む → 対象（OR）。空 = 全件対象。
 *   除外キーワード — どれか1つでも含む → 除外（OR）。空 = 除外なし。
 *   最終 = 検索にHIT かつ 除外にHITしない
 *
 * 検索対象:
 *   URL 文字列 / pathname ラベル / 種類バッジ / 取得済みページタイトル（titleCache）
 */
function filterSitemapList() {
  const DELIM = /[\s　,、]+/;  // 半角SP / 全角SP / カンマ / 読点

  const includeKws = sitemapIncludeInput.value.trim()
    .split(DELIM).filter(k => k.length > 0).map(k => k.toLowerCase());
  const excludeKws = sitemapExcludeInput.value.trim()
    .split(DELIM).filter(k => k.length > 0).map(k => k.toLowerCase());

  filteredSitemapUrls = lastSitemapUrls.filter(url => {
    const urlLower  = url.toLowerCase();
    const label     = getUrlLabel(url).toLowerCase();
    const { type }  = classifyUrl(url);
    const badge     = type.toLowerCase();
    const pageTitle = (titleCache.get(url) ?? '').toLowerCase();
    const haystack  = `${urlLower} ${label} ${badge} ${pageTitle}`;

    const included = includeKws.length === 0 || includeKws.some(k => haystack.includes(k));
    const excluded = excludeKws.length > 0   && excludeKws.some(k => haystack.includes(k));
    return included && !excluded;
  });

  sitemapCurrentPage = 0;

  // 表示件数（フィルターが入っているときのみ表示）
  const total     = lastSitemapUrls.length;
  const filtered  = filteredSitemapUrls.length;
  const hasFilter = includeKws.length > 0 || excludeKws.length > 0;
  if (hasFilter) {
    sitemapDisplayCount.textContent = filtered === 0
      ? `0 / ${total} 件（一致なし）`
      : `${filtered} / ${total} 件表示中`;
    sitemapDisplayCount.hidden = false;
  } else {
    sitemapDisplayCount.hidden = true;
  }

  renderCurrentPage();
}

// ===============================================
// Phase 9.2：ページネーション
// ===============================================

/**
 * filteredSitemapUrls の現在ページ分を renderSitemapCheckboxList に渡して描画し、
 * ページコントロールも更新する。
 */
function renderCurrentPage() {
  const pageCount = Math.ceil(filteredSitemapUrls.length / SITEMAP_PAGE_SIZE) || 1;
  // 境界チェック
  if (sitemapCurrentPage >= pageCount) sitemapCurrentPage = pageCount - 1;
  if (sitemapCurrentPage < 0)          sitemapCurrentPage = 0;

  const start    = sitemapCurrentPage * SITEMAP_PAGE_SIZE;
  const end      = start + SITEMAP_PAGE_SIZE;
  const pageUrls = filteredSitemapUrls.slice(start, end);

  renderSitemapCheckboxList(pageUrls);
  renderPageControls();
  // Phase 9.4：ページ切り替え時にタイトル取得ボタンの状態を更新する
  updateFetchTitlesBtn();
  // Phase 10.1：ページ切り替え時に本文プレビューボタンの状態も更新する
  updatePreviewVisibleBtn();
  updatePreviewCheckedBtn();
}

/**
 * ページ情報テキストとページボタンを生成する。
 * ページが 1 つだけのときはボタン・テキスト両方を非表示にする。
 */
function renderPageControls() {
  const total     = filteredSitemapUrls.length;
  const pageCount = Math.ceil(total / SITEMAP_PAGE_SIZE) || 1;

  sitemapPageBtns.innerHTML = '';

  if (pageCount <= 1) {
    sitemapPageInfo.textContent = '';
    return;
  }

  const start = sitemapCurrentPage * SITEMAP_PAGE_SIZE + 1;
  const end   = Math.min((sitemapCurrentPage + 1) * SITEMAP_PAGE_SIZE, total);
  sitemapPageInfo.textContent = `${start}–${end} 件目 / 全 ${total} 件`;

  for (let i = 0; i < pageCount; i++) {
    const btn = document.createElement('button');
    btn.type      = 'button';
    btn.className = `page-btn${i === sitemapCurrentPage ? ' page-btn--active' : ''}`;
    btn.textContent = String(i + 1);
    const pageIdx = i;
    btn.addEventListener('click', () => {
      sitemapCurrentPage = pageIdx;
      renderCurrentPage();
      sitemapUrlCheckboxes.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    });
    sitemapPageBtns.appendChild(btn);
  }
}

/**
 * 現在のページの URL 候補だけを一括 ON / OFF する。
 * 他のページのチェック状態（checkedSitemapUrls）は維持される。
 * @param {boolean} checked  true: 全選択　false: 全解除
 */
function setSitemapVisibleCheck(checked) {
  // 現在ページの URL だけ checkedSitemapUrls を更新する
  const start    = sitemapCurrentPage * SITEMAP_PAGE_SIZE;
  const end      = start + SITEMAP_PAGE_SIZE;
  const pageUrls = filteredSitemapUrls.slice(start, end);

  pageUrls.forEach(url => {
    if (checked) {
      checkedSitemapUrls.add(url);
    } else {
      checkedSitemapUrls.delete(url);
    }
  });

  // DOM のチェックボックスも同期
  sitemapUrlCheckboxes
    .querySelectorAll('.sitemap-url-check')
    .forEach(cb => { cb.checked = checked; });

  updateSitemapSelectCount();
  updatePreviewCheckedBtn(); // Phase 10.1：全選択/全解除後に選択中プレビューボタンも更新
}

// ===============================================
// Phase 9.1：タイトル一括取得
// ===============================================

/**
 * ページ HTML から <h1> または <title> テキストを抽出する。
 * 優先順位: 先頭 H1 > document.title
 * @param {string} html
 * @returns {string}
 */
function extractPageTitle(html) {
  try {
    const doc    = new DOMParser().parseFromString(html, 'text/html');
    const h1El   = doc.body ? doc.body.querySelector('h1') : null;
    const h1Text = h1El ? h1El.textContent.trim() : '';
    const docTitle = (doc.title || '').trim();
    return h1Text || docTitle;
  } catch { return ''; }
}

/**
 * 現在ページの URL 候補のうち titleCache に未登録の先頭 TITLE_FETCH_LIMIT 件を
 * Cloudflare Worker 経由で順番に取得し、titleCache に保存して各アイテムに表示する。
 * 取得済みの URL はスキップし、未取得分を 20 件ずつ段階的に取れるようにする。（Phase 9.4）
 *
 * 段階的取得の流れ:
 *   1回目: 未取得 50件 → 先頭 20件を取得 → ボタン「次の20件のタイトルを取得」
 *   2回目: 未取得 30件 → 先頭 20件を取得 → ボタン「残り10件のタイトルを取得」
 *   3回目: 未取得 10件 → 残り 10件を取得 → ボタン無効「✅ 表示中のタイトル取得済み」
 */
async function fetchVisibleTitles() {
  // 現在ページの URL 一覧（filteredSitemapUrls の現ページ分）
  const start    = sitemapCurrentPage * SITEMAP_PAGE_SIZE;
  const end      = start + SITEMAP_PAGE_SIZE;
  const pageUrls = filteredSitemapUrls.slice(start, end);

  if (!pageUrls.length) {
    fetchTitlesStatus.textContent = '❌ 表示中の候補がありません';
    setTimeout(() => { fetchTitlesStatus.textContent = ''; }, 3000);
    return;
  }

  // titleCache 未登録のものだけを対象にし、先頭 TITLE_FETCH_LIMIT 件に絞る
  const pendingUrls = pageUrls.filter(url => !titleCache.has(url));
  const targetUrls  = pendingUrls.slice(0, TITLE_FETCH_LIMIT);

  if (!targetUrls.length) {
    // 全件取得済み（ボタン状態を同期して終了）
    updateFetchTitlesBtn();
    return;
  }

  // DOM アイテムの Map を作成（URL → item 要素）
  const urlToItem = new Map();
  sitemapUrlCheckboxes.querySelectorAll('.sitemap-url-item').forEach(item => {
    const cb = item.querySelector('.sitemap-url-check');
    if (cb) urlToItem.set(cb.value, item);
  });

  fetchTitlesBtn.disabled = true;
  let done = 0;

  for (const url of targetUrls) {
    const item    = urlToItem.get(url);
    const titleEl = item ? item.querySelector('.sitemap-url-title') : null;

    fetchTitlesStatus.textContent = `${done + 1} / ${targetUrls.length} 取得中...`;

    if (titleEl) {
      titleEl.textContent     = '取得中...';
      titleEl.hidden          = false;
      titleEl.className       = 'sitemap-url-title sitemap-url-title--loading';
      if (item) item.dataset.titleState = 'loading';
    }

    try {
      const html  = await fetchHtmlFromWorker(url);
      const title = extractPageTitle(html);
      titleCache.set(url, title || '');  // '' = タイトル取得不可
      if (titleEl) {
        titleEl.textContent = title || 'タイトル取得不可';
        titleEl.className   = title
          ? 'sitemap-url-title'
          : 'sitemap-url-title sitemap-url-title--error';
        if (item) item.dataset.titleState = 'done';
      }
    } catch {
      titleCache.set(url, '');           // '' = エラー
      if (titleEl) {
        titleEl.textContent = 'タイトル取得不可';
        titleEl.className   = 'sitemap-url-title sitemap-url-title--error';
        if (item) item.dataset.titleState = 'error';
      }
    }

    done++;
    fetchTitlesStatus.textContent = `${done} / ${targetUrls.length} 完了`;
  }

  // ボタン文言を残り件数に応じて更新する
  updateFetchTitlesBtn();

  if (done > 0) {
    fetchTitlesStatus.textContent = `✅ ${done} 件取得しました`;
    setTimeout(() => { fetchTitlesStatus.textContent = ''; }, 3000);
  }
}

/**
 * 現在ページのタイトル取得状況に応じてボタン文言・有効状態を更新する。（Phase 9.4）
 *
 * 状態遷移:
 *   未取得 0件（全件取得済み）  → disabled「✅ 表示中のタイトル取得済み」
 *   取得済み 0件（初回）        → enabled 「🔍 表示中のタイトルを取得」
 *   取得済み > 0、未取得 > 20  → enabled 「🔍 次の20件のタイトルを取得」
 *   取得済み > 0、未取得 ≤ 20  → enabled 「🔍 残りN件のタイトルを取得」
 */
function updateFetchTitlesBtn() {
  const start    = sitemapCurrentPage * SITEMAP_PAGE_SIZE;
  const end      = start + SITEMAP_PAGE_SIZE;
  const pageUrls = filteredSitemapUrls.slice(start, end);

  if (!pageUrls.length) {
    // 候補なし：ボタンはデフォルト文言・有効に戻す
    fetchTitlesBtn.disabled    = false;
    fetchTitlesBtn.textContent = '🔍 表示中のタイトルを取得';
    return;
  }

  const fetchedCount = pageUrls.filter(url =>  titleCache.has(url)).length;
  const pendingCount = pageUrls.length - fetchedCount;

  if (pendingCount === 0) {
    // 全件取得済み
    fetchTitlesBtn.disabled    = true;
    fetchTitlesBtn.textContent = '✅ 表示中のタイトル取得済み';
  } else if (fetchedCount === 0) {
    // まだ 1 件も取得していない（初回）
    fetchTitlesBtn.disabled    = false;
    fetchTitlesBtn.textContent = '🔍 表示中のタイトルを取得';
  } else if (pendingCount <= TITLE_FETCH_LIMIT) {
    // 残りが TITLE_FETCH_LIMIT 以下
    fetchTitlesBtn.disabled    = false;
    fetchTitlesBtn.textContent = `🔍 残り${pendingCount}件のタイトルを取得`;
  } else {
    // まだ TITLE_FETCH_LIMIT 件以上残っている
    fetchTitlesBtn.disabled    = false;
    fetchTitlesBtn.textContent = `🔍 次の${TITLE_FETCH_LIMIT}件のタイトルを取得`;
  }
}

// ===============================================
// Phase 10：本文プレビュー
// ===============================================

/**
 * 本文プレビューを開始する。
 *
 * mode = 'visible' : 現在ページの先頭 PREVIEW_FETCH_LIMIT 件
 * mode = 'checked' : チェック済みURLの先頭 PREVIEW_FETCH_LIMIT 件
 *                    （10件を超えている場合は警告メッセージを表示）
 *
 * 安全設計:
 *   - 1件ずつ逐次取得（同時アクセスなし）
 *   - previewCache に登録済みのURLはスキップ（重複取得なし）
 *   - 最大 PREVIEW_FETCH_LIMIT (10) 件で止まる
 *   - Cloudflare Worker 変更なし・資料パック処理に影響しない
 *
 * @param {'visible'|'checked'} mode
 */
/**
 * 本文プレビューを開始する（モード振り分け）。（Phase 10.1：段階取得対応）
 * @param {'visible'|'checked'} mode
 */
async function startBodyPreview(mode) {
  if (mode === 'visible') {
    await handlePreviewVisible();
  } else {
    await handlePreviewChecked();
  }
}

/**
 * 「表示中の本文をプレビュー」— 段階取得版。（Phase 10.1）
 *
 * 現在ページの URL を対象に、previewCache 未登録の先頭 PREVIEW_FETCH_LIMIT 件を取得。
 * パネルが開いている場合は追記（アコーディオン蓄積）、閉じている場合は新規に開く。
 * ボタン文言は取得後に updatePreviewVisibleBtn() で更新する。
 */
async function handlePreviewVisible() {
  const start    = sitemapCurrentPage * SITEMAP_PAGE_SIZE;
  const end      = start + SITEMAP_PAGE_SIZE;
  const pageUrls = filteredSitemapUrls.slice(start, end);

  if (!pageUrls.length) {
    previewStatus.textContent = '❌ 表示中の URL がありません';
    setTimeout(() => { previewStatus.textContent = ''; }, 3000);
    return;
  }

  const pendingUrls = pageUrls.filter(url => !previewCache.has(url));
  const targetUrls  = pendingUrls.slice(0, PREVIEW_FETCH_LIMIT);

  if (!targetUrls.length) {
    // 全件取得済み：パネルが閉じていれば取得済み結果で開く
    if (previewResultArea.hidden) {
      openPreviewPanel(pageUrls.filter(url => previewCache.has(url)));
    }
    previewStatus.textContent = '✅ 表示中の本文プレビューは取得済みです';
    setTimeout(() => { previewStatus.textContent = ''; }, 3000);
    updatePreviewVisibleBtn();
    return;
  }

  // パネルが閉じていれば開く、開いていれば追記
  if (previewResultArea.hidden) {
    previewResultArea.hidden = false;
    previewResultList.innerHTML = '';
  }
  targetUrls.forEach(url => previewResultList.appendChild(buildPreviewItemDom(url)));
  previewResultArea.scrollIntoView({ behavior: 'smooth', block: 'nearest' });

  setPreviewBtnsDisabled(true);
  let done = 0;

  for (const url of targetUrls) {
    previewStatus.textContent = `${done + 1} / ${targetUrls.length} 取得中...`;
    try {
      const html  = await fetchHtmlFromWorker(url);
      const title = extractPageTitle(html);
      const { text } = extractBodyText(html);
      previewCache.set(url, {
        title: title || '',
        text:  text.slice(0, PREVIEW_TEXT_LENGTH),
        error: false,
      });
    } catch {
      previewCache.set(url, { title: '', text: '', error: true });
    }
    updatePreviewItemDom(url);
    done++;
    previewStatus.textContent = `${done} / ${targetUrls.length} 完了`;
  }

  setPreviewBtnsDisabled(false);
  updatePreviewVisibleBtn();
  updatePreviewCheckedBtn();
  previewStatus.textContent = `✅ ${done} 件のプレビューを取得しました`;
  setTimeout(() => { previewStatus.textContent = ''; }, 4000);
}

/**
 * 「選択中の本文をプレビュー」— 段階取得版。（Phase 10.1）
 *
 * チェック済み URL を対象に、previewCache 未登録の先頭 PREVIEW_FETCH_LIMIT 件を取得。
 * 10件超えは警告メッセージを出してから未取得先頭10件を処理する。
 */
async function handlePreviewChecked() {
  const checkedUrls = filteredSitemapUrls.filter(url => checkedSitemapUrls.has(url));

  if (!checkedUrls.length) {
    previewStatus.textContent = '❌ チェックされた URL がありません';
    setTimeout(() => { previewStatus.textContent = ''; }, 3000);
    return;
  }

  const pendingUrls = checkedUrls.filter(url => !previewCache.has(url));
  const targetUrls  = pendingUrls.slice(0, PREVIEW_FETCH_LIMIT);

  // 未取得が10件超えは警告（取得は先頭10件のみ）
  if (pendingUrls.length > PREVIEW_FETCH_LIMIT) {
    previewStatus.textContent =
      `⚠️ 選択中 ${checkedUrls.length} 件のうち未取得の先頭 ${PREVIEW_FETCH_LIMIT} 件をプレビューします`;
    setTimeout(() => { previewStatus.textContent = ''; }, 5000);
  }

  if (!targetUrls.length) {
    if (previewResultArea.hidden) {
      openPreviewPanel(checkedUrls.filter(url => previewCache.has(url)));
    }
    previewStatus.textContent = '✅ 選択中の本文プレビューは取得済みです';
    setTimeout(() => { previewStatus.textContent = ''; }, 3000);
    updatePreviewCheckedBtn();
    return;
  }

  if (previewResultArea.hidden) {
    previewResultArea.hidden = false;
    previewResultList.innerHTML = '';
  }
  targetUrls.forEach(url => previewResultList.appendChild(buildPreviewItemDom(url)));
  previewResultArea.scrollIntoView({ behavior: 'smooth', block: 'nearest' });

  setPreviewBtnsDisabled(true);
  let done = 0;

  for (const url of targetUrls) {
    previewStatus.textContent = `${done + 1} / ${targetUrls.length} 取得中...`;
    try {
      const html  = await fetchHtmlFromWorker(url);
      const title = extractPageTitle(html);
      const { text } = extractBodyText(html);
      previewCache.set(url, {
        title: title || '',
        text:  text.slice(0, PREVIEW_TEXT_LENGTH),
        error: false,
      });
    } catch {
      previewCache.set(url, { title: '', text: '', error: true });
    }
    updatePreviewItemDom(url);
    done++;
    previewStatus.textContent = `${done} / ${targetUrls.length} 完了`;
  }

  setPreviewBtnsDisabled(false);
  updatePreviewCheckedBtn();
  updatePreviewVisibleBtn();
  previewStatus.textContent = `✅ ${done} 件のプレビューを取得しました`;
  setTimeout(() => { previewStatus.textContent = ''; }, 4000);
}

/**
 * プレビューパネルを開き、displayUrls を骨格 or キャッシュ済み状態で描画する。
 * @param {string[]} displayUrls
 */
function openPreviewPanel(displayUrls) {
  previewResultList.innerHTML = '';
  displayUrls.forEach(url => {
    previewResultList.appendChild(buildPreviewItemDom(url));
  });
  previewResultArea.hidden = false;
  previewResultArea.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

/** プレビューパネルを閉じてリストをクリアする */
function closePreviewPanel() {
  previewResultArea.hidden = true;
  previewResultList.innerHTML = '';
}

/**
 * URL に対応するプレビューアイテムの DOM 要素を生成して返す。
 * previewCache の状態（未取得 / エラー / 取得済み）で表示を切り替える。
 * @param {string} url
 * @returns {HTMLElement}
 */
function buildPreviewItemDom(url) {
  const cached = previewCache.get(url);
  const item   = document.createElement('div');
  item.dataset.previewUrl = url;

  if (!cached) {
    // ── 取得前（ローディング状態） ──
    item.className = 'preview-item preview-item--loading';
    item.innerHTML =
      `<div class="preview-item-header">` +
        `<p class="preview-item-source">${escapeHtml(url)}</p>` +
      `</div>` +
      `<p class="preview-item-body preview-item-body--loading">⏳ 取得中...</p>`;

  } else if (cached.error) {
    // ── 取得失敗 ──
    item.className = 'preview-item preview-item--error';
    item.innerHTML =
      `<div class="preview-item-header">` +
        `<p class="preview-item-source">${escapeHtml(url)}</p>` +
      `</div>` +
      `<p class="preview-item-body preview-item-body--error">❌ 本文プレビュー取得不可</p>`;

  } else {
    // ── 取得済み ──
    item.className = 'preview-item';
    const titleHtml = cached.title
      ? `<p class="preview-item-title">${escapeHtml(cached.title)}</p>`
      : '';
    const bodyContent = cached.text
      ? escapeHtml(cached.text)
      : '<span class="preview-item-body--empty">（本文を抽出できませんでした）</span>';
    item.innerHTML =
      `<div class="preview-item-header">` +
        titleHtml +
        `<p class="preview-item-source">Source: ${escapeHtml(url)}</p>` +
      `</div>` +
      `<p class="preview-item-body">${bodyContent}</p>`;
  }

  return item;
}

/**
 * 取得完了後、対応する DOM アイテムをキャッシュ済み状態に差し替える。
 * @param {string} url
 */
function updatePreviewItemDom(url) {
  const items = previewResultList.querySelectorAll('.preview-item');
  for (const item of items) {
    if (item.dataset.previewUrl === url) {
      item.replaceWith(buildPreviewItemDom(url));
      return;
    }
  }
}

/**
 * 本文プレビューボタン 2 つをまとめて有効 / 無効にする。
 * @param {boolean} disabled
 */
function setPreviewBtnsDisabled(disabled) {
  previewVisibleBtn.disabled = disabled;
  previewCheckedBtn.disabled = disabled;
}

/**
 * 現在ページのプレビュー取得状況に応じて「表示中」ボタン文言・有効状態を更新する。（Phase 10.1）
 *
 * 状態遷移:
 *   取得済み 0件（初回）        → enabled 「📖 表示中の本文をプレビュー」
 *   未取得 0件（全件取得済み）  → disabled「✅ 表示中の本文プレビュー取得済み」
 *   取得済み > 0、未取得 > 10  → enabled 「📖 次の10件の本文をプレビュー」
 *   取得済み > 0、未取得 ≤ 10  → enabled 「📖 残りN件の本文をプレビュー」
 */
function updatePreviewVisibleBtn() {
  const start    = sitemapCurrentPage * SITEMAP_PAGE_SIZE;
  const end      = start + SITEMAP_PAGE_SIZE;
  const pageUrls = filteredSitemapUrls.slice(start, end);

  if (!pageUrls.length) {
    previewVisibleBtn.disabled    = false;
    previewVisibleBtn.textContent = '📖 表示中の本文をプレビュー';
    return;
  }

  const fetchedCount = pageUrls.filter(url =>  previewCache.has(url)).length;
  const pendingCount = pageUrls.length - fetchedCount;

  if (pendingCount === 0) {
    previewVisibleBtn.disabled    = true;
    previewVisibleBtn.textContent = '✅ 表示中の本文プレビュー取得済み';
  } else if (fetchedCount === 0) {
    // まだ 1 件も取得していない（初回）
    previewVisibleBtn.disabled    = false;
    previewVisibleBtn.textContent = '📖 表示中の本文をプレビュー';
  } else if (pendingCount <= PREVIEW_FETCH_LIMIT) {
    // 残りが PREVIEW_FETCH_LIMIT 以下
    previewVisibleBtn.disabled    = false;
    previewVisibleBtn.textContent = `📖 残り${pendingCount}件の本文をプレビュー`;
  } else {
    // まだ PREVIEW_FETCH_LIMIT 件以上残っている
    previewVisibleBtn.disabled    = false;
    previewVisibleBtn.textContent = `📖 次の${PREVIEW_FETCH_LIMIT}件の本文をプレビュー`;
  }
}

/**
 * 選択中URLのプレビュー取得状況に応じて「選択中」ボタン文言・有効状態を更新する。（Phase 10.1）
 *
 * 状態遷移:
 *   選択 0件                    → enabled 「📖 選択中の本文をプレビュー」（リセット状態）
 *   取得済み 0件（初回）        → enabled 「📖 選択中の本文をプレビュー」
 *   未取得 0件（全件取得済み）  → disabled「✅ 選択中の本文プレビュー取得済み」
 *   取得済み > 0、未取得 > 10  → enabled 「📖 次の10件（選択中）の本文をプレビュー」
 *   取得済み > 0、未取得 ≤ 10  → enabled 「📖 残りN件（選択中）の本文をプレビュー」
 */
function updatePreviewCheckedBtn() {
  const checkedUrls = filteredSitemapUrls.filter(url => checkedSitemapUrls.has(url));

  if (!checkedUrls.length) {
    previewCheckedBtn.disabled    = false;
    previewCheckedBtn.textContent = '📖 選択中の本文をプレビュー';
    return;
  }

  const fetchedCount = checkedUrls.filter(url =>  previewCache.has(url)).length;
  const pendingCount = checkedUrls.length - fetchedCount;

  if (pendingCount === 0) {
    previewCheckedBtn.disabled    = true;
    previewCheckedBtn.textContent = '✅ 選択中の本文プレビュー取得済み';
  } else if (fetchedCount === 0) {
    previewCheckedBtn.disabled    = false;
    previewCheckedBtn.textContent = '📖 選択中の本文をプレビュー';
  } else if (pendingCount <= PREVIEW_FETCH_LIMIT) {
    previewCheckedBtn.disabled    = false;
    previewCheckedBtn.textContent = `📖 残り${pendingCount}件（選択中）の本文をプレビュー`;
  } else {
    previewCheckedBtn.disabled    = false;
    previewCheckedBtn.textContent = `📖 次の${PREVIEW_FETCH_LIMIT}件（選択中）の本文をプレビュー`;
  }
}

// ===============================================
// Phase 8：PDF用表示（印刷プレビュー）
// ===============================================

/**
 * 資料パックを印刷用 HTML に変換して新しいタブで開く。
 * ブラウザの「印刷 → PDF として保存」で PDF 化できる。
 */
function openPrintPreview() {
  // pack-name-input のフォーカスを先に外す（iOS 対策）
  packNameInput.blur();
  const packName = sanitizePackName(packNameInput.value);
  const successItems = lastPackResults.filter(r => r.success);

  if (!successItems.length) {
    showPackCopyFeedback('❌ 先に資料パックを作成してください', false);
    return;
  }

  const now     = new Date();
  const dateStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;

  const sectionsHtml = successItems.map((item, idx) => {
    const bodyHtml = mdBlocksToHtml(item.md);
    return `
      <section class="page-section">
        <h2 class="section-title">${escapeHtml(`${idx + 1}. ${item.title}`)}</h2>
        <p class="source-line">Source: <a href="${escapeHtml(item.url)}" target="_blank">${escapeHtml(item.url)}</a></p>
        <div class="section-body">${bodyHtml}</div>
      </section>`;
  }).join('\n<hr class="section-divider">\n');

  const html = buildPrintPageHtml(dateStr, successItems.length, sectionsHtml, packName); // packName は上で取得済み

  const win = window.open('', '_blank');
  if (!win) {
    alert('ポップアップがブロックされました。\nブラウザの設定でこのサイトのポップアップを許可してください。');
    return;
  }
  win.document.write(html);
  win.document.close();
}

/**
 * Markdown テキスト全体をブロック単位で HTML に変換する（印刷プレビュー専用）。
 * @param {string} md
 * @returns {string}
 */
function mdBlocksToHtml(md) {
  if (!md) return '';

  // ── コードブロックを退避 ──
  const codeBlocks = [];
  md = md.replace(/```[\s\S]*?```/g, match => {
    const idx = codeBlocks.length;
    codeBlocks.push(match);
    return `\x01CB${idx}\x01`;
  });

  // ── 空行 2 個以上でブロック分割 ──
  const htmlParts = md.split(/\n{2,}/).map(block => {
    block = block.trim();
    if (!block) return '';

    // コードブロック復元
    if (/^\x01CB\d+\x01$/.test(block)) {
      const idx = parseInt(block.match(/\d+/)[0]);
      const raw = codeBlocks[idx];
      const inner = raw.replace(/^```\w*\n?/, '').replace(/\n?```$/, '');
      return `<pre><code>${escapeHtml(inner)}</code></pre>`;
    }

    // 水平線
    if (/^-{3,}$/.test(block) || /^\*{3,}$/.test(block)) return '<hr>';

    // 見出し（単行）
    const hm = block.match(/^(#{1,6})\s+(.+)$/s);
    if (hm) {
      const lv = hm[1].length;
      return `<h${lv}>${mdInlineToHtml(hm[2].trim())}</h${lv}>`;
    }

    // 箇条書き（全行が "- " または "* " で始まる）
    const lines = block.split('\n');
    if (lines.every(l => /^[\-*] /.test(l.trim()))) {
      const lis = lines.map(l =>
        `<li>${mdInlineToHtml(l.trim().replace(/^[\-*] /, ''))}</li>`).join('');
      return `<ul>${lis}</ul>`;
    }

    // 番号付きリスト
    if (lines.every(l => /^\d+\.\s/.test(l.trim()))) {
      const lis = lines.map(l =>
        `<li>${mdInlineToHtml(l.trim().replace(/^\d+\.\s+/, ''))}</li>`).join('');
      return `<ol>${lis}</ol>`;
    }

    // 引用
    if (lines.every(l => l.startsWith('> '))) {
      const inner = mdInlineToHtml(lines.map(l => l.slice(2)).join('\n'));
      return `<blockquote>${inner}</blockquote>`;
    }

    // 段落（行内改行は <br> に）
    const lineHtml = lines.map(l => mdInlineToHtml(l)).join('<br>');
    return `<p>${lineHtml}</p>`;
  });

  return htmlParts.filter(Boolean).join('\n');
}

/**
 * インライン Markdown（リンク・太字・斜体・コード）を HTML に変換する。
 * リンクを先に処理してから残りを escapeHtml する方式で & 二重エスケープを防ぐ。
 * @param {string} text
 * @returns {string}
 */
function mdInlineToHtml(text) {
  const holders = [];
  const ph = html => {
    const i = holders.length;
    holders.push(html);
    return `\x02PH${i}\x02`;
  };

  // 画像 → リンクより先に処理
  text = text.replace(/!\[([^\]]*)\]\(([^)]+)\)/g,
    (_, alt, src) => ph(`<img alt="${escapeHtml(alt)}" src="${escapeHtml(src)}">`));

  // リンク [text](url) — url 内の & が二重エスケープされないよう先に退避
  text = text.replace(/\[([^\]]+)\]\(([^)]+)\)/g,
    (_, t, url) => ph(`<a href="${escapeHtml(url)}">${escapeHtml(t)}</a>`));

  // インラインコード
  text = text.replace(/`([^`]+)`/g,
    (_, code) => ph(`<code>${escapeHtml(code)}</code>`));

  // 太字
  text = text.replace(/\*\*([^*]+)\*\*/g,
    (_, t) => ph(`<strong>${escapeHtml(t)}</strong>`));

  // 斜体
  text = text.replace(/\*([^*]+)\*/g,
    (_, t) => ph(`<em>${escapeHtml(t)}</em>`));

  // 残りのテキストを HTML エスケープ
  text = escapeHtml(text);

  // プレースホルダーを復元
  text = text.replace(/\x02PH(\d+)\x02/g, (_, i) => holders[parseInt(i)]);
  return text;
}

/**
 * 印刷用 HTML ページ（完全な HTML 文書）を生成する。
 * @param {string} dateStr     "YYYY-MM-DD"
 * @param {number} pageCount   成功ページ数
 * @param {string} sectionsHtml  各セクションの HTML 文字列
 * @returns {string}
 */
/**
 * @param {string} [packName]  資料パック名（省略時はデフォルト）
 */
function buildPrintPageHtml(dateStr, pageCount, sectionsHtml, packName = 'NotebookLM 資料パック') {
  const titleText = packName || 'NotebookLM 資料パック';
  return `<!DOCTYPE html>
<html lang="ja">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(titleText)} — ${escapeHtml(dateStr)}</title>
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Hiragino Sans',
                   'Yu Gothic UI', 'Meiryo UI', 'Noto Sans CJK JP', sans-serif;
      font-size: 11pt;
      line-height: 1.8;
      color: #1a1a1a;
      background: #fff;
      padding: 0 16px 48px;
      max-width: 800px;
      margin: 0 auto;
    }

    /* ── 印刷コントロール（画面のみ） ── */
    .print-controls {
      position: sticky;
      top: 0;
      background: #eef1fb;
      border-bottom: 1px solid #c5cde8;
      padding: 12px 16px;
      display: flex;
      gap: 10px;
      align-items: center;
      flex-wrap: wrap;
      z-index: 100;
      margin: 0 -16px 32px;
    }
    .btn-print {
      background: #3f51b5;
      border: none;
      border-radius: 8px;
      color: #fff;
      cursor: pointer;
      font-size: 0.95rem;
      font-weight: 700;
      padding: 10px 22px;
      min-height: 44px;
      transition: background 0.15s;
    }
    .btn-print:hover { background: #303f9f; }
    .btn-close {
      background: transparent;
      border: 1px solid #c5cde8;
      border-radius: 8px;
      color: #555;
      cursor: pointer;
      font-size: 0.88rem;
      padding: 10px 16px;
      min-height: 44px;
    }
    .print-hint {
      font-size: 0.78rem;
      color: #666;
      margin-left: auto;
      line-height: 1.4;
    }

    /* ── ドキュメントヘッダー ── */
    .doc-header {
      margin-bottom: 28px;
      padding-bottom: 16px;
      border-bottom: 2px solid #3f51b5;
    }
    .doc-title {
      font-size: 18pt;
      font-weight: 700;
      color: #1a237e;
      margin-bottom: 8px;
    }
    .doc-meta {
      font-size: 9.5pt;
      color: #555;
      line-height: 1.6;
    }

    /* ── セクション ── */
    .section-title {
      font-size: 13pt;
      font-weight: 700;
      color: #1a237e;
      border-left: 4px solid #3f51b5;
      padding: 4px 0 4px 12px;
      margin: 28px 0 8px;
      line-height: 1.4;
    }
    .source-line {
      font-size: 8.5pt;
      color: #888;
      margin: 0 0 14px 16px;
      word-break: break-all;
    }
    .source-line a { color: #3f51b5; text-decoration: none; }

    /* ── 本文 ── */
    .section-body p   { margin: 0 0 8px; }
    .section-body h1  { font-size: 12pt;   font-weight: 700; margin: 16px 0 6px; }
    .section-body h2  { font-size: 11.5pt; font-weight: 700; margin: 14px 0 5px; }
    .section-body h3  { font-size: 11pt;   font-weight: 600; margin: 12px 0 4px; }
    .section-body h4,
    .section-body h5,
    .section-body h6  { font-size: 10.5pt; font-weight: 600; margin: 10px 0 4px; }
    .section-body ul,
    .section-body ol  { padding-left: 20px; margin: 0 0 8px; }
    .section-body li  { margin-bottom: 3px; }
    .section-body a   { color: #1565c0; word-break: break-all; }
    .section-body blockquote {
      border-left: 3px solid #c5cde8;
      padding: 4px 0 4px 12px;
      color: #555;
      margin: 8px 0;
    }
    .section-body pre {
      background: #f5f5f5;
      border: 1px solid #ddd;
      border-radius: 4px;
      padding: 10px 12px;
      overflow-x: auto;
      font-size: 9pt;
      margin: 8px 0;
      white-space: pre-wrap;
      word-break: break-word;
    }
    .section-body code {
      background: #f5f5f5;
      border-radius: 3px;
      padding: 1px 5px;
      font-size: 9pt;
      font-family: 'SFMono-Regular', Consolas, 'Liberation Mono', monospace;
    }
    .section-body pre code { background: none; padding: 0; }
    .section-divider {
      border: none;
      border-top: 1px solid #e0e0e0;
      margin: 28px 0;
    }

    /* ── 印刷設定 ── */
    @page { size: A4 portrait; margin: 20mm 15mm 20mm 18mm; }

    @media print {
      .print-controls { display: none !important; }
      body { padding: 0; font-size: 10.5pt; }
      a { color: #1a1a1a !important; }
      .section-title { break-after: avoid; }
      .page-section  { break-inside: avoid; }
      /* 印刷時はリンクの後ろに URL を表示 */
      .section-body a::after {
        content: ' (' attr(href) ')';
        font-size: 7.5pt;
        color: #777;
      }
      .source-line a::after { content: none; }
    }

    /* ── スマホ調整 ── */
    @media (max-width: 600px) {
      body { font-size: 10pt; padding: 0 8px 32px; }
      .doc-title { font-size: 14pt; }
      .section-title { font-size: 11.5pt; }
      .print-hint { display: none; }
    }
  </style>
</head>
<body>
  <div class="print-controls">
    <button class="btn-print" onclick="window.print()">🖨️ 印刷 / PDF保存</button>
    <button class="btn-close" onclick="window.close()">✕ 閉じる</button>
    <span class="print-hint">
      「印刷」→ 送信先を「PDF として保存」に変更して保存できます
    </span>
  </div>

  <header class="doc-header">
    <h1 class="doc-title">📄 ${escapeHtml(titleText)}</h1>
    <div class="doc-meta">
      作成日：${escapeHtml(dateStr)}　|　取得ページ数：${pageCount}
    </div>
  </header>

  ${sectionsHtml}
</body>
</html>`;
}

// ===============================================
// Phase 8.5：資料パック名ユーティリティ
// ===============================================

/**
 * 取得結果から資料パック名の初期値を生成する。
 * 最初の成功 URL のドメイン名を使い、取得できない場合はデフォルト名。
 * 例: kisei-log.com → "kisei-log_資料パック_2026-05-25"
 * @param {Array<{url: string, success: boolean}>} results
 * @returns {string}
 */
function generatePackName(results) {
  const now = new Date();
  const yyyy = now.getFullYear();
  const mm   = String(now.getMonth() + 1).padStart(2, '0');
  const dd   = String(now.getDate()).padStart(2, '0');
  const dateStr = `${yyyy}-${mm}-${dd}`;

  const firstSuccess = results.find(r => r.success);
  if (firstSuccess) {
    try {
      // "www.kisei-log.com" → "kisei-log"（www 除去・TLD 除去）
      const hostname = new URL(firstSuccess.url).hostname.replace(/^www\./, '');
      // TLD を除いた部分（最後の . より前まで）
      const parts = hostname.split('.');
      const domain = parts.length >= 2
        ? parts.slice(0, -1).join('-')   // kisei-log.com → kisei-log
        : parts[0];
      if (domain) return `${domain}_資料パック_${dateStr}`;
    } catch { /* フォールバック */ }
  }
  return `NotebookLM資料パック_${dateStr}`;
}

/**
 * 入力された資料パック名をファイル名として安全な形に変換する。
 * 空欄・全除去の場合はデフォルト名を返す。
 * @param {string} raw
 * @returns {string}
 */
function sanitizePackName(raw) {
  const now = new Date();
  const yyyy = now.getFullYear();
  const mm   = String(now.getMonth() + 1).padStart(2, '0');
  const dd   = String(now.getDate()).padStart(2, '0');
  const fallback = `NotebookLM資料パック_${yyyy}-${mm}-${dd}`;

  if (!raw || !raw.trim()) return fallback;

  const safe = raw
    .trim()
    .replace(/[/\\:*?"<>|]/g, '_')   // ファイル名使用不可文字 → _
    .replace(/\s+/g, '_')             // 空白 → _
    .replace(/_{2,}/g, '_')           // 連続 _ → 単一 _
    .replace(/^[._]+|[._]+$/g, '')    // 先頭・末尾の . や _
    .slice(0, 80);                     // 最大 80 文字

  return safe || fallback;
}
