'use strict';

// -----------------------------------------------
// Phase 1 で取得した Cloudflare Worker URL
// -----------------------------------------------
const WORKER_URL = 'https://notebooklm-packer.momo19830831.workers.dev';

// -----------------------------------------------
// DOM 要素の取得
// -----------------------------------------------
const urlInput    = document.getElementById('url-input');
const fetchBtn    = document.getElementById('fetch-btn');
const statusBar   = document.getElementById('status-bar');
const statusIcon  = document.getElementById('status-icon');
const statusText  = document.getElementById('status-text');
const resultCard  = document.getElementById('result-card');
const charCount   = document.getElementById('char-count');
const resultNote  = document.getElementById('result-note');

// タブ
const tabHtmlBtn  = document.getElementById('tab-html');
const tabTextBtn  = document.getElementById('tab-text');

// パネル
const panelHtml   = document.getElementById('panel-html');
const panelText   = document.getElementById('panel-text');

// 表示エリア
const resultHtml  = document.getElementById('result-html');
const resultText  = document.getElementById('result-text');
const extractMeta = document.getElementById('extract-meta');

// -----------------------------------------------
// 状態管理
// -----------------------------------------------
let lastHtml = '';  // 取得した HTML ソース
let lastText = '';  // 抽出した本文テキスト
let currentTab = 'html';

// -----------------------------------------------
// イベントリスナー
// -----------------------------------------------
fetchBtn.addEventListener('click', handleFetch);

urlInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') handleFetch();
});

tabHtmlBtn.addEventListener('click', () => switchTab('html'));
tabTextBtn.addEventListener('click', () => switchTab('text'));

// -----------------------------------------------
// タブ切り替え
// -----------------------------------------------
function switchTab(tab) {
  currentTab = tab;

  if (tab === 'html') {
    tabHtmlBtn.classList.add('tab-active');
    tabTextBtn.classList.remove('tab-active');
    panelHtml.hidden = false;
    panelText.hidden = true;
    charCount.textContent = lastHtml
      ? `${lastHtml.length.toLocaleString()} 文字（HTML）`
      : '';
  } else {
    tabHtmlBtn.classList.remove('tab-active');
    tabTextBtn.classList.add('tab-active');
    panelHtml.hidden = true;
    panelText.hidden = false;
    charCount.textContent = lastText
      ? `${lastText.length.toLocaleString()} 文字（本文）`
      : '';
  }
}

// -----------------------------------------------
// メイン処理：URL → Worker → HTML 取得
// -----------------------------------------------
async function handleFetch() {
  const targetUrl = urlInput.value.trim();

  // 入力チェック
  if (!targetUrl) {
    setStatus('error', '❌', 'URL を入力してください');
    return;
  }
  try {
    new URL(targetUrl);
  } catch {
    setStatus('error', '❌', 'URL の形式が正しくありません（https:// から始まる URL を入力してください）');
    return;
  }

  // 取得開始
  fetchBtn.disabled = true;
  resultCard.hidden = true;
  setStatus('loading', '⏳', '取得中...');

  try {
    const endpoint = `${WORKER_URL}/?url=${encodeURIComponent(targetUrl)}`;
    const response = await fetch(endpoint);

    if (!response.ok) {
      let errMsg = `HTTP ${response.status}`;
      try {
        const errData = await response.json();
        if (errData.error) errMsg = errData.error;
      } catch { /* 無視 */ }
      setStatus('error', '❌', `取得失敗：${errMsg}`);
      return;
    }

    const html = await response.text();
    lastHtml = html;

    // HTML パネルに表示
    resultHtml.value = html;

    // 本文抽出
    setStatus('loading', '⏳', '本文を抽出中...');
    const { text, usedSelector } = extractBodyText(html);
    lastText = text;

    // 抽出本文パネルに表示
    resultText.value = text;
    extractMeta.textContent = `抽出元：${usedSelector}`;

    // 注記
    resultNote.innerHTML =
      '※ DOMParser でノイズ要素を除去した本文テキストです。<br>' +
      'Markdown 変換は Phase 4 で追加します。';

    // 現在のタブに合わせて文字数を更新して表示
    resultCard.hidden = false;
    switchTab(currentTab);
    resultCard.scrollIntoView({ behavior: 'smooth', block: 'start' });

    setStatus('success', '✅', '取得・抽出完了');

  } catch (e) {
    setStatus('error', '❌', `エラー：${e.message}`);
  } finally {
    fetchBtn.disabled = false;
  }
}

// -----------------------------------------------
// 本文抽出：DOMParser でノイズを除去してテキストを返す
// -----------------------------------------------
function extractBodyText(rawHtml) {
  const parser = new DOMParser();
  const doc = parser.parseFromString(rawHtml, 'text/html');

  // ① 不要な要素を除去
  const removeSelectors = [
    'script', 'style', 'noscript',
    'nav', 'header', 'footer', 'aside',
    '[role="navigation"]',
    '[role="banner"]',
    '[role="complementary"]',
    '[aria-hidden="true"]',
  ];
  removeSelectors.forEach(sel => {
    doc.querySelectorAll(sel).forEach(el => el.remove());
  });

  // ② メインコンテンツ候補（優先順）
  const candidates = [
    { sel: 'main',             label: '<main>' },
    { sel: 'article',          label: '<article>' },
    { sel: '[role="main"]',    label: '[role="main"]' },
    { sel: '#main',            label: '#main' },
    { sel: '#content',         label: '#content' },
    { sel: '.content',         label: '.content' },
    { sel: '.entry-content',   label: '.entry-content' },
    { sel: '.post-body',       label: '.post-body' },
    { sel: '.post-content',    label: '.post-content' },
    { sel: '.article-body',    label: '.article-body' },
    { sel: '.hentry',          label: '.hentry' },
  ];

  let mainEl = null;
  let usedSelector = 'body（フォールバック）';

  for (const { sel, label } of candidates) {
    const found = doc.querySelector(sel);
    if (found) {
      mainEl = found;
      usedSelector = sel;
      break;
    }
  }
  if (!mainEl) mainEl = doc.body;

  // ③ タイトルを取得
  const title = (doc.title || '').trim();

  // ④ テキスト抽出
  const bodyText = nodeToText(mainEl);

  // タイトルを先頭に付ける
  const text = title
    ? `${title}\n${'─'.repeat(Math.min(title.length * 2, 40))}\n\n${bodyText}`
    : bodyText;

  return { text, usedSelector };
}

// -----------------------------------------------
// DOM ノードを読みやすいプレーンテキストに変換する
// ブロック要素の前後に改行を挿入する
// -----------------------------------------------
const BLOCK_TAGS = new Set([
  'p', 'div', 'section', 'article', 'main', 'aside',
  'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
  'ul', 'ol', 'li', 'dl', 'dt', 'dd',
  'blockquote', 'pre', 'figure', 'figcaption',
  'table', 'thead', 'tbody', 'tfoot', 'tr', 'th', 'td',
]);

function nodeToText(node) {
  if (!node) return '';
  const parts = [];

  function walk(n) {
    // テキストノード
    if (n.nodeType === Node.TEXT_NODE) {
      const t = n.textContent.replace(/[\r\n\t ]+/g, ' ');
      if (t.trim()) parts.push(t);
      return;
    }

    if (n.nodeType !== Node.ELEMENT_NODE) return;

    const tag = n.tagName.toLowerCase();

    // br / hr は改行に変換
    if (tag === 'br') { parts.push('\n'); return; }
    if (tag === 'hr') { parts.push('\n\n'); return; }

    const isBlock = BLOCK_TAGS.has(tag);
    if (isBlock) parts.push('\n');
    n.childNodes.forEach(walk);
    if (isBlock) parts.push('\n');
  }

  walk(node);

  return parts
    .join('')
    .replace(/[ \t]*\n/g, '\n')   // 行末の空白を除去
    .replace(/\n[ \t]+/g, '\n')   // 行頭の空白を除去
    .replace(/\n{3,}/g, '\n\n')   // 3連続以上の空行を2行に圧縮
    .trim();
}

// -----------------------------------------------
// ステータスバーの表示を更新する
// -----------------------------------------------
function setStatus(type, icon, message) {
  statusBar.hidden = false;
  statusBar.className = `status-bar status-${type}`;
  statusIcon.textContent = icon;
  statusText.textContent = message;
}
